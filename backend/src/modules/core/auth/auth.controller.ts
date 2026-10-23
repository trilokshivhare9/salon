import { Controller, Post, Patch, Body, Get, UseGuards, HttpCode, HttpStatus, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterSalonDto } from './dto/register.dto';
import {
  LookupSalonByMobileDto,
  ForgotPasswordDto,
  ResetPasswordWithOtpDto,
  ChangePasswordDto,
  UpdateAdminProfileDto,
} from './dto/password-reset.dto';
import { Public } from '../../../common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(@Body() loginDto: LoginDto, @Req() req: any) {
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip || req.connection?.remoteAddress;
    return this.authService.login(loginDto, userAgent, ipAddress);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(@Body('refreshToken') refreshToken: string, @Req() req: any) {
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip || req.connection?.remoteAddress;
    return this.authService.refresh(refreshToken, userAgent, ipAddress);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(@Body('refreshToken') refreshToken: string) {
    return this.authService.logout(refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('logout-all')
  async logoutAll(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.logoutAllDevices(user.id);
  }

  @Public()
  @Post('register')
  async register(@Body() registerDto: RegisterSalonDto) {
    return this.authService.registerSalon(registerDto);
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async getMe(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.getMe(user.id);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password-lookup')
  async lookupSalonByMobile(@Body() dto: LookupSalonByMobileDto) {
    return this.authService.lookupSalonByMobile(dto.mobile);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: any) {
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip || req.connection?.remoteAddress;
    return this.authService.forgotPassword(dto, ipAddress, userAgent);
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('reset-password-otp')
  async resetPasswordWithOtp(@Body() dto: ResetPasswordWithOtpDto, @Req() req: any) {
    const userAgent = req.headers['user-agent'];
    const ipAddress = req.ip || req.connection?.remoteAddress;
    return this.authService.resetPasswordWithOtp(dto, ipAddress, userAgent);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Patch('change-password')
  async changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Patch('profile')
  async updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateAdminProfileDto) {
    return this.authService.updateProfile(user.id, dto);
  }
}
