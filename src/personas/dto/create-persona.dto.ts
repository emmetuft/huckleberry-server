import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { RoleLevel } from '../../common/types/persona.types.js';

export class CreatePersonaDto {
  @IsString()
  name!: string;

  @IsString()
  role!: string;

  @IsEnum(RoleLevel)
  level!: RoleLevel;

  @IsString()
  department!: string;

  @IsString()
  @IsOptional()
  team?: string;

  @IsArray()
  @IsString({ each: true })
  focusAreas!: string[];

  @IsArray()
  @IsString({ each: true })
  strengths!: string[];

  @IsArray()
  @IsString({ each: true })
  weaknesses!: string[];

  @IsString()
  goals!: string;

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
