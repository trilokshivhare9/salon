import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { WhatsAppService } from '../../../channels/whatsapp/whatsapp.service';
import { AppointmentEventsService } from '../events/appointment-events.service';
import {
  CancelBookingContext,
  CancelBookingResult,
} from '../dto/create-appointment.dto';
import {
  AppointmentStatus,
  BookingSource,
} from '@prisma/client';
import { DateTime } from 'luxon';
import { TimeUtility } from '../../../../common/utils/time.utility';
import {
  VALID_STATUS_TRANSITIONS,
  appointmentInclude,
  formatAppointment,
} from '../utils/appointment-helpers';

@Injectable()
export class CancellationService {
  private readonly logger = new Logger(CancellationService.name);

  constructor(
    private prisma: PrismaService,
    private eventsService: AppointmentEventsService,
    @Inject(forwardRef(() => WhatsAppService))
    private whatsappService: WhatsAppService,
  ) {}

  /**
   * Dedicated Domain Method: Checks if cancelling an appointment right now will trigger a late cancellation penalty strike.
   */
  async checkCancellationPenalty(
    salonId: string,
    appointmentId: string,
  ): Promise<{
    willIncurPenalty: boolean;
    hoursUntil: number;
    cancelWindowHours: number;
    appointment: any;
  }> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        salon: true,
        salonUser: true,
      },
    });

    if (!appointment) {
      throw new NotFoundException(`Appointment ${appointmentId} not found.`);
    }

    const cancelWindowHours = appointment.salon?.cancelWindowHours ?? 2;
    const nowMs = Date.now();
    const apptStartMs = new Date(appointment.startAt).getTime();
    const hoursUntil = (apptStartMs - nowMs) / (1000 * 60 * 60);

    const willIncurPenalty = hoursUntil < cancelWindowHours && hoursUntil > -1 && !!appointment.salonUserId;

    return {
      willIncurPenalty,
      hoursUntil,
      cancelWindowHours,
      appointment: formatAppointment(appointment),
    };
  }

  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * CENTRALIZED CANCEL BOOKING METHOD
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   *
   * Handles:
   * 1. Status determination (CANCELLED vs NO_SHOW) based on context
   * 2. Idempotency check
   * 3. State machine validation
   * 4. Penalty strike calculation (client fault + <2h window)
   * 5. DB status and notes update
   * 6. SSE realtime event emission
   * 7. WhatsApp customer notification (unless skipWhatsAppNotify)
   * 8. Smart Move-Up broadcast trigger (unless skipMoveUp)
   */
  async cancelBooking(
    salonId: string,
    appointmentId: string,
    context: CancelBookingContext,
    appointmentsService?: any,
  ): Promise<CancelBookingResult> {
    const appointment = appointmentsService
      ? await appointmentsService.getAppointmentById(salonId, appointmentId)
      : await this.getAppointmentById(salonId, appointmentId);

    // 1. Determine target status based on source and fault
    const targetStatus = this.determineCancelStatus(context);

    // 2. Idempotency: if already cancelled/no-show, return existing
    const terminalStatuses = [AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW] as string[];
    if (terminalStatuses.includes(appointment.status)) {
      this.logger.warn(
        `[cancelBooking] Appointment ${appointmentId} already in terminal status ${appointment.status}. Idempotent return.`,
      );
      return {
        appointment: formatAppointment(appointment),
        penaltyApplied: false,
        penaltyCount: 0,
        remainingStrikes: 3,
        isBlocked: false,
        status: appointment.status,
      };
    }

    // 3. State machine validation
    const allowedTransitions = VALID_STATUS_TRANSITIONS[appointment.status as AppointmentStatus] || [];
    if (!allowedTransitions.includes(targetStatus)) {
      throw new BadRequestException(
        `Cannot cancel appointment: status transition from ${appointment.status} to ${targetStatus} is not allowed.`,
      );
    }

    // 4. Penalty calculation
    const penaltyResult = await this.calculateCancelPenalty(appointment, context);

    // 5. Update appointment in DB
    const reasonNote = this.buildCancelNote(appointment, context);
    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: targetStatus,
        notes: reasonNote,
      },
      include: appointmentInclude,
    });

    const formatted = formatAppointment(updated);

    // 6. Emit SSE events
    this.eventsService.emitSalonEvent(salonId, 'STATUS_UPDATED', formatted);
    this.eventsService.emitSalonEvent(salonId, 'BOOKING_CANCELLED', formatted);

    // 7. WhatsApp notification (unless caller handles its own)
    if (!context.skipWhatsAppNotify) {
      await this.sendCancelWhatsAppNotification(
        salonId,
        updated,
        context,
        penaltyResult,
      );
    }

    // 8. Smart Move-Up broadcast (only for future appointments, unless skipped)
    const apptStartMs = new Date(appointment.startAt).getTime();
    if (!context.skipMoveUp && apptStartMs > Date.now()) {
      await this.triggerSmartMoveUpBroadcast(formatted).catch((err) => {
        this.logger.warn(`[cancelBooking] Move-up broadcast warning: ${err.message}`);
      });
    }

    this.logger.log(
      `[cancelBooking] Appointment ${appointmentId} cancelled. ` +
      `Source=${context.source}, Fault=${context.fault}, Status=${targetStatus}, ` +
      `Penalty=${penaltyResult.penaltyApplied}, Strikes=${penaltyResult.penaltyCount}`,
    );

    return {
      appointment: formatted,
      ...penaltyResult,
      status: targetStatus,
    };
  }

  /**
   * Determines the final appointment status based on cancellation context.
   * - SYSTEM_AUTO_NOSHOW or CLIENT_UNRESPONSIVE → NO_SHOW
   * - Everything else → CANCELLED
   */
  private determineCancelStatus(context: CancelBookingContext): AppointmentStatus {
    if (context.source === 'SYSTEM_AUTO_NOSHOW' || context.reasonCategory === 'CLIENT_UNRESPONSIVE') {
      return AppointmentStatus.NO_SHOW;
    }
    return AppointmentStatus.CANCELLED;
  }

  /**
   * Calculates whether a penalty strike should be applied.
   * Penalty rules:
   * - Only for CLIENT fault
   * - Only if cancel is within 2 hours of start time (or appointment already started for SYSTEM_AUTO_NOSHOW)
   * - Not for QUICK_BOOK source
   * - Only if salonUserId is linked
   */
  private async calculateCancelPenalty(
    appointment: any,
    context: CancelBookingContext,
  ): Promise<{ penaltyApplied: boolean; penaltyCount: number; remainingStrikes: number; isBlocked: boolean }> {
    if (context.fault !== 'CLIENT') {
      return { penaltyApplied: false, penaltyCount: 0, remainingStrikes: 3, isBlocked: false };
    }

    if (!appointment.salonUserId) {
      return { penaltyApplied: false, penaltyCount: 0, remainingStrikes: 3, isBlocked: false };
    }

    if (appointment.source === BookingSource.QUICK_BOOK) {
      return { penaltyApplied: false, penaltyCount: 0, remainingStrikes: 3, isBlocked: false };
    }

    const nowMs = Date.now();
    const apptStartMs = new Date(appointment.startAt).getTime();
    const hoursRemaining = (apptStartMs - nowMs) / (1000 * 60 * 60);

    if (context.source !== 'SYSTEM_AUTO_NOSHOW' && hoursRemaining >= 2) {
      return { penaltyApplied: false, penaltyCount: 0, remainingStrikes: 3, isBlocked: false };
    }

    const salonUser = await this.prisma.salonUser.findUnique({
      where: { id: appointment.salonUserId },
    });
    const currentCount = salonUser?.yearlyNoShowCount || 0;
    const newCount = currentCount + 1;
    const remainingStrikes = Math.max(0, 3 - newCount);
    const isBlocked = newCount >= 3;

    await this.prisma.salonUser.update({
      where: { id: appointment.salonUserId },
      data: {
        yearlyNoShowCount: newCount,
        lastNoShowDate: new Date(),
        isBookingBlocked: isBlocked,
      },
    });

    return { penaltyApplied: true, penaltyCount: newCount, remainingStrikes, isBlocked };
  }

  /**
   * Builds the cancel note to store in appointment.notes field.
   */
  private buildCancelNote(appointment: any, context: CancelBookingContext): string {
    const existing = appointment.notes || '';
    const sourceLabel = context.source.replace(/_/g, ' ').toLowerCase();
    const note = context.reason
      ? `[${sourceLabel}] ${context.reason}`
      : `[${sourceLabel}]`;
    return `${existing} ${note}`.trim();
  }

  /**
   * Sends the appropriate WhatsApp cancellation notification based on context.
   */
  private async sendCancelWhatsAppNotification(
    salonId: string,
    appointment: any,
    context: CancelBookingContext,
    penalty: { penaltyApplied: boolean; remainingStrikes: number; isBlocked: boolean },
  ): Promise<void> {
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      include: { whatsappAccount: true },
    });
    if (!salon?.whatsappAccount?.phoneNumberId) return;

    const userPhone = appointment.salonUser?.user?.phone;
    if (!userPhone) return;

    const phoneNumberId = salon.whatsappAccount.phoneNumberId;
    const tz = salon.timezone || 'Asia/Kolkata';
    const userName = appointment.salonUser?.user?.name || 'Customer';
    const timeStr = TimeUtility.formatTime12h(appointment.startAt, tz);
    const dateStr = TimeUtility.formatDateFriendly(appointment.startAt, tz);

    let message = '';
    let buttons: { id: string; title: string }[] = [{ id: 'btn_start', title: '🏠 Main Menu' }];

    switch (context.source) {
      case 'SYSTEM_AUTO_NOSHOW':
        if (penalty.isBlocked) {
          message = `⚠️ *ACCOUNT BOOKING LOCKED*\n\nHi *${userName}*, you have accumulated *3 penalty strikes* this year for missed appointments. Automatic slot booking is now locked for your account.\n\n📞 *Please contact the Salon Owner* directly to request access unblock.`;
        } else {
          message = `⚠️ *APPOINTMENT AUTO-CANCELED*\n\nHi *${userName}*, your appointment for *${timeStr}* was auto-canceled because we did not receive an arrival confirmation.\n\n⚠️ *Penalty Strike Recorded:* You have *${penalty.remainingStrikes} strike(s) remaining* this year before automatic slot booking is locked.`;
        }
        break;

      case 'SYSTEM_AUTO_EXPIRED':
        message = `⏳ *QUICK BOOKING EXPIRED*\n\nYour quick booking request for *${timeStr}* at *${salon.name}* was not checked in before the start time and has automatically expired.\n\nPlease speak to the front desk for walk-in availability. 🙏`;
        break;

      case 'SYSTEM_SALON_DEACTIVATION':
        message = `⚠️ *APPOINTMENT CANCELLED*\n\nHi *${userName}*, your appointment for *${dateStr} at ${timeStr}* at *${salon.name}* has been cancelled because the salon account was temporarily deactivated for platform maintenance.\n\nWe apologize for any inconvenience. Please contact the salon directly or visit another location for bookings.`;
        break;

      case 'SYSTEM_STORE_CLOSURE':
      case 'CUSTOMER_ABSENCE':
        message = `🙏 *SALON NOTICE: APPOINTMENT CANCELED*\n\nHi *${userName}*, your appointment for *${timeStr}* at *${salon.name}* was canceled due to a salon emergency.\n\n✨ *No penalty has been applied* to your account. We welcome you to rebook at your convenience!`;
        buttons = [{ id: 'btn_book', title: '📅 Book New Visit' }];
        break;

      case 'ADMIN_DASHBOARD':
        if (context.fault === 'SALON') {
          message = `🙏 *SALON NOTICE: APPOINTMENT CANCELED*\n\nHi *${userName}*, we sincerely apologize! Your appointment for *${timeStr}* at *${salon.name}* was canceled due to a salon emergency.\n\n✨ *No penalty has been applied* to your account. We welcome you to rebook at your convenience!`;
          buttons = [{ id: 'btn_book', title: '📅 Book New Visit' }];
        } else if (penalty.penaltyApplied) {
          if (penalty.isBlocked) {
            message = `⚠️ *ACCOUNT BOOKING LOCKED*\n\nHi *${userName}*, you have accumulated *3 penalty strikes* this year for missed or late-canceled appointments. Automatic slot booking is now locked for your account.\n\n📞 *Please contact the Salon Owner* directly to request access unblock.`;
          } else {
            message = `⚠️ *LATE CANCELLATION / NO-SHOW PENALTY RECORDED*\n\nHi *${userName}*, your appointment for *${timeStr}* at *${salon.name}* was canceled with less than 2 hours remaining.\n\n⚠️ *Penalty Strike Recorded:* You have *1 penalty strike* recorded. You have *${penalty.remainingStrikes} penalty strike(s) remaining* this year before automatic slot booking is locked.`;
          }
        }
        break;

      default:
        return;
    }

    if (!message) return;

    await this.whatsappService.sendMetaMessage(
      userPhone,
      { bodyText: message, interactiveType: 'button', buttons },
      phoneNumberId,
      salonId,
    ).catch(() => {});
  }

  /**
   * Triggers Smart Move-Up broadcast to eligible candidates.
   */
  async triggerSmartMoveUpBroadcast(freedAppointment: any): Promise<number> {
    try {
      const salon: any = await this.prisma.salon.findUnique({
        where: { id: freedAppointment.salonId },
        include: { whatsappAccount: true },
      });

      if (!salon || !salon.isSmartMoveUpEnabled) return 0;

      const freedStartMs = new Date(freedAppointment.startAt).getTime();
      const freedEndMs = new Date(freedAppointment.endAt).getTime();
      const freedDurationMin = Math.round((freedEndMs - freedStartMs) / 60000);
      const freedStylistId = freedAppointment.stylistId;
      const tz = salon.timezone || 'Asia/Kolkata';

      const freedDateStr = TimeUtility.formatDateToISO(freedAppointment.startAt, tz);
      const freedSlotTimeStr = TimeUtility.formatTime12h(freedAppointment.startAt, tz);

      const candidates = await this.prisma.appointment.findMany({
        where: {
          salonId: salon.id,
          appointmentDate: new Date(freedDateStr),
          status: AppointmentStatus.CONFIRMED,
          startAt: { gt: new Date(freedEndMs) },
          ...(freedStylistId ? { stylistId: freedStylistId } : {}),
        },
        include: {
          salonUser: { include: { user: true } },
          stylist: true,
          service: true,
        },
        orderBy: { startAt: 'asc' },
        take: 3,
      });

      let broadcastSentCount = 0;
      for (const candidate of candidates) {
        const candidateStartMs = new Date(candidate.startAt).getTime();
        const candidateEndMs = new Date(candidate.endAt).getTime();
        const candidateDurationMin = Math.round((candidateEndMs - candidateStartMs) / 60000);

        if (candidateDurationMin > freedDurationMin) continue;

        const candidateUser = candidate.salonUser?.user;
        if (!candidateUser?.phone) continue;

        const currentSlotTimeStr = TimeUtility.formatTime12h(candidate.startAt, tz);

        const broadcastMessage = `⚡ *EARLY SLOT AVAILABLE TODAY!*

Hi *${candidateUser.name || 'Customer'}*, a *${freedSlotTimeStr}* slot just freed up today with *${candidate.stylist?.name || 'your stylist'}*!

Would you like to move your *${currentSlotTimeStr}* appointment earlier to *${freedSlotTimeStr}*?`;

        await this.whatsappService.sendMetaMessage(
          candidateUser.phone,
          {
            bodyText: broadcastMessage,
            interactiveType: 'button',
            buttons: [
              { id: `move_up_accept_${candidate.id}_${freedAppointment.id}`, title: `⚡ Move to ${freedSlotTimeStr}` },
              { id: `move_up_decline_${candidate.id}`, title: '⏰ Keep My Time' },
            ],
          },
          salon.whatsappAccount?.phoneNumberId,
          salon.id,
        );

        broadcastSentCount++;
      }

      return broadcastSentCount;
    } catch (err) {
      this.logger.error('Error in triggerSmartMoveUpBroadcast:', err);
      return 0;
    }
  }

  async getAppointmentById(salonId: string, id: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id, salonId },
      include: appointmentInclude,
    });
    if (!appointment) {
      throw new NotFoundException('Appointment not found.');
    }
    return appointment;
  }
}
