import { Module } from '@nestjs/common';
import { AiServicesController } from './ai-services.controller.js';
import { AiServicesService } from './ai-services.service.js';

@Module({
  controllers: [AiServicesController],
  providers: [AiServicesService],
  exports: [AiServicesService],
})
export class AiServicesModule {}
