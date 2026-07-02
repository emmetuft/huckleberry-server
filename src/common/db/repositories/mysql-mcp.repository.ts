import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type {
  McpServerConfig,
  McpToolDefinition,
  OAuth2Config,
} from '../../types/mcp.types.js';
import type { McpRepository } from '../../../mcp/mcp.repository.js';
import { DRIZZLE, type Db } from '../db.module.js';
import { mcpServers } from '../schema.js';
import { binaryToUuid, uuidToBinary } from '../uuid.js';

type McpRow = typeof mcpServers.$inferSelect;

function fromRow(row: McpRow): McpServerConfig {
  return {
    id: binaryToUuid(row.id),
    name: row.name,
    url: row.url,
    enabled: row.enabled === 1,
    authType: row.authType as McpServerConfig['authType'],
    bearerToken: row.bearerToken ?? undefined,
    oauth2Config: row.oauth2Config
      ? (JSON.parse(row.oauth2Config) as OAuth2Config)
      : undefined,
    tools: row.tools
      ? (JSON.parse(row.tools) as McpToolDefinition[])
      : undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

@Injectable()
export class MysqlMcpRepository implements McpRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Db) {}

  async findAll(
    customerId: string,
    userId: string,
    enabledOnly = false,
  ): Promise<McpServerConfig[]> {
    const conditions = [
      eq(mcpServers.customerId, customerId),
      eq(mcpServers.userId, uuidToBinary(userId)),
    ];
    if (enabledOnly) conditions.push(eq(mcpServers.enabled, 1));

    const rows = await this.db
      .select()
      .from(mcpServers)
      .where(and(...conditions));
    return rows.map(fromRow);
  }

  async findOne(
    customerId: string,
    userId: string,
    id: string,
  ): Promise<McpServerConfig | null> {
    const rows = await this.db
      .select()
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.id, uuidToBinary(id)),
          eq(mcpServers.customerId, customerId),
          eq(mcpServers.userId, uuidToBinary(userId)),
        ),
      )
      .limit(1);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async create(
    customerId: string,
    userId: string,
    server: McpServerConfig,
  ): Promise<McpServerConfig> {
    const now = new Date();
    await this.db.insert(mcpServers).values({
      id: uuidToBinary(server.id),
      customerId,
      userId: uuidToBinary(userId),
      name: server.name,
      url: server.url,
      enabled: server.enabled ? 1 : 0,
      authType: server.authType,
      bearerToken: server.bearerToken ?? null,
      oauth2Config: server.oauth2Config
        ? JSON.stringify(server.oauth2Config)
        : null,
      tools: server.tools ? JSON.stringify(server.tools) : null,
      createdAt: now,
      updatedAt: now,
    });
    return server;
  }

  async update(
    customerId: string,
    userId: string,
    id: string,
    partial: Partial<McpServerConfig>,
  ): Promise<McpServerConfig | null> {
    const existing = await this.findOne(customerId, userId, id);
    if (!existing) return null;

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (partial.name !== undefined) set.name = partial.name;
    if (partial.url !== undefined) set.url = partial.url;
    if (partial.enabled !== undefined) set.enabled = partial.enabled ? 1 : 0;
    if (partial.authType !== undefined) set.authType = partial.authType;
    if (partial.bearerToken !== undefined)
      set.bearerToken = partial.bearerToken ?? null;
    if (partial.oauth2Config !== undefined)
      set.oauth2Config = partial.oauth2Config
        ? JSON.stringify(partial.oauth2Config)
        : null;
    if (partial.tools !== undefined)
      set.tools = partial.tools ? JSON.stringify(partial.tools) : null;

    await this.db
      .update(mcpServers)
      .set(set)
      .where(
        and(
          eq(mcpServers.id, uuidToBinary(id)),
          eq(mcpServers.customerId, customerId),
          eq(mcpServers.userId, uuidToBinary(userId)),
        ),
      );

    return this.findOne(customerId, userId, id);
  }

  async remove(
    customerId: string,
    userId: string,
    id: string,
  ): Promise<boolean> {
    const result = await this.db
      .delete(mcpServers)
      .where(
        and(
          eq(mcpServers.id, uuidToBinary(id)),
          eq(mcpServers.customerId, customerId),
          eq(mcpServers.userId, uuidToBinary(userId)),
        ),
      );
    return ((result as unknown as { affectedRows?: number }).affectedRows ?? 0) > 0;
  }
}
