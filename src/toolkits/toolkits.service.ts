import { Injectable } from '@nestjs/common';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';
import {
  Toolkit,
  ToolkitSearchPage,
} from '../common/types/domo-toolkit.types.js';
import { SearchToolkitsDto } from './dto/search-toolkits.dto.js';

const TOOLKITS_BASE = '/api/ai/v1/toolkits';

@Injectable()
export class ToolkitsService {
  constructor(private readonly domo: DomoProxyService) {}

  async getToolkits(): Promise<ToolkitSearchPage> {
    return this.domo.post<ToolkitSearchPage>(`${TOOLKITS_BASE}/search`, {
      limit: 50,
    });
  }

  async searchToolkits(dto: SearchToolkitsDto): Promise<ToolkitSearchPage> {
    return this.domo.post<ToolkitSearchPage>(`${TOOLKITS_BASE}/search`, dto);
  }
}
