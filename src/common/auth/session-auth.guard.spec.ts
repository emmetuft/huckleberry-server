import { jest } from '@jest/globals';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SessionAuthGuard } from './session-auth.guard';
import { SessionService } from '../../../auth/session.service';
import type { UserRepository } from '../../../auth/user.repository';

const activeUser = {
  id: 'user-1',
  email: 'demo@huckleberry.ai',
  status: 'active',
};

const mockUsers = (user = activeUser): UserRepository => ({
  findById: jest.fn().mockResolvedValue(user),
});

const noUsers = {
  findById: jest.fn().mockResolvedValue(null),
} as unknown as UserRepository;

function mockSessions(overrides: Partial<SessionService> = {}): SessionService {
  return {
    verifyAndTouch: jest.fn().mockResolvedValue({
      sid: 'sid-1',
      userId: 'user-1',
      csrfToken: 'csrf-secret',
    }),
    ...overrides,
  };
}

const reflector = new Reflector();

function makeGuard(sessions?: SessionService, users?: UserRepository) {
  return new SessionAuthGuard(
    sessions ?? mockSessions(),
    reflector,
    users ?? mockUsers(),
  );
}

function makeCtx(overrides: {
  method?: string;
  headers?: Record<string, string>;
  handlerMeta?: Record<string, unknown>;
}): ExecutionContext {
  const { method = 'GET', headers = {}, handlerMeta = {} } = overrides;
  const handler = Object.assign(() => undefined, handlerMeta);
  return {
    getHandler: () => handler,
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ method, headers, cookies: {} }),
    }),
  } as unknown as ExecutionContext;
}

describe('SessionAuthGuard', () => {
  describe('GET — no CSRF required', () => {
    it('allows with a valid session cookie', async () => {
      const ctx = makeCtx({ headers: { cookie: 'hb_session=valid.jwt' } });
      await expect(makeGuard().canActivate(ctx)).resolves.toBe(true);
    });

    it('rejects with no session cookie', async () => {
      const ctx = makeCtx({});
      await expect(makeGuard().canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects when session verification fails', async () => {
      const sessions = mockSessions({
        verifyAndTouch: jest
          .fn()
          .mockRejectedValue(new UnauthorizedException('invalid')),
      });
      const ctx = makeCtx({ headers: { cookie: 'hb_session=stale' } });
      await expect(makeGuard(sessions).canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects when user is suspended', async () => {
      const users = mockUsers({ ...activeUser, status: 'suspended' });
      const ctx = makeCtx({ headers: { cookie: 'hb_session=valid' } });
      await expect(
        makeGuard(undefined, users).canActivate(ctx),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects when user is not found', async () => {
      const ctx = makeCtx({ headers: { cookie: 'hb_session=valid' } });
      await expect(
        makeGuard(undefined, noUsers).canActivate(ctx),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('POST — CSRF required', () => {
    it('allows with valid session cookie and matching CSRF header', async () => {
      const ctx = makeCtx({
        method: 'POST',
        headers: {
          cookie: 'hb_session=valid',
          'x-csrf-token': 'csrf-secret',
        },
      });
      await expect(makeGuard().canActivate(ctx)).resolves.toBe(true);
    });

    it('rejects when CSRF header is missing', async () => {
      const ctx = makeCtx({
        method: 'POST',
        headers: { cookie: 'hb_session=valid' },
      });
      await expect(makeGuard().canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects when CSRF header does not match session token', async () => {
      const ctx = makeCtx({
        method: 'POST',
        headers: {
          cookie: 'hb_session=valid',
          'x-csrf-token': 'wrong-token',
        },
      });
      await expect(makeGuard().canActivate(ctx)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('@Public() decorator', () => {
    it('bypasses session check when handler is @Public()', async () => {
      const publicReflector = {
        getAllAndOverride: jest.fn().mockImplementation((key: string) => {
          return key === 'isPublic';
        }),
      } as unknown as Reflector;
      const guard = new SessionAuthGuard(
        mockSessions(),
        publicReflector,
        mockUsers(),
      );
      const ctx = makeCtx({});
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });
});
