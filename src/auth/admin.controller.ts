import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Inject,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { IsEmail, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import type { AppConfig } from '../common/config/configuration.js';
import { AuthService } from './auth.service.js';
import { USER_REPOSITORY, type UserRepository } from './user.repository.js';
import type { User } from './types.js';
import { Public } from '../common/auth/decorators/public.decorator.js';

class OnboardUserDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsUrl({ require_tld: false })
  @MaxLength(255)
  issuerUrl!: string;

  @IsString()
  @MaxLength(64)
  customerId!: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  displayName?: string;
}

/**
 * Operator admin endpoints — protected by `ADMIN_API_KEY` header (not the
 * huckleberry session). Use these to seed users during onboarding while
 * Aurora isn't wired and there is no persistent store across processes.
 *
 * Disabled entirely when `ADMIN_API_KEY` is empty.
 */
@ApiTags('Admin')
@Controller('admin')
export class AdminController {
  private readonly adminApiKey: string;

  constructor(
    config: ConfigService,
    private readonly auth: AuthService,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
  ) {
    const app = config.get<AppConfig>('app');
    this.adminApiKey = app?.adminApiKey ?? '';
  }

  @Public()
  @Post('users')
  async onboard(
    @Headers('x-admin-api-key') key: string | undefined,
    @Body() dto: OnboardUserDto,
  ): Promise<{ userId: string; message: string; magicLinkUrl?: string }> {
    this.assertAuthorized(key);

    let user = await this.users.findByEmail(dto.email);
    let message: string;
    if (user) {
      message = 'user already exists; re-sent magic link';
    } else {
      const now = new Date();
      user = await this.users.insert({
        id: randomUUID(),
        email: dto.email.toLowerCase().trim(),
        emailVerified: false,
        displayName: dto.displayName ?? null,
        status: 'pending_link',
        createdAt: now,
        updatedAt: now,
        lastLoginAt: null,
      } satisfies User);
      message = 'user created in pending_link state';
    }

    // TODO(layer-b): also seed `linked_domo_instances` stub using
    //   { dto.issuerUrl, dto.customerId } once the linkage table is wired.

    const url = await this.auth.requestMagicLink(user.email, null);

    // In dev, return the URL so callers (CLI/demo script) don't have to
    // scrape it out of the BFF logs. In production, omit it — the URL is
    // a single-use credential and should only travel via SES.
    const includeUrl = process.env.NODE_ENV !== 'production';
    return {
      userId: user.id,
      message,
      ...(includeUrl && url ? { magicLinkUrl: url } : {}),
    };
  }

  private assertAuthorized(key: string | undefined): void {
    if (!this.adminApiKey) {
      throw new ServiceUnavailableException(
        'admin endpoints disabled — ADMIN_API_KEY is not configured',
      );
    }
    if (!key || !constantTimeEqual(key, this.adminApiKey)) {
      throw new ForbiddenException();
    }
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
