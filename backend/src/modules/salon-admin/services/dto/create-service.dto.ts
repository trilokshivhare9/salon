import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  Max,
  MinLength,
  MaxLength,
  IsArray,
  IsUUID,
  IsEnum,
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';
import { ServiceGender } from '@prisma/client';

export function IsMultipleOf15(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      name: 'isMultipleOf15',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, _args: ValidationArguments) {
          return typeof value === 'number' && value > 0 && value % 15 === 0;
        },
        defaultMessage(_args: ValidationArguments) {
          return 'durationMinutes must be a multiple of 15 (e.g. 30, 45, 60, 75, 90)';
        },
      },
    });
  };
}

export class CreateServiceDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Service name cannot be empty or blank' })
  @MinLength(2, { message: 'Service name must be at least 2 characters long' })
  @MaxLength(100, { message: 'Service name cannot exceed 100 characters' })
  name: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsOptional()
  @MaxLength(500, { message: 'Description cannot exceed 500 characters' })
  description?: string;

  @IsNumber()
  @Min(1, { message: 'Service price must be at least ₹1. Free or ₹0 services are not allowed.' })
  @Max(500000, { message: 'Service price cannot exceed ₹5,00,000' })
  price: number;

  @IsNumber()
  @Min(15, { message: 'Service duration must be at least 15 minutes' })
  @Max(480, { message: 'Service duration cannot exceed 480 minutes (8 hours)' })
  @IsMultipleOf15()
  durationMinutes: number;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsOptional()
  @MaxLength(50, { message: 'Category name cannot exceed 50 characters' })
  category?: string;

  @IsUUID('4', { message: 'categoryId must be a valid UUID' })
  @IsOptional()
  categoryId?: string;

  @IsEnum(ServiceGender, { message: 'targetGender must be MALE, FEMALE, UNISEX, or KIDS' })
  @IsOptional()
  targetGender?: ServiceGender;

  @IsArray()
  @IsUUID('4', { each: true, message: 'Each stylistId must be a valid UUID' })
  @IsOptional()
  stylistIds?: string[];
}

export class UpdateServiceDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Service name cannot be empty or blank if provided' })
  @MinLength(2, { message: 'Service name must be at least 2 characters long' })
  @MaxLength(100, { message: 'Service name cannot exceed 100 characters' })
  @IsOptional()
  name?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsOptional()
  @MaxLength(500, { message: 'Description cannot exceed 500 characters' })
  description?: string;

  @IsNumber()
  @Min(1, { message: 'Service price must be at least ₹1. Free or ₹0 services are not allowed.' })
  @Max(500000, { message: 'Service price cannot exceed ₹5,00,000' })
  @IsOptional()
  price?: number;

  @IsNumber()
  @Min(15, { message: 'Service duration must be at least 15 minutes' })
  @Max(480, { message: 'Service duration cannot exceed 480 minutes (8 hours)' })
  @IsMultipleOf15()
  @IsOptional()
  durationMinutes?: number;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsOptional()
  @MaxLength(50, { message: 'Category name cannot exceed 50 characters' })
  category?: string;

  @IsUUID('4', { message: 'categoryId must be a valid UUID' })
  @IsOptional()
  categoryId?: string;

  @IsEnum(ServiceGender, { message: 'targetGender must be MALE, FEMALE, UNISEX, or KIDS' })
  @IsOptional()
  targetGender?: ServiceGender;

  @IsArray()
  @IsUUID('4', { each: true, message: 'Each stylistId must be a valid UUID' })
  @IsOptional()
  stylistIds?: string[];
}

