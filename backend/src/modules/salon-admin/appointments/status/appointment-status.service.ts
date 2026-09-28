import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  Inject,
  forwardRef,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { AppointmentEventsService } from '../events/appointment-events.service';
import { CancellationService } from '../cancellation/cancellation.service';
import { WhatsAppService } from '../../../channels/whatsapp/whatsapp.service';
import { UpdateAppointmentStatusDto } from '../dto/create-appointment.dto';
import { AppointmentStatus, BookingSource, ClientEtaStatus } from '@prisma/client';
import { TimeUtility } from '../../../../common/utils/time.utility';
import {
  appointmentInclude,
  formatAppointment,
  VALID_STATUS_TRANSITIONS,
} from '../utils/appointment-helpers';

@Injectable()
export class AppointmentStatusService {
  private readonly logger = new Logger(AppointmentStatusService.name);

  constructor(
    private prisma: PrismaService,
    @Optional() private eventsService?: AppointmentEventsService,
    @Inject(forwardRef(() => CancellationService))
    @Optional() private cancellationService?: CancellationService,
    @Inject(forwardRef(() => WhatsAppService))
    @Optional() private whatsappService?: WhatsAppService,
  ) {}

  /**
   * Helper: fetches appointment by salon and ID with complete relations
   */
  private async getAppointment(salonId: string, appointmentId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, salonId },
      include: appointmentInclude,
    });
    if (!appointment) {
      throw new NotFoundException('Appointment not found.');
    }
    return appointment;
  }

  /**
   * Master Status Transition Handler:
   * 1. Validates status transition against VALID_STATUS_TRANSITIONS
   * 2. Calculates client penalty strikes (< 2h and client fault)
   * 3. Dispatches customer WhatsApp alerts (Quick booking accept/reject, emergency cancel apology, checked in, completed receipt)
   * 4. Triggers Move-Up broadcasts on cancellation
   * 5. Emits real-time STATUS_UPDATED events
   */
  async updateAppointmentStatus(
    salonId: string,
    appointmentId: string,
    dto: UpdateAppointmentStatusDto,
    adminId?: string,
    appointmentsService?: any,
  ) {
    const appointment = appointmentsService
      ? await appointmentsService.getAppointmentById(salonId, appointmentId)
      : await this.getAppointment(salonId, appointmentId);

    // Idempotency: If already in target status or both current and target are CANCELLED/NO_SHOW
    const isTargetCancelledNoShow = ([AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW] as string[]).includes(dto.status);
    const isCurrentCancelledNoShow = ([AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW] as string[]).includes(appointment.status);
    if (appointment.status === dto.status || (isCurrentCancelledNoShow && isTargetCancelledNoShow)) {
      return formatAppointment(appointment);
    }

    const allowedTransitions = VALID_STATUS_TRANSITIONS[appointment.status as AppointmentStatus] || [];
    if (!allowedTransitions.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition appointment status from ${appointment.status} to ${dto.status}.`,
      );
    }

    const nowMs = Date.now();
    const apptStartMs = new Date(appointment.startAt).getTime();
    const hoursRemaining = (apptStartMs - nowMs) / (1000 * 60 * 60);

    // Process Penalty Strike Calculation (< 2 hours remaining & client fault / unresponsive)
    let isPenaltyApplied = false;
    let remainingPenalties = 2;
    let newCount = 0;

    const isClientFault =
      dto.reasonCategory === 'CLIENT_UNRESPONSIVE' ||
      dto.reasonCategory === 'CLIENT_MISTAKE' ||
      !adminId;

    if (
      isTargetCancelledNoShow &&
      isClientFault &&
      dto.reasonCategory !== 'SALON_EMERGENCY' &&
      appointment.source !== BookingSource.QUICK_BOOK &&
      hoursRemaining < 2 &&
      appointment.salonUserId
    ) {
      const salonUser = await this.prisma.salonUser.findUnique({
        where: { id: appointment.salonUserId },
      });
      const currentCount = salonUser?.yearlyNoShowCount || 0;
      newCount = currentCount + 1;
      remainingPenalties = Math.max(0, 3 - newCount);
      const isBlocked = newCount >= 3;

      await this.prisma.salonUser.update({
        where: { id: appointment.salonUserId },
        data: {
          yearlyNoShowCount: newCount,
          lastNoShowDate: new Date(),
          isBookingBlocked: isBlocked,
        },
      });
      isPenaltyApplied = true;
    }

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: dto.status,
        notes: dto.reason ? `${appointment.notes || ''} [Note: ${dto.reason}]`.trim() : appointment.notes,
      },
      include: appointmentInclude,
    });

    const formatted = formatAppointment(updated);
    this.eventsService?.emitSalonEvent(salonId, 'STATUS_UPDATED', formatted);

    // Dispatch Customer WhatsApp Notifications
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      include: { whatsappAccount: true },
    });

    const userPhone = updated.salonUser?.user?.phone;
    const userName = updated.salonUser?.user?.name || 'Customer';

    if (salon && userPhone && salon.whatsappAccount?.phoneNumberId && this.whatsappService) {
      const phoneNumberId = salon.whatsappAccount.phoneNumberId;
      const tz = salon.timezone || 'Asia/Kolkata';
      const timeStr = TimeUtility.formatTime12h(updated.startAt, tz);

      if (appointment.status === AppointmentStatus.PENDING_ACCEPTANCE) {
        if (dto.status === AppointmentStatus.CHECKED_IN || dto.status === AppointmentStatus.CONFIRMED) {
          const acceptMsg = `🎉 *QUICK BOOKING ACCEPTED!*\n\nHi *${userName}*, your quick booking check-in at *${salon.name}* has been accepted!\n\n• *Booking #:* *${updated.appointmentNumber}*\n• *Service:* *${updated.serviceNameSnapshot}*\n• *Time:* *${timeStr}*\n• *Specialist:* *${updated.stylist?.name || 'Your Specialist'}*\n• *Status:* *Checked In*\n\nPlease take a seat! *${updated.stylist?.name || 'Your Specialist'}* will call you to the chair shortly.`;
          await this.whatsappService.sendMetaMessage(
            userPhone,
            {
              bodyText: acceptMsg,
              interactiveType: 'button',
              buttons: [{ id: 'btn_start', title: '🏠 Main Menu' }],
            },
            phoneNumberId,
            salonId,
          ).catch(() => { });
        } else if (dto.status === AppointmentStatus.CANCELLED) {
          const declineMsg = `❌ *QUICK BOOKING DECLINED*\n\nHi *${userName}*, *${salon.name}* is currently unable to accept quick bookings at this moment. Please speak to salon reception or book a regular appointment.`;
          await this.whatsappService.sendMetaMessage(
            userPhone,
            {
              bodyText: declineMsg,
              interactiveType: 'button',
              buttons: [{ id: 'btn_start', title: '🏠 Main Menu' }],
            },
            phoneNumberId,
            salonId,
          ).catch(() => { });
        }
      } else if (isTargetCancelledNoShow) {
        if (dto.reasonCategory === 'SALON_EMERGENCY') {
          // Salon Emergency Apology (NO Penalty)
          const apologyMsg = `🙏 *SALON NOTICE: APPOINTMENT CANCELED*\n\nHi *${userName}*, we sincerely apologize! Your appointment for *${timeStr}* at *${salon.name}* was canceled due to a salon emergency.\n\n✨ *No penalty has been applied* to your account. We welcome you to rebook at your convenience!`;
          await this.whatsappService.sendMetaMessage(
            userPhone,
            {
              bodyText: apologyMsg,
              interactiveType: 'button',
              buttons: [{ id: 'btn_book', title: '📅 Book New Visit' }],
            },
            phoneNumberId,
            salonId,
          ).catch(() => { });
        } else if (isPenaltyApplied) {
          // Penalty Strike Notice
          let message = '';
          if (remainingPenalties > 0) {
            message = `⚠️ *LATE CANCELLATION / NO-SHOW PENALTY RECORDED*\n\nHi *${userName}*, your appointment for *${timeStr}* at *${salon.name}* was canceled with less than 2 hours remaining.\n\n⚠️ *Penalty Strike Recorded:* You have *1 penalty strike* recorded. You have *${remainingPenalties} penalty strike(s) remaining* this year before automatic slot booking is locked.`;
          } else {
            message = `⚠️ *ACCOUNT BOOKING LOCKED*\n\nHi *${userName}*, you have accumulated *3 penalty strikes* this year for missed or late-canceled appointments. Automatic slot booking is now locked for your account.\n\n📞 *Please contact the Salon Owner* directly to request access unblock.`;
          }
          await this.whatsappService.sendMetaMessage(
            userPhone,
            {
              bodyText: message,
              interactiveType: 'button',
              buttons: [{ id: 'btn_start', title: '🏠 Main Menu' }],
            },
            phoneNumberId,
            salonId,
          ).catch(() => { });
        }
      } else if (dto.status === AppointmentStatus.CHECKED_IN) {
        const welcomeMsg = `👋 *WELCOME TO ${salon.name.toUpperCase()}!*\n\nHi *${userName}*, you are checked in! Your stylist *${updated.stylist?.name || 'Stylist'}* will call you to the chair shortly.`;
        await this.whatsappService.sendMetaMessage(
          userPhone,
          {
            bodyText: welcomeMsg,
            interactiveType: 'button',
            buttons: [{ id: 'btn_start', title: '🏠 Main Menu' }],
          },
          phoneNumberId,
          salonId,
        ).catch(() => { });
      } else if (dto.status === AppointmentStatus.COMPLETED) {
        const receiptMsg = `✨ *THANK YOU FOR VISITING ${salon.name.toUpperCase()}!*\n\nHi *${userName}*, thank you for visiting us today!\n\n• *Service:* *${updated.serviceNameSnapshot}*\n• *Stylist:* *${updated.stylist?.name || 'Stylist'}*\n• *Total Paid:* *₹${updated.price}*\n\n⭐ *How was your experience today?*`;
        await this.whatsappService.sendMetaMessage(
          userPhone,
          {
            bodyText: receiptMsg,
            interactiveType: 'button',
            buttons: [
              { id: 'btn_start', title: '⭐ Great Service!' },
              { id: 'btn_start', title: '📅 Book Next Visit' },
            ],
          },
          phoneNumberId,
          salonId,
        ).catch(() => { });
      }
    }

    // Trigger Smart Move-Up Broadcast (ONLY if appointment startAt is in the FUTURE: apptStartMs > Date.now())
    if (isTargetCancelledNoShow && apptStartMs > Date.now()) {
      await this.cancellationService.triggerSmartMoveUpBroadcast(formatted).catch((err) => {
        this.logger.warn(`Move-up broadcast trigger warning: ${err.message}`);
      });
    }

    return formatted;
  }

  /**
   * Updates customer ETA status (e.g. ARRIVED, RUNNING_LATE_10M) and notifies dashboard
   */
  async updateEtaStatus(salonId: string, appointmentId: string, etaStatus: any) {
    await this.getAppointment(salonId, appointmentId);

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { clientEtaStatus: etaStatus as ClientEtaStatus },
      include: appointmentInclude,
    });

    const formatted = formatAppointment(updated);
    this.eventsService?.emitSalonEvent(salonId, 'APPOINTMENT_UPDATED', formatted);
    return formatted;
  }

  /**
   * Admin Proposes Alternative Reschedule Time
   */
  async proposeAdminReschedule(
    salonId: string,
    appointmentId: string,
    newStartAt: Date,
    newEndAt: Date,
    adminId?: string,
  ) {
    const appointment = await this.getAppointment(salonId, appointmentId);
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      include: { whatsappAccount: true },
    });
    if (!salon) throw new NotFoundException('Salon not found');

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: AppointmentStatus.PENDING_RESCHEDULE,
        proposedStartAt: newStartAt,
        proposedEndAt: newEndAt,
        proposedByAdminId: adminId,
      },
      include: appointmentInclude,
    });

    const formatted = formatAppointment(updated);
    this.eventsService?.emitSalonEvent(salonId, 'STATUS_UPDATED', formatted);

    const tz = salon.timezone || 'Asia/Kolkata';
    const dateStr = TimeUtility.formatDateFriendly(newStartAt, tz);
    const timeStr = TimeUtility.formatTime12h(newStartAt, tz);
    const userPhone = appointment.salonUser?.user?.phone;

    if (userPhone && salon.whatsappAccount?.phoneNumberId && this.whatsappService) {
      const message = `📅 *RESCHEDULE REQUEST FROM SALON*

Hi *${appointment.salonUser?.user?.name || 'Customer'}*, *${salon.name}* requested to move your appointment to:

• *Date:* *${dateStr}*
• *Time:* *${timeStr}*
• *Stylist:* *${appointment.stylist?.name || 'Stylist'}*

Does this new time work for you?`;

      await this.whatsappService.sendMetaMessage(
        userPhone,
        {
          bodyText: message,
          interactiveType: 'button',
          buttons: [
            { id: `propose_accept_${appointment.id}`, title: '✅ Accept New Time' },
            { id: `propose_decline_${appointment.id}`, title: '❌ Decline & Keep' },
          ],
        },
        salon.whatsappAccount.phoneNumberId,
        salonId,
      ).catch(() => { });
    }

    return formatted;
  }

  /**
   * Periodic sweep: auto-declines quick bookings in PENDING_ACCEPTANCE after start time passes
   */
  async autoDeclineExpiredQuickBookings(salonId: string) {
    const now = new Date();
    try {
      const expiredAppts = await this.prisma.appointment.findMany({
        where: {
          salonId,
          status: AppointmentStatus.PENDING_ACCEPTANCE,
          startAt: { lt: now },
        },
        include: appointmentInclude,
      });

      if (expiredAppts.length === 0) return;

      for (const appt of expiredAppts) {
        await this.cancellationService.cancelBooking(salonId, appt.id, {
          source: 'SYSTEM_AUTO_EXPIRED',
          fault: 'SYSTEM',
          reason: 'Auto-declined: Appointment start time passed without salon check-in approval',
          skipMoveUp: true,
        }).catch((err) => {
          this.logger.error(`Failed to auto-decline quick booking ${appt.id}: ${err.message}`);
        });
      }
    } catch (err: any) {
      this.logger.error(`Error in autoDeclineExpiredQuickBookings: ${err.message}`);
    }
  }

  /**
   * Periodic sweep: auto-completes checked-in appointments whose duration has elapsed
   */
  async autoCompleteElapsedAppointments(salonId?: string): Promise<number> {
    const nowJS = new Date();
    const whereCondition: any = {
      status: { in: [AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_SERVICE] },
      endAt: { lte: nowJS },
    };
    if (salonId) {
      whereCondition.salonId = salonId;
    }

    const elapsed = await this.prisma.appointment.findMany({
      where: whereCondition,
      select: { id: true, salonId: true, appointmentNumber: true, status: true },
    });

    if (elapsed.length === 0) return 0;

    let count = 0;
    for (const appt of elapsed) {
      try {
        const updated = await this.prisma.appointment.update({
          where: { id: appt.id },
          data: {
            status: AppointmentStatus.COMPLETED,
          },
          include: appointmentInclude,
        });

        const formatted = formatAppointment(updated);
        this.eventsService?.emitSalonEvent(appt.salonId, 'APPOINTMENT_UPDATED', formatted);
        count++;
      } catch (err: any) {
        this.logger.warn(`Failed to auto-complete elapsed appt #${appt.appointmentNumber}: ${err.message}`);
      }
    }

    return count;
  }
}
