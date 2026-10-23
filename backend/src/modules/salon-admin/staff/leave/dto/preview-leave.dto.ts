import { IsDateString, IsOptional, IsString, IsBoolean } from 'class-validator';

export class PreviewLeaveQueryDto {
  @IsDateString()
  @IsOptional()
  date?: string; // "YYYY-MM-DD"

  @IsDateString()
  @IsOptional()
  startDate?: string; // "YYYY-MM-DD"

  @IsDateString()
  @IsOptional()
  endDate?: string; // "YYYY-MM-DD"

  @IsOptional()
  @IsBoolean()
  isPartialDay?: boolean;

  @IsString()
  @IsOptional()
  startTime?: string;

  @IsString()
  @IsOptional()
  endTime?: string;
}

// Canonical alias
export class PreviewAbsenceQueryDto extends PreviewLeaveQueryDto {}

