import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ServicesService } from './services.service';
import { CreateServiceDto, UpdateServiceDto } from './dto/create-service.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentSalonId } from '../../common/decorators/tenant.decorator';
import { UserRole } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get()
  async getServices(@CurrentSalonId() salonId: string) {
    return this.servicesService.getSalonServices(salonId);
  }

  @Get(':id')
  async getServiceById(
    @CurrentSalonId() salonId: string,
    @Param('id') serviceId: string,
  ) {
    return this.servicesService.getServiceById(salonId, serviceId);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Post()
  async createService(
    @CurrentSalonId() salonId: string,
    @Body() dto: CreateServiceDto,
  ) {
    return this.servicesService.createService(salonId, dto);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Put(':id')
  async updateService(
    @CurrentSalonId() salonId: string,
    @Param('id') serviceId: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.servicesService.updateService(salonId, serviceId, dto);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Patch(':id/toggle-status')
  async toggleServiceStatus(
    @CurrentSalonId() salonId: string,
    @Param('id') serviceId: string,
  ) {
    return this.servicesService.toggleServiceStatus(salonId, serviceId);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Delete(':id')
  async deleteService(
    @CurrentSalonId() salonId: string,
    @Param('id') serviceId: string,
  ) {
    return this.servicesService.deleteService(salonId, serviceId);
  }
}
