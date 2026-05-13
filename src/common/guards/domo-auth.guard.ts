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
 * The only accepted inbound credential is a valid huckleberry session
 * cookie (`hb_session`). The guard verifies it, attaches a
 * `HuckleberryPrincipal` to `request.user`, and `DomoContextInterceptor`
 * downstream resolves the user's linked Domo bearer via `DomoAuthBroker`.
 *
 * In `development` mode, when `DEV_TOKEN` is configured server-side, a
 * request with no session cookie is allowed through — the proxy attaches
 * the dev token outbound. This is a local-only convenience and is
 * unreachable in production. No request value gates this path: it's
 * controlled entirely by server configuration.
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

    // Dev-only convenience — server config gates it; no user input involved.
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
