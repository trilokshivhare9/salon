import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { StaffService } from './staff.service';
import { StaffLeaveFacade } from './leave/staff-leave.facade';
import {
  CreateStaffDto,
  UpdateStaffDto,
  AssignStaffServicesDto,
  UpdateStaffWorkingHoursDto,
  CreateStaffBreakDto,
} from './dto/create-staff.dto';
import {
  ApplyLeaveDto,
  MarkAbsentDto,
  PreviewLeaveQueryDto,
  PreviewAbsenceQueryDto,
  LeaveHistoryQueryDto,
  GetAbsencesQueryDto,
  ExtendLeaveDto,
} from './leave/dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentSalonId } from '../../../common/decorators/tenant.decorator';
import { CurrentUser, AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { AdminRole } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('staff')
export class StaffController {
  constructor(
    private readonly staffService: StaffService,
    private readonly leaveFacade: StaffLeaveFacade,
  ) {}

  @Get()
  async getStaff(
    @CurrentSalonId() salonId: string,
    @Query('date') dateStr?: string,
  ) {
    return this.staffService.getSalonStaff(salonId, dateStr);
  }

  @Post()
  async createStaff(
    @CurrentSalonId() salonId: string,
    @Body() dto: CreateStaffDto,
  ) {
    return this.staffService.createStaff(salonId, dto);
  }

  @Get(':id')
  async getStaffById(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
  ) {
    return this.staffService.getStaffById(salonId, staffId);
  }

  @Put(':id')
  async updateStaff(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.staffService.updateStaff(salonId, staffId, dto);
  }

  @Put(':id/services')
  async assignServices(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Body() dto: AssignStaffServicesDto,
  ) {
    return this.staffService.assignServices(salonId, staffId, dto);
  }

  @Put(':id/working-hours')
  async updateWorkingHours(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Body() dto: UpdateStaffWorkingHoursDto,
  ) {
    return this.staffService.updateWorkingHours(salonId, staffId, dto);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Delete(':id')
  async deleteStaff(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
  ) {
    return this.staffService.deleteStaff(salonId, staffId);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Get(':id/breaks')
  async getStaffBreaks(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
  ) {
    return this.staffService.getStaffBreaks(salonId, staffId);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Post(':id/breaks')
  async createStaffBreak(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Body() dto: CreateStaffBreakDto,
  ) {
    return this.staffService.createStaffBreak(salonId, staffId, dto);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Delete(':id/breaks/:breakId')
  async deleteStaffBreak(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Param('breakId') breakId: string,
  ) {
    return this.staffService.deleteStaffBreak(salonId, staffId, breakId);
  }

  // ---------------------------------------------------------------------------
  // Staff Leave Management (Semantic Routes & Backward-Compatible Aliases)
  // ---------------------------------------------------------------------------

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Post(':id/leaves')
  async applyLeaveSemantic(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Body() dto: ApplyLeaveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leaveFacade.applyLeave(salonId, staffId, dto, user?.id);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Post(':id/absence')
  async markAbsent(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Body() dto: MarkAbsentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leaveFacade.applyLeave(salonId, staffId, dto, user?.id);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Get(':id/leaves/preview')
  async previewLeaveSemantic(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Query() query: PreviewLeaveQueryDto,
  ) {
    return this.leaveFacade.previewLeave(salonId, staffId, query);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Get(':id/absence/preview')
  async previewAbsence(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Query() query: PreviewAbsenceQueryDto,
  ) {
    return this.leaveFacade.previewLeave(salonId, staffId, query);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Patch(':id/leaves/:leaveId/extend')
  async extendLeaveSemantic(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Param('leaveId') leaveId: string,
    @Body() dto: ExtendLeaveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leaveFacade.extendLeave(salonId, staffId, leaveId, dto, user?.id);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Patch(':id/absence/:absenceId/extend')
  async extendLeave(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Param('absenceId') absenceId: string,
    @Body() dto: ExtendLeaveDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leaveFacade.extendLeave(salonId, staffId, absenceId, dto, user?.id);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Get(':id/leaves')
  async getLeavesSemantic(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Query() query: LeaveHistoryQueryDto,
  ) {
    return this.leaveFacade.getLeaveHistory(salonId, staffId, query);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Get(':id/absences')
  async getAbsences(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Query() query: GetAbsencesQueryDto,
  ) {
    return this.leaveFacade.getLeaveHistory(salonId, staffId, query);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Delete(':id/leaves/:leaveId')
  async cancelLeaveSemantic(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Param('leaveId') leaveId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leaveFacade.cancelLeave(salonId, staffId, leaveId, user?.id);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Delete(':id/absence/:absenceId')
  async cancelAbsence(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Param('absenceId') absenceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.leaveFacade.cancelLeave(salonId, staffId, absenceId, user?.id);
  }
}
