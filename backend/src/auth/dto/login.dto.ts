import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email: string;

  // Do not trim passwords: leading/trailing spaces may be intentional.
  // The upper bound stops huge payloads from tying up bcrypt.
  @IsString()
  @MinLength(6)
  @MaxLength(128)
  password: string;
}
