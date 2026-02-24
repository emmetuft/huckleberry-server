import {
  IsString,
  IsOptional,
  IsObject,
  IsBoolean,
  IsNumber,
  IsEnum,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  ReasoningEffort,
  SeparatorType,
} from '../../common/types/domo-ai-services.types.js';

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

export class AISchemaColumnDto {
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

export class AIDataSourceSchemaDto {
  @IsString()
  dataSourceId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AISchemaColumnDto)
  @IsOptional()
  columns?: AISchemaColumnDto[];
}

export class SizeBoundaryDto {
  @IsNumber()
  @IsOptional()
  min?: number;

  @IsNumber()
  @IsOptional()
  max?: number;
}

export class ChunkingConfigurationDto {
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
