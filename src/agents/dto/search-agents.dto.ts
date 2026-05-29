import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class SearchFilterDto {
  @IsString()
  type!: string;

  @IsBoolean()
  not!: boolean;

  @IsArray()
  @IsString({ each: true })
  values!: string[];

  @IsString()
  operator!: string;
}

export class SearchAgentsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SearchFilterDto)
  @IsOptional()
  filters?: SearchFilterDto[];

  @IsObject()
  @IsOptional()
  search?: Record<string, string>;

  @IsString()
  @IsOptional()
  sort?: string;

  @IsIn(['ASC', 'DESC'])
  @IsOptional()
  order?: 'ASC' | 'DESC';

  @IsNumber()
  @Min(1)
  @IsOptional()
  limit?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  offset?: number;
}
