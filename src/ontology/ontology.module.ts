import { Module } from '@nestjs/common';
import { OntologyController } from './ontology.controller.js';
import { Neo4jService } from './neo4j.service.js';

@Module({
  controllers: [OntologyController],
  providers: [Neo4jService],
  exports: [Neo4jService],
})
export class OntologyModule {}
