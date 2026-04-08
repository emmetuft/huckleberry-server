import { Injectable } from '@nestjs/common';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';
import type { DomoUser, DomoGroup } from '../common/types/people.types.js';

@Injectable()
export class PeopleService {
  constructor(private readonly domo: DomoProxyService) {}

  async getUsers(): Promise<DomoUser[]> {
    return this.domo.get<DomoUser[]>('/api/identity/v1/users');
  }

  async getUserById(id: string): Promise<DomoUser> {
    return this.domo.get<DomoUser>(`/api/content/v3/users?id=${id}`);
  }

  async getGroups(limit = 100, offset?: number): Promise<DomoGroup[]> {
    const query: Record<string, string> = {
      ascending: 'true',
      limit: String(limit),
    };
    if (offset != null) query.offset = String(offset);
    return this.domo.get<DomoGroup[]>('/api/content/v2/groups/grouplist', {
      query,
    });
  }

  async getGroupById(id: string): Promise<DomoGroup> {
    return this.domo.get<DomoGroup>(`/api/content/v2/groups/${id}`);
  }
}
