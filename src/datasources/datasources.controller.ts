import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DataSourcesService } from './datasources.service.js';
import { DomoAuthGuard } from '../common/guards/domo-auth.guard.js';

/**
 * Proxies Domo DataSources API.
 * Frontend calls /domo/datasources/v1/* — this controller is mounted
 * outside the /api global prefix to match that path.
 */
@ApiTags('DataSources')
@Controller('datasources')
@UseGuards(DomoAuthGuard)
export class DataSourcesController {
  constructor(private readonly dataSourcesService: DataSourcesService) {}

  @Get()
  list(
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
    @Query('nameLike') nameLike?: string,
  ) {
    return this.dataSourcesService.list(
      parseInt(offset || '0', 10),
      parseInt(limit || '50', 10),
      nameLike,
    );
  }

  @Get(':id/schema')
  getSchema(@Param('id') id: string) {
    return this.dataSourcesService.getSchema(id);
  }

  @Post(':id/data')
  @HttpCode(HttpStatus.OK)
  queryData(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('size') size?: string,
    @Body() body?: any,
  ) {
    return this.dataSourcesService.queryData(
      id,
      body,
      parseInt(page || '0', 10),
      parseInt(size || '100', 10),
    );
  }
}
