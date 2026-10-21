import { IsOptional, Matches, IsUUID, IsString, IsEnum } from 'class-validator';

export enum CalendarScope {
  SALON = 'SALON',
  STAFF = 'STAFF',
}

export class GetCalendarScheduleDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}$/, { message: 'month must be in YYYY-MM format (e.g. 2026-10)' })
  month?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate must be in YYYY-MM-DD format' })
  startDate?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate must be in YYYY-MM-DD format' })
  endDate?: string;

  @IsOptional()
  @IsEnum(CalendarScope, { message: 'calendarFor must be either SALON or STAFF' })
  calendarFor?: CalendarScope;

  @IsOptional()
  @IsUUID('4', { message: 'staffId must be a valid UUID' })
  staffId?: string;

  @IsOptional()
  @IsUUID('4', { message: 'stylistId must be a valid UUID' })
  stylistId?: string;

  @IsOptional()
  _t?: string;
}

