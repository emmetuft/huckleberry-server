import {
  IsString,
  IsOptional,
  IsNumber,
  IsObject,
  ValidateNested,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ReasoningEffort } from '../../common/types/domo-ai-services.types.js';

class ParameterizedPromptTemplateDto {
  @IsString()
  template!: string;

  @IsObject()
  @IsOptional()
  parameters?: Record<string, string>;
}

class ReasoningConfigDto {
  @IsOptional()
  enabled?: boolean;

  @IsEnum(ReasoningEffort)
  @IsOptional()
  effort?: ReasoningEffort;
}

class JsonResponseFormatDto {
  @IsString()
  type!: string;

  @IsObject()
  @IsOptional()
  schema?: Record<string, unknown>;
}

export class TextGenerationDto {
  @IsString()
  input!: string;

  @IsString()
  @IsOptional()
  sessionId?: string;

  @IsString()
  @IsOptional()
  model?: string;

  @IsString()
  @IsOptional()
  system?: string;

  @ValidateNested()
  @Type(() => ParameterizedPromptTemplateDto)
  @IsOptional()
  promptTemplate?: ParameterizedPromptTemplateDto;

  @IsObject()
  @IsOptional()
  parameters?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  modelConfiguration?: Record<string, unknown>;

  @IsNumber()
  @IsOptional()
  temperature?: number;

  @IsNumber()
  @IsOptional()
  maxTokens?: number;

  @ValidateNested()
  @Type(() => ReasoningConfigDto)
  @IsOptional()
  reasoningConfig?: ReasoningConfigDto;

  @ValidateNested()
  @Type(() => JsonResponseFormatDto)
  @IsOptional()
  responseFormat?: JsonResponseFormatDto;
}
