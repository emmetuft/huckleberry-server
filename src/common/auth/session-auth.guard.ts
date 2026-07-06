import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { timingSafeEqual } from 'crypto';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './decorators/public.decorator.js';
import { SKIP_CSRF_KEY } from './decorators/skip-csrf.decorator.js';
import { SessionService } from '../../auth/session.service.js';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../../auth/user.repository.js';
import type { HuckleberryPrincipal } from '../../auth/types.js';

const SESSION_COOKIE = 'hb_session';
const CSRF_HEADER = 'x-csrf-token';
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Unified session guard for all huckleberry routes.
 *
 * - Validates `hb_session` cookie via `SessionService`
 * - Enforces double-submit CSRF on state-changing requests (POST/PUT/PATCH/DELETE)
 *   using constant-time comparison to prevent timing attacks (THR-TB02-T-02)
 * - Supports @Public() to bypass auth entirely (e.g. health checks)
 * - Supports @SkipCsrf() to bypass the CSRF check for specific handlers
 * - Dev bypass: x-domo-developer-token skips session + CSRF (non-production only)
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.hasMetadata(IS_PUBLIC_KEY, ctx)) return true;

    const req = ctx.switchToHttp().getRequest<Request>();

    const devToken = process.env.DEV_TOKEN;
    if (
      process.env.NODE_ENV !== 'production' &&
      devToken &&
      req.headers['x-domo-developer-token'] === devToken
    ) {
      (req as Request & { user: HuckleberryPrincipal }).user = {
        userId: '00000000-0000-0000-0000-000000000001',
        sessionId: 'dev-token-session',
        email: 'dev@localhost',
        status: 'active',
      };
      return true;
    }

    const cookie = readCookie(req, SESSION_COOKIE);
    if (!cookie) throw new UnauthorizedException('no_session');

    const session = await this.sessions.verifyAndTouch(cookie);

    if (
      STATE_CHANGING.has(req.method) &&
      !this.hasMetadata(SKIP_CSRF_KEY, ctx)
    ) {
      const headerToken = req.headers[CSRF_HEADER];
      if (typeof headerToken !== 'string') {
        throw new UnauthorizedException('csrf_token_missing');
      }
      if (!csrfEqual(headerToken, session.csrfToken)) {
        throw new UnauthorizedException('csrf_token_mismatch');
      }
    }

    const user = await this.users.findById(session.userId);
    if (!user || user.status === 'suspended') {
      throw new UnauthorizedException('user_unavailable');
    }

    (req as Request & { user: HuckleberryPrincipal }).user = {
      userId: user.id,
      sessionId: session.sid,
      email: user.email,
      status: user.status,
    };
    return true;
  }

  private hasMetadata(key: string, ctx: ExecutionContext): boolean {
    return Boolean(
      this.reflector.getAllAndOverride<boolean>(key, [
        ctx.getHandler(),
        ctx.getClass(),
      ]),
    );
  }
}

function csrfEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const pair of header.split(';')) {
    const [k, ...rest] = pair.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}
