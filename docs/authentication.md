# Huckleberry Authentication

## What we're doing (the layman version)

Huckleberry is a **standalone SaaS product** at `huckleberry.ai`. It's not embedded in Domo, doesn't run on a Domo subdomain, and a user visiting huckleberry has no existing Domo session to lean on.

That means we own the front-door identity. Users sign up to huckleberry with their own credential. After they're signed in, they **link one or more Domo instances** to their huckleberry account via OAuth. Huckleberry then talks to Domo on the user's behalf using the linked credential.

Two separate auth layers, never confused:

1. **Layer A — Huckleberry identity.** Magic-link sign-in only — no passwords. A users table, single-use email tokens, HttpOnly session cookies. This is the lock on huckleberry's front door. Self-service sign-up provisions a Domo instance + user via `InstanceProvisioner` and emails the magic-link; sign-in is a separate endpoint that only emails existing users.
2. **Layer B — Domo OAuth linkage** (per-instance, per-user). Standard OAuth 2.1 authorization-code + PKCE against `https://{customer}.domo.com/oauth2/authorize`. The BFF is a **public PKCE client** (`token_endpoint_auth_method=none`) — no `client_secret`. PKCE is the proof-of-possession. The code-exchange runs server-side, and the user's Domo refresh token is stored encrypted in Aurora and rotated on every use per OAuth 2.1.

A user can link N Domo instances under one huckleberry account. The active instance is part of the user's session state and can be switched without re-authing.

## Why this model

Standalone huckleberry.ai has no ambient Domo session, the SPA can't run a silent re-OAuth on every page load, and we need a stable huckleberry identity that survives Domo session expiries. So:

- **BFF as public PKCE OAuth client** — server-side `/auth/domo/*` endpoints, no `client_secret` to store, encrypted refresh-token storage in Aurora.
- **A `users` table and a server-issued huckleberry session** — magic-link sign-in, HttpOnly cookie, sliding TTL.
- **The PKCE `code_verifier` lives only inside the BFF.** It's stored in the request-scoped `OAuthStateStore` keyed by `state`, exchanged server-side at the callback, then dropped. The SPA hands the user off to Gatekeeper but never sees the verifier or any token.
- **Multi-tenant.** One huckleberry deployment, many customers. `customer_id`-scoped Aurora rows. `GatekeeperAuthGuard` and `JwksService` verify Gatekeeper-issued tokens _internally_ when the BFF processes a Domo OAuth callback or refreshes a token — not as a front-door verifier.

## Two-layer flow (the full picture)

```
1. Sign up / sign in to huckleberry.ai (Layer A)
2. Link a Domo instance via OAuth (Layer B)
3. Use the app — BFF mints fresh Domo tokens on demand from stored refresh tokens
4. Refresh huckleberry session as needed (Layer A)
5. Sign out of huckleberry — local session cleared; Domo linkage persists for next time
```

### Layer A — Huckleberry identity (magic-link only)

