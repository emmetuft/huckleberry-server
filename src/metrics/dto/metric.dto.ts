import { IsArray, IsIn, IsObject, IsOptional, IsString } from 'class-validator';

export type AggregationFunction =
  | 'SUM'
  | 'AVG'
  | 'COUNT'
  | 'MIN'
  | 'MAX'
  | 'SUM_DISTINCT'
  | 'AVG_DISTINCT'
  | 'COUNT_DISTINCT'
  | 'MIN_DISTINCT'
  | 'MAX_DISTINCT'
  | 'DOMO_BEAST_MODE';

export type DateTimeElement = 'DAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';
export type CalendarType = 'STANDARD' | 'FISCAL';
export type CumulativeType = 'RUNNING_TOTAL' | 'NON_CUMULATIVE';

const DATE_GRAINS: DateTimeElement[] = [
  'DAY',
  'WEEK',
  'MONTH',
  'QUARTER',
  'YEAR',
];
const CALENDAR_TYPES: CalendarType[] = ['STANDARD', 'FISCAL'];
const CUMULATIVE_TYPES: CumulativeType[] = ['RUNNING_TOTAL', 'NON_CUMULATIVE'];

export class CreateMetricDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  datasourceId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  dateColumn?: string;

  @IsOptional()
  @IsIn(DATE_GRAINS)
  preferredDateGrain?: DateTimeElement;

  @IsOptional()
  @IsIn(CALENDAR_TYPES)
  calendarType?: CalendarType;

  @IsOptional()
  @IsIn(CUMULATIVE_TYPES)
  cumulativeType?: CumulativeType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dimensions?: string[];

  @IsOptional()
  @IsObject()
  aggregation?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  filters?: unknown[];

  @IsOptional()
  @IsArray()
  aggregatedFilters?: unknown[];

  @IsOptional()
  @IsArray()
  legacyFilters?: unknown[];

  @IsOptional()
  @IsObject()
  dateRangeFilter?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  properties?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  format?: Record<string, unknown>;
}

export class UpdateMetricDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  datasourceId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsString()
  dateColumn?: string;

  @IsOptional()
  @IsIn(DATE_GRAINS)
  preferredDateGrain?: DateTimeElement;

  @IsOptional()
  @IsIn(CALENDAR_TYPES)
  calendarType?: CalendarType;

  @IsOptional()
  @IsIn(CUMULATIVE_TYPES)
  cumulativeType?: CumulativeType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dimensions?: string[];

  @IsOptional()
  @IsObject()
  aggregation?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  filters?: unknown[];

  @IsOptional()
  @IsArray()
  aggregatedFilters?: unknown[];

  @IsOptional()
  @IsArray()
  legacyFilters?: unknown[];

  @IsOptional()
  @IsObject()
  dateRangeFilter?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  properties?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  format?: Record<string, unknown>;
}
