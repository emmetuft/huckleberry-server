import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GraphService } from './graph.service.js';
import { FetchNodesDto } from './dto/fetch-nodes.dto.js';
import { CypherSearchDto } from './dto/cypher-search.dto.js';
import { ShortestPathDto } from './dto/shortest-path.dto.js';
import { SessionAuthGuard } from '../common/auth/session-auth.guard.js';

@ApiTags('Graph')
@Controller('graph')
@UseGuards(SessionAuthGuard)
export class GraphController {
  constructor(private readonly graphService: GraphService) {}

  @Post('nodes')
  @HttpCode(HttpStatus.OK)
  fetchNodes(@Body() dto: FetchNodesDto) {
    return this.graphService.fetchNodes(dto);
  }

  @Post('cypher')
  @HttpCode(HttpStatus.OK)
  cypherSearch(@Body() dto: CypherSearchDto) {
    return this.graphService.cypherSearch(dto);
  }

  @Get('schema')
  @HttpCode(HttpStatus.OK)
  getSchema(
    @Query('sampleSize') sampleSize?: string,
    @Query('includeProperties') includeProperties?: string,
  ) {
    return this.graphService.getSchema({
      sampleSize: sampleSize ? Number(sampleSize) : undefined,
      includeProperties: includeProperties === 'true',
    });
  }

  @Post('path')
  @HttpCode(HttpStatus.OK)
  shortestPath(@Body() dto: ShortestPathDto) {
    return this.graphService.shortestPath(dto);
  }
}
