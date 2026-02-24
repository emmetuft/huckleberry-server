import {
  IsString,
  IsOptional,
  IsNumber,
  IsObject,
  IsEnum,
  IsBoolean,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  OutputStyle,
  ReasoningEffort,
  SeparatorType,
} from '../../common/types/domo-ai-services.types.js';

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

class SizeBoundaryDto {
  @IsNumber()
  @IsOptional()
  min?: number;

  @IsNumber()
  @IsOptional()
  max?: number;
}

class ChunkingConfigurationDto {
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @ValidateNested()
  @Type(() => SizeBoundaryDto)
  @IsOptional()
  sizeBoundary?: SizeBoundaryDto;

  @IsEnum(SeparatorType)
  @IsOptional()
  separatorType?: SeparatorType;
}

export class TextSummarizationDto {
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

  @IsEnum(OutputStyle)
  @IsOptional()
  outputStyle?: OutputStyle;

  @ValidateNested()
  @Type(() => ChunkingConfigurationDto)
  @IsOptional()
  chunkingConfiguration?: ChunkingConfigurationDto;
}
