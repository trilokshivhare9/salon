import { IsString, IsNotEmpty, MinLength, Matches, IsOptional, IsEmail } from 'class-validator';

export class LookupSalonByMobileDto {
  @IsString()
  @IsNotEmpty({ message: 'Owner registered mobile number is required' })
  mobile: string;
}

export class ForgotPasswordDto {
  @IsString()
  @IsOptional()
  mobile?: string;

  @IsString()
  @IsOptional()
  identifier?: string;
}

export class ResetPasswordWithOtpDto {
  @IsString()
  @IsNotEmpty({ message: 'Phone number or email is required' })
  identifier: string;

  @IsString()
  @IsNotEmpty({ message: '6-digit OTP code is required' })
  @Matches(/^\d{6}$/, { message: 'OTP must be exactly 6 digits' })
  otp: string;

  @IsString()
  @MinLength(8, { message: 'New password must be at least 8 characters long' })
  newPassword: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Current password is required' })
  currentPassword: string;

  @IsString()
  @MinLength(8, { message: 'New password must be at least 8 characters long' })
  newPassword: string;
}

export class UpdateAdminProfileDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;
}
