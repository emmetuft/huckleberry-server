import { IsNumber, IsOptional, Min } from 'class-validator';
import { NodeFilterDto } from './node-filter.dto';

export class FetchNodesDto {
  filter: NodeFilterDto;

  @IsNumber()
  @Min(1)
  @IsOptional()
  limit?: number;
}
