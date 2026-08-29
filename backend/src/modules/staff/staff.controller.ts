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
import { StaffService } from './staff.service';
import {
  CreateStaffDto,
  UpdateStaffDto,
  AssignStaffServicesDto,
  UpdateStaffWorkingHoursDto,
  CreateStaffBreakDto,
} from './dto/create-staff.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentSalonId } from '../../common/decorators/tenant.decorator';
import { UserRole } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get()
  async getStaff(@CurrentSalonId() salonId: string) {
    return this.staffService.getSalonStaff(salonId);
  }

  @Get(':id')
  async getStaffById(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
  ) {
    return this.staffService.getStaffById(salonId, staffId);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Post()
  async createStaff(
    @CurrentSalonId() salonId: string,
    @Body() dto: CreateStaffDto,
  ) {
    return this.staffService.createStaff(salonId, dto);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Put(':id')
  async updateStaff(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.staffService.updateStaff(salonId, staffId, dto);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Patch(':id/toggle-status')
  async toggleStaffStatus(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
  ) {
    return this.staffService.toggleStaffStatus(salonId, staffId);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Put(':id/services')
  async assignServices(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Body() dto: AssignStaffServicesDto,
  ) {
    return this.staffService.assignServices(salonId, staffId, dto);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Put(':id/working-hours')
  async updateWorkingHours(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Body() dto: UpdateStaffWorkingHoursDto,
  ) {
    return this.staffService.updateWorkingHours(salonId, staffId, dto);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Post(':id/breaks')
  async addBreak(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Body() dto: CreateStaffBreakDto,
  ) {
    return this.staffService.addBreak(salonId, staffId, dto);
  }

  @Roles(UserRole.SALON_ADMIN)
  @Delete(':id/breaks/:breakId')
  async deleteBreak(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Param('breakId') breakId: string,
  ) {
    return this.staffService.deleteBreak(salonId, staffId, breakId);
  }
}
