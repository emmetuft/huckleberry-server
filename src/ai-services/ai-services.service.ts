import { Injectable } from '@nestjs/common';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';
import {
  TextGenerationRequest,
  ChatCompletionRequest,
  TextSummarizationRequest,
  TextToSQLRequest,
  TextToBeastModeRequest,
  TextAIResponse,
} from '../common/types/domo-ai-services.types.js';

const TEXT_BASE = '/api/ai/v1/text';

@Injectable()
export class AiServicesService {
  constructor(private readonly domo: DomoProxyService) {}

  async generate(dto: TextGenerationRequest): Promise<TextAIResponse> {
    return this.domo.post<TextAIResponse>(`${TEXT_BASE}/generation`, dto);
  }

  async chat(dto: ChatCompletionRequest): Promise<TextAIResponse> {
    return this.domo.post<TextAIResponse>(`${TEXT_BASE}/chat`, dto);
  }

  async chatStream(dto: ChatCompletionRequest): Promise<Response> {
    return this.domo.postStream(`${TEXT_BASE}/chat/streaming`, dto);
  }

  async summarize(dto: TextSummarizationRequest): Promise<TextAIResponse> {
    return this.domo.post<TextAIResponse>(`${TEXT_BASE}/summarize`, dto);
  }

  async textToSql(dto: TextToSQLRequest): Promise<TextAIResponse> {
    return this.domo.post<TextAIResponse>(`${TEXT_BASE}/sql`, dto);
  }

  async textToBeastMode(dto: TextToBeastModeRequest): Promise<TextAIResponse> {
    return this.domo.post<TextAIResponse>(`${TEXT_BASE}/beastmode`, dto);
  }
}
