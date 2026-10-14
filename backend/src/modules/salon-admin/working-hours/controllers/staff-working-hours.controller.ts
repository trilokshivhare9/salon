import {
  Controller,
  Get,
  Put,
  Patch,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminRole, DayOfWeek } from '@prisma/client';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guards/roles.guard';
import { Roles } from '../../../../common/decorators/roles.decorator';
import { CurrentSalonId } from '../../../../common/decorators/tenant.decorator';
import { StaffWorkingHoursService } from '../services/staff-working-hours.service';
import { UpdateStaffWorkingHoursDto } from '../dto/update-staff-working-hours.dto';
import { PatchStaffDayShiftDto } from '../dto/patch-staff-day-shift.dto';

@ApiTags('Staff Specialist Working Hours')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('staff/:id/working-hours')
export class StaffWorkingHoursController {
  constructor(private readonly staffWorkingHoursService: StaffWorkingHoursService) {}

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Get()
  @ApiOperation({
    summary: 'Get all 7 days of staff member working hours, with facility boundary status',
  })
  async getStaffWorkingHours(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
  ) {
    return this.staffWorkingHoursService.getStaffWorkingHours(salonId, staffId);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Put()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update full weekly working hours for staff member with facility boundary validation',
  })
  async updateStaffWorkingHours(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Body() dto: UpdateStaffWorkingHoursDto,
  ) {
    return this.staffWorkingHoursService.updateStaffWorkingHours(salonId, staffId, dto);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Patch(':dayOfWeek')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Update or toggle a single day shift for a staff member',
  })
  async patchStaffDayShift(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Param('dayOfWeek') dayOfWeek: DayOfWeek,
    @Body() dto: PatchStaffDayShiftDto,
  ) {
    return this.staffWorkingHoursService.patchStaffDayShift(
      salonId,
      staffId,
      dayOfWeek,
      dto,
    );
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset staff member working hours to mirror salon facility hours',
  })
  async resetStaffWorkingHours(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
  ) {
    return this.staffWorkingHoursService.resetStaffWorkingHours(salonId, staffId);
  }
}
