import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import {
  RoleLevel,
  type PersonaSkill,
  type PersonaCommunicationStyle,
} from '../../common/types/persona.types.js';

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

  @IsArray()
  @IsOptional()
  skills?: PersonaSkill[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tools?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  relationships?: string[];

  @IsObject()
  @IsOptional()
  communicationStyle?: PersonaCommunicationStyle;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  domainKnowledge?: string[];

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
