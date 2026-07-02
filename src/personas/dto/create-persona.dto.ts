import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RoleLevel } from '../../common/types/persona.types.js';
import { PersonaSkillDto } from './persona-skill.dto.js';
import { CommunicationStyleDto } from './communication-style.dto.js';

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
  @ValidateNested({ each: true })
  @Type(() => PersonaSkillDto)
  @IsOptional()
  skills?: PersonaSkillDto[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tools?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  relationships?: string[];

  @ValidateNested()
  @Type(() => CommunicationStyleDto)
  @IsOptional()
  communicationStyle?: CommunicationStyleDto;

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
