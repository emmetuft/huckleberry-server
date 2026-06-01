import { Injectable } from '@nestjs/common';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';
import {
  TextGenerationRequest,
  TextSummarizationRequest,
  TextToSQLRequest,
  TextAIResponse,
  GetModelsResponse,
} from '../common/types/domo-ai-services.types.js';

const AI_BASE = '/api/ai/v1';

@Injectable()
export class AiServicesService {
  constructor(private readonly domo: DomoProxyService) {}

  async generate(dto: TextGenerationRequest): Promise<TextAIResponse> {
    return this.domo.post<TextAIResponse>(`${AI_BASE}/text/generation`, dto);
  }

  async summarize(dto: TextSummarizationRequest): Promise<TextAIResponse> {
    return this.domo.post<TextAIResponse>(`${AI_BASE}/text/summarize`, dto);
  }

  async textToSql(dto: TextToSQLRequest): Promise<TextAIResponse> {
    return this.domo.post<TextAIResponse>(`${AI_BASE}/text/sql`, dto);
  }

  async getModels(): Promise<GetModelsResponse> {
    return this.domo.get(`${AI_BASE}/settings/services/messages/models`);
  }
}
