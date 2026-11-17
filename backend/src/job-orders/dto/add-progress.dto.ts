import { IsString, MinLength } from 'class-validator';

export class AddProgressDto {
  @IsString()
  @MinLength(3)
  remarks: string;
}