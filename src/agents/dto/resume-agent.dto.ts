import { IsOptional, IsString, ValidateNested } from 'class-validator';
import { AgentContextDto } from './agent-context.dto.js';
import { Type } from 'class-transformer';
import { ElicitationResponseDto } from './elicitation-response.dto.js';

export class ResumeAgentDto {
  @IsString()
  @IsOptional()
  sessionId?: string;

  @IsString()
  @IsOptional()
  batchId?: string;

  @IsString()
  @IsOptional()
  sourceRequestId?: string;

  @IsString()
  @IsOptional()
  input?: string;

  @ValidateNested()
  @Type(() => AgentContextDto)
  @IsOptional()
  aiAssistantContext?: AgentContextDto;

  @ValidateNested()
  @Type(() => ElicitationResponseDto)
  @IsOptional()
  response?: ElicitationResponseDto;
}
