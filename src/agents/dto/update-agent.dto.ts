import { IsString, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AgentContextDto } from './agent-context.dto.js';

export class UpdateAgentDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  prompt?: string;

  @IsString()
  @IsOptional()
  systemMessage?: string;

  @ValidateNested()
  @Type(() => AgentContextDto)
  @IsOptional()
  context?: AgentContextDto;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  toolkitIds?: string[];
}
