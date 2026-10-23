import { IsArray, IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { DayOfWeek } from '@prisma/client';

export class CreateStaffBreakDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsNotEmpty()
  startTime: string; // e.g. "13:00"

  @IsString()
  @IsNotEmpty()
  endTime: string;   // e.g. "14:00"

  @IsArray()
  @IsEnum(DayOfWeek, { each: true })
  @IsOptional()
  days?: DayOfWeek[];

  @IsEnum(DayOfWeek)
  @IsOptional()
  dayOfWeek?: DayOfWeek;

  @IsBoolean()
  @IsOptional()
  autoReschedule?: boolean;
}
