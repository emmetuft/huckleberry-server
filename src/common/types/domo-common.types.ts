/** Enums and shared base types for Domo Agent API */

export enum AgentType {
  REACT = 'REACT',
  REWOO = 'REWOO',
  SINGLE_TOOL = 'SINGLE_TOOL',
  TOOL_CALLING = 'TOOL_CALLING',
  MCP = 'MCP',
  UNKNOWN = 'UNKNOWN',
}

export enum ActionType {
  DATASET_TEXT_TO_SQL_ACTION = 'dataset_text_to_sql_action',
  CODE_ENGINE_EXECUTION_ACTION = 'code_engine_execution_action',
  KB_QUERY_ACTION = 'kb_query_action',
  GENERIC_TOOL_ACTION = 'generic_tool_action',
  WORKFLOW_ACTION = 'workflow_action',
  CARD_ACTION = 'card_action',
  PAGE_ACTION = 'page_action',
  FILE_SET_ACTION = 'file_set_action',
  MCP_TOOL_ACTION = 'mcp_tool_action',
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

/** Base interface for all Domo SSE session events */
export interface AISessionEvent {
  sessionId: string;
  requestId: string;
  parentEventId?: string;
  eventId: string;
  timestamp: string;
  error?: string;
  /** Type-of-event discriminator */
  toe: string;
}
