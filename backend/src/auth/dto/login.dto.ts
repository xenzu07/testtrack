import { Transform } from 'class-transformer';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email: string;

  // Do not trim passwords: leading/trailing spaces may be intentional.
  @IsString()
  @MinLength(6)
  password: string;
}
