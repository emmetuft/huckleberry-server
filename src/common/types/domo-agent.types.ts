import { AgentType, CustomAgentAccessLevel } from './domo-common.types.js';

/** File set reference for agent context */
export interface FileSet {
  id: string;
  name?: string;
}

/** Date range filter for agent context */
export interface DateRangeFilter {
  startDate?: string;
  endDate?: string;
  column?: string;
}

/** Agent context — data sources, cards, pages, file sets the agent can access */
export interface AgentContext {
  dataSourceIds?: string[];
  cardIds?: string[];
  pageIds?: number[];
  ignorableDataSourceIds?: string[];
  fileSets?: FileSet[];
  dateRangeFilter?: DateRangeFilter;
  descriptions?: Record<string, string>;
}

/** Access control entry for an agent */
export interface CustomAgentAccess {
  userId: string;
  accessLevel: CustomAgentAccessLevel;
}

/** Full Domo CustomAgent resource */
export interface CustomAgent {
  id: string;
  name: string;
  prompt: string;
  systemMessage?: string;
  context?: AgentContext;
  toolkitIds?: string[];
  agentType?: AgentType;
  access?: CustomAgentAccess[];
  createdBy?: string;
  createdDate?: string;
  lastModifiedBy?: string;
  lastModifiedDate?: string;
}

/** Request body for POST /api/ai/v1/agents */
export interface CreateCustomAgentRequest {
  name: string;
  prompt: string;
  systemMessage?: string;
  context?: AgentContext;
  toolkitIds?: string[];
}

/** Request body for PUT /api/ai/v1/agents/{agentId} */
export interface UpdateCustomAgentRequest {
  name?: string;
  prompt?: string;
  systemMessage?: string;
  context?: AgentContext;
  toolkitIds?: string[];
}

/** Incremental context update — add/remove fields */
export interface AgentContextUpdateRequest {
  add?: Partial<AgentContext>;
  remove?: Partial<AgentContext>;
}

/** Search agents request */
export interface SearchAgentsRequest {
  filters?: Record<string, unknown>;
  sort?: string;
  order?: 'ASC' | 'DESC';
  limit?: number;
  offset?: number;
}

/** Paginated search response */
export interface SearchAgentsResponse {
  agents: CustomAgent[];
  totalCount: number;
  limit: number;
  offset: number;
}
