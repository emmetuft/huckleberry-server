import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { DomoAuthGuard } from './domo-auth.guard';
import { SessionService } from '../../auth/session.service';
import type { UserRepository } from '../../auth/user.repository';

const mockUsers = {
  findById: jest.fn().mockResolvedValue(null),
} as unknown as UserRepository;

function mockSessions(overrides: Partial<SessionService> = {}): SessionService {
  return {
    verifyAndTouch: jest
      .fn()
      .mockRejectedValue(new UnauthorizedException('invalid session')),
    ...overrides,
  } as unknown as SessionService;
}

function createMockContext(
  headers: Record<string, string> = {},
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers, cookies: {} }),
    }),
  } as unknown as ExecutionContext;
}

describe('DomoAuthGuard', () => {
  it('allows when a valid hb_session cookie is present', async () => {
    const sessions = mockSessions({
      verifyAndTouch: jest
        .fn()
        .mockResolvedValue({ sid: 'sid-1', userId: 'user-1' }),
    });
    const users = {
      findById: jest.fn().mockResolvedValue({
        id: 'user-1',
        email: 'demo@huckleberry.ai',
        status: 'active',
      }),
    } as unknown as UserRepository;
    const guard = new DomoAuthGuard(sessions, users);
    const ctx = createMockContext({ cookie: 'hb_session=valid.jwt.value' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('rejects in production when only a legacy Domo header is present (no session)', async () => {
    const sessions = mockSessions(); // verifyAndTouch rejects
    const guard = new DomoAuthGuard(sessions, mockUsers);
    const ctx = createMockContext({
      cookie: 'hb_session=stale',
      'x-domo-embedded-security': 'some-token',
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects when no session cookie is present', async () => {
    const guard = new DomoAuthGuard(mockSessions(), mockUsers);
    await expect(guard.canActivate(createMockContext())).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects with only the embedded security header (no session)', async () => {
    const guard = new DomoAuthGuard(mockSessions(), mockUsers);
    const ctx = createMockContext({ 'x-domo-embedded-security': 'some-token' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects with only the developer token header (no session)', async () => {
    const guard = new DomoAuthGuard(mockSessions(), mockUsers);
    const ctx = createMockContext({ 'x-domo-developer-token': 'some-token' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects without any auth header or session', async () => {
    const guard = new DomoAuthGuard(mockSessions(), mockUsers);
    await expect(guard.canActivate(createMockContext())).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
