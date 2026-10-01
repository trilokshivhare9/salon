import { Injectable, Logger, Inject, forwardRef, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { AppointmentsService } from '../../../salon-admin/appointments/appointments.service';
import { CancellationService } from '../../../salon-admin/appointments/cancellation/cancellation.service';
import { RescheduleService } from '../../../salon-admin/appointments/reschedule/reschedule.service';
import { AvailabilityService } from '../../../salon-admin/availability/availability.service';
import { WhatsAppSenderService, WhatsAppButtonId } from '../services/whatsapp-sender.service';
import { WhatsAppTemplateService } from '../services/whatsapp-template.service';
import { WhatsAppSessionService } from '../services/whatsapp-session.service';
import { WhatsAppService } from '../whatsapp.service';
import { ConversationState, AppointmentStatus, CancelledBy } from '@prisma/client';
import { DateTime } from 'luxon';
import { TimeUtility } from '../../../../common/utils/time.utility';
import { ActionContext, ActionResult } from './shared/action-context';
import { ActionUtils } from './shared/action-utils';

@Injectable()
export class AppointmentAction {
  private readonly logger = new Logger(AppointmentAction.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: WhatsAppSenderService,
    private readonly templates: WhatsAppTemplateService,
    private readonly session: WhatsAppSessionService,
    private readonly availabilityService: AvailabilityService,
    @Inject(forwardRef(() => AppointmentsService))
    private readonly appointmentsService: AppointmentsService,
    @Inject(forwardRef(() => CancellationService))
    private readonly cancellationService: CancellationService,
    @Inject(forwardRef(() => RescheduleService))
    private readonly rescheduleService: RescheduleService,
    @Inject(forwardRef(() => WhatsAppService))
    @Optional() private readonly whatsAppService?: WhatsAppService,
  ) {}

  private async sendMessage(
    toPhone: string,
    payload: any,
    phoneNumberId?: string,
    salonId?: string,
  ): Promise<boolean> {
    if (this.whatsAppService) {
      return this.whatsAppService.sendMetaMessage(toPhone, payload, phoneNumberId, salonId);
    }
    return this.sender.sendMetaMessage(toPhone, payload, phoneNumberId, salonId);
  }

  /**
   * Handles Cancellation Flow (Cancel prompt, confirm yes, keep no)
   */
  async handleCancellation(ctx: ActionContext): Promise<ActionResult> {
    const { input, normalizedInput, cleanNumber, phoneNumberId, salonId, conversation, activeAppointment, pendingAppointment } = ctx;
    this.logger.log(`[AppointmentAction] handleCancellation input="${input}" user=${cleanNumber}`);

    // If customer has only an unaccepted pending request, cancel directly with ZERO penalty / strikes
    if (!activeAppointment && pendingAppointment) {
      await this.prisma.appointment.update({
        where: { id: pendingAppointment.id },
        data: {
          status: AppointmentStatus.CANCELLED,
          cancellationReason: 'CANCELLED_BY_CLIENT_BEFORE_ACCEPTANCE',
          cancelledAt: new Date(),
          cancelledBy: CancelledBy.USER,
          penaltyApplied: false,
        },
      });
      await this.session.updateConversationState(
        conversation.id,
        ConversationState.START,
        null,
        ActionUtils.getClearDraftData(),
      );
      const reply = this.templates.buildPendingRequestCancelledReply();
      await this.sendMessage(cleanNumber, reply, phoneNumberId, salonId);
      return { replyMessage: reply.bodyText, state: ConversationState.START };
    }

    if (
      input === WhatsAppButtonId.CANCEL_APPT ||
      input === WhatsAppButtonId.REMIND_CANCEL ||
      input === WhatsAppButtonId.ETA_CANCEL
    ) {
      let strikeWarning = false;
      if (activeAppointment) {
        const penaltyCheck = await this.cancellationService.checkCancellationPenalty(
          salonId,
          activeAppointment.id,
        );
        strikeWarning = penaltyCheck.willIncurPenalty;
      }

      await this.session.updateConversationState(conversation.id, ConversationState.CONFIRM_CANCEL);
      const prompt = this.templates.buildCancelConfirmationPrompt(strikeWarning);
      await this.sendMessage(cleanNumber, prompt, phoneNumberId, salonId);
      return { replyMessage: prompt.bodyText, state: ConversationState.CONFIRM_CANCEL };
    }

    if (input === WhatsAppButtonId.CANCEL_YES || normalizedInput.includes('yes') || normalizedInput === '1') {
      const apptId = conversation.activeAppointmentId || activeAppointment?.id;
      if (apptId) {
        await this.cancellationService.cancelBooking(salonId, apptId, {
          source: 'CUSTOMER_WHATSAPP',
          fault: 'CLIENT',
          reason: 'Cancelled by customer via WhatsApp Active Hub',
          skipWhatsAppNotify: true,
        });
      }
      await this.session.updateConversationState(
        conversation.id,
        ConversationState.START,
        null,
        ActionUtils.getClearDraftData(),
      );
      const reply = this.templates.buildCancelSuccessReply();
      await this.sendMessage(cleanNumber, reply, phoneNumberId, salonId);
      return { replyMessage: reply.bodyText, state: ConversationState.START };
    }

    if (
      input === WhatsAppButtonId.CANCEL_NO ||
      normalizedInput.includes('no') ||
      normalizedInput.includes('keep') ||
      normalizedInput === '2'
    ) {
      await this.session.updateConversationState(conversation.id, ConversationState.START);
      const reply = this.templates.buildCancelKeepReply();
      await this.sendMessage(cleanNumber, reply, phoneNumberId, salonId);
      return { replyMessage: reply.bodyText, state: ConversationState.START };
    }

    return { replyMessage: '', state: conversation.state };
  }

  /**
   * Handles Reschedule Flow (Reschedule button, date select, slot select)
   */
  async handleReschedule(ctx: ActionContext): Promise<ActionResult> {
    const { input, cleanNumber, phoneNumberId, salonId, salon, conversation, activeAppointment, pendingAppointment, tz } = ctx;
    this.logger.log(`[AppointmentAction] handleReschedule input="${input}" user=${cleanNumber}`);

    // If customer has a pending request awaiting salon approval, block reschedule
    if (!activeAppointment && pendingAppointment) {
      const blockedReply = this.templates.buildPendingModificationBlockedReply();
      await this.sendMessage(cleanNumber, blockedReply, phoneNumberId, salonId);
      return { replyMessage: blockedReply.bodyText, state: conversation.state };
    }

    // Step 1: Reschedule Button Click
    if (input === WhatsAppButtonId.RESCHEDULE || input === WhatsAppButtonId.REMIND_RESCHEDULE) {
      const apptToReschedule = activeAppointment;

      if (!apptToReschedule) {
        const reply = `You don't have an active appointment to reschedule.`;
        await this.sendMessage(
          cleanNumber,
          {
            bodyText: reply,
            interactiveType: 'button',
            buttons: [
              { id: WhatsAppButtonId.BOOK, title: '📅 Book Slot' },
              { id: WhatsAppButtonId.START, title: '🏠 Main Menu' },
            ],
          },
          phoneNumberId,
          salonId,
        );
        return { replyMessage: reply, state: ConversationState.START };
      }

      // Check eligibility & cutoff via RescheduleService
      const eligibility = await this.rescheduleService.validateRescheduleEligibility(
        salonId,
        apptToReschedule.id,
      );

      if (!eligibility.allowed) {
        const payload = this.templates.buildRescheduleCutoffPassedPrompt(salon.phone || undefined);
        await this.sendMessage(cleanNumber, payload, phoneNumberId, salonId);
        return { replyMessage: payload.bodyText, state: conversation.state };
      }

      const openDates = await this.availabilityService.findAvailableDates(
        salonId,
        apptToReschedule.serviceId,
        apptToReschedule.stylistId,
        2,
        apptToReschedule.id,
      );

      if (openDates.length === 0) {
        const reply = `⚠️ No available slots found in the next 7 days to reschedule. Please contact the salon directly at *${salon.phone || 'our desk'}*.`;
        await this.sendMessage(
          cleanNumber,
          {
            bodyText: reply,
            interactiveType: 'button',
            buttons: [{ id: WhatsAppButtonId.START, title: '🏠 Main Menu' }],
          },
          phoneNumberId,
          salonId,
        );
        return { replyMessage: reply, state: conversation.state };
      }

      await this.session.updateConversationState(
        conversation.id,
        ConversationState.SELECT_RESCHEDULE_DATE,
        apptToReschedule.id,
      );
      const prompt = this.templates.buildDateSelectionMenu(openDates, true);
      await this.sendMessage(cleanNumber, prompt, phoneNumberId, salonId);
      return { replyMessage: prompt.bodyText, state: ConversationState.SELECT_RESCHEDULE_DATE };
    }

    // Step 2: Reschedule Date Selected
    if (input.startsWith('rdate_')) {
      let dateStr = input.replace('rdate_', '');
      if (dateStr === 'today' || dateStr === '1') {
        dateStr = TimeUtility.getTodayDate(tz);
      } else if (dateStr === 'tmrw' || dateStr === 'tomorrow' || dateStr === '2') {
        dateStr = DateTime.now().setZone(tz).plus({ days: 1 }).toISODate()!;
      }

      const appt = activeAppointment;
      if (!appt) {
        const reply = `⚠️ No active appointment found to reschedule.`;
        await this.sendMessage(
          cleanNumber,
          {
            bodyText: reply,
            interactiveType: 'button',
            buttons: [{ id: WhatsAppButtonId.START, title: '🏠 Main Menu' }],
          },
          phoneNumberId,
          salonId,
        );
        return { replyMessage: reply, state: ConversationState.START };
      }

      const availability = await this.availabilityService.getAvailableSlots(
        salonId,
        appt.serviceId,
        dateStr,
        appt.stylistId || undefined,
        appt.id,
      );

      if (!availability.availableSlots || availability.availableSlots.length === 0) {
        const reply = `⚠️ No slots available on *${dateStr}*. Please select another date:`;
        const altDates = await this.availabilityService.findAvailableDates(
          salonId,
          appt.serviceId,
          appt.stylistId,
          2,
          appt.id,
        );
        const dateMenu = this.templates.buildDateSelectionMenu(altDates, true);
        dateMenu.bodyText = reply;
        await this.sendMessage(cleanNumber, dateMenu, phoneNumberId, salonId);
        return { replyMessage: dateMenu.bodyText, state: ConversationState.SELECT_RESCHEDULE_DATE };
      }

      await this.session.updateConversationState(
        conversation.id,
        ConversationState.SELECT_RESCHEDULE_TIME,
        appt.id,
        { selectedDate: TimeUtility.toDbDate(dateStr) },
      );

      const slotRows = availability.availableSlots.map((s) => ({
        timeStr: s.startTime,
        displayTime: ActionUtils.formatTime12h(s.startTime),
      }));

      const slotMenu = this.templates.buildTimeSlotMenu(slotRows, true);
      await this.sendMessage(cleanNumber, slotMenu, phoneNumberId, salonId);
      return { replyMessage: slotMenu.bodyText, state: ConversationState.SELECT_RESCHEDULE_TIME };
    }

    // Step 3: Reschedule Time Slot Selected
    if (input.startsWith('rslot_')) {
      const newStartTime = input.replace('rslot_', '');
      const appt = activeAppointment;

      if (!appt || !conversation.selectedDate) {
        const reply = `⚠️ Reschedule session expired or invalid. Please start again.`;
        await this.sendMessage(
          cleanNumber,
          {
            bodyText: reply,
            interactiveType: 'button',
            buttons: [{ id: WhatsAppButtonId.START, title: '🏠 Main Menu' }],
          },
          phoneNumberId,
          salonId,
        );
        return { replyMessage: reply, state: ConversationState.START };
      }

      const dateStr = TimeUtility.toDateString(conversation.selectedDate);

      await this.rescheduleService.rescheduleAppointment(
        salonId,
        appt.id,
        {
          newDate: dateStr,
          newStartTime,
          stylistId: appt.stylistId || undefined,
        },
        undefined,
        this.appointmentsService,
      );

      await this.session.updateConversationState(conversation.id, ConversationState.START, appt.id);
      const successReply = this.templates.buildRescheduleSuccessReply(
        dateStr,
        ActionUtils.formatTime12h(newStartTime),
      );
      await this.sendMessage(cleanNumber, successReply, phoneNumberId, salonId);
      return { replyMessage: successReply.bodyText, state: ConversationState.START };
    }

    return { replyMessage: '', state: conversation.state };
  }

  /**
   * Handles Salon Owner Proposed Reschedule (Accept / Decline)
   */
  async handleOwnerProposal(ctx: ActionContext): Promise<ActionResult> {
    const { input, cleanNumber, phoneNumberId, salonId, salon, tz } = ctx;
    this.logger.log(`[AppointmentAction] handleOwnerProposal input="${input}" user=${cleanNumber}`);

    if (input.startsWith(WhatsAppButtonId.PROPOSE_ACCEPT_PREFIX)) {
      const apptId = input.replace(WhatsAppButtonId.PROPOSE_ACCEPT_PREFIX, '');
      const appt = await this.prisma.appointment.findUnique({
        where: { id: apptId },
        include: { service: true, stylist: true },
      });

      if (!appt || appt.status !== AppointmentStatus.PENDING_RESCHEDULE || !appt.proposedStartAt || !appt.proposedEndAt) {
        const staleReply = this.templates.buildRescheduleStaleExpiredReply();
        await this.sendMessage(cleanNumber, staleReply, phoneNumberId, salonId);
        return { replyMessage: staleReply.bodyText, state: ConversationState.START };
      }

      const newStart = appt.proposedStartAt;
      const newEnd = appt.proposedEndAt;

      await this.prisma.appointment.update({
        where: { id: apptId },
        data: {
          startAt: newStart,
          endAt: newEnd,
          appointmentDate: TimeUtility.toDbDate(newStart),
          status: AppointmentStatus.CONFIRMED,
          proposedStartAt: null,
          proposedEndAt: null,
          proposedByAdminId: null,
          notes: `${appt.notes || ''} [Rescheduled by salon admin and accepted by customer.]`.trim(),
        },
      });

      const newTimeStr = TimeUtility.formatTime12h(newStart, tz);
      const replyPayload = this.templates.buildRescheduleAcceptedReply({
        salonName: salon.name,
        stylistName: appt.stylist?.name || 'Stylist',
        newTimeStr,
      });

      await this.sendMessage(cleanNumber, replyPayload, phoneNumberId, salonId);
      this.appointmentsService?.emitSalonEvent(salonId, 'STATUS_UPDATED', appt);
      this.appointmentsService?.emitSalonEvent(salonId, 'APPOINTMENT_UPDATED', appt);
      return { replyMessage: replyPayload.bodyText, state: ConversationState.START };
    }

    if (input.startsWith(WhatsAppButtonId.PROPOSE_DECLINE_PREFIX)) {
      const apptId = input.replace(WhatsAppButtonId.PROPOSE_DECLINE_PREFIX, '');
      const appt = await this.prisma.appointment.findUnique({
        where: { id: apptId },
        include: { service: true, stylist: true, salonUser: { include: { user: true } } },
      });

      if (!appt || appt.status !== AppointmentStatus.PENDING_RESCHEDULE) {
        const staleReply = this.templates.buildRescheduleStaleExpiredReply();
        await this.sendMessage(cleanNumber, staleReply, phoneNumberId, salonId);
        return { replyMessage: staleReply.bodyText, state: ConversationState.START };
      }

      const updated = await this.prisma.appointment.update({
        where: { id: apptId },
        data: {
          status: AppointmentStatus.CANCELLED,
          cancellationReason: 'DECLINED_SALON_RESCHEDULE',
          cancelledAt: new Date(),
          cancelledBy: CancelledBy.USER,
          penaltyApplied: false,
          proposedStartAt: null,
          proposedEndAt: null,
          proposedByAdminId: null,
          notes: `${appt.notes || ''} [Salon reschedule declined by customer. Cancelled without penalty.]`.trim(),
        },
        include: { service: true, stylist: true, salonUser: { include: { user: true } } },
      });

      const replyPayload = this.templates.buildRescheduleDeclinedReply();
      await this.sendMessage(cleanNumber, replyPayload, phoneNumberId, salonId);

      this.appointmentsService?.emitSalonEvent(salonId, 'STATUS_UPDATED', updated);
      this.appointmentsService?.emitSalonEvent(salonId, 'APPOINTMENT_UPDATED', updated);
      this.appointmentsService?.emitSalonEvent(salonId, 'BOOKING_CANCELLED', updated);

      if (this.cancellationService && typeof (this.cancellationService as any).triggerSmartMoveUpBroadcast === 'function') {
        await (this.cancellationService as any).triggerSmartMoveUpBroadcast(updated).catch(() => {});
      }

      return { replyMessage: replyPayload.bodyText, state: ConversationState.START };
    }

    return { replyMessage: '', state: ConversationState.START };
  }
}
