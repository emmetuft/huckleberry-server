# Auth Service — Gatekeeper OAuth 2.1 (single provider)

> **Note:** Gatekeeper is Domo's new internal OAuth 2.1 authorization server, replacing the older Heimdall. Huckleberry registers as a confidential client and uses authorization-code flow with PKCE. Earlier drafts referenced Heimdall and a `DomoAuthProvider` swappable seam — both are retired.

## Auth service shape

Single OAuth 2.1 client implementation against Gatekeeper. No abstraction over alternate providers — there's only one.

```mermaid
graph TB
    subgraph "Auth service (NestJS)"
        CTRL[Auth Controllers<br/>/auth/login · /auth/callback · /auth/logout]
        SESS_MGR[Session Manager<br/>JWT cookie + Redis]
        TOKEN_STORE[Token Store<br/>domo_sessions table]
        OAUTH_CLIENT[Gatekeeper OAuth Client<br/>authorize, token, refresh, revoke]
    end

    SM[(Secrets Manager<br/>client_secret, JWT signing key,<br/>token encryption key)]
    REDIS[(Redis<br/>state, sessions, token cache)]
    H[Gatekeeper<br/>/oauth/*]
    D[Domo Instance APIs]

    CTRL --> OAUTH_CLIENT
    CTRL --> SESS_MGR
    CTRL --> TOKEN_STORE
    OAUTH_CLIENT --> SM
    OAUTH_CLIENT --> H
    SESS_MGR --> REDIS
    TOKEN_STORE --> SM
    TOKEN_STORE --> D
```

## Module surface

```ts
// src/auth/heimdall-oauth.client.ts
class GatekeeperOAuthClient {
  buildAuthorizeUrl(params: { state: string; codeChallenge: string; scope: string }): string;
  exchangeCode(params: { code: string; codeVerifier: string }): Promise<TokenResponse>;
  refresh(params: { refreshToken: string }): Promise<TokenResponse>;
  revoke(params: { token: string; tokenTypeHint: 'access_token' | 'refresh_token' }): Promise<void>;
}

interface TokenResponse {
  accessToken: string;       // RS256 JWT, 1h TTL
  refreshToken: string;      // 2y TTL, no rotation — same underlying ID
  expiresAt: Date;
  scope: string;
  // decoded from JWT for convenience
  domoUserId: string;        // sub claim
  customerId: string;        // cid claim
  instanceId: string;        // iid claim
}
```

`GatekeeperOAuthClient` is the only OAuth implementation. No interface, no factory, no env-flag selection.

## Gatekeeper registration (as proposed)

| Field | Value |
|---|---|
| `ID` | `huckleberry` (or per Gatekeeper naming convention — confirm) |
| `Secret` | UUID issued by Gatekeeper, stored in AWS Secrets Manager |
| `Name` | `Huckleberry` |
| `Internal` | `true` |
| `Confidential` | `true` |
| `RequireStopScreens` | `true` |
| `RedirectURIs` | `http://localhost:3000/auth/callback`, staging URL, prod URL |

Registration mechanism: confirm with Gatekeeper team — registration flow may differ from Heimdall's static `preApprovedClients` list. As OAuth 2.1, Gatekeeper may support dynamic client registration (RFC 7591).

## Scopes requested

`ai-services content data user-profile` — covers `/api/ai/v1/*`, `/api/recall/v1/*`, `/api/content/v3/*`, `/api/data/v3/*`, and `/users/me`. Avoid `user` and `identity` until we have a feature that mutates users.

## Token lifecycle

| Event | Behavior |
|---|---|
| Login completes | Store access_token + refresh_token encrypted in `domo_sessions`, cache access_token in Redis |
| Request comes in | Validate hb_session cookie, look up access_token (Redis hot-path, DB fallback) |
| Access token within 1h TTL | Use it directly as `Authorization: Bearer ...` against instance APIs |
| Access token expired | Call Gatekeeper `/token` with `grant_type=refresh_token`, persist new access_token, refresh_token value stays the same |
| User logs out | Call Gatekeeper `/oauth/revoke` for refresh_token, clear `domo_sessions` row, drop hb_session |
| Refresh token after 2y | User re-logs in (re-auth via `/oauth/authorize`) |

## What was retired from the earlier design

