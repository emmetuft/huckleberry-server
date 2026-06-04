/** Enums and shared base types for Domo Agent API */

export enum AgentType {
  REACT = 'REACT',
  REWOO = 'REWOO',
  SINGLE_TOOL = 'SINGLE_TOOL',
  TOOL_CALLING = 'TOOL_CALLING',
  MCP = 'MCP',
  UNKNOWN = 'UNKNOWN',
}

export enum AgentInclude {
  ALL = 'all',
  CONTEXT = 'context',
  TOOLKITS = 'toolkits',
  NONE = 'none',
}

export enum CustomAgentAccessLevel {
  OWNER = 'OWNER',
  EDIT = 'EDIT',
  READ = 'READ',
  NONE = 'NONE',
}

/** Pagination metadata returned by Domo search endpoints */
export interface PageContext {
  count: number;
  totalCount: number;
  offset: number;
}
