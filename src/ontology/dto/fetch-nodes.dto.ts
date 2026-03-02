import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class FetchNodesDto {
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  labels?: string[];

  @IsArray()
  @IsOptional()
  filters?: Array<Record<string, unknown>>;

  @IsNumber()
  @IsOptional()
  limit?: number;

  @IsBoolean()
  @IsOptional()
  includeRelationships?: boolean;
}