- `DomoAuthProvider` interface — single implementation, no abstraction needed
- `DomoWebAuthProvider` (plaintext password flow) — Gatekeeper removes the need
- `linked_identities.provider` discriminator column — only one provider exists; collapsed onto `users` directly
- `oauth_tokens` table renamed to `domo_sessions` to be specific about what it holds
- Per-instance `client_id` / `client_secret` — Huckleberry has one Gatekeeper registration, period

## Code-level rules (Gatekeeper is OAuth 2.1; these are correctness requirements)

Gatekeeper is OAuth 2.1 native, so the cheap-insurance/build-now distinctions from the earlier Heimdall era collapse — these are simply correctness requirements. Apply them on the first pass.

### Required behaviors

1. **Always overwrite `domo_sessions.refresh_token` from the refresh response.** OAuth 2.1 mandates rotation; treat every refresh response as authoritative.

   ```ts
   // in GatekeeperOAuthClient.refresh()
   await tokenStore.update(userId, {
     accessToken: resp.access_token,
     refreshToken: resp.refresh_token,  // overwrite even if unchanged
     expiresAt: new Date(Date.now() + resp.expires_in * 1000),
     scope: resp.scope,
   });
   ```

2. **Verify RS256 JWT signature before trusting claims.** Fetch Gatekeeper JWKS at boot, cache, verify on every decode. Never trust `jwt.decode()` output without verification.

   ```ts
   // src/auth/jwt-verifier.ts
   export async function verifyAndDecodeAccessToken(jwt: string): Promise<AccessTokenClaims> {
     const { payload } = await jose.jwtVerify(jwt, jwksRemote, {
       issuer: GATEKEEPER_ISSUER,
       audience: HUCKLEBERRY_CLIENT_ID,
     });
     return payload as AccessTokenClaims;
   }
   ```

   This is the **only** path JWT claims are read. No ad-hoc `jwt.decode` anywhere else.

3. **Validate `iss` and `aud` claims** as part of #2 (above). The `jose.jwtVerify` options enforce both. If either fails, throw — don't silently accept.

4. **On refresh failure (401 or `invalid_grant`), kill the Huckleberry session.**

   ```ts
   try {
     await heimdall.refresh({ refreshToken: stored.refreshToken });
   } catch (err) {
     if (err instanceof GatekeeperAuthError) {
       await sessionStore.invalidate(userId);
       await tokenStore.delete(userId);
       throw new UnauthorizedException('Gatekeeper session ended, re-login required');
     }
     throw err;
   }
   ```

   Closes the window where a revoked Gatekeeper token leaves a working `hb_session`.

5. **Single bearer-injection point in DomoProxy.** All outbound Domo calls go through one function that adds `Authorization: Bearer <token>`. When DPoP support is added, this is the only place that grows a second header.

   ```ts
   // src/domo-proxy/inject-bearer.ts
   export function injectBearer(req: AxiosRequestConfig, accessToken: string) {
     req.headers = { ...req.headers, Authorization: `Bearer ${accessToken}` };
     // future: DPoP header injection lives here
     return req;
   }
   ```

6. **Reject `?access_token=` query parameters.** No controller accepts bearer tokens via URL. NestJS `AuthGuard` reads `Authorization` header only — keep it that way.

7. **Persist `scope` on `domo_sessions`.** Already in schema. On request, if the scope needed for an endpoint isn't in the stored grant, force re-auth rather than silently failing later.

8. **Exact redirect URI on our callback.** Don't loosen routing to accept variants of `/auth/callback` — single exact path, no path params, no trailing-slash tolerance.

### Forbidden patterns

- `jwt.decode()` without verification (use `verifyAndDecodeAccessToken`)
- Reading `Authorization` header in any service other than auth + DomoProxy
- Storing access_token or refresh_token in plaintext anywhere — including logs
- Logging the full JWT — log `jti` claim or first 8 chars only
- Catching Gatekeeper errors generically and continuing — auth failures must propagate

### What we are NOT building now (deferred — see `oauth-flow.md`)

DPoP/sender-constrained tokens, front/back-channel logout, periodic introspection, multi-device sessions, mTLS client auth, refresh-token hashing, inbound bearer introspection. Each has a defined trigger to revisit. Gatekeeper-specific support for these features should be confirmed with the platform team.
