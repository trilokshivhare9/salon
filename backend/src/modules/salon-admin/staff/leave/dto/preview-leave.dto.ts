import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { LeavePortion } from '@prisma/client';

export class PreviewLeaveQueryDto {
  @IsDateString()
  @IsOptional()
  date?: string; // "YYYY-MM-DD"

  @IsDateString()
  @IsOptional()
  startDate?: string; // "YYYY-MM-DD"

  @IsDateString()
  @IsOptional()
  endDate?: string; // "YYYY-MM-DD"

  @IsEnum(LeavePortion)
  @IsOptional()
  leavePortion?: LeavePortion;

  @IsString()
  @IsOptional()
  customStartTime?: string;

  @IsString()
  @IsOptional()
  customEndTime?: string;
}

// Backward-compatible alias
export class PreviewAbsenceQueryDto extends PreviewLeaveQueryDto {}
