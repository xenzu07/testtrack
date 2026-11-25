import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PushPlatform } from '@prisma/client';

export class ListNotificationsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  // ISO time of the oldest item already shown, for "load more"
  @IsOptional()
  @IsDateString()
  before?: string;
}

export class RegisterDeviceDto {
  @IsEnum(PushPlatform)
  platform: PushPlatform;

  // FCM registration token, or the Web Push endpoint
  @IsString()
  @MinLength(20)
  @MaxLength(4096)
  token: string;

  // Web Push only (checked in the service)
  @IsOptional()
  @IsString()
  @MaxLength(200)
  p256dh?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  auth?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  userAgent?: string;
}

export class RemoveDeviceDto {
  @IsString()
  @MaxLength(4096)
  token: string;
}
