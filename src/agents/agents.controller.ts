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
import { AgentsService } from './agents.service.js';
import { AgentDto } from './dto/agent.dto.js';
import { UpdateAgentDto } from './dto/update-agent.dto.js';
import { SearchAgentsDto } from './dto/search-agents.dto.js';
import { AgentContextUpdateDto } from './dto/agent-context-update.dto.js';
import { ExecuteAgentDto } from './dto/execute-agent.dto.js';
import { ResumeAgentDto } from './dto/resume-agent.dto.js';
import { SessionAuthGuard } from '../common/auth/session-auth.guard.js';
import { AgentInclude } from '../common/types/domo-common.types.js';

@ApiTags('Agents')
@Controller('agents')
@UseGuards(SessionAuthGuard)
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
  update(@Param('agentId') agentId: string, @Body() dto: UpdateAgentDto) {
    return this.agentsService.update(agentId, dto);
  }

  @Delete(':agentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('agentId') agentId: string) {
    return this.agentsService.remove(agentId);
  }

  @Get(':agentId/tools')
  getTools(
    @Param('agentId') agentId: string,
    @Query('sessionId') sessionId?: string,
  ) {
    return this.agentsService.getTools(agentId, sessionId);
  }

  @Patch(':agentId/context')
  updateContext(
    @Param('agentId') agentId: string,
    @Body() dto: AgentContextUpdateDto,
  ) {
    return this.agentsService.updateContext(agentId, dto);
  }

  @Post(':agentId/execute/streaming')
  executeStream(
    @Param('agentId') agentId: string,
    @Body() dto: ExecuteAgentDto,
    @Res() res: ExpressResponse,
  ) {
    return this.agentsService.executeStream(agentId, dto, res);
  }

  @Post(':agentId/resume/streaming')
  resumeStream(
    @Param('agentId') agentId: string,
    @Body() dto: ResumeAgentDto,
    @Res() res: ExpressResponse,
  ) {
    return this.agentsService.resumeStream(agentId, dto, res);
  }
}
