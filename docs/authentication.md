# Huckleberry Authentication

## What we're doing (the layman version)

Huckleberry is a **standalone SaaS product** at `huckleberry.com`. It's not embedded in Domo, doesn't run on a Domo subdomain, and a user visiting huckleberry has no existing Domo session to lean on.

That means we own the front-door identity. Users sign up to huckleberry with their own credential. After they're signed in, they **link one or more Domo instances** to their huckleberry account via OAuth. Huckleberry then talks to Domo on the user's behalf using the linked credential.

Two separate auth layers, never confused:

1. **Layer A — Huckleberry identity.** Magic-link sign-in only — no passwords. A users table, single-use email tokens, HttpOnly session cookies. This is the lock on huckleberry's front door. (Self-service signup is not exposed; users are seeded via vetted operator tooling — see "Onboarding flow" below.)
2. **Layer B — Domo OAuth linkage** (per-instance, per-user). Standard OAuth 2.1 authorization-code + PKCE against `https://{customer}.domo.com/oauth2/authorize`. We are a **confidential OAuth client** with Gatekeeper — the BFF holds the `client_secret`, runs the code-exchange server-side, and stores the user's Domo refresh token encrypted in Aurora. When the BFF needs to call Domo on the user's behalf, it pulls a fresh access token from the refresh and forwards it.

A user can link N Domo instances under one huckleberry account. The active instance is part of the user's session state and can be switched without re-authing.

## Why this model

Standalone huckleberry.com has no ambient Domo session, the SPA can't run a silent re-OAuth on every page load, and we need a stable huckleberry identity that survives Domo session expiries. So:

- **BFF as confidential OAuth client** — server-side `/auth/domo/*` endpoints, `client_secret` in AWS Secrets Manager, encrypted token storage in Aurora.
- **A `users` table and a server-issued huckleberry session** — magic-link sign-in, HttpOnly cookie, sliding TTL.
- **The SPA never sees Gatekeeper tokens.** All OAuth happens server-side.
- **Multi-tenant.** One huckleberry deployment, many customers. `customer_id`-scoped Aurora rows. `GatekeeperAuthGuard` and `JwksService` verify Gatekeeper-issued tokens *internally* when the BFF processes a Domo OAuth callback or refreshes a token — not as a front-door verifier.

## Two-layer flow (the full picture)

```
1. Sign up / sign in to huckleberry.com (Layer A)
2. Link a Domo instance via OAuth (Layer B)
3. Use the app — BFF mints fresh Domo tokens on demand from stored refresh tokens
4. Refresh huckleberry session as needed (Layer A)
5. Sign out of huckleberry — local session cleared; Domo linkage persists for next time
```

### Layer A — Huckleberry identity (magic-link only)

