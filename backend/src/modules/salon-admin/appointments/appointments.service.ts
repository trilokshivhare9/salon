import {
  Injectable,
  Logger,
  NotFoundException,
  Inject,
  forwardRef,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { AppointmentEventsService, SalonRealtimeEvent } from './events/appointment-events.service';
import { CancellationService } from './cancellation/cancellation.service';
import { RescheduleService } from './reschedule/reschedule.service';
import { AppointmentCreationService } from './creation/appointment-creation.service';
import { AppointmentStatusService } from './status/appointment-status.service';
import { AppointmentAddonService } from './addons/appointment-addon.service';
import { AvailabilityService } from '../availability/availability.service';
import { AvailabilityEngineService } from '../availability/availability-engine.service';
import { RemindersService } from './reminders/reminders.service';
import { WhatsAppService } from '../../channels/whatsapp/whatsapp.service';
import { QuickBookingService } from '../quick-booking/quick-booking.service';
import {
  CreateAppointmentDto,
  UpdateAppointmentStatusDto,
  RescheduleAppointmentDto,
  CancelBookingContext,
  CancelBookingResult,
} from './dto/create-appointment.dto';
import {
  ScheduleConflictResolutionEngine,
  ScheduleConflictQuery,
  ConflictResolutionResult,
} from './conflicts/schedule-conflict-resolution.engine';
import { AppointmentStatus, BookingSource, ClientEtaStatus } from '@prisma/client';
import { Observable } from 'rxjs';
import {
  appointmentInclude,
  formatAppointment,
  hashToSignedInt32,
  sanitizePhone,
  VALID_STATUS_TRANSITIONS,
} from './utils/appointment-helpers';

import { AppointmentModifierService } from './modifier/appointment-modifier.service';

export { VALID_STATUS_TRANSITIONS };

export interface InternalCreateAppointmentOptions {
  initialStatus?: AppointmentStatus;
}

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private prisma: PrismaService,
    @Optional() private availabilityService?: AvailabilityService,
    @Optional() private engine?: AvailabilityEngineService,
    @Optional() private eventsService?: AppointmentEventsService,
    @Inject(forwardRef(() => CancellationService))
    @Optional() public cancellationService?: CancellationService,
    @Inject(forwardRef(() => RescheduleService))
    @Optional() public rescheduleService?: RescheduleService,
    @Optional() private creationService?: AppointmentCreationService,
    @Optional() private statusService?: AppointmentStatusService,
    @Inject(forwardRef(() => AppointmentModifierService))
    @Optional() private modifierService?: AppointmentModifierService,
    @Optional() private addonService?: AppointmentAddonService,
    @Inject(forwardRef(() => RemindersService))
    @Optional() private remindersService?: RemindersService,
    @Inject(forwardRef(() => QuickBookingService))
    @Optional() private quickBookingService?: QuickBookingService,
    @Inject(forwardRef(() => WhatsAppService))
    @Optional() private whatsappService?: WhatsAppService,
    @Inject(forwardRef(() => ScheduleConflictResolutionEngine))
    @Optional() private conflictEngine?: ScheduleConflictResolutionEngine,
  ) {
    this.ensureInitializedServices();
  }

  private ensureInitializedServices() {
    if (!this.eventsService) {
      this.eventsService = new AppointmentEventsService();
    }
    if (!this.engine) {
      this.engine = new AvailabilityEngineService();
    }
  }

  private getCreationService(): AppointmentCreationService {
    if (!this.creationService) {
      this.ensureInitializedServices();
      this.creationService = new AppointmentCreationService(
        this.prisma,
        this.availabilityService!,
        this.engine!,
        this.eventsService!,
        this.getModifierService(),
        this.whatsappService,
      );
    }
    return this.creationService;
  }

  private getStatusService(): AppointmentStatusService {
    if (!this.statusService) {
      this.ensureInitializedServices();
      this.statusService = new AppointmentStatusService(
        this.prisma,
        this.getModifierService(),
        this.getCancellationService(),
        this.getQuickBookingService(),
        this.whatsappService,
      );
    }
    return this.statusService;
  }

  public getModifierService(): AppointmentModifierService {
    if (!this.modifierService) {
      this.ensureInitializedServices();
      this.modifierService = new AppointmentModifierService(
        this.prisma,
        undefined,
        this.eventsService,
      );
    }
    return this.modifierService;
  }

  private getAddonService(): AppointmentAddonService {
    if (!this.addonService) {
      this.addonService = new AppointmentAddonService(this.prisma);
    }
    return this.addonService;
  }

  private getCancellationService(): CancellationService {
    if (!this.cancellationService) {
      this.ensureInitializedServices();
      this.cancellationService = new CancellationService(
        this.prisma,
        this.eventsService!,
        this.getModifierService(),
        this.whatsappService,
      );
    }
    return this.cancellationService;
  }

  private getRescheduleService(): RescheduleService {
    if (!this.rescheduleService) {
      this.ensureInitializedServices();
      this.rescheduleService = new RescheduleService(
        this.prisma,
        this.availabilityService!,
        this.engine!,
        this.eventsService!,
        this.getModifierService(),
        this.whatsappService,
      );
    }
    return this.rescheduleService;
  }

  private getQuickBookingService(): QuickBookingService {
    if (!this.quickBookingService) {
      this.ensureInitializedServices();
      this.quickBookingService = new QuickBookingService(
        this.prisma,
        this.availabilityService!,
        this.getCreationService(),
        this.getModifierService(),
        this.getCancellationService(),
        this.whatsappService,
      );
    }
    return this.quickBookingService;
  }

  // ---------------------------------------------------------------------------
  // READ QUERIES (Appointments Retrieval)
  // ---------------------------------------------------------------------------

  async getAppointments(
    salonId: string,
    filters: {
      startDate?: string;
      endDate?: string;
      staffId?: string;
      stylistId?: string;
      status?: AppointmentStatus;
      customerId?: string;
      userId?: string;
    },
  ) {
    const whereClause: any = { salonId };

    if (filters.status) {
      whereClause.status = filters.status;
    }
    const targetStylist = filters.stylistId || filters.staffId;
    if (targetStylist) {
      whereClause.stylistId = targetStylist;
    }
    const targetUser = filters.userId || filters.customerId;
    if (targetUser) {
      whereClause.OR = [
        { salonUserId: targetUser },
        { salonUser: { userId: targetUser } },
      ];
    }
    if (filters.startDate && filters.endDate) {
      whereClause.appointmentDate = {
        gte: new Date(filters.startDate),
        lte: new Date(filters.endDate),
      };
    } else if (filters.startDate) {
      whereClause.appointmentDate = new Date(filters.startDate);
    }

    const appointments = await this.prisma.appointment.findMany({
      where: whereClause,
      include: appointmentInclude,
      orderBy: { startAt: 'asc' },
    });

    return appointments.map((appt) => formatAppointment(appt));
  }

  async getSalonAppointments(salonId: string, dateStr?: string, status?: AppointmentStatus) {
    return this.getAppointments(salonId, { startDate: dateStr, status });
  }

  async getAppointmentById(salonId: string, appointmentId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, salonId },
      include: appointmentInclude,
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found.');
    }

    return formatAppointment(appointment);
  }

  // ---------------------------------------------------------------------------
  // WRITE OPERATIONS (Delegated to specialized domain services)
  // ---------------------------------------------------------------------------

  /**
   * Master Appointment Creation
   */
  async createAppointment(
    salonId: string,
    dto: CreateAppointmentDto,
    createdByAdminId?: string,
    options?: InternalCreateAppointmentOptions,
  ) {
    return this.getCreationService().createAppointment(salonId, dto, createdByAdminId, options);
  }



  /**
   * Status State Machine Transitions
   */
  async updateAppointmentStatus(
    salonId: string,
    appointmentId: string,
    dto: UpdateAppointmentStatusDto,
    adminId?: string,
  ) {
    return this.getStatusService().updateAppointmentStatus(salonId, appointmentId, dto, adminId, this);
  }

  async updateStatus(
    salonId: string,
    appointmentId: string,
    dto: UpdateAppointmentStatusDto,
    adminId?: string,
  ) {
    return this.updateAppointmentStatus(salonId, appointmentId, dto, adminId);
  }

  async updateEtaStatus(salonId: string, appointmentId: string, etaStatus: any) {
    return this.getStatusService().updateEtaStatus(salonId, appointmentId, etaStatus as ClientEtaStatus);
  }

  async proposeAdminReschedule(
    salonId: string,
    appointmentId: string,
    newStartAt: Date,
    newEndAt: Date,
    adminId?: string,
    proposedStylistId?: string,
  ) {
    return this.getStatusService().proposeAdminReschedule(salonId, appointmentId, newStartAt, newEndAt, adminId, proposedStylistId);
  }

  async addServiceToAppointment(salonId: string, appointmentId: string, serviceId: string) {
    return this.getAddonService().addServiceToAppointment(salonId, appointmentId, serviceId);
  }



  async cancelBooking(
    salonId: string,
    appointmentId: string,
    context: CancelBookingContext,
  ): Promise<CancelBookingResult> {
    return this.getCancellationService().cancelBooking(salonId, appointmentId, context);
  }

  async triggerSmartMoveUpBroadcast(freedAppointment: any): Promise<number> {
    return this.getCancellationService().triggerSmartMoveUpBroadcast(freedAppointment);
  }

  async rescheduleAppointment(
    salonId: string,
    appointmentId: string,
    dto: RescheduleAppointmentDto,
    adminId?: string,
  ) {
    return this.getRescheduleService().rescheduleAppointment(salonId, appointmentId, dto, adminId, this);
  }

  async autoDeclineExpiredQuickBookings(salonId: string) {
    return this.getStatusService().autoDeclineExpiredQuickBookings(salonId);
  }

  async autoCompleteElapsedAppointments(salonId?: string): Promise<number> {
    return this.getStatusService().autoCompleteElapsedAppointments(salonId);
  }

  async acceptQuickBooking(
    salonId: string,
    appointmentId: string,
    adminId?: string,
    targetStatus?: AppointmentStatus,
  ) {
    return this.getQuickBookingService().acceptQuickBooking(salonId, appointmentId, adminId, targetStatus);
  }

  async declineQuickBooking(
    salonId: string,
    appointmentId: string,
    adminId?: string,
    reason?: string,
  ) {
    return this.getQuickBookingService().declineQuickBooking(salonId, appointmentId, adminId, reason);
  }

  // ---------------------------------------------------------------------------
  // REAL-TIME EVENT STREAM
  // ---------------------------------------------------------------------------

  getSalonEvents(
    salonId: string,
    lastEventId?: string | number,
    clientId?: string,
  ): Observable<SalonRealtimeEvent> {
    this.ensureInitializedServices();
    return this.eventsService!.getSalonEvents(salonId, lastEventId, clientId);
  }

  emitSalonEvent(
    salonId: string,
    type: SalonRealtimeEvent['type'],
    data: any,
    explicitClientId?: string,
  ) {
    this.ensureInitializedServices();
    this.eventsService!.emitSalonEvent(salonId, type, data, explicitClientId);
  }

  async resolveScheduleConflicts(query: ScheduleConflictQuery): Promise<ConflictResolutionResult> {
    if (!this.conflictEngine) {
      this.conflictEngine = new ScheduleConflictResolutionEngine(
        this.prisma,
        this.availabilityService!,
        this.getStatusService(),
        this.getCancellationService(),
      );
    }
    return this.conflictEngine.resolveScheduleConflicts(query);
  }

  async findConflictingAppointments(query: ScheduleConflictQuery): Promise<any[]> {
    if (!this.conflictEngine) {
      this.conflictEngine = new ScheduleConflictResolutionEngine(
        this.prisma,
        this.availabilityService!,
        this.getStatusService(),
        this.getCancellationService(),
      );
    }
    return this.conflictEngine.findConflictingAppointments(query);
  }

  formatAppointment(appt: any) {
    return formatAppointment(appt);
  }
}
