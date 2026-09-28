import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { LeaveType, LeavePortion } from '@prisma/client';

export class MarkAbsentDto {
  @IsDateString()
  @IsOptional()
  date?: string; // "YYYY-MM-DD" (backward compatibility)

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

export class PreviewAbsenceQueryDto {
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

export class GetAbsencesQueryDto {
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;
}

export class ExtendLeaveDto {
  @IsDateString()
  @IsNotEmpty()
  newEndDate: string; // "YYYY-MM-DD"
}
