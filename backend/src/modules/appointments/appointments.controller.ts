import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Sse,
  MessageEvent,
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
import { Public } from '../../common/decorators/public.decorator';
import { AppointmentStatus, AdminRole } from '@prisma/client';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { RemindersService } from './reminders.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('appointments')
export class AppointmentsController {
  constructor(
    private readonly appointmentsService: AppointmentsService,
    private readonly remindersService: RemindersService,
  ) { }

  @Public()
  @Post('reminders/tick')
  async triggerReminderTick() {
    return this.remindersService.processReminders();
  }

  @Public()
  @Get('sse')
  sse(
    @CurrentSalonId() salonId: string,
    @Query('salonId') querySalonId?: string,
  ): Observable<MessageEvent> {
    const effectiveSalonId = salonId || querySalonId;
    return this.appointmentsService.getSalonEvents(effectiveSalonId).pipe(
      map((event) => ({
        data: event,
      })),
    );
  }

  @Get()
  async getAppointments(
    @CurrentSalonId() salonId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('date') date?: string,
    @Query('staffId') staffId?: string,
    @Query('stylistId') stylistId?: string,
    @Query('status') status?: AppointmentStatus,
    @Query('customerId') customerId?: string,
  ) {
    return this.appointmentsService.getAppointments(salonId, {
      startDate: startDate || date,
      endDate: endDate || date,
      staffId: staffId || stylistId,
      stylistId: stylistId || staffId,
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
    const adminId = (user?.role === AdminRole.SALON_OWNER || user?.role === AdminRole.SUPER_ADMIN)
      ? user.id
      : undefined;
    return this.appointmentsService.updateStatus(salonId, appointmentId, dto, adminId);
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

  @Patch(':id/propose-reschedule')
  async proposeAdminReschedule(
    @CurrentSalonId() salonId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') appointmentId: string,
    @Body('newStartAt') newStartAt: string,
    @Body('newEndAt') newEndAt: string,
  ) {
    return this.appointmentsService.proposeAdminReschedule(
      salonId,
      appointmentId,
      new Date(newStartAt),
      new Date(newEndAt),
      user.id,
    );
  }
}
