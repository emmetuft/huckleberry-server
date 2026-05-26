# Auth & Data Architecture — MVP

Where auth state lives. **Standalone huckleberry.ai with native identity + BFF-as-confidential-OAuth-client to Domo.** Both layers are stored.

- **Layer A (huckleberry identity):** `users`, `magic_links`, server-side sessions in Redis.
- **Layer B (Domo linkage):** `linked_domo_instances`, `domo_oauth_tokens` (KMS-encrypted refresh tokens).
- **Category B (app data):** `personas`, `mcp_servers`, `mcp_oauth_tokens`. All `(customer_id, user_id, ...)` scoped.

See `../authentication.md` for design rationale; `oauth-flow.md` for sequences.

## Diagram

```mermaid
graph LR
    UI[Huckleberry UI<br/>huckleberry.ai]

    subgraph "NestJS BFF"
        HAG[HuckleberryAuthGuard<br/>cookie → principal]
        SESS[SessionService<br/>Redis]
        AUTH[Auth controllers<br/>signup · signin/request<br/>signin (consume) · logout · me]
        LINK[DomoLink controllers<br/>start · callback · switch · unlink]
        BROKER[DomoAuthBroker<br/>token cache + refresh]
        STORE[DomoTokenStore<br/>Aurora + KMS]
        OAUTH[DomoOAuthClient<br/>public PKCE client]
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
        T_LINKS[(linked_domo_instances)]
        T_TOKENS[(domo_oauth_tokens<br/>refresh KMS-encrypted)]
        T_PERSONAS[(personas)]
        T_MCP[(mcp_servers · mcp_oauth_tokens)]
    end

    SM[(Secrets Manager<br/>session signing key)]
    REDIS[(Redis<br/>sessions · link_init state<br/>Domo access-token cache)]
    KMS[(AWS KMS<br/>envelope encryption)]
    SES[AWS SES<br/>magic-link emails]

    DOMO[Domo Instance APIs<br/>customer.domo.com/api/*]
    GATEKEEPER[Gatekeeper<br/>customer.domo.com/oauth2/*]

    UI --> HAG
    HAG --> SESS
    SESS --> REDIS
    UI --> AUTH
    UI --> LINK
    AUTH --> T_USERS
    AUTH --> T_MAGIC
    AUTH --> SES
    AUTH --> SM
    LINK --> BROKER
    LINK --> T_LINKS
    BROKER --> STORE
    BROKER --> REDIS
    BROKER --> OAUTH
    STORE --> T_TOKENS
    STORE --> KMS
    OAUTH --> SM
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
  status            ENUM('pending_link','active','suspended') NOT NULL DEFAULT 'pending_link'
  created_at, updated_at, last_login_at
  INDEX (email)

magic_links
  token_hash        VARCHAR(64) PK            -- SHA-256 of single-use token
  user_id           BINARY(16) NOT NULL FK -> users(id)
  expires_at        DATETIME NOT NULL         -- 15 min TTL
  consumed_at       DATETIME NULL
  ip_issued_from    VARCHAR(45)
  INDEX (user_id, expires_at)

-- Layer B — Domo linkage
linked_domo_instances
  id                BINARY(16) PK
  user_id           BINARY(16) NOT NULL FK -> users(id)
  issuer_url        VARCHAR(255) NOT NULL          -- byte-matches iss claim
  customer_id       VARCHAR(64) NOT NULL           -- Gatekeeper cid
  domo_sub          VARCHAR(64) NOT NULL           -- Gatekeeper sub
  scope             VARCHAR(1000) NOT NULL
  linked_at, last_used_at
  UNIQUE (user_id, issuer_url, domo_sub)
  INDEX (customer_id)

domo_oauth_tokens
  link_id           BINARY(16) PK FK -> linked_domo_instances(id) ON DELETE CASCADE
  refresh_token     VARBINARY NOT NULL             -- AES-GCM ciphertext
  refresh_iv        VARBINARY NOT NULL
  refresh_dek_id    VARCHAR(255) NOT NULL          -- KMS-wrapped DEK reference
  expires_at        DATETIME NULL                  -- access-token expiry (advisory)
  scope             VARCHAR(1000) NOT NULL
  updated_at

-- Category B — Huckleberry-owned app data
personas
  customer_id       VARCHAR(64) NOT NULL
  user_id           BINARY(16) NOT NULL FK -> users(id)
  id                BINARY(16)
  focus_areas       JSON
  is_default        TINYINT(1)
  created_at, updated_at
  PRIMARY KEY (customer_id, user_id, id)
  INDEX (customer_id, user_id, is_default)

mcp_servers
  customer_id       VARCHAR(64) NOT NULL
  user_id           BINARY(16) NOT NULL FK -> users(id)
  id                BINARY(16)
  name, url, enabled, auth_type, created_at, updated_at
  PRIMARY KEY (customer_id, user_id, id)

mcp_oauth_tokens
  customer_id       VARCHAR(64) NOT NULL
  mcp_server_id     BINARY(16) NOT NULL FK -> mcp_servers(id)
  access_token      VARBINARY                       -- KMS envelope encrypted
  refresh_token     VARBINARY                       -- KMS envelope encrypted
  expires_at        DATETIME
  PRIMARY KEY (customer_id, mcp_server_id)
```

