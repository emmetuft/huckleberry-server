import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { SessionService } from '../../auth/session.service.js';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../../auth/user.repository.js';
import type { HuckleberryPrincipal } from '../../auth/types.js';

const SESSION_COOKIE = 'hb_session';
const DEV_TOKEN = process.env.DEV_TOKEN;

/**
 * Inbound auth for Category A controllers (Domo-proxied endpoints).
 *
 * The only accepted inbound credential is a valid huckleberry session
 * cookie (`hb_session`). The guard verifies it, attaches a
 * `HuckleberryPrincipal` to `request.user`, and `DomoContextInterceptor`
 * downstream resolves the user's linked Domo bearer via `DomoAuthBroker`.
 *
 * Dev bypass: if DEV_TOKEN is set and the request carries a matching
 * `x-domo-developer-token` header, the session check is skipped entirely.
 * `DomoContextInterceptor` detects the same header and seeds the Domo
 * bearer context directly. Never active in production (NODE_ENV=production).
 */
@Injectable()
export class DomoAuthGuard implements CanActivate {
  private readonly logger = new Logger(DomoAuthGuard.name);

  constructor(
    private readonly sessions: SessionService,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();

    if (
      process.env.NODE_ENV !== 'production' &&
      DEV_TOKEN &&
      request.headers['x-domo-developer-token'] === DEV_TOKEN
    ) {
      this.logger.debug('dev-token bypass active');
      return true;
    }

    const cookie = readCookie(request, SESSION_COOKIE);
    if (cookie) {
      try {
        const session = await this.sessions.verifyAndTouch(cookie);
        const user = await this.users.findById(session.userId);
        if (user && user.status !== 'suspended') {
          const principal: HuckleberryPrincipal = {
            userId: user.id,
            sessionId: session.sid,
            email: user.email,
            status: user.status,
          };
          (request as Request & { user: HuckleberryPrincipal }).user =
            principal;
          return true;
        }
        this.logger.debug('hb_session valid but user missing/suspended');
      } catch {
        this.logger.debug('hb_session cookie present but invalid');
      }
    }

    throw new UnauthorizedException('Missing authentication token');
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
