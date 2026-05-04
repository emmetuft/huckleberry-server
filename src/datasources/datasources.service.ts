import { Injectable } from '@nestjs/common';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';

@Injectable()
export class DataSourcesService {
  constructor(private readonly domo: DomoProxyService) {}

  async list(
    offset: number,
    limit: number,
    nameLike?: string,
  ): Promise<unknown> {
    const query: Record<string, string> = {
      offset: String(offset),
      limit: String(limit),
    };
    if (nameLike) {
      query.nameLike = nameLike;
    }
    return this.domo.get('/api/data/v3/datasources', { query });
  }

  async getSchema(dataSourceId: string): Promise<unknown> {
    return this.domo.get(`/api/data/v3/datasources/${dataSourceId}/schema`);
  }

  async queryData(
    dataSourceId: string,
    page: number,
    pageSize: number,
    body?: { columns: string[]; filters?: unknown },
  ): Promise<unknown> {
    // This doesn't work, need another endpoint
    return this.domo.post(`/api/query/v1/execute/${dataSourceId}`, {
      query: {
        columns: body?.columns ?? [],
        groupByColumns: [],
        having: null,
        limit: { limit: pageSize, offset: page * pageSize },
        orderByColumns: [],
        where: null,
      },
      querySource: 'data_table',
    });
  }
}
