import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration.js';

/**
 * Result of provisioning a Domo instance + user for a new huckleberry signup.
 *
 * Only instance metadata is returned. No service credentials, no Domo user
 * passwords — those are owned by Domo. The huckleberry BFF is a public
 * PKCE OAuth client, so it doesn't hold a Domo client_secret.
 *
 * After provisioning, the user authenticates to Domo via the PKCE auth-code
 * flow (browser → Domo → consent → callback). The BFF then stores a per-user
 * refresh token. The provisioning credential is never persisted.
 */
export interface ProvisionedInstance {
  issuerUrl: string; // matches the `iss` claim Gatekeeper signs
  customerId: string;
  /** Scopes the BFF will request on the user's behalf during the PKCE flow. */
  scope: string;
}

/**
 * Provisioning interface. Real impl calls Domo's freemium-provisioning API
 * to mint a tenant + create the user account, then returns the instance
 * metadata. Dev impl is a stub that returns the existing dev instance.
 *
 * Implementations may hold a high-power provisioning credential to call
 * Domo's admin API. That credential never leaves the BFF process — it's
 * not persisted on any link row, not exposed to the SPA, and not part of
 * the per-customer record.
 */
export interface InstanceProvisioner {
  /**
   * @param email The huckleberry user's email — also used as the Domo
   *              user's identity in prod.
   */
  provision(email: string): Promise<ProvisionedInstance>;
}

export const INSTANCE_PROVISIONER = Symbol('InstanceProvisioner');

@Injectable()
export class DevStubInstanceProvisioner implements InstanceProvisioner {
  private readonly issuerUrl: string;
  private readonly customerId: string;
  private readonly scope: string;

  constructor(config: ConfigService) {
    const app = config.get<AppConfig>('app');
    this.issuerUrl = app?.devInstanceIssuerUrl ?? '';
    this.customerId = app?.devInstanceCustomerId ?? '';
    this.scope = app?.devInstanceScopes ?? '';
  }

  provision(email: string): Promise<ProvisionedInstance> {
    void email;
    if (!this.issuerUrl || !this.customerId) {
      return Promise.reject(
        new ServiceUnavailableException(
          'Dev instance provisioner not configured. Set DEV_INSTANCE_ISSUER_URL and DEV_INSTANCE_CUSTOMER_ID.',
        ),
      );
    }
    // Real impl: also call Domo's user-creation API here using a
    // provisioning credential held in env / Secrets Manager. Dev assumes
    // the dev instance already has signin-capable users.
    return Promise.resolve({
      issuerUrl: this.issuerUrl,
      customerId: this.customerId,
      scope: this.scope,
    });
  }
}
