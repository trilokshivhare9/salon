import {
  Injectable,
  Logger,
  Inject,
  forwardRef,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../../../database/prisma.service';
import { AvailabilityService, QuickBookingOperatingStatus } from '../availability/availability.service';
import { TimeUtility } from '../../../common/utils/time.utility';
import { QUICK_BOOKING_POLICY } from '../../../common/constants/booking-policy.constants';
import { AppointmentStatus, BookingSource, CancelledBy } from '@prisma/client';
import { AppointmentCreationService } from '../appointments/creation/appointment-creation.service';
import { AppointmentModifierService } from '../appointments/modifier/appointment-modifier.service';
import { CancellationService } from '../appointments/cancellation/cancellation.service';
import { WhatsAppService } from '../../channels/whatsapp/whatsapp.service';
import { WhatsAppTemplateService } from '../../channels/whatsapp/services/whatsapp-template.service';

export interface NextAvailableQuickSlotResult {
  isAvailable: boolean;
  dateStr?: string;
  dateIso?: Date;
  startTime?: string;
  startDt?: Date;
  displayTime?: string;
  assignedStylistId?: string | null;
  stylistName?: string;
  stylist?: any;
  eligibleStaffIds?: string[];
  reason?: string;
  leadTimeMinutes?: number;
  isImmediateWindow?: boolean;
}

export interface ConfirmQuickBookingDto {
  customerPhone: string;
  customerName?: string;
  serviceId: string;
  stylistId?: string;
  dateStr?: string;
  startTime?: string;
  notes?: string;
  source?: BookingSource;
}

export interface ConfirmQuickBookingResult {
  success: boolean;
  appointment?: any;
  slotRefreshed?: boolean;
  refreshedSlot?: NextAvailableQuickSlotResult;
  error?: string;
}

@Injectable()
export class QuickBookingService {
  private readonly logger = new Logger(QuickBookingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly availabilityService: AvailabilityService,
    @Inject(forwardRef(() => AppointmentCreationService))
    private readonly appointmentCreationService: AppointmentCreationService,
    @Inject(forwardRef(() => AppointmentModifierService))
    @Optional() private readonly modifierService?: AppointmentModifierService,
    @Inject(forwardRef(() => CancellationService))
    @Optional() private readonly cancellationService?: CancellationService,
    @Inject(forwardRef(() => WhatsAppService))
    @Optional() private readonly whatsappService?: WhatsAppService,
    @Inject(forwardRef(() => WhatsAppTemplateService))
    @Optional() private readonly templates?: WhatsAppTemplateService,
  ) {}

  /**
   * Evaluates if Quick Booking can be fulfilled right now for the salon.
   */
  async getOperatingStatus(
    salonId: string,
    tzOverride?: string,
  ): Promise<QuickBookingOperatingStatus> {
    return this.availabilityService.getQuickBookingOperatingStatus(salonId, tzOverride);
  }

  /**
   * Core Quick Booking Slot & Specialist Resolution:
   * 1. Priority #1: Earliest available free time today.
   * 2. Priority #2: Load balance across all qualified free stylists at that time,
   *    ensuring concurrent users are assigned to DIFFERENT free stylists.
   */
  async findNextAvailableSlot(
    salonId: string,
    serviceIdOrIds: string | string[],
    preferredStylistId?: string | null,
    tzOverride?: string,
  ): Promise<NextAvailableQuickSlotResult> {
    this.logger.log(
      `[QuickBookingService] Finding next available slot for salon=${salonId} service=${JSON.stringify(serviceIdOrIds)} preferred=${preferredStylistId || 'any'}`,
    );

    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      include: {
        stylists: { where: { status: 'ACTIVE' } },
      },
    });

    const tz = tzOverride || salon?.timezone || TimeUtility.DEFAULT_TIMEZONE;

    // 1. Verify operating status
    const operatingStatus = await this.getOperatingStatus(salonId, tz);
    if (!operatingStatus.isOpen) {
      return {
        isAvailable: false,
        reason: operatingStatus.reason || 'SALON_CLOSED_TODAY',
      };
    }

    const todayStr = TimeUtility.getTodayDate(tz);

    // 2. Query available slots for today from AvailabilityService
    const avail = await this.availabilityService.getAvailableSlots(
      salonId,
      serviceIdOrIds,
      todayStr,
      preferredStylistId || undefined,
    );

    if (!avail.availableSlots || avail.availableSlots.length === 0) {
      return {
        isAvailable: false,
        reason: 'NO_SLOTS_AVAILABLE_TODAY',
      };
    }

    const serviceDurationMinutes = avail.serviceDurationMinutes || 30;

    // 3. Fetch all active PENDING_ACCEPTANCE quick bookings for today
    // This allows us to detect which stylists already have pending walk-in requests
    const pendingAppointments = await this.prisma.appointment.findMany({
      where: {
        salonId,
        appointmentDate: TimeUtility.toDbDate(todayStr),
        status: AppointmentStatus.PENDING_ACCEPTANCE,
      },
      select: {
        id: true,
        stylistId: true,
        startAt: true,
        endAt: true,
      },
    });

    // 4. Scan candidate slots with priority on earliest time + 0-pending stylist load balancing
    let selectedSlot = avail.availableSlots[0];
    let selectedStylistId: string | null = null;
    let foundZeroPendingSlot = false;

    for (const slot of avail.availableSlots) {
      const slotStartDt = TimeUtility.toTimestamp(todayStr, slot.startTime, tz);
      const slotEndDt = new Date(slotStartDt.getTime() + serviceDurationMinutes * 60000);

      // Rank eligible stylists for this slot by number of pending overlapping requests (ascending)
      const stylistRanks = (slot.eligibleStaffIds || []).map((sId) => {
        const pendingCount = pendingAppointments.filter(
          (p) => p.stylistId === sId && p.startAt < slotEndDt && p.endAt > slotStartDt,
        ).length;
        return { stylistId: sId, pendingCount };
      });

      // Sort: 0-pending stylists come first
      stylistRanks.sort((a, b) => a.pendingCount - b.pendingCount);

      if (stylistRanks.length > 0 && stylistRanks[0].pendingCount === 0) {
        // Found a slot with a completely free stylist who has 0 pending requests!
        selectedSlot = slot;
        selectedStylistId = stylistRanks[0].stylistId;
        foundZeroPendingSlot = true;
        break;
      }
    }

    // Fallback: If all upcoming slots have at least 1 pending request on every stylist,
    // take the earliest slot and pick the stylist with the lowest pending queue
    if (!foundZeroPendingSlot && avail.availableSlots.length > 0) {
      selectedSlot = avail.availableSlots[0];
      const slotStartDt = TimeUtility.toTimestamp(todayStr, selectedSlot.startTime, tz);
      const slotEndDt = new Date(slotStartDt.getTime() + serviceDurationMinutes * 60000);

      const stylistRanks = (selectedSlot.eligibleStaffIds || []).map((sId) => {
        const pendingCount = pendingAppointments.filter(
          (p) => p.stylistId === sId && p.startAt < slotEndDt && p.endAt > slotStartDt,
        ).length;
        return { stylistId: sId, pendingCount };
      });
      stylistRanks.sort((a, b) => a.pendingCount - b.pendingCount);
      selectedStylistId = stylistRanks.length > 0 ? stylistRanks[0].stylistId : null;
    }

    const stylist = selectedStylistId
      ? (salon?.stylists || []).find((s) => s.id === selectedStylistId) || null
      : null;

    const dateIso = TimeUtility.toDbDate(todayStr);
    const startDt = TimeUtility.toTimestamp(todayStr, selectedSlot.startTime, tz);
    const displayTime = TimeUtility.formatTime12h(selectedSlot.startTime);

    const nowDt = TimeUtility.now(tz);
    const slotStartLuxon = DateTime.fromJSDate(startDt, { zone: tz });
    const leadTimeMinutes = Math.max(0, Math.round(slotStartLuxon.diff(nowDt, 'minutes').minutes));
    const isImmediateWindow = leadTimeMinutes <= QUICK_BOOKING_POLICY.IMMEDIATE_WINDOW_MINUTES;

    return {
      isAvailable: true,
      dateStr: todayStr,
      dateIso,
      startTime: selectedSlot.startTime,
      startDt,
      displayTime,
      assignedStylistId: selectedStylistId,
      stylistName: stylist?.name || 'First Available Specialist',
      stylist,
      eligibleStaffIds: selectedSlot.eligibleStaffIds,
      leadTimeMinutes,
      isImmediateWindow,
    };
  }

  /**
   * Confirms and persists a Quick Booking request:
   * 1. Validates that the requested slot is fresh and still open today.
   * 2. If the slot has passed by the clock or is missing, auto-refreshes to the nearest available opening.
   * 3. Uses AppointmentCreationService to safely create the appointment in PENDING_ACCEPTANCE.
   */
  async confirmQuickBooking(
    salonId: string,
    dto: ConfirmQuickBookingDto,
  ): Promise<ConfirmQuickBookingResult> {
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: { timezone: true },
    });
    const tz = salon?.timezone || TimeUtility.DEFAULT_TIMEZONE;
    const todayStr = TimeUtility.getTodayDate(tz);

    let dateStr = dto.dateStr || todayStr;
    let slotTime = dto.startTime;
    let stylistId = dto.stylistId;
    let slotRefreshed = false;
    let refreshedSlot: NextAvailableQuickSlotResult | undefined;

    // Check if slotTime is missing or has passed by clock
    const isPast = slotTime ? TimeUtility.isPastTimeToday(slotTime, tz) : true;

    if (isPast || !slotTime) {
      this.logger.log(
        `[QuickBookingService] Slot ${slotTime || 'none'} is past or missing, auto-refreshing to nearest opening`,
      );
      refreshedSlot = await this.findNextAvailableSlot(salonId, dto.serviceId, stylistId || null, tz);
      if (!refreshedSlot || !refreshedSlot.isAvailable) {
        return {
          success: false,
          error: 'NO_SLOTS_AVAILABLE_TODAY',
        };
      }
      if (!refreshedSlot.isImmediateWindow) {
        return {
          success: false,
          slotRefreshed: true,
          refreshedSlot,
          error: 'NO_IMMEDIATE_SLOT_AVAILABLE',
        };
      }
      slotRefreshed = true;
      dateStr = refreshedSlot.dateStr!;
      slotTime = refreshedSlot.startTime!;
      stylistId = refreshedSlot.assignedStylistId || undefined;
    }

    // If stylistId was not assigned yet, resolve via smart distribution
    if (!stylistId) {
      const nextSlot = await this.findNextAvailableSlot(salonId, dto.serviceId, null, tz);
      if (nextSlot && nextSlot.isAvailable) {
        stylistId = nextSlot.assignedStylistId || undefined;
        if (!slotTime) {
          slotTime = nextSlot.startTime;
          dateStr = nextSlot.dateStr!;
        }
      }
    }

    try {
      const appointment = await this.appointmentCreationService.createAppointment(
        salonId,
        {
          customerPhone: dto.customerPhone,
          customerName: dto.customerName || 'Customer',
          serviceIds: [dto.serviceId],
          stylistId,
          date: dateStr,
          startTime: slotTime!,
          source: dto.source || BookingSource.QUICK_BOOK,
          notes: dto.notes,
        },
        undefined,
        { initialStatus: AppointmentStatus.PENDING_ACCEPTANCE },
      );

      return {
        success: true,
        appointment,
        slotRefreshed,
        refreshedSlot,
      };
    } catch (err: any) {
      this.logger.warn(`[QuickBookingService] Conflict creating quick booking: ${err?.message}`);
      if (
        err?.status === 409 ||
        err?.name === 'ConflictException' ||
        err?.message?.includes('no longer available')
      ) {
        const freshSlot = await this.findNextAvailableSlot(salonId, dto.serviceId, null, tz);
        return {
          success: false,
          slotRefreshed: true,
          refreshedSlot: freshSlot,
          error: 'SLOT_TAKEN_OR_EXPIRED',
        };
      }
      throw err;
    }
  }

  /**
   * Dedicated Quick Booking Action: Salon Owner / Receptionist accepts a Quick Booking request.
   * 1. Validates the appointment exists and is in PENDING_ACCEPTANCE.
   * 2. Modifies appointment status to targetStatus (default: CHECKED_IN).
   * 3. Dispatches "QUICK BOOKING ACCEPTED" WhatsApp message to customer.
   * 4. Auto-cancels colliding PENDING_ACCEPTANCE requests for the SAME stylist.
   */
  async acceptQuickBooking(
    salonId: string,
    appointmentId: string,
    adminId?: string,
    targetStatus: AppointmentStatus = AppointmentStatus.CHECKED_IN,
  ) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, salonId },
      include: {
        salon: { include: { whatsappAccount: true } },
        salonUser: { include: { user: true } },
        stylist: true,
        service: true,
      },
    });

    if (!appointment) {
      throw new NotFoundException('Quick booking request not found.');
    }

    if (appointment.status !== AppointmentStatus.PENDING_ACCEPTANCE) {
      throw new BadRequestException(
        `Cannot accept appointment: current status is ${appointment.status} (expected PENDING_ACCEPTANCE).`,
      );
    }

    // Guard against concurrent double-booking: verify stylist is not already occupied in this slot
    if (appointment.stylistId) {
      const activeConflict = await this.prisma.appointment.findFirst({
        where: {
          salonId,
          stylistId: appointment.stylistId,
          id: { not: appointmentId },
          status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.SEATED_IN_CHAIR] },
          startAt: { lt: appointment.endAt },
          endAt: { gt: appointment.startAt },
        },
        select: { id: true, appointmentNumber: true, status: true },
      });

      if (activeConflict) {
        throw new ConflictException(
          `Cannot accept: Assigned specialist already has an active ${activeConflict.status.replace(/_/g, ' ')} appointment during this time window.`,
        );
      }
    }

    // 1. Mutate status via AppointmentModifierService (or fallback to Prisma)
    const updated = this.modifierService
      ? await this.modifierService.modifyStatus(salonId, appointmentId, {
          status: targetStatus,
          adminId,
          notes: `${appointment.notes || ''} [Quick Booking Accepted by salon receptionist]`.trim(),
          skipTransitionValidation: true,
          existingAppointment: appointment,
        })
      : await this.prisma.appointment.update({
          where: { id: appointmentId },
          data: { status: targetStatus },
        });

    // 2. Auto-cancel colliding requests synchronously so database & queue are immediately consistent
    if (updated.stylistId && this.cancellationService) {
      try {
        const competing = await this.prisma.appointment.findMany({
          where: {
            salonId,
            stylistId: updated.stylistId,
            status: AppointmentStatus.PENDING_ACCEPTANCE,
            id: { not: updated.id },
            startAt: { lt: updated.endAt },
            endAt: { gt: updated.startAt },
          },
        });

        for (const comp of competing) {
          await this.cancellationService.cancelBooking(salonId, comp.id, {
            source: 'SYSTEM_CAPACITY_CONFLICT',
            fault: 'SYSTEM',
            cancelledBy: CancelledBy.SYSTEM,
            noPenalty: true,
            reason: 'Stylist slot accepted for another customer',
          }).catch((err) =>
            this.logger.warn(`Failed cancelling competing appointment ${comp.id}: ${err?.message}`),
          );
        }
      } catch (err: any) {
        this.logger.error(`[acceptQuickBooking] Error cancelling competing requests: ${err?.message || err}`);
      }
    }

    // 3. Dispatch WhatsApp Notification asynchronously
    setImmediate(async () => {
      try {
        const salon = appointment.salon;
        const userPhone = appointment.salonUser?.user?.phone;
        const tz = salon?.timezone || TimeUtility.DEFAULT_TIMEZONE;

        if (salon?.whatsappAccount?.phoneNumberId && userPhone && this.whatsappService) {
          const templates = this.templates || new WhatsAppTemplateService();
          const acceptMsg = templates.buildQuickBookAcceptedReply(updated, tz, salon);
          await this.whatsappService.sendMetaMessage(
            userPhone,
            acceptMsg,
            salon.whatsappAccount.phoneNumberId,
            salonId,
          ).catch((err) => {
            this.logger.error(`Failed to send WhatsApp acceptance message: ${err?.message || err}`);
          });
        }
      } catch (err: any) {
        this.logger.error(`[acceptQuickBooking] WhatsApp dispatch error: ${err?.message || err}`);
      }
    });

    return updated;
  }

  /**
   * Dedicated Quick Booking Action: Salon Owner / Receptionist declines a Quick Booking request.
   * Routes cleanly through CancellationService with SALON_REJECTED context.
   */
  async declineQuickBooking(
    salonId: string,
    appointmentId: string,
    adminId?: string,
    reason?: string,
  ) {
    if (!this.cancellationService) {
      throw new Error('CancellationService is not available in QuickBookingService.');
    }
    return this.cancellationService.cancelBooking(salonId, appointmentId, {
      source: 'SALON_REJECTED',
      fault: 'SALON',
      reason: reason || 'Declined by salon receptionist',
      reasonCategory: 'SALON_REJECTED',
      cancelledBy: CancelledBy.SALON,
      noPenalty: true,
      adminId,
    });
  }
}


