import type { McpServerConfig } from '../common/types/mcp.types.js';

export interface McpRepository {
  findAll(
    customerId: string,
    userId: string,
    enabledOnly?: boolean,
  ): Promise<McpServerConfig[]>;
  findOne(
    customerId: string,
    userId: string,
    id: string,
  ): Promise<McpServerConfig | null>;
  create(
    customerId: string,
    userId: string,
    server: McpServerConfig,
  ): Promise<McpServerConfig>;
  update(
    customerId: string,
    userId: string,
    id: string,
    partial: Partial<McpServerConfig>,
  ): Promise<McpServerConfig | null>;
  remove(customerId: string, userId: string, id: string): Promise<boolean>;
}

export const MCP_REPOSITORY = Symbol('McpRepository');
