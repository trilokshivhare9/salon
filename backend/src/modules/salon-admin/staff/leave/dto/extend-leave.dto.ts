import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ExtendLeaveDto {
  @IsDateString()
  @IsNotEmpty()
  newEndDate: string; // "YYYY-MM-DD"

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

