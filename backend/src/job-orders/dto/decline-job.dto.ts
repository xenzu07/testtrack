import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class DeclineJobDto {
  // why the technician cannot take the job; shown to coordinators only
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(5, { message: 'Please give a reason for declining (at least 5 characters)' })
  @MaxLength(500)
  reason: string;
}
