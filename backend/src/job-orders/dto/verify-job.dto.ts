import { IsBoolean, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class VerifyJobDto {
  @IsBoolean()
  approved: boolean;

  // required when sending the job back, optional when approving
  @ValidateIf((o: VerifyJobDto) => !o.approved || o.remarks !== undefined)
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  remarks?: string;
}