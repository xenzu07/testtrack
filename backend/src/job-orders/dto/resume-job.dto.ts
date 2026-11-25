import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ResumeJobDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;
}