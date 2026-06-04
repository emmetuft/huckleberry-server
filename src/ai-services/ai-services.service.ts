import { Injectable } from '@nestjs/common';
import { DomoProxyService } from '../domo-proxy/domo-proxy.service.js';
import {
  GetModelsResponse,
  AIServiceResponse,
} from '../common/types/domo-ai-services.types.js';
import { TextGenerationDto } from './dto/text-generation.dto.js';
import { TextSummarizationDto } from './dto/text-summarization.dto.js';
import { TextToSqlDto } from './dto/text-to-sql.dto.js';
import { ImageToTextDto } from './dto/image-to-text.dto.js';

const AI_BASE = '/api/ai/v1';

@Injectable()
export class AiServicesService {
  constructor(private readonly domo: DomoProxyService) {}

  async generate(dto: TextGenerationDto): Promise<AIServiceResponse> {
    return this.domo.post<AIServiceResponse>(`${AI_BASE}/text/generation`, dto);
  }

  async summarize(dto: TextSummarizationDto): Promise<AIServiceResponse> {
    return this.domo.post<AIServiceResponse>(`${AI_BASE}/text/summarize`, dto);
  }

  async textToSql(dto: TextToSqlDto): Promise<AIServiceResponse> {
    return this.domo.post<AIServiceResponse>(`${AI_BASE}/text/sql`, dto);
  }

  async imageToText(dto: ImageToTextDto): Promise<AIServiceResponse> {
    return this.domo.post<AIServiceResponse>(`${AI_BASE}/image/text`, dto);
  }

  async getModels(): Promise<GetModelsResponse> {
    return this.domo.get(`${AI_BASE}/settings/services/messages/models`);
  }
}
