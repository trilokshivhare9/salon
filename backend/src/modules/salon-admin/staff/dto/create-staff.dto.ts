import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { DayOfWeek } from '@prisma/client';

export class CreateStaffDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  profileImageUrl?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  serviceIds?: string[];

  @IsBoolean()
  @IsOptional()
  followsSalonSchedule?: boolean;
}

export class UpdateStaffDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  profileImageUrl?: string;

  @IsBoolean()
  @IsOptional()
  followsSalonSchedule?: boolean;
}

export class AssignStaffServicesDto {
  @IsArray()
  @IsString({ each: true })
  serviceIds: string[];
}

export class StaffBreakItemDto {
  @IsString()
  @IsOptional()
  id?: string;

  @IsString()
  @IsNotEmpty()
  startTime: string; // "13:00"

  @IsString()
  @IsNotEmpty()
  endTime: string;   // "14:00"

  @IsString()
  @IsOptional()
  title?: string;
}

export class StaffDayWorkingHourDto {
  @IsEnum(DayOfWeek)
  dayOfWeek: DayOfWeek;

  @IsBoolean()
  isWorking: boolean;

  @IsString()
  @IsNotEmpty()
  startTime: string; // "10:00"

  @IsString()
  @IsNotEmpty()
  endTime: string; // "18:00"

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => StaffBreakItemDto)
  breaks?: StaffBreakItemDto[];
}

export class UpdateStaffWorkingHoursDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StaffDayWorkingHourDto)
  hours: StaffDayWorkingHourDto[];

  @IsBoolean()
  @IsOptional()
  followsSalonSchedule?: boolean;
}

export class CreateStaffBreakDto {
  @IsEnum(DayOfWeek)
  dayOfWeek: DayOfWeek;

  @IsString()
  @IsNotEmpty()
  startTime: string; // "13:00"

  @IsString()
  @IsNotEmpty()
  endTime: string; // "14:00"

  @IsString()
  @IsOptional()
  title?: string;

  @IsBoolean()
  @IsOptional()
  autoReschedule?: boolean;
}

export class UpdateStaffBreakDto {
  @IsString()
  @IsOptional()
  startTime?: string;

  @IsString()
  @IsOptional()
  endTime?: string;

  @IsString()
  @IsOptional()
  title?: string;
}

