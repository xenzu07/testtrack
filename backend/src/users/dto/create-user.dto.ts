import { IsEmail, IsEnum, IsOptional, IsString, IsUUID, MinLength, ValidateIf } from 'class-validator';
import { Role } from '@prisma/client';

export class CreateUserDto {
  @IsString()
  @MinLength(2)
  fullName: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsEnum(Role)
  role: Role;

  // student / faculty / staff (reporters only)
  @IsOptional()
  @IsString()
  userType?: string;

  // required for technicians
  @ValidateIf((o: CreateUserDto) => o.role === Role.TECHNICIAN)
  @IsUUID()
  tradeUnitId?: string;
}