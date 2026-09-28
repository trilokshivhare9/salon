import { IsOptional, IsString, IsInt, IsBoolean, Min, Max } from 'class-validator';

export class UpdateSalonDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(60)
  slotIntervalMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minAdvanceNoticeMins?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  maxAdvanceDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  cancelWindowHours?: number;

  @IsOptional()
  @IsBoolean()
  allowSpecificStaff?: boolean;
}
