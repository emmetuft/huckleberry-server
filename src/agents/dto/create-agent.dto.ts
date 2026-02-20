import { IsString, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AgentContextDto } from './agent-context.dto.js';

export class CreateAgentDto {
  @IsString()
  name!: string;

  @IsString()
  prompt!: string;

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
