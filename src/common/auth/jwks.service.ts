import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import type { AppConfig } from '../config/configuration.js';

/**
 * Multi-tenant JWKS client. Maintains one `jose.createRemoteJWKSet` per
 * configured issuer so we can serve N customers from one BFF. Each set
 * fetches the issuer's JWKS lazily on first use, caches with TTL, and
 * refetches on unknown `kid` (Gatekeeper rotates writer/incoming/outgoing
 * keys monthly).
 *
 * JWKS URI derivation: `{iss}/oauth2/jwks` unless overridden via
 * `GATEKEEPER_JWKS_URIS`. The override is needed when the issuer string
 * differs from the actual JWKS host — e.g., dev instances that sign
 * `http://host:443` issuers but expose JWKS over HTTPS.
 */
@Injectable()
export class JwksService {
  private readonly logger = new Logger(JwksService.name);
  private readonly sets = new Map<string, JWTVerifyGetKey>();
  private readonly overrides: Record<string, string>;

  constructor(private readonly config: ConfigService) {
    const app = this.config.get<AppConfig>('app');
    this.overrides = app?.gatekeeperJwksUriOverrides ?? {};
  }

  /**
   * Returns the `jose.jwtVerify` key resolver for the given issuer. Builds
   * (and caches) the remote set on first call.
   */
  getKeyResolver(issuer: string): JWTVerifyGetKey {
    const cached = this.sets.get(issuer);
    if (cached) return cached;

    const uri = this.jwksUriFor(issuer);
    this.logger.log(`Loading JWKS for ${issuer} from ${uri}`);
    const set = createRemoteJWKSet(new URL(uri), {
      cacheMaxAge: 60 * 60 * 1000, // 1h
      cooldownDuration: 30 * 1000, // throttle re-fetch on unknown kid
    });
    this.sets.set(issuer, set);
    return set;
  }

  private jwksUriFor(issuer: string): string {
    const override = this.overrides[issuer];
    if (override) return override;
    return new URL('/oauth2/jwks', issuer).toString();
  }
}
