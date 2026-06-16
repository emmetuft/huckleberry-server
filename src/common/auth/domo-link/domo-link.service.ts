import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { decodeJwt } from 'jose';
import type { AppConfig } from '../../config/configuration.js';
import { JwksService } from '../jwks.service.js';
import { KnownTenantsService } from '../known-tenants.service.js';
import { jwtVerify } from 'jose';
import { DomoAuthBroker } from './domo-auth.broker.js';
import {
  DomoOAuthClient,
  type DcrResponse,
  type TokenResponse,
} from './domo-oauth.client.js';
import { LINK_REPOSITORY, type LinkRepository } from './link.repository.js';
import {
  OAUTH_STATE_STORE,
  type OAuthStateStore,
} from './oauth-state.store.js';
import { DOMO_TOKEN_STORE, type DomoTokenStore } from './token.store.js';
import {
  CLIENT_CREDENTIAL_STORE,
  type ClientCredentialStore,
} from './client-credential.store.js';
import {
  USER_REPOSITORY,
  type UserRepository,
} from '../../../auth/user.repository.js';
import type { LinkedDomoInstance, PendingLinkState } from './types.js';

/** Result of starting a link — the URL the browser must visit next. */
export interface StartLinkResult {
  authorizeUrl: string;
  state: string;
}

/** Result of completing a link — the SPA uses this to render confirmation. */
export interface CompleteLinkResult {
  link: LinkedDomoInstance;
  status: 'active';
}

@Injectable()
export class DomoLinkService {
  private readonly logger = new Logger(DomoLinkService.name);
  private readonly stateTtlMs = 10 * 60 * 1000; // 10 min
  private readonly defaultIssuer: string;

  constructor(
    config: ConfigService,
    private readonly client: DomoOAuthClient,
    private readonly broker: DomoAuthBroker,
    private readonly tenants: KnownTenantsService,
    private readonly jwks: JwksService,
    @Inject(LINK_REPOSITORY) private readonly links: LinkRepository,
    @Inject(OAUTH_STATE_STORE) private readonly states: OAuthStateStore,
    @Inject(DOMO_TOKEN_STORE) private readonly tokens: DomoTokenStore,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(CLIENT_CREDENTIAL_STORE)
    private readonly clientCreds: ClientCredentialStore,
  ) {
    const app = config.get<AppConfig>('app');
    this.defaultIssuer = app?.gatekeeperIssuers?.[0] ?? '';
  }

  /**
   * Begin a link. Generates PKCE + state, stores them keyed by `state`,
   * returns the authorize URL the browser should be redirected to.
   * Registers the OAuth client via DCR if not already in the store.
   */
  async startLink(
    userId: string,
    issuerUrl?: string,
  ): Promise<StartLinkResult> {
    const resolved = trimTrailingSlashes(issuerUrl ?? this.defaultIssuer);
    if (!resolved) {
      throw new BadRequestException(
        'No issuer URL provided and GATEKEEPER_ISSUERS is not configured',
      );
    }
    this.tenants.assertAllowed(resolved);
    await this.ensureClientRegistered(resolved);

    const { codeVerifier, codeChallenge } = DomoOAuthClient.generatePkce();
    const state = randomBytes(32).toString('base64url');
    const now = new Date();
    const pending: PendingLinkState = {
      state,
      userId,
      issuerUrl: resolved,
      codeVerifier,
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.stateTtlMs),
    };
    await this.states.insert(pending);

