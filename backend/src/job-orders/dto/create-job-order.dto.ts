import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateJobOrderDto {
  @IsUUID()
  reportId: string;

  // the trade unit confirmed or chosen by the coordinator;
  // defaults to the report's proposed trade unit
  @IsOptional()
  @IsUUID()
  tradeUnitId?: string;

  @IsOptional()
  @IsUUID()
  technicianId?: string;

  // left empty when unknown; the system never invents these
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  materialsNote?: string;

  @IsOptional()
  @IsDateString()
  targetDate?: string;

  // optional note added to the routing entry in the history
  @IsOptional()
  @IsString()
  @MaxLength(500)
  routingRemarks?: string;
}