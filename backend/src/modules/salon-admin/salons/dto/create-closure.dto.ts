import { IsEnum, IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';
import { SalonClosureType } from '@prisma/client';

export class CreateClosureDto {
  @IsEnum(SalonClosureType)
  closureType: SalonClosureType;

  @IsString()
  @IsNotEmpty()
  startDate: string;

  @IsString()
  @IsNotEmpty()
  endDate: string;

  @IsOptional()
  @IsBoolean()
  isPartialDay?: boolean;

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  autoCancelAppointments?: boolean;
}
