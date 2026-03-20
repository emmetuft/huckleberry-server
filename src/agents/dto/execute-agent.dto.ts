import { IsEnum, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { AgentType } from '../../common/types/domo-common.types.js';
import { AgentContextDto } from './agent-context.dto.js';

export class ExecuteAgentDto {
  @IsString()
  @IsOptional()
  sessionId?: string;

  @IsString()
  input!: string;

  @IsEnum(AgentType)
  @IsOptional()
  agentType?: AgentType;

  @ValidateNested()
  @Type(() => AgentContextDto)
  @IsOptional()
  aiAssistantContext?: AgentContextDto;

  @IsString()
  @IsOptional()
  model?: string;
}
