import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { WhatsAppService } from '../../../channels/whatsapp/whatsapp.service';
import { WhatsAppTemplateService } from '../../../channels/whatsapp/services/whatsapp-template.service';
import { AppointmentEventsService } from '../events/appointment-events.service';
import {
  CancelBookingContext,
  CancelBookingResult,
} from '../dto/create-appointment.dto';
import {
  AppointmentStatus,
  BookingSource,
  CancelledBy,
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
    @Inject(forwardRef(() => WhatsAppTemplateService))
    @Optional() private templates?: WhatsAppTemplateService,
  ) {
    if (!this.templates) {
      this.templates = new WhatsAppTemplateService();
    }
  }

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

    const nowMs = Date.now();
    const apptStartMs = new Date(appointment.startAt).getTime();
    const minutesUntil = (apptStartMs - nowMs) / (1000 * 60);

    // Global 90-minute rule
    const willIncurPenalty = minutesUntil < 90 && !!appointment.salonUserId;

    return {
      willIncurPenalty,
      hoursUntil: minutesUntil / 60,
      cancelWindowHours: 1.5,
      appointment: formatAppointment(appointment),
    };
  }

  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * CENTRALIZED CANCEL BOOKING METHOD
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   *
   * Handles:
   * 1. Status determination (CANCELLED vs REJECTED) based on context
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

    // 2. Idempotency: if already in terminal status, return existing
    const terminalStatuses = [AppointmentStatus.CANCELLED, AppointmentStatus.REJECTED] as string[];
    if (terminalStatuses.includes(appointment.status)) {
      this.logger.warn(
        `[cancelBooking] Appointment ${appointmentId} already in terminal status ${appointment.status}. Idempotent return.`,
      );
      const salonUser = appointment.salonUserId
        ? await this.prisma.salonUser.findUnique({ where: { id: appointment.salonUserId } })
        : null;
      const count = salonUser?.yearlyNoShowCount || 0;
      return {
        appointment: formatAppointment(appointment),
        penaltyApplied: appointment.penaltyApplied || false,
        penaltyCount: count,
        remainingStrikes: Math.max(0, 3 - count),
        isBlocked: count >= 3,
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

    // 5. Update appointment in DB with explicit cancelledBy tracking
    const cancelledBy = context.cancelledBy || (
      context.source === 'ADMIN_DASHBOARD' || Boolean(context.adminId) || context.source === 'SALON_REJECTED'
        ? CancelledBy.SALON
        : context.source.startsWith('SYSTEM_')
        ? CancelledBy.SYSTEM
        : CancelledBy.USER
    );

    const reasonNote = this.buildCancelNote(appointment, context);
    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: targetStatus,
        notes: reasonNote,
        cancellationReason: context.reason || context.reasonCategory || 'CLIENT_CANCELLED',
        cancelledAt: new Date(),
        cancelledBy,
        penaltyApplied: penaltyResult.penaltyApplied,
        proposedStartAt: null,
        proposedEndAt: null,
        proposedByAdminId: null,
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
   * All cancellations transition to CANCELLED.
   */
  private determineCancelStatus(_context: CancelBookingContext): AppointmentStatus {
    return AppointmentStatus.CANCELLED;
  }

  /**
   * Calculates whether a penalty strike should be applied.
   * Penalty rules:
   * - Only for CLIENT fault
   * - Only if cancel is within 90 minutes of start time
   * - Not for QUICK_BOOK source
   * - Only if salonUserId is linked
   */
  private async calculateCancelPenalty(
    appointment: any,
    context: CancelBookingContext,
  ): Promise<{ penaltyApplied: boolean; penaltyCount: number; remainingStrikes: number; isBlocked: boolean }> {
    // Fallback: If no linked salonUser, no penalty strikes can be recorded
    if (!appointment.salonUserId) {
      return { penaltyApplied: false, penaltyCount: 0, remainingStrikes: 3, isBlocked: false };
    }

    const salonUser = await this.prisma.salonUser.findUnique({
      where: { id: appointment.salonUserId },
    });
    const currentCount = salonUser?.yearlyNoShowCount || 0;
    const currentRemainingStrikes = Math.max(0, 3 - currentCount);
    const currentlyBlocked = currentCount >= 3;

    // 1. Explicit NO PENALTY Flag:
    // If noPenalty === true OR applyPenalty === false OR fault === 'SALON',
    // the system NEVER marks penalty regardless of source or remaining time.
    const isExplicitNoPenalty =
      context.noPenalty === true ||
      context.applyPenalty === false ||
      context.fault === 'SALON';

    if (isExplicitNoPenalty) {
      return {
        penaltyApplied: false,
        penaltyCount: currentCount,
        remainingStrikes: currentRemainingStrikes,
        isBlocked: currentlyBlocked,
      };
    }

    // 2. Explicit WITH PENALTY Flag from Salon Admin:
    // If salon admin explicitly marks applyPenalty === true, apply penalty directly (bypassing remaining time check).
    const isExplicitAdminPenalty =
      (context.source === 'ADMIN_DASHBOARD' || Boolean(context.adminId)) &&
      context.applyPenalty === true;

    if (!isExplicitAdminPenalty) {
      // 3. Quick Booking Check: Quick book requests never incur cancellation penalty strikes
      if (appointment.source === BookingSource.QUICK_BOOK) {
        return {
          penaltyApplied: false,
          penaltyCount: currentCount,
          remainingStrikes: currentRemainingStrikes,
          isBlocked: currentlyBlocked,
        };
      }

      // 4. Universal 90-Minute Rule:
      // Any booking cancel where remaining time is < 90 min -> mark penalty.
      // If remaining time >= 90 min -> no penalty.
      const nowMs = Date.now();
      const apptStartMs = new Date(appointment.startAt).getTime();
      const minutesRemaining = (apptStartMs - nowMs) / (1000 * 60);

      if (minutesRemaining >= 90) {
        return {
          penaltyApplied: false,
          penaltyCount: currentCount,
          remainingStrikes: currentRemainingStrikes,
          isBlocked: currentlyBlocked,
        };
      }
    }

    // Apply Penalty Strike
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

    let payload: any = null;

    switch (context.source) {
      case 'SYSTEM_AUTO_NOSHOW':
        payload = this.templates!.buildSystemAutoNoShowNotice({
          userName,
          timeStr,
          remainingStrikes: penalty.remainingStrikes,
          isBlocked: penalty.isBlocked,
        });
        break;

      case 'SYSTEM_AUTO_CUTOFF':
        if (
          context.reason === 'UNRESPONSIVE_RESCHEDULE_PROPOSAL_EXPIRED_60M' ||
          context.reason === 'UNRESPONSIVE_RESCHEDULE_PROPOSAL_EXPIRED_30M' ||
          context.reason === 'UNRESPONSIVE_RESCHEDULE_PROPOSAL_EXPIRED'
        ) {
          const proposedTime = appointment.proposedStartAt
            ? TimeUtility.formatTime12h(appointment.proposedStartAt, tz)
            : timeStr;
          payload = this.templates!.buildRescheduleExpiredNotice({
            salonName: salon.name,
            proposedTimeStr: proposedTime,
          });
        } else {
          payload = this.templates!.buildSystemAutoCutoffNotice({
            userName,
            timeStr,
            remainingStrikes: penalty.remainingStrikes,
            isBlocked: penalty.isBlocked,
          });
        }
        break;

      case 'SYSTEM_AUTO_EXPIRED':
        payload = this.templates!.buildQuickBookingExpiredNotice({
          salonName: salon.name,
          timeStr,
        });
        break;

      case 'SYSTEM_SALON_DEACTIVATION':
        payload = this.templates!.buildSalonDeactivationNotice({
          userName,
          salonName: salon.name,
          dateStr,
          timeStr,
        });
        break;

      case 'SYSTEM_STORE_CLOSURE':
      case 'CUSTOMER_ABSENCE':
        payload = this.templates!.buildSalonClosureNotice({
          userName,
          salonName: salon.name,
          timeStr,
        });
        break;

      case 'ADMIN_DASHBOARD':
        payload = this.templates!.buildAdminCancelledNotice({
          userName,
          dateStr,
          timeStr,
          salonName: salon.name,
          penaltyApplied: penalty.penaltyApplied,
          remainingStrikes: penalty.remainingStrikes,
          isBlocked: penalty.isBlocked,
        });
        break;

      default:
        return;
    }

    if (!payload) return;

    await this.whatsappService.sendMetaMessage(
      userPhone,
      payload,
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
