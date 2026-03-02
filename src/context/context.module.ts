import { Module } from '@nestjs/common';
import { ContextController } from './context.controller.js';
import { ContextService } from './context.service.js';
import { OntologyModule } from '../ontology/ontology.module.js';
import { PersonasModule } from '../personas/personas.module.js';
import { AgentsModule } from '../agents/agents.module.js';

@Module({
  imports: [OntologyModule, PersonasModule, AgentsModule],
  controllers: [ContextController],
  providers: [ContextService],
  exports: [ContextService],
})
export class ContextModule {}
