import { Module } from '@nestjs/common';
import { ContextController } from './context.controller.js';
import { ContextService } from './context.service.js';
import { AgentsModule } from '../agents/agents.module.js';

@Module({
  imports: [AgentsModule],
  controllers: [ContextController],
  providers: [ContextService],
  exports: [ContextService],
})
export class ContextModule {}
