import { AgentType } from './domo-common.types.js';
import { AgentContext } from './domo-agent.types.js';

/** Request body for POST /api/ai/v1/agents/{agentId}/execute/streaming */
export interface AssistantExecutionRequest {
  input: string;
  agentType?: AgentType;
  sessionId?: string;
  model?: string;
  aiAssistantContext?: AgentContext;
  agentSettingOverrides?: any;
}

/** Request body for POST /api/ai/v1/agents/{agentId}/resume/streaming */
export interface AgentResumeRequest {
  sessionId?: string;
  sourceRequestId?: string;
  input?: string;
  aiAssistantContext?: AgentContext;
  batchConfirmationId?: string;
  agentStrategy?: AgentType;
  response?: unknown;
}

/** Session context returned by GET /api/ai/v1/assistant/sessions/{sessionId}/context */
export interface SessionContext {
  sessionId: string;
  agentId?: string;
  context?: AgentContext;
  createdDate?: string;
  lastModifiedDate?: string;
}
