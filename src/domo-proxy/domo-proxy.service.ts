import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../common/config/configuration.js';
import { DomoApiError } from '../common/filters/domo-exception.filter.js';

export interface DomoRequestOptions {
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

@Injectable()
export class DomoProxyService {
  private readonly logger = new Logger(DomoProxyService.name);
  private readonly baseUrl: string;
  private readonly devToken: string;
  private readonly isDev: boolean;

  constructor(private readonly config: ConfigService) {
    const appConfig = this.config.get<AppConfig>('app');
    this.baseUrl = appConfig.domoInstanceUrl;
    this.devToken = appConfig.devToken;
    this.isDev = appConfig.nodeEnv === 'development';
    this.logger.log(
      `isDev=${this.isDev}, nodeEnv=${appConfig.nodeEnv}, hasToken=${!!this.devToken}, baseUrl=${this.baseUrl}`,
    );
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

  async postStream(
    path: string,
    body?: unknown,
    options?: DomoRequestOptions,
  ): Promise<Response> {
    const url = this.buildUrl(path, options?.query);
    const headers = this.buildHeaders(options?.headers);
    headers['Accept'] = 'text/event-stream';

    if (this.isDev) {
      this.logger.debug(`STREAM POST ${url}`);
    }

    return fetch(url, {
      method: 'POST',
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options?: DomoRequestOptions,
  ): Promise<T> {
    const url = this.buildUrl(path, options?.query);
    const headers = this.buildHeaders(options?.headers);

    if (this.isDev) {
      this.logger.debug(`${method} ${url}`);
      const safeHeaders = { ...headers };
      for (const key of Object.keys(safeHeaders)) {
        if (/token|authorization|secret/i.test(key)) {
          safeHeaders[key] = '[REDACTED]';
        }
      }
      this.logger.debug(`Headers: ${JSON.stringify(safeHeaders)}`);
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new DomoApiError(
        response.status,
        text || response.statusText,
        response.headers.get('content-type'),
      );
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return (await response.json()) as T;
    }

    return (await response.text()) as unknown as T;
  }

  private buildUrl(path: string, query?: Record<string, string>): string {
    const url = new URL(path, this.baseUrl);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        url.searchParams.set(key, value);
      }
    }
    return url.toString();
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.isDev && this.devToken) {
      headers['X-DOMO-Developer-Token'] = this.devToken;
    }

    if (extra) {
      Object.assign(headers, extra);
    }

    return headers;
  }
}
