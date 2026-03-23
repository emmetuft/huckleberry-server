import { Injectable } from '@nestjs/common';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';

@Injectable()
export class SessionsService {
  constructor(private readonly domo: DomoProxyService) {}

  async getSessions(): Promise<unknown[]> {
    return this.domo.post<unknown[]>('/api/ai/v1/search/sessions');
  }
}
