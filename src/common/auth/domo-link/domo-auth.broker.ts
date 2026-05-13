import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DOMO_TOKEN_STORE, type DomoTokenStore } from './token.store.js';
import { LINK_REPOSITORY, type LinkRepository } from './link.repository.js';
import { DomoOAuthClient, type TokenResponse } from './domo-oauth.client.js';

/**
 * The one place app code asks for a Domo Bearer.
 *
 * Behavior:
 *   - In-memory access-token cache keyed by `linkId` (TTL = `expires_in - 60`).
 *   - On miss / expiry, calls Gatekeeper's `/oauth2/token` with the stored
 *     refresh token, persists the rotated pair atomically, caches the new
 *     access token.
 *   - On refresh failure (Gatekeeper's `invalid_grant`, including the
 *     cascade-revoke replay signal), surfaces an `UnauthorizedException` so
 *     the upstream service can return a re-link prompt to the user.
 *
 * Single-flight semantics — concurrent requests for the same `linkId` share
 * one in-flight refresh promise so we don't burn refresh-rotation budget.
 */
interface CachedAccess {
  accessToken: string;
  expiresAt: number; // epoch ms
}

@Injectable()
export class DomoAuthBroker {
  private readonly logger = new Logger(DomoAuthBroker.name);
  private readonly cache = new Map<string, CachedAccess>();
  private readonly inFlight = new Map<string, Promise<string>>();

  constructor(
    @Inject(LINK_REPOSITORY) private readonly links: LinkRepository,
    @Inject(DOMO_TOKEN_STORE) private readonly tokens: DomoTokenStore,
    private readonly client: DomoOAuthClient,
  ) {}

  /**
   * Returns a fresh access token for the link. Caller is expected to pass
   * the token straight through to `DomoProxyService` and not store it.
   */
  async tokenFor(linkId: string): Promise<string> {
    const cached = this.cache.get(linkId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.accessToken;
    }

    const existing = this.inFlight.get(linkId);
    if (existing !== undefined) return existing;

    const promise = this.refresh(linkId).finally(() => {
      this.inFlight.delete(linkId);
    });
    this.inFlight.set(linkId, promise);
    return promise;
  }

  /** Used by tests + by the link callback to seed the first access token. */
  cacheAccessToken(
    linkId: string,
    accessToken: string,
    expiresIn: number,
  ): void {
    this.cache.set(linkId, {
      accessToken,
      // Refresh 60s before expiry so we never hand out a token that's about
      // to die mid-request.
      expiresAt: Date.now() + Math.max(0, expiresIn - 60) * 1000,
    });
  }

  /** Drops the cached access token (after revoke / unlink). */
  invalidate(linkId: string): void {
    this.cache.delete(linkId);
  }

  /**
   * Refresh the user's Domo access token. Exchanges the stored refresh
   * token via the auth-code grant — Gatekeeper enforces single-use
   * rotation, so persistence must be atomic with the exchange call.
   *
   * If the refresh fails (revoked, expired, replayed → cascade-revoke),
   * surface `UnauthorizedException` and let the upstream service prompt
   * the user to re-link via a fresh PKCE flow.
   */
  private async refresh(linkId: string): Promise<string> {
    const link = await this.links.findById(linkId);
    if (!link) {
      throw new NotFoundException(`unknown link ${linkId}`);
    }
    const tokens = await this.tokens.get(linkId);
    if (!tokens) {
      throw new UnauthorizedException(
        'No refresh token on file — link required',
      );
    }

    let resp: TokenResponse;
    try {
      resp = await this.client.refresh({
        issuerUrl: link.issuerUrl,
        refreshToken: tokens.refreshToken,
      });
    } catch (err) {
      this.logger.warn(`Refresh failed for link ${link.id}: ${String(err)}`);
      this.cache.delete(link.id);
      throw new UnauthorizedException(
        'Domo session expired — re-link required',
      );
    }

    // Atomic rotation: persist the new refresh token before handing out
    // the new access token.
    await this.tokens.upsert({
      linkId: link.id,
      refreshToken: resp.refreshToken,
      scope: resp.scope,
      updatedAt: new Date(),
    });

    this.cacheAccessToken(link.id, resp.accessToken, resp.expiresIn);
    await this.links.touchLastUsed(link.id);
    return resp.accessToken;
  }
}
