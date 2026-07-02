import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, from, switchMap } from 'rxjs';
import { DomoAuthBroker } from './domo-link/domo-auth.broker.js';
import { DomoLinkService } from './domo-link/domo-link.service.js';
import { domoRequestContext } from './domo-request-context.js';
import type { HuckleberryPrincipal } from '../../auth/types.js';

/**
 * Resolves the per-request Domo bearer + targetHost once and binds them
 * into an `AsyncLocalStorage` context for the rest of the request's
 * async tree. `DomoProxyService` reads the bound context when callers
 * omit `bearer`/`targetHost`, so individual Category A services don't
 * need to thread the principal through their signatures.
 *
 * Skips silently when no `req.user` is present (public routes) or when
 * the principal has no active link — leaves the proxy to fall back to
 * dev-token or fail loudly, which is the right behavior for unprotected
 * endpoints and for users mid-onboarding.
 */
@Injectable()
export class DomoContextInterceptor implements NestInterceptor {
  private readonly logger = new Logger(DomoContextInterceptor.name);

  constructor(
    private readonly links: DomoLinkService,
    private readonly broker: DomoAuthBroker,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: HuckleberryPrincipal }>();

    // Dev bypass: forward DOMO_DEVELOPER_TOKEN (the real DDCI token for Mako)
    // via X-DOMO-Developer-Token. DEV_TOKEN is just the guard password between
    // the frontend and BFF — it doesn't need to be the Mako credential.
    const devToken = process.env.DEV_TOKEN;
    if (
      process.env.NODE_ENV !== 'production' &&
      devToken &&
      req.headers['x-domo-developer-token'] === devToken
    ) {
      const targetHost = process.env.DOMO_INSTANCE_URL ?? '';
      const customer = process.env.DEV_INSTANCE_CUSTOMER_ID ?? '';
      const domoToken = process.env.DOMO_DEVELOPER_TOKEN ?? devToken;
      this.logger.debug(
        `dev-token bypass: X-DOMO-Developer-Token as customer "${customer}"`,
      );
      return new Observable((subscriber) => {
        domoRequestContext.run(
          {
            bearer: domoToken,
            targetHost,
            customer,
            customerId: customer,
            userId: 'dev-token-user',
          },
          () => {
            next.handle().subscribe({
              next: (v) => subscriber.next(v),
              error: (e) => subscriber.error(e),
              complete: () => subscriber.complete(),
            });
          },
        );
      });
    }

    const principal = req.user;
    if (!principal) {
      return next.handle();
    }

    return from(this.resolve(principal)).pipe(
      switchMap((bound) => {
        if (!bound) return next.handle();
        return new Observable((subscriber) => {
          domoRequestContext.run(bound, () => {
            next.handle().subscribe({
              next: (v) => subscriber.next(v),
              error: (e) => subscriber.error(e),
              complete: () => subscriber.complete(),
            });
          });
        });
      }),
    );
  }

  private async resolve(principal: HuckleberryPrincipal): Promise<{
    bearer: string;
    targetHost: string;
    customerId: string;
    userId: string;
  } | null> {
    const link = await this.links.activeLinkFor(principal.userId);
    if (!link) return null;
    try {
      const bearer = await this.broker.tokenFor(link.id);
      return {
        bearer,
        targetHost: link.issuerUrl,
        customerId: link.customerId,
        userId: principal.userId,
      };
    } catch (err) {
      this.logger.warn(
        `Failed to mint Domo bearer for user ${principal.userId}: ${String(err)}`,
      );
      return null;
    }
  }
}
