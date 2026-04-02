import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GraphService } from './graph.service.js';
import { FetchNodesDto } from './dto/fetch-nodes.dto.js';
import { DomoAuthGuard } from '../common/guards/domo-auth.guard.js';

@ApiTags('Graph')
@Controller('graph')
@UseGuards(DomoAuthGuard)
export class GraphController {
  constructor(private readonly graphService: GraphService) {}

  @Post('nodes')
  @HttpCode(HttpStatus.OK)
  fetchNodes(@Body() dto: FetchNodesDto) {
    return this.graphService.fetchNodes(dto);
  }
}
