import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, tap } from 'rxjs';
import { Request } from 'express';
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
        parts.push(`  body:  ${JSON.stringify(req.body)}`);
      }
      this.logger.log(parts.join('\n'));
    }

    return next.handle().pipe(
      tap(() => {
        const ms = Date.now() - start;
        this.logger.log(`${method} ${url} — ${ms}ms`);
      }),
    );
  }
}
