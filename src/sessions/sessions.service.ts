import { Injectable } from '@nestjs/common';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';
import { SearchSessionsDto } from './dto/search-sessions.dto.js';

const SESSION_BASE = '/api/ai/v1/sessions';
const GROUP = 'ASSISTANT';
const GROUP_ENTITY_ID = 'huckleberry';

@Injectable()
export class SessionsService {
  constructor(private readonly domo: DomoProxyService) {}

  async getSessions(dto: SearchSessionsDto) {
    const payload = {
      ...dto,
      filters: [
        ...(dto.filters || []),
        {
          type: 'GROUP',
          not: false,
          values: [GROUP],
        },
        {
          type: 'GROUP_ENTITY_ID',
          not: false,
          values: [GROUP_ENTITY_ID],
        },
      ],
    };
    return this.domo.post('/api/ai/v1/search/sessions', payload);
  }

  async getSession(sessionId: string) {
    return this.domo.get(`${SESSION_BASE}/${sessionId}`);
  }

  async getSessionEvents(sessionId: string) {
    return this.domo.get(`${SESSION_BASE}/${sessionId}/events`);
  }

  async deleteSession(sessionId: string) {
    return this.domo.delete(`${SESSION_BASE}/${sessionId}`);
  }
}
