import { Injectable } from '@nestjs/common';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';
import type { FetchNodesDto } from './dto/fetch-nodes.dto.js';
import type { CypherSearchDto } from './dto/cypher-search.dto.js';
import type { ShortestPathDto } from './dto/shortest-path.dto.js';

const GRAPH_BASE = '/api/recall/v1';

// Default graph ID per Mako's SessionGraphProperties. Override via
// assistant.session-graph.graphId config if the environment uses a different ID.
const graphId = 'ai-sessions';

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
      query:
        opts.sampleSize != null ? { sampleSize: String(opts.sampleSize) } : {},
    });
  }

  async shortestPath(dto: ShortestPathDto) {
    return this.domo.post(`${GRAPH_BASE}/${graphId}/paths/shortest`, dto);
  }
}
