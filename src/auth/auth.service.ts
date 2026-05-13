import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import type { AppConfig } from '../common/config/configuration.js';
import { EMAIL_SERVICE, type EmailService } from './email.service.js';
import {
  MAGIC_LINK_REPOSITORY,
  type MagicLinkRepository,
} from './magic-link.repository.js';
import { USER_REPOSITORY, type UserRepository } from './user.repository.js';
import type { MagicLink, User } from './types.js';

/** Result of consuming a magic link — exposes whether linkage is still pending. */
export interface ConsumeResult {
  user: User;
  needsLinkage: boolean;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly ttlSeconds: number;
  private readonly baseUrl: string;

  constructor(
    config: ConfigService,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(MAGIC_LINK_REPOSITORY)
    private readonly magicLinks: MagicLinkRepository,
    @Inject(EMAIL_SERVICE) private readonly email: EmailService,
  ) {
    const app = config.get<AppConfig>('app');
    this.ttlSeconds = app?.magicLinkTtlSeconds ?? 900;
    this.baseUrl = app?.magicLinkBaseUrl ?? 'http://localhost:3000';
  }

  /**
   * Issues a magic-link email for a user. Always returns silently — even if
   * the email isn't on file — to avoid leaking account existence. The email
   * is sent only when a matching user is found.
   */
  async requestMagicLink(
    email: string,
    ipIssuedFrom: string | null,
  ): Promise<string | null> {
    const user = await this.users.findByEmail(email);
    if (!user) {
      this.logger.debug(`magic-link request for unknown email (silent)`);
      return null;
    }
    if (user.status === 'suspended') {
      this.logger.debug(
        `magic-link request for suspended user ${user.id} (silent)`,
      );
      return null;
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = sha256Hex(rawToken);
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);

    const link: MagicLink = {
      tokenHash,
      userId: user.id,
      expiresAt,
      consumedAt: null,
      ipIssuedFrom,
    };
    await this.magicLinks.insert(link);

    const url = this.buildMagicLinkUrl(rawToken);
    await this.email.sendMagicLink({ to: user.email, url, expiresAt });
    return url;
  }

  /**
   * Composes the magic-link URL pointing at the SPA's signin route.
   * The SPA reads `?token=...` and calls the BFF's `/api/auth/signin?token=...`
   * via fetch — that way the cookie is set on the SPA's origin and stays
   * same-origin throughout the session.
   */
  private buildMagicLinkUrl(rawToken: string): string {
    const base = this.baseUrl.replace(/\/+$/, '');
    return `${base}/auth/signin?token=${rawToken}`;
  }

  /**
   * Validates + consumes a raw magic-link token. Atomic — the token is
   * usable exactly once. Marks the user verified on first successful use.
   * Returns the user and whether they still need to complete Domo linkage.
   */
  async consumeMagicLink(rawToken: string): Promise<ConsumeResult> {
    if (!rawToken || rawToken.length < 16) {
      throw new BadRequestException('invalid_or_expired_token');
    }
    const tokenHash = sha256Hex(rawToken);
    const link = await this.magicLinks.consume(tokenHash, new Date());
    if (!link) {
      throw new BadRequestException('invalid_or_expired_token');
    }
    let user = await this.users.findById(link.userId);
    if (!user || user.status === 'suspended') {
      throw new BadRequestException('invalid_or_expired_token');
    }
    if (!user.emailVerified) {
      user = await this.users.markEmailVerified(user.id);
    }
    user = await this.users.touchLastLogin(user.id);
    return { user, needsLinkage: user.status === 'pending_link' };
  }
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
