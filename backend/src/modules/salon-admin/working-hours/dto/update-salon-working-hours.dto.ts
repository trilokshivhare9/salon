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

export class SalonDayScheduleDto {
  @ApiProperty({ enum: DayOfWeek, example: DayOfWeek.MONDAY })
  @IsEnum(DayOfWeek)
  @IsNotEmpty()
  dayOfWeek: DayOfWeek;

  @ApiPropertyOptional({ example: false, default: false })
  @IsBoolean()
  @IsOptional()
  isClosed?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isOpen?: boolean;

  @ApiPropertyOptional({ example: '09:00', description: 'Opening time (HH:mm format, 24-hour)' })
  @IsString()
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'startTime must be in valid HH:mm 24-hour format (e.g. "09:00")',
  })
  startTime?: string;

  @ApiPropertyOptional({ example: '21:00', description: 'Closing time (HH:mm format, 24-hour)' })
  @IsString()
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'endTime must be in valid HH:mm 24-hour format (e.g. "21:00")',
  })
  endTime?: string;

  // Backward-compatible optional fields
  @ApiPropertyOptional()
  @IsOptional()
  breaks?: any[];

  @ApiPropertyOptional()
  @IsOptional()
  openTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  closeTime?: string;
}

export class UpdateSalonWorkingHoursDto {
  @ApiProperty({ type: [SalonDayScheduleDto], description: 'Weekly working hours array (1-7 days)' })
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(7)
  @Type(() => SalonDayScheduleDto)
  hours: SalonDayScheduleDto[];
}
