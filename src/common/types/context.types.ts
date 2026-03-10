/** Lightweight context snapshot sent with the initial SSE event */
export interface QueryContext {
  dataSources?: Array<{ id: string; name?: string }>;
  tools?: unknown[];
  files?: unknown[];
}
