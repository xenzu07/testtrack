import { IsAcceptablePassword } from '../../auth/password';

export class ResetPasswordDto {
  @IsAcceptablePassword()
  newPassword: string;
}
