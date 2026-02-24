import {
  IsString,
  IsOptional,
  IsObject,
  IsBoolean,
  IsEnum,
} from 'class-validator';
import { ReasoningEffort } from '../../common/types/domo-ai-services.types.js';

export class ParameterizedPromptTemplateDto {
  @IsString()
  template!: string;

  @IsObject()
  @IsOptional()
  parameters?: Record<string, string>;
}

export class ReasoningConfigDto {
  @IsBoolean()
  @IsOptional()
  enabled?: boolean;

  @IsEnum(ReasoningEffort)
  @IsOptional()
  effort?: ReasoningEffort;
}

export class JsonResponseFormatDto {
  @IsString()
  type!: string;

  @IsObject()
  @IsOptional()
  schema?: Record<string, unknown>;
}
