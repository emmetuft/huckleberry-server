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
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';
import type { AppConfig } from '../common/config/configuration.js';
import { AuthService } from './auth.service.js';
import { USER_REPOSITORY, type UserRepository } from './user.repository.js';
import type { User } from './types.js';
import { Public } from '../common/auth/decorators/public.decorator.js';
import { DomoLinkService } from '../common/auth/domo-link/domo-link.service.js';
import {
  INSTANCE_PROVISIONER,
  type InstanceProvisioner,
} from '../common/auth/domo-link/instance-provisioner.service.js';

class OnboardUserDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  displayName?: string;
}

/**
 * Operator admin endpoints — protected by `ADMIN_API_KEY` header.
 *
 * `POST /admin/users` is the operator-driven onboarding flow: provisions
 * a Domo instance + user (stubbed in dev), creates the huckleberry user
 * row in `pending_link` status, seeds a pending Domo-link row, and sends
 * the magic-link email. On first sign-in the user runs the PKCE auth-code
 * flow against Gatekeeper, which mints the refresh token we then store.
 *
 * Disabled when `ADMIN_API_KEY` is empty.
 */
@ApiTags('Admin')
@Controller('admin')
export class AdminController {
  private readonly adminApiKey: string;

  constructor(
    config: ConfigService,
    private readonly auth: AuthService,
    private readonly link: DomoLinkService,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(INSTANCE_PROVISIONER)
    private readonly provisioner: InstanceProvisioner,
  ) {
    const app = config.get<AppConfig>('app');
    this.adminApiKey = app?.adminApiKey ?? '';
  }

  @Public()
  @Post('users')
  async onboard(
    @Headers('x-admin-api-key') key: string | undefined,
    @Body() dto: OnboardUserDto,
  ): Promise<{
    userId: string;
    message: string;
    instance: { issuerUrl: string; customerId: string };
    magicLinkUrl?: string;
  }> {
    this.assertAuthorized(key);

    // 1. Provision the Domo instance + user (stub in dev — returns the
    //    configured dev instance metadata).
    const instance = await this.provisioner.provision(dto.email);

    // 2. Find-or-create the huckleberry user.
    const existing = await this.users.findByEmail(dto.email);
    let user = existing;
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
      message = 'user created and linked to provisioned Domo instance';
    }

    // 3. Bootstrap the pending Domo link and flip the user to active so they
    //    skip the browser-side PKCE dance on first sign-in (operator-managed
    //    provisioning = no user consent step needed).
    const existingLink = await this.link.activeLinkFor(user.id);
    if (!existingLink) {
      await this.link.bootstrapLink({
        userId: user.id,
        issuerUrl: instance.issuerUrl,
        customerId: instance.customerId,
        scope: instance.scope,
      });
    }
    user = await this.users.updateStatus(user.id, 'active');

    // 4. Send magic-link email.
    const url = await this.auth.requestMagicLink(user.email, null);

    const includeUrl = process.env.NODE_ENV !== 'production';
    return {
      userId: user.id,
      message,
      instance: {
        issuerUrl: instance.issuerUrl,
        customerId: instance.customerId,
      },
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
