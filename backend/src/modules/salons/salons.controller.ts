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
  Request,
} from '@nestjs/common';
import { SalonsService } from './salons.service';
import { CreateSalonPlatformDto } from './dto/create-salon-platform.dto';
import { UpdateSalonDto } from './dto/update-salon.dto';
import { UpdateWorkingHoursDto } from './dto/working-hours.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentSalonId } from '../../common/decorators/tenant.decorator';
import { AdminRole } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('salons')
export class SalonsController {
  constructor(private readonly salonsService: SalonsService) {}

  // -------------------------------------------------------------
  // SUPER ADMIN (PLATFORM OWNER) ENDPOINTS
  // -------------------------------------------------------------
  @Roles(AdminRole.SUPER_ADMIN)
  @Get('platform/all')
  async getAllSalons() {
    return this.salonsService.getAllSalonsForPlatformAdmin();
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Post('platform/create')
  async createSalonBySuperAdmin(@Request() req: any, @Body() dto: CreateSalonPlatformDto) {
    const superAdminId = req.user?.id || req.user?.sub;
    return this.salonsService.createSalonBySuperAdmin(superAdminId, dto);
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Patch('platform/:id/toggle-status')
  async toggleSalonStatus(@Param('id') salonId: string) {
    return this.salonsService.toggleSalonStatus(salonId);
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Post('platform/verify-phone-number')
  async verifyPhoneNumber(@Body() body: { phone: string; usePlatformBot?: boolean }) {
    return this.salonsService.verifyPhoneNumberWithMeta(body.phone, body.usePlatformBot);
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Get('platform/verify-meta-phone/:phoneId')
  async verifyMetaPhoneId(@Param('phoneId') phoneId: string) {
    return this.salonsService.verifyMetaPhoneNumberId(phoneId);
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Post('platform/:id/link-whatsapp')
  async linkWhatsApp(
    @Param('id') salonId: string,
    @Body() dto: { phoneNumberId: string },
  ) {
    return this.salonsService.linkSalonWhatsAppAccount(salonId, dto.phoneNumberId);
  }

  @Roles(AdminRole.SUPER_ADMIN)
  @Delete('platform/:id')
  async deleteSalon(@Param('id') salonId: string) {
    return this.salonsService.deleteSalonBySuperAdmin(salonId);
  }

  @Roles(AdminRole.SUPER_ADMIN, AdminRole.SALON_OWNER)
  @Post(':id/whatsapp-config')
  async updateWhatsAppConfig(
    @Param('id') salonId: string,
    @Body() dto: { phoneNumberId: string; wabaId?: string; accessToken?: string },
  ) {
    return this.salonsService.updateSalonWhatsAppConfig(salonId, dto);
  }

  // -------------------------------------------------------------
  // SALON OWNER ENDPOINTS
  // -------------------------------------------------------------
  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Get('profile')
  async getProfile(@CurrentSalonId() salonId: string) {
    return this.salonsService.getSalonProfile(salonId);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Put('profile')
  async updateProfile(
    @CurrentSalonId() salonId: string,
    @Body() dto: UpdateSalonDto,
  ) {
    return this.salonsService.updateSalonProfile(salonId, dto);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Get('working-hours')
  async getWorkingHours(@CurrentSalonId() salonId: string) {
    return this.salonsService.getWorkingHours(salonId);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Put('working-hours')
  async updateWorkingHours(
    @CurrentSalonId() salonId: string,
    @Body() dto: UpdateWorkingHoursDto,
  ) {
    return this.salonsService.updateWorkingHours(salonId, dto);
  }
}
