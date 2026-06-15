import { jest } from '@jest/globals';
import { UnauthorizedException, NotFoundException } from '@nestjs/common';
import { DomoAuthBroker } from './domo-auth.broker';
import { InMemoryLinkRepository } from './link.repository';
import { InMemoryDomoTokenStore } from './token.store';
import type { DomoOAuthClient, TokenResponse } from './domo-oauth.client';
import type { LinkedDomoInstance } from './types';

function makeLink(): LinkedDomoInstance {
  return {
    id: 'link-1',
    userId: 'user-1',
    issuerUrl: 'http://domo-labs-dev.dev.domo.com:443',
    customerId: 'labs',
    domoSub: 'domo-user-1',
    scope: 'ai:read ai:execute',
    linkedAt: new Date(),
    lastUsedAt: null,
  };
}

function makeOAuthClient(refreshResp?: TokenResponse | Error): DomoOAuthClient {
  const refresh = jest.fn().mockImplementation(() => {
    if (refreshResp instanceof Error) return Promise.reject(refreshResp);
    return Promise.resolve(refreshResp);
  });
  return { refresh } as unknown as DomoOAuthClient;
}

describe('DomoAuthBroker', () => {
  let links: InMemoryLinkRepository;
  let tokens: InMemoryDomoTokenStore;

  beforeEach(async () => {
    links = new InMemoryLinkRepository();
    tokens = new InMemoryDomoTokenStore();
    await links.insert(makeLink());
    await tokens.upsert({
      linkId: 'link-1',
      refreshToken: 'rt-1',
      scope: 'ai:read ai:execute',
      updatedAt: new Date(),
    });
  });

  it('returns the cached access token without calling refresh', async () => {
    const client = makeOAuthClient();
    const broker = new DomoAuthBroker(links, tokens, client);
    broker.cacheAccessToken('link-1', 'access-cached', 3600);

    await expect(broker.tokenFor('link-1')).resolves.toBe('access-cached');
    expect(client.refresh).not.toHaveBeenCalled();
  });

  it('refreshes when there is no cached access token, rotates stored refresh', async () => {
    const client = makeOAuthClient({
      accessToken: 'access-new',
      refreshToken: 'rt-rotated',
      expiresIn: 3600,
      scope: 'ai:read ai:execute',
      tokenType: 'Bearer',
    });
    const broker = new DomoAuthBroker(links, tokens, client);

    const access = await broker.tokenFor('link-1');
    expect(access).toBe('access-new');
    expect(client.refresh).toHaveBeenCalledWith({
      issuerUrl: 'http://domo-labs-dev.dev.domo.com:443',
      refreshToken: 'rt-1',
    });

    const stored = await tokens.get('link-1');
    expect(stored?.refreshToken).toBe('rt-rotated');
  });

  it('single-flights concurrent refreshes for the same link', async () => {
    let resolve!: (resp: TokenResponse) => void;
    const refreshPromise = new Promise<TokenResponse>((r) => {
      resolve = r;
    });
    const client = {
      refresh: jest.fn().mockReturnValue(refreshPromise),
    } as unknown as DomoOAuthClient;
    const broker = new DomoAuthBroker(links, tokens, client);

    const a = broker.tokenFor('link-1');
    const b = broker.tokenFor('link-1');

    // Let microtasks resolve so the broker reaches the refresh call.
    await new Promise((r) => setImmediate(r));
    expect(client.refresh).toHaveBeenCalledTimes(1);

    resolve({
      accessToken: 'access-x',
      refreshToken: 'rt-x',
      expiresIn: 3600,
      scope: 'ai:read',
      tokenType: 'Bearer',
    });
    await expect(a).resolves.toBe('access-x');
    await expect(b).resolves.toBe('access-x');
  });

  it('throws Unauthorized on refresh failure (cascade-revoke or rotated-out)', async () => {
    const client = makeOAuthClient(new UnauthorizedException('invalid_grant'));
    const broker = new DomoAuthBroker(links, tokens, client);

    await expect(broker.tokenFor('link-1')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('throws NotFound when the link does not exist', async () => {
    const broker = new DomoAuthBroker(links, tokens, makeOAuthClient());
    await expect(broker.tokenFor('does-not-exist')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('throws Unauthorized when there is no refresh token on file', async () => {
    await tokens.delete('link-1');
    const broker = new DomoAuthBroker(links, tokens, makeOAuthClient());
    await expect(broker.tokenFor('link-1')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('invalidate() drops the cache so the next call refreshes', async () => {
    const client = makeOAuthClient({
      accessToken: 'access-after-invalidate',
      refreshToken: 'rt-after',
      expiresIn: 3600,
      scope: 'ai:read',
      tokenType: 'Bearer',
    });
    const broker = new DomoAuthBroker(links, tokens, client);
    broker.cacheAccessToken('link-1', 'access-stale', 3600);
    broker.invalidate('link-1');

    await expect(broker.tokenFor('link-1')).resolves.toBe(
      'access-after-invalidate',
    );
    expect(client.refresh).toHaveBeenCalledTimes(1);
  });
});
