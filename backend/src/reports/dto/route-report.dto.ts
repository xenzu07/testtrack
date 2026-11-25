import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class RouteReportDto {
  @IsUUID()
  tradeUnitId: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;
}
