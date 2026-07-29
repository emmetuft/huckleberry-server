import { jest } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomoLinkService } from './domo-link.service';
import { DomoOAuthClient } from './domo-oauth.client';
import type { DomoAuthBroker } from './domo-auth.broker';
import type { KnownTenantsService } from '../known-tenants.service';
import type { JwksService } from '../jwks.service';
import type { LinkRepository } from './link.repository';
import type { OAuthStateStore } from './oauth-state.store';
import type { DomoTokenStore } from './token.store';
import type { UserRepository } from '../../../auth/user.repository';

const TEST_ISSUER = 'https://test.domo.com';

function makeConfig(): ConfigService {
  return {
    get: () => ({ gatekeeperIssuers: [TEST_ISSUER] }),
  } as unknown as ConfigService;
}

/**
 * Minimal harness for `startLink`. Only the collaborators that path touches
 * are stubbed; the rest are cast placeholders.
 */
function makeService(client: Partial<DomoOAuthClient>) {
  const states = { insert: jest.fn(() => Promise.resolve()) };
  const tenants = { register: jest.fn() };
  const links = { findActiveForUser: jest.fn(() => Promise.resolve(null)) };

  const service = new DomoLinkService(
    makeConfig(),
    client as DomoOAuthClient,
    {} as DomoAuthBroker,
    tenants as unknown as KnownTenantsService,
    {} as JwksService,
    links as unknown as LinkRepository,
    states as unknown as OAuthStateStore,
    {} as DomoTokenStore,
    {} as UserRepository,
  );
  return { service, states, tenants };
}

describe('DomoLinkService.startLink', () => {
  it('validates the instance and persists state on success', async () => {
    const validateInstance = jest.fn(() => Promise.resolve());
    const { service, states } = makeService({
      validateInstance,
      buildAuthorizeUrl: () => 'https://test.domo.com/oauth2/authorize?x=1',
    });

    const result = await service.startLink('user-1', TEST_ISSUER);

    expect(validateInstance).toHaveBeenCalledWith(TEST_ISSUER);
    expect(states.insert).toHaveBeenCalledTimes(1);
    expect(result.authorizeUrl).toContain('/oauth2/authorize');
  });

  it('rejects an invalid instance before persisting any state', async () => {
    const validateInstance = jest.fn(() =>
      Promise.reject(new BadRequestException('not a Domo instance')),
    );
    const buildAuthorizeUrl = jest.fn(() => '');
    const { service, states, tenants } = makeService({
      validateInstance,
      buildAuthorizeUrl,
    });

    await expect(service.startLink('user-1', TEST_ISSUER)).rejects.toThrow(
      BadRequestException,
    );
    expect(states.insert).not.toHaveBeenCalled();
    expect(tenants.register).not.toHaveBeenCalled();
    expect(buildAuthorizeUrl).not.toHaveBeenCalled();
  });
});
