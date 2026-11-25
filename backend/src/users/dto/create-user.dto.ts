import { IsEmail, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { Role } from '@prisma/client';
import { IsAcceptablePassword } from '../../auth/password';

export class CreateUserDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName: string;

  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsAcceptablePassword()
  password: string;

  @IsEnum(Role)
  role: Role;

  // student / faculty / staff (reporters only)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  userType?: string;

  // required for technicians
  @ValidateIf((o: CreateUserDto) => o.role === Role.TECHNICIAN)
  @IsUUID()
  tradeUnitId?: string;
}
