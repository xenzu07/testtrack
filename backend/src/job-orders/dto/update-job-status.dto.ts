import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Status } from '@prisma/client';

export class UpdateJobStatusDto {
  @IsIn([Status.IN_PROGRESS, Status.COMPLETED])
  status: Status;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}