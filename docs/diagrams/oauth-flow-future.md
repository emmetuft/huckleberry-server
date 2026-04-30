# Domo OAuth Flow — FUTURE STATE (Authorization Code + PKCE)

> **⚠️ Not buildable today.** Domo's public OAuth (`api.domo.com/oauth/token`, per `DomoApps/domo-documentation-hub/openapi/platform/authentication.yaml`) currently supports **only `grant_type=client_credentials`** — no `/oauth/authorize` endpoint, no authorization-code flow, no PKCE. The instance APIs Huckleberry depends on (`/api/ai/v1/*`, `/api/recall/v1/*`) are not on that surface either.
>
> This document describes the **target state** for when Domo ships authorization-code OAuth on instance APIs. For what we build now, see `domoweb-auth-flow.md`. For how the auth service abstracts over both, see `auth-providers.md`.

Server-side authorization code flow. Huckleberry's NestJS backend is a **confidential client** — `client_secret` lives in Secrets Manager and never leaves the server. PKCE is layered on as defense-in-depth (binds the code to the originating session so a stolen code can't be redeemed).

## Sequence

```mermaid
sequenceDiagram
    autonumber
    participant U as User Browser
    participant BFF as Huckleberry BFF
    participant R as Redis
    participant DB as Aurora MySQL
    participant SM as Secrets Manager
    participant D as Domo Instance

    U->>BFF: GET /auth/login?instance=acme.domo.com
    BFF->>BFF: generate state and code_verifier<br/>code_challenge is S256 of code_verifier
    BFF->>R: store state with code_verifier, instance, returnTo<br/>TTL 10m
    BFF-->>U: 302 to Domo /oauth/authorize<br/>params: client_id, redirect_uri, state,<br/>code_challenge, code_challenge_method S256, scope

    U->>D: follows redirect, logs in, consents
    D-->>U: 302 to BFF /auth/callback?code&state

    U->>BFF: GET /auth/callback with code and state
    BFF->>R: lookup state, get code_verifier and instance
    R-->>BFF: code_verifier (or 400 if missing or expired)
    BFF->>SM: get Domo client_secret for instance
    SM-->>BFF: client_secret

    BFF->>D: POST /oauth/token<br/>grant_type authorization_code<br/>plus code, redirect_uri, client_id,<br/>client_secret, code_verifier
    D-->>BFF: access_token, refresh_token, expires_in

    BFF->>D: GET /api/content/v3/users/me<br/>with Bearer access_token
    D-->>BFF: domo_user_id, email, displayName

    BFF->>DB: upsert users and linked_identities<br/>provider domo, instance, domo_user_id
    BFF->>DB: upsert oauth_tokens<br/>encrypted access and refresh, expires_at
    BFF->>BFF: issue Huckleberry session JWT
    BFF->>R: store session and user_id<br/>TTL is session lifetime
    BFF-->>U: 302 to returnTo + hb_session cookie<br/>(HttpOnly, Secure, SameSite Lax)

    Note over U,D: subsequent API calls
    U->>BFF: GET /api/agents with cookie
    BFF->>R: validate session
    BFF->>R: get cached access_token for user and instance
    alt token expired or missing
        BFF->>DB: load oauth_tokens
        BFF->>D: POST /oauth/token<br/>grant_type refresh_token
        D-->>BFF: new access_token
        BFF->>DB: update oauth_tokens
        BFF->>R: cache access_token (TTL under expires_in)
    end
    BFF->>D: Domo API call with Bearer token
    D-->>BFF: response
    BFF-->>U: response
```

## Why this flow

- **Authorization code, not implicit / not PKCE-only** — backend keeps `client_secret`, tokens never touch the browser
- **PKCE on top** — protects against authorization-code interception even with a confidential client (current OAuth 2.1 guidance)
- **`state` parameter** — CSRF protection on the callback; also doubles as the lookup key for the per-flow `code_verifier` and the originating instance
- **Tokens encrypted at rest** — KMS-backed envelope encryption on `oauth_tokens.access_token` / `refresh_token`
- **Redis as token cache** — avoids a DB read on every Domo API call; falls back to DB on miss
- **Per-instance client credentials** — `client_id` / `client_secret` keyed by Domo instance in Secrets Manager, since each instance registers Huckleberry separately

## Open questions

1. Does Domo support PKCE (`code_challenge_method=S256`)? If only plain auth code, drop steps and accept slightly weaker code-interception protection.
2. What scopes does Domo expose? Need least-privilege scope list before going live.
3. Refresh token lifetime and rotation behavior — does Domo issue a new refresh token on refresh, or reuse?
4. Redirect URI registration — one per environment (`localhost`, staging, prod) per instance, or wildcard support?
