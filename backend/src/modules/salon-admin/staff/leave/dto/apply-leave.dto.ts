import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsBoolean,
  Matches,
} from 'class-validator';
import { LeaveType } from '@prisma/client';

export class ApplyLeaveDto {
  @IsDateString()
  @IsOptional()
  date?: string; // "YYYY-MM-DD"

  @IsDateString()
  @IsOptional()
  startDate?: string; // "YYYY-MM-DD"

  @IsDateString()
  @IsOptional()
  endDate?: string; // "YYYY-MM-DD"

  @IsOptional()
  @IsBoolean()
  isPartialDay?: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'startTime must be in HH:mm format (e.g. 09:00)',
  })
  startTime?: string;

  @IsOptional()
  @IsString()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, {
    message: 'endTime must be in HH:mm format (e.g. 17:00)',
  })
  endTime?: string;

  @IsEnum(LeaveType)
  @IsOptional()
  leaveType?: LeaveType;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

// Canonical alias
export class MarkAbsentDto extends ApplyLeaveDto {}

