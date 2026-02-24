import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response as ExpressResponse } from 'express';
import { Readable } from 'node:stream';
import { AiServicesService } from './ai-services.service.js';
import { TextGenerationDto } from './dto/text-generation.dto.js';
import { ChatCompletionDto } from './dto/chat-completion.dto.js';
import { TextSummarizationDto } from './dto/text-summarization.dto.js';
import { TextToSqlDto } from './dto/text-to-sql.dto.js';
import { TextToBeastModeDto } from './dto/text-to-beastmode.dto.js';
import { DomoAuthGuard } from '../common/guards/domo-auth.guard.js';

@Controller('ai-services')
@UseGuards(DomoAuthGuard)
export class AiServicesController {
  constructor(private readonly aiServices: AiServicesService) {}

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  generate(@Body() dto: TextGenerationDto) {
    return this.aiServices.generate(dto);
  }

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  chat(@Body() dto: ChatCompletionDto) {
    return this.aiServices.chat(dto);
  }

  @Post('chat/stream')
  async chatStream(
    @Body() dto: ChatCompletionDto,
    @Res() res: ExpressResponse,
  ) {
    const domoResponse = await this.aiServices.chatStream(dto);

    res.status(domoResponse.status);
    domoResponse.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });

    const readable = Readable.fromWeb(
      domoResponse.body as import('node:stream/web').ReadableStream,
    );
    readable.pipe(res);
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

  @Post('beastmode')
  @HttpCode(HttpStatus.OK)
  textToBeastMode(@Body() dto: TextToBeastModeDto) {
    return this.aiServices.textToBeastMode(dto);
  }
}
