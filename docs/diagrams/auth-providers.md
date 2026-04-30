# Auth Provider Abstraction

The Auth service depends on a `DomoAuthProvider` interface. Today's implementation wraps `/api/domoweb/auth/login` (see `domoweb-auth-flow.md`); the future implementation wraps OAuth authorization-code + PKCE (see `oauth-flow-future.md`). Everything above the seam — controllers, sessions, token storage, DomoProxy — is provider-agnostic.

## The seam

```mermaid
graph TB
    subgraph "Provider-agnostic (stable)"
        CTRL[Auth Controllers<br/>/auth/login · /auth/callback · /auth/logout]
        SESS_MGR[Session Manager<br/>JWT + Redis]
        TOKEN_STORE[Token Store<br/>oauth_tokens table]
        PROXY[DomoProxy<br/>injects bearer per-request]
    end

    IFACE{{DomoAuthProvider interface}}

    subgraph "Provider-specific (swappable)"
        WEB[DomoWebAuthProvider<br/>POST /api/domoweb/auth/login<br/>plaintext creds → session token]
        OAUTH[DomoOAuthProvider<br/>/oauth/authorize + /oauth/token<br/>auth code + PKCE → access + refresh]
    end

    CFG[(env: AUTH_PROVIDER<br/>= domoweb | oauth)]

    CTRL --> IFACE
    SESS_MGR --> IFACE
    PROXY --> IFACE
    IFACE -.selected by.-> CFG
    IFACE --> WEB
    IFACE --> OAUTH

    CTRL --> SESS_MGR
    CTRL --> TOKEN_STORE
    PROXY --> TOKEN_STORE
```

## Interface

```ts
interface DomoAuthProvider {
  // Kicks off auth. domoweb: returns Huckleberry login form URL.
  // oauth: returns Domo /authorize redirect URL.
  beginLogin(p: { instance: string; returnTo: string }): Promise<{
    redirectUrl: string;
    state: string;
  }>;

  // Completes auth. domoweb: handles password POST. oauth: exchanges code.
  completeLogin(p: { state: string; payload: unknown }): Promise<{
    domoUserId: string;
    instance: string;
    accessToken: string;
    refreshToken?: string;     // null under domoweb
    expiresAt: Date;            // best-effort under domoweb
  }>;

  // Refresh stored token. domoweb: throws RefreshUnsupportedError → forces re-login.
  // oauth: standard refresh_token grant.
  refreshAccessToken(linkedIdentityId: string): Promise<{
    accessToken: string;
    expiresAt: Date;
  }>;

  // Revoke. domoweb: drop our session row. oauth: hit /revoke.
  revoke(linkedIdentityId: string): Promise<void>;
}
```

## What stays stable across the swap

| Layer | Stable? | Notes |
|---|---|---|
| `users`, `linked_identities`, `oauth_tokens`, `sessions` schema | ✅ | `linked_identities.provider` discriminates rows |
| Huckleberry session JWT + Redis cache | ✅ | Provider-agnostic |
| `SessionGuard` | ✅ | Validates Huckleberry session, not Domo |
| `/auth/login`, `/auth/logout` controller routes | ✅ | Same shape; provider handles internals |
| `/auth/callback` controller route | ⚠️ | Exists for both, but payload shape differs (form POST vs. `?code&state`) — provider parses `payload` |
| DomoProxy bearer injection | ✅ | Reads `oauth_tokens.access_token`; doesn't care how it got there |
| Header name on outbound Domo calls | ❌ | `x-domo-eps-auth-token` (domoweb) vs. `Authorization: Bearer` (oauth) — handled inside provider, not in DomoProxy |

## What's different per provider

| Concern | domoweb | oauth |
|---|---|---|
| `linked_identities.provider` value | `domoweb` | `domo_oauth` |
| `oauth_tokens.refresh_token` | NULL | populated |
| Token expiry source | best-effort / probe | `expires_in` from token response |
| On 401 from Domo | force user re-login | call `refreshAccessToken` |
| Outbound auth header | `x-domo-eps-auth-token: <token>` | `Authorization: Bearer <token>` |
| MFA / SSO instances | unsupported (returns error) | supported |
| Secrets Manager entries | token encryption key only | + per-instance OAuth client_id/secret |

## Selection

`AUTH_PROVIDER` env var, validated at boot:
- `domoweb` — today, dev/internal only
- `oauth` — future, once Domo ships authorization-code on instance APIs
- (optional later) `developer_token` — paste-a-PAT fallback for power users

Provider is selected once at module init via NestJS dynamic module / factory provider — no per-request branching.

## Migration when OAuth lands

1. Deploy `DomoOAuthProvider` behind `AUTH_PROVIDER=oauth` in staging
2. Verify it writes `linked_identities.provider='domo_oauth'` rows correctly
3. Flip prod `AUTH_PROVIDER` to `oauth`
4. Existing `domoweb` rows keep working until users re-login; new logins use OAuth
5. After a grace period, force-expire remaining `domoweb` sessions and remove the provider implementation

No schema migration. No data backfill. The seam earns its keep here.
