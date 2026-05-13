import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request Domo authentication context, resolved once by
 * `DomoContextInterceptor` and read by `DomoProxyService` when the caller
 * didn't pass `bearer` / `targetHost` explicitly.
 *
 * Threading this through every service signature would have meant a
 * 15-service refactor; AsyncLocalStorage scopes it implicitly to the
 * request handler's async tree without touching call sites.
 */
export interface DomoRequestContext {
  bearer: string;
  targetHost: string;
}

export const domoRequestContext = new AsyncLocalStorage<DomoRequestContext>();
