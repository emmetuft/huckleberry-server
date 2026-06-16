import { Injectable } from '@nestjs/common';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';
import { SearchSessionsDto } from './dto/search-sessions.dto.js';

const SESSION_BASE = '/api/ai/v1/sessions';

@Injectable()
export class SessionsService {
  constructor(private readonly domo: DomoProxyService) {}

  async getSessions(dto: SearchSessionsDto) {
    return this.domo.post('/api/ai/v1/search/sessions', dto);
  }

  async getAllSessions(dto: SearchSessionsDto) {
    return this.domo.post('/api/ai/v1/search/all-sessions', dto);
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
