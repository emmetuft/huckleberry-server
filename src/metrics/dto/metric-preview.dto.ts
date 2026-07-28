import { Allow, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { MetricSqlRequestDto } from './metric-sql.dto.js';

export class MetricPreviewRequestDto {
  @Allow()
  metric: unknown;

  @IsOptional()
  @ValidateNested()
  @Type(() => MetricSqlRequestDto)
  sqlRequest?: MetricSqlRequestDto;
}
