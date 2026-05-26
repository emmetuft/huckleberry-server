import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { Response } from 'express';

/**
 * Wraps all non-streaming JSON responses in the { success, data } envelope
 * that the frontend expects. Streaming responses (SSE) are passed through
 * untouched since they use @Res() and bypass the interceptor pipeline.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = context.switchToHttp().getResponse<Response>();

    // If the handler used @Res() directly (streaming), this interceptor
    // is bypassed by NestJS — but guard against double-wrapping just in case.
    return next.handle().pipe(
      map((data: unknown) => {
        if (res.statusCode === 204) return data;
        if (
          data &&
          typeof data === 'object' &&
          'success' in data &&
          'data' in data
        ) {
          return data;
        }
        return { success: true, data };
      }),
    );
  }
}