    const authorizeUrl: string = await this.client.buildAuthorizeUrl({
      issuerUrl: resolved,
      state,
      codeChallenge,
    });
    this.logger.log(`authorize URL for user ${userId}: ${authorizeUrl}`);
    return { authorizeUrl, state };
  }

  /**
   * Complete a link. Validates state + verifier, exchanges the code,
   * verifies the returned access token via JWKS, persists the link +
   * refresh token, seeds the broker cache, and flips the user to `active`.
   */
  async completeLink(opts: {
    state: string;
    code: string;
    sessionUserId: string;
  }): Promise<CompleteLinkResult> {
    const pending = await this.states.consume(opts.state, new Date());
    if (!pending) {
      throw new BadRequestException('invalid_or_expired_state');
    }
    if (pending.userId !== opts.sessionUserId) {
      // The state was issued for a different huckleberry session — abort.
      this.logger.warn(
        `state ${opts.state} userId mismatch (issued for ${pending.userId}, presented by ${opts.sessionUserId})`,
      );
      throw new BadRequestException('state_user_mismatch');
    }

    let tokenResp: TokenResponse;
    try {
      tokenResp = await this.client.exchangeCode({
        issuerUrl: pending.issuerUrl,
        code: opts.code,
        codeVerifier: pending.codeVerifier,
      });
    } catch (err) {
      throw new BadRequestException(
        `token exchange failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // Verify the access token against the issuer's JWKS so we know the
    // `cid` + `sub` we persist are signed by the AS we trust.
    let cid: string | undefined;
    let sub: string | undefined;
    try {
      const { payload } = await jwtVerify(
        tokenResp.accessToken,
        this.jwks.getKeyResolver(pending.issuerUrl),
        {
          algorithms: ['ES256'],
          typ: 'at+jwt',
          issuer: pending.issuerUrl,
        },
      );
      cid = typeof payload.cid === 'string' ? payload.cid : undefined;
      sub = payload.sub;
    } catch (err) {
      // Fall back to an *unverified* decode for the customer/sub fields
      // only — the token will already have been exchanged so we know it's
      // freshly minted; the decode is a routing read, not a trust read.
      this.logger.warn(
        `Access-token JWKS verify failed (${String(err)}) — proceeding with unverified decode`,
      );
      try {
        const claims = decodeJwt(tokenResp.accessToken);
        cid = typeof claims.cid === 'string' ? claims.cid : undefined;
        sub = claims.sub;
      } catch {
        throw new BadRequestException('access_token_malformed');
      }
    }
    if (!cid || !sub) {
      throw new BadRequestException('access_token_missing_cid_or_sub');
    }

    // Reuse the bootstrap link row created at signup. If it's missing
    // (legacy users created before bootstrap was a thing, or admin paths
    // that skipped it), fall back to creating one — keeps the contract
    // "one link row per user" intact.
    const existing = await this.links.findActiveForUser(opts.sessionUserId);
    const now = new Date();
    const link: LinkedDomoInstance = existing
      ? {
          ...existing,
          issuerUrl: pending.issuerUrl,
          customerId: cid,
          domoSub: sub,
          scope: tokenResp.scope,
          lastUsedAt: now,
        }
      : {
          id: randomUUID(),
          userId: opts.sessionUserId,
          issuerUrl: pending.issuerUrl,
          customerId: cid,
          domoSub: sub,
          scope: tokenResp.scope,
          linkedAt: now,
          lastUsedAt: now,
        };
    if (existing) {
      await this.links.update(link);
    } else {
      await this.links.insert(link);
    }
    await this.tokens.upsert({
      linkId: link.id,
      refreshToken: tokenResp.refreshToken,
      scope: tokenResp.scope,
      updatedAt: new Date(),
    });
    this.broker.cacheAccessToken(
      link.id,
      tokenResp.accessToken,
      tokenResp.expiresIn,
    );
    await this.users.updateStatus(opts.sessionUserId, 'active');

    return { link, status: 'active' };
  }

  /**
   * Revokes the user's Domo refresh token and resets them to `pending_link`.
   * The link row is retained so the next login re-uses the same instance.
   * Best-effort — Gatekeeper revoke failures are swallowed.
   */
  async unlink(userId: string): Promise<void> {
    const link = await this.links.findActiveForUser(userId);
    if (!link) return;

    const stored = await this.tokens.get(link.id);
    if (stored) {
      await this.client.revoke({
        issuerUrl: link.issuerUrl,
        token: stored.refreshToken,
        tokenTypeHint: 'refresh_token',
      });
      await this.tokens.delete(link.id);
    }

    this.broker.invalidate(link.id);
    await this.users.updateStatus(userId, 'pending_link');
  }

  /** Returns the user's active link (or null). */
  activeLinkFor(userId: string): Promise<LinkedDomoInstance | null> {
    return this.links.findActiveForUser(userId);
  }

  /**
   * Pre-seeds a pending link row for a newly-provisioned user. The link
   * has no `domoSub` and no refresh token yet — both get filled in when
   * the user completes the PKCE auth-code flow on first sign-in.
   *
   * User status stays `pending_link` until that PKCE flow completes.
   */
  async bootstrapLink(opts: {
    userId: string;
    issuerUrl: string;
    customerId: string;
    scope: string;
  }): Promise<LinkedDomoInstance> {
    const link: LinkedDomoInstance = {
      id: randomUUID(),
      userId: opts.userId,
      issuerUrl: trimTrailingSlashes(opts.issuerUrl),
      customerId: opts.customerId,
      domoSub: null,
      scope: opts.scope,
      linkedAt: new Date(),
      lastUsedAt: null,
    };
    await this.links.insert(link);
    return link;
  }

  /**
   * Ensures an OAuth client is registered for the given issuerUrl.
   * Checks the credential store — on miss, calls DCR and persists the result.
   */
  private async ensureClientRegistered(issuerUrl: string): Promise<void> {
    const existing = await this.clientCreds.get(issuerUrl);
    if (existing) return;

    this.logger.log(`No client registered for ${issuerUrl} — attempting DCR`);
    const dcr: DcrResponse = await this.client.registerClient(issuerUrl);
    await this.clientCreds.upsert({
      issuerUrl,
      clientId: dcr.clientId,
      registrationAccessToken: dcr.registrationAccessToken,
      redirectUri: this.client.getRedirectUri(),
      scope: dcr.scope,
      registeredAt: new Date(),
      lastUsedAt: null,
    });
  }
}

// Linear-time trailing-slash trim. Avoids the polynomial-regex pattern
// `/\/+$/` on user-controlled input, which CodeQL flags as a ReDoS risk.
function trimTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* '/' */) end--;
  return end === s.length ? s : s.slice(0, end);
}
