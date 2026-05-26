import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './decorators/public.decorator.js';
import { SessionService } from '../../auth/session.service.js';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../../auth/user.repository.js';
import type { HuckleberryPrincipal } from '../../auth/types.js';

const COOKIE_NAME = 'hb_session';
const CSRF_HEADER = 'x-csrf-token';
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Front-door guard for huckleberry.ai. Reads the `hb_session` cookie,
 * verifies it via `SessionService`, checks the double-submit CSRF token on
 * state-changing requests, then attaches a `HuckleberryPrincipal` to
 * `request.user`.
 *
 * Layer A only — does not touch Gatekeeper. Domo-side identity is the
 * `DomoAuthBroker`'s job and is keyed off the principal's `userId`.
 */
@Injectable()
export class HuckleberryAuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly reflector: Reflector,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.isPublic(ctx)) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const cookie = readCookie(req, COOKIE_NAME);
    if (!cookie) throw new UnauthorizedException('no session');

    const session = await this.sessions.verifyAndTouch(cookie);

    if (STATE_CHANGING.has(req.method)) {
      const headerToken = req.headers[CSRF_HEADER];
      if (
        typeof headerToken !== 'string' ||
        headerToken !== session.csrfToken
      ) {
        throw new UnauthorizedException('csrf_token_mismatch');
      }
    }

    const user = await this.users.findById(session.userId);
    if (!user || user.status === 'suspended') {
      throw new UnauthorizedException('user_unavailable');
    }

    const principal: HuckleberryPrincipal = {
      userId: user.id,
      sessionId: session.sid,
      email: user.email,
      status: user.status,
    };
    (req as Request & { user: HuckleberryPrincipal }).user = principal;
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
}

function readCookie(req: Request, name: string): string | null {
  // cookie-parser isn't installed; parse the raw header ourselves.
  const header = req.headers.cookie;
  if (!header) return null;
  for (const pair of header.split(';')) {
    const [k, ...rest] = pair.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}
