import { Injectable } from '@nestjs/common';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';
import { SearchDto } from '../common/dto/search.dto.js';

@Injectable()
export class ConnectorsService {
  constructor(private readonly domo: DomoProxyService) {}

  async getConnectorImage(databaseId: string): Promise<Response> {
    return this.domo.getStream(
      `/api/data/v1/connectors/display/${encodeURIComponent(databaseId)}/images/320.png`,
    );
  }

  async fetchConnectors(dto: SearchDto): Promise<unknown[]> {
    const payload = {
      ...dto,
      entities: ['CONNECTOR'],
      query: '*',
      queryProfile: 'APP_STORE',
    };
    return this.domo.post('/api/search/v1/query', payload);
  }
}
