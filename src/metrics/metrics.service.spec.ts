import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { MetricsService } from './metrics.service';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service';

const BASE = '/api/content/v1/metrics';

describe('MetricsService', () => {
  let service: MetricsService;
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
        MetricsService,
        { provide: DomoProxyService, useValue: mockDomo },
      ],
    }).compile();

    service = module.get<MetricsService>(MetricsService);
    domo = module.get(DomoProxyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('list', () => {
    it('should GET the metrics base path', async () => {
      domo.get.mockResolvedValue([]);
      await service.list();
      expect(domo.get).toHaveBeenCalledWith(BASE);
    });
  });

  describe('getById', () => {
    it('should GET metric by numeric id', async () => {
      const expected = { id: 42, name: 'Revenue' };
      domo.get.mockResolvedValue(expected);

      const result = await service.getById(42);

      expect(result).toEqual(expected);
      expect(domo.get).toHaveBeenCalledWith(`${BASE}/42`);
    });
  });

  describe('create', () => {
    it('should POST metric body to base path', async () => {
      const body = { name: 'Revenue', datasourceId: 'ds-1' };
      const expected = { id: 1, ...body };
      domo.post.mockResolvedValue(expected);

      const result = await service.create(body);

      expect(result).toEqual(expected);
      expect(domo.post).toHaveBeenCalledWith(BASE, body);
    });
  });

  describe('update', () => {
    it('should PUT metric body to id path', async () => {
      const body = { name: 'Updated Revenue' };
      domo.put.mockResolvedValue({ id: 42, ...body });

      await service.update(42, body);

      expect(domo.put).toHaveBeenCalledWith(`${BASE}/42`, body);
    });
  });

  describe('remove', () => {
    it('should DELETE without query params by default', async () => {
      domo.delete.mockResolvedValue(undefined);

      await service.remove(42);

      expect(domo.delete).toHaveBeenCalledWith(`${BASE}/42`, undefined);
    });

    it('should DELETE with hardDelete=true when specified', async () => {
      domo.delete.mockResolvedValue(undefined);

      await service.remove(42, true);

      expect(domo.delete).toHaveBeenCalledWith(`${BASE}/42`, {
        query: { hardDelete: 'true' },
      });
    });

    it('should DELETE with hardDelete=false when specified', async () => {
      domo.delete.mockResolvedValue(undefined);

      await service.remove(42, false);

      expect(domo.delete).toHaveBeenCalledWith(`${BASE}/42`, {
        query: { hardDelete: 'false' },
      });
    });
  });

  describe('filter', () => {
    it('should POST filter body to /filter', async () => {
      const body = { nameContains: 'revenue', limit: 10, offset: 0 };
      const expected = {
        metrics: [],
        totalCount: 0,
        count: 0,
        limit: 10,
        offset: 0,
      };
      domo.post.mockResolvedValue(expected);

      const result = await service.filter(body);

      expect(result).toEqual(expected);
      expect(domo.post).toHaveBeenCalledWith(`${BASE}/filter`, body);
    });
  });

  describe('byDatasource', () => {
    it('should GET metrics for a datasource id', async () => {
      domo.get.mockResolvedValue([]);

      await service.byDatasource('ds-abc-123');

      expect(domo.get).toHaveBeenCalledWith(`${BASE}/datasource/ds-abc-123`);
    });
  });

  describe('preview', () => {
    it('should POST preview request', async () => {
      const body = { metric: { name: 'Draft', datasourceId: 'ds-1' } };
      const expected = {
        metricSql: {},
        queryResultSet: { columns: [], rows: [] },
      };
      domo.post.mockResolvedValue(expected);

      const result = await service.preview(body);

      expect(result).toEqual(expected);
      expect(domo.post).toHaveBeenCalledWith(`${BASE}/preview`, body);
    });
  });

  describe('getSql', () => {
    it('should POST sql request to /:id/sql', async () => {
      const body = { dateGrain: 'MONTH' };
      const expected = { metric: {}, sql: 'SELECT ...' };
      domo.post.mockResolvedValue(expected);

      const result = await service.getSql(42, body);

      expect(result).toEqual(expected);
      expect(domo.post).toHaveBeenCalledWith(`${BASE}/42/sql`, body);
    });
  });

  describe('execute', () => {
    it('should POST sql request to /:id/execute', async () => {
      const body = { dateGrain: 'DAY' };
      const expected = { columns: [], rows: [] };
      domo.post.mockResolvedValue(expected);

      const result = await service.execute(42, body);

      expect(result).toEqual(expected);
      expect(domo.post).toHaveBeenCalledWith(`${BASE}/42/execute`, body);
    });
  });

  describe('executePop', () => {
    it('should POST period request to /:id/execute/pop', async () => {
      const body = {
        dateGrain: 'MONTH',
        periodDateRangeFilters: { current: {}, previous: {} },
      };
      const expected = { columns: [], rows: [] };
      domo.post.mockResolvedValue(expected);

      const result = await service.executePop(42, body);

      expect(result).toEqual(expected);
      expect(domo.post).toHaveBeenCalledWith(`${BASE}/42/execute/pop`, body);
    });
  });
});
