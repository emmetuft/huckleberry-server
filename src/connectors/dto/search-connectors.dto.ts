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
  filterType: string;

  @IsString()
  field: string;

  @IsOptional()
  @IsString()
  queryString?: string;

  @IsOptional()
  value?: any;

  @IsOptional()
  @IsBoolean()
  not?: boolean;
}

export class SearchConnectorsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SearchFilterDto)
  @IsOptional()
  filters?: SearchFilterDto[];

  @IsNumber()
  @Min(0)
  @IsOptional()
  count?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  offset?: number;
}
