import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import {
  CreateAppointmentDto,
  UpdateAppointmentStatusDto,
  RescheduleAppointmentDto,
} from './dto/create-appointment.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentSalonId } from '../../common/decorators/tenant.decorator';
import { CurrentUser, AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { AppointmentStatus } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Get()
  async getAppointments(
    @CurrentSalonId() salonId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('staffId') staffId?: string,
    @Query('status') status?: AppointmentStatus,
    @Query('customerId') customerId?: string,
  ) {
    return this.appointmentsService.getAppointments(salonId, {
      startDate,
      endDate,
      staffId,
      status,
      customerId,
    });
  }

  @Get(':id')
  async getAppointmentById(
    @CurrentSalonId() salonId: string,
    @Param('id') appointmentId: string,
  ) {
    return this.appointmentsService.getAppointmentById(salonId, appointmentId);
  }

  @Post()
  async createAppointment(
    @CurrentSalonId() salonId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateAppointmentDto,
  ) {
    return this.appointmentsService.createAppointment(salonId, dto, user.id);
  }

  @Patch(':id/status')
  async updateStatus(
    @CurrentSalonId() salonId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') appointmentId: string,
    @Body() dto: UpdateAppointmentStatusDto,
  ) {
    return this.appointmentsService.updateStatus(salonId, appointmentId, dto, user.id);
  }

  @Post(':id/reschedule')
  async rescheduleAppointment(
    @CurrentSalonId() salonId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') appointmentId: string,
    @Body() dto: RescheduleAppointmentDto,
  ) {
    return this.appointmentsService.rescheduleAppointment(
      salonId,
      appointmentId,
      dto,
      user.id,
    );
  }
}
