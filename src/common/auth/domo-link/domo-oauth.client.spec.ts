import { jest } from '@jest/globals';
import { BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomoOAuthClient } from './domo-oauth.client';
import type {
  ClientCredentialStore,
  OAuthClientCredentials,
} from './client-credential.store';

const TEST_ISSUER = 'http://test.domo.com';

function makeConfig(): ConfigService {
  return {
    get: () => ({
      domoOAuthClientId: 'fallback-client',
      domoOAuthClientSecret: '',
      domoOAuthRedirectUri: 'http://localhost:3000/api/auth/domo/callback',
      domoOAuthScopes: 'ai:read ai:execute',
      gatekeeperTransportOverrides: {},
    }),
  } as unknown as ConfigService;
}

function makeCredStore(
  data?: OAuthClientCredentials | null,
): ClientCredentialStore {
  return {
    get: jest
      .fn()
      .mockResolvedValue(data ?? null) as ClientCredentialStore['get'],
    upsert: jest
      .fn()
      .mockImplementation((r) =>
        Promise.resolve(r),
      ) as ClientCredentialStore['upsert'],
    delete: jest
      .fn()
      .mockResolvedValue(undefined) as ClientCredentialStore['delete'],
    touchLastUsed: jest
      .fn()
      .mockResolvedValue(undefined) as ClientCredentialStore['touchLastUsed'],
  };
}

describe('DomoOAuthClient.registerClient', () => {
  let client: DomoOAuthClient;
  let fetchSpy: jest.SpiedFunction<typeof globalThis.fetch>;

  beforeEach(() => {
    client = new DomoOAuthClient(makeConfig(), makeCredStore());
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('sends correct DCR request and returns parsed response', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          client_id: 'dcr-new-123',
          registration_access_token: 'rat-xyz',
          scope: 'ai:read ai:execute',
        }),
        { status: 201 },
      ),
    );

    const result = await client.registerClient(TEST_ISSUER);

    expect(result.clientId).toBe('dcr-new-123');
    expect(result.registrationAccessToken).toBe('rat-xyz');
    expect(result.scope).toBe('ai:read ai:execute');

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`${TEST_ISSUER}/oauth2/register`);
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.token_endpoint_auth_method).toBe('none');
    expect(body.redirect_uris).toEqual([
      'http://localhost:3000/api/auth/domo/callback',
    ]);
    expect(body.grant_types).toEqual(['authorization_code', 'refresh_token']);
    expect(body.client_name).toBe('huckleberry');
  });

  it('throws BadGatewayException on non-OK response', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('rate limited', { status: 429 }),
    );
    await expect(client.registerClient(TEST_ISSUER)).rejects.toThrow(
      BadGatewayException,
    );
  });

  it('throws BadGatewayException when fetch rejects (network error)', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(client.registerClient(TEST_ISSUER)).rejects.toThrow(
      BadGatewayException,
    );
  });

  it('throws BadGatewayException on malformed JSON response', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('not json', { status: 201 }));
    await expect(client.registerClient(TEST_ISSUER)).rejects.toThrow(
      BadGatewayException,
    );
  });

  it('throws BadGatewayException when client_id is missing', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ scope: 'ai:read' }), { status: 201 }),
    );
    await expect(client.registerClient(TEST_ISSUER)).rejects.toThrow(
      BadGatewayException,
    );
  });
});

describe('DomoOAuthClient.resolveClientId (via buildAuthorizeUrl)', () => {
  it('uses clientId from credential store when available', async () => {
    const cred: OAuthClientCredentials = {
      issuerUrl: TEST_ISSUER,
      clientId: 'stored-client-id',
      registrationAccessToken: null,
      redirectUri: 'http://localhost:3000/api/auth/domo/callback',
      scope: 'ai:read',
      registeredAt: new Date(),
      lastUsedAt: null,
    };
    const client = new DomoOAuthClient(makeConfig(), makeCredStore(cred));
    const url = await client.buildAuthorizeUrl({
      issuerUrl: TEST_ISSUER,
      state: 'test-state',
      codeChallenge: 'test-challenge',
    });
    expect(url).toContain('client_id=stored-client-id');
  });

  it('falls back to env-var clientId when store returns null', async () => {
    const client = new DomoOAuthClient(makeConfig(), makeCredStore(null));
    const url = await client.buildAuthorizeUrl({
      issuerUrl: TEST_ISSUER,
      state: 'test-state',
      codeChallenge: 'test-challenge',
    });
    expect(url).toContain('client_id=fallback-client');
  });

  it('throws when neither store nor env var has a clientId', async () => {
    const emptyConfig = {
      get: () => ({
        domoOAuthClientId: '',
        domoOAuthClientSecret: '',
        domoOAuthRedirectUri: 'http://localhost:3000/api/auth/domo/callback',
        domoOAuthScopes: 'ai:read',
        gatekeeperTransportOverrides: {},
      }),
    } as unknown as ConfigService;
    const client = new DomoOAuthClient(emptyConfig, makeCredStore(null));
    await expect(
      client.buildAuthorizeUrl({
        issuerUrl: TEST_ISSUER,
        state: 's',
        codeChallenge: 'c',
      }),
    ).rejects.toThrow('No OAuth client registered');
  });
});
