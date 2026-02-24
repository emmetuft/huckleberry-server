import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { Response } from 'express';

/** Error shape thrown by DomoProxyService */
export class DomoApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly contentType?: string,
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

    this.logger.warn(
      `Domo API error ${exception.statusCode}: ${exception.message}`,
    );

    response.status(exception.statusCode);

    if (exception.contentType?.includes('application/json')) {
      response.setHeader('Content-Type', 'application/json');
      response.end(exception.message);
    } else {
      response.type('text/plain').send(exception.message);
    }
  }
}
