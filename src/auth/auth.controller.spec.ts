import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { SignupService } from './signup.service';
import { USER_REPOSITORY } from './user.repository';
import { SessionAuthGuard } from '../common/auth/session-auth.guard';
import { DomoLinkService } from '../common/auth/domo-link/domo-link.service';
import type { HuckleberryPrincipal } from './types';
import type { Request, Response } from 'express';

describe('AuthController', () => {
  let controller: AuthController;
  let link: jest.Mocked<Pick<DomoLinkService, 'unlink'>>;
  let sessions: jest.Mocked<Pick<SessionService, 'revoke'>>;

  const mockUser: HuckleberryPrincipal = {
    userId: 'user-1',
    sessionId: 'sid-1',
    email: 'test@example.com',
    status: 'active',
  };

  const mockRes = {
    clearCookie: jest.fn(),
  } as unknown as Response;

  beforeEach(async () => {
    link = {
      unlink: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };
    sessions = {
      revoke: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: {} },
        { provide: SignupService, useValue: {} },
        { provide: SessionService, useValue: sessions },
        { provide: DomoLinkService, useValue: link },
        { provide: USER_REPOSITORY, useValue: {} },
      ],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  describe('logout', () => {
    it('calls unlink and revokes the session when user is present', async () => {
      const req = { user: mockUser } as Request & {
        user: HuckleberryPrincipal;
      };
      await controller.logout(req, mockRes);
      expect(link.unlink).toHaveBeenCalledWith(mockUser.userId);
      expect(sessions.revoke).toHaveBeenCalledWith(mockUser.sessionId);
    });

    it('skips unlink and revoke when no user on request', async () => {
      const req = {} as Request & { user?: HuckleberryPrincipal };
      await controller.logout(req, mockRes);
      expect(link.unlink).not.toHaveBeenCalled();
      expect(sessions.revoke).not.toHaveBeenCalled();
    });

    it('clears session and csrf cookies regardless of auth state', async () => {
      const req = {} as Request & { user?: HuckleberryPrincipal };
      await controller.logout(req, mockRes);
      expect(mockRes.clearCookie).toHaveBeenCalledWith('hb_session', {
        path: '/',
      });
      expect(mockRes.clearCookie).toHaveBeenCalledWith('csrf_token', {
        path: '/',
      });
    });
  });
});
