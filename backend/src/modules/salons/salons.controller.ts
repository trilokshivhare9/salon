import {
  Controller,
  Get,
  Put,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { SalonsService } from './salons.service';
import { CreateSalonPlatformDto } from './dto/create-salon-platform.dto';
import { UpdateSalonDto } from './dto/update-salon.dto';
import { UpdateWorkingHoursDto } from './dto/working-hours.dto';
import { CreateHolidayDto, CreateBlockedTimeDto } from './dto/holiday.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentSalonId } from '../../common/decorators/tenant.decorator';
import { UserRole } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('salons')
export class SalonsController {
  constructor(private readonly salonsService: SalonsService) {}

  // -------------------------------------------------------------
  // SUPER ADMIN (PLATFORM OWNER) ENDPOINTS
  // -------------------------------------------------------------
  @Roles(UserRole.PLATFORM_ADMIN)
  @Get('platform/all')
  async getAllSalons() {
    return this.salonsService.getAllSalonsForPlatformAdmin();
  }

  @Roles(UserRole.PLATFORM_ADMIN)
  @Post('platform/create')
  async createSalonBySuperAdmin(@Body() dto: CreateSalonPlatformDto) {
    return this.salonsService.createSalonBySuperAdmin(dto);
  }

  @Roles(UserRole.PLATFORM_ADMIN)
  @Patch('platform/:id/toggle-status')
  async toggleSalonStatus(@Param('id') salonId: string) {
    return this.salonsService.toggleSalonStatus(salonId);
  }

  @Roles(UserRole.PLATFORM_ADMIN)
  @Post('platform/reset-database')
  async resetDatabase() {
    return this.salonsService.resetDatabaseToZero();
  }

  @Roles(UserRole.PLATFORM_ADMIN, UserRole.SALON_ADMIN)
  @Post(':id/whatsapp-config')
  async updateWhatsAppConfig(
    @Param('id') salonId: string,
    @Body() dto: { phoneNumberId: string; wabaId?: string; accessToken?: string },
  ) {
    return this.salonsService.updateSalonWhatsAppConfig(salonId, dto);
  }

  // -------------------------------------------------------------
  // SALON ADMIN ENDPOINTS
  // -------------------------------------------------------------
  @Get('profile')
  async getProfile(@CurrentSalonId() salonId: string) {
    return this.salonsService.getSalonProfile(salonId);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Put('profile')
  async updateProfile(
    @CurrentSalonId() salonId: string,
    @Body() dto: UpdateSalonDto,
  ) {
    return this.salonsService.updateSalonProfile(salonId, dto);
  }

  @Get('working-hours')
  async getWorkingHours(@CurrentSalonId() salonId: string) {
    return this.salonsService.getWorkingHours(salonId);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Put('working-hours')
  async updateWorkingHours(
    @CurrentSalonId() salonId: string,
    @Body() dto: UpdateWorkingHoursDto,
  ) {
    return this.salonsService.updateWorkingHours(salonId, dto);
  }

  @Get('holidays')
  async getHolidays(@CurrentSalonId() salonId: string) {
    return this.salonsService.getHolidays(salonId);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Post('holidays')
  async addHoliday(
    @CurrentSalonId() salonId: string,
    @Body() dto: CreateHolidayDto,
  ) {
    return this.salonsService.addHoliday(salonId, dto);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Delete('holidays/:id')
  async deleteHoliday(
    @CurrentSalonId() salonId: string,
    @Param('id') holidayId: string,
  ) {
    return this.salonsService.deleteHoliday(salonId, holidayId);
  }

  @Get('blocked-times')
  async getBlockedTimes(@CurrentSalonId() salonId: string) {
    return this.salonsService.getBlockedTimes(salonId);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Post('blocked-times')
  async addBlockedTime(
    @CurrentSalonId() salonId: string,
    @Body() dto: CreateBlockedTimeDto,
  ) {
    return this.salonsService.addBlockedTime(salonId, dto);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Delete('blocked-times/:id')
  async deleteBlockedTime(
    @CurrentSalonId() salonId: string,
    @Param('id') blockedTimeId: string,
  ) {
    return this.salonsService.deleteBlockedTime(salonId, blockedTimeId);
  }
}
