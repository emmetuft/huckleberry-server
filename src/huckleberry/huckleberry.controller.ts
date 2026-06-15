import { Body, Controller, HttpCode, HttpStatus, Post, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response as ExpressResponse } from 'express';
import { HuckleberryService } from './huckleberry.service.js';
import { ExecuteAgentDto } from '../agents/dto/execute-agent.dto.js';
import { ResumeAgentDto } from '../agents/dto/resume-agent.dto.js';
import { DomoAuthGuard } from '../common/guards/domo-auth.guard.js';
import { SearchSessionsDto } from '../sessions/dto/search-sessions.dto.js';

@ApiTags('Huckleberry')
@Controller('huckleberry')
@UseGuards(DomoAuthGuard)
export class HuckleberryController {
  constructor(private readonly huckleberryService: HuckleberryService) {}

  @Post('sessions')
  @HttpCode(HttpStatus.OK)
  getSessions(@Body() dto: SearchSessionsDto) {
    return this.huckleberryService.getSessions(dto);
  }

  @Post('execute/streaming')
  async executeStream(
    @Body() dto: ExecuteAgentDto,
    @Res() res: ExpressResponse,
  ) {
    return this.huckleberryService.executeStream(dto, res);
  }

  @Post('resume/streaming')
  async resumeStream(@Body() dto: ResumeAgentDto, @Res() res: ExpressResponse) {
    return this.huckleberryService.resumeStream(dto, res);
  }
}
