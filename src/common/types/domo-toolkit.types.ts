/** Context entry types for toolkits */
export enum ToolkitContextEntryType {
  CARD = 'CARD',
  DATASOURCE = 'DATASOURCE',
  FILTER = 'FILTER',
  PAGE = 'PAGE',
  FILESET = 'FILESET',
  DATE_RANGE_FILTER = 'DATE_RANGE_FILTER',
}

export interface ToolkitContextEntry {
  type: ToolkitContextEntryType;
  id: string;
  name?: string;
}

export interface ToolkitContext {
  entries: ToolkitContextEntry[];
}

export interface Tool {
  id: string;
  name: string;
  description?: string;
  type: string;
}

export interface Toolkit {
  id: string;
  name: string;
  description?: string;
  tools?: Tool[];
  context?: ToolkitContext;
  createdBy?: string;
  createdDate?: string;
}
