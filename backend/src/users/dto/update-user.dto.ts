import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsString()
  userType?: string;

  @IsOptional()
  @IsUUID()
  tradeUnitId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}