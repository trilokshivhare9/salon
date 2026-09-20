import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { QuickCodeService } from './quick-code.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('salons/:salonId/quick-code')
export class QuickBookingController {
  constructor(private readonly quickCodeService: QuickCodeService) {}

  @Get()
  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  async getQuickCode(@Param('salonId') salonId: string) {
    const codeRecord = await this.quickCodeService.getOrCreateTodayCode(salonId);
    return {
      code: codeRecord.code,
      validDate: codeRecord.validDate,
      updatedAt: codeRecord.updatedAt,
    };
  }

  @Post('generate')
  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  async regenerateQuickCode(@Param('salonId') salonId: string) {
    const codeRecord = await this.quickCodeService.forceRegenerateCode(salonId);
    return {
      code: codeRecord.code,
      validDate: codeRecord.validDate,
      updatedAt: codeRecord.updatedAt,
    };
  }
}
