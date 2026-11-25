import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  userType?: string;

  @IsOptional()
  @IsUUID()
  tradeUnitId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}