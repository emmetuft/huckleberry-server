import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { SessionService } from './session.service';
import { InMemorySessionRepository } from './session.repository';

function makeConfig(
  overrides: Partial<{ key: string; ttl: number; nodeEnv: string }> = {},
): ConfigService {
  return {
    get: jest.fn().mockReturnValue({
      sessionSigningKey: overrides.key ?? randomBytes(32).toString('hex'),
      sessionTtlSeconds: overrides.ttl ?? 43200,
      nodeEnv: overrides.nodeEnv ?? 'development',
    }),
  } as unknown as ConfigService;
}

describe('SessionService', () => {
  it('issues a session with cookie + csrf + matching repo row', async () => {
    const repo = new InMemorySessionRepository();
    const svc = new SessionService(makeConfig(), repo);
    const issued = await svc.issue('user-1');

    expect(issued.cookieValue).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(issued.csrfToken).toHaveLength(64);
    expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const stored = await repo.get(issued.sid);
    expect(stored?.userId).toBe('user-1');
    expect(stored?.csrfToken).toBe(issued.csrfToken);
  });

  it('verifies a freshly-issued cookie and slides the TTL', async () => {
    const repo = new InMemorySessionRepository();
    const svc = new SessionService(makeConfig({ ttl: 1000 }), repo);
    const issued = await svc.issue('user-1');

    const original = await repo.get(issued.sid);
    const originalExpiry = original.expiresAt.getTime();
    await new Promise((r) => setTimeout(r, 5));

    const session = await svc.verifyAndTouch(issued.cookieValue);
    expect(session.userId).toBe('user-1');
    expect(session.expiresAt.getTime()).toBeGreaterThan(originalExpiry);
  });

  it('rejects a tampered cookie', async () => {
    const svc = new SessionService(
      makeConfig(),
      new InMemorySessionRepository(),
    );
    const { cookieValue } = await svc.issue('user-1');
    // Flip a byte in the middle of the signature segment. (Trailing-char
    // flips can land in padding bits and produce the same signature.)
    const [h, p, sig] = cookieValue.split('.');
    const mid = Math.floor(sig.length / 2);
    const flipped = sig[mid] === 'A' ? 'B' : 'A';
    const tampered = `${h}.${p}.${sig.slice(0, mid)}${flipped}${sig.slice(mid + 1)}`;

    await expect(svc.verifyAndTouch(tampered)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a cookie whose session was revoked', async () => {
    const repo = new InMemorySessionRepository();
    const svc = new SessionService(makeConfig(), repo);
    const issued = await svc.issue('user-1');
    await svc.revoke(issued.sid);

    await expect(svc.verifyAndTouch(issued.cookieValue)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a cookie signed by a different key', async () => {
    const repo = new InMemorySessionRepository();
    const a = new SessionService(
      makeConfig({ key: randomBytes(32).toString('hex') }),
      repo,
    );
    const issued = await a.issue('user-1');
    const b = new SessionService(
      makeConfig({ key: randomBytes(32).toString('hex') }),
      repo,
    );

    await expect(b.verifyAndTouch(issued.cookieValue)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('refuses to construct in production without SESSION_SIGNING_KEY', () => {
    expect(() => {
      new SessionService(
        makeConfig({ key: '', nodeEnv: 'production' }),
        new InMemorySessionRepository(),
      );
    }).toThrow(/SESSION_SIGNING_KEY/);
  });

  it('rejects a too-short signing key', () => {
    expect(() => {
      new SessionService(
        makeConfig({ key: 'aa', nodeEnv: 'development' }),
        new InMemorySessionRepository(),
      );
    }).toThrow(/at least 32 bytes/);
  });
});
