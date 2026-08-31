import {
  IsNotEmpty,
  IsString,
  IsEmail,
  IsOptional,
  MinLength,
  MaxLength,
  Matches,
  IsUUID,
  IsBoolean,
  IsIn,
} from 'class-validator';

export class CreateSalonPlatformDto {
  @IsNotEmpty({ message: 'Salon business name is required' })
  @IsString()
  @MinLength(3, { message: 'Salon name must be at least 3 characters' })
  @MaxLength(100, { message: 'Salon name must not exceed 100 characters' })
  name: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsString()
  @IsIn(['MENS_SALON', 'WOMENS_PARLOUR', 'UNISEX_SALON'], {
    message: 'Category must be MENS_SALON, WOMENS_PARLOUR, or UNISEX_SALON',
  })
  category?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsNotEmpty({ message: 'Owner full name is required' })
  @IsString()
  @MinLength(2, { message: 'Owner name must be at least 2 characters' })
  @MaxLength(100, { message: 'Owner name must not exceed 100 characters' })
  ownerName: string;

  @IsNotEmpty({ message: 'Owner email address is required' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @IsNotEmpty({ message: 'Owner password is required' })
  @IsString()
  @MinLength(6, { message: 'Password must be at least 6 characters long' })
  password: string;

  @IsNotEmpty({ message: 'Salon phone number is required' })
  @IsString()
  phone: string;

  @IsNotEmpty({ message: 'City is required' })
  @IsString()
  city: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  openTime?: string;

  @IsOptional()
  @IsString()
  closeTime?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Invalid plan ID format' })
  planId?: string;

  @IsOptional()
  @IsString()
  whatsappPhoneNumberId?: string;

  @IsOptional()
  @IsBoolean()
  seedStarterServices?: boolean;
}
