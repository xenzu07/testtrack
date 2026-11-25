import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// multipart form fields arrive as text
const toBool = ({ value }: { value: unknown }) =>
  value === 'true' || value === true
    ? true
    : value === 'false' || value === false
      ? false
      : value;
const toInt = ({ value }: { value: unknown }) =>
  typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
import { Urgency } from '@prisma/client';

export class CreateReportDto {
  @IsUUID()
  locationId: string;

  @IsUUID()
  categoryId: string;

  // Ignored: the system sets the urgency/priority. Still accepted so phones
  // with an older app version (which send it) can keep submitting reports.
  @IsOptional()
  @IsEnum(Urgency)
  urgency?: Urgency;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  description: string;

  // impact questions (optional so older app versions keep working;
  // a report without them is flagged for the coordinator to review)
  // 0 = just me, 1 = 2-10 people, 2 = 11-50, 3 = more than 50
  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(0)
  @Max(3)
  affectedPeople?: number;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  safetyHazard?: boolean;

  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  blocksUse?: boolean;
}
