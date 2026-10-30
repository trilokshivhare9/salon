import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { ServiceGender } from '@prisma/client';
import { IsMultipleOf15 } from '../..//dto/create-service.dto';

export class BulkImportItemDto {
  @IsString()
  @IsNotEmpty({ message: 'Service name cannot be empty' })
  name: string;

  @IsString()
  @IsNotEmpty({ message: 'Category cannot be empty' })
  category: string;

  @IsNumber()
  @Min(1, { message: 'Service price must be at least ₹1' })
  @Max(500000, { message: 'Service price cannot exceed ₹5,00,000' })
  price: number;

  @IsNumber()
  @Min(30, { message: 'Service duration must be at least 30 minutes' })
  @IsMultipleOf15()
  durationMinutes: number;

  @IsEnum(ServiceGender)
  @IsOptional()
  targetGender?: ServiceGender;

  @IsString()
  @IsOptional()
  description?: string;

  @IsOptional()
  selected?: boolean;

  @IsOptional()
  tempId?: string;
}

export class BulkImportServicesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkImportItemDto)
  services: BulkImportItemDto[];
}
