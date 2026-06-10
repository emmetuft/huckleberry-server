import { Injectable, Logger } from '@nestjs/common';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';
import {
  CustomAgent,
  SearchAgentsResponse,
} from '../common/types/domo-agent.types.js';
import { AgentInclude } from '../common/types/domo-common.types.js';
import { CreateAgentDto } from './dto/create-agent.dto.js';
import { UpdateAgentDto } from './dto/update-agent.dto.js';
import { AgentContextUpdateDto } from './dto/agent-context-update.dto.js';
import { SearchAgentsDto } from './dto/search-agents.dto.js';
import { ExecuteAgentDto } from './dto/execute-agent.dto.js';
import { ResumeAgentDto } from './dto/resume-agent.dto.js';

const AGENTS_BASE = '/api/ai/v1/agents';

@Injectable()
export class AgentsService {
  private readonly logger = new Logger(AgentsService.name);
  private agentCache = new Map<string, CustomAgent>();

  constructor(private readonly domo: DomoProxyService) {}

  async refreshAgents(): Promise<void> {
    const response = await this.search({ limit: 1000, offset: 0 });
    const newCache = new Map<string, CustomAgent>();

    this.logger.log(
      `Search response shape: ${Array.isArray(response) ? `array[${(response as unknown as unknown[]).length}]` : `object with keys [${Object.keys(response ?? {}).join(', ')}]`}`,
    );

    // The Domo OpenAPI spec defines the response as CustomAgentPage with a
    // `customAgents` array. Fall back to common alternatives defensively.
    const raw = response as unknown as Record<string, unknown>;
    let agents: CustomAgent[];
    if (Array.isArray(response)) {
      agents = response;
    } else {
      agents =
        (raw.customAgents as CustomAgent[] | undefined) ??
        (raw.agents as CustomAgent[] | undefined) ??
        [];
    }
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

  async create(dto: CreateAgentDto): Promise<CustomAgent> {
    return this.domo.post<CustomAgent>(AGENTS_BASE, dto);
  }

  async findOne(agentId: string, include?: AgentInclude): Promise<CustomAgent> {
    const query = include ? { include } : undefined;
    return this.domo.get<CustomAgent>(`${AGENTS_BASE}/${agentId}`, { query });
  }

  async update(agentId: string, dto: UpdateAgentDto): Promise<CustomAgent> {
    return this.domo.put<CustomAgent>(`${AGENTS_BASE}/${agentId}`, dto);
  }

  async remove(agentId: string): Promise<void> {
    await this.domo.delete(`${AGENTS_BASE}/${agentId}`);
  }

  async search(dto: SearchAgentsDto): Promise<SearchAgentsResponse> {
    return this.domo.post<SearchAgentsResponse>(`${AGENTS_BASE}/search`, dto);
  }

  async updateContext(
    agentId: string,
    dto: AgentContextUpdateDto,
  ): Promise<CustomAgent> {
    return this.domo.put<CustomAgent>(`${AGENTS_BASE}/${agentId}/context`, dto);
  }

  async executeStream(
    agentId: string,
    dto: ExecuteAgentDto,
  ): Promise<Response> {
    return this.domo.postStream(
      `${AGENTS_BASE}/${agentId}/execute/streaming`,
      dto,
    );
  }

  async resumeStream(agentId: string, dto: ResumeAgentDto): Promise<Response> {
    return this.domo.postStream(
      `${AGENTS_BASE}/${agentId}/resume/streaming`,
      dto,
    );
  }
}
