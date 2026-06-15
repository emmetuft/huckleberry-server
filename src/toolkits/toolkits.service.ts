import { Injectable } from '@nestjs/common';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';
import { Toolkit } from '../common/types/domo-toolkit.types.js';

const TOOLKITS_BASE = '/api/ai/v1/toolkits';

@Injectable()
export class ToolkitsService {
  constructor(private readonly domo: DomoProxyService) {}

  async getToolkits(): Promise<Toolkit[]> {
    return this.domo.get<Toolkit[]>(TOOLKITS_BASE);
  }
}
