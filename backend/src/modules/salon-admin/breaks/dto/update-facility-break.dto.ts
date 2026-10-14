import { IsOptional, IsString } from 'class-validator';

export class UpdateFacilityBreakDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  startTime?: string;

  @IsString()
  @IsOptional()
  endTime?: string;
}
