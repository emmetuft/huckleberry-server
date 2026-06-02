export interface Workflow {
  id: string;
  name: string;
  description?: string;
  version?: number;
  enabled?: boolean;
  createdBy?: string;
  createdDate?: string;
  modifiedBy?: string;
  modifiedDate?: string;
}
