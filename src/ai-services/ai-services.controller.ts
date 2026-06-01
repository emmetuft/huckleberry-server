import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AiServicesService } from './ai-services.service.js';
import { TextGenerationDto } from './dto/text-generation.dto.js';
import { TextSummarizationDto } from './dto/text-summarization.dto.js';
import { TextToSqlDto } from './dto/text-to-sql.dto.js';
import { ApiTags } from '@nestjs/swagger';
import { DomoAuthGuard } from '../common/guards/domo-auth.guard.js';

@ApiTags('AI Services')
@Controller('ai')
@UseGuards(DomoAuthGuard)
export class AiServicesController {
  constructor(private readonly aiServices: AiServicesService) {}

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  generate(@Body() dto: TextGenerationDto) {
    return this.aiServices.generate(dto);
  }

  @Post('summarize')
  @HttpCode(HttpStatus.OK)
  summarize(@Body() dto: TextSummarizationDto) {
    return this.aiServices.summarize(dto);
  }

  @Post('sql')
  @HttpCode(HttpStatus.OK)
  textToSql(@Body() dto: TextToSqlDto) {
    return this.aiServices.textToSql(dto);
  }

  @Get('models')
  @HttpCode(HttpStatus.OK)
  getModels() {
    return this.aiServices.getModels();
  }
}
