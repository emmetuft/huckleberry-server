import { jest } from '@jest/globals';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { SignJWT, generateKeyPair } from 'jose';
import { GatekeeperAuthGuard } from './gatekeeper-auth.guard';
import { JwksService } from './jwks.service';
import { KnownTenantsService } from './known-tenants.service';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';

const ISSUER_A = 'https://cust1.domo.com';
const ISSUER_B = 'https://cust2.domo.com';
const ISSUER_UNKNOWN = 'https://evil.domo.com';
const SUB = 'user-123';

type Keys = { priv: CryptoKey; pub: CryptoKey; kid: string };
const keysByIssuer = new Map<string, Keys>();

async function makeKeys(kid: string): Promise<Keys> {
  const { privateKey, publicKey } = await generateKeyPair('ES256', {
    extractable: true,
  });
  return { priv: privateKey, pub: publicKey, kid };
}

beforeAll(async () => {
  keysByIssuer.set(ISSUER_A, await makeKeys('key-a'));
  keysByIssuer.set(ISSUER_B, await makeKeys('key-b'));

  // Stub JwksService to resolve the correct public key by issuer.
  jest
    .spyOn(JwksService.prototype, 'getKeyResolver')
    .mockImplementation((issuer: string) => () => {
      const k = keysByIssuer.get(issuer);
      if (!k) throw new Error(`no keys stubbed for ${issuer}`);
      return Promise.resolve(k.pub);
    });
});

async function mintToken(opts: {
  iss?: string;
  aud?: string;
  scope?: string;
  cid?: string;
  typ?: string;
  alg?: 'ES256' | 'RS256';
  sub?: string | undefined;
  exp?: number;
}): Promise<string> {
  const issuer = opts.iss ?? ISSUER_A;
  const keys = keysByIssuer.get(issuer);
  if (!keys) throw new Error(`mint: no keys for ${issuer}`);

  const claims: Record<string, unknown> = {
    scope: opts.scope ?? 'ai:read',
  };
  if (opts.cid) claims.cid = opts.cid;

  const jwt = new SignJWT(claims)
    .setProtectedHeader({
      alg: opts.alg ?? 'ES256',
      kid: keys.kid,
      typ: opts.typ ?? 'at+jwt',
    })
    .setIssuer(issuer)
    .setIssuedAt();
  if (opts.sub !== undefined) jwt.setSubject(opts.sub);
  if (opts.aud) jwt.setAudience(opts.aud);
  if (opts.exp) jwt.setExpirationTime(opts.exp);
  else jwt.setExpirationTime('1h');
  return jwt.sign(keys.priv);
}

function makeGuard(
  opts: {
    audience?: string;
    issuers?: string[];
    isPublic?: boolean;
  } = {},
): GatekeeperAuthGuard {
  const config = {
    get: jest.fn().mockReturnValue({
      gatekeeperIssuers: opts.issuers ?? [ISSUER_A, ISSUER_B],
      gatekeeperJwksUriOverrides: {},
      gatekeeperAudience: opts.audience ?? '',
    }),
  } as unknown as ConfigService;

  const reflector = {
    getAllAndOverride: jest.fn((key: string) => {
      if (key === IS_PUBLIC_KEY) return opts.isPublic ?? false;
      return undefined;
    }),
  } as unknown as Reflector;

  return new GatekeeperAuthGuard(
    config,
    reflector,
    new JwksService(config),
    new KnownTenantsService(config),
  );
}

