import { IsArray, IsBoolean, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { DayOfWeek } from '@prisma/client';

export class InheritSalonBreakDto {
  @IsString()
  @IsNotEmpty()
  salonBreakId: string;

  @IsArray()
  @IsEnum(DayOfWeek, { each: true })
  @IsOptional()
  days?: DayOfWeek[];

  @IsBoolean()
  @IsOptional()
  replaceConflicts?: boolean;
}
