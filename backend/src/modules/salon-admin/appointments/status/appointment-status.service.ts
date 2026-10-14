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
import { WhatsAppTemplateService } from '../../../channels/whatsapp/services/whatsapp-template.service';
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
  private readonly templates: WhatsAppTemplateService;

  constructor(
    private prisma: PrismaService,
    @Optional() private eventsService?: AppointmentEventsService,
    @Inject(forwardRef(() => CancellationService))
    @Optional() private cancellationService?: CancellationService,
    @Inject(forwardRef(() => WhatsAppService))
    @Optional() private whatsappService?: WhatsAppService,
    @Inject(forwardRef(() => WhatsAppTemplateService))
    @Optional() templates?: WhatsAppTemplateService,
  ) {
    this.templates = templates || new WhatsAppTemplateService();
  }

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

    // Idempotency: If already in target status or both current and target are CANCELLED/REJECTED
    const isTargetCancelled = ([AppointmentStatus.CANCELLED, AppointmentStatus.REJECTED] as string[]).includes(dto.status);
    const isCurrentCancelled = ([AppointmentStatus.CANCELLED, AppointmentStatus.REJECTED] as string[]).includes(appointment.status);
    if (appointment.status === dto.status || (isCurrentCancelled && isTargetCancelled)) {
      return formatAppointment(appointment);
    }

    const allowedTransitions = VALID_STATUS_TRANSITIONS[appointment.status as AppointmentStatus] || [];
    if (!allowedTransitions.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition appointment status from ${appointment.status} to ${dto.status}.`,
      );
    }

    // Centralized Cancellation Delegation
    if (dto.status === AppointmentStatus.CANCELLED) {
      if (this.cancellationService) {
        const result = await this.cancellationService.cancelBooking(salonId, appointmentId, {
          source: adminId ? 'ADMIN_DASHBOARD' : 'CUSTOMER_WHATSAPP',
          fault: dto.reasonCategory === 'SALON_EMERGENCY' ? 'SALON' : 'CLIENT',
          reason: dto.reason || 'Status updated to CANCELLED',
          reasonCategory: dto.reasonCategory || (adminId ? 'SALON_ADMIN_CANCELLED' : 'CLIENT_MISTAKE'),
          adminId,
        });
        return result.appointment;
      }
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
          const acceptMsg = `🎉 *QUICK BOOKING ACCEPTED!*\n\nHi *${userName}*, your quick booking at *${salon.name}* has been accepted!\n\n• *Booking #:* *${updated.appointmentNumber}*\n• *Service:* *${updated.serviceNameSnapshot}*\n• *Time:* *${timeStr}*\n• *Specialist:* *${updated.stylist?.name || 'Your Specialist'}*\n• *Status:* *Confirmed*\n\nPlease tap below when you are on the way:`;
          await this.whatsappService.sendMetaMessage(
            userPhone,
            {
              bodyText: acceptMsg,
              interactiveType: 'button',
              buttons: [
                { id: 'btn_eta_on_the_way', title: '🚗 On My Way' },
                { id: 'btn_eta_arrived', title: '📍 I Have Arrived' },
              ],
            },
            phoneNumberId,
            salonId,
          ).catch((err) => {
            this.logger.error(`Failed to send WhatsApp quick booking accepted notification: ${err?.message || err}`);
          });

          // Auto-reject competing quick bookings for the same stylist and overlapping time window!
          const competing = await this.prisma.appointment.findMany({
            where: {
              salonId,
              id: { not: appointment.id },
              stylistId: appointment.stylistId,
              status: AppointmentStatus.PENDING_ACCEPTANCE,
              startAt: { lt: updated.endAt },
              endAt: { gt: updated.startAt },
            },
            include: { salonUser: { include: { user: true } } },
          });

          for (const comp of competing) {
            await this.prisma.appointment.update({
              where: { id: comp.id },
              data: {
                status: AppointmentStatus.REJECTED,
                cancellationReason: 'COMPETING_BOOKING_ACCEPTED',
              },
            });
            if (comp.salonUser?.user?.phone) {
              const compMsg = `❌ *SLOT NO LONGER AVAILABLE*\n\nHi *${comp.salonUser.user.name || 'Customer'}*, another booking was just confirmed for this slot. Please choose another time or browse our service catalog.`;
              await this.whatsappService.sendMetaMessage(
                comp.salonUser.user.phone,
                {
                  bodyText: compMsg,
                  interactiveType: 'button',
                  buttons: [{ id: 'btn_start', title: '🏠 Main Menu' }],
                },
                phoneNumberId,
                salonId,
              ).catch((err) => {
                this.logger.error(`Failed to send WhatsApp slot taken notification: ${err?.message || err}`);
              });
            }
          }
        } else if (dto.status === AppointmentStatus.REJECTED || dto.status === AppointmentStatus.CANCELLED) {
          const declineMsg = `❌ *QUICK BOOKING DECLINED*\n\nHi *${userName}*, *${salon.name}* is currently unable to accept this quick booking request. Please speak to salon reception or book another slot.`;
          await this.whatsappService.sendMetaMessage(
            userPhone,
            {
              bodyText: declineMsg,
              interactiveType: 'button',
              buttons: [{ id: 'btn_start', title: '🏠 Main Menu' }],
            },
            phoneNumberId,
            salonId,
          ).catch((err) => {
            this.logger.error(`Failed to send WhatsApp quick booking declined notification: ${err?.message || err}`);
          });
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
        ).catch((err) => {
          this.logger.error(`Failed to send WhatsApp CHECKED_IN notification: ${err?.message || err}`);
        });
      } else if (dto.status === AppointmentStatus.SEATED_IN_CHAIR) {
        const seatedMsg = this.templates.buildSeatedInChairReply(
          salon.name,
          updated.stylist?.name || 'Stylist',
          updated.serviceNameSnapshot || 'Hair & Grooming',
        );
        await this.whatsappService.sendMetaMessage(
          userPhone,
          seatedMsg,
          phoneNumberId,
          salonId,
        ).catch((err) => {
          this.logger.error(`Failed to send WhatsApp SEATED_IN_CHAIR notification: ${err?.message || err}`);
        });
      } else if (dto.status === AppointmentStatus.COMPLETED) {
        const receiptMsg = this.templates.buildCompletedReceiptReply({
          salonName: salon.name,
          serviceName: updated.serviceNameSnapshot || 'Hair & Grooming',
          stylistName: updated.stylist?.name || 'Stylist',
          price: updated.price ? Number(updated.price) : 0,
          customerName: userName,
        });
        await this.whatsappService.sendMetaMessage(
          userPhone,
          receiptMsg,
          phoneNumberId,
          salonId,
        ).catch((err) => {
          this.logger.error(`Failed to send WhatsApp COMPLETED receipt notification: ${err?.message || err}`);
        });
      }
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
    this.eventsService?.emitSalonEvent(salonId, 'STATUS_UPDATED', formatted);
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
    proposedStylistId?: string,
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
        proposedStylistId: proposedStylistId || null,
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

    let stylistDisplayName = appointment.stylist?.name || 'Stylist';
    if (proposedStylistId && proposedStylistId !== appointment.stylistId) {
      const peer = await this.prisma.stylist.findUnique({
        where: { id: proposedStylistId },
        select: { name: true },
      });
      if (peer?.name) stylistDisplayName = peer.name;
    }

    if (userPhone && salon.whatsappAccount?.phoneNumberId && this.whatsappService) {
      const proposalPayload = this.templates!.buildRescheduleProposalPrompt({
        salonName: salon.name,
        customerName: appointment.salonUser?.user?.name || 'Customer',
        dateFriendly: dateStr,
        timeFriendly: timeStr,
        stylistName: stylistDisplayName,
        appointmentId: appointment.id,
      });

      await this.whatsappService.sendMetaMessage(
        userPhone,
        proposalPayload,
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
      status: { in: [AppointmentStatus.CHECKED_IN, AppointmentStatus.SEATED_IN_CHAIR, AppointmentStatus.ON_THE_WAY] },
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
