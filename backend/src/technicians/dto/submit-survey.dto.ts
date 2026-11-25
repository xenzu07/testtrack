import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class SurveyUnitAnswerDto {
  @IsUUID()
  tradeUnitId: string;

  @IsInt()
  @Min(0)
  @Max(4)
  proficiency: number;

  @IsInt()
  @Min(0)
  @Max(3)
  experience: number;

  @IsBoolean()
  certified: boolean;

  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  tasks: string[];
}

export class SubmitSurveyDto {
  // one entry per trade unit; the service checks every unit is answered once
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => SurveyUnitAnswerDto)
  answers: SurveyUnitAnswerDto[];
}
