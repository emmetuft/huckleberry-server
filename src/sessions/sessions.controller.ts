import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SessionsService } from './sessions.service.js';
import { DomoAuthGuard } from '../common/guards/domo-auth.guard.js';
import { SearchSessionsDto } from './dto/search-sessions.dto.js';

@ApiTags('Sessions')
@Controller('sessions')
@UseGuards(DomoAuthGuard)
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  getSessions(@Body() dto: SearchSessionsDto, @Query('agentId') agentId?: string) {
    if (agentId) {
      dto = {
        ...dto,
        filters: [
          ...(dto.filters || []),
          { type: 'GROUP_ENTITY_ID', not: false, values: [agentId] },
        ],
      };
    }
    return this.sessionsService.getSessions(dto);
  }

  @Get(':sessionId')
  @HttpCode(HttpStatus.OK)
  getSession(@Param('sessionId') sessionId: string) {
    return this.sessionsService.getSession(sessionId);
  }

  @Get(':sessionId/events')
  @HttpCode(HttpStatus.OK)
  getSessionEvents(@Param('sessionId') sessionId: string) {
    return this.sessionsService.getSessionEvents(sessionId);
  }

  @Delete(':sessionId')
  @HttpCode(HttpStatus.OK)
  deleteSession(@Param('sessionId') sessionId: string) {
    return this.sessionsService.deleteSession(sessionId);
  }
}
