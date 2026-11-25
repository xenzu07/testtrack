import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ReportDelayDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  materialsNote?: string;

  // left empty when no new date has been established; the system never invents one
  @IsOptional()
  @IsDateString()
  revisedTargetDate?: string;
}