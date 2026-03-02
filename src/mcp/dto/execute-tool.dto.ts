import { IsObject, IsOptional, IsString } from 'class-validator';

export class ExecuteToolDto {
  @IsString()
  serverId!: string;

  @IsString()
  toolName!: string;

  @IsObject()
  @IsOptional()
  params?: Record<string, unknown>;
}
