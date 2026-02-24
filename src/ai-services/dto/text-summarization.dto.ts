import {
  IsString,
  IsOptional,
  IsNumber,
  IsObject,
  IsEnum,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OutputStyle } from '../../common/types/domo-ai-services.types.js';
import {
  ParameterizedPromptTemplateDto,
  ReasoningConfigDto,
  ChunkingConfigurationDto,
} from './common-ai.dto.js';

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
