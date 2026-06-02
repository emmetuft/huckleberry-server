import { CustomAgentAccessLevel } from './domo-common.types';

/** Full Domo CustomAgent resource */
export interface CustomAgent {
  id: string;
  customer: string;
  owner: string;
  name: string;
  description: string;
  prompt: string;
  systemMessage?: string;
  model?: string;
  settings?: CustomAgentSettings;
  uiSettings?: Record<string, any>;
  theme?: Record<string, any>;
  context?: AgentContext;
  toolkitIds?: string[];
  created?: string;
  createdBy?: string;
  updated?: string;
  updatedBy?: string;
  permission: CustomAgentAccessLevel;
}

/** Agent context — data sources, cards, pages, file sets the agent can access */
export interface AgentContext {
  id?: string;
  dataSourceIds?: string[];
  cardIds?: string[];
  pageIds?: number[];
  ignorableDataSourceIds?: string[];
  filters?: Object[];
  dateRangeFilter?: DateRangeFilter;
  fileSets?: FileSet[];
  descriptions?: Record<string, string>;
}

interface FileSet {
  id: string;
  name?: string;
}
interface DateRangeFilter {
  startDate?: string;
  endDate?: string;
  column?: string;
}

export interface CustomAgentSettings {
  id?: string;
  properties?: Record<string, any>;
}

/** Request body for POST /api/ai/v1/agents */
export interface CreateCustomAgentRequest {
  name: string;
  description: string;
  prompt: string;
  systemMessage?: string;
  model?: string;
  settings?: CustomAgentSettings;
  uiSettings?: Record<string, any>;
  theme?: Record<string, any>;
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

/** Individual filter for the Domo agent search API */
export interface SearchFilter {
  type: string;
  values: string[];
  operator?: string;
  not?: boolean;
}

/** Search agents request — matches the Domo POST /agents/search payload */
export interface SearchAgentsRequest {
  limit?: number;
  offset?: number;
  sortFieldMap?: Record<string, 'ASC' | 'DESC'>;
  filters?: SearchFilter[];
  searchFieldMap?: Record<string, string>;
  dateFilters?: Record<string, unknown>;
  groupByMap?: Record<string, unknown>;
}

/** Pagination metadata returned by Domo search endpoints */
export interface PageContext {
  count: number;
  totalCount: number;
  offset: number;
}

/** Paginated search response (CustomAgentPage in the Domo OpenAPI spec) */
export interface SearchAgentsResponse {
  customAgents: CustomAgent[];
  pageContext: PageContext;
}
