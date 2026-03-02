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
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { McpService } from './mcp.service.js';
import { CreateMcpServerDto } from './dto/create-mcp-server.dto.js';
import { UpdateMcpServerDto } from './dto/update-mcp-server.dto.js';
import { ExecuteToolDto } from './dto/execute-tool.dto.js';
import { ToggleServerDto } from './dto/toggle-server.dto.js';
import { DomoAuthGuard } from '../common/guards/domo-auth.guard.js';

@ApiTags('MCP')
@Controller('mcp')
@UseGuards(DomoAuthGuard)
export class McpController {
  constructor(private readonly mcpService: McpService) {}

  // --- Server management ---

  @Get('servers')
  findAll(@Query('enabled') enabled?: string) {
    return this.mcpService.findAll(enabled === 'true');
  }

  @Post('servers')
  create(@Body() dto: CreateMcpServerDto) {
    return this.mcpService.create(dto);
  }

  @Get('servers/:id')
  findOne(@Param('id') id: string) {
    return this.mcpService.findOne(id);
  }

  @Put('servers/:id')
  update(@Param('id') id: string, @Body() dto: UpdateMcpServerDto) {
    return this.mcpService.update(id, dto);
  }

  @Delete('servers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.mcpService.remove(id);
  }

  @Post('servers/:id/test')
  @HttpCode(HttpStatus.OK)
  testConnection(@Param('id') id: string) {
    return this.mcpService.testConnection(id);
  }

  @Post('servers/:id/sync')
  @HttpCode(HttpStatus.OK)
  syncTools(@Param('id') id: string) {
    return this.mcpService.syncTools(id);
  }

  @Patch('servers/:id/toggle')
  toggle(@Param('id') id: string, @Body() dto: ToggleServerDto) {
    return this.mcpService.toggle(id, dto.enabled);
  }

  // --- Tools ---

  @Get('tools')
  getTools() {
    return this.mcpService.getAllTools();
  }

  @Post('tools/execute')
  @HttpCode(HttpStatus.OK)
  executeTool(@Body() dto: ExecuteToolDto) {
    return this.mcpService.executeTool(dto.serverId, dto.toolName, dto.params);
  }

  // --- OAuth2 ---

  @Get('oauth2/authorize/:serverId')
  authorize(@Param('serverId') serverId: string) {
    return this.mcpService.getOAuth2AuthorizationUrl(serverId);
  }

  @Post('oauth2/revoke/:serverId')
  @HttpCode(HttpStatus.OK)
  revoke(@Param('serverId') serverId: string) {
    return this.mcpService.revokeOAuth2(serverId);
  }

  @Get('oauth2/status/:serverId')
  getOAuth2Status(@Param('serverId') serverId: string) {
    return this.mcpService.getOAuth2Status(serverId);
  }

  @Post('oauth2/discover/:serverId')
  @HttpCode(HttpStatus.OK)
  discover(@Param('serverId') serverId: string) {
    return this.mcpService.discoverOAuth2(serverId);
  }
}
