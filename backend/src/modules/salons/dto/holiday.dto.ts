import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateHolidayDto {
  @IsDateString()
  @IsNotEmpty()
  date: string; // "YYYY-MM-DD"

  @IsString()
  @IsOptional()
  reason?: string;
}

export class CreateBlockedTimeDto {
  @IsOptional()
  @IsString()
  staffId?: string; // If omitted, blocks whole salon

  @IsDateString()
  @IsNotEmpty()
  startTime: string; // ISO String

  @IsDateString()
  @IsNotEmpty()
  endTime: string; // ISO String

  @IsString()
  @IsOptional()
  reason?: string;
}