function ctx(
  headers: Record<string, string> = {},
  query: Record<string, string> = {},
): ExecutionContext {
  const req = { headers, query };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

describe('GatekeeperAuthGuard — multi-tenant', () => {
  it('verifies a valid token from issuer A and attaches a principal', async () => {
    const guard = makeGuard();
    const token = await mintToken({
      sub: SUB,
      iss: ISSUER_A,
      cid: 'cust1',
    });
    const c = ctx({ authorization: `Bearer ${token}` });

    await expect(guard.canActivate(c)).resolves.toBe(true);
    const req = c.switchToHttp().getRequest<{
      user?: {
        customerId: string;
        sub: string;
        scopes: string[];
        issuer: string;
      };
    }>();
    expect(req.user).toMatchObject({
      customerId: 'cust1',
      sub: SUB,
      issuer: ISSUER_A,
    });
  });

  it('verifies a valid token from issuer B with B-specific keys', async () => {
    const guard = makeGuard();
    const token = await mintToken({
      sub: SUB,
      iss: ISSUER_B,
      cid: 'cust2',
    });
    await expect(
      guard.canActivate(ctx({ authorization: `Bearer ${token}` })),
    ).resolves.toBe(true);
  });

  it('rejects an issuer not on the allowlist BEFORE crypto', async () => {
    // Add unknown issuer's keys to the stub so any failure is allowlist-driven,
    // not signature-driven.
    keysByIssuer.set(ISSUER_UNKNOWN, await makeKeys('key-x'));
    const guard = makeGuard();
    const token = await mintToken({ sub: SUB, iss: ISSUER_UNKNOWN });
    await expect(
      guard.canActivate(ctx({ authorization: `Bearer ${token}` })),
    ).rejects.toThrow(/unknown tenant issuer/);
    keysByIssuer.delete(ISSUER_UNKNOWN);
  });

  it('rejects a token signed with issuer A keys but claiming issuer B', async () => {
    // Mint with A's keys, but set iss to B. After we route by iss to B's
    // JWKS, signature verification against B's keys will fail.
    const a = keysByIssuer.get(ISSUER_A);
    const jwt = await new SignJWT({ scope: 'ai:read' })
      .setProtectedHeader({ alg: 'ES256', kid: a.kid, typ: 'at+jwt' })
      .setIssuer(ISSUER_B)
      .setSubject(SUB)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(a.priv);
    const guard = makeGuard();
    await expect(
      guard.canActivate(ctx({ authorization: `Bearer ${jwt}` })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a malformed JWT', async () => {
    const guard = makeGuard();
    await expect(
      guard.canActivate(ctx({ authorization: 'Bearer not.a.jwt' })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a missing bearer header', async () => {
    const guard = makeGuard();
    await expect(guard.canActivate(ctx())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects ?access_token= query param', async () => {
    const guard = makeGuard();
    await expect(
      guard.canActivate(ctx({}, { access_token: 'whatever' })),
    ).rejects.toThrow(/forbidden/);
  });

  it('rejects an expired token', async () => {
    const guard = makeGuard();
    const expired = await mintToken({
      sub: SUB,
      exp: Math.floor(Date.now() / 1000) - 60,
    });
    await expect(
      guard.canActivate(ctx({ authorization: `Bearer ${expired}` })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token whose typ is not at+jwt', async () => {
    const guard = makeGuard();
    const idTok = await mintToken({ sub: SUB, typ: 'JWT' });
    await expect(
      guard.canActivate(ctx({ authorization: `Bearer ${idTok}` })),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('verifies audience when configured', async () => {
    const guard = makeGuard({ audience: 'huckleberry' });
    const wrongAud = await mintToken({ sub: SUB, aud: 'other-app' });
    await expect(
      guard.canActivate(ctx({ authorization: `Bearer ${wrongAud}` })),
    ).rejects.toThrow(UnauthorizedException);

    const goodAud = await mintToken({ sub: SUB, aud: 'huckleberry' });
    await expect(
      guard.canActivate(ctx({ authorization: `Bearer ${goodAud}` })),
    ).resolves.toBe(true);
  });

  it('prefers cid claim over subdomain parse', async () => {
    const guard = makeGuard();
    // iss is cust1.domo.com (subdomain "cust1") but cid says "labs".
    // Token must surface cid as the customerId.
    const tok = await mintToken({
      sub: SUB,
      iss: ISSUER_A,
      cid: 'labs',
    });
    const c = ctx({ authorization: `Bearer ${tok}` });
    await guard.canActivate(c);
    const req = c
      .switchToHttp()
      .getRequest<{ user?: { customerId: string } }>();
    expect(req.user?.customerId).toBe('labs');
  });

  it('falls back to subdomain parse when cid is absent', async () => {
    const guard = makeGuard();
    const tok = await mintToken({ sub: SUB, iss: ISSUER_A }); // no cid
    const c = ctx({ authorization: `Bearer ${tok}` });
    await guard.canActivate(c);
    const req = c
      .switchToHttp()
      .getRequest<{ user?: { customerId: string } }>();
    expect(req.user?.customerId).toBe('cust1');
  });

  it('bypasses verification when @Public() is set', async () => {
    const guard = makeGuard({ isPublic: true });
    await expect(guard.canActivate(ctx())).resolves.toBe(true);
  });

  it('rejects a token missing the sub claim', async () => {
    const guard = makeGuard();
    const tok = await mintToken({ sub: undefined });
    await expect(
      guard.canActivate(ctx({ authorization: `Bearer ${tok}` })),
    ).rejects.toThrow(UnauthorizedException);
  });
});
