import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response as ExpressResponse } from 'express';
import { AgentsService } from '../agents/agents.service.js';
import type { AppConfig } from '../common/config/configuration.js';
import { AgentType } from '../common/types/domo-common.types.js';
import type { ExecuteAgentDto } from '../agents/dto/execute-agent.dto.js';
import type { ResumeAgentDto } from '../agents/dto/resume-agent.dto.js';
import { SessionsService } from '../sessions/sessions.service.js';
import type { SearchSessionsDto } from '../sessions/dto/search-sessions.dto.js';

@Injectable()
export class HuckleberryService {
  private readonly huckleberryAgentId: string;

  constructor(
    private readonly config: ConfigService,
    private readonly agents: AgentsService,
    private readonly sessions: SessionsService,
  ) {
    this.huckleberryAgentId =
      this.config.get<AppConfig>('app')?.huckleberryAgentId ?? 'huckleberry';
  }

  async getSessions(dto: SearchSessionsDto) {
    return this.sessions.getSessions({
      ...dto,
      filters: [
        ...(dto.filters || []),
        { type: 'GROUP', not: false, values: ['ASSISTANT'] },
        { type: 'GROUP_ENTITY_ID', not: false, values: ['huckleberry'] },
      ],
    });
  }

  async executeStream(
    dto: ExecuteAgentDto,
    res: ExpressResponse,
  ): Promise<void> {
    return this.agents.executeStream(
      this.huckleberryAgentId,
      { ...dto, agentType: AgentType.TOOL_CALLING },
      res,
    );
  }

  async resumeStream(dto: ResumeAgentDto, res: ExpressResponse): Promise<void> {
    return this.agents.resumeStream(
      this.huckleberryAgentId,
      {
        ...dto,
        batchConfirmationId: dto.batchId,
        agentStrategy: AgentType.TOOL_CALLING,
      },
      res,
    );
  }
}
