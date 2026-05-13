import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response as ExpressResponse } from 'express';
import { Readable } from 'node:stream';
import { ConnectorsService } from './connectors.service.js';
import { DomoAuthGuard } from '../common/guards/domo-auth.guard.js';
import { SearchConnectorsDto } from './dto/search-connectors.dto.js';
import { DomoApiError } from '../common/filters/domo-exception.filter.js';

@ApiTags('Connectors')
@Controller('connectors')
@UseGuards(DomoAuthGuard)
export class ConnectorsController {
  constructor(private readonly connectorsService: ConnectorsService) {}

  @Get(':databaseId/image')
  async getConnectorImage(
    @Param('databaseId') databaseId: string,
    @Res() res: ExpressResponse,
  ) {
    const domoResponse =
      await this.connectorsService.getConnectorImage(databaseId);
    if (!domoResponse.ok) {
      throw new DomoApiError(domoResponse.status, domoResponse.statusText);
    }
    res.setHeader('Content-Type', 'image/png');
    const readable = Readable.fromWeb(
      domoResponse.body as import('node:stream/web').ReadableStream,
    );
    readable.pipe(res);
  }

  @Post()
  async fetchConnectors(@Body() dto: SearchConnectorsDto) {
    const domoResponse = await this.connectorsService.fetchConnectors(dto);
    const result = domoResponse as { searchObjects?: unknown[] };
    return result.searchObjects ?? [];
  }
}
