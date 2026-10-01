import { Injectable, Logger, Inject, forwardRef, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { AvailabilityService } from '../../../salon-admin/availability/availability.service';
import { WhatsAppSenderService, WhatsAppButtonId } from '../services/whatsapp-sender.service';
import { WhatsAppTemplateService } from '../services/whatsapp-template.service';
import { WhatsAppSessionService } from '../services/whatsapp-session.service';
import { WhatsAppService } from '../whatsapp.service';
import { ConversationState, AppointmentStatus } from '@prisma/client';
import { TimeUtility } from '../../../../common/utils/time.utility';
import { ActionContext, ActionResult } from './shared/action-context';
import { ActionUtils } from './shared/action-utils';

@Injectable()
export class DraftRecoveryAction {
  private readonly logger = new Logger(DraftRecoveryAction.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: WhatsAppSenderService,
    private readonly templates: WhatsAppTemplateService,
    private readonly session: WhatsAppSessionService,
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
   * Prompts the user when an entry action (Book, Quick Book) is clicked while an in-flight draft is active
   */
  async promptDraftConflict(ctx: ActionContext): Promise<ActionResult> {
    const { cleanNumber, phoneNumberId, salonId, salon, conversation } = ctx;
    this.logger.log(`[DraftRecoveryAction] Prompting draft conflict for user=${cleanNumber} in state=${conversation.state}`);

    let draftDesc = '';
    if (conversation.selectedServiceId) {
      const svc = (salon.services || []).find((s: any) => s.id === conversation.selectedServiceId);
      if (svc) draftDesc = ` for *${svc.name}*`;
    } else if (conversation.selectedCategoryId) {
      const cat = (salon.serviceCategories || []).find((c: any) => c.id === conversation.selectedCategoryId);
      if (cat) draftDesc = ` in *${cat.name}*`;
    }

    const conflictPrompt = {
      bodyText: `⚠️ *Booking In Progress*\n\nYou already have an unfinished booking${draftDesc}.\n\nWould you like to continue your current booking or start a new one?`,
      interactiveType: 'button' as const,
      buttons: [
        { id: WhatsAppButtonId.RESUME_BOOKING, title: '▶️ Continue Booking' },
        { id: WhatsAppButtonId.NEW_BOOKING, title: '📅 New Booking' },
      ],
    };

    await this.sendMessage(cleanNumber, conflictPrompt, phoneNumberId, salonId);
    return { replyMessage: conflictPrompt.bodyText, state: conversation.state };
  }

  /**
   * Intelligently resumes an incomplete draft session when the user clicks [ ▶️ Continue Booking ]
   */
  async resumeIncompleteBooking(ctx: ActionContext): Promise<ActionResult> {
    const { conversation, salon, user, cleanNumber, phoneNumberId, salonId, tz } = ctx;
    this.logger.log(`[DraftRecoveryAction] Resuming draft for user=${cleanNumber} from state=${conversation.state}`);

    const updatedAt = conversation.updatedAt ? new Date(conversation.updatedAt).getTime() : 0;
    const isDraftStale = updatedAt === 0 || Date.now() - updatedAt > 30 * 60 * 1000;

    const isDatePast = conversation.selectedDate
      ? TimeUtility.isPastDate(conversation.selectedDate, tz)
      : false;

    if (isDraftStale || isDatePast || (!conversation.selectedServiceId && !conversation.selectedCategoryId)) {
      return this.handleCheckLastBooking(ctx);
    }

    // Step 0A. If at Name Collection step
    if (conversation.state === ConversationState.COLLECT_NAME && conversation.selectedServiceId) {
      const selectedService = salon.services.find((s: any) => s.id === conversation.selectedServiceId);
      const datePart = conversation.selectedDate || new Date();
      const timeStr = conversation.selectedStartTime
        ? TimeUtility.formatTime24h(conversation.selectedStartTime, tz)
        : '10:00';
      const formattedDate = ActionUtils.formatDateFriendly(datePart, tz, 'dd LLL, EEEE');
      const formattedTime = ActionUtils.formatTime12h(timeStr);

      const namePrompt = this.templates.buildCollectNamePrompt({
        serviceName: selectedService?.name || 'Service',
        dateStr: formattedDate,
        timeStr: formattedTime,
      });
      await this.sendMessage(cleanNumber, namePrompt, phoneNumberId, salonId);
      return { replyMessage: namePrompt.bodyText, state: ConversationState.COLLECT_NAME };
    }

    // Step 0B. If at Quick Book Confirmation step
    if (conversation.state === ConversationState.QUICK_BOOK_CONFIRM && conversation.selectedServiceId) {
      const selectedService = salon.services.find((s: any) => s.id === conversation.selectedServiceId);
      const stylist = conversation.selectedStaffId
        ? (salon.stylists || []).find((st: any) => st.id === conversation.selectedStaffId)
        : null;
      const datePart = conversation.selectedDate || new Date();
      const timeStr = conversation.selectedStartTime
        ? TimeUtility.formatTime24h(conversation.selectedStartTime, tz)
        : '10:00';

      const prompt = this.templates.buildQuickBookConfirmationPrompt({
        salonName: salon.name,
        serviceName: selectedService?.name || 'Service',
        price: selectedService?.price || 0,
        duration: selectedService?.durationMinutes || 30,
        dateFormatted: ActionUtils.formatDateFriendly(datePart, tz),
        timeFormatted: ActionUtils.formatTime12h(timeStr),
        stylistName: stylist?.name || 'First Available Specialist',
      });
      await this.sendMessage(cleanNumber, prompt, phoneNumberId, salonId);
      return { replyMessage: prompt.bodyText, state: ConversationState.QUICK_BOOK_CONFIRM };
    }

    // Step 1. If at Confirmation step and date/time/service present
    if (
      conversation.state === ConversationState.CONFIRMATION &&
      conversation.selectedServiceId &&
      conversation.selectedStartTime
    ) {
      const selectedService = salon.services.find((s: any) => s.id === conversation.selectedServiceId);
      const selectedStaff = salon.stylists?.find((st: any) => st.id === conversation.selectedStaffId);
      const datePart = conversation.selectedDate || new Date();
      const timeStr = TimeUtility.formatTime24h(conversation.selectedStartTime, tz);
      const formattedDate = ActionUtils.formatDateFriendly(datePart, tz, 'dd LLL, EEEE');
      const formattedTime = ActionUtils.formatTime12h(timeStr);
      const slotDateTime = TimeUtility.toJSDate(datePart, timeStr, tz);
      const minutesUntilSlot = (slotDateTime.getTime() - Date.now()) / (1000 * 60);
      const isUrgentWithin15Min = minutesUntilSlot >= 0 && minutesUntilSlot < 15;

      const confirmPrompt = this.templates.buildBookingConfirmationPrompt({
        serviceName: selectedService?.name || 'Service',
        staffName: selectedStaff?.name || 'Any Specialist',
        dateStr: formattedDate,
        timeStr: formattedTime,
        price: selectedService?.price || 0,
        customerName: conversation.customerName || user?.name,
        isUrgentWithin15Min,
      });
      await this.sendMessage(cleanNumber, confirmPrompt, phoneNumberId, salonId);
      return { replyMessage: confirmPrompt.bodyText, state: ConversationState.CONFIRMATION };
    }

    // Step 2. If at Select Time step and date is selected
    if (conversation.selectedDate && conversation.selectedServiceId) {
      const dateStr = TimeUtility.formatDateToISO(conversation.selectedDate, tz);
      const availability = await this.availabilityService.getAvailableSlots(
        salon.id,
        conversation.selectedServiceId,
        dateStr,
        conversation.selectedStaffId || undefined,
      );
      if (availability.availableSlots && availability.availableSlots.length > 0) {
        const slotRows = availability.availableSlots.map((s: any) => ({
          timeStr: s.startTime,
          displayTime: ActionUtils.formatTime12h(s.startTime),
        }));
        const slotMenu = this.templates.buildTimeSlotMenu(slotRows);
        await this.sendMessage(cleanNumber, slotMenu, phoneNumberId, salonId);
        return { replyMessage: slotMenu.bodyText, state: ConversationState.SELECT_TIME };
      }
    }

    // Step 3. If at Select Date step and service is selected
    if (conversation.selectedServiceId) {
      const openDates = await this.availabilityService.findAvailableDates(
        salon.id,
        conversation.selectedServiceId,
        conversation.selectedStaffId,
        2,
      );
      if (openDates.length > 0) {
        const dateMenu = this.templates.buildDateSelectionMenu(openDates);
        await this.sendMessage(cleanNumber, dateMenu, phoneNumberId, salonId);
        return { replyMessage: dateMenu.bodyText, state: ConversationState.SELECT_DATE };
      }
    }

    // Step 4. If at Select Service step and category is selected
    if (conversation.selectedCategoryId) {
      const catId = conversation.selectedCategoryId;
      const selectedCategory = salon.serviceCategories.find((c: any) => c.id === catId);
      const categoryServices = ActionUtils.filterCategoryServices(
        salon.services,
        catId,
        conversation.tempBookingGender,
      );
      if (categoryServices.length > 0) {
        const serviceMenu = this.templates.buildServiceMenu(categoryServices, selectedCategory?.name || 'Services');
        await this.sendMessage(cleanNumber, serviceMenu, phoneNumberId, salonId);
        return { replyMessage: serviceMenu.bodyText, state: ConversationState.SELECT_SERVICE };
      }
    }

    // Step 5. Fallback: Re-render Category Menu
    await this.session.updateConversationState(conversation.id, ConversationState.SELECT_CATEGORY);
    const categories = ActionUtils.filterCategoriesByGender(
      salon.serviceCategories,
      salon.services,
      conversation.tempBookingGender,
    );
    const genderLabel =
      conversation.tempBookingGender && conversation.tempBookingGender !== 'UNISEX'
        ? conversation.tempBookingGender
        : undefined;

    const categoryMenu = this.templates.buildCategoryMenu(
      categories.length > 0 ? categories : salon.serviceCategories || [],
      genderLabel,
    );
    await this.sendMessage(cleanNumber, categoryMenu, phoneNumberId, salonId);
    return { replyMessage: categoryMenu.bodyText, state: ConversationState.SELECT_CATEGORY };
  }

  /**
   * Shows user's last or active booking details when clicking [ 📋 Check Booking ]
   */
  async handleCheckLastBooking(ctx: ActionContext): Promise<ActionResult> {
    const { conversation, salon, cleanNumber, phoneNumberId, salonId } = ctx;
    this.logger.log(`[DraftRecoveryAction] handleCheckLastBooking for user=${cleanNumber}`);

    const lastAppointment = await this.prisma.appointment.findFirst({
      where: {
        salonId,
        salonUser: {
          user: {
            phone: { in: [cleanNumber, `+${cleanNumber}`, cleanNumber.replace(/^\+/, '')] },
          },
        },
      },
      include: { service: true, stylist: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!lastAppointment) {
      const noBookings = this.templates.buildNoBookingsReply(salon);
      await this.sendMessage(cleanNumber, noBookings, phoneNumberId, salonId);
      return { replyMessage: noBookings.bodyText, state: ConversationState.START };
    }

    const activeStatuses: AppointmentStatus[] = [
      AppointmentStatus.BOOKED,
      AppointmentStatus.CONFIRMED,
      AppointmentStatus.ON_THE_WAY,
      AppointmentStatus.CHECKED_IN,
      AppointmentStatus.SEATED_IN_CHAIR,
      AppointmentStatus.PENDING_RESCHEDULE,
    ];

    const isActive = activeStatuses.includes(lastAppointment.status);

    await this.session.updateConversationState(
      conversation.id,
      isActive ? ConversationState.ACTIVE_HUB : ConversationState.START,
      isActive ? lastAppointment.id : null,
      ActionUtils.getClearDraftData(),
    );

    const detailsMsg = this.templates.buildBookingDetailsPrompt(lastAppointment, salon);
    await this.sendMessage(cleanNumber, detailsMsg, phoneNumberId, salonId);
    return {
      replyMessage: detailsMsg.bodyText,
      state: isActive ? ConversationState.ACTIVE_HUB : ConversationState.START,
    };
  }
}
