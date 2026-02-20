import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

/** Error shape thrown by DomoProxyService */
export class DomoApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly domoResponse?: unknown,
  ) {
    super(message);
    this.name = 'DomoApiError';
  }
}

@Catch(DomoApiError)
export class DomoExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomoExceptionFilter.name);

  catch(exception: DomoApiError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const status = this.mapStatus(exception.statusCode);

    this.logger.warn(
      `Domo API error ${exception.statusCode}: ${exception.message}`,
    );

    response.status(status).json({
      statusCode: status,
      message: exception.message,
      domoStatus: exception.statusCode,
    });
  }

  private mapStatus(domoStatus: number): number {
    switch (domoStatus) {
      case 400:
        return HttpStatus.BAD_REQUEST;
      case 401:
        return HttpStatus.UNAUTHORIZED;
      case 403:
        return HttpStatus.FORBIDDEN;
      case 404:
        return HttpStatus.NOT_FOUND;
      case 409:
        return HttpStatus.CONFLICT;
      default:
        return domoStatus >= 500
          ? HttpStatus.BAD_GATEWAY
          : HttpStatus.INTERNAL_SERVER_ERROR;
    }
  }
}
