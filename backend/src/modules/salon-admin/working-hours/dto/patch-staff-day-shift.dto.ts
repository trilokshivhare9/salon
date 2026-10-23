import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class PatchStaffDayShiftDto {
  @ApiPropertyOptional({ example: false, description: 'Set to false for Weekly Off, true for Working Day' })
  @IsBoolean()
  @IsOptional()
  isWorking?: boolean;

  @ApiPropertyOptional({ example: '10:00', description: 'Shift start time (HH:mm format, 24-hour)' })
  @IsString()
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'startTime must be in valid HH:mm 24-hour format (e.g. "10:00")',
  })
  startTime?: string;

  @ApiPropertyOptional({ example: false, description: 'Mark whether this day schedule is customized from salon hours' })
  @IsBoolean()
  @IsOptional()
  isCustomized?: boolean;

  @ApiPropertyOptional({ example: '18:00', description: 'Shift end time (HH:mm format, 24-hour)' })
  @IsString()
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'endTime must be in valid HH:mm 24-hour format (e.g. "18:00")',
  })
  endTime?: string;
}
