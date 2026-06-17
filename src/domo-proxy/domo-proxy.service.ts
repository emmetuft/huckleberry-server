import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../common/config/configuration.js';
import { ContentType, HttpHeader } from '../common/constants/http.constants.js';
import { DomoApiError } from '../common/filters/domo-exception.filter.js';
import { domoRequestContext } from '../common/auth/domo-request-context.js';

export interface DomoRequestOptions {
  headers?: Record<string, string>;
  query?: Record<string, string>;
  /**
   * Per-request target host. Multi-tenant callers pass `req.user.issuer` so
   * the request reaches the same instance that issued the token. Falls back
   * to the configured `DOMO_INSTANCE_URL` when omitted (dev / single-tenant).
   */
  targetHost?: string;
  /**
   * Per-request bearer token. Callers pass `req.user.rawToken` so the user's
   * own Gatekeeper JWT flows downstream and Domo enforces fine-grained access.
   */
  bearer?: string;
}

@Injectable()
export class DomoProxyService {
  private readonly logger = new Logger(DomoProxyService.name);
  private readonly baseUrl: string;
  private readonly verbose: boolean;
  private readonly transportOverrides: Record<string, string>;

  constructor(private readonly config: ConfigService) {
    const appConfig = this.config.get<AppConfig>('app');
    this.baseUrl = appConfig.domoInstanceUrl;
    this.verbose = appConfig.verboseLogging ?? false;
    this.transportOverrides = appConfig.gatekeeperTransportOverrides ?? {};
    this.logger.log(`baseUrl=${this.baseUrl}`);
  }

  async get<T>(path: string, options?: DomoRequestOptions): Promise<T> {
    return this.request<T>('GET', path, undefined, options);
  }

  async post<T>(
    path: string,
    body?: unknown,
    options?: DomoRequestOptions,
  ): Promise<T> {
    return this.request<T>('POST', path, body, options);
  }

  async put<T>(
    path: string,
    body?: unknown,
    options?: DomoRequestOptions,
  ): Promise<T> {
    return this.request<T>('PUT', path, body, options);
  }

  async delete<T>(path: string, options?: DomoRequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, undefined, options);
  }

  async getStream(
    path: string,
    options?: DomoRequestOptions,
  ): Promise<Response> {
    const url = this.buildUrl(path, options?.query, options?.targetHost);
    const headers = this.buildHeaders(options?.headers, options?.bearer);

    if (this.verbose) {
      this.logger.log(`→ STREAM GET ${url}`);
    }

    try {
      return await fetch(url, { method: 'GET', headers });
    } catch (error) {
      const cause =
        error instanceof Error && 'cause' in error ? error.cause : undefined;
      this.logger.error(
        `Stream fetch failed: ${String(error)}`,
        cause instanceof Error ? cause.message : undefined,
      );
      throw new DomoApiError(
        503,
        `Domo API unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async postStream(
    path: string,
    body?: unknown,
    options?: DomoRequestOptions,
  ): Promise<Response> {
    const url = this.buildUrl(path, options?.query, options?.targetHost);
    const headers = this.buildHeaders(options?.headers, options?.bearer);
    // Prefer SSE but accept anything — some Domo controllers produce
    // application/x-ndjson or application/json and would 406 a strict SSE
    // Accept. The pipe-through is byte-for-byte either way.
    headers[HttpHeader.Accept] =
      'text/event-stream, application/x-ndjson, application/json, */*';

    if (this.verbose) {
      this.logger.log(`→ STREAM POST ${url}`);
      if (body !== undefined) {
        this.logger.log(`  body: ${JSON.stringify(body)}`);
      }
    }

    try {
      return await fetch(url, {
        method: 'POST',
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      const cause =
        error instanceof Error && 'cause' in error ? error.cause : undefined;
      this.logger.error(
        `Stream fetch failed: ${String(error)}`,
        cause instanceof Error ? cause.message : undefined,
      );
      throw new DomoApiError(
        503,
        `Domo API unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: DomoRequestOptions,
  ): Promise<T> {
    const url = this.buildUrl(path, options?.query, options?.targetHost);
    const headers = this.buildHeaders(options?.headers, options?.bearer);

    if (this.verbose) {
      this.logger.log(`→ ${method} ${url}`);
      const safeHeaders = { ...headers };
      for (const key of Object.keys(safeHeaders)) {
        if (/token|authorization|secret/i.test(key)) {
          safeHeaders[key] = '[REDACTED]';
        }
      }
      this.logger.log(`  headers: ${JSON.stringify(safeHeaders)}`);
      if (body !== undefined) {
        this.logger.log(`  body:    ${JSON.stringify(body)}`);
      }
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      this.logger.error(`Fetch failed for ${method} ${url}: ${String(error)}`);
      throw new DomoApiError(
        503,
        `Domo API unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new DomoApiError(
        response.status,
        text || response.statusText,
        response.headers.get(HttpHeader.ContentType),
      );
    }

    const contentType = response.headers.get(HttpHeader.ContentType) || '';
    if (contentType.includes(ContentType.JSON)) {
      return (await response.json()) as T;
    }

    return (await response.text()) as unknown as T;
  }

  private buildUrl(
    path: string,
    query?: Record<string, string>,
    targetHost?: string,
  ): string {
    // Resolution order: explicit caller arg → per-request context (set by
    // DomoContextInterceptor from the active link) → configured baseUrl.
    const ctx = domoRequestContext.getStore();
    // Apply transport override — the issuer string (`http://host:443`) is
    // an identifier, not a transport instruction. We rewrite to the real
    // HTTPS endpoint when configured.
    const raw = targetHost || ctx?.targetHost || this.baseUrl;
    const resolved = this.transportOverrides[raw] ?? raw;
    const base = new URL(resolved);

    let normalizedPath = path || '';

    // Reject protocol-relative paths that could change the target host
    if (normalizedPath.startsWith('//')) {
      throw new DomoApiError(400, 'Invalid API path');
    }

    if (!normalizedPath.startsWith('/')) {
      normalizedPath = '/' + normalizedPath;
    }

    // Reject path traversal attempts
    if (normalizedPath.includes('..')) {
      throw new DomoApiError(400, 'Invalid API path');
    }

    base.pathname = normalizedPath;

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        base.searchParams.set(key, value);
      }
    }
    return base.toString();
  }

  private buildHeaders(
    extra?: Record<string, string>,
    bearer?: string,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      [HttpHeader.ContentType]: ContentType.JSON,
    };

    const ctx = domoRequestContext.getStore();
    const ctxBearer = ctx?.bearer;
    const effectiveBearer = bearer ?? ctxBearer;

    if (effectiveBearer) {
      if (ctx?.customer) {
        // Dev-token bypass: send DDCI token directly, bypassing Gatekeeper scope checks.
        headers['X-DOMO-Authentication'] = effectiveBearer;
        headers['X-DOMO-Customer'] = ctx.customer;
      } else {
        headers[HttpHeader.Authorization] = `Bearer ${effectiveBearer}`;
      }
    }

    if (extra) {
      Object.assign(headers, extra);
    }

    return headers;
  }
}
