# BFF Auth Module Shape

The BFF runs two cooperating auth subsystems:

- **`src/auth/`** — Huckleberry-native identity (Layer A). Magic-link sign-in, session, Domo-link completion. No passwords; users are seeded by vetted operator tooling.
- **`src/common/auth/`** — Huckleberry session guard (front door) + Domo OAuth broker (back-channel). Verifies inbound cookies, manages outbound Domo tokens.

Wire-level flows in `oauth-flow.md`. Design rationale and schemas in `../authentication.md`.

## Module surface

```mermaid
graph TB
    subgraph "Inbound request (browser)"
        REQ[HTTP request<br/>Cookie: hb_session]
    end

    subgraph "src/common/auth — guard side"
        HG[HuckleberryAuthGuard<br/>verify cookie JWT<br/>check session in Redis<br/>attach HuckleberryPrincipal]
        SESS[SessionService<br/>issue / revoke<br/>Redis-backed]
        CSRF[CsrfGuard<br/>double-submit token<br/>on state-changing routes]
        PUB[@Public bypass]
        PRINCIPAL[HuckleberryPrincipal<br/>userId · sessionId · activeLinkId]
    end

    subgraph "src/auth — identity flows (magic-link)"
        AC[AuthController<br/>/auth/signin/request<br/>/auth/signin (consume)<br/>/auth/logout · /auth/me]
        AS[AuthService<br/>issue + consume magic links<br/>rate-limit · audit]
        DLC[DomoLinkController<br/>/auth/domo/link/start<br/>/auth/domo/callback]
        DLS[DomoLinkService<br/>complete the pre-seeded link]
    end

    subgraph "src/common/auth/domo-auth-broker — Domo back-channel"
        DAB[DomoAuthBroker<br/>tokenFor(linkId) → Bearer<br/>refresh on demand]
        DTS[DomoTokenStore<br/>Aurora R/W<br/>KMS envelope encryption]
        DOC[DomoOAuthClient<br/>buildAuthorizeUrl<br/>exchangeCode · refresh · revoke]
        JWKS[JwksService<br/>per-issuer JWKS cache]
        GAG[GatekeeperAuthGuard<br/>(internal use only)<br/>verifies tokens from /oauth2/token responses]
        KT[KnownTenantsService<br/>issuer allowlist /<br/>pattern matcher]
    end

    subgraph "Outbound (Category A)"
        PROXY[DomoProxyService<br/>targetHost + bearer<br/>per request]
    end

    subgraph "Email"
        EMAIL[EmailService<br/>AWS SES]
    end

    REQ --> HG
    HG --> SESS
    SESS --> PRINCIPAL
    HG --> CSRF
    PRINCIPAL --> AC
    PRINCIPAL --> DLC
    AC --> AS
    AS --> EMAIL
    DLC --> DLS
    DLS --> DAB
    DAB --> DTS
    DAB --> DOC
    DOC --> KT
    DOC --> GAG
    GAG --> JWKS
    PRINCIPAL --> PROXY
    DAB --> PROXY
```

The huckleberry session cookie is the **only** inbound auth. `GatekeeperAuthGuard` is internal-only — `DomoOAuthClient` uses it to verify tokens received from Gatekeeper during code exchange and refresh.

## Files (planned)

| Path | Responsibility |
|---|---|
| `src/common/auth/request-principal.ts` | `HuckleberryPrincipal { userId, sessionId, activeLinkId? }` type. |
| `src/common/auth/huckleberry-auth.guard.ts` | Reads `hb_session` cookie, verifies signature, validates session in Redis, attaches principal. |
| `src/common/auth/session.service.ts` | `issue(userId) → { sid, cookie }`, `revoke(sid)`, `get(sid)`. Redis-backed. |
| `src/common/auth/csrf.guard.ts` | Double-submit token check on POST/PUT/PATCH/DELETE. |
| `src/common/auth/decorators/public.decorator.ts` | `@Public()` bypass marker. |
| `src/common/auth/domo-auth-broker/jwks.service.ts` | Per-issuer JWKS cache. |
| `src/common/auth/domo-auth-broker/known-tenants.service.ts` | Issuer allowlist + pattern matcher. Determines which Domo instances are valid linkage targets. |
| `src/common/auth/domo-auth-broker/gatekeeper-auth.guard.ts` | Reusable verifier — invoked by `DomoOAuthClient` to validate tokens received from Gatekeeper. Not applied to inbound controllers. |
| `src/common/auth/domo-auth-broker/domo-oauth-client.service.ts` | Builds authorize URLs, exchanges codes, refreshes tokens, revokes. PKCE-only public client — no `client_secret`. |
| `src/common/auth/domo-auth-broker/domo-token-store.service.ts` | Aurora R/W for `domo_oauth_tokens` and `linked_domo_instances`. KMS envelope encryption on `refresh_token`. |
| `src/common/auth/domo-auth-broker/domo-auth-broker.service.ts` | `tokenFor(linkId): Promise<string>` — returns a fresh access token, refreshing transparently. Redis cache + Aurora fallback. |
| `src/auth/auth.controller.ts` | `/auth/signup`, `/auth/signin/request`, `/auth/signin` (consume), `/auth/logout`, `/auth/me`. Signup provisions a Domo instance via `InstanceProvisioner` and seeds a `pending_link` user. Signin is existing-users-only. |
| `src/auth/auth.service.ts` | Issue magic links (random token, SHA-256 hash to DB, raw via email), atomic consume + session issue, rate-limit. |
| `src/auth/domo-link.controller.ts` | `/auth/domo/link/start`, `/auth/domo/callback`. Single linked instance per user (MVP). |
| `src/auth/domo-link.service.ts` | Builds PKCE authorize URLs, completes the signup-seeded link by populating `domo_oauth_tokens` after the OAuth callback, marks user `status='active'`. |
| `src/email/email.service.ts` | SES integration (magic-link emails only at MVP). |
| `scripts/onboard-user.ts` | Operator CLI: takes email + instance details, inserts `users` row (status=pending_link) + `linked_domo_instances` stub + initial magic_link, sends sign-in email. |

