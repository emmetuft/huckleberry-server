# Auth & Data Architecture — MVP

Where auth state lives. **Standalone huckleberry.ai with native identity + BFF-as-public-PKCE-OAuth-client to Domo.** Both layers are stored.

- **Layer A (huckleberry identity):** `users`, `magic_links`, `sessions` (MySQL).
- **Layer B (Domo linkage):** `linked_domo_instances`, `domo_oauth_tokens` (refresh tokens — plaintext now, KMS planned), `domo_oauth_clients` (DCR registrations).
- **Category B (app data):** `personas`, `mcp_servers`, `mcp_oauth_tokens` — designed, not yet in schema.

See `../authentication.md` for design rationale; `oauth-flow.md` for sequences.

## Diagram

```mermaid
graph LR
    UI[Huckleberry UI<br/>huckleberry.ai]

    subgraph "NestJS BFF"
        HAG[HuckleberryAuthGuard<br/>cookie → principal]
        SESS[SessionService<br/>MySQL sessions table]
        AUTH[Auth controllers<br/>signup · signin/request<br/>signin (consume) · logout · me]
        LINK[DomoLink service<br/>start · completeLink · unlink]
        BROKER[DomoAuthBroker<br/>token cache + refresh]
        STORE[DomoTokenStore<br/>domo_oauth_tokens]
        OAUTH[DomoOAuthClient<br/>public PKCE · DCR]
        CREDS[ClientCredentialStore<br/>domo_oauth_clients]
        JWKS_SVC[JwksService<br/>cached per-issuer]
        IDENT[Identity]
        PEOPLE[People]
        PERS[Personas]
        AGENTS[Agents]
        SESS_CTRL[Sessions]
        MCP[MCP]
        PROXY_SVCS[Domo proxy services<br/>AI · Graph · DataSources<br/>Connectors · Toolkits · Huckleberry]
        PROXY[DomoProxyService<br/>targetHost + bearer]
    end

    subgraph "Aurora MySQL"
        T_USERS[(users)]
        T_MAGIC[(magic_links)]
        T_SESS[(sessions)]
        T_LINKS[(linked_domo_instances)]
        T_TOKENS[(domo_oauth_tokens<br/>refresh plaintext→KMS planned)]
        T_CLIENTS[(domo_oauth_clients<br/>DCR registrations)]
    end

    SES[AWS SES<br/>magic-link emails]

    DOMO[Domo Instance APIs<br/>customer.domo.com/api/*]
    GATEKEEPER[Gatekeeper<br/>customer.domo.com/oauth2/*]

    UI --> HAG
    HAG --> SESS
    SESS --> T_SESS
    UI --> AUTH
    UI --> LINK
    AUTH --> T_USERS
    AUTH --> T_MAGIC
    AUTH --> SES
    LINK --> BROKER
    LINK --> T_LINKS
    BROKER --> STORE
    BROKER --> OAUTH
    STORE --> T_TOKENS
    OAUTH --> CREDS
    CREDS --> T_CLIENTS
    OAUTH --> JWKS_SVC
    JWKS_SVC --> GATEKEEPER
    OAUTH --> GATEKEEPER

    HAG --> IDENT
    HAG --> PEOPLE
    HAG --> PERS
    HAG --> AGENTS
    HAG --> SESS_CTRL
    HAG --> MCP
    HAG --> PROXY_SVCS

    PERS --> T_PERSONAS
    MCP --> T_MCP

    IDENT --> PROXY
    PEOPLE --> PROXY
    AGENTS --> PROXY
    SESS_CTRL --> PROXY
    PROXY_SVCS --> PROXY
    PROXY --> BROKER
    PROXY --> DOMO
```

## Aurora schema — MVP

Three layers of tables: identity, Domo linkage, app data. All carry `customer_id` where multi-tenancy applies; user-level tables carry the huckleberry `user_id`.

```sql
-- Layer A — Huckleberry identity (magic-link only)
users
  id                BINARY(16) PK
  email             VARCHAR(255) NOT NULL UNIQUE
  email_verified    TINYINT(1) NOT NULL DEFAULT 0
  display_name      VARCHAR(255)
  status            ENUM('pending_provision','pending_link','active','suspended') NOT NULL
  created_at, updated_at, last_login_at

magic_links
  token_hash        VARCHAR(64) PK            -- SHA-256 of single-use token
  user_id           BINARY(16) NOT NULL FK -> users(id)
  expires_at        DATETIME NOT NULL         -- 15 min TTL
  consumed_at       DATETIME NULL
  ip_issued_from    VARCHAR(45)

sessions
  sid               VARCHAR(64) PK            -- random base64url, not a JWT
  user_id           BINARY(16) NOT NULL FK -> users(id)
  expires_at        DATETIME NOT NULL
  csrf_token        VARCHAR(64) NOT NULL
  created_at, last_seen_at

-- Layer B — Domo linkage
linked_domo_instances
  id                BINARY(16) PK
  user_id           BINARY(16) NOT NULL FK -> users(id)
  issuer_url        VARCHAR(255) NOT NULL          -- byte-matches iss claim
  customer_id       VARCHAR(64) NOT NULL           -- Gatekeeper cid
  domo_sub          VARCHAR(64) NULL               -- Gatekeeper sub; null until PKCE completes
  scope             VARCHAR(1000) NOT NULL
  linked_at, last_used_at

domo_oauth_tokens
  link_id           BINARY(16) PK FK -> linked_domo_instances(id)
  refresh_token     VARCHAR(2000) NOT NULL         -- plaintext; KMS encryption planned
  scope             VARCHAR(1000) NOT NULL
  updated_at

domo_oauth_clients                                 -- per-instance DCR registrations (migration 0002)
  issuer_url        VARCHAR(255) PK
  client_id         VARCHAR(200) NOT NULL
  registration_access_token VARCHAR(2000)
  redirect_uri      VARCHAR(500) NOT NULL
  scope             VARCHAR(1000) NOT NULL
  registered_at, last_used_at
```

Category B tables (`personas`, `mcp_servers`, `mcp_oauth_tokens`) are designed but not yet in the schema.

## Service ↔ Table matrix

| Service | Tables | R/W |
|---|---|---|
| Auth (Layer A) | `users`, `magic_links` | R/W |
| Sessions (Layer A) | `sessions` (in-memory store in dev) | R/W |
| SignupService | `users`, `linked_domo_instances` | R/W |
| DomoLinkService (Layer B) | `linked_domo_instances`, `domo_oauth_tokens` | R/W |
| DomoAuthBroker (Layer B) | `domo_oauth_tokens` (refresh rotation), `linked_domo_instances` (last_used_at) | R/W |
| ClientCredentialStore | `domo_oauth_clients` | R/W |
| Agents, AI Services, Toolkits, etc. | none (pure proxy) | — |

## Multi-tenant scoping

- `users.id` is **huckleberry-global**. A huckleberry user is not bound to any single Domo customer.
- `linked_domo_instances` is **one per user** (MVP). Multi-link is post-MVP.
- The active link (held in the session) determines which `customer_id` a request scopes to.

## What's encrypted at the column level

| Column | Status |
|---|---|
| `domo_oauth_tokens.refresh_token` | **Plaintext now.** KMS envelope encryption planned before external launch. |

No password hashes are stored (magic-link only). `magic_links.token_hash` is SHA-256 of the random token; the token itself never lands in the DB.
