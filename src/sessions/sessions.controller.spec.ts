import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { SessionAuthGuard } from '../common/auth/session-auth.guard';
import type { SearchSessionsDto } from './dto/search-sessions.dto';

describe('SessionsController', () => {
  let controller: SessionsController;
  let service: jest.Mocked<
    Pick<SessionsService, 'getSessions' | 'getAllSessions'>
  >;

  const mockSessions = { items: [], total: 0 };

  beforeEach(async () => {
    service = {
      getSessions: jest
        .fn<() => Promise<unknown>>()
        .mockResolvedValue(mockSessions),
      getAllSessions: jest
        .fn<() => Promise<unknown>>()
        .mockResolvedValue(mockSessions),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SessionsController],
      providers: [{ provide: SessionsService, useValue: service }],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<SessionsController>(SessionsController);
  });

  describe('getAllSessions', () => {
    it('delegates to sessionsService.getAllSessions with the dto', async () => {
      const dto: SearchSessionsDto = { limit: 10, offset: 0 };
      const result = await controller.getAllSessions(dto);
      expect(service.getAllSessions).toHaveBeenCalledWith(dto);
      expect(result).toBe(mockSessions);
    });

    it('passes an empty dto through unchanged', async () => {
      const dto: SearchSessionsDto = {};
      await controller.getAllSessions(dto);
      expect(service.getAllSessions).toHaveBeenCalledWith({});
    });

    it('does not mutate dto before forwarding', async () => {
      const dto: SearchSessionsDto = {
        filters: [{ type: 'USER_ID', values: ['u-1'], not: false }],
      };
      await controller.getAllSessions(dto);
      expect(service.getAllSessions).toHaveBeenCalledWith(dto);
    });
  });
});
