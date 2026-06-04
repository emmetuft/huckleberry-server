import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AiServicesService } from './ai-services.service.js';
import { TextGenerationDto } from './dto/text-generation.dto.js';
import { TextSummarizationDto } from './dto/text-summarization.dto.js';
import { TextToSqlDto } from './dto/text-to-sql.dto.js';
import { ImageToTextDto } from './dto/image-to-text.dto.js';
import { DomoAuthGuard } from '../common/guards/domo-auth.guard.js';

@ApiTags('AI Services')
@Controller('ai')
@UseGuards(DomoAuthGuard)
export class AiServicesController {
  constructor(private readonly aiServices: AiServicesService) {}

  @Post('text/generation')
  @HttpCode(HttpStatus.OK)
  generate(@Body() dto: TextGenerationDto) {
    return this.aiServices.generate(dto);
  }

  @Post('text/summarize')
  @HttpCode(HttpStatus.OK)
  summarize(@Body() dto: TextSummarizationDto) {
    return this.aiServices.summarize(dto);
  }

  @Post('text/sql')
  @HttpCode(HttpStatus.OK)
  textToSql(@Body() dto: TextToSqlDto) {
    return this.aiServices.textToSql(dto);
  }

  @Post('image/text')
  @HttpCode(HttpStatus.OK)
  imageToText(@Body() dto: ImageToTextDto) {
    return this.aiServices.imageToText(dto);
  }

  @Get('models')
  @HttpCode(HttpStatus.OK)
  getModels() {
    return this.aiServices.getModels();
  }
}