| Operation                      | Endpoint                     | What happens                                                                                                                                                                                                                                                                      |
| ------------------------------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request sign-in link           | `POST /auth/signin/request`  | Body: `{ email }`. Looks up `users` by email. If found and `email_verified`, inserts a `magic_links` row (`user_id`, single-use `token_hash`, 15m TTL), sends an email with the link. Always returns `202` regardless of whether the email exists (don't leak account existence). |
| Consume sign-in link           | `GET /auth/signin?token=...` | Validates `token_hash` is unconsumed and unexpired, marks consumed, issues huckleberry session cookie. 302 to `/app` or to forced-OAuth if linkage is not yet completed.                                                                                                          |
| Sign out                       | `POST /auth/logout`          | Invalidates session in Redis; clears cookie.                                                                                                                                                                                                                                      |
| Me                             | `GET /auth/me`               | Returns the current user + linkage state (`pending_link` vs `active`).                                                                                                                                                                                                            |
| Verify email (operator-issued) | `GET /auth/verify?token=...` | Set during onboarding when the operator creates the user row. Marks `email_verified=1`. The very first magic-link email serves as both verification and first sign-in.                                                                                                            |

Session shape — `hb_session` cookie carries an HS256-signed JWT with `{ sub: huckleberryUserId, iat, exp, sid: serverSessionId }`. Signing key in AWS Secrets Manager, rotated periodically. Server session in Redis (`sid → { userId, expiresAt }`) allows immediate revocation. Cookie attributes: `HttpOnly; Secure; SameSite=Lax; Path=/`. CSRF protection via double-submit token on state-changing endpoints.

Magic-link safety — single-use (consumed flag set atomically with session issuance), 15-minute TTL, token is a high-entropy random value stored hashed (`SHA-256`) so a DB leak doesn't expose live tokens. Rate-limit `/auth/signin/request` per email + per IP.

No passwords are ever stored. No `password_hash` column, no `password_resets` table. If a user can't sign in, they request a new magic link.

### Layer B — Domo OAuth linkage

| Operation               | Endpoint                                      | What happens                                                                                                                                                                                                                                                                         |
| ----------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Start linking           | `POST /auth/domo/link/start`                  | Body: `{ instanceUrl }`. BFF validates instanceUrl shape, generates PKCE `code_verifier` + `state`, stores them in Redis keyed by `state` (TTL 10m), returns the authorize URL to the SPA.                                                                                           |
| Authorize (browser leg) | Redirect to `{instance}/oauth2/authorize?...` | User signs into Domo (if needed), grants consent, Gatekeeper redirects to `huckleberry.ai/auth/domo/callback?code=...&state=...`.                                                                                                                                                    |
| Callback                | `GET /auth/domo/callback?code=...&state=...`  | BFF looks up `code_verifier` from Redis, exchanges code at `{instance}/oauth2/token`, verifies the returned access token against the instance's JWKS, extracts `cid`, `sub`. Persists a `linked_domo_instances` row + encrypted `domo_oauth_tokens` row. Redirects user back to app. |
| Refresh (internal)      | not user-facing                               | When the cached Domo access token is expired or missing, BFF calls `{instance}/oauth2/token` with `grant_type=refresh_token`, persists the new pair (rotation enforced — every refresh swaps both tokens), caches the new access token in Redis.                                     |
| Unlink                  | `DELETE /auth/domo/link/:linkId`              | Calls `{instance}/oauth2/revoke` for the refresh token. Deletes both rows. Subsequent Domo calls for that link fail.                                                                                                                                                                 |
| List links              | `GET /auth/domo/links`                        | Returns the user's linked instances with display metadata (customer slug, when linked, last used).                                                                                                                                                                                   |
| Switch active           | `POST /auth/domo/switch`                      | Sets `activeLinkId` on the huckleberry session. The active link determines which instance subsequent Domo proxy calls target.                                                                                                                                                        |

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

Scope enforcement for Category A happens entirely _downstream of the BFF_ — Domo verifies the token it receives. The BFF doesn't need a `@Scopes('ai:read')` decorator on Category A routes; if the linked Domo account lacks the scope, Domo returns 403 and we surface it. We can still declare expected scopes inline for documentation, but they're not enforced by the BFF.

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

The one nuance: when a huckleberry user has linked multiple Domo customers, a single huckleberry request only ever touches _one_ `customer_id` (the active link). `TenantBoundConnection` is acquired with that customer_id and `SET @huckleberry_customer_id = ?` accordingly. Switching the active link mid-session is a new HTTP request and gets its own bound connection.

## MVP decisions (locked)

These are settled. Anything not on this list is post-MVP.

| #   | Decision                                                                                                                                    | Rationale                                                                                                                                    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Magic-link sign-in only.** No password.                                                                                                   | Removes password storage, hashing parameters, breach monitoring, and reset flow. Sign-in = "click the link we emailed you" → session cookie. |
| 2   | **No MFA.**                                                                                                                                 | Internal demo audience. MFA is required before external launch; schema slot kept.                                                            |
| 3   | **12h sliding session.** HS256-signed JWT in `HttpOnly; Secure; SameSite=Lax` cookie. Redis-backed `sid` for instant revocation.            | Sliding TTL gives "stay logged in while working" without long-lived bearer-equivalent.                                                       |
| 4   | **Double-submit CSRF token** on all state-changing routes.                                                                                  | SameSite=Lax leaks on top-level GET; double-submit is the standard belt-and-suspenders.                                                      |
| 5   | **AWS SES from day 1**, sandbox mode acceptable for internal demo.                                                                          | Domain verification before external launch.                                                                                                  |
| 6   | **One linked Domo instance per huckleberry user.**                                                                                          | Vetted onboarding sets the instance; users don't switch. Multi-link is post-MVP.                                                             |
| 7   | **Self-service sign-up provisions the Domo instance; sign-in is existing-users-only.** Two distinct endpoints. See "Onboarding flow" below. | Distinct paths because they have different access requirements: sign-up has to call the InstanceProvisioner; sign-in must not.               |

### Onboarding flow — sign-up + PKCE-on-first-signin

Two distinct endpoints:

- **`POST /api/auth/signup`** — provisions the Domo instance + user, seeds the huckleberry account in `pending_link`, emails the magic-link.
- **`POST /api/auth/signin/request`** — existing users only; emails a magic-link if the email matches a row, silently no-ops otherwise. Always 202 (existence-oracle protection).
- **`POST /api/admin/users`** — operator-driven variant of sign-up (same shape, gated by `ADMIN_API_KEY`). Used for pilot / internal onboarding.

Sign-up flow:

1. User enters email at `/login?mode=signup` (or hits the "Try for free" header button → same route).
2. BFF calls `SignupService.ensureUser()`:
   - **`InstanceProvisioner.provision(email)`** mints a Domo instance + user. In dev this is `DevStubInstanceProvisioner` — returns the configured `DEV_INSTANCE_*` metadata for the shared dev instance, no real tenant created, no Domo credentials held. In prod this calls Domo's freemium-provisioning API.
   - Inserts a `users` row with `status = 'pending_link'`.
   - Inserts a `linked_domo_instances` row holding `issuerUrl`, `customerId`, `scope` — no `domoSub`, no refresh token. This is a placeholder until the PKCE flow completes.
3. Emails the magic-link.
4. User clicks → magic-link consumed → `hb_session` + `csrf_token` cookies set → SPA's `AuthGuard` sees `status === 'pending_link'` → calls `POST /api/auth/domo/link/start` → BFF generates PKCE pair and `state`, stores them in `OAuthStateStore`, returns the authorize URL.
5. SPA redirects browser to `https://{customer}.domo.com/oauth2/authorize?...&code_challenge=...&state=...`.
6. Domo authenticates the user (login screen if no Domo session), Gatekeeper redirects to `/api/auth/domo/callback?code=...&state=...`.
7. BFF: consumes `state` (matches sessioned `userId`), retrieves the matching `code_verifier`, posts `/oauth2/token` (`grant_type=authorization_code`, no `client_secret`), receives access + refresh tokens, verifies the access token via JWKS, persists the refresh token, flips user `status` to `'active'`, redirects to `/workspace?linked=1`.

Per-request data flow after sign-in:

- SPA hits any Category A endpoint with the session cookie.
- `DomoAuthGuard` verifies the session, attaches the `HuckleberryPrincipal` to `req.user`.
- `DomoContextInterceptor` (global `APP_INTERCEPTOR`) resolves the user's active link, asks `DomoAuthBroker` for a bearer (cache hit, or refresh via `grant_type=refresh_token` — rotated atomically per OAuth 2.1), and binds the bearer + `targetHost` into an `AsyncLocalStorage` context for the rest of the request's async tree.
- Each Category A service calls `DomoProxyService.get/post/...` without passing `bearer` or `targetHost`; the proxy reads them from the ALS context.
- BFF forwards the call to Domo with the user's bearer.

### Two-credential security model

The huckleberry side holds two credentials per session, plus an optional one-shot provisioner credential:

| #   | Credential                                    | Power                                                                                                                        | Storage                                                                                                                 | When used                                                           |
| --- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | **Provisioner credential**                    | Mints Domo instances. Held by huckleberry-the-service, never by users.                                                       | Env (today) → AWS Secrets Manager (later). Single value, rotatable.                                                     | Once per sign-up. Never at runtime.                                 |
| 2   | **Per-user Domo refresh token**               | Lets the BFF mint short-lived access tokens that act _as the user_ on Domo. Token's scopes are the union granted at consent. | Aurora row in `domo_oauth_tokens` (KMS-encrypted at rest when Aurora wiring lands). One per user. Rotated on every use. | Every runtime Domo call (broker mints a fresh access token off it). |
| 3   | **Huckleberry session cookie** (`hb_session`) | SPA features only. No Domo authority.                                                                                        | HttpOnly cookie + Redis-backed `sid`.                                                                                   | Per request                                                         |

Compromise impact:

- **#1 leaked** → attacker can create freemium instances under our name. Bad but recoverable: rotate the provisioner credential, audit the new-instance log, delete fraudulent tenants.
- **#2 leaked** (single row) → attacker can act as **that one user** on Domo within the granted scope set. Customer/user can revoke any time by signing out of Domo or having Gatekeeper revoke the refresh token. Rotation on every refresh means a stolen token gets cascade-revoked the next time the legitimate user signs in.
- **#3 leaked** → attacker is _one_ huckleberry user. Per-user revocation via session-id lookup; no Domo authority.

The BFF never holds Domo admin authority at runtime. The provisioning credential is the only "powerful" thing it has, and it's used only at sign-up time, not on every request.

### Per-user identity

Each Domo bearer represents the **actual signed-in user**, not the service. From Domo's perspective every call is "user X, acting via huckleberry, asking on this tenant" — Domo's per-resource access controls apply natively (sharing, row-level filters, audit log). No `user.impersonate` authority required, no per-request `X-Domo-User-Id` header, no service-token model.

### Operator endpoint (`POST /api/admin/users`)

Same shape as sign-up plus `displayName`; gated by `ADMIN_API_KEY` header. Useful for pilots / internal onboarding without exposing a public sign-up form.

### Schema implication

`linked_domo_instances` holds the per-user instance binding: `userId`, `issuerUrl`, `customerId`, `domoSub` (Domo user id), `scope`, `linkedAt`, `lastUsedAt`. Refresh token + scope live in the separate `domo_oauth_tokens` table (one row per link) so rotation writes don't churn the link record.

### Out of scope

- **Scope gating on Category B routes.** Inbound auth is the session cookie; no per-route scope check.
- **Password reset flow.** Magic-link only; lost emails just resend.
- **SSO providers (Google, Microsoft, etc.).** Post-MVP.
- **Instance picker at runtime.** Each huckleberry user has one linked instance, assigned at signup.
