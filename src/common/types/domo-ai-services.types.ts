// Enums

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

// Shared / Supporting types

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

// Response types

export interface AIServiceResponse {
  choices?: { output: string }[];
  isCustomerModel?: boolean;
  modelId?: string;
  modelProviderUsage?: any;
  output?: string;
  prompt?: string;
  requestId?: string;
  sessionId?: string;
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