| Operation | Endpoint | What happens |
|---|---|---|
| Request sign-in link | `POST /auth/signin/request` | Body: `{ email }`. Looks up `users` by email. If found and `email_verified`, inserts a `magic_links` row (`user_id`, single-use `token_hash`, 15m TTL), sends an email with the link. Always returns `202` regardless of whether the email exists (don't leak account existence). |
| Consume sign-in link | `GET /auth/signin?token=...` | Validates `token_hash` is unconsumed and unexpired, marks consumed, issues huckleberry session cookie. 302 to `/app` or to forced-OAuth if linkage is not yet completed. |
| Sign out | `POST /auth/logout` | Invalidates session in Redis; clears cookie. |
| Me | `GET /auth/me` | Returns the current user + linkage state (`pending_link` vs `active`). |
| Verify email (operator-issued) | `GET /auth/verify?token=...` | Set during onboarding when the operator creates the user row. Marks `email_verified=1`. The very first magic-link email serves as both verification and first sign-in. |

Session shape — `hb_session` cookie carries an HS256-signed JWT with `{ sub: huckleberryUserId, iat, exp, sid: serverSessionId }`. Signing key in AWS Secrets Manager, rotated periodically. Server session in Redis (`sid → { userId, expiresAt }`) allows immediate revocation. Cookie attributes: `HttpOnly; Secure; SameSite=Lax; Path=/`. CSRF protection via double-submit token on state-changing endpoints.

Magic-link safety — single-use (consumed flag set atomically with session issuance), 15-minute TTL, token is a high-entropy random value stored hashed (`SHA-256`) so a DB leak doesn't expose live tokens. Rate-limit `/auth/signin/request` per email + per IP.

No passwords are ever stored. No `password_hash` column, no `password_resets` table. If a user can't sign in, they request a new magic link.

### Layer B — Domo OAuth linkage

| Operation | Endpoint | What happens |
|---|---|---|
| Start linking | `POST /auth/domo/link/start` | Body: `{ instanceUrl }`. BFF validates instanceUrl shape, generates PKCE `code_verifier` + `state`, stores them in Redis keyed by `state` (TTL 10m), returns the authorize URL to the SPA. |
| Authorize (browser leg) | Redirect to `{instance}/oauth2/authorize?...` | User signs into Domo (if needed), grants consent, Gatekeeper redirects to `huckleberry.com/auth/domo/callback?code=...&state=...`. |
| Callback | `GET /auth/domo/callback?code=...&state=...` | BFF looks up `code_verifier` from Redis, exchanges code at `{instance}/oauth2/token`, verifies the returned access token against the instance's JWKS, extracts `cid`, `sub`. Persists a `linked_domo_instances` row + encrypted `domo_oauth_tokens` row. Redirects user back to app. |
| Refresh (internal) | not user-facing | When the cached Domo access token is expired or missing, BFF calls `{instance}/oauth2/token` with `grant_type=refresh_token`, persists the new pair (rotation enforced — every refresh swaps both tokens), caches the new access token in Redis. |
| Unlink | `DELETE /auth/domo/link/:linkId` | Calls `{instance}/oauth2/revoke` for the refresh token. Deletes both rows. Subsequent Domo calls for that link fail. |
| List links | `GET /auth/domo/links` | Returns the user's linked instances with display metadata (customer slug, when linked, last used). |
| Switch active | `POST /auth/domo/switch` | Sets `activeLinkId` on the huckleberry session. The active link determines which instance subsequent Domo proxy calls target. |

### Per-request — putting it together

```
Browser            BFF                              Aurora / Redis            Gatekeeper           Domo API
   │                │                                       │                       │                  │
   │── GET /agents─▶│                                       │                       │                  │
   │   Cookie:      │  HuckleberryAuthGuard:                │                       │                  │
   │   hb_session   │  - verify cookie JWT signature        │                       │                  │
   │                │  - look up serverSessionId in Redis ──▶                       │                  │
   │                │  - reject if revoked                  │                       │                  │
   │                │  attach { huckleberryUserId, activeLinkId }                   │                  │
   │                │                                       │                       │                  │
   │                │  DomoAuthBroker.tokenFor(userId, linkId):                     │                  │
   │                │  - check Redis for cached access_token─▶                      │                  │
   │                │  - miss → read encrypted refresh from Aurora                  │                  │
   │                │  - decrypt via KMS                                            │                  │
   │                │  - POST /oauth2/token (refresh_token grant)──────────────────▶│                  │
   │                │                                       │   new access + new    │                  │
   │                │                                       │   refresh ◀───────────│                  │
   │                │  - upsert encrypted refresh in Aurora (rotation)              │                  │
   │                │  - cache new access in Redis                                  │                  │
   │                │                                       │                       │                  │
   │                │  DomoProxyService.get(/api/ai/v1/agents,                      │                  │
   │                │     targetHost=link.issuer, bearer=access)─────────────────────────────────────▶│
   │                │                                       │                       │   agents ◀───────│
   │   200 OK ◀─────│                                       │                       │                  │
```

## Scope mapping (unchanged at the catalog level)

Scopes still come from Gatekeeper's catalog (`{domain}[:{subdomain}]:{action}`), still split into:

- **Category A — Domo-proxied.** Scope is whatever the downstream Domo endpoint needs (`ai:read`, `ai:execute`, `dataset:meta:read`, etc.). Enforced server-side by Domo on the forwarded Bearer; the BFF doesn't need to check.
- **Category B — Huckleberry-owned (Aurora).** Scope is `huckleberry:access` (a huckleberry-internal authorization concept that lives in our `users` and `linked_domo_instances` rows, not Gatekeeper's catalog). Gated by the huckleberry session, not a JWT scope claim.

Scope enforcement for Category A happens entirely *downstream of the BFF* — Domo verifies the token it receives. The BFF doesn't need a `@Scopes('ai:read')` decorator on Category A routes; if the linked Domo account lacks the scope, Domo returns 403 and we surface it. We can still declare expected scopes inline for documentation, but they're not enforced by the BFF.

Category A routes still require **a valid linked Domo instance** with the active link selected.

The full per-route mapping (Huck route → Domo route → expected scope) from the earlier version still holds. The semantics change is just: scope enforcement moved from our guard to Domo.

## Multi-tenant + standalone — how customers are recognized

The huckleberry account is the primary user identity. The Domo customer is a property of the linked instance, not the user. So one huckleberry user can be linked to (`labs`, `customer1`, `customer2`) and switch among them.

- `users.id` — huckleberry user id (UUID, our namespace).
- `linked_domo_instances.user_id` — FK to `users`.
- `linked_domo_instances.issuer_url` — `https://customer.domo.com`, byte-matches the `iss` Gatekeeper signs.
- `linked_domo_instances.customer_id` — Gatekeeper's `cid` claim (`labs`, `cust1`, etc.).
- `linked_domo_instances.domo_sub` — the Domo `sub` from the token, the Domo-side user id within that instance.

Aurora row-level customer scoping for **huckleberry's own data** (personas, mcp_servers, future memory) uses `(huckleberry_user_id, customer_id)` as the partition. Because one huckleberry user can hold rows in two different customers (e.g., a persona configured against `labs` and a different persona against `customer1`), the index leads with both.

For defense in depth (per direction): primary keys on Category B tables are `(customer_id, huckleberry_user_id, id)`. Cross-tenant scope violations require failure of multiple checks simultaneously.

## Aurora schema (revised)

Tables:

```sql
users
  id                BINARY(16) PK                       -- huckleberry user id
  email             VARCHAR(255) NOT NULL UNIQUE
  email_verified    TINYINT(1) NOT NULL DEFAULT 0       -- set true on first successful magic-link consume
  display_name      VARCHAR(255)
  status            ENUM('pending_link','active','suspended') NOT NULL DEFAULT 'pending_link'
  created_at, updated_at, last_login_at
  INDEX (email)

magic_links
  token_hash        VARCHAR(64) PK                      -- SHA-256 of the random token (token itself never stored)
  user_id           BINARY(16) NOT NULL FK -> users(id)
  expires_at        DATETIME NOT NULL                   -- 15 minutes from issuance
  consumed_at       DATETIME NULL                       -- atomically set with session issuance
  ip_issued_from    VARCHAR(45)                         -- audit
  INDEX (user_id, expires_at)

linked_domo_instances
  id                BINARY(16) PK
  user_id           BINARY(16) NOT NULL FK -> users(id)
  issuer_url        VARCHAR(255) NOT NULL                -- byte-matches iss claim
  customer_id       VARCHAR(64) NOT NULL                 -- Gatekeeper cid claim
  domo_sub          VARCHAR(64) NOT NULL                 -- Gatekeeper sub claim
  scope             VARCHAR(1000) NOT NULL               -- granted scopes
  linked_at, last_used_at
  UNIQUE (user_id, issuer_url, domo_sub)
  INDEX (customer_id)

domo_oauth_tokens
  link_id           BINARY(16) PK FK -> linked_domo_instances(id)
  refresh_token     VARBINARY NOT NULL                   -- KMS envelope-encrypted
  refresh_iv        VARBINARY NOT NULL                   -- AES-GCM IV
  refresh_dek_id    VARCHAR(255) NOT NULL                -- KMS data-key reference
  expires_at        DATETIME NULL                        -- access-token expiry, nullable
  scope             VARCHAR(1000) NOT NULL
  updated_at

-- Category B tables (huckleberry-owned data, scoped to huckleberry user + customer)
personas
  customer_id           VARCHAR(64) NOT NULL
  user_id               BINARY(16) NOT NULL FK -> users(id)
  id                    BINARY(16)
  focus_areas           JSON
  is_default            TINYINT(1)
  created_at, updated_at
  PRIMARY KEY (customer_id, user_id, id)
  INDEX (customer_id, user_id, is_default)

mcp_servers
  customer_id           VARCHAR(64) NOT NULL
  user_id               BINARY(16) NOT NULL FK -> users(id)
  id                    BINARY(16)
  name, url, enabled, auth_type, ...
  PRIMARY KEY (customer_id, user_id, id)

mcp_oauth_tokens
  customer_id           VARCHAR(64) NOT NULL
  mcp_server_id         BINARY(16) NOT NULL FK -> mcp_servers(id)
  access_token          VARBINARY                        -- KMS envelope-encrypted
  refresh_token         VARBINARY                        -- KMS envelope-encrypted
  PRIMARY KEY (customer_id, mcp_server_id)
```

Token columns are envelope-encrypted: a KMS-wrapped data encryption key (DEK) is stored alongside the ciphertext (`refresh_dek_id`), the plaintext DEK is cached in-process for a short window, KMS is called only on cache miss. This keeps KMS call volume sane while making backup leaks unreadable without KMS access.

## Module shape (BFF code)

```
src/common/auth/
├── request-principal.ts              -- HuckleberryPrincipal: { userId, sessionId, activeLinkId, customerId? }
├── huckleberry-auth.guard.ts         -- Reads hb_session cookie, validates against Redis, attaches principal
├── public.decorator.ts               -- @Public() bypass
├── session.service.ts                -- Issue/revoke huckleberry sessions
├── csrf.guard.ts                     -- Double-submit token check on state-changing routes
└── domo-auth-broker/
    ├── jwks.service.ts               -- Existing — verifies Gatekeeper tokens internally
    ├── known-tenants.service.ts      -- Existing — issuer allowlist for linkage targets
    ├── gatekeeper-auth.guard.ts      -- Internal verifier — checks tokens during callback / refresh
    ├── domo-auth-broker.service.ts   -- tokenFor(userId, linkId) -> Bearer; refresh on demand
    ├── domo-token-store.service.ts   -- Aurora R/W with KMS envelope encryption
    └── domo-oauth-client.service.ts  -- buildAuthorizeUrl / exchangeCode / refresh / revoke against Gatekeeper

src/auth/                             -- new
├── auth.controller.ts                -- /auth/signin/request, /auth/signin, /auth/logout, /auth/me
├── auth.service.ts                   -- magic-link issue + atomic consume + session issuance
├── domo-link.controller.ts           -- /auth/domo/link/start, /callback, /links, /switch, /:id (DELETE)
└── domo-link.service.ts              -- Drives DomoAuthBroker for link CRUD

src/email/                            -- new
└── email.service.ts                  -- SES from day 1
```

`DomoProxyService` keeps its existing `targetHost` + `bearer` per-request options. Every Category A service call:

```ts
const link = await this.domoLink.activeLinkFor(req.user.userId);
const bearer = await this.domoAuthBroker.tokenFor(link.id);
return this.domoProxy.get('/api/ai/v1/agents', {
  targetHost: link.issuerUrl,
  bearer,
});
```

## Aurora connection auth (unchanged)

Everything we documented before — IAM database auth via the ECS task role, no long-lived DB password, TLS required, least-privilege DB user, `TenantBoundConnection` factory that refuses to acquire a connection without a validated `customer_id` — still applies. The Aurora-side auth story is orthogonal to the user-side identity story.

The one nuance: when a huckleberry user has linked multiple Domo customers, a single huckleberry request only ever touches *one* `customer_id` (the active link). `TenantBoundConnection` is acquired with that customer_id and `SET @huckleberry_customer_id = ?` accordingly. Switching the active link mid-session is a new HTTP request and gets its own bound connection.

## MVP decisions (locked)

These are settled. Anything not on this list is post-MVP.

| # | Decision | Rationale |
|---|---|---|
| 1 | **Magic-link sign-in only.** No password. | Removes password storage, hashing parameters, breach monitoring, and reset flow. Sign-in = "click the link we emailed you" → session cookie. |
| 2 | **No MFA.** | Internal demo audience. MFA is required before external launch; schema slot kept. |
| 3 | **12h sliding session.** HS256-signed JWT in `HttpOnly; Secure; SameSite=Lax` cookie. Redis-backed `sid` for instant revocation. | Sliding TTL gives "stay logged in while working" without long-lived bearer-equivalent. |
| 4 | **Double-submit CSRF token** on all state-changing routes. | SameSite=Lax leaks on top-level GET; double-submit is the standard belt-and-suspenders. |
| 5 | **AWS SES from day 1**, sandbox mode acceptable for internal demo. | Domain verification before external launch. |
| 6 | **One linked Domo instance per huckleberry user.** | Vetted onboarding sets the instance; users don't switch. Multi-link is post-MVP. |
| 7 | **Vetted onboarding creates the Domo instance and seeds the user.** No self-service signup, no instance picker. See "Onboarding flow" below. | Cleanest path to a real demo. The instance question is answered at vetting time, not at runtime. |

### Onboarding flow — freemium auto-provisioning

Self-service signup is the default; an operator-driven path (`POST /api/admin/users`) is also exposed for pilots / internal onboarding.

The user enters their email at `/login`. The BFF:

1. **Looks up the user.** If found, jumps to step 4 (send magic-link).
2. **Calls the `InstanceProvisioner`** to mint a Domo tenant. In dev this is `DevStubInstanceProvisioner` — returns the pre-registered `DEV_INSTANCE_*` credentials for the shared dev instance, no real tenant created. In prod this calls Domo's freemium-provisioning API and gets back fresh `client_id` + `client_secret` for a new tenant.
3. **Inserts** `users` row + `linked_domo_instances` row holding the provisioned `client_credentials` pair. The link's `linkType` is `client_credentials`. User status flips directly to `'active'` — no `pending_link` intermediate, no browser → Domo handoff.
4. **Emails a magic-link.** User clicks → huckleberry verifies → session cookie set → SPA renders. `AuthGuard` sees `active` user with a link, just lets the app load.

Per-request data flow after sign-in:

- SPA hits any Category A endpoint.
- BFF resolves the user's active link, asks `DomoAuthBroker` for a bearer.
- Broker calls Gatekeeper `/oauth2/token` with `grant_type=client_credentials` using the link's stored credentials. Mints a fresh access token, caches it (TTL = `expires_in - 60s`). Single-flight semantics on concurrent requests.
- BFF forwards the call to Domo with that bearer.

No `pending_link`. No `/auth/domo/link/start` handoff. No browser visit to Domo. No user-side consent screen.

### Three-credential security model

The provisioning flow looks scary at first glance ("the BFF is admin?"). It isn't, if the three credentials are kept in different blast-radius buckets:

| # | Credential | Power | Storage | When used |
|---|---|---|---|---|
| 1 | **Provisioner credential** | Mints Domo instances + the OAuth client on each new instance. Held by huckleberry-the-service. | Env (today) → AWS Secrets Manager (later). Single value, rotatable. | Once per signup. Never at runtime. |
| 2 | **Per-customer service credential** (`client_credentials` `client_id` + `client_secret`) | Only data-read scopes (`ai:read`, `ai:execute`, `dataset:data:read`, `identity:read`). No admin, no `user.invite`, no `gateway.oauth.client.create`, no `user.impersonate`. | Aurora row in `linked_domo_instances` (KMS-encrypted at rest when Aurora wiring lands). One pair per customer. | Every runtime Domo call |
| 3 | **Huckleberry session cookie** (`hb_session`) | SPA features only. No Domo authority. | HttpOnly cookie + Redis-backed `sid`. | Per request |

Compromise impact:

- **#1 leaked** → attacker can create freemium instances under our name. Bad but recoverable: rotate the provisioner credential, audit the new-instance log, delete fraudulent tenants.
- **#2 leaked** (single row or whole DB) → attacker reads one or all customers' Domo data within the scope set. Cannot escalate, write, create users, or impersonate. Customer can revoke any time by deleting the client from their Domo instance.
- **#3 leaked** → attacker is *one* huckleberry user. They see the same Domo data every signed-in user of that customer sees (the service token's scope), nothing more.

The BFF never holds Domo admin authority at runtime. The provisioning credential is the only "powerful" thing it has, and it's used only at signup time, not on every request.

### Per-user identity (deferred)

The `client_credentials` model gives the BFF a token that represents **the service**, not the human signed in. From Domo's perspective every call is "huckleberry-the-service asking on this customer's tenant" — every huckleberry user sees the same Domo-side data within the service's scope. Per-user filtering happens in huckleberry (sessions, personas, agent history, etc.) — not in Domo.

If/when real per-user Domo identity is needed:

- **Best:** per-user `authorization_code` OAuth flow. Each user visits Domo once, consents, BFF stores their refresh token. After that the BFF holds the user's refresh token and the broker rotates it on every refresh. Today the code path exists but is blocked by a DomoWeb redirect quirk; revisit when that's fixed.
- **Avoid:** service token with `user.impersonate` authority + per-request `X-Domo-User-Id` header. Sharp tool, large blast radius. Don't ship this without a strong reason.

The code is shaped to support both link types side-by-side: `LinkedDomoInstance.linkType` is either `'authorization_code'` or `'client_credentials'`, and `DomoAuthBroker.refresh` dispatches on it. Adding the auth-code path back later is mechanical.

### Operator endpoint (`POST /api/admin/users`)

Still exists for pilot / internal onboarding where you don't want self-service. Same body shape as the signup endpoint, plus `displayName` and an optional `customerHint` (informational — the stub provisioner ignores it; a real one might use it). Gated by `ADMIN_API_KEY` header.

### Schema implication

`linked_domo_instances` is the source of truth for "what instance does this user belong to." One row per user (single-link at MVP). Fields: `userId`, `issuerUrl`, `customerId`, `linkType`, `oauthClientId`, `oauthClientSecret` (KMS-encrypted in prod). The associated `domo_oauth_tokens` row is null/unused for `client_credentials` links (no refresh token to store).

### Out of scope

- **Scope gating on Category B routes.** Inbound auth is the session cookie; no per-route scope check.
- **Password reset flow.** Magic-link only; lost emails just resend.
- **SSO providers (Google, Microsoft, etc.).** Post-MVP.
- **Instance picker at runtime.** Each huckleberry user has one linked instance, assigned at signup.
