import { Injectable, Logger } from '@nestjs/common';

export interface MagicLinkEmail {
  to: string;
  url: string;
  expiresAt: Date;
}

export interface EmailService {
  sendMagicLink(email: MagicLinkEmail): Promise<void>;
}

export const EMAIL_SERVICE = Symbol('EmailService');

/**
 * Dev impl — logs the magic-link URL to the console instead of sending an
 * email. Lets the loop be: request link → copy URL from console → click.
 * SES-backed impl lives behind the same interface and is selected by
 * `EMAIL_PROVIDER` env in prod.
 */
@Injectable()
export class ConsoleEmailService implements EmailService {
  private readonly logger = new Logger(ConsoleEmailService.name);

  sendMagicLink(email: MagicLinkEmail): Promise<void> {
    this.logger.log(
      `[magic-link] to=${email.to} expires=${email.expiresAt.toISOString()}`,
    );
    this.logger.log(`[magic-link] url=${email.url}`);
    return Promise.resolve();
  }
}
