import { Injectable } from '@nestjs/common';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';
import type { DomoUser, DomoGroup } from '../common/types/people.types.js';

@Injectable()
export class PeopleService {
  constructor(private readonly domo: DomoProxyService) {}

  async getUsers(): Promise<DomoUser[]> {
    return this.domo.get<DomoUser[]>('/api/v1/users');
  }

  async getUserById(id: string): Promise<DomoUser> {
    return this.domo.get<DomoUser>(`/api/v1/users/${id}`);
  }

  async getGroups(): Promise<DomoGroup[]> {
    return this.domo.get<DomoGroup[]>('/api/v1/groups');
  }

  async getGroupById(id: string): Promise<DomoGroup> {
    return this.domo.get<DomoGroup>(`/api/v1/groups/${id}`);
  }
}
