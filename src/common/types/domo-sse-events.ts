import { ActionType, AISessionEvent } from './domo-common.types.js';

/** Source reference returned in action completed events */
export interface SourceReference {
  type: string;
  id: string;
  name?: string;
}

// ─── Event Interfaces ────────────────────────────────────────────

export interface AIDurationEvent extends AISessionEvent {
  toe: 'AIDurationEvent';
  durationMs: number;
}

export interface AIHeartbeatEvent extends AISessionEvent {
  toe: 'AIHeartbeatEvent';
}

export interface AIInsightEvent extends AISessionEvent {
  toe: 'AIInsightEvent';
  insight: string;
}

export interface AIServiceRequestEvent extends AISessionEvent {
  toe: 'AIServiceRequestEvent';
  service: string;
  request: unknown;
}

export interface AIServiceResponseEvent extends AISessionEvent {
  toe: 'AIServiceResponseEvent';
  service: string;
  response: unknown;
}

export interface AIWarningEvent extends AISessionEvent {
  toe: 'AIWarningEvent';
  warning: string;
}

export interface ActionCardChunkEvent extends AISessionEvent {
  toe: 'ActionCardChunkEvent';
  chunk: string;
}

export interface ActionCompletedEvent extends AISessionEvent {
  toe: 'ActionCompletedEvent';
  actionType: ActionType;
  outputs: unknown;
  durationMs: number;
  sourceReferences?: SourceReference[];
}

export interface ActionPromptEvent extends AISessionEvent {
  toe: 'ActionPromptEvent';
  prompt: string;
}

export interface ActionRequestEvent extends AISessionEvent {
  toe: 'ActionRequestEvent';
  action: string;
  inputs: unknown;
}

export interface ActionStartedEvent extends AISessionEvent {
  toe: 'ActionStartedEvent';
  tool: string;
  inputs: unknown;
}

export interface AssistantPausedEvent extends AISessionEvent {
  toe: 'AssistantPausedEvent';
  reason?: string;
}

export interface AssistantRequestEvent extends AISessionEvent {
  toe: 'AssistantRequestEvent';
  input: string;
}

export interface AssistantResponseChunkEvent extends AISessionEvent {
  toe: 'AssistantResponseChunkEvent';
  output: string;
}

export interface AssistantResponseEndEvent extends AISessionEvent {
  toe: 'AssistantResponseEndEvent';
}

export interface AssistantResponseEvent extends AISessionEvent {
  toe: 'AssistantResponseEvent';
  output: string;
}

export interface AssistantResponseStartEvent extends AISessionEvent {
  toe: 'AssistantResponseStartEvent';
}

export interface AssistantResumedEvent extends AISessionEvent {
  toe: 'AssistantResumedEvent';
}

export interface CancelEvent extends AISessionEvent {
  toe: 'CancelEvent';
}

export interface FileGeneratedEvent extends AISessionEvent {
  toe: 'FileGeneratedEvent';
  fileName: string;
  fileUrl: string;
}

export interface McpNotificationEvent extends AISessionEvent {
  toe: 'McpNotificationEvent';
  method: string;
  params: unknown;
}

export interface McpRequestEvent extends AISessionEvent {
  toe: 'McpRequestEvent';
  method: string;
  params: unknown;
}

export interface McpResponseEvent extends AISessionEvent {
  toe: 'McpResponseEvent';
  result: unknown;
}

export interface RequestConfirmationEvent extends AISessionEvent {
  toe: 'RequestConfirmationEvent';
  message: string;
  confirmationId: string;
}

export interface ToolCompletedEvent extends AISessionEvent {
  toe: 'ToolCompletedEvent';
  tool: string;
  result: unknown;
  durationMs?: number;
}

export interface ToolPausedEvent extends AISessionEvent {
  toe: 'ToolPausedEvent';
  tool: string;
  reason?: string;
}

export interface ToolResumedEvent extends AISessionEvent {
  toe: 'ToolResumedEvent';
  tool: string;
}

export interface ToolStartedEvent extends AISessionEvent {
  toe: 'ToolStartedEvent';
  tool: string;
  inputs: unknown;
}

// ─── Discriminated Union ─────────────────────────────────────────

export type DomoSseEvent =
  | AIDurationEvent
  | AIHeartbeatEvent
  | AIInsightEvent
  | AIServiceRequestEvent
  | AIServiceResponseEvent
  | AIWarningEvent
  | ActionCardChunkEvent
  | ActionCompletedEvent
  | ActionPromptEvent
  | ActionRequestEvent
  | ActionStartedEvent
  | AssistantPausedEvent
  | AssistantRequestEvent
  | AssistantResponseChunkEvent
  | AssistantResponseEndEvent
  | AssistantResponseEvent
  | AssistantResponseStartEvent
  | AssistantResumedEvent
  | CancelEvent
  | FileGeneratedEvent
  | McpNotificationEvent
  | McpRequestEvent
  | McpResponseEvent
  | RequestConfirmationEvent
  | ToolCompletedEvent
  | ToolPausedEvent
  | ToolResumedEvent
  | ToolStartedEvent;
