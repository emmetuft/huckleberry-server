import { IsNumber, IsObject, IsOptional, IsString, Min } from 'class-validator';

export class CypherSearchDto {
  @IsString()
  cypherQuery!: string;

  @IsObject()
  @IsOptional()
  parameters?: Record<string, unknown>;

  @IsNumber()
  @Min(1)
  @IsOptional()
  limit?: number;
}
