import { IsDateString, IsOptional } from 'class-validator';

export class LeaveHistoryQueryDto {
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;
}

// Backward-compatible alias
export class GetAbsencesQueryDto extends LeaveHistoryQueryDto {}
