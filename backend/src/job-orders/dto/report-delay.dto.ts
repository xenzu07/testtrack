import { IsDateString, IsOptional, IsString, MinLength } from 'class-validator';

export class ReportDelayDto {
  @IsString()
  @MinLength(3)
  reason: string;

  @IsOptional()
  @IsString()
  materialsNote?: string;

  // left empty when no new date has been established; the system never invents one
  @IsOptional()
  @IsDateString()
  revisedTargetDate?: string;
}