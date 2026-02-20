import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';

describe('AgentsController', () => {
  let controller: AgentsController;
  let service: jest.Mocked<AgentsService>;

  beforeEach(async () => {
    const mockService = {
      create: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      search: jest.fn(),
      updateContext: jest.fn(),
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
              devToken: 'test-token',
            }),
          },
        },
      ],
    }).compile();

    controller = module.get<AgentsController>(AgentsController);
    service = module.get(AgentsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should create an agent', async () => {
    const dto = { name: 'Test', prompt: 'Do stuff' };
    const expected = { id: '123', ...dto };
    service.create.mockResolvedValue(expected as any);

    const result = await controller.create(dto as any);
    expect(result).toEqual(expected);
  });

  it('should find one agent', async () => {
    const expected = { id: '123', name: 'Test', prompt: 'Do stuff' };
    service.findOne.mockResolvedValue(expected as any);

    const result = await controller.findOne('123');
    expect(result).toEqual(expected);
  });

  it('should update an agent', async () => {
    const dto = { name: 'Updated' };
    service.update.mockResolvedValue({ id: '123', ...dto } as any);

    const result = await controller.update('123', dto as any);
    expect(result).toEqual({ id: '123', name: 'Updated' });
  });

  it('should delete an agent', async () => {
    service.remove.mockResolvedValue(undefined);

    await controller.remove('123');
    expect(service.remove).toHaveBeenCalledWith('123');
  });

  it('should search agents', async () => {
    const dto = { limit: 10 };
    const expected = { agents: [], totalCount: 0, limit: 10, offset: 0 };
    service.search.mockResolvedValue(expected as any);

    const result = await controller.search(dto as any);
    expect(result).toEqual(expected);
  });

  it('should update agent context', async () => {
    const dto = { add: { dataSourceIds: ['ds-1'] } };
    service.updateContext.mockResolvedValue({ id: '123' } as any);

    const result = await controller.updateContext('123', dto as any);
    expect(result).toEqual({ id: '123' });
  });
});
