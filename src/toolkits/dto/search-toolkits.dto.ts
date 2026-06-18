import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export enum ToolkitSearchFilterType {
  CREATED_BY = 'CREATED_BY',
  TYPE = 'TYPE',
}

export class ToolkitSearchFilterDto {
  @IsEnum(ToolkitSearchFilterType)
  type!: ToolkitSearchFilterType;

  @IsArray()
  values!: unknown[];

  @IsString()
  @IsOptional()
  operator?: string;

  @IsBoolean()
  @IsOptional()
  not?: boolean;
}

export class SearchToolkitsDto {
  @IsNumber()
  @IsOptional()
  limit?: number;

  @IsNumber()
  @IsOptional()
  offset?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ToolkitSearchFilterDto)
  @IsOptional()
  filters?: ToolkitSearchFilterDto[];

  @IsObject()
  @IsOptional()
  sortFieldMap?: Record<string, 'ASC' | 'DESC'>;

  @IsObject()
  @IsOptional()
  searchFieldMap?: Record<string, string>;
}
