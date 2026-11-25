import { Priority } from '@prisma/client';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class ReviewPriorityDto {
  @IsIn(['confirm', 'adjust'])
  action: 'confirm' | 'adjust';

  // adjust only: the new level, or null to return to the automatic level
  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority | null;

  // adjust only: required, recorded with the change
  @ValidateIf((o: ReviewPriorityDto) => o.action === 'adjust')
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class DecideDuplicateDto {
  @IsIn(['confirm', 'dismiss'])
  decision: 'confirm' | 'dismiss';

  // confirm only, when both reports already have a job order: which one
  // continues the work (the other is cancelled as merged). Optional: by
  // default the job that is further along is kept.
  @IsOptional()
  @IsUUID()
  keepJobOrderId?: string;
}
