import { IsString, MaxLength } from 'class-validator';
import { IsAcceptablePassword } from '../password';

export class ChangePasswordDto {
  @IsString()
  @MaxLength(128)
  currentPassword: string;

  @IsAcceptablePassword()
  newPassword: string;
}
