import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DayOfWeek } from '@prisma/client';

export class StaffDayScheduleDto {
  @ApiProperty({ enum: DayOfWeek, example: DayOfWeek.MONDAY })
  @IsEnum(DayOfWeek)
  @IsNotEmpty()
  dayOfWeek: DayOfWeek;

  @ApiPropertyOptional({ example: true, default: true, description: 'True if stylist is working, false if day off' })
  @IsBoolean()
  @IsOptional()
  isWorking?: boolean;

  @ApiPropertyOptional({ example: false, description: 'Mark whether this day schedule is customized from salon hours' })
  @IsBoolean()
  @IsOptional()
  isCustomized?: boolean;

  @ApiPropertyOptional({ example: '10:00', description: 'Shift start time (HH:mm format, 24-hour)' })
  @IsString()
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'startTime must be in valid HH:mm 24-hour format (e.g. "10:00")',
  })
  startTime?: string;

  @ApiPropertyOptional({ example: '18:00', description: 'Shift end time (HH:mm format, 24-hour)' })
  @IsString()
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'endTime must be in valid HH:mm 24-hour format (e.g. "18:00")',
  })
  endTime?: string;

  // Tolerant optional fields for backward-compatible frontend payloads
  @ApiPropertyOptional()
  @IsOptional()
  breaks?: any[];

  @ApiPropertyOptional()
  @IsOptional()
  breakStartTime?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  breakEndTime?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  hasBreakOverride?: boolean;
}

export class UpdateStaffWorkingHoursDto {
  @ApiProperty({ type: [StaffDayScheduleDto], description: 'Weekly working hours array for staff member' })
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @Type(() => StaffDayScheduleDto)
  hours: StaffDayScheduleDto[];

  @ApiPropertyOptional({
    example: false,
    description: 'Whether staff member strictly follows salon schedule or has custom shifts',
  })
  @IsBoolean()
  @IsOptional()
  followsSalonSchedule?: boolean;
}
