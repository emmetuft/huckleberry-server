import { Injectable } from '@nestjs/common';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';
import type { DomoUser } from '../common/types/people.types.js';

@Injectable()
export class IdentityService {
  constructor(private readonly domo: DomoProxyService) {}

  async getIdentity(): Promise<DomoUser> {
    return this.domo.get<DomoUser>('/api/content/v3/users/me');
  }
}
