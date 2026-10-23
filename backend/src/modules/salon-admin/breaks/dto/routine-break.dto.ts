import { IsArray, IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { DayOfWeek } from '@prisma/client';

export class UpdateRoutineBreakDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsNotEmpty()
  startTime: string;

  @IsString()
  @IsNotEmpty()
  endTime: string;

  @IsArray()
  @IsEnum(DayOfWeek, { each: true })
  @IsNotEmpty()
  days: DayOfWeek[];

  @IsBoolean()
  @IsOptional()
  autoReschedule?: boolean;

  @IsOptional()
  breakIds?: Record<string, string>;

  @IsString()
  @IsOptional()
  originalStartTime?: string;

  @IsString()
  @IsOptional()
  originalEndTime?: string;

  @IsString()
  @IsOptional()
  salonBreakId?: string;
}

export class DeleteRoutineBreakDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsNotEmpty()
  startTime: string;

  @IsString()
  @IsNotEmpty()
  endTime: string;

  @IsArray()
  @IsEnum(DayOfWeek, { each: true })
  @IsOptional()
  days?: DayOfWeek[];
}
