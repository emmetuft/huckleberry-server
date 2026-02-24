import {
  IsString,
  IsOptional,
  IsNumber,
  IsObject,
  IsArray,
  IsEnum,
  ValidateNested,
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

class AISchemaColumnDto {
  @IsString()
  name!: string;

  @IsString()
  type!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  sampleValues?: string[];
}

class AIDataSourceSchemaDto {
  @IsString()
  dataSourceId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AISchemaColumnDto)
  @IsOptional()
  columns?: AISchemaColumnDto[];
}

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
