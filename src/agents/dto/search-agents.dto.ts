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

  /** Frontend-friendly sort field name — transformed to sortFieldMap before forwarding to Domo. */
  @IsString()
  @IsOptional()
  sort?: string;

  /** Frontend-friendly sort direction — combined with sort into sortFieldMap. */
  @IsString()
  @IsOptional()
  order?: string;

  /** Frontend-friendly search map — forwarded as searchFieldMap to Domo. */
  @IsObject()
  @IsOptional()
  search?: Record<string, string>;

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
