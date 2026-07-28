import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

export class MetricSearchFiltersDto {
  @IsOptional()
  @IsString()
  nameContains?: string;

  @IsOptional()
  filters?: unknown[];

  @IsOptional()
  @IsString()
  orderBy?: string;

  @IsOptional()
  @IsBoolean()
  followed?: boolean;

  @IsOptional()
  @IsNumber()
  limit?: number;

  @IsOptional()
  @IsNumber()
  offset?: number;
}
