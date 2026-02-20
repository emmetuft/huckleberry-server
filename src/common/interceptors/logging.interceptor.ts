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

  constructor(config: ConfigService) {
    this.isDev = config.get<AppConfig>('app')?.nodeEnv === 'development';
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.isDev) return next.handle();

    const req = context.switchToHttp().getRequest<Request>();
    const { method, url } = req;
    const start = Date.now();

    return next.handle().pipe(
      tap(() => {
        const ms = Date.now() - start;
        this.logger.log(`${method} ${url} — ${ms}ms`);
      }),
    );
  }
}
