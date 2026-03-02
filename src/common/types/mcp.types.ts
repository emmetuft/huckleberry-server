export type McpAuthType = 'none' | 'bearer' | 'oauth2';

export interface OAuth2Config {
  clientId: string;
  clientSecret?: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes?: string[];
  redirectUri?: string;
}

export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  authType: McpAuthType;
  bearerToken?: string;
  oauth2Config?: OAuth2Config;
  tools?: McpToolDefinition[];
  createdAt: string;
  updatedAt: string;
}

export interface McpToolDefinition {
  serverId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpTestConnectionResult {
  connected: boolean;
  toolCount?: number;
  error?: string;
}

export interface McpToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export type CreateMcpServerInput = Pick<
  McpServerConfig,
  'name' | 'url' | 'authType' | 'bearerToken' | 'oauth2Config'
>;

export type UpdateMcpServerInput = Partial<CreateMcpServerInput>;
