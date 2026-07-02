import { IsEnum, IsString } from 'class-validator';

export class PersonaSkillDto {
  @IsString()
  name!: string;

  @IsEnum(['hard', 'soft'])
  type!: 'hard' | 'soft';
}
