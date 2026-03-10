import { Module } from '@nestjs/common';
import { AiServicesController } from './ai-services.controller.js';
import { AiCompatController } from './ai-compat.controller.js';
import { AiServicesService } from './ai-services.service.js';

@Module({
  controllers: [AiServicesController, AiCompatController],
  providers: [AiServicesService],
  exports: [AiServicesService],
})
export class AiServicesModule {}
