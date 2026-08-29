import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentSalonId } from '../../common/decorators/tenant.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('dashboard')
  async getDashboardSummary(
    @CurrentSalonId() salonId: string,
    @Query('date') date?: string,
  ) {
    return this.reportsService.getDashboardSummary(salonId, date);
  }
}
