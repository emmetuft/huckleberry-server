import { IsEmail, IsIn, IsOptional, IsUrl, MaxLength } from 'class-validator';

export class SignupDto {
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsIn(['new', 'existing'])
  path!: 'new' | 'existing';

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(255)
  instanceUrl?: string;
}
