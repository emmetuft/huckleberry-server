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

  async getToolkits(): Promise<Toolkit[]> {
    return this.domo.get<Toolkit[]>(TOOLKITS_BASE);
  }

  async searchToolkits(dto: SearchToolkitsDto): Promise<ToolkitSearchPage> {
    return this.domo.post<ToolkitSearchPage>(`${TOOLKITS_BASE}/search`, dto);
  }
}
