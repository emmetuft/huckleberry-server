import { Injectable } from '@nestjs/common';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';
import type { Workflow } from '../common/types/workflow.types.js';
import { SearchDto } from '../common/dto/search.dto.js';

@Injectable()
export class WorkflowsService {
  constructor(private readonly domo: DomoProxyService) {}

  async getWorkflows(dto: SearchDto): Promise<Workflow[]> {
    const payload = {
      ...dto,
      entities: ['WORKFLOW_MODEL'],
      query: '*',
    };
    return this.domo.post('/api/search/v1/query', payload);
  }
}
