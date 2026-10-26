import { Injectable, Logger, Inject, forwardRef, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { QuickBookingService } from '../../../salon-admin/quick-booking/quick-booking.service';
import { AvailabilityService } from '../../../salon-admin/availability/availability.service';
import { WhatsAppSenderService, WhatsAppButtonId } from '../services/whatsapp-sender.service';
import { WhatsAppTemplateService } from '../services/whatsapp-template.service';
import { WhatsAppSessionService } from '../services/whatsapp-session.service';
import { WhatsAppService } from '../whatsapp.service';
import { ConversationState, AppointmentStatus, BookingSource } from '@prisma/client';
import { TimeUtility } from '../../../../common/utils/time.utility';
import { ActionContext, ActionResult } from './shared/action-context';
import { ActionUtils } from './shared/action-utils';
import { SlotWindowType } from '../services/time-slot-window.engine';

@Injectable()
export class QuickBookingAction {
  private readonly logger = new Logger(QuickBookingAction.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: WhatsAppSenderService,
    private readonly templates: WhatsAppTemplateService,
    private readonly session: WhatsAppSessionService,
    private readonly quickBookingService: QuickBookingService,
    private readonly availabilityService: AvailabilityService,
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

    // PILLAR 1: Fail-Fast Gatekeeper - Verify Salon is operational right now for Quick Booking
    const operatingStatus = await this.quickBookingService.getOperatingStatus(salonId, tz);

    if (!operatingStatus.isOpen) {
      this.logger.log(
        `[QuickBookingAction] Quick booking gatekeeper blocked entry for salon=${salonId} reason=${operatingStatus.reason}`,
      );
      // Clean up any stale draft data and maintain clean START state
      await this.session.updateConversationState(
        conversation.id,
        ConversationState.START,
        null,
        ActionUtils.getClearDraftData(),
      );
      const closedReply = this.templates.buildQuickBookClosedReply(salon.name, operatingStatus);
      await this.sendMessage(cleanNumber, closedReply, phoneNumberId, salonId);
      return { replyMessage: closedReply.bodyText, state: ConversationState.START };
    }

    await this.session.updateConversationState(conversation.id, ConversationState.SELECT_CATEGORY, undefined, {
      quickCodeVerifiedAt: new Date(),
    });

    const categoryMenu = this.templates.buildQuickBookCategoryMenu(salon.serviceCategories || []);
    await this.sendMessage(cleanNumber, categoryMenu, phoneNumberId, salonId);
    return { replyMessage: categoryMenu.bodyText, state: ConversationState.SELECT_CATEGORY };
  }

  /**
   * Evaluates earliest available slot today for selected service in Quick Book mode
   */
  async handleQuickServiceSelection(ctx: ActionContext, svcId: string, selectedService: any): Promise<ActionResult> {
    const { cleanNumber, phoneNumberId, salonId, salon, conversation, tz } = ctx;
    this.logger.log(`[QuickBookingAction] Evaluating earliest slot for service=${svcId}`);

    // Delegate slot & specialist resolution to QuickBookingService
    const slotResult = await this.quickBookingService.findNextAvailableSlot(salonId, svcId, null, tz);

    if (!slotResult || !slotResult.isAvailable) {
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

    // Dynamic Pivot: If earliest available slot is > 15 minutes away, Quick Booking does not apply.
    // Present today's available time slots and transition the customer into standard Advance Booking.
    if (!slotResult.isImmediateWindow) {
      this.logger.log(
        `[QuickBookingAction] Nearest slot (${slotResult.displayTime}) is ${slotResult.leadTimeMinutes}m away (> 15m). Shifting customer to normal advance booking for today.`,
      );

      const todayStr = TimeUtility.getTodayDate(tz);
      const availability = await this.availabilityService.getAvailableSlots(
        salonId,
        svcId,
        todayStr,
      );

      const slotRows = (availability.availableSlots || []).map((s: any) => ({
        timeStr: s.startTime,
        displayTime: ActionUtils.formatTime12h(s.startTime),
      }));

      if (!slotRows.length) {
        const reply = `⚠️ *No more slots available today* for *${selectedService.name}*.\n\nAll appointments for today are fully booked or the salon is closed. Would you like to book for an upcoming day with normal booking, or pick another service?`;
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

      const nowDt = TimeUtility.now(tz);
      const nowMinutes = nowDt.hour * 60 + nowDt.minute;

      const slotMenu = this.templates.buildTimeSlotMenu(slotRows, false, SlotWindowType.EARLIEST, {
        isToday: true,
        nowMinutes,
        salonName: salon.name,
      });

      slotMenu.bodyText = this.templates.buildNoImmediateSlotNotice(
        selectedService.name,
        slotResult.displayTime || 'later today',
      );

      // Transition session state to SELECT_TIME and clear quickCodeVerifiedAt to revert session to NORMAL booking
      await this.session.updateConversationState(conversation.id, ConversationState.SELECT_TIME, undefined, {
        selectedServiceId: svcId,
        selectedDate: TimeUtility.toDbDate(todayStr),
        selectedStartTime: null,
        selectedStaffId: null,
        quickCodeVerifiedAt: null,
      });

      await this.sendMessage(cleanNumber, slotMenu, phoneNumberId, salonId);
      return { replyMessage: slotMenu.bodyText, state: ConversationState.SELECT_TIME };
    }

    await this.session.updateConversationState(conversation.id, ConversationState.QUICK_BOOK_CONFIRM, undefined, {
      selectedServiceId: svcId,
      selectedDate: slotResult.dateIso,
      selectedStartTime: slotResult.startDt,
      selectedStaffId: slotResult.assignedStylistId,
    });

    const time12h = slotResult.displayTime;
    const dateFriendly = ActionUtils.formatDateFriendly(slotResult.dateStr!, tz);

    const prompt = this.templates.buildQuickBookConfirmationPrompt({
      salonName: salon.name,
      serviceName: selectedService.name,
      price: selectedService.price,
      duration: selectedService.durationMinutes,
      dateFormatted: dateFriendly,
      timeFormatted: time12h,
      stylistName: slotResult.stylistName || 'First Available Specialist',
    });

    await this.sendMessage(cleanNumber, prompt, phoneNumberId, salonId);
    return { replyMessage: prompt.bodyText, state: ConversationState.QUICK_BOOK_CONFIRM };
  }

  /**
   * Confirms Quick Booking via WhatsApp interaction:
   * Delegates slot validation and appointment creation to QuickBookingService,
   * updates the user's session, and sends the interactive WhatsApp reply.
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

    if (!conversation.selectedServiceId) {
      const reply = `⚠️ *No service selected.*\n\nPlease choose a service first.`;
      await this.sendMessage(
        cleanNumber,
        {
          bodyText: reply,
          interactiveType: 'button',
          buttons: [{ id: WhatsAppButtonId.SERVICES, title: '✂️ Services' }],
        },
        phoneNumberId,
        salonId,
      );
      return { replyMessage: reply, state: ConversationState.SELECT_SERVICE };
    }

    const slotTime = conversation.selectedStartTime
      ? TimeUtility.formatTime24h(conversation.selectedStartTime, tz)
      : undefined;

    // Contact QuickBookingService to execute business logic:
    const result = await this.quickBookingService.confirmQuickBooking(salonId, {
      customerPhone: cleanNumber,
      customerName: user.name || 'Customer',
      serviceId: conversation.selectedServiceId,
      stylistId: conversation.selectedStaffId || undefined,
      startTime: slotTime,
      source: BookingSource.QUICK_BOOK,
    });

    if (!result.success) {
      // If slot was refreshed to the next available opening:
      if (result.slotRefreshed && result.refreshedSlot && result.refreshedSlot.isAvailable) {
        const fresh = result.refreshedSlot;

        // If refreshed opening pushed beyond 15m, pivot customer to today's Advance Booking
        if (!fresh.isImmediateWindow) {
          this.logger.log(
            `[QuickBookingAction] Refreshed slot is ${fresh.leadTimeMinutes}m away (> 15m). Pivoting customer to normal advance booking for today.`,
          );

          const todayStr = TimeUtility.getTodayDate(tz);
          const availability = await this.availabilityService.getAvailableSlots(
            salonId,
            conversation.selectedServiceId,
            todayStr,
          );

          const slotRows = (availability.availableSlots || []).map((s: any) => ({
            timeStr: s.startTime,
            displayTime: ActionUtils.formatTime12h(s.startTime),
          }));

          const nowDt = TimeUtility.now(tz);
          const nowMinutes = nowDt.hour * 60 + nowDt.minute;

          const slotMenu = this.templates.buildTimeSlotMenu(slotRows, false, SlotWindowType.EARLIEST, {
            isToday: true,
            nowMinutes,
            salonName: ctx.salon?.name,
          });

          const service = (ctx.salon?.services || []).find((s: any) => s.id === conversation.selectedServiceId);
          slotMenu.bodyText = this.templates.buildNoImmediateSlotNotice(
            service?.name || 'Selected Service',
            fresh.displayTime || 'later today',
          );

          await this.session.updateConversationState(conversation.id, ConversationState.SELECT_TIME, undefined, {
            selectedServiceId: conversation.selectedServiceId,
            selectedDate: TimeUtility.toDbDate(todayStr),
            selectedStartTime: null,
            selectedStaffId: null,
            quickCodeVerifiedAt: null,
          });

          await this.sendMessage(cleanNumber, slotMenu, phoneNumberId, salonId);
          return { replyMessage: slotMenu.bodyText, state: ConversationState.SELECT_TIME };
        }

        await this.session.updateConversationState(
          conversation.id,
          ConversationState.QUICK_BOOK_CONFIRM,
          undefined,
          {
            selectedDate: fresh.dateIso,
            selectedStartTime: fresh.startDt,
            selectedStaffId: fresh.assignedStylistId,
          },
        );

        const service = (ctx.salon?.services || []).find((s: any) => s.id === conversation.selectedServiceId);
        const diffMins = Math.max(0, Math.round((fresh.startDt!.getTime() - Date.now()) / (1000 * 60)));

        const autoRefreshPrompt = this.templates.buildSlotAutoRefreshedReply({
          oldTimeStr: slotTime ? ActionUtils.formatTime12h(slotTime, tz) : 'Previous Time',
          newTimeStr: fresh.displayTime!,
          serviceName: service?.name || 'Selected Service',
          stylistName: fresh.stylistName,
          minutesUntilNewSlot: diffMins,
        });

        await this.sendMessage(cleanNumber, autoRefreshPrompt, phoneNumberId, salonId);
        return { replyMessage: autoRefreshPrompt.bodyText, state: ConversationState.QUICK_BOOK_CONFIRM };
      }

      // No more slots available today:
      const service = (ctx.salon?.services || []).find((s: any) => s.id === conversation.selectedServiceId);
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
    }

    // Success! Update WhatsApp conversation state & notify customer
    await this.session.updateConversationState(
      conversation.id,
      ConversationState.COMPLETED,
      result.appointment?.id,
      ActionUtils.getClearDraftData(),
    );

    const pendingReply = this.templates.buildQuickBookPendingReply(result.appointment);
    await this.sendMessage(cleanNumber, pendingReply, phoneNumberId, salonId);
    return { replyMessage: pendingReply.bodyText, state: ConversationState.COMPLETED };
  }
}
