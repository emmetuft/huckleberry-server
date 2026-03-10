import {
  Body,
  Controller,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response as ExpressResponse } from 'express';
import { ContextService } from './context.service.js';
import { QueryContextDto } from './dto/query-context.dto.js';
import { DomoAuthGuard } from '../common/guards/domo-auth.guard.js';
import { ContentType, HttpHeader } from '../common/constants/http.constants.js';

@ApiTags('Context')
@Controller('context')
@UseGuards(DomoAuthGuard)
export class ContextController {
  constructor(private readonly contextService: ContextService) {}

  @Post('query-stream')
  async queryStream(
    @Body() dto: QueryContextDto,
    @Res() res: ExpressResponse,
  ) {
    const stream = await this.contextService.queryStream(dto);

    res.setHeader(HttpHeader.ContentType, ContentType.SSE);
    res.setHeader(HttpHeader.CacheControl, 'no-cache');
    res.setHeader(HttpHeader.Connection, 'keep-alive');
    res.status(HttpStatus.OK);

    stream.pipe(res);
  }
}
