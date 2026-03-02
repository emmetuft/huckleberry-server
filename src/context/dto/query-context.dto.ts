import { IsNumber, IsOptional, IsString } from 'class-validator';

export class QueryContextDto {
  @IsString()
  input!: string;

  @IsString()
  @IsOptional()
  sessionId?: string;

  @IsString()
  @IsOptional()
  personaId?: string;

  @IsNumber()
  @IsOptional()
  ontologyDepth?: number;
}
