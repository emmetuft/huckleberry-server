import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  McpServerConfig,
  McpToolDefinition,
  McpTestConnectionResult,
  McpToolResult,
} from '../common/types/mcp.types.js';
import type { CreateMcpServerDto } from './dto/create-mcp-server.dto.js';
import type { UpdateMcpServerDto } from './dto/update-mcp-server.dto.js';

@Injectable()
export class McpService {
  private readonly logger = new Logger(McpService.name);
  private readonly store = new Map<string, McpServerConfig>();
  private readonly oauthTokens = new Map<
    string,
    { accessToken: string; authorizedAt: string }
  >();

  findAll(enabledOnly = false): McpServerConfig[] {
    const servers = Array.from(this.store.values());
    return enabledOnly ? servers.filter((s) => s.enabled) : servers;
  }

  findOne(id: string): McpServerConfig {
    const server = this.store.get(id);
    if (!server) throw new NotFoundException(`MCP server ${id} not found`);
    return server;
  }

  create(dto: CreateMcpServerDto): McpServerConfig {
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
    this.store.set(server.id, server);
    this.logger.log(`Created MCP server ${server.id}: ${server.name}`);
    return server;
  }

  update(id: string, dto: UpdateMcpServerDto): McpServerConfig {
    const existing = this.findOne(id);
    const updated: McpServerConfig = {
      ...existing,
      ...Object.fromEntries(
        Object.entries(dto).filter(([, v]) => v !== undefined),
      ),
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    this.store.set(id, updated);
    return updated;
  }

  remove(id: string): void {
    if (!this.store.has(id)) {
      throw new NotFoundException(`MCP server ${id} not found`);
    }
    this.store.delete(id);
    this.oauthTokens.delete(id);
  }

  toggle(id: string, enabled: boolean): McpServerConfig {
    const server = this.findOne(id);
    const updated = { ...server, enabled, updatedAt: new Date().toISOString() };
    this.store.set(id, updated);
    return updated;
  }

  async testConnection(id: string): Promise<McpTestConnectionResult> {
    const server = this.findOne(id);
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
    const server = this.findOne(id);
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

      const updated = { ...server, tools, updatedAt: new Date().toISOString() };
      this.store.set(id, updated);
      this.logger.log(`Synced ${tools.length} tools from ${server.name}`);
      return { server: updated, toolCount: tools.length };
    } catch (error) {
      throw new Error(
        `Sync failed for ${server.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  getAllTools(): McpToolDefinition[] {
    const tools: McpToolDefinition[] = [];
    for (const server of this.store.values()) {
      if (server.enabled && server.tools) {
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
    const server = this.findOne(serverId);
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

      const data = await response.json();
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
    const server = this.findOne(serverId);
    if (!server.oauth2Config) {
      throw new NotFoundException(
        `Server ${serverId} has no OAuth2 configuration`,
      );
    }

    const state = randomUUID();
    const params = new URLSearchParams({
      client_id: server.oauth2Config.clientId,
      response_type: 'code',
      state,
      ...(server.oauth2Config.redirectUri && {
        redirect_uri: server.oauth2Config.redirectUri,
      }),
      ...(server.oauth2Config.scopes?.length && {
        scope: server.oauth2Config.scopes.join(' '),
      }),
    });

    return {
      authorizationUrl: `${server.oauth2Config.authorizationUrl}?${params.toString()}`,
      state,
    };
  }

  revokeOAuth2(serverId: string): { revoked: boolean } {
    this.findOne(serverId); // validate existence
    this.oauthTokens.delete(serverId);
    return { revoked: true };
  }

  getOAuth2Status(serverId: string): { status: string; authorizedAt?: string } {
    this.findOne(serverId);
    const token = this.oauthTokens.get(serverId);
    if (token) {
      return { status: 'authorized', authorizedAt: token.authorizedAt };
    }
    return { status: 'not_authorized' };
  }

  discoverOAuth2(serverId: string): { message: string } {
    this.findOne(serverId);
    return { message: 'OAuth2 discovery not yet implemented' };
  }

  private buildAuthHeaders(server: McpServerConfig): Record<string, string> {
    if (server.authType === 'bearer' && server.bearerToken) {
      return { Authorization: `Bearer ${server.bearerToken}` };
    }
    if (server.authType === 'oauth2') {
      const token = this.oauthTokens.get(server.id);
      if (token) {
        return { Authorization: `Bearer ${token.accessToken}` };
      }
    }
    return {};
  }
}
