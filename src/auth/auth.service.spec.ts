import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { InMemoryUserRepository } from './user.repository';
import { InMemoryMagicLinkRepository } from './magic-link.repository';
import type { EmailService, MagicLinkEmail } from './email.service';
import type { User } from './types';

class TestEmailService implements EmailService {
  public sent: MagicLinkEmail[] = [];
  sendMagicLink(email: MagicLinkEmail): Promise<void> {
    this.sent.push(email);
    return Promise.resolve();
  }
}

function makeConfig(
  overrides: Partial<{ ttl: number; baseUrl: string }> = {},
): ConfigService {
  return {
    get: jest.fn().mockReturnValue({
      magicLinkTtlSeconds: overrides.ttl ?? 900,
      magicLinkBaseUrl: overrides.baseUrl ?? 'http://localhost:3000',
    }),
  } as unknown as ConfigService;
}

async function seedUser(
  users: InMemoryUserRepository,
  overrides: Partial<User> = {},
): Promise<User> {
  const now = new Date();
  const user: User = {
    id: 'user-1',
    email: 'demo@huckleberry.ai',
    emailVerified: false,
    displayName: 'Demo',
    status: 'pending_link',
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    ...overrides,
  };
  return users.insert(user);
}

function extractTokenFromUrl(url: string): string {
  return new URL(url).searchParams.get('token') ?? '';
}

describe('AuthService — magic-link issuance + consumption', () => {
  let users: InMemoryUserRepository;
  let magicLinks: InMemoryMagicLinkRepository;
  let email: TestEmailService;
  let service: AuthService;

  beforeEach(() => {
    users = new InMemoryUserRepository();
    magicLinks = new InMemoryMagicLinkRepository();
    email = new TestEmailService();
    service = new AuthService(makeConfig(), users, magicLinks, email);
  });

  it('issues a magic-link email for a known user', async () => {
    await seedUser(users);
    await service.requestMagicLink('demo@huckleberry.ai', '127.0.0.1');
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0].to).toBe('demo@huckleberry.ai');
    expect(email.sent[0].url).toContain('/auth/signin?token=');
  });

  it('silently no-ops for an unknown email (no account-existence leak)', async () => {
    await service.requestMagicLink('nobody@huckleberry.ai', '127.0.0.1');
    expect(email.sent).toHaveLength(0);
  });

  it('silently no-ops for a suspended user', async () => {
    await seedUser(users, { status: 'suspended' });
    await service.requestMagicLink('demo@huckleberry.ai', '127.0.0.1');
    expect(email.sent).toHaveLength(0);
  });

  it('consumes a valid token, marks user verified, returns needsLinkage=true for pending_link', async () => {
    await seedUser(users);
    await service.requestMagicLink('demo@huckleberry.ai', '127.0.0.1');
    const token = extractTokenFromUrl(email.sent[0].url);

    const result = await service.consumeMagicLink(token);
    expect(result.user.emailVerified).toBe(true);
    expect(result.user.lastLoginAt).toBeInstanceOf(Date);
    expect(result.needsLinkage).toBe(true);
  });

  it('returns needsLinkage=false when user is already active', async () => {
    await seedUser(users, { status: 'active', emailVerified: true });
    await service.requestMagicLink('demo@huckleberry.ai', '127.0.0.1');
    const token = extractTokenFromUrl(email.sent[0].url);

    const result = await service.consumeMagicLink(token);
    expect(result.needsLinkage).toBe(false);
  });

  it('rejects a second use of the same token (single-use)', async () => {
    await seedUser(users);
    await service.requestMagicLink('demo@huckleberry.ai', '127.0.0.1');
    const token = extractTokenFromUrl(email.sent[0].url);

    await service.consumeMagicLink(token);
    await expect(service.consumeMagicLink(token)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects an expired token', async () => {
    service = new AuthService(
      makeConfig({ ttl: -10 }), // negative TTL → already expired on issue
      users,
      magicLinks,
      email,
    );
    await seedUser(users);
    await service.requestMagicLink('demo@huckleberry.ai', '127.0.0.1');
    const token = extractTokenFromUrl(email.sent[0].url);

    await expect(service.consumeMagicLink(token)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a tampered token', async () => {
    await seedUser(users);
    await service.requestMagicLink('demo@huckleberry.ai', '127.0.0.1');
    const token = extractTokenFromUrl(email.sent[0].url);
    const tampered = token.slice(0, -1) + (token.slice(-1) === 'a' ? 'b' : 'a');

    await expect(service.consumeMagicLink(tampered)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects a missing/short token without lookup', async () => {
    await expect(service.consumeMagicLink('')).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.consumeMagicLink('short')).rejects.toThrow(
      BadRequestException,
    );
  });
});
