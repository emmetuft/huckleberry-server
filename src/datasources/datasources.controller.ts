import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DataSourcesService } from './datasources.service.js';
import { DomoAuthGuard } from '../common/guards/domo-auth.guard.js';

/**
 * Proxies Domo DataSources API.
 * Frontend calls /domo/datasources/v1/* — this controller is mounted
 * outside the /api global prefix to match that path.
 */
@ApiTags('DataSources')
@Controller('domo/datasources/v1')
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
}
