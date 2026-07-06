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
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { McpService } from './mcp.service.js';
import { CreateMcpServerDto } from './dto/create-mcp-server.dto.js';
import { UpdateMcpServerDto } from './dto/update-mcp-server.dto.js';
import { ExecuteToolDto } from './dto/execute-tool.dto.js';
import { ToggleServerDto } from './dto/toggle-server.dto.js';
import { SessionAuthGuard } from '../common/auth/session-auth.guard.js';
import type { McpServerConfig } from '../common/types/mcp.types.js';

function redactCredentials(
  server: McpServerConfig,
): Omit<McpServerConfig, 'bearerToken'> & { bearerToken?: undefined } {
  const { bearerToken: _, oauth2Config, ...rest } = server;
  if (!oauth2Config) return rest;
  const { clientSecret: __, ...safeOauth } = oauth2Config;
  return { ...rest, oauth2Config: safeOauth };
}

@ApiTags('MCP')
@Controller('mcp')
@UseGuards(SessionAuthGuard)
export class McpController {
  constructor(private readonly mcpService: McpService) {}

  // --- Server management ---

  @Get('servers')
  async findAll(@Query('enabled') enabled?: string) {
    const servers = await this.mcpService.findAll(enabled === 'true');
    return servers.map(redactCredentials);
  }

  @Post('servers')
  async create(@Body() dto: CreateMcpServerDto) {
    const server = await this.mcpService.create(dto);
    return redactCredentials(server);
  }

  @Get('servers/:id')
  async findOne(@Param('id') id: string) {
    const server = await this.mcpService.findOne(id);
    return redactCredentials(server);
  }

  @Put('servers/:id')
  async update(@Param('id') id: string, @Body() dto: UpdateMcpServerDto) {
    const server = await this.mcpService.update(id, dto);
    return redactCredentials(server);
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
  async syncTools(@Param('id') id: string) {
    const result = await this.mcpService.syncTools(id);
    return {
      server: redactCredentials(result.server),
      toolCount: result.toolCount,
    };
  }

  @Patch('servers/:id/toggle')
  async toggle(@Param('id') id: string, @Body() dto: ToggleServerDto) {
    const server = await this.mcpService.toggle(id, dto.enabled);
    return redactCredentials(server);
  }

  // --- Tools ---

  @Get('tools')
  getTools() {
    return this.mcpService.getAllTools();
  }

  @Post('tools/execute')
  @HttpCode(HttpStatus.OK)
  async executeTool(
    @Body() dto: ExecuteToolDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.mcpService.executeTool(
      dto.serverId,
      dto.toolName,
      dto.params,
    );
    res.setHeader('X-MCP-Untrusted', 'true');
    return result;
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
