import { IsNumber, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class SearchAgentsDto {
  @IsObject()
  @IsOptional()
  filters?: Record<string, unknown>;

  @IsString()
  @IsOptional()
  sort?: string;

  @IsString()
  @IsOptional()
  order?: 'ASC' | 'DESC';

  @IsNumber()
  @Min(1)
  @IsOptional()
  limit?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  offset?: number;
}
