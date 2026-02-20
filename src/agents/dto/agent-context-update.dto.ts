import { ValidateNested, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { AgentContextDto } from './agent-context.dto.js';

export class AgentContextUpdateDto {
  @ValidateNested()
  @Type(() => AgentContextDto)
  @IsOptional()
  add?: AgentContextDto;

  @ValidateNested()
  @Type(() => AgentContextDto)
  @IsOptional()
  remove?: AgentContextDto;
}
