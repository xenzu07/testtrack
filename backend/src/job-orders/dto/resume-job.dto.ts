import { IsOptional, IsString } from 'class-validator';

export class ResumeJobDto {
  @IsOptional()
  @IsString()
  remarks?: string;
}