import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, tap } from 'rxjs';
import { Request, Response } from 'express';
import { AppConfig } from '../config/configuration.js';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');
  private readonly isDev: boolean;
  private readonly verbose: boolean;

  constructor(config: ConfigService) {
    const appConfig = config.get<AppConfig>('app');
    this.isDev = appConfig?.nodeEnv === 'development';
    this.verbose = appConfig?.verboseLogging ?? false;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.isDev) return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const { method, url } = req;
    const start = Date.now();

    if (this.verbose) {
      const parts = [`→ ${method} ${url}`];
      if (req.query && Object.keys(req.query).length) {
        parts.push(`  query: ${JSON.stringify(req.query)}`);
      }
      if (req.body && Object.keys(req.body as Record<string, unknown>).length) {
        parts.push(
          `  body:  ${JSON.stringify(LoggingInterceptor.redactBody(req.body as Record<string, unknown>))}`,
        );
      }
      this.logger.log(parts.join('\n'));
    }

    return next.handle().pipe(
      tap({
        next: () => {
          const ms = Date.now() - start;
          const res = context.switchToHttp().getResponse<Response>();
          this.logger.log(`${method} ${url} — ${res.statusCode} ${ms}ms`);
        },
        error: (err: unknown) => {
          const ms = Date.now() - start;
          const status = err instanceof HttpException ? err.getStatus() : 500;
          const msg = err instanceof Error ? err.message : 'unknown error';
          this.logger.warn(`${method} ${url} — ${status} ${ms}ms — ${msg}`);
        },
      }),
    );
  }

  private static readonly REDACTED_BODY_KEYS = new Set([
    'token',
    'password',
    'secret',
    'bearerToken',
    'clientSecret',
    'refreshToken',
    'accessToken',
  ]);

  private static redactBody(
    body: Record<string, unknown>,
  ): Record<string, unknown> {
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      redacted[key] = LoggingInterceptor.REDACTED_BODY_KEYS.has(key)
        ? '[REDACTED]'
        : value;
    }
    return redacted;
  }
}
