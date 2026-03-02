import { Injectable } from '@nestjs/common';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';

@Injectable()
export class DataSourcesService {
  constructor(private readonly domo: DomoProxyService) {}

  async list(offset: number, limit: number, nameLike?: string): Promise<unknown> {
    const query: Record<string, string> = {
      offset: String(offset),
      limit: String(limit),
    };
    if (nameLike) {
      query.nameLike = nameLike;
    }
    return this.domo.get('/api/data/v1/datasources', { query });
  }

  async getSchema(dataSourceId: string): Promise<unknown> {
    return this.domo.get(`/api/data/v1/datasources/${dataSourceId}/schema`);
  }
}
