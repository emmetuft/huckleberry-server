import {
  IsString,
  IsOptional,
  IsNumber,
  IsObject,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ParameterizedPromptTemplateDto } from './common-ai.dto.js';

class ImageDto {
  @IsString()
  data!: string; // Base64-encoded image data

  @IsString()
  mediaType!: string; // e.g., "image/png"

  @IsString()
  type!: string; // e.g., "base64"
}

export class ImageToTextDto {
  @ValidateNested()
  @Type(() => ImageDto)
  image!: ImageDto;

  @IsString()
  input!: string;

  @IsString()
  @IsOptional()
  model?: string;

  @IsString()
  @IsOptional()
  system?: string;

  @ValidateNested()
  @Type(() => ParameterizedPromptTemplateDto)
  @IsOptional()
  promptTemplate?: ParameterizedPromptTemplateDto;

  @IsObject()
  @IsOptional()
  parameters?: Record<string, unknown>;

  @IsObject()
  @IsOptional()
  modelConfiguration?: Record<string, unknown>;

  @IsNumber()
  @IsOptional()
  temperature?: number;

  @IsNumber()
  @IsOptional()
  maxTokens?: number;
}
