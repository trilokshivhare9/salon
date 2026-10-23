import {
  Controller,
  Get,
  Put,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guards/roles.guard';
import { Roles } from '../../../../common/decorators/roles.decorator';
import { CurrentSalonId } from '../../../../common/decorators/tenant.decorator';
import { SalonWorkingHoursService } from '../services/salon-working-hours.service';
import { UpdateSalonWorkingHoursDto } from '../dto/update-salon-working-hours.dto';

@ApiTags('Salon Facility Working Hours')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('salons/working-hours')
export class SalonWorkingHoursController {
  constructor(private readonly salonWorkingHoursService: SalonWorkingHoursService) {}

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Get()
  @ApiOperation({
    summary: 'Get all 7 days of salon facility operating hours with breaks and active staff counts',
  })
  async getSalonWorkingHours(@CurrentSalonId() salonId: string) {
    return this.salonWorkingHoursService.getSalonWorkingHours(salonId);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update salon facility operating hours, cascade closed days, and sync uncustomized staff',
  })
  async updateSalonWorkingHours(
    @CurrentSalonId() salonId: string,
    @Body() dto: UpdateSalonWorkingHoursDto,
  ) {
    return this.salonWorkingHoursService.updateSalonWorkingHours(salonId, dto);
  }
}
