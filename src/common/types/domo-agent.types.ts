import { CustomAgentAccessLevel, PageContext } from './domo-common.types';

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

interface CustomAgentSettings {
  id?: string;
  properties?: Record<string, any>;
}

/** Paginated search response (CustomAgentPage in the Domo OpenAPI spec) */
export interface SearchAgentsResponse {
  customAgents: CustomAgent[];
  pageContext: PageContext;
}
