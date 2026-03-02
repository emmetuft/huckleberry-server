import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import type { McpAuthType, OAuth2Config } from '../../common/types/mcp.types.js';

export class CreateMcpServerDto {
  @IsString()
  name!: string;

  @IsString()
  url!: string;

  @IsString()
  @IsOptional()
  authType?: McpAuthType;

  @IsString()
  @IsOptional()
  bearerToken?: string;

  @IsObject()
  @IsOptional()
  oauth2Config?: OAuth2Config;
}
