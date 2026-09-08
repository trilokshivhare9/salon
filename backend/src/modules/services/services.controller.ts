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
import { CreateServiceCategoryDto, UpdateServiceCategoryDto } from './dto/create-service-category.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentSalonId } from '../../common/decorators/tenant.decorator';
import { AdminRole } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('services')
export class ServicesController {
  constructor(private readonly servicesService: ServicesService) {}

  @Get('categories')
  async getCategories(@CurrentSalonId() salonId: string) {
    return this.servicesService.getServiceCategories(salonId);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Post('categories')
  async createCategory(
    @CurrentSalonId() salonId: string,
    @Body() dto: CreateServiceCategoryDto,
  ) {
    return this.servicesService.createServiceCategory(salonId, dto.name, dto.icon, dto.sortOrder);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Patch('categories/:id')
  async updateCategory(
    @CurrentSalonId() salonId: string,
    @Param('id') categoryId: string,
    @Body() dto: UpdateServiceCategoryDto,
  ) {
    return this.servicesService.updateServiceCategory(salonId, categoryId, dto.name, dto.icon, dto.sortOrder);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Delete('categories/:id')
  async deleteCategory(
    @CurrentSalonId() salonId: string,
    @Param('id') categoryId: string,
  ) {
    return this.servicesService.deleteServiceCategory(salonId, categoryId);
  }

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

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Post()
  async createService(
    @CurrentSalonId() salonId: string,
    @Body() dto: CreateServiceDto,
  ) {
    return this.servicesService.createService(salonId, dto);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Put(':id')
  async updateService(
    @CurrentSalonId() salonId: string,
    @Param('id') serviceId: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.servicesService.updateService(salonId, serviceId, dto);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Patch(':id/toggle-status')
  async toggleServiceStatus(
    @CurrentSalonId() salonId: string,
    @Param('id') serviceId: string,
  ) {
    return this.servicesService.toggleServiceStatus(salonId, serviceId);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Delete(':id')
  async deleteService(
    @CurrentSalonId() salonId: string,
    @Param('id') serviceId: string,
  ) {
    return this.servicesService.deleteService(salonId, serviceId);
  }
}
