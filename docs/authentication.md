# Huckleberry Authentication

## What we're doing (the layman version)

Huckleberry is a **standalone SaaS product** at `huckleberry.com`. It's not embedded in Domo, doesn't run on a Domo subdomain, and a user visiting huckleberry has no existing Domo session to lean on.

That means we own the front-door identity. Users sign up to huckleberry with their own credential. After they're signed in, they **link one or more Domo instances** to their huckleberry account via OAuth. Huckleberry then talks to Domo on the user's behalf using the linked credential.

Two separate auth layers, never confused:

1. **Layer A — Huckleberry identity.** Magic-link sign-in only — no passwords. A users table, single-use email tokens, HttpOnly session cookies. This is the lock on huckleberry's front door. (Self-service signup is not exposed; users are seeded via vetted operator tooling — see "Onboarding flow" below.)
2. **Layer B — Domo OAuth linkage** (per-instance, per-user). Standard OAuth 2.1 authorization-code + PKCE against `https://{customer}.domo.com/oauth2/authorize`. We are a **confidential OAuth client** with Gatekeeper — the BFF holds the `client_secret`, runs the code-exchange server-side, and stores the user's Domo refresh token encrypted in Aurora. When the BFF needs to call Domo on the user's behalf, it pulls a fresh access token from the refresh and forwards it.

A user can link N Domo instances under one huckleberry account. The active instance is part of the user's session state and can be switched without re-authing.

## Why this model, and what was retired

The earlier design assumed huckleberry runs inside Domo (`customer.domo.com/huckleberry`) so the user's existing Domo session was already there. Under that assumption the frontend itself could be the OAuth client, the BFF could be stateless, and tokens never touched the server.

Standalone huckleberry.com breaks all three assumptions. There is no ambient Domo session, the SPA can't run a silent re-OAuth on every page load, and we need a stable huckleberry identity that survives Domo session expiries. So:

- **Restored:** BFF as confidential OAuth client (server-side `/auth/domo/*` endpoints, `client_secret` in AWS Secrets Manager, encrypted token storage in Aurora).
- **Restored:** A `users` table and a server-issued huckleberry session.
- **Retired (again):** Frontend-as-OAuth-client model. The SPA never sees Gatekeeper tokens.
- **Kept:** Multi-tenant. One huckleberry deployment, many customers. `customer_id`-scoped Aurora rows. `GatekeeperAuthGuard` and `JwksService` are kept but their role shifts: instead of guarding *inbound* huckleberry traffic, they verify Gatekeeper-issued tokens *internally* when the BFF processes a Domo OAuth callback or refreshes a token. The job is the same code, just moved one hop inward.

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

What changes from the earlier doc: scope enforcement for Category A now happens entirely *downstream of the BFF* (Domo verifies the token it receives). The BFF doesn't need a `@Scopes('ai:read')` decorator on Category A routes — if the linked Domo account lacks the scope, Domo returns 403 and we surface it. We can still declare expected scopes for documentation, but they're not enforced inline.

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

New tables compared to the earlier draft:

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
    ├── gatekeeper-auth.guard.ts      -- KEPT but no longer the front door — used to verify tokens during callback / refresh
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

### Onboarding flow (decision 7 expanded)

There is no public signup form. Customer admins request access out-of-band (sales/support). An internal operator runs onboarding tooling that:

1. **Provisions the Domo instance** via existing Domo provisioning (not our concern; captures the resulting `issuer_url`, e.g. `https://newcust.domo.com`, and `customer_id` from the response).
2. **Inserts the huckleberry `users` row** with email + the captured `issuer_url`. The user is created in the `pending_link` state — they have an identity but no functioning Domo connection yet.
3. **Inserts a `linked_domo_instances` stub** (`user_id`, `issuer_url`, `customer_id`) with no associated `domo_oauth_tokens` row. The link exists in the database but is not yet usable.
4. **Sends the magic-link onboarding email** to the customer admin.

The customer admin then:

5. **Clicks the magic-link** → huckleberry verifies, issues a session, lands them in the app.
6. **First page is a forced OAuth handoff** to `{issuer_url}/oauth2/authorize` (no UI picker — we already know the instance from the row created in step 3).
7. After Gatekeeper callback, the `domo_oauth_tokens` row is populated. User state moves from `pending_link` to `active`.

After step 7, the link is complete and standard per-request flow applies. The user cannot change their linked instance — it's pinned at row creation and immutable from the user's perspective. (Operator can re-link via admin tooling if needed.)

Schema implication: the `linked_domo_instances` table is the source of truth for "what instance does this user belong to." There is at most one row per user at MVP. The `users` table doesn't carry an `instance_url` column — it would duplicate state. Joining is cheap and keeps single-link / multi-link symmetric in the code.

### What was removed from the open-questions list

- **`huckleberry:access` scope** — retired. Inbound auth is the session cookie; no scope gating on Category B routes.
- **Password reset flow / `password_resets` table** — gone with decision 1. If a magic-link email is lost, we resend.
- **SSO providers** — post-MVP, not built.
- **Instance picker / runtime instance selection** — gone with decision 7. There is no "which instance?" question at runtime.
