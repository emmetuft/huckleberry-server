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

export class SearchSessionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SearchFilterDto)
  @IsOptional()
  filters?: SearchFilterDto[];

  @IsOptional()
  sortFieldMap?: Record<string, 'ASC' | 'DESC'>;

  @IsOptional()
  searchFieldMap?: Record<string, string>;

  @IsNumber()
  @Min(1)
  @IsOptional()
  limit?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  offset?: number;
}
