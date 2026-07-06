import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { WorkflowsService } from './workflows.service.js';
import { SessionAuthGuard } from '../common/auth/session-auth.guard.js';
import { SearchDto } from '../common/dto/search.dto.js';

@ApiTags('Workflows')
@Controller('workflows')
@UseGuards(SessionAuthGuard)
export class WorkflowsController {
  constructor(private readonly workflowsService: WorkflowsService) {}

  @Post()
  async fetchWorkflows(@Body() dto: SearchDto) {
    const domoResponse = await this.workflowsService.getWorkflows(dto);
    const result = domoResponse as { searchObjects?: unknown[] };
    return result.searchObjects ?? [];
  }
}
