import { IsOptional, IsString, IsEmail, IsNumber, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateOwnerSectionDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

export class UpdateSalonSectionDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsString()
  googleMapsUrl?: string;

  @IsOptional()
  @IsString()
  locationType?: string;

  @IsOptional()
  @IsString()
  pincode?: string;
}

export class UpdatePersonalProfileDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateOwnerSectionDto)
  owner?: UpdateOwnerSectionDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateSalonSectionDto)
  salon?: UpdateSalonSectionDto;

  // Direct top-level fields for convenience & fallback
  @IsOptional()
  @IsString()
  ownerName?: string;

  @IsOptional()
  @IsEmail()
  ownerEmail?: string;

  @IsOptional()
  @IsString()
  salonName?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsString()
  googleMapsUrl?: string;

  @IsOptional()
  @IsString()
  locationType?: string;

  @IsOptional()
  @IsString()
  pincode?: string;
}
