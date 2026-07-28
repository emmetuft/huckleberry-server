import { PartialType } from '@nestjs/swagger';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

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

// UpdateMetricDto makes all create fields optional and adds the read-only
// fields Domo includes in GET responses so round-trip updates don't 400.
export class UpdateMetricDto extends PartialType(CreateMetricDto) {
  @IsOptional()
  @IsNumber()
  id?: number;

  @IsOptional()
  @IsNumber()
  owner?: number;

  @IsOptional()
  @IsString()
  ownerDisplayName?: string;

  @IsOptional()
  @IsString()
  dataSourceName?: string;

  @IsOptional()
  @IsIn(DATE_GRAINS)
  datasetDateGrain?: DateTimeElement;

  @IsOptional()
  @IsString()
  created?: string;

  @IsOptional()
  @IsString()
  modified?: string;
}
