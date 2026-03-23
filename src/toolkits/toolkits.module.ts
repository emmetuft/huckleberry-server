import { Module } from '@nestjs/common';
import { ToolkitsController } from './toolkits.controller.js';
import { ToolkitsService } from './toolkits.service.js';

@Module({
  controllers: [ToolkitsController],
  providers: [ToolkitsService],
  exports: [ToolkitsService],
})
export class ToolkitsModule {}
