import { IsArray, IsOptional, IsString } from 'class-validator';

export class QueryContextDto {
  @IsString()
  userInput!: string;

  @IsOptional()
  userId?: any;

  @IsString()
  @IsOptional()
  sessionId?: string;

  @IsArray()
  @IsOptional()
  tools?: any[];

  @IsArray()
  @IsOptional()
  files?: any[];

  @IsArray()
  @IsOptional()
  dataSources?: any[];
}
