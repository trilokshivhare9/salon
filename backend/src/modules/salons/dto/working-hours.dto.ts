import { IsArray, IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { DayOfWeek } from '@prisma/client';

export class DayWorkingHourDto {
  @IsEnum(DayOfWeek)
  @IsNotEmpty()
  dayOfWeek: DayOfWeek;

  @IsBoolean()
  @IsOptional()
  isClosed?: boolean;

  @IsBoolean()
  @IsOptional()
  isOpen?: boolean;

  @IsString()
  @IsOptional()
  startTime?: string; // "09:00"

  @IsString()
  @IsOptional()
  openTime?: string; // legacy alias

  @IsString()
  @IsOptional()
  endTime?: string; // "21:00"

  @IsString()
  @IsOptional()
  closeTime?: string; // legacy alias

  @IsString()
  @IsOptional()
  breakStartTime?: string; // "13:00"

  @IsString()
  @IsOptional()
  breakEndTime?: string; // "14:00"
}

export class UpdateWorkingHoursDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DayWorkingHourDto)
  hours: DayWorkingHourDto[];
}
