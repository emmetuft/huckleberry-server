import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { decodeJwt, jwtVerify, type JWTPayload } from 'jose';
import type { Request } from 'express';
import type { AppConfig } from '../config/configuration.js';
import { IS_PUBLIC_KEY } from './decorators/public.decorator.js';
import { SCOPES_KEY } from './decorators/scopes.decorator.js';
import { JwksService } from './jwks.service.js';
import { KnownTenantsService } from './known-tenants.service.js';
import type { RequestPrincipal } from './request-principal.js';

const BEARER_PREFIX = 'Bearer ';

/**
 * OAuth 2.1 resource-server guard — multi-tenant.
 *
 * Each request can come from any of N allowed Domo customer instances. The
 * guard:
 *   1. Reads `iss` from the JWT *unsigned* (decode-only, used solely for
 *      issuer routing — never trusted on its own).
 *   2. Rejects immediately if `iss` isn't in the configured allowlist.
 *   3. Verifies signature against that issuer's JWKS, plus `alg=ES256`,
 *      `typ=at+jwt`, `iss` equality, and `aud` when configured.
 *   4. Derives `customer_id` from the `cid` claim (Gatekeeper's canonical
 *      customer slug). Falls back to subdomain parse only when absent.
 *   5. Enforces route `@Scopes(...)` against the `scope` claim.
 *   6. Attaches `RequestPrincipal` to `request.user`.
 *
 * Correctness rules — see `docs/diagrams/auth-providers.md` § Correctness
 * rules. Notably: never trust `decodeJwt` output for anything beyond issuer
 * routing; only `jwtVerify` output is trusted for the principal.
 */
@Injectable()
export class GatekeeperAuthGuard implements CanActivate {
  private readonly logger = new Logger(GatekeeperAuthGuard.name);
  private readonly expectedAudience?: string;

  constructor(
    private readonly config: ConfigService,
    private readonly reflector: Reflector,
    private readonly jwks: JwksService,
    private readonly tenants: KnownTenantsService,
  ) {
    const app = this.config.get<AppConfig>('app');
    this.expectedAudience = app?.gatekeeperAudience || undefined;
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.isPublic(ctx)) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const jwt = this.extractBearer(req);

    // Step 1+2: pre-flight issuer check. Reject unknown issuers BEFORE we
    // pull JWKS, run signature math, or hit any downstream system. The
    // decoded payload at this stage is NOT trusted for anything else.
    let unverifiedIss: string | undefined;
    try {
      unverifiedIss = decodeJwt(jwt).iss;
    } catch {
      throw new UnauthorizedException({
        error: 'invalid_token',
        error_description: 'malformed JWT',
      });
    }
    this.tenants.assertAllowed(unverifiedIss);
    const issuer = unverifiedIss;

    // Step 3: verify against the issuer's JWKS. jose enforces iss/aud/typ/alg
    // against the values we pin; if any mismatch the throw is unauthenticated.
    let payload: JWTPayload;
    try {
      const result = await jwtVerify(jwt, this.jwks.getKeyResolver(issuer), {
        algorithms: ['ES256'],
        typ: 'at+jwt',
        issuer,
        ...(this.expectedAudience ? { audience: this.expectedAudience } : {}),
      });
      payload = result.payload;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'invalid token';
      this.logger.debug(`JWT verification failed: ${message}`);
      throw new UnauthorizedException({
        error: 'invalid_token',
        error_description: message,
      });
    }

    // Step 4: prefer cid claim (Gatekeeper's canonical customer slug),
    // fall back to subdomain parse only if absent.
    const cid = typeof payload.cid === 'string' ? payload.cid : undefined;
    const customerId = cid ?? this.tenants.parseCustomerId(issuer);

    // Step 5: scope check.
    const scopes = this.extractScopes(payload);
    this.enforceScopes(ctx, scopes);

    if (!payload.sub) {
      throw new UnauthorizedException('missing sub claim');
    }

    // Step 6: attach principal. Services pull req.user.issuer to target
    // the correct Domo instance for downstream proxy calls.
    const principal: RequestPrincipal = {
      customerId,
      sub: payload.sub,
      scopes,
      rawToken: jwt,
      issuer,
    };
    (req as Request & { user: RequestPrincipal }).user = principal;

    return true;
  }

  private isPublic(ctx: ExecutionContext): boolean {
    return Boolean(
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]),
    );
  }

  private extractBearer(req: Request): string {
    // Reject ?access_token= per OAuth 2.1 §5.1.
    const query = req.query?.access_token;
    if (query) {
      throw new UnauthorizedException(
        'bearer tokens in query parameters are forbidden',
      );
    }

    const header = req.headers.authorization;
    if (!header || !header.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedException('missing bearer token');
    }
    const token = header.slice(BEARER_PREFIX.length).trim();
    if (!token) throw new UnauthorizedException('empty bearer token');
    return token;
  }

  private extractScopes(payload: JWTPayload): string[] {
    const raw = payload.scope;
    if (typeof raw === 'string') return raw.split(' ').filter(Boolean);
    if (Array.isArray(raw)) return raw.map(String);
    return [];
  }

  private enforceScopes(ctx: ExecutionContext, scopes: string[]): void {
    const required = this.reflector.getAllAndOverride<string[]>(SCOPES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return;

    const hasAny = required.some((s) => scopes.includes(s));
    if (!hasAny) {
      throw new ForbiddenException({
        error: 'insufficient_scope',
        error_description: `requires one of: ${required.join(', ')}`,
        scope: required.join(' '),
      });
    }
  }
}
