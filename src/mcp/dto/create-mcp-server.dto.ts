import {
  IsObject,
  IsOptional,
  IsString,
  registerDecorator,
  type ValidationArguments,
  type ValidationOptions,
} from 'class-validator';
import type {
  McpAuthType,
  OAuth2Config,
} from '../../common/types/mcp.types.js';

function IsMcpUrl(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isMcpUrl',
      target: object.constructor,
      propertyName,
      options: {
        message: ({ value }: ValidationArguments) =>
          process.env.NODE_ENV === 'production'
            ? `${String(value)} must be a valid HTTPS URL`
            : `${String(value)} must be a valid HTTP or HTTPS URL`,
        ...options,
      },
      validator: {
        validate(value: unknown): boolean {
          if (typeof value !== 'string') return false;
          try {
            const parsed = new URL(value);
            const isProd = process.env.NODE_ENV === 'production';
            if (isProd) {
              if (parsed.protocol !== 'https:') return false;
              if (!parsed.hostname.includes('.')) return false;
            } else {
              if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
                return false;
            }
            return true;
          } catch {
            return false;
          }
        },
      },
    });
  };
}

export class CreateMcpServerDto {
  @IsString()
  name!: string;

  @IsMcpUrl()
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
