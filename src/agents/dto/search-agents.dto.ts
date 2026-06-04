import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class SearchFilterDto {
  @IsString()
  type!: string;

  @IsArray()
  @IsString({ each: true })
  values!: string[];

  @IsString()
  @IsOptional()
  operator?: string;

  @IsBoolean()
  @IsOptional()
  not?: boolean;
}

export class SearchAgentsDto {
  @IsNumber()
  @IsOptional()
  limit?: number;

  @IsNumber()
  @IsOptional()
  offset?: number;

  @IsObject()
  @IsOptional()
  sortFieldMap?: Record<string, 'ASC' | 'DESC'>;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SearchFilterDto)
  @IsOptional()
  filters?: SearchFilterDto[];

  @IsObject()
  @IsOptional()
  searchFieldMap?: Record<string, string>;

  @IsObject()
  @IsOptional()
  dateFilters?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  groupByMap?: Record<string, unknown>;
}
