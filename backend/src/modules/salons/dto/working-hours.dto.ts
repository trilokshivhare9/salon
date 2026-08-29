import { IsArray, IsBoolean, IsEnum, IsNotEmpty, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { DayOfWeek } from '@prisma/client';

export class DayWorkingHourDto {
  @IsEnum(DayOfWeek)
  @IsNotEmpty()
  dayOfWeek: DayOfWeek;

  @IsBoolean()
  isOpen: boolean;

  @IsString()
  @IsNotEmpty()
  openTime: string; // "10:00"

  @IsString()
  @IsNotEmpty()
  closeTime: string; // "20:00"
}

export class UpdateWorkingHoursDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DayWorkingHourDto)
  hours: DayWorkingHourDto[];
}
