# Domo Web Auth Flow — RETIRED

> **🪦 Retired.** This flow was a fallback for when we thought Domo had no user-facing OAuth. Confirmed against `~/dev/heimdall` that Heimdall supports authorization-code OAuth with confidential clients today, so Huckleberry uses that instead. See `oauth-flow.md`.
>
> Kept only as historical context for the design decision. Do not implement.

---

What we *would* have built first if Heimdall were not available. Uses Domo's internal `/api/domoweb/auth/login` endpoint, which accepts plaintext username + password and returns an instance session token usable against `/api/ai/v1/*`, `/api/recall/v1/*`, etc.

> **Caveats** (see fuller discussion in conversation history):
> - This is the OAuth 2.0 ROPC anti-pattern: Huckleberry holds plaintext credentials in flight
> - Breaks for SSO-only / MFA-enforced instances
> - `/api/domoweb/auth/*` is undocumented and may change without notice
> - Acceptable for dev / internal Domo-employee use; not for external customers
> - Designed to be swapped out via the `DomoAuthProvider` seam — see `auth-providers.md`

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

    U->>BFF: GET /auth/login with instance and returnTo
    BFF->>BFF: generate CSRF state, render login form
    BFF->>R: store state with instance, returnTo (TTL 10m)
    BFF-->>U: 200 HTML login form<br/>fields username, password, hidden state

    U->>BFF: POST /auth/domoweb<br/>username, password, state
    BFF->>R: validate state, get instance
    R-->>BFF: instance (or 400 if expired)

    BFF->>D: POST /api/domoweb/auth/login<br/>with username and password
    alt success
        D-->>BFF: 200 with sessionToken and userId
    else MFA or SSO required
        D-->>BFF: 4xx — flow unsupported on this instance
        BFF-->>U: error response, instance requires SSO
    end

    BFF->>D: GET /api/content/v3/users/me<br/>header x-domo-eps-auth-token sessionToken
    D-->>BFF: domoUserId, email, displayName, roleId

    BFF->>SM: get token-encryption key
    BFF->>DB: upsert users and linked_identities<br/>provider domoweb, instance, domoUserId
    BFF->>DB: upsert oauth_tokens<br/>access_token is encrypted sessionToken<br/>refresh_token NULL, expires_at best-guess
    BFF->>BFF: issue Huckleberry session JWT
    BFF->>R: store hb_session and user_id<br/>TTL is session lifetime
    BFF-->>U: 302 to returnTo + hb_session cookie<br/>(HttpOnly, Secure, SameSite Lax)

    Note over U,D: subsequent API calls
    U->>BFF: GET /api/agents with cookie
    BFF->>R: validate hb_session, get user_id
    BFF->>R: get cached Domo session token for user and instance
    alt token expired or 401 from Domo
        BFF-->>U: 401 re-login required<br/>(no refresh path under domoweb provider)
    end
    BFF->>D: Domo API call with x-domo-eps-auth-token
    D-->>BFF: response
    BFF-->>U: response
```

## What's different from the OAuth future state

| Aspect | Today (domoweb) | Future (OAuth 2.1) |
|---|---|---|
| User enters credentials on | Huckleberry-hosted form | Domo-hosted login page |
| Huckleberry sees password? | Yes (plaintext in flight) | No |
| MFA / SSO supported? | No | Yes |
| Refresh token? | No — re-login on expiry | Yes — silent refresh |
| Domo endpoint | `/api/domoweb/auth/login` | `/oauth/authorize` + `/oauth/token` |
| `linked_identities.provider` | `domoweb` | `domo_oauth` |
| `oauth_tokens.refresh_token` | NULL | populated |
| CSRF mechanism | hidden form field | `state` param on callback |
| Bearer header | `x-domo-eps-auth-token` | `Authorization: Bearer ...` |

## Operational notes

- **Session token lifetime is opaque.** Domo doesn't return `expires_in`. Treat any 401 as expiry → force re-login. Optionally probe with a cheap call (e.g. `/users/me`) on a timer to detect expiry early.
- **Never log the password.** Scrub `password` from request bodies in any access log / error reporter middleware before this controller is enabled.
- **Rate-limit `POST /auth/domoweb` aggressively.** Otherwise Huckleberry becomes a credential-stuffing oracle against Domo.
- **Feature-flag the controller.** `AUTH_PROVIDER=domoweb` enables it; production deploys default to a safer provider once available.
