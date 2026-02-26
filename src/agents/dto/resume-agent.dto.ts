import { IsDefined, IsEnum, IsOptional, IsString } from 'class-validator';
import { AgentType } from '../../common/types/domo-common.types.js';

export class ResumeAgentDto {
  @IsString()
  @IsOptional()
  sessionId?: string;

  @IsString()
  @IsOptional()
  sourceRequestId?: string;

  @IsDefined()
  @IsOptional()
  response?: unknown;

  @IsEnum(AgentType)
  @IsOptional()
  agentStrategy?: AgentType;
}
