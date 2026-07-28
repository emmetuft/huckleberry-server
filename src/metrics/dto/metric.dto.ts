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

export interface Aggregation {
  function: AggregationFunction;
  value: string;
  alias?: string;
}

export interface MetricFormat {
  sentiment?: unknown;
  type?: string;
  columnFormat?: unknown;
}

export interface Metric {
  id?: number;
  name: string;
  description?: string;
  owner?: number;
  ownerDisplayName?: string;
  tags?: string[];
  datasourceId?: string;
  dataSourceName?: string;
  dateColumn?: string;
  preferredDateGrain?: DateTimeElement;
  datasetDateGrain?: DateTimeElement;
  calendarType?: CalendarType;
  dimensions?: string[];
  aggregation?: Aggregation;
  filters?: unknown[];
  aggregatedFilters?: unknown[];
  legacyFilters?: unknown[];
  dateRangeFilter?: unknown;
  properties?: Record<string, unknown>;
  format?: MetricFormat;
  cumulativeType?: CumulativeType;
  created?: string;
  modified?: string;
}
