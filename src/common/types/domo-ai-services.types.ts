// ── Enums ──────────────────────────────────────────────────────────────────

export enum OutputStyle {
  BULLETED = 'bulleted',
  NUMBERED = 'numbered',
  PARAGRAPH = 'paragraph',
  UNKNOWN = 'unknown',
}

export enum ReasoningEffort {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

export enum SqlRequestOption {
  QUERY_ONLY = 'QUERY_ONLY',
  QUERY_AND_RESULTS = 'QUERY_AND_RESULTS',
}

export enum SeparatorType {
  COMMA = 'COMMA',
  TAB = 'TAB',
  PIPE = 'PIPE',
  SEMICOLON = 'SEMICOLON',
}

// ── Shared / Supporting types ──────────────────────────────────────────────

export interface ParameterizedPromptTemplate {
  template: string;
  parameters?: Record<string, string>;
}

export interface ReasoningConfig {
  enabled?: boolean;
  effort?: ReasoningEffort;
}

export interface ModelProviderUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface Choice {
  index: number;
  message?: string;
  finishReason?: string;
}

export interface JsonResponseFormat {
  type: string;
  schema?: Record<string, unknown>;
}

export interface AISchemaColumn {
  name: string;
  type: string;
  description?: string;
  sampleValues?: string[];
}

export interface AIDataSourceSchema {
  dataSourceId: string;
  columns?: AISchemaColumn[];
}

export interface SizeBoundary {
  min?: number;
  max?: number;
}

export interface ChunkingConfiguration {
  enabled?: boolean;
  sizeBoundary?: SizeBoundary;
  separatorType?: SeparatorType;
}

// ── Response ───────────────────────────────────────────────────────────────

export interface TextAIResponse {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices?: Choice[];
  usage?: ModelProviderUsage;
}

// ── Request types ──────────────────────────────────────────────────────────

export interface TextGenerationRequest {
  input: string;
  sessionId?: string;
  model?: string;
  system?: string;
  promptTemplate?: ParameterizedPromptTemplate;
  parameters?: Record<string, unknown>;
  modelConfiguration?: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
  reasoningConfig?: ReasoningConfig;
  responseFormat?: JsonResponseFormat;
}

export interface TextSummarizationRequest {
  input: string;
  sessionId?: string;
  model?: string;
  system?: string;
  promptTemplate?: ParameterizedPromptTemplate;
  parameters?: Record<string, unknown>;
  modelConfiguration?: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
  reasoningConfig?: ReasoningConfig;
  outputStyle?: OutputStyle;
  chunkingConfiguration?: ChunkingConfiguration;
}

export interface TextToSQLRequest {
  input: string;
  sessionId?: string;
  model?: string;
  system?: string;
  promptTemplate?: ParameterizedPromptTemplate;
  parameters?: Record<string, unknown>;
  modelConfiguration?: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
  reasoningConfig?: ReasoningConfig;
  dataSourceSchemas?: AIDataSourceSchema[];
  sqlRequestOption?: SqlRequestOption;
}

export interface GetModelsResponse {
  domoProvidedServiceModels: [
    {
      model: AIModel;
      serviceModel: ServiceModel;
    },
  ];
  serviceModels: [
    {
      model: AIModel;
      serviceModel: ServiceModel;
    },
  ];
  pageContext: {
    count: number;
    offset: number;
    totalCount: number;
  };
}

interface AIModel {
  id: string;
  name: string;
  type: string;
  description: string;
  tasks: any[];
  executionTypes: string[];
  capabilities: any;
  batchModelConfiguration: any;
}

interface ServiceModel {
  modelId: string;
  promptTemplate: string;
  service: string;
  systemMessage: string;
  task: string;
}
