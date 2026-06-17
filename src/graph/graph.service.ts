import { Injectable } from '@nestjs/common';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';
import type { FetchNodesDto } from './dto/fetch-nodes.dto.js';
import type { CypherSearchDto } from './dto/cypher-search.dto.js';
import type { ShortestPathDto } from './dto/shortest-path.dto.js';

const GRAPH_BASE = '/api/recall/v1';

// graphId is empty string for the default graph — placeholder until the
// correct customer-scoped ID is wired through configuration or the request.
const graphId = '';

@Injectable()
export class GraphService {
  constructor(private readonly domo: DomoProxyService) {}

  async fetchNodes(dto: FetchNodesDto) {
    return this.domo.post(`${GRAPH_BASE}/nodes/${graphId}/get`, dto);
  }

  async cypherSearch(dto: CypherSearchDto) {
    return this.domo.post(`${GRAPH_BASE}/${graphId}/search/cypher`, dto);
  }

  async getSchema(opts: { sampleSize?: number; includeProperties?: boolean }) {
    const endpoint = opts.includeProperties
      ? `${GRAPH_BASE}/${graphId}/schema/properties`
      : `${GRAPH_BASE}/${graphId}/schema`;
    return this.domo.get(endpoint, {
      query: opts.sampleSize != null ? { sampleSize: String(opts.sampleSize) } : {},
    });
  }

  async shortestPath(dto: ShortestPathDto) {
    return this.domo.post(`${GRAPH_BASE}/${graphId}/paths/shortest`, dto);
  }
}
