import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ToolkitsService } from './toolkits.service.js';
import { SearchToolkitsDto } from './dto/search-toolkits.dto.js';
import { SessionAuthGuard } from '../common/auth/session-auth.guard.js';

@ApiTags('Toolkits')
@Controller('toolkits')
@UseGuards(SessionAuthGuard)
export class ToolkitsController {
  constructor(private readonly toolkitsService: ToolkitsService) {}

  @Post()
  @HttpCode(200)
  getToolkits(@Body() dto: SearchToolkitsDto) {
    return this.toolkitsService.getToolkits(dto);
  }
}
