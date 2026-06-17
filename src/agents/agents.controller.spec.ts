import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { DomoAuthGuard } from '../common/guards/domo-auth.guard';
import { Response as ExpressResponse } from 'express';
import {
  CustomAgent,
  SearchAgentsResponse,
} from '../common/types/domo-agent.types';
import { SearchAgentsDto } from './dto/search-agents.dto';
import { ExecuteAgentDto } from './dto/execute-agent.dto';
import { ResumeAgentDto } from './dto/resume-agent.dto';

describe('AgentsController', () => {
  let controller: AgentsController;
  let service: jest.Mocked<AgentsService>;

  beforeEach(async () => {
    const mockService = {
      getAvailableAgents: jest.fn(),
      create: jest.fn(),
      refreshAgents: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      search: jest.fn(),
      updateContext: jest.fn(),
      executeStream: jest.fn(),
      resumeStream: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentsController],
      providers: [
        { provide: AgentsService, useValue: mockService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue({
              nodeEnv: 'development',
              huckleberryAgentId: 'test-huckleberry-id',
            }),
            getOrThrow: jest.fn().mockReturnValue({
              nodeEnv: 'development',
              huckleberryAgentId: 'test-huckleberry-id',
            }),
          },
        },
      ],
    })
      .overrideGuard(DomoAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AgentsController>(AgentsController);
    service = module.get(AgentsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should return available agents', () => {
    const agents: CustomAgent[] = [
      { id: '1', name: 'A', prompt: 'a' },
      { id: '2', name: 'B', prompt: 'b' },
    ];
    service.getAvailableAgents.mockReturnValue(agents);

    expect(controller.getAvailableAgents()).toEqual(agents);
    expect(service.getAvailableAgents).toHaveBeenCalled();
  });

  it('should refresh agents and return count', async () => {
    service.refreshAgents.mockResolvedValue(undefined);
    service.getAvailableAgents.mockReturnValue([
      { id: '1', name: 'A', prompt: 'a' },
    ] as CustomAgent[]);

    const result = await controller.refreshAgents();
    expect(service.refreshAgents).toHaveBeenCalled();
    expect(result).toEqual({ count: 1 });
  });

  it('should create an agent', async () => {
    const dto = { name: 'Test', prompt: 'Do stuff' };
    const expected: CustomAgent = {
      id: '123',
      name: 'Test',
      prompt: 'Do stuff',
    };
    service.create.mockResolvedValue(expected);

    const result = await controller.create(dto);
    expect(result).toEqual(expected);
  });

  it('should find one agent', async () => {
    const expected: CustomAgent = {
      id: '123',
      name: 'Test',
      prompt: 'Do stuff',
    };
    service.findOne.mockResolvedValue(expected);

    const result = await controller.findOne('123');
    expect(result).toEqual(expected);
  });

  it('should update an agent', async () => {
    const dto = { name: 'Updated' };
    const updated: CustomAgent = {
      id: '123',
      name: 'Updated',
      prompt: 'Do stuff',
    };
    service.update.mockResolvedValue(updated);

    const result = await controller.update('123', dto);
    expect(result).toEqual({ id: '123', name: 'Updated', prompt: 'Do stuff' });
  });

  it('should delete an agent', async () => {
    service.remove.mockResolvedValue(undefined);

    await controller.remove('123');
    expect(service.remove).toHaveBeenCalledWith('123');
  });

  it('should search agents', async () => {
    const dto: SearchAgentsDto = {
      sort: 'CREATED',
      order: 'DESC',
      search: { NAME: 'test' },
      limit: 10,
      offset: 0,
    };
    const expected: SearchAgentsResponse = {
      customAgents: [],
      pageContext: { count: 0, totalCount: 0, offset: 0 },
    };
    service.search.mockResolvedValue(expected);

    const result = await controller.search(dto);
    expect(result).toEqual(expected);
    expect(service.search).toHaveBeenCalledWith(dto);
  });

  it('should update agent context', async () => {
    const dto = { add: { dataSourceIds: ['ds-1'] } };
    const updated: CustomAgent = {
      id: '123',
      name: 'Test',
      prompt: 'Do stuff',
    };
    service.updateContext.mockResolvedValue(updated);

    const result = await controller.updateContext('123', dto);
    expect(result).toEqual({ id: '123', name: 'Test', prompt: 'Do stuff' });
  });

  describe('executeStream', () => {
    it('should delegate to service with agentId, dto, and res', async () => {
      const dto = { input: 'hello', sessionId: 'sess-1' } as ExecuteAgentDto;
      service.executeStream.mockResolvedValue(undefined);

      const res = {
        status: jest.fn().mockReturnThis(),
        setHeader: jest.fn(),
      } as unknown as ExpressResponse;

      await controller.executeStream('agent-1', dto, res);

      expect(service.executeStream).toHaveBeenCalledWith('agent-1', dto, res);
    });
  });

  describe('resumeStream', () => {
    it('should delegate to service with agentId, dto, and res', async () => {
      const dto = {
        sessionId: 'sess-1',
        sourceRequestId: 'req-1',
        response: 'continue',
      } as ResumeAgentDto;
      service.resumeStream.mockResolvedValue(undefined);

      const res = {
        status: jest.fn().mockReturnThis(),
        setHeader: jest.fn(),
      } as unknown as ExpressResponse;

      await controller.resumeStream('agent-1', dto, res);

      expect(service.resumeStream).toHaveBeenCalledWith('agent-1', dto, res);
    });
  });
});
