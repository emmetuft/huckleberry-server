# Domo OAuth Flow (Authorization Code + PKCE via Heimdall)

Huckleberry registers as an OAuth2 client in **Heimdall** — Domo's internal OAuth2 authorization server. Heimdall maintains a registry of approved clients with this shape (per `oauth2/client.go`):

```go
type Client struct {
    ID                 string
    Secret             []string   // list to allow rotation
    Name               string
    Internal           bool
    Confidential       bool
    RequireStopScreens bool
    RedirectURIs       []string
}
```

Server-side authorization code flow. Huckleberry's NestJS backend is a **confidential client** — `client_secret` lives in Secrets Manager and never leaves the server. PKCE is layered on as defense-in-depth (binds the code to the originating session so a stolen code can't be redeemed).

## Heimdall client registration

Add Huckleberry to Heimdall's `preApprovedClients` list. Proposed registration:

| Field | Value | Why |
|---|---|---|
| `ID` | `domo:internal:huckleberry` | Matches `domo:internal:*` convention for first-party apps |
| `Secret` | UUID issued by Heimdall, stored in AWS Secrets Manager | `[]string` shape lets Heimdall rotate by appending a new secret then removing the old |
| `Name` | `Huckleberry` | Display name on consent / stop screens |
| `Internal` | `true` | Domo-built, internal-use |
| `Confidential` | `true` | NestJS backend can hold a secret; not a public client |
| `RequireStopScreens` | `true` | Matches precedent for confidential server apps (Workbench, ARC, Coursebuilder) |
| `RedirectURIs` | `http://localhost:3000/auth/callback`, `https://huckleberry-staging.<domain>/auth/callback`, `https://huckleberry.<domain>/auth/callback` | Dev, staging, prod callbacks |

## Sequence

```mermaid
sequenceDiagram
    autonumber
    participant U as User Browser
    participant BFF as Huckleberry BFF
    participant R as Redis
    participant DB as Aurora MySQL
    participant SM as Secrets Manager
    participant H as Heimdall
    participant D as Domo Instance APIs

    U->>BFF: GET /auth/login
    BFF->>BFF: generate state and code_verifier<br/>code_challenge is S256 of code_verifier
    BFF->>R: store state with code_verifier, returnTo (TTL 10m)
    BFF-->>U: 302 to Heimdall /api/oauth2/authorize<br/>params: client_id, redirect_uri, state,<br/>scope, code_challenge

    U->>H: follows redirect, logs in
    H-->>U: consent screen (RequireStopScreens true)
    U->>H: approve
    H-->>U: 302 to BFF /auth/callback with code and state

    U->>BFF: GET /auth/callback with code and state
    BFF->>R: lookup state, get code_verifier
    R-->>BFF: code_verifier (or 400 if missing or expired)
    BFF->>SM: get Heimdall client_secret
    SM-->>BFF: client_secret

    BFF->>H: POST /api/oauth2/token<br/>grant_type authorization_code<br/>plus code, redirect_uri, client_id,<br/>client_secret, code_verifier
    H-->>BFF: RS256 JWT access_token (1h),<br/>refresh_token (2y), expires_in

    BFF->>BFF: decode JWT claims sub, cid, iid
    BFF->>D: GET /api/content/v3/users/me<br/>with Bearer access_token
    D-->>BFF: domo_user_id, email, displayName

    BFF->>DB: upsert users with domo_user_id, email, instance
    BFF->>DB: upsert domo_sessions<br/>encrypted access and refresh, expires_at
    BFF->>BFF: issue Huckleberry session JWT
    BFF->>R: store hb_session and user_id (TTL is session lifetime)
    BFF-->>U: 302 to returnTo + hb_session cookie<br/>(HttpOnly, Secure, SameSite Lax)

    Note over U,D: subsequent API calls
    U->>BFF: GET /api/agents with cookie
    BFF->>R: validate hb_session, get user_id
    BFF->>R: get cached access_token for user
    alt token expired or missing
        BFF->>DB: load domo_sessions
        BFF->>H: POST /api/oauth2/token<br/>grant_type refresh_token
        H-->>BFF: new access_token<br/>(refresh_token reused, no rotation)
        BFF->>DB: update domo_sessions access_token and expires_at
        BFF->>R: cache access_token (TTL under expires_in)
    end
    BFF->>D: Domo API call with Bearer access_token
    D-->>BFF: response
    BFF-->>U: response
```

## Why this flow

