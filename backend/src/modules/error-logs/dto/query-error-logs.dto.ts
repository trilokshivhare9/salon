import { IsOptional, IsEnum, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ErrorStatus, ErrorSeverity } from '@prisma/client';

export class QueryErrorLogsDto {
  @IsOptional()
  @IsEnum(ErrorStatus)
  status?: ErrorStatus;

  @IsOptional()
  @IsEnum(ErrorSeverity)
  severity?: ErrorSeverity;

  @IsOptional()
  @IsString()
  salonId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  sortBy?: string = 'createdAt';

  @IsOptional()
  @IsString()
  sortOrder?: 'asc' | 'desc' = 'desc';
}

export class ResolveErrorLogDto {
  @IsOptional()
  @IsString()
  resolutionNotes?: string;
}
