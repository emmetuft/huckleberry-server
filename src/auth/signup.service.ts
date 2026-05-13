import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DomoLinkService } from '../common/auth/domo-link/domo-link.service.js';
import {
  INSTANCE_PROVISIONER,
  type InstanceProvisioner,
} from '../common/auth/domo-link/instance-provisioner.service.js';
import { USER_REPOSITORY, type UserRepository } from './user.repository.js';
import type { User } from './types.js';

export interface SignupResult {
  user: User;
  /** true if a new user was created in this call; false if the email already existed. */
  created: boolean;
  /** The linked Domo instance — present whether the user was just created or already linked. */
  instance: { issuerUrl: string; customerId: string };
}

/**
 * Freemium self-service signup.
 *
 * - Find user by email → if exists, ensure a pending link row is present,
 *   return.
 * - If not, provision a Domo instance + user via the InstanceProvisioner,
 *   create the huckleberry user row in `pending_link` status, bootstrap a
 *   pending link row (no tokens yet), and return.
 *
 * The user activates their account on first sign-in by completing the
 * PKCE auth-code flow against Gatekeeper — only then do we hold a refresh
 * token and flip user.status to `active`. The BFF never holds a Domo
 * password and is not a confidential OAuth client.
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

  async ensureUser(email: string, displayName?: string): Promise<SignupResult> {
    const normalized = email.toLowerCase().trim();
    const existing = await this.users.findByEmail(normalized);

    if (existing) {
      const link = await this.link.activeLinkFor(existing.id);
      if (link) {
        return {
          user: existing,
          created: false,
          instance: {
            issuerUrl: link.issuerUrl,
            customerId: link.customerId,
          },
        };
      }
      // User exists but somehow has no link — provision one. Edge case
      // mostly relevant to mid-migration data states.
      const instance = await this.provisioner.provision(normalized);
      await this.link.bootstrapLink({
        userId: existing.id,
        issuerUrl: instance.issuerUrl,
        customerId: instance.customerId,
        scope: instance.scope,
      });
      return {
        user: existing,
        created: false,
        instance: {
          issuerUrl: instance.issuerUrl,
          customerId: instance.customerId,
        },
      };
    }

    // New user — provision instance first so we don't leave a userless row
    // behind if provisioning fails.
    const instance = await this.provisioner.provision(normalized);
    this.logger.log(
      `provisioned instance for ${normalized}: ${instance.issuerUrl} (cid=${instance.customerId})`,
    );

    const now = new Date();
    const user = await this.users.insert({
      id: randomUUID(),
      email: normalized,
      emailVerified: false,
      displayName: displayName ?? null,
      status: 'pending_link',
      createdAt: now,
      updatedAt: now,
      lastLoginAt: null,
    } satisfies User);

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
}
