import { IsArray, IsOptional, IsString } from 'class-validator';

// operators
export enum SingleValueOperator {
  EQUALS = 'EQUALS',
  NOT_EQUALS = 'NOT_EQUALS',
  GREATER_THAN = 'GREATER_THAN',
  GREATER_THAN_OR_EQUAL = 'GREATER_THAN_OR_EQUAL',
  LESS_THAN = 'LESS_THAN',
  LESS_THAN_OR_EQUAL = 'LESS_THAN_OR_EQUAL',
  STARTS_WITH = 'STARTS_WITH',
  CONTAINS = 'CONTAINS',
  ENDS_WITH = 'ENDS_WITH',
}

export enum RangeOperator {
  BETWEEN = 'BETWEEN',
}

export enum FlagOperator {
  IS_NULL = 'IS_NULL',
  IS_NOT_NULL = 'IS_NOT_NULL',
}

export enum LabelMode {
  ANY = 'ANY',
  ALL = 'ALL',
}

export enum FilterType {
  SINGLE_VALUE = 'SINGLE_VALUE',
  RANGE = 'RANGE',
  FLAG = 'FLAG',
}

// property filters
export class SingleValueFilterDto {
  type: FilterType.SINGLE_VALUE;
  field: string;
  operator: SingleValueOperator;
  value: unknown;
}

export class RangeFilterDto {
  type: FilterType.RANGE;
  field: string;
  operator: RangeOperator;
  min: number | string;
  max: number | string;
  includeMin: boolean;
  includeMax: boolean;
}

export class FlagFilterDto {
  type: FilterType.FLAG;
  field: string;
  operator: FlagOperator;
}

export type NodePropertyFilterDto =
  | SingleValueFilterDto
  | RangeFilterDto
  | FlagFilterDto;

export class NodeFilterDto {
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  nodeLabels?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  nodeIds?: string[];

  @IsString()
  @IsOptional()
  labelMode?: 'ANY' | 'ALL';

  @IsString()
  @IsOptional()
  idProperty?: string;

  @IsArray()
  @IsOptional()
  propertyFilters?: NodePropertyFilterDto[];
}
