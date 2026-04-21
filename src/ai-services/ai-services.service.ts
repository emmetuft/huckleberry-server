import { Injectable } from '@nestjs/common';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';
import {
  TextGenerationRequest,
  TextSummarizationRequest,
  TextToSQLRequest,
  TextAIResponse,
} from '../common/types/domo-ai-services.types.js';

const TEXT_BASE = '/api/ai/v1/text';

@Injectable()
export class AiServicesService {
  constructor(private readonly domo: DomoProxyService) {}

  async generate(dto: TextGenerationRequest): Promise<TextAIResponse> {
    return this.domo.post<TextAIResponse>(`${TEXT_BASE}/generation`, dto);
  }

  async summarize(dto: TextSummarizationRequest): Promise<TextAIResponse> {
    return this.domo.post<TextAIResponse>(`${TEXT_BASE}/summarize`, dto);
  }

  async textToSql(dto: TextToSQLRequest): Promise<TextAIResponse> {
    return this.domo.post<TextAIResponse>(`${TEXT_BASE}/sql`, dto);
  }
}
