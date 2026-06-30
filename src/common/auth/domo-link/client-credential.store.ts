import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration.js';

export interface OAuthClientCredentials {
  issuerUrl: string;
  clientId: string;
  registrationAccessToken: string | null;
  redirectUri: string;
  scope: string;
  registeredAt: Date;
  lastUsedAt: Date | null;
}

export interface ClientCredentialStore {
  get(issuerUrl: string): Promise<OAuthClientCredentials | null>;
  upsert(record: OAuthClientCredentials): Promise<OAuthClientCredentials>;
  delete(issuerUrl: string): Promise<void>;
  touchLastUsed(issuerUrl: string): Promise<void>;
}

export const CLIENT_CREDENTIAL_STORE = Symbol('ClientCredentialStore');

/**
 * In-memory store with env-var fallback for local dev. When the configured
 * dev instance issuerUrl is requested but not in the map, returns a synthetic
 * entry from `DOMO_OAUTH_CLIENT_ID` / `DOMO_OAUTH_REDIRECT_URI` / `DOMO_OAUTH_SCOPES`.
 */
@Injectable()
export class InMemoryClientCredentialStore implements ClientCredentialStore {
  private readonly byIssuer = new Map<string, OAuthClientCredentials>();
  private readonly devFallback: OAuthClientCredentials | null;

  constructor(@Inject(ConfigService) config: ConfigService) {
    const app = config.get<AppConfig>('app');
    const devIssuer = app?.devInstanceIssuerUrl;
    const devClientId = app?.domoOAuthClientId;
    if (devIssuer && devClientId) {
      this.devFallback = {
        issuerUrl: devIssuer,
        clientId: devClientId,
        registrationAccessToken: null,
        redirectUri: app?.domoOAuthRedirectUri ?? '',
        scope: app?.domoOAuthScopes ?? '',
        registeredAt: new Date(0),
        lastUsedAt: null,
      };
    } else {
      this.devFallback = null;
    }
  }

  get(issuerUrl: string): Promise<OAuthClientCredentials | null> {
    const stored = this.byIssuer.get(issuerUrl);
    if (stored) return Promise.resolve(stored);
    if (this.devFallback && this.devFallback.issuerUrl === issuerUrl) {
      return Promise.resolve(this.devFallback);
    }
    return Promise.resolve(null);
  }

  upsert(record: OAuthClientCredentials): Promise<OAuthClientCredentials> {
    this.byIssuer.set(record.issuerUrl, record);
    return Promise.resolve(record);
  }

  delete(issuerUrl: string): Promise<void> {
    this.byIssuer.delete(issuerUrl);
    return Promise.resolve();
  }

  touchLastUsed(issuerUrl: string): Promise<void> {
    const record = this.byIssuer.get(issuerUrl);
    if (record) {
      this.byIssuer.set(issuerUrl, { ...record, lastUsedAt: new Date() });
    }
    return Promise.resolve();
  }
}
