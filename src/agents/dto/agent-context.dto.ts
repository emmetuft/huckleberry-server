import {
  IsArray,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class FileSetDto {
  @IsString()
  id!: string;

  @IsString()
  @IsOptional()
  name?: string;
}

export class DateRangeFilterDto {
  @IsString()
  @IsOptional()
  startDate?: string;

  @IsString()
  @IsOptional()
  endDate?: string;

  @IsString()
  @IsOptional()
  column?: string;
}

export class AgentContextDto {
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  dataSourceIds?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  cardIds?: string[];

  @IsArray()
  @IsNumber({}, { each: true })
  @IsOptional()
  pageIds?: number[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  ignorableDataSourceIds?: string[];

  @IsArray()
  @IsOptional()
  filters?: object[];

  @ValidateNested()
  @Type(() => DateRangeFilterDto)
  @IsOptional()
  dateRangeFilter?: DateRangeFilterDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FileSetDto)
  @IsOptional()
  fileSets?: FileSetDto[];

  @IsObject()
  @IsOptional()
  descriptions?: Record<string, string>;
}
