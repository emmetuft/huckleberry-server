import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import type { AppConfig } from '../../config/configuration.js';
import {
  CLIENT_CREDENTIAL_STORE,
  type ClientCredentialStore,
} from './client-credential.store.js';

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

export interface DcrResponse {
  clientId: string;
  registrationAccessToken: string | null;
  scope: string;
}

/**
 * OAuth 2.1 client that runs the authorization-code + PKCE flow against a
 * Gatekeeper instance. Resolves per-instance credentials from the
 * ClientCredentialStore (populated by DCR at provision time), with env-var
 * fallback for local dev.
 */
@Injectable()
export class DomoOAuthClient {
  private readonly logger = new Logger(DomoOAuthClient.name);
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly scopes: string;
  private readonly transportOverrides: Record<string, string>;

  constructor(
    private readonly config: ConfigService,
    @Inject(CLIENT_CREDENTIAL_STORE)
    private readonly credentials: ClientCredentialStore,
  ) {
    const app = this.config.get<AppConfig>('app');
    this.clientId = app?.domoOAuthClientId ?? '';
    this.clientSecret = app?.domoOAuthClientSecret ?? '';
    this.redirectUri = app?.domoOAuthRedirectUri ?? '';
    this.scopes = app?.domoOAuthScopes ?? '';
    this.transportOverrides = app?.gatekeeperTransportOverrides ?? {};
  }

  /**
   * Resolves the client_id for a given issuerUrl. Checks the credential
   * store first (DCR-registered or dev-fallback), falls back to the
   * global env-var `DOMO_OAUTH_CLIENT_ID` for backwards compatibility.
   */
  private async resolveClientId(issuerUrl: string): Promise<string> {
    const cred = await this.credentials.get(issuerUrl);
    if (cred) return cred.clientId;
    if (this.clientId) return this.clientId;
    throw new Error(
      `No OAuth client registered for issuer ${issuerUrl} and DOMO_OAUTH_CLIENT_ID is not set`,
    );
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

  getRedirectUri(): string {
    return this.redirectUri;
  }

  /**
   * Composes the authorize URL the browser is redirected to. Caller supplies
   * `state` + `codeChallenge`; the matching `codeVerifier` must be stored
   * server-side for the callback exchange.
   */
  async buildAuthorizeUrl(params: {
    issuerUrl: string;
    state: string;
    codeChallenge: string;
  }): Promise<string> {
    const clientId = await this.resolveClientId(params.issuerUrl);
    if (!this.redirectUri) {
      throw new Error('DOMO_OAUTH_REDIRECT_URI not configured');
    }
    const url = new URL(
      '/oauth2/authorize',
      this.transportFor(params.issuerUrl),
    );
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
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
    const clientId = await this.resolveClientId(params.issuerUrl);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: params.code,
      redirect_uri: this.redirectUri,
      client_id: clientId,
      code_verifier: params.codeVerifier,
    });
    return this.postToken(params.issuerUrl, body);
  }

  /** Refresh — Gatekeeper enforces single-use rotation; persist both atomically. */
  async refresh(params: {
    issuerUrl: string;
    refreshToken: string;
  }): Promise<TokenResponse> {
    const clientId = await this.resolveClientId(params.issuerUrl);
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: params.refreshToken,
      client_id: clientId,
    });
    return this.postToken(params.issuerUrl, body);
  }

  /** Best-effort revoke. Gatekeeper's `/oauth2/revoke` accepts either token. */
  async revoke(params: {
    issuerUrl: string;
    token: string;
    tokenTypeHint?: 'access_token' | 'refresh_token';
  }): Promise<void> {
    let clientId: string;
    try {
      clientId = await this.resolveClientId(params.issuerUrl);
    } catch {
      this.logger.debug('revoke skipped — no client_id resolvable');
      return;
    }
    const url = new URL(
      '/oauth2/revoke',
      this.transportFor(params.issuerUrl),
    ).toString();
    const body = new URLSearchParams({
      token: params.token,
      client_id: clientId,
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

  /**
   * Validates that issuerUrl points to a real Gatekeeper instance by
   * fetching its RFC 8414 metadata. Throws BadRequestException with a
   * user-facing message if the instance is unreachable or not a
   * Gatekeeper.
   */
  async validateInstance(issuerUrl: string): Promise<void> {
    const url = new URL(
      '/.well-known/oauth-authorization-server',
      this.transportFor(issuerUrl),
    ).toString();

    let resp: Response;
    try {
      resp = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new BadRequestException(
        'Could not reach the Domo instance. Check the URL and try again.',
      );
    }

    if (!resp.ok) {
      throw new BadRequestException(
        'The URL does not appear to be a valid Domo instance.',
      );
    }

    let meta: { issuer?: string; registration_endpoint?: string };
    try {
      meta = (await resp.json()) as typeof meta;
    } catch {
      throw new BadRequestException(
        'The URL does not appear to be a valid Domo instance.',
      );
    }

    if (!meta.issuer || !meta.registration_endpoint) {
      throw new BadRequestException(
        'The URL does not appear to be a valid Domo instance (missing OAuth metadata).',
      );
    }
  }

  /**
   * Register huckleberry as a public PKCE OAuth client on a Gatekeeper
   * instance via RFC 7591 Dynamic Client Registration.
   *
   * Returns the `client_id` and `registration_access_token` (for future
   * RFC 7592 self-management). The registration_access_token is displayed
   * exactly once — Gatekeeper stores a BCrypt hash.
   */
  async registerClient(issuerUrl: string): Promise<DcrResponse> {
    if (!this.redirectUri) {
      throw new Error('DOMO_OAUTH_REDIRECT_URI not configured');
    }
    const url = new URL(
      '/oauth2/register',
      this.transportFor(issuerUrl),
    ).toString();

    const body = {
      client_name: 'huckleberry',
      redirect_uris: [this.redirectUri],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: this.scopes,
    };

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new BadGatewayException(
        `Gatekeeper DCR endpoint unreachable: ${String(err)}`,
      );
    }

    const text = await resp.text();
    if (!resp.ok) {
      this.logger.warn(`DCR ${resp.status}: ${text}`);
      throw new BadGatewayException(
        `DCR failed (${resp.status}): ${text.slice(0, 200)}`,
      );
    }

    interface DcrJson {
      client_id: string;
      registration_access_token?: string;
      client_id_issued_at?: number;
      scope?: string;
    }
    let parsed: DcrJson;
    try {
      parsed = JSON.parse(text) as DcrJson;
    } catch {
      throw new BadGatewayException(
        `Malformed DCR response from Gatekeeper: ${text.slice(0, 120)}`,
      );
    }

    if (!parsed.client_id) {
      throw new BadGatewayException('DCR response missing client_id');
    }

    this.logger.log(
      `DCR registered client ${parsed.client_id} on ${issuerUrl}`,
    );

    return {
      clientId: parsed.client_id,
      registrationAccessToken: parsed.registration_access_token ?? null,
      scope: parsed.scope ?? this.scopes,
    };
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
