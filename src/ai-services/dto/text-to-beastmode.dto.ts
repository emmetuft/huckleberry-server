import {
  IsString,
  IsOptional,
  IsNumber,
  IsObject,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  ParameterizedPromptTemplateDto,
  ReasoningConfigDto,
  AIDataSourceSchemaDto,
} from './common-ai.dto.js';

export class TextToBeastModeDto {
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

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AIDataSourceSchemaDto)
  @IsOptional()
  dataSourceSchemas?: AIDataSourceSchemaDto[];
}
