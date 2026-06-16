import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DomoLinkService } from '../common/auth/domo-link/domo-link.service.js';
import {
  INSTANCE_PROVISIONER,
  type InstanceProvisioner,
} from '../common/auth/domo-link/instance-provisioner.service.js';
import { USER_REPOSITORY, type UserRepository } from './user.repository.js';
import type { User, UserStatus } from './types.js';

export type SignupPath = 'new' | 'existing';

export interface SignupResult {
  user: User;
  created: boolean;
  instance: { issuerUrl: string; customerId: string } | null;
}

/**
 * Dual-path signup:
 *
 * - **"new"** — user doesn't have a Domo instance. Provision one via
 *   InstanceProvisioner, create user as `pending_link` with a bootstrap
 *   link row.
 *
 * - **"existing"** — user has a Domo instance. Create user as `pending_link`
 *   with a bootstrap link row using their provided instanceUrl. DCR happens
 *   later when they click "Connect" (inside `link/start`).
 */
@Injectable()
export class SignupService {
  private readonly logger = new Logger(SignupService.name);

  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    private readonly link: DomoLinkService,
    @Inject(INSTANCE_PROVISIONER)
    private readonly provisioner: InstanceProvisioner,
  ) {}

  async ensureUser(
    email: string,
    opts?: { path?: SignupPath; instanceUrl?: string; displayName?: string },
  ): Promise<SignupResult> {
    const normalized = email.toLowerCase().trim();
    const path = opts?.path ?? 'new';
    const existing = await this.users.findByEmail(normalized);

    if (existing) {
      const link = await this.link.activeLinkFor(existing.id);
      return {
        user: existing,
        created: false,
        instance: link
          ? { issuerUrl: link.issuerUrl, customerId: link.customerId }
          : null,
      };
    }

    if (path === 'existing') {
      return this.signupExistingInstance(normalized, opts);
    }

    return this.signupNewInstance(normalized, opts);
  }

  private async signupNewInstance(
    email: string,
    opts?: { displayName?: string },
  ): Promise<SignupResult> {
    const instance = await this.provisioner.provision(email);
    this.logger.log(
      `provisioned instance for ${email}: ${instance.issuerUrl} (cid=${instance.customerId})`,
    );

    const user = await this.createUser(
      email,
      'pending_link',
      opts?.displayName,
    );

    await this.link.bootstrapLink({
      userId: user.id,
      issuerUrl: instance.issuerUrl,
      customerId: instance.customerId,
      scope: instance.scope,
    });

    return {
      user,
      created: true,
      instance: {
        issuerUrl: instance.issuerUrl,
        customerId: instance.customerId,
      },
    };
  }

  private async signupExistingInstance(
    email: string,
    opts?: { instanceUrl?: string; displayName?: string },
  ): Promise<SignupResult> {
    if (!opts?.instanceUrl) {
      throw new BadRequestException(
        'instanceUrl is required when path is "existing"',
      );
    }

    await this.link.validateInstance(opts.instanceUrl);

    const user = await this.createUser(email, 'pending_link', opts.displayName);

    await this.link.bootstrapLink({
      userId: user.id,
      issuerUrl: opts.instanceUrl,
      customerId: '',
      scope: '',
    });

    return {
      user,
      created: true,
      instance: { issuerUrl: opts.instanceUrl, customerId: '' },
    };
  }

  private async createUser(
    email: string,
    status: UserStatus,
    displayName?: string,
  ): Promise<User> {
    const now = new Date();
    return this.users.insert({
      id: randomUUID(),
      email,
      emailVerified: false,
      displayName: displayName ?? null,
      status,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
    } satisfies User);
  }
}
