import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
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
  name: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsNumber()
  @Min(30, { message: 'Service duration must be at least 30 minutes' })
  @IsMultipleOf15()
  durationMinutes: number;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsOptional()
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
  @IsOptional()
  name?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsOptional()
  description?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  price?: number;

  @IsNumber()
  @Min(30, { message: 'Service duration must be at least 30 minutes' })
  @IsMultipleOf15()
  @IsOptional()
  durationMinutes?: number;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsOptional()
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

