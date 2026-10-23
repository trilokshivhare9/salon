import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ScanMenuRequestDto {
  @IsString()
  @IsNotEmpty({ message: 'imageBase64 is required' })
  imageBase64: string;

  @IsString()
  @IsOptional()
  mimeType?: string;
}
