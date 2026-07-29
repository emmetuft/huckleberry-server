import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import type { AppConfig } from '../../config/configuration.js';

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
  tokenType: string;
}

/**
 * OAuth 2.1 client that runs the authorization-code + PKCE flow against a
 * Gatekeeper instance. Uses CIMD (Client ID Metadata Document) — the
 * client_id is the URL of the metadata document hosted at
 * `MAGIC_LINK_BASE_URL/.well-known/oauth-client`. Gatekeeper fetches the
 * document on demand, so scope and redirect URI changes take effect
 * immediately by updating the document.
 *
 * For local dev against rigs (whose Gatekeeper can't reach our document),
 * set `DOMO_OAUTH_CLIENT_ID` to override the derived client_id with a
 * manually-registered value.
 */
@Injectable()
export class DomoOAuthClient {
  private readonly logger = new Logger(DomoOAuthClient.name);
  private readonly clientIdOverride: string;
  private readonly baseUrl: string;
  private readonly redirectUri: string;
  private readonly scopes: string;
  private readonly transportOverrides: Record<string, string>;

  constructor(private readonly config: ConfigService) {
    const app = this.config.get<AppConfig>('app');
    this.clientIdOverride = app?.domoOAuthClientId ?? '';
    this.baseUrl = app?.magicLinkBaseUrl ?? '';
    this.redirectUri = app?.domoOAuthRedirectUri ?? '';
    this.scopes = app?.domoOAuthScopes ?? '';
    this.transportOverrides = app?.gatekeeperTransportOverrides ?? {};

    if (app?.nodeEnv === 'production' && !this.baseUrl.startsWith('https://')) {
      throw new Error(
        `MAGIC_LINK_BASE_URL must be an HTTPS URL in production (got: ${this.baseUrl || '(unset)'})`,
      );
    }

    this.logger.log(`CIMD client_id: ${this.getClientId()}`);
  }

  /**
   * The CIMD metadata document URL, derived from MAGIC_LINK_BASE_URL. This is
   * always the derived form (never the rig override) — the served document's
   * `client_id` must equal its own URL per the CIMD spec.
   */
  getMetadataDocumentUrl(): string {
    return `${this.baseUrl}/.well-known/oauth-client`;
  }

  /**
   * Returns the OAuth client_id sent in the authorization/token flow. When
   * DOMO_OAUTH_CLIENT_ID is set, uses it verbatim (dev-only rig escape hatch).
   * Otherwise it is the CIMD metadata document URL.
   */
  getClientId(): string {
    if (this.clientIdOverride) return this.clientIdOverride;
    return this.getMetadataDocumentUrl();
  }

  /**
   * Returns the transport base URL for an issuer — used to build the actual
   * HTTP URLs for `/oauth2/authorize`, `/oauth2/token`, `/oauth2/revoke`.
   * Falls back to the issuer string itself when no override is configured.
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
    if (!this.redirectUri) {
      throw new Error('DOMO_OAUTH_REDIRECT_URI not configured');
    }
    const url = new URL(
      '/oauth2/authorize',
      this.transportFor(params.issuerUrl),
    );
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.getClientId());
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
      client_id: this.getClientId(),
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
      client_id: this.getClientId(),
    });
    return this.postToken(params.issuerUrl, body);
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
      client_id: this.getClientId(),
      ...(params.tokenTypeHint
        ? { token_type_hint: params.tokenTypeHint }
        : {}),
    });
    try {
      await fetch(url, {
        method: 'POST',
        headers: this.tokenHeaders(),
        body,
      });
    } catch (_err) {
      this.logger.debug(`revoke failed (ignored): ${String(_err)}`);
    }
  }

  /**
   * Validates that issuerUrl points to a real Gatekeeper instance that
   * supports CIMD. Fetches RFC 8414 metadata and verifies
   * `client_id_metadata_document_supported: true`. In rig-override mode
   * (DOMO_OAUTH_CLIENT_ID set), skips the CIMD check since the rig resolves
   * the client from its own store.
   */
  async validateInstance(issuerUrl: string): Promise<void> {
    const transport = this.transportFor(issuerUrl);
    const url = new URL(
      '/.well-known/oauth-authorization-server',
      transport,
    ).toString();

    this.logger.log(
      `validateInstance: probing ${url} (issuer=${issuerUrl}, transport=${transport})`,
    );

    let resp: Response;
    try {
      resp = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      this.logger.warn(
        `validateInstance: fetch failed for ${url}: ${String(err)}`,
      );
      throw new BadRequestException(
        'Could not reach the Domo instance. Check the URL and try again.',
      );
    }

    if (!resp.ok) {
      this.logger.warn(`validateInstance: ${url} returned ${resp.status}`);
      throw new BadRequestException(
        `Instance validation failed (HTTP ${resp.status}). Check the URL and try again.`,
      );
    }

    let meta: {
      issuer?: string;
      client_id_metadata_document_supported?: boolean;
    };
    try {
      meta = (await resp.json()) as typeof meta;
    } catch {
      throw new BadRequestException(
        'The URL does not appear to be a valid Domo instance.',
      );
    }

    if (!meta.issuer) {
      throw new BadRequestException(
        'The URL does not appear to be a valid Domo instance (missing OAuth metadata).',
      );
    }

    if (!this.clientIdOverride && !meta.client_id_metadata_document_supported) {
      this.logger.warn(
        `validateInstance: ${issuerUrl} does not support CIMD (client_id_metadata_document_supported missing)`,
      );
      throw new BadRequestException(
        'This Domo instance does not support CIMD. Contact your Domo administrator to enable it.',
      );
    }

    const mode = this.clientIdOverride ? 'rig override' : 'CIMD';
    this.logger.log(`validateInstance: ${issuerUrl} OK (mode: ${mode})`);
  }

  private postToken(
    issuerUrl: string,
    body: URLSearchParams,
  ): Promise<TokenResponse> {
    return this.postTokenWithHeaders(issuerUrl, body, this.tokenHeaders());
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

  private tokenHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    };
  }
}
