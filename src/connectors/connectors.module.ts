import { Module } from '@nestjs/common';
import { ConnectorsController } from './connectors.controller.js';
import { ConnectorsService } from './connectors.service.js';

@Module({
  controllers: [ConnectorsController],
  providers: [ConnectorsService],
  exports: [ConnectorsService],
})
export class ConnectorsModule {}
