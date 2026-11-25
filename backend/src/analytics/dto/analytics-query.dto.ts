import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class RangeQueryDto {
  // local campus dates, inclusive; default: the last 30 days
  @IsOptional()
  @Matches(DAY, { message: 'from must be a date like 2026-11-01' })
  from?: string;

  @IsOptional()
  @Matches(DAY, { message: 'to must be a date like 2026-11-30' })
  to?: string;
}

export const STATUS_GROUPS = ['pending', 'ongoing', 'completed'] as const;
export type StatusGroup = (typeof STATUS_GROUPS)[number];

export class OverviewQueryDto extends RangeQueryDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  building?: string;

  @IsOptional()
  @IsIn(STATUS_GROUPS)
  status?: StatusGroup;
}
