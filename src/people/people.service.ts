import { Injectable } from '@nestjs/common';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';
import type { DomoUser, DomoGroup } from '../common/types/people.types.js';

@Injectable()
export class PeopleService {
  constructor(private readonly domo: DomoProxyService) {}

  async getUsers(): Promise<DomoUser[]> {
    // TODO: /api/identity/v1/users returns 403 insufficient_scope with embedded tokens.
    // Requires identity-domain scopes — same issue as groups below. Need correct path or scope grant.
    return this.domo.get<DomoUser[]>('/api/identity/v1/users');
  }

  async getUserById(id: string): Promise<DomoUser> {
    return this.domo.get<DomoUser>('/api/content/v3/users', { query: { id } });
  }

  async getUsersByIds(ids: string): Promise<DomoUser[]> {
    const idList = ids
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return Promise.all(idList.map((id) => this.getUserById(id)));
  }

  async getGroups(limit = 100, offset?: number): Promise<DomoGroup[]> {
    const query: Record<string, string> = {
      ascending: 'true',
      limit: String(limit),
    };
    if (offset != null) query.offset = String(offset);
    // TODO: legacy path — Heimdall maps /api/content/ to content:meta:read,
    // but DomoWeb's groups service enforces identity-domain scopes on top
    // and returns 403 insufficient_scope. The modern identity-domain path
    // is unknown — /api/user/groups/ and /api/identity/v1/groups/ both 404.
    // Need to confirm the correct hostname/path with the Domo identity team.
    return this.domo.get<DomoGroup[]>('/api/content/v2/groups/grouplist', {
      query,
    });
  }

  async getGroupById(id: string): Promise<DomoGroup> {
    return this.domo.get<DomoGroup>(`/api/content/v2/groups/${id}`);
  }
}
