import { Injectable, Logger } from '@nestjs/common';
import { Readable } from 'node:stream';
import type { Response as ExpressResponse } from 'express';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';
import {
  CustomAgent,
  SearchAgentsResponse,
} from '../common/types/domo-agent.types.js';
import { AgentInclude } from '../common/types/domo-common.types.js';
import { AgentDto } from './dto/agent.dto.js';
import { AgentContextUpdateDto } from './dto/agent-context-update.dto.js';
import { SearchAgentsDto } from './dto/search-agents.dto.js';
import { ExecuteAgentDto } from './dto/execute-agent.dto.js';
import { ResumeAgentDto } from './dto/resume-agent.dto.js';
import { HttpHeader } from '../common/constants/http.constants.js';
import { DomoApiError } from '../common/filters/domo-exception.filter.js';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-length',
  'content-encoding',
  'host',
  'te',
  'trailer',
  'upgrade',
]);

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

  async create(dto: AgentDto): Promise<CustomAgent> {
    return this.domo.post<CustomAgent>(AGENTS_BASE, dto);
  }

  async findOne(agentId: string, include?: AgentInclude): Promise<CustomAgent> {
    const query = include ? { include } : undefined;
    return this.domo.get<CustomAgent>(`${AGENTS_BASE}/${agentId}`, { query });
  }

  async update(agentId: string, dto: AgentDto): Promise<CustomAgent> {
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
    res: ExpressResponse,
  ): Promise<void> {
    const domoResponse = await this.domo.postStream(
      `${AGENTS_BASE}/${agentId}/execute/streaming`,
      dto,
    );
    return this.pipeStreamResponse(domoResponse, res);
  }

  async resumeStream(
    agentId: string,
    dto: ResumeAgentDto,
    res: ExpressResponse,
  ): Promise<void> {
    const domoResponse = await this.domo.postStream(
      `${AGENTS_BASE}/${agentId}/resume/streaming`,
      dto,
    );
    return this.pipeStreamResponse(domoResponse, res);
  }

  private async pipeStreamResponse(
    domoResponse: Response,
    res: ExpressResponse,
  ): Promise<void> {
    if (!domoResponse.ok) {
      const text = await domoResponse.text().catch(() => '');
      throw new DomoApiError(
        domoResponse.status,
        text || domoResponse.statusText,
        domoResponse.headers.get(HttpHeader.ContentType),
      );
    }

    if (!domoResponse.body) {
      throw new DomoApiError(502, 'Upstream returned no response body');
    }

    res.status(domoResponse.status);
    domoResponse.headers.forEach((value, key) => {
      if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    const readable = Readable.fromWeb(
      domoResponse.body as import('node:stream/web').ReadableStream,
    );

    const decoder = new TextDecoder();
    readable.on('data', (chunk: Buffer) => {
      this.logger.debug(decoder.decode(chunk, { stream: true }));
    });

    await new Promise<void>((resolve, reject) => {
      readable.on('error', (err) => {
        if (!res.headersSent) {
          reject(
            new DomoApiError(502, `Upstream stream error: ${String(err)}`),
          );
        } else {
          res.end();
          resolve();
        }
      });
      readable.pipe(res).on('finish', resolve);
    });
  }
}
