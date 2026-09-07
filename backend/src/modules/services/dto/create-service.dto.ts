import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

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
  @IsString()
  @IsNotEmpty()
  name: string;

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

  @IsString()
  @IsOptional()
  category?: string;
}

export class UpdateServiceDto {
  @IsString()
  @IsOptional()
  name?: string;

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

  @IsString()
  @IsOptional()
  category?: string;
}
