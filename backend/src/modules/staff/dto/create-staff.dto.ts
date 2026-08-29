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
}

export class AssignStaffServicesDto {
  @IsArray()
  @IsString({ each: true })
  serviceIds: string[];
}

export class StaffDayWorkingHourDto {
  @IsEnum(DayOfWeek)
  dayOfWeek: DayOfWeek;

  @IsBoolean()
  isWorking: boolean;

  @IsString()
  startTime: string; // "10:00"

  @IsString()
  endTime: string; // "18:00"
}

export class UpdateStaffWorkingHoursDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StaffDayWorkingHourDto)
  hours: StaffDayWorkingHourDto[];
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
}
