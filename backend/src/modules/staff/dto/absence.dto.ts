import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class MarkAbsentDto {
  @IsDateString()
  @IsNotEmpty()
  date: string; // "YYYY-MM-DD"

  @IsString()
  @IsOptional()
  reason?: string; // "Sick Leave", "Personal", "Emergency", etc.

  @IsString()
  @IsOptional()
  notes?: string; // Free-text admin notes
}

export class PreviewAbsenceQueryDto {
  @IsDateString()
  @IsNotEmpty()
  date: string; // "YYYY-MM-DD"
}

export class GetAbsencesQueryDto {
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;
}
