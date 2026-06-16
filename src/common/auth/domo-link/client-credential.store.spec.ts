import { ConfigService } from '@nestjs/config';
import {
  InMemoryClientCredentialStore,
  type OAuthClientCredentials,
} from './client-credential.store';

function makeConfig(overrides?: Record<string, unknown>): ConfigService {
  const defaults = {
    app: {
      devInstanceIssuerUrl: 'http://dev.domo.com',
      domoOAuthClientId: 'dev-client-id',
      domoOAuthRedirectUri: 'http://localhost:3000/api/auth/domo/callback',
      domoOAuthScopes: 'ai:read ai:execute',
      ...overrides,
    },
  };
  return {
    get: (key: string) => (defaults as Record<string, unknown>)[key],
  } as unknown as ConfigService;
}

function makeCred(issuerUrl = 'http://prod.domo.com'): OAuthClientCredentials {
  return {
    issuerUrl,
    clientId: 'dcr-prod-123',
    registrationAccessToken: 'rat-abc',
    redirectUri: 'https://app.huckleberry.com/api/auth/domo/callback',
    scope: 'ai:read ai:execute',
    registeredAt: new Date(),
    lastUsedAt: null,
  };
}

describe('InMemoryClientCredentialStore', () => {
  let store: InMemoryClientCredentialStore;

  beforeEach(() => {
    store = new InMemoryClientCredentialStore(makeConfig());
  });

  it('returns null for unknown issuerUrl', async () => {
    expect(await store.get('http://unknown.domo.com')).toBeNull();
  });

  it('returns dev fallback for configured dev instance', async () => {
    const result = await store.get('http://dev.domo.com');
    expect(result).not.toBeNull();
    expect(result.clientId).toBe('dev-client-id');
    expect(result.redirectUri).toBe(
      'http://localhost:3000/api/auth/domo/callback',
    );
  });

  it('does not return dev fallback for non-matching issuerUrl', async () => {
    expect(await store.get('http://other.domo.com')).toBeNull();
  });

  it('upsert stores and get retrieves', async () => {
    const cred = makeCred();
    await store.upsert(cred);
    const result = await store.get('http://prod.domo.com');
    expect(result).toEqual(cred);
  });

  it('upsert overwrites existing entry', async () => {
    await store.upsert(makeCred());
    const updated = makeCred();
    updated.clientId = 'dcr-prod-456';
    await store.upsert(updated);
    const result = await store.get('http://prod.domo.com');
    expect(result.clientId).toBe('dcr-prod-456');
  });

  it('stored entry takes precedence over dev fallback', async () => {
    const cred = makeCred('http://dev.domo.com');
    cred.clientId = 'dcr-override';
    await store.upsert(cred);
    const result = await store.get('http://dev.domo.com');
    expect(result.clientId).toBe('dcr-override');
  });

  it('delete removes entry', async () => {
    await store.upsert(makeCred());
    await store.delete('http://prod.domo.com');
    expect(await store.get('http://prod.domo.com')).toBeNull();
  });

  it('touchLastUsed updates timestamp', async () => {
    await store.upsert(makeCred());
    await store.touchLastUsed('http://prod.domo.com');
    const result = await store.get('http://prod.domo.com');
    expect(result.lastUsedAt).not.toBeNull();
  });

  it('no dev fallback when env vars are not set', async () => {
    const emptyStore = new InMemoryClientCredentialStore(
      makeConfig({ devInstanceIssuerUrl: '', domoOAuthClientId: '' }),
    );
    expect(await emptyStore.get('http://dev.domo.com')).toBeNull();
  });
});
