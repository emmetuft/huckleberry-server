import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { RoleLevel } from '../../common/types/persona.types.js';

export class UpdatePersonaDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  role?: string;

  @IsEnum(RoleLevel)
  @IsOptional()
  level?: RoleLevel;

  @IsString()
  @IsOptional()
  department?: string;

  @IsString()
  @IsOptional()
  team?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  focusAreas?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  strengths?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  weaknesses?: string[];

  @IsString()
  @IsOptional()
  goals?: string;

  @IsBoolean()
  @IsOptional()
  usePersona?: boolean;

  @IsBoolean()
  @IsOptional()
  useActivity?: boolean;

  @IsBoolean()
  @IsOptional()
  useData?: boolean;
}
