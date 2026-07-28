import { Injectable } from '@nestjs/common';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';
import { MetricSearchFiltersDto } from './dto/metric-search.dto.js';
import {
  MetricSqlRequestDto,
  MetricSqlPeriodRequestDto,
} from './dto/metric-sql.dto.js';
import { MetricPreviewRequestDto } from './dto/metric-preview.dto.js';

const BASE = '/api/content/v1/metrics';

@Injectable()
export class MetricsService {
  constructor(private readonly domo: DomoProxyService) {}

  list(): Promise<unknown> {
    return this.domo.get(BASE);
  }

  getById(id: number): Promise<unknown> {
    return this.domo.get(`${BASE}/${id}`);
  }

  create(body: unknown): Promise<unknown> {
    return this.domo.post(BASE, body);
  }

  update(id: number, body: unknown): Promise<unknown> {
    return this.domo.put(`${BASE}/${id}`, body);
  }

  remove(id: number, hardDelete?: boolean): Promise<unknown> {
    const query =
      hardDelete !== undefined ? { hardDelete: String(hardDelete) } : undefined;
    return this.domo.delete(`${BASE}/${id}`, query ? { query } : undefined);
  }

  filter(body: MetricSearchFiltersDto): Promise<unknown> {
    return this.domo.post(`${BASE}/filter`, body);
  }

  byDatasource(dsId: string): Promise<unknown> {
    return this.domo.get(`${BASE}/datasource/${dsId}`);
  }

  preview(body: MetricPreviewRequestDto): Promise<unknown> {
    return this.domo.post(`${BASE}/preview`, body);
  }

  getSql(id: number, body: MetricSqlRequestDto): Promise<unknown> {
    return this.domo.post(`${BASE}/${id}/sql`, body);
  }

  execute(id: number, body: MetricSqlRequestDto): Promise<unknown> {
    return this.domo.post(`${BASE}/${id}/execute`, body);
  }

  executePop(id: number, body: MetricSqlPeriodRequestDto): Promise<unknown> {
    return this.domo.post(`${BASE}/${id}/execute/pop`, body);
  }
}
