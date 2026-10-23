import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateStaffBreakDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  startTime?: string;

  @IsString()
  @IsOptional()
  endTime?: string;

  @IsBoolean()
  @IsOptional()
  autoReschedule?: boolean;
}
