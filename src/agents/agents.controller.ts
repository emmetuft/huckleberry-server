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
import type { Response as ExpressResponse } from 'express';
import { Readable } from 'node:stream';
import { AgentsService } from './agents.service.js';
import { CreateAgentDto } from './dto/create-agent.dto.js';
import { UpdateAgentDto } from './dto/update-agent.dto.js';
import { SearchAgentsDto } from './dto/search-agents.dto.js';
import { AgentContextUpdateDto } from './dto/agent-context-update.dto.js';
import { ExecuteAgentDto } from './dto/execute-agent.dto.js';
import { ResumeAgentDto } from './dto/resume-agent.dto.js';
import { DomoAuthGuard } from '../common/guards/domo-auth.guard.js';
import { AgentInclude } from '../common/types/domo-common.types.js';

@Controller('agents')
@UseGuards(DomoAuthGuard)
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Post()
  create(@Body() dto: CreateAgentDto) {
    return this.agentsService.create(dto);
  }

  @Get(':agentId')
  findOne(
    @Param('agentId') agentId: string,
    @Query('include') include?: AgentInclude,
  ) {
    return this.agentsService.findOne(agentId, include);
  }

  @Put(':agentId')
  update(@Param('agentId') agentId: string, @Body() dto: UpdateAgentDto) {
    return this.agentsService.update(agentId, dto);
  }

  @Delete(':agentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('agentId') agentId: string) {
    return this.agentsService.remove(agentId);
  }

  @Post('search')
  @HttpCode(HttpStatus.OK)
  search(@Body() dto: SearchAgentsDto) {
    return this.agentsService.search(dto);
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

    res.status(domoResponse.status);
    domoResponse.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    const readable = Readable.fromWeb(
      domoResponse.body as import('node:stream/web').ReadableStream,
    );
    readable.pipe(res);
  }

  @Post(':agentId/resume/streaming')
  async resumeStream(
    @Param('agentId') agentId: string,
    @Body() dto: ResumeAgentDto,
    @Res() res: ExpressResponse,
  ) {
    const domoResponse = await this.agentsService.resumeStream(agentId, dto);

    res.status(domoResponse.status);
    domoResponse.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    const readable = Readable.fromWeb(
      domoResponse.body as import('node:stream/web').ReadableStream,
    );
    readable.pipe(res);
  }
}
