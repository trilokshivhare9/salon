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
  @IsNotEmpty()
  serviceId: string;

  @IsString()
  @IsOptional()
  staffId?: string;

  @IsDateString()
  @IsNotEmpty()
  date: string; // "YYYY-MM-DD"

  @IsString()
  @IsNotEmpty()
  startTime: string; // "10:00" (Local salon time)

  @IsString()
  @IsNotEmpty()
  customerName: string;

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
  staffId?: string;
}
