import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class SearchFilterDto {
  @IsString()
  type: string;

  @IsBoolean()
  not: boolean;

  @IsArray()
  @IsString({ each: true })
  values: string[];

  @IsString()
  operator: string;
}

export class SearchSessionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SearchFilterDto)
  @IsOptional()
  filters?: SearchFilterDto[];

  @IsOptional()
  sortFieldMap?: unknown;

  @IsOptional()
  searchFieldMap?: unknown;

  @IsNumber()
  @Min(1)
  @IsOptional()
  limit?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  offset?: number;
}
