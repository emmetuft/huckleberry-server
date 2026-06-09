import { Test, TestingModule } from '@nestjs/testing';
import { AgentsService } from './agents.service';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service';
import { AgentInclude } from '../common/types/domo-common.types';

describe('AgentsService', () => {
  let service: AgentsService;
  let domo: jest.Mocked<DomoProxyService>;

  beforeEach(async () => {
    const mockDomo = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentsService,
        { provide: DomoProxyService, useValue: mockDomo },
      ],
    }).compile();

    service = module.get<AgentsService>(AgentsService);
    domo = module.get(DomoProxyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should POST to agents endpoint', async () => {
      const dto = { name: 'Test', prompt: 'Do stuff' };
      const expected = { id: '123', ...dto };
      domo.post.mockResolvedValue(expected);

      const result = await service.create(dto);

      expect(result).toEqual(expected);
      expect(domo.post).toHaveBeenCalledWith('/api/ai/v1/agents', dto);
    });
  });

  describe('findOne', () => {
    it('should GET agent by id', async () => {
      const expected = { id: '123', name: 'Test', prompt: 'Do stuff' };
      domo.get.mockResolvedValue(expected);

      const result = await service.findOne('123');

      expect(result).toEqual(expected);
      expect(domo.get).toHaveBeenCalledWith('/api/ai/v1/agents/123', {
        query: undefined,
      });
    });

    it('should pass include query param', async () => {
      domo.get.mockResolvedValue({});

      await service.findOne('123', AgentInclude.ALL);

      expect(domo.get).toHaveBeenCalledWith('/api/ai/v1/agents/123', {
        query: { include: 'all' },
      });
    });
  });

  describe('update', () => {
    it('should PUT to agent endpoint', async () => {
      const dto = { name: 'Updated' };
      domo.put.mockResolvedValue({ id: '123', ...dto });

      await service.update('123', dto);

      expect(domo.put).toHaveBeenCalledWith('/api/ai/v1/agents/123', dto);
    });
  });

  describe('remove', () => {
    it('should DELETE agent', async () => {
      domo.delete.mockResolvedValue(undefined);

      await service.remove('123');

      expect(domo.delete).toHaveBeenCalledWith('/api/ai/v1/agents/123');
    });
  });

  describe('search', () => {
    it('should POST DTO to search endpoint', async () => {
      const dto = {
        sort: 'CREATED',
        order: 'DESC' as const,
        search: { NAME: 'test' },
        limit: 10,
        offset: 0,
      };
      const expected = { agents: [], totalCount: 0, limit: 10, offset: 0 };
      domo.post.mockResolvedValue(expected);

      const result = await service.search(dto);

      expect(result).toEqual(expected);
      expect(domo.post).toHaveBeenCalledWith('/api/ai/v1/agents/search', dto);
    });

    it('should pass through filters array', async () => {
      const dto = {
        filters: [
          { type: 'NAME', not: false, values: ['agent'], operator: 'EQ' },
        ],
        limit: 5,
      };
      const expected = { agents: [], totalCount: 0, limit: 5, offset: 0 };
      domo.post.mockResolvedValue(expected);

      await service.search(dto);

      expect(domo.post).toHaveBeenCalledWith('/api/ai/v1/agents/search', {
        filters: [
          { type: 'NAME', not: false, values: ['agent'], operator: 'EQ' },
        ],
        limit: 5,
      });
    });

    it('should send minimal payload when no optional fields', async () => {
      const dto = { limit: 10, offset: 0 };
      const expected = { agents: [], totalCount: 0, limit: 10, offset: 0 };
      domo.post.mockResolvedValue(expected);

      await service.search(dto);

      expect(domo.post).toHaveBeenCalledWith('/api/ai/v1/agents/search', {
        limit: 10,
        offset: 0,
      });
    });
  });

  describe('updateContext', () => {
    it('should PUT to context endpoint', async () => {
      const dto = {
        add: { dataSourceIds: ['ds-1'] },
      };
      domo.put.mockResolvedValue({ id: '123' });

      await service.updateContext('123', dto);

      expect(domo.put).toHaveBeenCalledWith(
        '/api/ai/v1/agents/123/context',
        dto,
      );
    });
  });
});
