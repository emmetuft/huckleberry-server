import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { createTransport, Transporter } from 'nodemailer';
import type { AppConfig } from '../common/config/configuration.js';

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
 * email. Selected when `SMTP_HOST` is unset. Useful for tests and the
 * "I just want to grab the URL and click it" loop.
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

/**
 * SMTP impl — sends a real email via nodemailer. In local dev `SMTP_HOST`
 * points at Mailpit (`localhost:1025` from the host, `mailpit:1025` from
 * another container), which captures every outgoing email and serves them
 * at http://localhost:8025. In prod, point at SES's SMTP endpoint.
 *
 * The same EmailService interface backs both — switching providers is a
 * DI-level decision in HuckleberryAuthModule.
 */
@Injectable()
export class SmtpEmailService implements EmailService {
  private readonly logger = new Logger(SmtpEmailService.name);
  private readonly transporter: Transporter;
  private readonly fromAddress: string;

  constructor(@Inject(ConfigService) config: ConfigService) {
    const app = config.get<AppConfig>('app');
    const host = app?.smtpHost ?? 'localhost';
    const port = app?.smtpPort ?? 1025;
    this.fromAddress = app?.smtpFrom ?? 'huckleberry@example.com';
    this.transporter = createTransport({
      host,
      port,
      // Mailpit accepts unauth + plaintext on :1025; SES requires both.
      secure: app?.smtpSecure ?? false,
      auth:
        app?.smtpUser && app?.smtpPass
          ? { user: app.smtpUser, pass: app.smtpPass }
          : undefined,
    });
    this.logger.log(
      `SMTP transport ready — host=${host}:${port} from=${this.fromAddress}`,
    );
  }

  async sendMagicLink(email: MagicLinkEmail): Promise<void> {
    const expiresMins = Math.round(
      (email.expiresAt.getTime() - Date.now()) / 60_000,
    );
    await this.transporter.sendMail({
      from: this.fromAddress,
      to: email.to,
      subject: 'Your huckleberry sign-in link',
      text: textBody(email.url, expiresMins),
      html: htmlBody(email.url, expiresMins),
    });
    this.logger.log(
      `[magic-link] sent to=${email.to} expires=${email.expiresAt.toISOString()}`,
    );
  }
}

/**
 * SES v2 impl — sends via the SES API using the standard AWS credential chain
 * (IRSA on EKS, AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY locally). Selected
 * when `SES_FROM` is set. No SMTP credentials required.
 */
@Injectable()
export class SesEmailService implements EmailService {
  private readonly logger = new Logger(SesEmailService.name);
  private readonly client: SESv2Client;
  private readonly fromAddress: string;

  constructor(@Inject(ConfigService) config: ConfigService) {
    const app = config.get<AppConfig>('app');
    this.fromAddress = app?.sesFrom ?? '';
    this.client = new SESv2Client({ region: app?.sesRegion ?? undefined });
    this.logger.log(`SES transport ready — from=${this.fromAddress}`);
  }

  async sendMagicLink(email: MagicLinkEmail): Promise<void> {
    const expiresMins = Math.round(
      (email.expiresAt.getTime() - Date.now()) / 60_000,
    );
    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.fromAddress,
        Destination: { ToAddresses: [email.to] },
        Content: {
          Simple: {
            Subject: { Data: 'Your huckleberry sign-in link' },
            Body: {
              Text: { Data: textBody(email.url, expiresMins) },
              Html: { Data: htmlBody(email.url, expiresMins) },
            },
          },
        },
      }),
    );
    this.logger.log(
      `[magic-link] sent to=${email.to} expires=${email.expiresAt.toISOString()}`,
    );
  }
}

function textBody(url: string, expiresMins: number): string {
  return [
    `Click to sign in to huckleberry:`,
    ``,
    url,
    ``,
    `This link expires in ${expiresMins} minutes and can only be used once.`,
    `If you didn't request this, you can ignore the email.`,
  ].join('\n');
}

function htmlBody(url: string, expiresMins: number): string {
  return `<!doctype html>
<html><body style="font-family: -apple-system, system-ui, sans-serif; max-width: 480px; margin: 2rem auto; line-height: 1.5;">
  <h1 style="font-size: 1.25rem;">Sign in to huckleberry</h1>
  <p><a href="${url}" style="display: inline-block; background: #111; color: #fff; padding: 0.75rem 1.25rem; border-radius: 6px; text-decoration: none;">Sign in</a></p>
  <p style="color: #666; font-size: 0.875rem;">Or copy this URL into your browser:</p>
  <p style="font-family: ui-monospace, Menlo, monospace; font-size: 0.75rem; word-break: break-all; color: #444;">${url}</p>
  <p style="color: #888; font-size: 0.75rem;">Expires in ${expiresMins} minutes. Single-use. If you didn't request this, you can ignore the email.</p>
</body></html>`;
}
