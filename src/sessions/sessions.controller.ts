import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SessionsService } from './sessions.service.js';
import { DomoAuthGuard } from '../common/guards/domo-auth.guard.js';

@ApiTags('Sessions')
@Controller('sessions')
@UseGuards(DomoAuthGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get()
  getSessions() {
    return this.sessionsService.getSessions();
  }
}
