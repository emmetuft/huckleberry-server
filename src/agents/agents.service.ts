import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';
import {
  CustomAgent,
  CreateCustomAgentRequest,
  UpdateCustomAgentRequest,
  AgentContextUpdateRequest,
  SearchAgentsRequest,
  SearchAgentsResponse,
} from '../common/types/domo-agent.types.js';
import {
  AssistantExecutionRequest,
  AgentResumeRequest,
} from '../common/types/domo-session.types.js';
import { AgentInclude } from '../common/types/domo-common.types.js';

const AGENTS_BASE = '/api/ai/v1/agents';

@Injectable()
export class AgentsService implements OnModuleInit {
  private readonly logger = new Logger(AgentsService.name);
  private agentCache = new Map<string, CustomAgent>();

  constructor(private readonly domo: DomoProxyService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.refreshAgents();
    } catch (error) {
      this.logger.error('Failed to load agent registry on startup', error);
    }
  }

  async refreshAgents(): Promise<void> {
    const response = await this.search({ limit: 1000, offset: 0 });
    const newCache = new Map<string, CustomAgent>();
    // Handle both array response and { agents: [...] } wrapper
    const agents: CustomAgent[] = Array.isArray(response)
      ? (response as unknown as CustomAgent[])
      : (response.agents ?? []);
    for (const agent of agents) {
      newCache.set(agent.id, agent);
    }
    this.agentCache = newCache;
    this.logger.log(`Agent registry loaded: ${this.agentCache.size} agents`);
  }

  getAvailableAgents(): CustomAgent[] {
    return Array.from(this.agentCache.values());
  }

  isValidAgent(agentId: string): boolean {
    return this.agentCache.has(agentId);
  }

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

  async executeStream(
    agentId: string,
    dto: AssistantExecutionRequest,
  ): Promise<Response> {
    return this.domo.postStream(
      `${AGENTS_BASE}/${agentId}/execute/streaming`,
      dto,
    );
  }

  async resumeStream(
    agentId: string,
    dto: AgentResumeRequest,
  ): Promise<Response> {
    return this.domo.postStream(
      `${AGENTS_BASE}/${agentId}/resume/streaming`,
      dto,
    );
  }
}
