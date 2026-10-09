import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { LeaveType, LeavePortion } from '@prisma/client';

export class ApplyLeaveDto {
  @IsDateString()
  @IsOptional()
  date?: string; // "YYYY-MM-DD" (Single-day legacy support)

  @IsDateString()
  @IsOptional()
  startDate?: string; // "YYYY-MM-DD"

  @IsDateString()
  @IsOptional()
  endDate?: string; // "YYYY-MM-DD"

  @IsEnum(LeaveType)
  @IsOptional()
  leaveType?: LeaveType;

  @IsEnum(LeavePortion)
  @IsOptional()
  leavePortion?: LeavePortion;

  @IsString()
  @IsOptional()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'customStartTime must be in HH:mm format (e.g. 11:00)',
  })
  customStartTime?: string;

  @IsString()
  @IsOptional()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'customEndTime must be in HH:mm format (e.g. 15:00)',
  })
  customEndTime?: string;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

// Backward-compatible alias
export class MarkAbsentDto extends ApplyLeaveDto {}
