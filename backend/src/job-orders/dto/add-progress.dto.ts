import { IsString, MaxLength, MinLength } from 'class-validator';

export class AddProgressDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  remarks: string;
}