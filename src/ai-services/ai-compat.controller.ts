import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AiServicesService } from './ai-services.service.js';
import { DomoAuthGuard } from '../common/guards/domo-auth.guard.js';

/**
 * Backward-compatible route matching the frontend's ai.ts:
 *   POST /domo/ai/v1/text/generation
 *
 * Proxies to the same Domo AI text generation endpoint that
 * AiServicesController.generate() uses.
 */
@ApiTags('AI Services')
@Controller('domo/ai/v1/text')
@UseGuards(DomoAuthGuard)
export class AiCompatController {
  constructor(private readonly aiServices: AiServicesService) {}

  @Post('generation')
  @HttpCode(HttpStatus.OK)
  generate(@Body() body: any) {
    return this.aiServices.generate(body);
  }
}
