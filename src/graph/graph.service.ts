import { Injectable } from '@nestjs/common';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';
import type { GraphData } from '../common/types/ontology.types.js';
import type { FetchNodesDto } from './dto/fetch-nodes.dto.js';

const GRAPH_BASE = '/api/recall/v1';

@Injectable()
export class GraphService {
  constructor(private readonly domo: DomoProxyService) {}

  async fetchNodes(dto: FetchNodesDto): Promise<GraphData> {
    const graphId = '';
    return this.domo.post(`${GRAPH_BASE}/nodes/${graphId}/get`, dto);
  }
}
