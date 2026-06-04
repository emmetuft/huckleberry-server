export interface Toolkit {
  toolkitId: string;
  name: string;
  description: string;
  tools: Tool[];
  context: Record<string, any>;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  updatedBy?: string;
}

interface Tool {
  toolId: string;
  domoToolId: string;
  overrideToolName: string;
  overrideToolDescription: string;
  type: string;
  customer: string;
  createdAt: string;
  createdBy: string;
  updatedAt?: string;
  updatedBy?: string;
}
