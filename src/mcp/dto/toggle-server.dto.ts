import { IsBoolean } from 'class-validator';

export class ToggleServerDto {
  @IsBoolean()
  enabled!: boolean;
}
