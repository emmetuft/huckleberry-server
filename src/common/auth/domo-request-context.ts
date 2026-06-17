import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request Domo authentication context, resolved once by
 * `DomoContextInterceptor` and read by `DomoProxyService` when the caller
 * didn't pass `bearer` / `targetHost` explicitly.
 *
 * Threading this through every service signature would have meant a
 * 15-service refactor; AsyncLocalStorage scopes it implicitly to the
 * request handler's async tree without touching call sites.
 *
 * When `customer` is present the proxy uses X-DOMO-Authentication /
 * X-DOMO-Customer headers instead of Authorization: Bearer, sending the
 * DDCI token directly to Mako without going through Gatekeeper's OAuth
 * scope checks. Only set by the dev-token bypass (NODE_ENV !== production).
 */
export interface DomoRequestContext {
  bearer: string;
  targetHost: string;
  /** If set, use X-DOMO-Authentication scheme instead of Authorization: Bearer. */
  customer?: string;
}

export const domoRequestContext = new AsyncLocalStorage<DomoRequestContext>();
