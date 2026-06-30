import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration.js';

/**
 * Multi-tenant issuer allowlist + customer-id parser.
 *
 * One huckleberry deployment serves many Domo customers; each customer lives
 * on its own instance (`https://{customer}.domo.com`) and Gatekeeper signs
 * tokens with `iss` set to that instance. We accept any token whose `iss`
 * appears in our allowlist and reject everything else before any crypto
 * runs.
 *
 * Storage today is env-driven (`GATEKEEPER_ISSUERS=...`). The same interface
 * will be backed by an Aurora `tenants` table once the Aurora connection
 * layer lands — consumers won't change. See `docs/authentication.md`
 * § Multi-tenant issuer registry.
 */
@Injectable()
export class KnownTenantsService {
  private readonly logger = new Logger(KnownTenantsService.name);
  private readonly allowedIssuers: Set<string>;

  constructor(private readonly config: ConfigService) {
    const app = this.config.get<AppConfig>('app');
    this.allowedIssuers = new Set(app?.gatekeeperIssuers ?? []);
    if (this.allowedIssuers.size === 0) {
      this.logger.warn(
        'No issuers configured — set GATEKEEPER_ISSUERS or DOMO_INSTANCE_URL',
      );
    } else {
      this.logger.log(
        `Accepting tokens from ${this.allowedIssuers.size} issuer(s): ${Array.from(this.allowedIssuers).join(', ')}`,
      );
    }
  }

  /**
   * Validates that an issuer is on the allowlist. Throws
   * `UnauthorizedException` otherwise. No customer-id derivation here —
   * callers should prefer the JWT's `cid` claim for customer identity.
   */
  assertAllowed(issuer: string | undefined): void {
    if (!issuer) {
      throw new UnauthorizedException('missing iss claim');
    }
    if (!this.allowedIssuers.has(issuer)) {
      throw new UnauthorizedException(`unknown tenant issuer: ${issuer}`);
    }
  }

  isAllowed(issuer: string): boolean {
    return this.allowedIssuers.has(issuer);
  }

  register(issuer: string): void {
    if (this.allowedIssuers.has(issuer)) return;
    this.allowedIssuers.add(issuer);
    this.logger.log(`Dynamically registered issuer: ${issuer}`);
  }

  /**
   * Subdomain-based fallback for deriving a customer slug from an issuer
   * URL. Only used when the JWT has no `cid` claim (shouldn't happen against
   * real Gatekeeper). Kept for defensive symmetry.
   */
  parseCustomerId(issuer: string): string {
    let host: string;
    try {
      host = new URL(issuer).hostname;
    } catch {
      throw new UnauthorizedException(`malformed iss claim: ${issuer}`);
    }
    const firstLabel = host.split('.')[0];
    if (!firstLabel) {
      throw new UnauthorizedException(`cannot derive customerId from ${host}`);
    }
    return firstLabel;
  }

  /** Returns the configured issuer list. Exposed for tests + audit + JWKS routing. */
  list(): string[] {
    return Array.from(this.allowedIssuers);
  }
}
