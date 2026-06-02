import { IsString, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AgentContextDto } from './agent-context.dto.js';
import { AgentSettingsDto } from './agent-settings.dto.js';

export class CreateAgentDto {
  @IsString()
  name!: string;

  @IsString()
  description!: string;

  @IsString()
  prompt!: string;

  @IsString()
  @IsOptional()
  systemMessage?: string;

  @IsString()
  @IsOptional()
  model?: string;

  @ValidateNested()
  @Type(() => AgentSettingsDto)
  @IsOptional()
  settings?: AgentSettingsDto;

  @ValidateNested()
  @Type(() => AgentContextDto)
  @IsOptional()
  context?: AgentContextDto;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  toolkitIds?: string[];
}
