import { Module } from '@nestjs/common';
import { DataSourcesController } from './datasources.controller.js';
import { DataSourcesService } from './datasources.service.js';

@Module({
  controllers: [DataSourcesController],
  providers: [DataSourcesService],
  exports: [DataSourcesService],
})
export class DataSourcesModule {}
