import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MetricsService } from './metrics.service.js';
import { SessionAuthGuard } from '../common/auth/session-auth.guard.js';
import { MetricSearchFiltersDto } from './dto/metric-search.dto.js';
import {
  MetricSqlRequestDto,
  MetricSqlPeriodRequestDto,
} from './dto/metric-sql.dto.js';
import { MetricPreviewRequestDto } from './dto/metric-preview.dto.js';

@ApiTags('Metrics')
@Controller('metrics')
@UseGuards(SessionAuthGuard)
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  list() {
    return this.metricsService.list();
  }

  @Post()
  create(@Body() body: unknown) {
    return this.metricsService.create(body);
  }

  @Post('filter')
  @HttpCode(HttpStatus.OK)
  filter(@Body() body: MetricSearchFiltersDto) {
    return this.metricsService.filter(body);
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  preview(@Body() body: MetricPreviewRequestDto) {
    return this.metricsService.preview(body);
  }

  @Get('datasource/:dsId')
  byDatasource(@Param('dsId') dsId: string) {
    return this.metricsService.byDatasource(dsId);
  }

  @Get(':id')
  getById(@Param('id', ParseIntPipe) id: number) {
    return this.metricsService.getById(id);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return this.metricsService.update(id, body);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Query('hardDelete') hardDelete?: string,
  ) {
    const hd = hardDelete !== undefined ? hardDelete === 'true' : undefined;
    return this.metricsService.remove(id, hd);
  }

  @Post(':id/sql')
  @HttpCode(HttpStatus.OK)
  getSql(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: MetricSqlRequestDto,
  ) {
    return this.metricsService.getSql(id, body);
  }

  @Post(':id/execute')
  @HttpCode(HttpStatus.OK)
  execute(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: MetricSqlRequestDto,
  ) {
    return this.metricsService.execute(id, body);
  }

  @Post(':id/execute/pop')
  @HttpCode(HttpStatus.OK)
  executePop(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: MetricSqlPeriodRequestDto,
  ) {
    return this.metricsService.executePop(id, body);
  }
}
