import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response as ExpressResponse } from 'express';
import { Readable } from 'node:stream';
import { AgentsService } from './agents.service.js';
import { AgentDto } from './dto/agent.dto.js';
import { SearchAgentsDto } from './dto/search-agents.dto.js';
import { AgentContextUpdateDto } from './dto/agent-context-update.dto.js';
import { ExecuteAgentDto } from './dto/execute-agent.dto.js';
import { ResumeAgentDto } from './dto/resume-agent.dto.js';
import { DomoAuthGuard } from '../common/guards/domo-auth.guard.js';
import { HttpHeader } from '../common/constants/http.constants.js';
import { DomoApiError } from '../common/filters/domo-exception.filter.js';
import { AgentInclude } from '../common/types/domo-common.types.js';

@ApiTags('Agents')
@Controller('agents')
@UseGuards(DomoAuthGuard)
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get()
  getAvailableAgents() {
    return this.agentsService.getAvailableAgents();
  }

  @Post()
  create(@Body() dto: AgentDto) {
    return this.agentsService.create(dto);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshAgents() {
    await this.agentsService.refreshAgents();
    return { count: this.agentsService.getAvailableAgents().length };
  }

  @Post('search')
  @HttpCode(HttpStatus.OK)
  search(@Body() dto: SearchAgentsDto) {
    return this.agentsService.search(dto);
  }

  // --- Parameterized routes ---

  @Get(':agentId')
  findOne(
    @Param('agentId') agentId: string,
    @Query('include') include?: AgentInclude,
  ) {
    return this.agentsService.findOne(agentId, include);
  }

  @Put(':agentId')
  update(@Param('agentId') agentId: string, @Body() dto: AgentDto) {
    return this.agentsService.update(agentId, dto);
  }

  @Delete(':agentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('agentId') agentId: string) {
    return this.agentsService.remove(agentId);
  }

  @Patch(':agentId/context')
  updateContext(
    @Param('agentId') agentId: string,
    @Body() dto: AgentContextUpdateDto,
  ) {
    return this.agentsService.updateContext(agentId, dto);
  }

  @Post(':agentId/execute/streaming')
  async executeStream(
    @Param('agentId') agentId: string,
    @Body() dto: ExecuteAgentDto,
    @Res() res: ExpressResponse,
  ) {
    const domoResponse = await this.agentsService.executeStream(agentId, dto);
    return this.pipeStreamResponse(domoResponse, res);
  }

  @Post(':agentId/resume/streaming')
  async resumeStream(
    @Param('agentId') agentId: string,
    @Body() dto: ResumeAgentDto,
    @Res() res: ExpressResponse,
  ) {
    const domoResponse = await this.agentsService.resumeStream(agentId, dto);
    return this.pipeStreamResponse(domoResponse, res);
  }

  // --- Helpers ---

  /** Headers managed by Node/Express that must not be copied from upstream. */
  private static readonly HOP_BY_HOP_HEADERS = new Set([
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
      if (!AgentsController.HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    const readable = Readable.fromWeb(
      domoResponse.body as import('node:stream/web').ReadableStream,
    );

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
