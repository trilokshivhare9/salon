import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
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
import { StaffBreaksService } from '../services/staff-breaks.service';
import { CreateStaffBreakDto } from '../dto/create-staff-break.dto';
import { UpdateStaffBreakDto } from '../dto/update-staff-break.dto';
import { UpdateRoutineBreakDto, DeleteRoutineBreakDto } from '../dto/routine-break.dto';
import { InheritSalonBreakDto } from '../dto/inherit-salon-break.dto';

@ApiTags('Staff Specialist Breaks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('staff/:id/breaks')
export class StaffBreaksController {
  constructor(private readonly staffBreaksService: StaffBreaksService) {}

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Get()
  @ApiOperation({ summary: 'Get all breaks for a stylist (custom overrides + inherited salon breaks)' })
  async getStaffBreaks(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
  ) {
    return this.staffBreaksService.getStaffBreaks(salonId, staffId);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Post('inherit')
  @ApiOperation({ summary: 'Inherit an available salon facility break for a specialist' })
  async inheritSalonBreak(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Body() dto: InheritSalonBreakDto,
  ) {
    return this.staffBreaksService.inheritSalonBreak(salonId, staffId, dto);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Post()
  @ApiOperation({ summary: 'Add customized break(s) for a stylist across one or multiple days' })
  async createStaffBreak(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Body() dto: CreateStaffBreakDto,
  ) {
    return this.staffBreaksService.createStaffBreak(salonId, staffId, dto);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Put('routine')
  @ApiOperation({ summary: 'Update a stylist routine break pattern across its active days' })
  async updateStaffRoutineBreak(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Body() dto: UpdateRoutineBreakDto,
  ) {
    return this.staffBreaksService.updateStaffRoutineBreak(salonId, staffId, dto);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Delete('routine')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a stylist routine break pattern across matching days' })
  async deleteStaffRoutineBreak(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Body() dto: DeleteRoutineBreakDto,
  ) {
    return this.staffBreaksService.deleteStaffRoutineBreak(salonId, staffId, dto);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Post(':breakId/reset')
  @ApiOperation({ summary: 'Reset a customized stylist break back to the salon facility default' })
  async resetStaffBreak(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Param('breakId') breakId: string,
  ) {
    return this.staffBreaksService.resetStaffBreak(salonId, staffId, breakId);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Put(':breakId')
  @ApiOperation({ summary: 'Update an individual customized break for a stylist' })
  async updateStaffBreak(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Param('breakId') breakId: string,
    @Body() dto: UpdateStaffBreakDto,
  ) {
    return this.staffBreaksService.updateStaffBreak(salonId, staffId, breakId, dto);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Delete(':breakId')
  @ApiOperation({ summary: 'Delete an individual customized break for a stylist' })
  async deleteStaffBreak(
    @CurrentSalonId() salonId: string,
    @Param('id') staffId: string,
    @Param('breakId') breakId: string,
  ) {
    return this.staffBreaksService.deleteStaffBreak(salonId, staffId, breakId);
  }
}
