import {
  Controller,
  Get,
  Put,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentSalonId } from '../../../common/decorators/tenant.decorator';
import { AdminRole } from '@prisma/client';
import { PersonalProfileService } from './personal-profile.service';
import { UpdatePersonalProfileDto } from './dto/update-personal-profile.dto';

@Controller('salons/personal-profile')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PersonalProfileController {
  constructor(private readonly personalProfileService: PersonalProfileService) {}

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Get()
  async getPersonalProfile(
    @CurrentSalonId() salonId: string,
    @Request() req: any,
  ) {
    const adminId = req.user?.id || req.user?.sub;
    return this.personalProfileService.getPersonalProfile(salonId, adminId);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Put()
  async updatePersonalProfile(
    @CurrentSalonId() salonId: string,
    @Request() req: any,
    @Body() dto: UpdatePersonalProfileDto,
  ) {
    const adminId = req.user?.id || req.user?.sub;
    return this.personalProfileService.updatePersonalProfile(salonId, adminId, dto);
  }
}
