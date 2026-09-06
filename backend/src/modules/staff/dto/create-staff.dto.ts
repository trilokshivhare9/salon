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
  @IsNotEmpty({ message: 'At least one service ID must be assigned to the stylist' })
  serviceIds: string[];

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
  @IsNotEmpty({ message: 'serviceIds must not be empty' })
  serviceIds: string[];
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

  @IsString()
  @IsOptional()
  breakStartTime?: string; // "13:00"

  @IsString()
  @IsOptional()
  breakEndTime?: string; // "14:00"
}

export class UpdateStaffWorkingHoursDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StaffDayWorkingHourDto)
  hours: StaffDayWorkingHourDto[];
}
