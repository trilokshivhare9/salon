import { Injectable, Logger, Inject, forwardRef, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { AppointmentsService } from '../../../salon-admin/appointments/appointments.service';
import { AvailabilityService } from '../../../salon-admin/availability/availability.service';
import { WhatsAppSenderService, WhatsAppButtonId } from '../services/whatsapp-sender.service';
import { WhatsAppTemplateService } from '../services/whatsapp-template.service';
import { WhatsAppSessionService } from '../services/whatsapp-session.service';
import { WhatsAppService } from '../whatsapp.service';
import { ConversationState, AppointmentStatus, BookingSource, CancelledBy } from '@prisma/client';
import { DateTime } from 'luxon';
import { TimeUtility } from '../../../../common/utils/time.utility';
import { ActionContext, ActionResult } from './shared/action-context';
import { ActionUtils } from './shared/action-utils';

@Injectable()
export class QuickBookingAction {
  private readonly logger = new Logger(QuickBookingAction.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: WhatsAppSenderService,
    private readonly templates: WhatsAppTemplateService,
    private readonly session: WhatsAppSessionService,
    private readonly availabilityService: AvailabilityService,
    @Inject(forwardRef(() => AppointmentsService))
    private readonly appointmentsService: AppointmentsService,
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
   * Quick Book Entry (Direct Bypass) with Per-User Concurrency Guard
   */
  async startQuickBook(ctx: ActionContext): Promise<ActionResult> {
    const { cleanNumber, phoneNumberId, salonId, salon, conversation, tz } = ctx;
    this.logger.log(`[QuickBookingAction] Starting quick booking check for user=${cleanNumber}`);

    // Check if user already has an active pending quick booking request
    const existingPending = await this.prisma.appointment.findFirst({
      where: {
        salonId,
        salonUser: {
          user: {
            phone: { in: [cleanNumber, `+${cleanNumber}`, cleanNumber.replace(/^\+/, '')] },
          },
        },
        status: AppointmentStatus.PENDING_ACCEPTANCE,
      },
      include: { service: true, stylist: true },
      orderBy: { createdAt: 'desc' },
    });

    if (existingPending) {
      const timeStr = ActionUtils.formatTime12h(existingPending.startAt, tz);
      const conflictPrompt = this.templates.buildPendingRequestConflictPrompt({
        serviceName: existingPending.service?.name || existingPending.serviceNameSnapshot || 'Service',
        timeStr,
        stylistName: existingPending.stylist?.name,
      });
      await this.sendMessage(cleanNumber, conflictPrompt, phoneNumberId, salonId);
      return { replyMessage: conflictPrompt.bodyText, state: conversation.state };
    }

    await this.session.updateConversationState(conversation.id, ConversationState.SELECT_CATEGORY, undefined, {
      quickCodeVerifiedAt: new Date(),
    });

    const categoryMenu = this.templates.buildQuickBookCategoryMenu(salon.serviceCategories || []);
    await this.sendMessage(cleanNumber, categoryMenu, phoneNumberId, salonId);
    return { replyMessage: categoryMenu.bodyText, state: ConversationState.SELECT_CATEGORY };
  }

  /**
   * Cancels a pending quick booking request on customer's demand with ZERO penalty
   */
  async cancelPendingQuickBook(ctx: ActionContext): Promise<ActionResult> {
    const { cleanNumber, phoneNumberId, salonId, conversation } = ctx;
    this.logger.log(`[QuickBookingAction] Cancelling pending request for user=${cleanNumber}`);

    const pendingRequest = await this.prisma.appointment.findFirst({
      where: {
        salonId,
        salonUser: {
          user: {
            phone: { in: [cleanNumber, `+${cleanNumber}`, cleanNumber.replace(/^\+/, '')] },
          },
        },
        status: AppointmentStatus.PENDING_ACCEPTANCE,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (pendingRequest) {
      await this.prisma.appointment.update({
        where: { id: pendingRequest.id },
        data: {
          status: AppointmentStatus.CANCELLED,
          cancellationReason: 'CANCELLED_BY_CLIENT_BEFORE_ACCEPTANCE',
          cancelledAt: new Date(),
          cancelledBy: CancelledBy.USER,
          penaltyApplied: false,
        },
      });
    }

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

  /**
   * Evaluates earliest available slot today for selected service in Quick Book mode
   */
  async handleQuickServiceSelection(ctx: ActionContext, svcId: string, selectedService: any): Promise<ActionResult> {
    const { cleanNumber, phoneNumberId, salonId, salon, conversation, tz } = ctx;
    this.logger.log(`[QuickBookingAction] Evaluating earliest slot for service=${svcId}`);

    const earliest = await this.availabilityService.findEarliestAvailableSlotToday(salonId, svcId);

    if (!earliest) {
      const reply = `⚠️ *No slots available today* for *${selectedService.name}*.\n\nAll appointments for today are fully booked or the salon is closed. Would you like to book for an upcoming day with normal booking, or pick another service?`;
      await this.sendMessage(
        cleanNumber,
        {
          bodyText: reply,
          interactiveType: 'button',
          buttons: [
            { id: WhatsAppButtonId.SERVICES, title: '✂️ Other Service' },
            { id: WhatsAppButtonId.BOOK, title: '📅 Normal Booking' },
            { id: WhatsAppButtonId.START, title: '🏠 Main Menu' },
          ],
        },
        phoneNumberId,
        salonId,
      );
      return { replyMessage: reply, state: ConversationState.SELECT_SERVICE };
    }

    const dateIso = TimeUtility.toDbDate(earliest.dateStr);
    const startDt = TimeUtility.toTimestamp(earliest.dateStr, earliest.startTime, tz);
    const assignedStylistId =
      earliest.eligibleStaffIds && earliest.eligibleStaffIds.length > 0 ? earliest.eligibleStaffIds[0] : null;
    const stylist = assignedStylistId ? (salon.stylists || []).find((s: any) => s.id === assignedStylistId) : null;

    await this.session.updateConversationState(conversation.id, ConversationState.QUICK_BOOK_CONFIRM, undefined, {
      selectedServiceId: svcId,
      selectedDate: dateIso,
      selectedStartTime: startDt,
      selectedStaffId: assignedStylistId,
    });

    const time12h = earliest.displayTime || ActionUtils.formatTime12h(earliest.startTime, tz);
    const dateFriendly = ActionUtils.formatDateFriendly(earliest.dateStr, tz);

    const prompt = this.templates.buildQuickBookConfirmationPrompt({
      salonName: salon.name,
      serviceName: selectedService.name,
      price: selectedService.price,
      duration: selectedService.durationMinutes,
      dateFormatted: dateFriendly,
      timeFormatted: time12h,
      stylistName: stylist?.name || 'First Available Specialist',
    });

    await this.sendMessage(cleanNumber, prompt, phoneNumberId, salonId);
    return { replyMessage: prompt.bodyText, state: ConversationState.QUICK_BOOK_CONFIRM };
  }

  /**
   * Confirms Quick Booking and creates appointment with initialStatus: PENDING_ACCEPTANCE
   */
  async confirmQuickBook(ctx: ActionContext): Promise<ActionResult> {
    const { cleanNumber, phoneNumberId, salonId, user, conversation, tz } = ctx;
    this.logger.log(`[QuickBookingAction] Confirming quick booking for user=${cleanNumber}`);

    if (conversation.quickCodeVerifiedAt) {
      const minsDiff = (Date.now() - new Date(conversation.quickCodeVerifiedAt).getTime()) / (1000 * 60);
      if (minsDiff > 30) {
        await this.session.updateConversationState(conversation.id, ConversationState.START, null);
        const reply = `⚠️ *Quick Booking session expired.*\n\nYour quick booking session has expired due to inactivity. Please start a new booking.`;
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
    }

    const todayDateStr = TimeUtility.getTodayDate(tz);
    let slotTime = conversation.selectedStartTime
      ? TimeUtility.formatTime24h(conversation.selectedStartTime, tz)
      : TimeUtility.now(tz).toFormat('HH:mm');

    // Real slot check for quick booking today if slotTime was not resolved
    if (!conversation.selectedStartTime && conversation.selectedServiceId) {
      try {
        const avail = await this.availabilityService.getAvailableSlots(
          salonId,
          conversation.selectedServiceId,
          todayDateStr,
          conversation.selectedStaffId || undefined,
        );
        if (avail.availableSlots && avail.availableSlots.length > 0) {
          slotTime = avail.availableSlots[0].startTime;
        }
      } catch (e) {
        // Keep current time fallback
      }
    }

    const isPastSlot = TimeUtility.isPastTimeToday(slotTime, tz);

    const refreshToNextSlot = async (oldTimeStrFormatted: string): Promise<ActionResult> => {
      try {
        if (!conversation.selectedServiceId) {
          throw new Error('No service selected');
        }

        const earliest = await this.availabilityService.findEarliestAvailableSlotToday(
          salonId,
          conversation.selectedServiceId,
        );

        if (earliest) {
          const newStartDt = TimeUtility.toTimestamp(earliest.dateStr, earliest.startTime, tz);
          const assignedStylistId =
            earliest.eligibleStaffIds && earliest.eligibleStaffIds.length > 0
              ? earliest.eligibleStaffIds[0]
              : null;
          const stylist = assignedStylistId
            ? (ctx.salon?.stylists || []).find((s: any) => s.id === assignedStylistId)
            : null;

          await this.session.updateConversationState(
            conversation.id,
            ConversationState.QUICK_BOOK_CONFIRM,
            undefined,
            {
              selectedDate: TimeUtility.toDbDate(earliest.dateStr),
              selectedStartTime: newStartDt,
              selectedStaffId: assignedStylistId,
            },
          );

          const newTimeFormatted =
            earliest.displayTime || ActionUtils.formatTime12h(earliest.startTime, tz);
          const service = (ctx.salon?.services || []).find(
            (s: any) => s.id === conversation.selectedServiceId,
          );
          const diffMins = Math.max(
            0,
            Math.round((newStartDt.getTime() - Date.now()) / (1000 * 60)),
          );

          const autoRefreshPrompt = this.templates.buildSlotAutoRefreshedReply({
            oldTimeStr: oldTimeStrFormatted,
            newTimeStr: newTimeFormatted,
            serviceName: service?.name || 'Selected Service',
            stylistName: stylist?.name,
            minutesUntilNewSlot: diffMins,
          });

          await this.sendMessage(cleanNumber, autoRefreshPrompt, phoneNumberId, salonId);
          return {
            replyMessage: autoRefreshPrompt.bodyText,
            state: ConversationState.QUICK_BOOK_CONFIRM,
          };
        }
      } catch (e: any) {
        this.logger.error(`[QuickBookingAction] Error during auto-refresh slot lookup: ${e?.message}`);
      }

      // If no new slot is available today:
      const service = (ctx.salon?.services || []).find(
        (s: any) => s.id === conversation.selectedServiceId,
      );
      const noMoreSlotsReply = {
        bodyText: `⚠️ *No more slots available today* for *${service?.name || 'this service'}*.\n\nAll appointments for today are fully booked or the salon is closed. Would you like to book for an upcoming day with normal booking, or pick another service?`,
        interactiveType: 'button' as const,
        buttons: [
          { id: WhatsAppButtonId.SERVICES, title: '✂️ Other Service' },
          { id: WhatsAppButtonId.BOOK, title: '📅 Normal Booking' },
          { id: WhatsAppButtonId.START, title: '🏠 Main Menu' },
        ],
      };
      await this.session.updateConversationState(conversation.id, ConversationState.START, null);
      await this.sendMessage(cleanNumber, noMoreSlotsReply, phoneNumberId, salonId);
      return { replyMessage: noMoreSlotsReply.bodyText, state: ConversationState.START };
    };

    if (isPastSlot) {
      this.logger.log(`[QuickBookingAction] Slot ${slotTime} has passed by clock, triggering live auto-refresh`);
      return refreshToNextSlot(TimeUtility.formatTime12h(slotTime));
    }

    try {
      const newAppt = await this.appointmentsService.createAppointment(
        salonId,
        {
          customerPhone: cleanNumber,
          customerName: user.name || 'Customer',
          serviceIds: [conversation.selectedServiceId],
          stylistId: conversation.selectedStaffId || undefined,
          date: todayDateStr,
          startTime: slotTime,
          source: BookingSource.QUICK_BOOK,
        },
        undefined,
        { initialStatus: AppointmentStatus.PENDING_ACCEPTANCE } as any,
      );

      await this.session.updateConversationState(
        conversation.id,
        ConversationState.COMPLETED,
        newAppt?.id,
        ActionUtils.getClearDraftData(),
      );

      const pendingReply = this.templates.buildQuickBookPendingReply(newAppt);
      await this.sendMessage(cleanNumber, pendingReply, phoneNumberId, salonId);
      return { replyMessage: pendingReply.bodyText, state: ConversationState.COMPLETED };
    } catch (err: any) {
      this.logger.warn(`[QuickBookingAction] Failed creating quick book appt: ${err?.message}`);
      if (
        conversation.selectedServiceId &&
        (err?.message?.includes('no longer available') ||
          err?.status === 409 ||
          err?.name === 'ConflictException')
      ) {
        return refreshToNextSlot(TimeUtility.formatTime12h(slotTime));
      }

      const errorMsg = {
        bodyText: `⚠️ *Slot Unavailable*\n\nThat quick booking slot was just taken or expired. Please tap below to pick the next available slot!`,
        interactiveType: 'button' as const,
        buttons: [
          { id: WhatsAppButtonId.QUICK_BOOK, title: '⚡ Quick Book' },
          { id: WhatsAppButtonId.START, title: '🏠 Main Menu' },
        ],
      };
      await this.sendMessage(cleanNumber, errorMsg, phoneNumberId, salonId);
      return { replyMessage: errorMsg.bodyText, state: ConversationState.START };
    }
  }
}
