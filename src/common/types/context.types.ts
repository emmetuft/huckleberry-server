/** Intent classifications used by the context assembly pipeline */
export enum IntentClass {
  ANALYTICS_QUERY = 'analytics_query',
  DATA_EXPLORATION = 'data_exploration',
  ACTION_INITIATION = 'action_initiation',
  EXPLANATION = 'explanation',
  SUMMARIZATION = 'summarization',
  GENERAL = 'general',
}

/** SSE event types emitted by the context/query-stream endpoint */
export enum StreamType {
  CONTEXT = 'CONTEXT',
  THINKING = 'THINKING',
  TOOL_STARTED = 'TOOL_STARTED',
  TOOL_COMPLETED = 'TOOL_COMPLETED',
  ANSWER = 'ANSWER',
  ERROR = 'ERROR',
}

/** Assembled graph context snapshot sent with the CONTEXT event */
export interface GraphContext {
  entities: Array<{
    id: string;
    label: string;
    name: string;
    properties: Record<string, unknown>;
  }>;
  relationships: Array<{
    from: string;
    to: string;
    type: string;
  }>;
  intent: IntentClass;
  persona?: {
    role: string;
    department: string;
    focusAreas: string[];
    goals: string;
  };
}

/** Individual SSE stream message */
export interface StreamMessage {
  type: StreamType;
  content?: string;
  message?: string;
  context?: GraphContext;
}