## HuckleberryAuthGuard sketch

```ts
@Injectable()
export class HuckleberryAuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.isPublic(ctx)) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const cookie = req.cookies?.hb_session;
    if (!cookie) throw new UnauthorizedException('no session');

    let payload: { sub: string; sid: string; exp: number };
    try {
      payload = jwt.verify(cookie, this.sessionSigningKey, {
        algorithms: ['HS256'],
      }) as typeof payload;
    } catch {
      throw new UnauthorizedException('invalid session');
    }

    const session = await this.sessions.get(payload.sid);
    if (!session || session.userId !== payload.sub) {
      throw new UnauthorizedException('session not found');
    }

    (req as Request & { user: HuckleberryPrincipal }).user = {
      userId: session.userId,
      sessionId: session.sid,
      activeLinkId: session.activeLinkId,
    };
    return true;
  }
}
```

Session JWT signed with **HS256** using a key from Secrets Manager (rotated periodically). Asymmetric (RS256/ES256) is overkill for a session cookie we both sign and verify on the same server fleet.

## DomoAuthBroker sketch

```ts
@Injectable()
export class DomoAuthBroker {
  constructor(
    private readonly store: DomoTokenStore,
    private readonly client: DomoOAuthClient,
    private readonly redis: RedisClient,
    private readonly verifier: GatekeeperAuthGuard, // reusable verify(token, issuer)
  ) {}

  async tokenFor(linkId: string): Promise<string> {
    const cached = await this.redis.get(`access:${linkId}`);
    if (cached) return cached;

    const link = await this.store.getLink(linkId);
    const refresh = await this.store.getDecryptedRefreshToken(linkId);
    const resp = await this.client.refresh({
      issuer: link.issuerUrl,
      refreshToken: refresh,
    });
    await this.verifier.verify(resp.accessToken, link.issuerUrl);
    await this.store.upsertEncryptedRefreshToken(linkId, resp.refreshToken);
    await this.redis.setex(
      `access:${linkId}`,
      resp.expiresIn - 60,
      resp.accessToken,
    );
    return resp.accessToken;
  }
}
```

## Correctness rules (carried forward)

The integrity rules from the prior design still apply with role shifts:

1. **Only `jose.jwtVerify` output is trusted.** Never read claims from an unverified JWT for any purpose other than issuer-routing pre-flight.
2. **`typ: at+jwt`, `alg: ES256`, `iss` match** — enforced inside `GatekeeperAuthGuard.verify`, which `DomoOAuthClient` calls on every code-exchange and refresh response.
3. **Refresh JWKS on unknown `kid`** — Gatekeeper rotates monthly; cache must self-heal.
4. **`?access_token=` query rejected** — applies to any inbound bearer auth. Today only Layer B internals see bearers.
5. **Never log full tokens** — `jti` or first 8 chars only.
6. **Forward, don't relay** — Category A endpoints pass `bearer` to `DomoProxyService` verbatim.
7. **No fall-through on auth failure** — guards throw, never default.

## Inbound auth boundary

`HuckleberryAuthGuard` is the front door — it reads the `hb_session` cookie and attaches a principal. `DomoAuthGuard` is the same shape for Category A (Domo-proxied) controllers: a valid `hb_session` cookie or, in `development` mode only, a server-configured `DEV_TOKEN`. There is no inbound header-based auth.

`GatekeeperAuthGuard` is an internal verifier — invoked by `DomoOAuthClient` to validate tokens received from Gatekeeper during code exchange and refresh. It is never applied to controllers.

The SPA hands off to Gatekeeper for the PKCE redirect, but the code exchange + token storage live server-side. Inbound `Authorization: Bearer` headers are not used for identity — only the session cookie is. Outbound Domo bearers come from `DomoAuthBroker` via the request-scoped `DomoContextInterceptor`. Category A scope enforcement is delegated to Domo (the BFF forwards the user's bearer, Heimdall + DomoWeb enforce).
