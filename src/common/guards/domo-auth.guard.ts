import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AppConfig } from '../config/configuration.js';
import { DomoHeader } from '../constants/http.constants.js';
import { SessionService } from '../../auth/session.service.js';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../../auth/user.repository.js';
import type { HuckleberryPrincipal } from '../../auth/types.js';

const SESSION_COOKIE = 'hb_session';

/**
 * Inbound auth for Category A controllers (Domo-proxied endpoints).
 *
 * Accepts any of these, in order:
 *   1. A valid huckleberry session cookie (`hb_session`). Magic-link
 *      sign-in path used by the SPA. Attaches a `HuckleberryPrincipal`
 *      to `request.user` so downstream services can resolve the user's
 *      linked Domo instance + bearer via `DomoAuthBroker`.
 *   2. A Domo-side bearer-style header (`x-domo-embedded-security`,
 *      `x-domo-developer-token`, `x-domo-eps-auth-token`). Legacy callers
 *      that already hold a Domo credential. No principal attached —
 *      `DomoProxyService` will forward whatever header was sent.
 *   3. In `development` mode only — fall through with no auth as long as
 *      `DEV_TOKEN` is configured server-side. `DomoProxyService` attaches
 *      that token outbound. Useful for local testing without a huckleberry
 *      session.
 *
 * Transitional guard. Once every Category A controller is migrated to
 * pull a per-user bearer from `DomoAuthBroker`, the header / dev-token
 * paths can be retired.
 */
@Injectable()
export class DomoAuthGuard implements CanActivate {
  private readonly logger = new Logger(DomoAuthGuard.name);

  constructor(
    private readonly config: ConfigService,
    private readonly sessions: SessionService,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const appConfig = this.config.get<AppConfig>('app');

    // 1. Huckleberry session cookie — verify, attach principal, return.
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
        // Fall through to other auth options. A stale cookie shouldn't
        // block a caller that's also presenting a Domo header.
        this.logger.debug('hb_session cookie present but invalid');
      }
    }

    // 2. Legacy Domo header passthrough.
    const embeddedToken = request.headers[DomoHeader.EmbeddedSecurity];
    const devToken = request.headers[DomoHeader.DeveloperToken];
    const epsToken = request.headers[DomoHeader.EpsAuthToken];
    if (embeddedToken || devToken || epsToken) {
      return true;
    }

    // 3. Dev fallback — `DEV_TOKEN` configured on the server.
    if (appConfig?.nodeEnv === 'development' && appConfig.devToken) {
      return true;
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
