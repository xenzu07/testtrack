import { Transform } from 'class-transformer';
import {
  Equals,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === ''
    ? undefined
    : trim({ value });

// multipart fields sent with the signature image
export class SubmitFormDto {
  @IsUUID()
  reportId: string;

  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Department or office is required' })
  @MaxLength(120)
  department: string;

  // e.g. 0917 123 4567, +63 917 123 4567, (046) 123-4567
  @Transform(trim)
  @IsString()
  @Matches(/^\+?[\d\s()-]{7,20}$/, {
    message: 'Enter a valid contact number (digits, spaces, +, - and brackets)',
  })
  contactNumber: string;

  @Transform(trim)
  @IsString()
  @MinLength(10, {
    message: 'Describe the work requested (at least 10 characters)',
  })
  @MaxLength(2000)
  workRequested: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(200)
  preferredSchedule?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(1000)
  notes?: string;

  // the requester must tick the certification
  @Transform(({ value }) => value === true || value === 'true')
  @Equals(true, {
    message: 'Please confirm that the information is true and correct',
  })
  certified: boolean;
}

export class DecideFormDto {
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ReturnFormDto {
  @Transform(trim)
  @IsString()
  @MinLength(5, {
    message: 'Tell the requester what to change (at least 5 characters)',
  })
  @MaxLength(1000)
  reason: string;
}
