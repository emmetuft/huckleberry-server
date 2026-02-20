import { Injectable } from '@nestjs/common';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';
import {
  CustomAgent,
  CreateCustomAgentRequest,
  UpdateCustomAgentRequest,
  AgentContextUpdateRequest,
  SearchAgentsRequest,
  SearchAgentsResponse,
} from '../common/types/domo-agent.types.js';
import { AgentInclude } from '../common/types/domo-common.types.js';

const AGENTS_BASE = '/api/ai/v1/agents';

@Injectable()
export class AgentsService {
  constructor(private readonly domo: DomoProxyService) {}

  async create(dto: CreateCustomAgentRequest): Promise<CustomAgent> {
    return this.domo.post<CustomAgent>(AGENTS_BASE, dto);
  }

  async findOne(agentId: string, include?: AgentInclude): Promise<CustomAgent> {
    const query = include ? { include } : undefined;
    return this.domo.get<CustomAgent>(`${AGENTS_BASE}/${agentId}`, { query });
  }

  async update(
    agentId: string,
    dto: UpdateCustomAgentRequest,
  ): Promise<CustomAgent> {
    return this.domo.put<CustomAgent>(`${AGENTS_BASE}/${agentId}`, dto);
  }

  async remove(agentId: string): Promise<void> {
    await this.domo.delete(`${AGENTS_BASE}/${agentId}`);
  }

  async search(dto: SearchAgentsRequest): Promise<SearchAgentsResponse> {
    return this.domo.post<SearchAgentsResponse>(`${AGENTS_BASE}/search`, dto);
  }

  async updateContext(
    agentId: string,
    dto: AgentContextUpdateRequest,
  ): Promise<CustomAgent> {
    return this.domo.put<CustomAgent>(`${AGENTS_BASE}/${agentId}/context`, dto);
  }
}
