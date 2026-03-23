import { Injectable } from '@nestjs/common';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';

const TOOLKITS_BASE = '/api/ai/v1/toolkits';

@Injectable()
export class ToolkitsService {
  constructor(private readonly domo: DomoProxyService) {}

  async getToolkits(): Promise<unknown[]> {
    return this.domo.get<unknown[]>(TOOLKITS_BASE);
  }
}