Note that **memory tables are not here.** Memory lives in Mako's graph device, accessed via Mako APIs.

## Service ↔ Table matrix

| Service                                                                                                              | Tables                                                                         | R/W |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --- |
| Auth (Layer A)                                                                                                       | `users`, `magic_links`                                                         | R/W |
| Sessions (Layer A)                                                                                                   | none (Redis)                                                                   | —   |
| DomoLink (Layer B)                                                                                                   | `linked_domo_instances`, `domo_oauth_tokens`                                   | R/W |
| DomoAuthBroker (Layer B)                                                                                             | `domo_oauth_tokens` (refresh rotation), `linked_domo_instances` (last_used_at) | R/W |
| Personas (Category B)                                                                                                | `personas`                                                                     | R/W |
| MCP (Category B)                                                                                                     | `mcp_servers`, `mcp_oauth_tokens`                                              | R/W |
| Identity, People, Agents, Sessions (controllers), AI Services, Graph, DataSources, Connectors, Toolkits, Huckleberry | none                                                                           | —   |

## Multi-tenant scoping

- `users.id` is **huckleberry-global**. A huckleberry user is not bound to any single Domo customer.
- `linked_domo_instances` is **N-per-user** — one row per linked instance.
- All Category B rows are scoped by `(customer_id, user_id)`. The same huckleberry user can have personas under `labs` and a different set under `customer1` — they're separate rows.
- The active link (held in the huckleberry session) determines which `customer_id` a request scopes to. `TenantBoundConnection` is acquired with that customer_id and the connection-level `SET @huckleberry_customer_id` is set accordingly.

## What's encrypted at the column level

| Column                            | Why                                                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `domo_oauth_tokens.refresh_token` | Per-link Domo refresh credential. If a backup leaks, attacker shouldn't be able to act as the user against Domo. |
| `mcp_oauth_tokens.access_token`   | Third-party MCP credentials. Same logic.                                                                         |
| `mcp_oauth_tokens.refresh_token`  | Same.                                                                                                            |

No password hashes are stored (magic-link only). `magic_links.token_hash` is SHA-256 of the random token; the token itself never lands in the DB. Rate-limit `/auth/signin/request` per email + per IP to stop email-flood abuse.

## Aurora rollout order

Tables ship in order: Layer A (users + identity) → Layer B (linkage + tokens) → Category B (personas / MCP). Aurora wiring is one ticket; the in-memory `Map<>` stubs on `personas` and `mcp` swap to repository calls in a follow-up.
