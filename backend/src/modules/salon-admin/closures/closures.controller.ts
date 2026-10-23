import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { AdminRole } from '@prisma/client';
import { CurrentSalonId } from '../../../common/decorators/tenant.decorator';
import { ClosuresService } from './closures.service';
import { CreateClosureDto, GetCalendarScheduleDto } from './dto';

@Controller('salons/closures')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ClosuresController {
  constructor(private readonly closuresService: ClosuresService) {}

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Get('calendar-schedule')
  async getCalendarSchedule(
    @CurrentSalonId() salonId: string,
    @Query() query: GetCalendarScheduleDto,
  ) {
    return this.closuresService.getCalendarSchedule(salonId, query);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Get('holidays')
  async getHolidays(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    return this.closuresService.getHolidays({
      startDate,
      endDate,
      year: year ? parseInt(year, 10) : undefined,
      month: month ? parseInt(month, 10) : undefined,
    });
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Get()
  async getClosures(@CurrentSalonId() salonId: string) {
    return this.closuresService.getClosures(salonId);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Post()
  async createClosure(
    @CurrentSalonId() salonId: string,
    @Request() req: any,
    @Body() dto: CreateClosureDto,
  ) {
    const adminId = req.user?.id || req.user?.sub;
    return this.closuresService.createClosure(salonId, dto, adminId);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Delete(':id')
  async deleteClosure(
    @CurrentSalonId() salonId: string,
    @Param('id') closureId: string,
  ) {
    return this.closuresService.deleteClosure(salonId, closureId);
  }
}
