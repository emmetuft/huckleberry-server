import { IsDefined, IsEnum, IsOptional, IsString } from 'class-validator';
import { AgentType } from '../../common/types/domo-common.types.js';

export class ResumeAgentDto {
  @IsString()
  sessionId!: string;

  @IsString()
  sourceRequestId!: string;

  @IsDefined()
  response!: unknown;

  @IsEnum(AgentType)
  @IsOptional()
  agentStrategy?: AgentType;
}
