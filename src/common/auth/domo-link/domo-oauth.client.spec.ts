import { jest } from '@jest/globals';
import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DomoOAuthClient } from './domo-oauth.client';

const TEST_ISSUER = 'http://test.domo.com';
const TEST_BASE_URL = 'https://huckleberry.example.com';
const CIMD_CLIENT_ID = `${TEST_BASE_URL}/.well-known/oauth-client`;

function makeConfig(
  overrides: Partial<{
    domoOAuthClientId: string;
    domoOAuthRedirectUri: string;
    domoOAuthScopes: string;
    gatekeeperTransportOverrides: Record<string, string>;
    magicLinkBaseUrl: string;
    nodeEnv: string;
  }> = {},
): ConfigService {
  return {
    get: () => ({
      domoOAuthClientId: '',
      domoOAuthRedirectUri: 'http://localhost:3000/api/auth/domo/callback',
      domoOAuthScopes: 'ai:read ai:execute',
      gatekeeperTransportOverrides: {},
      magicLinkBaseUrl: TEST_BASE_URL,
      nodeEnv: 'test',
      ...overrides,
    }),
  } as unknown as ConfigService;
}

function makeClient(
  overrides?: Parameters<typeof makeConfig>[0],
): DomoOAuthClient {
  return new DomoOAuthClient(makeConfig(overrides));
}

describe('DomoOAuthClient.getClientId', () => {
  it('returns the CIMD metadata URL when no override is set', () => {
    const client = makeClient();
    expect(client.getClientId()).toBe(CIMD_CLIENT_ID);
  });

  it('returns the rig override verbatim when DOMO_OAUTH_CLIENT_ID is set', () => {
    const client = makeClient({ domoOAuthClientId: 'rig-client-123' });
    expect(client.getClientId()).toBe('rig-client-123');
  });
});

describe('DomoOAuthClient — production boot guard', () => {
  it('throws if NODE_ENV=production and MAGIC_LINK_BASE_URL is not HTTPS', () => {
    expect(() =>
      makeClient({
        nodeEnv: 'production',
        magicLinkBaseUrl: 'http://localhost:5173',
      }),
    ).toThrow('MAGIC_LINK_BASE_URL must be an HTTPS URL in production');
  });

  it('does not throw in test/dev even with a localhost base URL', () => {
    expect(() =>
      makeClient({
        nodeEnv: 'test',
        magicLinkBaseUrl: 'http://localhost:5173',
      }),
    ).not.toThrow();
  });
});

describe('DomoOAuthClient.buildAuthorizeUrl', () => {
  it('includes the CIMD client_id in the authorize URL', () => {
    const client = makeClient();
    const url = client.buildAuthorizeUrl({
      issuerUrl: TEST_ISSUER,
      state: 'test-state',
      codeChallenge: 'test-challenge',
    });
    expect(url).toContain(`client_id=${encodeURIComponent(CIMD_CLIENT_ID)}`);
    expect(url).toContain('response_type=code');
    expect(url).toContain('code_challenge_method=S256');
  });

  it('uses the rig override when set', () => {
    const client = makeClient({ domoOAuthClientId: 'rig-client' });
    const url = client.buildAuthorizeUrl({
      issuerUrl: TEST_ISSUER,
      state: 's',
      codeChallenge: 'c',
    });
    expect(url).toContain('client_id=rig-client');
  });
});

describe('DomoOAuthClient.exchangeCode', () => {
  let fetchSpy: jest.SpiedFunction<typeof globalThis.fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => fetchSpy.mockRestore());

  it('sends CIMD client_id in the token request body', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'at',
          refresh_token: 'rt',
          expires_in: 3600,
          scope: 'ai:read',
          token_type: 'Bearer',
        }),
        { status: 200 },
      ),
    );
    const client = makeClient();
    await client.exchangeCode({
      issuerUrl: TEST_ISSUER,
      code: 'code',
      codeVerifier: 'cv',
    });
    const body = new URLSearchParams(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.get('client_id')).toBe(CIMD_CLIENT_ID);
    expect(body.get('grant_type')).toBe('authorization_code');
  });
});

describe('DomoOAuthClient.refresh', () => {
  let fetchSpy: jest.SpiedFunction<typeof globalThis.fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => fetchSpy.mockRestore());

  it('sends CIMD client_id in the refresh request', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'at2',
          refresh_token: 'rt2',
          expires_in: 3600,
          scope: 'ai:read',
          token_type: 'Bearer',
        }),
        { status: 200 },
      ),
    );
    const client = makeClient();
    await client.refresh({ issuerUrl: TEST_ISSUER, refreshToken: 'old-rt' });
    const body = new URLSearchParams(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.get('client_id')).toBe(CIMD_CLIENT_ID);
    expect(body.get('grant_type')).toBe('refresh_token');
  });
});

describe('DomoOAuthClient.revoke', () => {
  let fetchSpy: jest.SpiedFunction<typeof globalThis.fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => fetchSpy.mockRestore());

  it('sends CIMD client_id in the revoke request', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 200 }));
    const client = makeClient();
    await client.revoke({ issuerUrl: TEST_ISSUER, token: 'tok' });
    const body = new URLSearchParams(fetchSpy.mock.calls[0][1]?.body as string);
    expect(body.get('client_id')).toBe(CIMD_CLIENT_ID);
  });
});

describe('DomoOAuthClient.validateInstance', () => {
  let fetchSpy: jest.SpiedFunction<typeof globalThis.fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => fetchSpy.mockRestore());

  it('succeeds when CIMD support is advertised', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          issuer: TEST_ISSUER,
          client_id_metadata_document_supported: true,
        }),
        { status: 200 },
      ),
    );
    await expect(
      makeClient().validateInstance(TEST_ISSUER),
    ).resolves.toBeUndefined();
  });

  it('throws BadRequestException when CIMD support is absent', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ issuer: TEST_ISSUER }), { status: 200 }),
    );
    await expect(makeClient().validateInstance(TEST_ISSUER)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('skips CIMD check in rig-override mode', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ issuer: TEST_ISSUER }), { status: 200 }),
    );
    const client = makeClient({ domoOAuthClientId: 'rig-client' });
    await expect(client.validateInstance(TEST_ISSUER)).resolves.toBeUndefined();
  });

  it('throws BadRequestException when issuer is missing', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ client_id_metadata_document_supported: true }),
        { status: 200 },
      ),
    );
    await expect(makeClient().validateInstance(TEST_ISSUER)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException on network error', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(makeClient().validateInstance(TEST_ISSUER)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException on non-OK HTTP response', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('not found', { status: 404 }));
    await expect(makeClient().validateInstance(TEST_ISSUER)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException on malformed JSON', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('not json', { status: 200 }));
    await expect(makeClient().validateInstance(TEST_ISSUER)).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('DomoOAuthClient token error handling', () => {
  let fetchSpy: jest.SpiedFunction<typeof globalThis.fetch>;

  beforeEach(() => {
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => fetchSpy.mockRestore());

  it('throws BadGatewayException on network error during exchangeCode', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(
      makeClient().exchangeCode({
        issuerUrl: TEST_ISSUER,
        code: 'c',
        codeVerifier: 'v',
      }),
    ).rejects.toThrow(BadGatewayException);
  });

  it('throws UnauthorizedException on non-OK token response', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('invalid_grant', { status: 400 }),
    );
    const { UnauthorizedException } = await import('@nestjs/common');
    await expect(
      makeClient().exchangeCode({
        issuerUrl: TEST_ISSUER,
        code: 'c',
        codeVerifier: 'v',
      }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
