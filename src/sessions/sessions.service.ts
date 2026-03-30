import { Injectable } from '@nestjs/common';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';
import { SearchSessionsDto } from './dto/search-sessions.dto.js';

const GROUP = 'ASSISTANT';
const GROUP_ENTITY_ID = 'huckleberry';

@Injectable()
export class SessionsService {
  constructor(private readonly domo: DomoProxyService) {}

  async getSessions(dto: SearchSessionsDto) {
    const payload = {
      ...dto,
      group: GROUP,
      groupEntityId: GROUP_ENTITY_ID,
    };
    return this.domo.post('/api/ai/v1/search/sessions', payload);
  }

  async getSession(sessionId: string) {
    return this.domo.get(`/api/ai/v1/sessions/${sessionId}`);
  }

  async getSessionEvents(sessionId: string) {
    return this.domo.get(`/api/ai/v1/sessions/${sessionId}/events`);
  }

  async deleteSession(sessionId: string) {
    return this.domo.delete(`/api/ai/v1/sessions/${sessionId}`);
  }
}
