import { jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { SessionAuthGuard } from '../common/auth/session-auth.guard';

describe('MetricsController', () => {
  let controller: MetricsController;
  let service: jest.Mocked<MetricsService>;

  beforeEach(async () => {
    const mockService = {
      list: jest.fn(),
      getById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      filter: jest.fn(),
      byDatasource: jest.fn(),
      preview: jest.fn(),
      getSql: jest.fn(),
      execute: jest.fn(),
      executePop: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [{ provide: MetricsService, useValue: mockService }],
    })
      .overrideGuard(SessionAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<MetricsController>(MetricsController);
    service = module.get(MetricsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('list — delegates to service.list', async () => {
    service.list.mockResolvedValue([]);
    const result = await controller.list();
    expect(service.list).toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('create — delegates body to service.create', async () => {
    const body = { name: 'Revenue', datasourceId: 'ds-1' };
    const expected = { id: 1, ...body };
    service.create.mockResolvedValue(expected);

    const result = await controller.create(body);
    expect(service.create).toHaveBeenCalledWith(body);
    expect(result).toEqual(expected);
  });

  it('filter — delegates body to service.filter', async () => {
    const body = { nameContains: 'rev', limit: 10, offset: 0 };
    service.filter.mockResolvedValue({
      metrics: [],
      totalCount: 0,
      count: 0,
      limit: 10,
      offset: 0,
    });

    await controller.filter(body);
    expect(service.filter).toHaveBeenCalledWith(body);
  });

  it('preview — delegates body to service.preview', async () => {
    const body = { metric: { name: 'Draft', datasourceId: 'ds-1' } };
    service.preview.mockResolvedValue({
      metricSql: {},
      queryResultSet: { columns: [], rows: [] },
    });

    await controller.preview(body);
    expect(service.preview).toHaveBeenCalledWith(body);
  });

  it('byDatasource — passes dsId to service.byDatasource', async () => {
    service.byDatasource.mockResolvedValue([]);

    await controller.byDatasource('ds-abc');
    expect(service.byDatasource).toHaveBeenCalledWith('ds-abc');
  });

  it('getById — parses int id and calls service.getById', async () => {
    const expected = { id: 42, name: 'Revenue' };
    service.getById.mockResolvedValue(expected);

    const result = await controller.getById(42);
    expect(service.getById).toHaveBeenCalledWith(42);
    expect(result).toEqual(expected);
  });

  it('update — delegates id and body to service.update', async () => {
    const body = { name: 'Updated' };
    service.update.mockResolvedValue({ id: 42, ...body });

    await controller.update(42, body);
    expect(service.update).toHaveBeenCalledWith(42, body);
  });

  describe('remove', () => {
    it('calls service.remove with undefined hardDelete when param absent', async () => {
      service.remove.mockResolvedValue(undefined);

      await controller.remove(42, undefined);
      expect(service.remove).toHaveBeenCalledWith(42, undefined);
    });

    it('passes hardDelete=true when query param is "true"', async () => {
      service.remove.mockResolvedValue(undefined);

      await controller.remove(42, 'true');
      expect(service.remove).toHaveBeenCalledWith(42, true);
    });

    it('passes hardDelete=false when query param is "false"', async () => {
      service.remove.mockResolvedValue(undefined);

      await controller.remove(42, 'false');
      expect(service.remove).toHaveBeenCalledWith(42, false);
    });
  });

  it('getSql — delegates id and body to service.getSql', async () => {
    const body = { dateGrain: 'MONTH' };
    service.getSql.mockResolvedValue({ metric: {}, sql: 'SELECT ...' });

    await controller.getSql(42, body);
    expect(service.getSql).toHaveBeenCalledWith(42, body);
  });

  it('execute — delegates id and body to service.execute', async () => {
    const body = { dateGrain: 'DAY' };
    service.execute.mockResolvedValue({ columns: [], rows: [] });

    await controller.execute(42, body);
    expect(service.execute).toHaveBeenCalledWith(42, body);
  });

  it('executePop — delegates id and body to service.executePop', async () => {
    const body = { periodDateRangeFilters: { current: {}, previous: {} } };
    service.executePop.mockResolvedValue({ columns: [], rows: [] });

    await controller.executePop(42, body);
    expect(service.executePop).toHaveBeenCalledWith(42, body);
  });
});
