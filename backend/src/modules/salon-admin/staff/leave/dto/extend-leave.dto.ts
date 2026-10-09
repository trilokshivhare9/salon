import { IsDateString, IsNotEmpty } from 'class-validator';

export class ExtendLeaveDto {
  @IsDateString()
  @IsNotEmpty()
  newEndDate: string; // "YYYY-MM-DD"
}
