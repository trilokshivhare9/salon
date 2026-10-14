import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
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
import { SalonBreaksService } from '../services/salon-breaks.service';
import { CreateFacilityBreakDto } from '../dto/create-facility-break.dto';
import { UpdateFacilityBreakDto } from '../dto/update-facility-break.dto';
import { UpdateRoutineBreakDto, DeleteRoutineBreakDto } from '../dto/routine-break.dto';

@ApiTags('Salon Facility Breaks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('salons/breaks')
export class SalonBreaksController {
  constructor(private readonly salonBreaksService: SalonBreaksService) {}

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Get()
  @ApiOperation({ summary: 'Get all salon facility breaks with routine groups and byDay mapping' })
  async getSalonBreaks(
    @CurrentSalonId() salonId: string,
    @Query('dayOfWeek') dayOfWeek?: DayOfWeek,
  ) {
    return this.salonBreaksService.getSalonBreaks(salonId, dayOfWeek);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Post()
  @ApiOperation({ summary: 'Create a salon facility break (supports multiple days or single day)' })
  async createFacilityBreak(
    @CurrentSalonId() salonId: string,
    @Body() dto: CreateFacilityBreakDto,
  ) {
    return this.salonBreaksService.createFacilityBreak(salonId, dto);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Put('routine')
  @ApiOperation({ summary: 'Update a routine facility break pattern across its active days' })
  async updateRoutineBreak(
    @CurrentSalonId() salonId: string,
    @Body() dto: UpdateRoutineBreakDto,
  ) {
    return this.salonBreaksService.updateRoutineBreak(salonId, dto);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Delete('routine')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a routine facility break pattern across matching days' })
  async deleteRoutineBreak(
    @CurrentSalonId() salonId: string,
    @Body() dto: DeleteRoutineBreakDto,
  ) {
    return this.salonBreaksService.deleteRoutineBreak(salonId, dto);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Put(':id')
  @ApiOperation({ summary: 'Update a single salon facility break by ID' })
  async updateFacilityBreak(
    @CurrentSalonId() salonId: string,
    @Param('id') breakId: string,
    @Body() dto: UpdateFacilityBreakDto,
  ) {
    return this.salonBreaksService.updateFacilityBreak(salonId, breakId, dto);
  }

  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Delete(':id')
  @ApiOperation({ summary: 'Delete a single salon facility break by ID' })
  async deleteFacilityBreak(
    @CurrentSalonId() salonId: string,
    @Param('id') breakId: string,
  ) {
    return this.salonBreaksService.deleteFacilityBreak(salonId, breakId);
  }
}
