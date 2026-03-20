import { Module } from '@nestjs/common';
import { HuckleberryController } from './huckleberry.controller.js';
import { HuckleberryService } from './huckleberry.service.js';
import { AgentsModule } from '../agents/agents.module.js';

@Module({
  imports: [AgentsModule],
  controllers: [HuckleberryController],
  providers: [HuckleberryService],
  exports: [HuckleberryService],
})
export class HuckleberryModule {}