- **Authorization code with confidential client** — backend keeps `client_secret`, tokens never touch the browser
- **PKCE included as forward-compat** — Heimdall accepts but doesn't enforce today; harmless to send
- **`state` parameter** — CSRF protection on the callback; also doubles as the lookup key for the per-flow `code_verifier`
- **Tokens encrypted at rest** — KMS-backed envelope encryption on `domo_sessions.access_token` / `refresh_token`
- **Redis as token cache** — avoids a DB read on every Domo API call; falls back to DB on miss
- **Single client registration** — Huckleberry is one app talking to one Heimdall (Domo's auth server), not per-instance. `instance` is a property of the user, not the OAuth client

## Heimdall facts (confirmed against `~/dev/heimdall`)

### Endpoints
| Purpose | Path | File |
|---|---|---|
| Authorization | `/api/oauth2/authorize` | `main.go:148` |
| Token | `/api/oauth2/token` | `main.go:149` |
| Revocation (RFC 7009) | `/api/oauth2/revoke` | `main.go:150` |
| Introspection (RFC 7662) | `/api/oauth2/introspect` | `main.go:151` |
| Userinfo (Gatekeeper only) | `/userinfo` (proxied) | `route_product.go:196` |
| Discovery | `/.well-known/*` (proxied to Gatekeeper, allowlisted customers only) | `route_product.go:195` |

### Tokens
- **Format**: RS256-signed JWTs (`jwt.go:201-233`); decodable for claims (`jti`, `sub`, `aud`, `exp`, `scope`, `cid`, `iid`, `sid`)
- **Access token TTL**: **1 hour** (`jwt.go:217`)
- **Refresh token TTL**: **2 years**, no rotation — same `RefreshTokenID` reused on refresh (`token_refresh.go:119-120`)
- **Authorization code TTL**: 10 minutes

### PKCE
- `code_challenge` and `code_challenge_method` are **accepted on `/authorize` but NOT validated on `/token`** (`token_auth_code.go` has no `code_verifier` reference)
- **Effectively unenforced today.** Send the params for forward-compat, but don't rely on them as a security control. Confidential client + `client_secret` is the actual protection
- Track upstream Heimdall work to enforce; remove the workaround once enforced

### Scopes that cover Huckleberry's API needs
| Endpoint Huckleberry calls | Scope to request |
|---|---|
| `/api/ai/v1/*` (agents, sessions, text, toolkits) | `ai-services` |
| `/api/recall/v1/*` (graph nodes) | `ai-services` (proxied through `/api/ai/`) |
| `/api/content/v3/*` (users, groups) | `content` (or narrow `user`) |
| `/api/content/v3/users/me` | `user-profile` (narrow read of self) |
| `/api/identity/v1/*` | `identity` (or `content`) |
| `/api/data/v3/*` (datasources) | `data` |

**Recommended scope set for Huckleberry:** `ai-services content data user-profile`. Avoid `user` / `identity` unless we actually mutate users.

### Bearer token works directly against instance APIs
Confirmed. `authenticator.go:18-81` validates the RS256 JWT on `Authorization: Bearer ...` and `scope.go:61-214` enforces scope-vs-path. **Drop `x-domo-developer-token` / `x-domo-eps-auth-token` from DomoProxy** once Huckleberry is wired up — replace with `Authorization: Bearer <heimdall_jwt>`.

### Identity propagation
No legacy userinfo endpoint. Two options:
1. **Decode JWT claims** — `sub` is the user ID, `cid` is customer, `iid` is instance. Cheap. No network call.
2. **Call `/api/content/v3/users/me`** with `user-profile` scope to get email + display name. Do this once at login, persist on `users` row.

Use both: claims for fast per-request identity, `/users/me` once at login for profile data.

### Client registration
Static `preApprovedClients` list in `oauth2/client.go`. Adding Huckleberry = PR to Heimdall. Code comment flags this as "should be configurable" but no managed surface exists yet. Plan to PR the entry above.

### Flag semantics confirmed
| Flag | Effect |
|---|---|
| `Confidential=true` | Token endpoint requires `client_secret` (`token_auth_code.go:39-55`) |
| `Internal=true` + `RequireStopScreens=false` | Skips consent screen, grants scopes silently (`authorize.go:164-165`) |
| `RequireStopScreens=true` | Always show consent screen even for internal clients (`authorize.go:202`) |

Huckleberry: `Confidential=true, Internal=true, RequireStopScreens=true` — match Workbench/CLI precedent. Yes, users see a consent screen the first time; that's correct for a server-side app handling tokens.

## Implementation implications

1. **Drop the `DomoAuthProvider` swappable seam.** No `domoweb` fallback needed — Heimdall covers the real flow. Single provider implementation.
2. **Drop `oauth-flow-future.md` framing.** This *is* the flow.
3. **Refresh logic**: Heimdall reuses the underlying refresh_token ID today; even so, **always overwrite `domo_sessions.refresh_token` from the response** (cheap insurance for when Heimdall ships rotation — see readiness section).
4. **Schema**: `oauth_tokens.refresh_token` is now always populated (no NULL case). Drop the "nullable under domoweb" annotation.
5. **No PKCE enforcement** today — send params, don't rely on them. `client_secret` is the security boundary.

## OAuth 2.1 readiness

Heimdall today is OAuth 2.0; the spec is moving to 2.1. We document gaps explicitly and split each into **build now** (cheap insurance) versus **defer** (no value until Heimdall changes).

### Gaps in Heimdall (not Huckleberry's to fix, but to plan around)

| Gap | OAuth 2.1 expectation | Our stance |
|---|---|---|
| PKCE accepted but not validated on `/token` | Mandatory PKCE | Send `code_challenge` / `code_verifier` anyway — zero-cost forward-compat |
| No refresh token rotation (same `RefreshTokenID` reused) | Rotation OR sender-constraining required | See "Build now #1" below |
| 2-year refresh token TTL | Allowed but only safe with rotation | Accept as-is; revisit when rotation lands |
| Discovery `/.well-known/*` allowlisted via Gatekeeper only | Open discovery expected | Hardcode endpoint paths now; switch to discovery fetch when available |
| Gatekeeper `/userinfo` allowlisted | Open userinfo or claims-via-JWT | Decode JWT + call `/users/me` at login (already planned) |

### Build now (cheap insurance, prevents rework later)

| # | What | Why | Cost |
|---|---|---|---|
| 1 | **Always overwrite `domo_sessions.refresh_token` from the refresh response**, even when value is unchanged | Day Heimdall flips on rotation, no code change | One line — same `UPDATE` statement |
| 2 | **Verify RS256 JWT signature against Heimdall's JWKS** before trusting any claim | Decoding-without-verifying is forgeable | One JWKS fetch at boot, cached; one `jose.jwtVerify` call per decode |
| 3 | **Validate `iss` and `aud` claims** on every JWT we accept | Confused-deputy hardening | Two equality checks |
| 4 | **On refresh `/token` → 401 (or `invalid_grant`)**, immediately invalidate the user's `hb_session` and force re-login | Closes window where revoked Heimdall session keeps Huckleberry session alive | One delete + cookie clear in the catch block |
| 5 | **Single `verifyAndDecodeAccessToken(jwt)` function** used everywhere, even though we own the issuer | When 2.1 tightens claim requirements, one place to update | Function definition, not architecture |
| 6 | **Single `injectBearer(req)` function in DomoProxy** that wraps the bearer-injection | When DPoP / mTLS sender-constraining lands, one place to add the second header | We already need this for token-cache lookup |
| 7 | **Persist granted `scope` on `domo_sessions`** (already in schema) and re-auth when requested scope set changes | Heimdall adding/splitting scopes won't strand users on stale grants | Already in schema |
| 8 | **Reject bearer tokens from query strings** in any controller that accepts auth | OAuth 2.1 forbids `?access_token=` | NestJS `AuthGuard` already only reads headers — keep it that way |
| 9 | **Exact redirect URI matching** at our `/auth/callback` controller (no path-prefix matching, no `*`) | OAuth 2.1 mandates exact match upstream; we're a downstream consumer of `state` only, but match the discipline | Default behavior; just don't loosen it |

### Explicitly NOT building now (defer until Heimdall provides hooks)

| # | What | Why we skip | Trigger to revisit |
|---|---|---|---|
| A | **DPoP / sender-constrained tokens** | Heimdall doesn't support; no value alone | Heimdall ships DPoP support (RFC 9449) |
| B | **Front-channel / back-channel logout** (RFC 8414, OIDC `front-channel-logout`) | Heimdall doesn't emit logout events; we'd be polling for nothing | Heimdall publishes session-end notifications |
| C | **Periodic introspection probes** of access tokens | Adds load for marginal gain — 1h access TTL is tight enough | High-sensitivity feature lands (e.g. financial actions, admin operations) |
| D | **Multi-device / multi-session per user** (1:N `domo_sessions`) | MVP is internal-only; second-login-overwrites-first is acceptable | First user complaint or external-customer phase |
| E | **Discovery doc fetch + cache** (`/.well-known/openid-configuration`) | Allowlisted today; hardcoded paths work | Heimdall opens discovery to all clients |
| F | **mTLS client auth** to Heimdall token endpoint | `client_secret_basic` works fine; Domo internal network | High-value-target deployment, or Heimdall mandates |
| G | **Refresh-token-at-rest hashing** (instead of encryption) | We need the raw value to send back to Heimdall — hashing wouldn't work | n/a — encryption + KMS is the right primitive here |
| H | **Token introspection endpoint integration** for inbound bearer auth | Huckleberry doesn't accept Heimdall bearers from outside callers — only injects them outbound | If we ever expose APIs that accept Heimdall bearers directly |

### Migration shape when Heimdall ships OAuth 2.1

If we follow "build now" items 1–9, the migration is mostly **flag flips, not refactors**:

1. PKCE enforcement turns on — already sending params, no change
2. Refresh rotation turns on — already overwriting refresh_token, no change
3. JWKS rotation cadence changes — JWKS client already fetches; bump cache TTL
4. Discovery opens up — replace hardcoded endpoint constants with discovery-fetched values (one config change)
5. Logout events emitted — add a webhook handler that kills `hb_session` rows by `sub` claim
6. DPoP / sender-constrained — extend `injectBearer` to add `DPoP` header; generate keypair per session

Items A–H stay deferred unless their specific trigger fires.
