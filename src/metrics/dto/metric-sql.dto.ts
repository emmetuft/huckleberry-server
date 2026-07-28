import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class MetricSqlRequestDto {
  @IsOptional()
  dimensions?: string[];

  @IsOptional()
  aggregation?: unknown;

  @IsOptional()
  @IsString()
  dateGrain?: string;

  @IsOptional()
  @IsString()
  orderBy?: string;

  @IsOptional()
  @IsString()
  calendarType?: string;

  @IsOptional()
  dateRangeFilter?: unknown;

  @IsOptional()
  filters?: unknown[];
}

export class MetricSqlPeriodRequestDto extends MetricSqlRequestDto {
  @IsOptional()
  periodDateRangeFilters?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  annotationDate?: boolean;
}

export interface MetricSql {
  metric: unknown;
  sql: string;
  select?: unknown;
}
