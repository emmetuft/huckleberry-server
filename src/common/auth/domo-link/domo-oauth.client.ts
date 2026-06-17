import {
  BadGatewayException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import type { AppConfig } from '../../config/configuration.js';

export interface AuthorizeUrlParams {
  issuerUrl: string;
  redirectUri: string;
  scope: string;
  state: string;
  codeChallenge: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
  tokenType: string;
}

/**
 * OAuth 2.1 client that runs the authorization-code + PKCE flow against a
 * Gatekeeper instance. The BFF holds `client_id` (and optionally a secret
 * for confidential clients); for the labs DCR client we registered earlier
 * the client is public (`token_endpoint_auth_method: "none"`) so PKCE is
 * the only credential.
 *
 * One client today, scoped to a single issuer. Multi-customer prod will
 * extend this with a per-issuer credential lookup.
 */
@Injectable()
export class DomoOAuthClient {
  private readonly logger = new Logger(DomoOAuthClient.name);
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly scopes: string;
  private readonly transportOverrides: Record<string, string>;

  constructor(private readonly config: ConfigService) {
    const app = this.config.get<AppConfig>('app');
    this.clientId = app?.domoOAuthClientId ?? '';
    this.clientSecret = app?.domoOAuthClientSecret ?? '';
    this.redirectUri = app?.domoOAuthRedirectUri ?? '';
    this.scopes = app?.domoOAuthScopes ?? '';
    this.transportOverrides = app?.gatekeeperTransportOverrides ?? {};
  }

  /**
   * Returns the transport base URL for an issuer — used to build the actual
   * HTTP URLs for `/oauth2/authorize`, `/oauth2/token`, `/oauth2/revoke`.
   * Falls back to the issuer string itself when no override is configured.
   *
   * Needed when an issuer signs tokens with `iss = http://host:443` but the
   * endpoints are reachable over HTTPS — `iss` is a string identifier,
   * not a transport instruction.
   */
  private transportFor(issuerUrl: string): string {
    return this.transportOverrides[issuerUrl] ?? issuerUrl;
  }

  /** Generates fresh PKCE material for one flow. */
  static generatePkce(): { codeVerifier: string; codeChallenge: string } {
    // RFC 7636 §4.1: 43–128 char unreserved verifier.
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256')
      .update(codeVerifier)
      .digest('base64url');
    return { codeVerifier, codeChallenge };
  }

  /**
   * Composes the authorize URL the browser is redirected to. Caller supplies
   * `state` + `codeChallenge`; the matching `codeVerifier` must be stored
   * server-side for the callback exchange.
   */
  buildAuthorizeUrl(params: {
    issuerUrl: string;
    state: string;
    codeChallenge: string;
  }): string {
    if (!this.clientId) {
      throw new Error('DOMO_OAUTH_CLIENT_ID not configured');
    }
    if (!this.redirectUri) {
      throw new Error('DOMO_OAUTH_REDIRECT_URI not configured');
    }
    const url = new URL(
      '/oauth2/authorize',
      this.transportFor(params.issuerUrl),
    );
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri);
    url.searchParams.set('scope', this.scopes);
    url.searchParams.set('state', params.state);
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  /** Exchange the authorization `code` for access + refresh tokens. */
  async exchangeCode(params: {
    issuerUrl: string;
    code: string;
    codeVerifier: string;
  }): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: this.redirectUri,
      client_id: this.clientId,
      code_verifier: params.codeVerifier,
    });
    return this.postToken(params.issuerUrl, body);
  }

  /** Refresh — Gatekeeper enforces single-use rotation; persist both atomically. */
  async refresh(params: {
    issuerUrl: string;
    refreshToken: string;
  }): Promise<TokenResponse> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: params.refreshToken,
      client_id: this.clientId,
    });
    return this.postToken(params.issuerUrl, body);
  }

  /**
   * Dev-only: exchange a DDCI developer token for a short-lived OAuth JWT via
   * the `client_credentials` grant. The DDCI token acts as the client secret.
   * Caller is responsible for caching — this always hits the token endpoint.
   */
  async clientCredentials(params: {
    issuerUrl: string;
    clientId: string;
    clientSecret: string;
    scope: string;
  }): Promise<{ accessToken: string; expiresIn: number }> {
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      scope: params.scope,
    });
    const basic = Buffer.from(
      `${params.clientId}:${params.clientSecret}`,
    ).toString('base64');
    const url = new URL(
      '/oauth2/token',
      this.transportFor(params.issuerUrl),
    ).toString();
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          Authorization: `Basic ${basic}`,
        },
        body,
      });
    } catch (err) {
      throw new BadGatewayException(`Gatekeeper unreachable: ${String(err)}`);
    }
    const text = await resp.text();
    if (!resp.ok) {
      this.logger.warn(
        `/oauth2/token (client_credentials) ${resp.status}: ${text}`,
      );
      throw new UnauthorizedException({
        error: 'client_credentials_failed',
        status: resp.status,
      });
    }
    interface AccessJson {
      access_token: string;
      expires_in?: number;
    }
    const parsed = JSON.parse(text) as AccessJson;
    if (!parsed.access_token) {
      throw new BadGatewayException(
        `Malformed client_credentials response: ${text.slice(0, 120)}`,
      );
    }
    return {
      accessToken: parsed.access_token,
      expiresIn: parsed.expires_in ?? 3600,
    };
  }

  /** Best-effort revoke. Gatekeeper's `/oauth2/revoke` accepts either token. */
  async revoke(params: {
    issuerUrl: string;
    token: string;
    tokenTypeHint?: 'access_token' | 'refresh_token';
  }): Promise<void> {
    const url = new URL(
      '/oauth2/revoke',
      this.transportFor(params.issuerUrl),
    ).toString();
    const body = new URLSearchParams({
      token: params.token,
      client_id: this.clientId,
      ...(params.tokenTypeHint
        ? { token_type_hint: params.tokenTypeHint }
        : {}),
    });
    try {
      await fetch(url, {
        method: 'POST',
        headers: this.authHeaders(),
        body,
      });
    } catch (_err) {
      this.logger.debug(`revoke failed (ignored): ${String(_err)}`);
    }
  }

  private postToken(
    issuerUrl: string,
    body: URLSearchParams,
  ): Promise<TokenResponse> {
    return this.postTokenWithHeaders(issuerUrl, body, this.authHeaders());
  }

  private async postTokenWithHeaders(
    issuerUrl: string,
    body: URLSearchParams,
    headers: Record<string, string>,
  ): Promise<TokenResponse> {
    const url = new URL(
      '/oauth2/token',
      this.transportFor(issuerUrl),
    ).toString();
    let resp: Response;
    try {
      resp = await fetch(url, { method: 'POST', headers, body });
    } catch (err) {
      throw new BadGatewayException(`Gatekeeper unreachable: ${String(err)}`);
    }

    const text = await resp.text();
    if (!resp.ok) {
      // `invalid_grant` from Gatekeeper means the code/refresh is dead — for
      // refresh-token replay this is also Gatekeeper's cascade-revoke signal.
      this.logger.warn(`/oauth2/token ${resp.status}: ${text}`);
      throw new UnauthorizedException({
        error: 'token_exchange_failed',
        error_description: text,
        status: resp.status,
      });
    }

    interface TokenJson {
      access_token: string;
      refresh_token: string;
      expires_in: number;
      scope: string;
      token_type: string;
    }
    let parsed: TokenJson;
    try {
      parsed = JSON.parse(text) as TokenJson;
    } catch {
      throw new BadGatewayException(
        `Malformed token response from Gatekeeper: ${text.slice(0, 120)}`,
      );
    }

    if (!parsed.access_token || !parsed.refresh_token) {
      throw new BadGatewayException(
        'Token response missing access_token or refresh_token',
      );
    }

    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token,
      expiresIn: parsed.expires_in,
      scope: parsed.scope,
      tokenType: parsed.token_type,
    };
  }

  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };
    if (this.clientSecret) {
      const basic = Buffer.from(
        `${this.clientId}:${this.clientSecret}`,
      ).toString('base64');
      headers.Authorization = `Basic ${basic}`;
    }
    return headers;
  }
}
