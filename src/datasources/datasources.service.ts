import { Injectable } from '@nestjs/common';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';

type ColumnExpr = { exprType: string; column: string };

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
    body?: { columns: Array<string | ColumnExpr>; filters?: unknown },
  ): Promise<unknown> {
    const columns: ColumnExpr[] = (body?.columns ?? []).map((col) =>
      typeof col === 'string' ? { exprType: 'COLUMN', column: col } : col,
    );
    return this.domo.post(`/api/query/v1/execute/${dataSourceId}`, {
      query: {
        columns,
        groupByColumns: [],
        having: null,
        limit: { limit: pageSize, offset: page * pageSize },
        orderByColumns: [],
        where: null,
      },
    });
  }
}
