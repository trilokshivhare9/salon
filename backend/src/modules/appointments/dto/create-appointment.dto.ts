import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { AppointmentStatus, BookingSource } from '@prisma/client';

export class CreateAppointmentDto {
  @IsString()
  @IsOptional()
  serviceId?: string;

  @IsOptional()
  serviceIds?: string[];

  @IsString()
  @IsOptional()
  stylistId?: string;

  @IsString()
  @IsOptional()
  staffId?: string; // backwards compatibility

  @IsDateString()
  @IsNotEmpty()
  date: string; // "YYYY-MM-DD"

  @IsString()
  @IsNotEmpty()
  startTime: string; // "10:00" (Local salon time)

  @IsString()
  @IsOptional()
  customerName?: string;

  @IsString()
  @IsNotEmpty()
  customerPhone: string;

  @IsString()
  @IsOptional()
  customerEmail?: string;

  @IsEnum(BookingSource)
  @IsOptional()
  source?: BookingSource;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateAppointmentStatusDto {
  @IsEnum(AppointmentStatus)
  @IsNotEmpty()
  status: AppointmentStatus;

  @IsString()
  @IsOptional()
  reason?: string;
}

export class RescheduleAppointmentDto {
  @IsDateString()
  @IsNotEmpty()
  newDate: string; // "YYYY-MM-DD"

  @IsString()
  @IsNotEmpty()
  newStartTime: string; // "14:00"

  @IsString()
  @IsOptional()
  stylistId?: string;

  @IsString()
  @IsOptional()
  staffId?: string; // backwards compatibility
}
