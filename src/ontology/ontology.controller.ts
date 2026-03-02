import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Neo4jService } from './neo4j.service.js';
import { FetchNodesDto } from './dto/fetch-nodes.dto.js';
import { DomoAuthGuard } from '../common/guards/domo-auth.guard.js';

@ApiTags('Ontology')
@Controller('ontology')
@UseGuards(DomoAuthGuard)
export class OntologyController {
  constructor(private readonly neo4j: Neo4jService) {}

  @Get('labels')
  async getLabels() {
    return this.neo4j.fetchLabels();
  }

  @Post('nodes')
  @HttpCode(HttpStatus.OK)
  async fetchNodes(@Body() dto: FetchNodesDto) {
    return this.neo4j.fetchNodes(dto);
  }

  @Get('subgraph/:nodeId')
  async getSubgraph(
    @Param('nodeId') nodeId: string,
    @Query('depth') depth?: number,
    @Query('limit') limit?: number,
  ) {
    return this.neo4j.fetchSubgraph(nodeId, depth ?? 2, limit ?? 500);
  }

  @Get('search')
  async search(
    @Query('query') query: string,
    @Query('limit') limit?: number,
  ) {
    return this.neo4j.searchNodes(query, limit ?? 100);
  }

  @Get('property-values/:label/:property')
  async getPropertyValues(
    @Param('label') label: string,
    @Param('property') property: string,
    @Query('limit') limit?: number,
  ) {
    return this.neo4j.fetchPropertyValues(label, property, limit ?? 100);
  }
}
