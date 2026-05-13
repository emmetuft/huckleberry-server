import { IsEmail, MaxLength } from 'class-validator';

export class RequestSigninDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;
}
