import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  McpServerConfig,
  McpToolDefinition,
  McpTestConnectionResult,
  McpToolResult,
} from '../common/types/mcp.types.js';
import type { CreateMcpServerDto } from './dto/create-mcp-server.dto.js';
import type { UpdateMcpServerDto } from './dto/update-mcp-server.dto.js';
import { MCP_REPOSITORY, type McpRepository } from './mcp.repository.js';
import { domoRequestContext } from '../common/auth/domo-request-context.js';

@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);

  constructor(@Inject(MCP_REPOSITORY) private readonly repo: McpRepository) {}

  private tenant(): { customerId: string; userId: string } {
    const ctx = domoRequestContext.getStore();
    if (!ctx) throw new Error('No request context — is DomoContextInterceptor active?');
    return { customerId: ctx.customerId, userId: ctx.userId };
  }

  async findAll(enabledOnly = false): Promise<McpServerConfig[]> {
    const { customerId, userId } = this.tenant();
    return this.repo.findAll(customerId, userId, enabledOnly);
  }

  async findOne(id: string): Promise<McpServerConfig> {
    const { customerId, userId } = this.tenant();
    const server = await this.repo.findOne(customerId, userId, id);
    if (!server) throw new NotFoundException(`MCP server ${id} not found`);
    return server;
  }

  async create(dto: CreateMcpServerDto): Promise<McpServerConfig> {
    const { customerId, userId } = this.tenant();
    const now = new Date().toISOString();
    const server: McpServerConfig = {
      id: randomUUID(),
      name: dto.name,
      url: dto.url,
      enabled: true,
      authType: dto.authType ?? 'none',
      bearerToken: dto.bearerToken,
      oauth2Config: dto.oauth2Config,
      tools: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.create(customerId, userId, server);
    this.logger.log(`Created MCP server ${server.id}: ${server.name}`);
    return server;
  }

  async update(id: string, dto: UpdateMcpServerDto): Promise<McpServerConfig> {
    const { customerId, userId } = this.tenant();
    const updated = await this.repo.update(customerId, userId, id, dto);
    if (!updated) throw new NotFoundException(`MCP server ${id} not found`);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const { customerId, userId } = this.tenant();
    const deleted = await this.repo.remove(customerId, userId, id);
    if (!deleted) throw new NotFoundException(`MCP server ${id} not found`);
  }

  async toggle(id: string, enabled: boolean): Promise<McpServerConfig> {
    const { customerId, userId } = this.tenant();
    const updated = await this.repo.update(customerId, userId, id, { enabled });
    if (!updated) throw new NotFoundException(`MCP server ${id} not found`);
    return updated;
  }

  async testConnection(id: string): Promise<McpTestConnectionResult> {
    const server = await this.findOne(id);
    try {
      const response = await fetch(`${server.url}/tools/list`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.buildAuthHeaders(server),
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        return { connected: false, error: `HTTP ${response.status}` };
      }

      const data = (await response.json()) as { tools?: unknown[] };
      return { connected: true, toolCount: data.tools?.length ?? 0 };
    } catch (error) {
      return {
        connected: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async syncTools(
    id: string,
  ): Promise<{ server: McpServerConfig; toolCount: number }> {
    const server = await this.findOne(id);
    const { customerId, userId } = this.tenant();
    try {
      const response = await fetch(`${server.url}/tools/list`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.buildAuthHeaders(server),
        },
        body: JSON.stringify({}),
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        throw new Error(`Failed to sync: HTTP ${response.status}`);
      }

      const data = (await response.json()) as {
        tools?: Array<{
          name: string;
          description?: string;
          inputSchema?: Record<string, unknown>;
        }>;
      };

      const tools: McpToolDefinition[] = (data.tools ?? []).map((t) => ({
        serverId: id,
        name: t.name,
        description: t.description ?? '',
        inputSchema: t.inputSchema ?? {},
      }));

      const updated = await this.repo.update(customerId, userId, id, { tools });
      this.logger.log(`Synced ${tools.length} tools from ${server.name}`);
      return { server: updated!, toolCount: tools.length };
    } catch (error) {
      throw new Error(
        `Sync failed for ${server.name}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  async getAllTools(): Promise<McpToolDefinition[]> {
    const servers = await this.findAll(true);
    const tools: McpToolDefinition[] = [];
    for (const server of servers) {
      if (server.tools) {
        tools.push(...server.tools);
      }
    }
    return tools;
  }

  async executeTool(
    serverId: string,
    toolName: string,
    params?: Record<string, unknown>,
  ): Promise<McpToolResult> {
    const server = await this.findOne(serverId);
    try {
      const response = await fetch(`${server.url}/tools/call`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.buildAuthHeaders(server),
        },
        body: JSON.stringify({ name: toolName, arguments: params ?? {} }),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        return { success: false, error: `HTTP ${response.status}` };
      }

      const data: unknown = await response.json();
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // --- OAuth2 ---

  getOAuth2AuthorizationUrl(serverId: string): {
    authorizationUrl: string;
    state: string;
  } {
    // Note: this is a stub — full OAuth2 for MCP is deferred.
    void serverId;
    const state = randomUUID();
    return { authorizationUrl: '', state };
  }

  revokeOAuth2(_serverId: string): { revoked: boolean } {
    return { revoked: true };
  }

  getOAuth2Status(_serverId: string): { status: string; authorizedAt?: string } {
    return { status: 'not_authorized' };
  }

  discoverOAuth2(_serverId: string): { message: string } {
    return { message: 'OAuth2 discovery not yet implemented' };
  }

  private buildAuthHeaders(server: McpServerConfig): Record<string, string> {
    if (server.authType === 'bearer' && server.bearerToken) {
      return { Authorization: `Bearer ${server.bearerToken}` };
    }
    return {};
  }
}
