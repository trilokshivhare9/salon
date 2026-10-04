import { Injectable, Logger, Inject, forwardRef, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { AppointmentsService } from '../../../salon-admin/appointments/appointments.service';
import { AvailabilityService } from '../../../salon-admin/availability/availability.service';
import { WhatsAppSenderService, WhatsAppButtonId } from '../services/whatsapp-sender.service';
import { WhatsAppTemplateService } from '../services/whatsapp-template.service';
import { WhatsAppSessionService } from '../services/whatsapp-session.service';
import { WhatsAppService } from '../whatsapp.service';
import { ConversationState, AppointmentStatus, BookingSource, ServiceGender } from '@prisma/client';
import { TimeUtility } from '../../../../common/utils/time.utility';
import { ActionContext, ActionResult } from './shared/action-context';
import { ActionUtils } from './shared/action-utils';
import { QuickBookingAction } from './quick-booking.action';
import { SlotWindowType } from '../services/time-slot-window.engine';

@Injectable()
export class BookingAction {
  private readonly logger = new Logger(BookingAction.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: WhatsAppSenderService,
    private readonly templates: WhatsAppTemplateService,
    private readonly session: WhatsAppSessionService,
    private readonly availabilityService: AvailabilityService,
    private readonly quickBookingAction: QuickBookingAction,
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
   * Main Dispatcher for Booking Funnel actions
   */
  async handle(ctx: ActionContext): Promise<ActionResult> {
    const { input, normalizedInput, cleanNumber, conversation } = ctx;
    this.logger.log(`[BookingAction] Handling input="${input}" in state="${conversation.state}" for user=${cleanNumber}`);

    // 1. Add-on Service Action
    if (input === WhatsAppButtonId.ADD_SERVICE || input === 'btn_add_service') {
      return this.handleAddService(ctx);
    }

    // 2. Start Booking / Services / New Booking
    if (['btn_book', 'btn_services', 'btn_book_now', 'btn_new_booking'].includes(input)) {
      return this.handleStartBooking(ctx);
    }

    // 3. Gender Selection / Switch
    if (input === WhatsAppButtonId.SWITCH_GENDER || input === 'btn_switch_gender') {
      return this.handlePromptGenderMenu(ctx);
    }
    if (input.startsWith('gender_select_')) {
      return this.handleGenderSelected(ctx);
    }

    // 4. Back to Category Menu
    if (input === WhatsAppButtonId.CAT_BACK || input === 'cat_back') {
      return this.handleCategoryBack(ctx);
    }

    // 5. Category Selected
    if (input.startsWith('cat_')) {
      return this.handleCategorySelected(ctx);
    }

    // 6. Service Selected
    if (input.startsWith('svc_')) {
      return this.handleServiceSelected(ctx);
    }

    // 7. Staff Selected
    if (input.startsWith('staff_')) {
      return this.handleStaffSelected(ctx);
    }

    // 8. Date Selected
    if (input.startsWith('date_')) {
      return this.handleDateSelected(ctx);
    }

    // 9.0 Time Slot Window Navigation (Afternoon / Evening / Earliest)
    if (input.startsWith('window_')) {
      return this.handleSlotWindowSwitched(ctx);
    }

    // 9. Time Slot Selected
    if (input.startsWith('slot_')) {
      return this.handleSlotSelected(ctx);
    }

    // 9.1 In-Funnel Time / Date Re-selection (Bypasses top-level Collision Guard)
    if (input === WhatsAppButtonId.CHANGE_TIME || input === 'btn_change_time') {
      return this.handleTimeReSelection(ctx);
    }

    if (input === WhatsAppButtonId.CHANGE_DATE || input === 'btn_change_date') {
      return this.handleDateReSelection(ctx);
    }

    // 10. Customer Name Input
    if (conversation.state === ConversationState.COLLECT_NAME) {
      return this.handleNameCollected(ctx);
    }

    // 11. Final Confirmation
    if (
      conversation.state === ConversationState.CONFIRMATION &&
      ['btn_confirm_yes', 'btn_confirm', 'yes', 'confirm'].includes(normalizedInput)
    ) {
      return this.handleFinalConfirmation(ctx);
    }

    // Default Fallback
    let isQuickBookOpen = true;
    try {
      isQuickBookOpen = await this.availabilityService.isQuickBookingOperationalToday(ctx.salonId, ctx.tz);
    } catch (err) {
      isQuickBookOpen = true;
    }
    const defaultWelcome = this.templates.buildWelcomeMessage(ctx.salon, ctx.activeAppointment, { isQuickBookOpen });
    await this.sendMessage(cleanNumber, defaultWelcome, ctx.phoneNumberId, ctx.salonId);
    return { replyMessage: defaultWelcome.bodyText, state: ConversationState.START };
  }

  /**
   * Add-on Service: filters out already-booked service
   */
  private async handleAddService(ctx: ActionContext): Promise<ActionResult> {
    const { cleanNumber, phoneNumberId, salonId, salon, conversation, activeAppointment, pendingAppointment } = ctx;

    if (!activeAppointment && pendingAppointment) {
      const blockedReply = this.templates.buildPendingModificationBlockedReply();
      await this.sendMessage(cleanNumber, blockedReply, phoneNumberId, salonId);
      return { replyMessage: blockedReply.bodyText, state: conversation.state };
    }

    const availableAddons = (salon.services || []).filter((s: any) => !activeAppointment || s.id !== activeAppointment.serviceId);

    if (availableAddons.length === 0) {
      const reply = `You already have all available services included in your visit!`;
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

    await this.session.updateConversationState(conversation.id, ConversationState.SELECT_CATEGORY);
    const categoryMenu = this.templates.buildCategoryMenu(salon.serviceCategories || []);
    categoryMenu.bodyText = `✨ *Choose a service category to add to your appointment:*`;
    await this.sendMessage(cleanNumber, categoryMenu, phoneNumberId, salonId);
    return { replyMessage: categoryMenu.bodyText, state: ConversationState.SELECT_CATEGORY };
  }

  /**
   * Start Booking: Auto-detects single-gender salons and avoids repetitive gender selection
   */
  private async handleStartBooking(ctx: ActionContext): Promise<ActionResult> {
    const { cleanNumber, phoneNumberId, salonId, salon, conversation } = ctx;

    await this.session.updateConversationState(conversation.id, ConversationState.SELECT_CATEGORY, undefined, {
      quickCodeVerifiedAt: null,
    });

    let effectiveGender = conversation.tempBookingGender;

    // Auto-detect single-gender salon
    if (!effectiveGender && salon.services && salon.services.length > 0) {
      const activeTargetGenders = new Set(
        salon.services.map((s: any) => s.targetGender || s.gender).filter((g: any) => g && g !== 'UNISEX'),
      );
      if (activeTargetGenders.size === 1) {
        effectiveGender = Array.from(activeTargetGenders)[0] as ServiceGender;
        await this.session.updateConversationState(conversation.id, ConversationState.SELECT_CATEGORY, undefined, {
          tempBookingGender: effectiveGender,
        });
      }
    }

    if (effectiveGender) {
      const categories = ActionUtils.filterCategoriesByGender(salon.serviceCategories, salon.services, effectiveGender);
      const genderLabel = effectiveGender !== 'UNISEX' ? effectiveGender : undefined;
      const categoryMenu = this.templates.buildCategoryMenu(
        categories.length > 0 ? categories : salon.serviceCategories || [],
        genderLabel,
      );
      await this.sendMessage(cleanNumber, categoryMenu, phoneNumberId, salonId);
      return { replyMessage: categoryMenu.bodyText, state: ConversationState.SELECT_CATEGORY };
    }

    const genderMenu = this.templates.buildGenderSelectionMenu();
    await this.sendMessage(cleanNumber, genderMenu, phoneNumberId, salonId);
    return { replyMessage: genderMenu.bodyText, state: ConversationState.SELECT_CATEGORY };
  }

  private async handlePromptGenderMenu(ctx: ActionContext): Promise<ActionResult> {
    const { cleanNumber, phoneNumberId, salonId, conversation } = ctx;
    await this.session.updateConversationState(conversation.id, ConversationState.SELECT_CATEGORY);
    const genderMenu = this.templates.buildGenderSelectionMenu();
    await this.sendMessage(cleanNumber, genderMenu, phoneNumberId, salonId);
    return { replyMessage: genderMenu.bodyText, state: ConversationState.SELECT_CATEGORY };
  }

  private async handleGenderSelected(ctx: ActionContext): Promise<ActionResult> {
    const { input, cleanNumber, phoneNumberId, salonId, salon, conversation } = ctx;
    const tempBookingGender = input.replace('gender_select_', '') as ServiceGender;
    await this.session.updateConversationState(conversation.id, ConversationState.SELECT_CATEGORY, undefined, {
      tempBookingGender,
    });

    const categories = ActionUtils.filterCategoriesByGender(salon.serviceCategories, salon.services, tempBookingGender);
    const genderLabel = tempBookingGender !== 'UNISEX' ? tempBookingGender : undefined;
    const categoryMenu = this.templates.buildCategoryMenu(
      categories.length > 0 ? categories : salon.serviceCategories || [],
      genderLabel,
    );
    await this.sendMessage(cleanNumber, categoryMenu, phoneNumberId, salonId);
    return { replyMessage: categoryMenu.bodyText, state: ConversationState.SELECT_CATEGORY };
  }

  private async handleCategoryBack(ctx: ActionContext): Promise<ActionResult> {
    const { cleanNumber, phoneNumberId, salonId, salon, conversation } = ctx;
    await this.session.updateConversationState(conversation.id, ConversationState.SELECT_CATEGORY);
    const gender = conversation.tempBookingGender;
    const categories = ActionUtils.filterCategoriesByGender(salon.serviceCategories, salon.services, gender);
    const genderLabel = gender && gender !== 'UNISEX' ? gender : undefined;
    const categoryMenu = this.templates.buildCategoryMenu(
      categories.length > 0 ? categories : salon.serviceCategories || [],
      genderLabel,
    );
    await this.sendMessage(cleanNumber, categoryMenu, phoneNumberId, salonId);
    return { replyMessage: categoryMenu.bodyText, state: ConversationState.SELECT_CATEGORY };
  }

  private async handleCategorySelected(ctx: ActionContext): Promise<ActionResult> {
    const { input, cleanNumber, phoneNumberId, salonId, salon, conversation } = ctx;
    const catId = input.replace('cat_', '');
    const selectedCategory = salon.serviceCategories?.find((c: any) => c.id === catId);
    const gender = conversation.tempBookingGender;

    const categoryServices = ActionUtils.filterCategoryServices(salon.services, catId, gender);

    if (categoryServices.length === 0) {
      const reply = `⚠️ No services found in this category for the selected section. Please pick another category:`;
      const categories = ActionUtils.filterCategoriesByGender(salon.serviceCategories, salon.services, gender);
      const categoryMenu = this.templates.buildCategoryMenu(
        categories.length > 0 ? categories : salon.serviceCategories || [],
      );
      categoryMenu.bodyText = reply;
      await this.sendMessage(cleanNumber, categoryMenu, phoneNumberId, salonId);
      return { replyMessage: reply, state: ConversationState.SELECT_CATEGORY };
    }

    await this.session.updateConversationState(conversation.id, ConversationState.SELECT_SERVICE, undefined, {
      selectedCategoryId: catId,
    });

    const serviceMenu = this.templates.buildServiceMenu(categoryServices, selectedCategory?.name || 'Services');
    await this.sendMessage(cleanNumber, serviceMenu, phoneNumberId, salonId);
    return { replyMessage: serviceMenu.bodyText, state: ConversationState.SELECT_SERVICE };
  }

  private async handleServiceSelected(ctx: ActionContext): Promise<ActionResult> {
    const { input, cleanNumber, phoneNumberId, salonId, salon, conversation } = ctx;
    const svcId = input.replace('svc_', '');
    const selectedService = (salon.services || []).find((s: any) => s.id === svcId);

    if (!selectedService) {
      const reply = `⚠️ Selected service not found. Please choose another service:`;
      const serviceMenu = this.templates.buildServiceMenu(salon.services || [], 'Services');
      serviceMenu.bodyText = reply;
      await this.sendMessage(cleanNumber, serviceMenu, phoneNumberId, salonId);
      return { replyMessage: reply, state: ConversationState.SELECT_SERVICE };
    }

    const bookingType = this.session.getBookingType(conversation);

    if (bookingType === 'QUICK') {
      return this.quickBookingAction.handleQuickServiceSelection(ctx, svcId, selectedService);
    }

    const qualifiedStylists = await this.availabilityService.getQualifiedStylists(salonId, svcId);

    if (qualifiedStylists.length === 0) {
      const reply = `⚠️ Sorry, no specialists are currently assigned to perform *${selectedService.name}*. Please choose another service:`;
      await this.sendMessage(
        cleanNumber,
        {
          bodyText: reply,
          interactiveType: 'button',
          buttons: [
            { id: WhatsAppButtonId.SERVICES, title: '✂️ All Services' },
            { id: WhatsAppButtonId.START, title: '🏠 Main Menu' },
          ],
        },
        phoneNumberId,
        salonId,
      );
      return { replyMessage: reply, state: ConversationState.SELECT_SERVICE };
    }

    await this.session.updateConversationState(conversation.id, ConversationState.SELECT_STAFF, undefined, {
      selectedServiceId: svcId,
    });

    const staffMenu = this.templates.buildStaffSelectionMenu(qualifiedStylists);
    await this.sendMessage(cleanNumber, staffMenu, phoneNumberId, salonId);
    return { replyMessage: staffMenu.bodyText, state: ConversationState.SELECT_STAFF };
  }

  private async handleStaffSelected(ctx: ActionContext): Promise<ActionResult> {
    const { input, cleanNumber, phoneNumberId, salonId, conversation } = ctx;
    const staffId = input.replace('staff_', '');
    const selectedStaffId = staffId === 'any' ? null : staffId;

    await this.session.updateConversationState(conversation.id, ConversationState.SELECT_DATE, undefined, {
      selectedStaffId,
    });

    const openDates = await this.availabilityService.findAvailableDates(
      salonId,
      conversation.selectedServiceId!,
      selectedStaffId,
      2,
    );

    if (openDates.length === 0) {
      const isSpecificStaff = !!selectedStaffId;
      const reply = isSpecificStaff
        ? `⚠️ No available slots found in the next 7 days for the selected specialist. Would you like to check with Any Specialist or choose another service?`
        : `⚠️ All slots in the next 7 days are fully booked for this service. Please choose another service or contact the salon directly.`;

      const buttons = isSpecificStaff
        ? [
            { id: WhatsAppButtonId.STAFF_ANY, title: '✨ Any Specialist' },
            { id: WhatsAppButtonId.SERVICES, title: '✂️ Other Services' },
            { id: WhatsAppButtonId.START, title: '🏠 Main Menu' },
          ]
        : [
            { id: WhatsAppButtonId.SERVICES, title: '✂️ Other Services' },
            { id: WhatsAppButtonId.START, title: '🏠 Main Menu' },
          ];

      await this.sendMessage(
        cleanNumber,
        {
          bodyText: reply,
          interactiveType: 'button',
          buttons,
        },
        phoneNumberId,
        salonId,
      );
      return { replyMessage: reply, state: ConversationState.SELECT_STAFF };
    }

    const dateMenu = this.templates.buildDateSelectionMenu(openDates);
    await this.sendMessage(cleanNumber, dateMenu, phoneNumberId, salonId);
    return { replyMessage: dateMenu.bodyText, state: ConversationState.SELECT_DATE };
  }

  private async handleDateSelected(ctx: ActionContext): Promise<ActionResult> {
    const { input, cleanNumber, phoneNumberId, salonId, salon, conversation } = ctx;
    const tz = salon.timezone || TimeUtility.DEFAULT_TIMEZONE;
    const dateStr = input.replace('date_', '');

    const availability = await this.availabilityService.getAvailableSlots(
      salonId,
      conversation.selectedServiceId!,
      dateStr,
      conversation.selectedStaffId || undefined,
    );

    if (!availability.availableSlots || availability.availableSlots.length === 0) {
      let reasonText = `No slots available on *${dateStr}*.`;
      if (availability.status === 'SALON_CLOSED') {
        reasonText = `The salon is closed on this date (${availability.statusReason || 'Salon Closed'}).`;
      } else if (availability.status === 'FULLY_BOOKED') {
        reasonText = `All time slots on *${dateStr}* are fully booked!`;
      } else if (availability.status === 'STAFF_UNAVAILABLE') {
        reasonText = `The selected specialist is not available on *${dateStr}*.`;
      }

      const altDates = await this.availabilityService.findAvailableDates(
        salonId,
        conversation.selectedServiceId!,
        conversation.selectedStaffId,
        2,
      );

      if (altDates.length > 0) {
        const dateMenu = this.templates.buildDateSelectionMenu(altDates);
        dateMenu.bodyText = `⚠️ ${reasonText}\n\nPlease choose another date below:`;
        await this.sendMessage(cleanNumber, dateMenu, phoneNumberId, salonId);
        return { replyMessage: dateMenu.bodyText, state: ConversationState.SELECT_DATE };
      }

      const reply = `⚠️ ${reasonText}\n\nNo available slots were found in the near future. Please choose another service or contact the salon.`;
      await this.sendMessage(
        cleanNumber,
        {
          bodyText: reply,
          interactiveType: 'button',
          buttons: [
            { id: WhatsAppButtonId.SERVICES, title: '✂️ Other Services' },
            { id: WhatsAppButtonId.START, title: '🏠 Main Menu' },
          ],
        },
        phoneNumberId,
        salonId,
      );
      return { replyMessage: reply, state: ConversationState.START };
    }

    await this.session.updateConversationState(conversation.id, ConversationState.SELECT_TIME, undefined, {
      selectedDate: TimeUtility.toDbDate(dateStr),
    });

    const slotRows = availability.availableSlots.map((s) => ({
      timeStr: s.startTime,
      displayTime: ActionUtils.formatTime12h(s.startTime),
    }));

    const nowDt = TimeUtility.now(tz);
    const isToday = dateStr === nowDt.toISODate();
    const nowMinutes = nowDt.hour * 60 + nowDt.minute;

    const slotMenu = this.templates.buildTimeSlotMenu(slotRows, false, SlotWindowType.EARLIEST, {
      isToday,
      nowMinutes,
      salonName: salon.name,
    });
    await this.sendMessage(cleanNumber, slotMenu, phoneNumberId, salonId);
    return { replyMessage: slotMenu.bodyText, state: ConversationState.SELECT_TIME };
  }

  private async handleSlotWindowSwitched(ctx: ActionContext): Promise<ActionResult> {
    const { input, cleanNumber, phoneNumberId, salonId, conversation, tz } = ctx;
    const targetWindow = input.replace('window_', '') as SlotWindowType;

    const datePart = conversation.selectedDate || new Date();
    const dateStr = TimeUtility.formatDateToISO(datePart, tz);

    const availability = await this.availabilityService.getAvailableSlots(
      salonId,
      conversation.selectedServiceId!,
      dateStr,
      conversation.selectedStaffId || undefined,
    );

    const slotRows = (availability.availableSlots || []).map((s: any) => ({
      timeStr: s.startTime,
      displayTime: ActionUtils.formatTime12h(s.startTime),
    }));

    const nowDt = TimeUtility.now(tz);
    const isToday = dateStr === nowDt.toISODate();
    const nowMinutes = nowDt.hour * 60 + nowDt.minute;

    const slotMenu = this.templates.buildTimeSlotMenu(slotRows, false, targetWindow, {
      isToday,
      nowMinutes,
    });
    await this.sendMessage(cleanNumber, slotMenu, phoneNumberId, salonId);
    return { replyMessage: slotMenu.bodyText, state: ConversationState.SELECT_TIME };
  }

  private async handleSlotSelected(ctx: ActionContext): Promise<ActionResult> {
    const { input, cleanNumber, phoneNumberId, salonId, salon, user, conversation, tz } = ctx;
    const timeStr = input.replace('slot_', '');
    const selectedService = (salon.services || []).find((s: any) => s.id === conversation.selectedServiceId);
    const selectedStaff = salon.stylists?.find((st: any) => st.id === conversation.selectedStaffId);

    const datePart = conversation.selectedDate || new Date();
    const slotDateTime = TimeUtility.toJSDate(datePart, timeStr, tz);

    const formattedDate = ActionUtils.formatDateFriendly(datePart, tz, 'dd LLL, EEEE');
    const formattedTime = ActionUtils.formatTime12h(timeStr);

    const minutesUntilSlot = (slotDateTime.getTime() - Date.now()) / (1000 * 60);

    // Pillar 1: Pre-Commit Clock & Availability Freshness Guard
    // If the slot has already passed the clock (e.g. user replied minutes late)
    if (minutesUntilSlot <= 0) {
      this.logger.warn(
        `[BookingAction] Slot ${timeStr} on ${formattedDate} has already passed clock (${minutesUntilSlot.toFixed(1)}m ago). Auto-refreshing.`,
      );

      const dateStr = TimeUtility.formatDateToISO(datePart, tz);
      const availability = await this.availabilityService.getAvailableSlots(
        salonId,
        conversation.selectedServiceId,
        dateStr,
        conversation.selectedStaffId || undefined,
      );

      if (availability.availableSlots && availability.availableSlots.length > 0) {
        const slotRows = availability.availableSlots.map((s: any) => ({
          timeStr: s.startTime,
          displayTime: ActionUtils.formatTime12h(s.startTime),
        }));
        const nowDt = TimeUtility.now(tz);
        const isToday = dateStr === nowDt.toISODate();
        const nowMinutes = nowDt.hour * 60 + nowDt.minute;

        const slotMenu = this.templates.buildTimeSlotMenu(slotRows, false, SlotWindowType.EARLIEST, {
          isToday,
          nowMinutes,
        });
        slotMenu.bodyText = `⚠️ *Slot Passed*\n\nThe slot at *${formattedTime}* has already passed. Please select from the latest available times today:`;
        await this.sendMessage(cleanNumber, slotMenu, phoneNumberId, salonId);
        return { replyMessage: slotMenu.bodyText, state: ConversationState.SELECT_TIME };
      } else {
        const noMoreMsg = {
          bodyText: `⚠️ *Slot Passed & No More Slots Today*\n\nThe slot at *${formattedTime}* has passed, and all other appointments for today are fully booked.\n\nWould you like to pick an upcoming date?`,
          interactiveType: 'button' as const,
          buttons: [
            { id: WhatsAppButtonId.CHANGE_DATE, title: '📅 Pick Another Date' },
            { id: WhatsAppButtonId.START, title: '🏠 Main Menu' },
          ],
        };
        await this.sendMessage(cleanNumber, noMoreMsg, phoneNumberId, salonId);
        return { replyMessage: noMoreMsg.bodyText, state: ConversationState.SELECT_DATE };
      }
    }

    const hasReal = ActionUtils.hasRealName(user);
    const effectiveName = conversation.customerName || (hasReal ? user.name : null);
    const isUrgentWithin15Min = minutesUntilSlot >= 0 && minutesUntilSlot < 15;

    if (!effectiveName) {
      await this.session.updateConversationState(conversation.id, ConversationState.COLLECT_NAME, undefined, {
        selectedStartTime: slotDateTime,
      });

      const namePrompt = this.templates.buildCollectNamePrompt({
        serviceName: selectedService?.name || 'Service',
        dateStr: formattedDate,
        timeStr: formattedTime,
      });
      await this.sendMessage(cleanNumber, namePrompt, phoneNumberId, salonId);
      return { replyMessage: namePrompt.bodyText, state: ConversationState.COLLECT_NAME };
    }

    await this.session.updateConversationState(conversation.id, ConversationState.CONFIRMATION, undefined, {
      selectedStartTime: slotDateTime,
      customerName: effectiveName,
    });

    const confirmPrompt = this.templates.buildBookingConfirmationPrompt({
      serviceName: selectedService?.name || 'Service',
      staffName: selectedStaff?.name || 'Any Specialist',
      dateStr: formattedDate,
      timeStr: formattedTime,
      price: selectedService?.price || 0,
      customerName: effectiveName,
      isUrgentWithin15Min,
    });
    await this.sendMessage(cleanNumber, confirmPrompt, phoneNumberId, salonId);
    return { replyMessage: confirmPrompt.bodyText, state: ConversationState.CONFIRMATION };
  }

  private async handleNameCollected(ctx: ActionContext): Promise<ActionResult> {
    const { input, cleanNumber, phoneNumberId, salonId, salon, conversation, tz } = ctx;
    const enteredName = (input || '').trim();

    if (
      !enteredName ||
      enteredName.length < 2 ||
      enteredName.startsWith('btn_') ||
      enteredName.startsWith('cat_') ||
      enteredName.startsWith('svc_') ||
      enteredName.startsWith('slot_') ||
      enteredName.startsWith('staff_')
    ) {
      const retryMsg = `⚠️ Please reply with your full name (at least 2 letters) so our team can prepare for your visit:`;
      await this.sendMessage(cleanNumber, { bodyText: retryMsg }, phoneNumberId, salonId);
      return { replyMessage: retryMsg, state: ConversationState.COLLECT_NAME };
    }

    await this.prisma.user.updateMany({
      where: {
        phone: { in: [cleanNumber, `+${cleanNumber}`, cleanNumber.replace(/^\+/, '')] },
      },
      data: { name: enteredName },
    });

    this.session.invalidateUserCache(salonId, cleanNumber);

    await this.session.updateConversationState(conversation.id, ConversationState.CONFIRMATION, undefined, {
      customerName: enteredName,
    });

    const selectedService = (salon.services || []).find((s: any) => s.id === conversation.selectedServiceId);
    const selectedStaff = salon.stylists?.find((st: any) => st.id === conversation.selectedStaffId);
    const datePart = conversation.selectedDate || new Date();
    const timeStr = conversation.selectedStartTime
      ? TimeUtility.formatTime24h(conversation.selectedStartTime, tz)
      : '10:00';
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
      customerName: enteredName,
      isUrgentWithin15Min,
    });
    await this.sendMessage(cleanNumber, confirmPrompt, phoneNumberId, salonId);
    return { replyMessage: confirmPrompt.bodyText, state: ConversationState.CONFIRMATION };
  }

  private async handleFinalConfirmation(ctx: ActionContext): Promise<ActionResult> {
    const { cleanNumber, phoneNumberId, salonId, salon, user, conversation, tz } = ctx;

    const timeStr = conversation.selectedStartTime
      ? TimeUtility.formatTime24h(conversation.selectedStartTime, tz)
      : '10:00';
    const dateStr = conversation.selectedDate
      ? TimeUtility.toDateString(conversation.selectedDate)
      : TimeUtility.getTodayDate(tz);

    const finalCustomerName =
      conversation.customerName ||
      (user?.name && ActionUtils.hasRealName(user) ? user.name : null) ||
      'Valued Customer';

    // 15-Minute Slot Auto-Redirect Check
    const slotDateTime = TimeUtility.toJSDate(dateStr, timeStr, tz);
    const minutesUntilSlot = (slotDateTime.getTime() - Date.now()) / (1000 * 60);

    try {
      if (minutesUntilSlot < 15) {
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
          const timeStrFormatted = ActionUtils.formatTime12h(existingPending.startAt, tz);
          const conflictPrompt = this.templates.buildPendingRequestConflictPrompt({
            serviceName: existingPending.service?.name || existingPending.serviceNameSnapshot || 'Service',
            timeStr: timeStrFormatted,
            stylistName: existingPending.stylist?.name,
          });
          await this.sendMessage(cleanNumber, conflictPrompt, phoneNumberId, salonId);
          return { replyMessage: conflictPrompt.bodyText, state: conversation.state };
        }

        const newAppt = await this.appointmentsService.createAppointment(
          salonId,
          {
            customerPhone: cleanNumber,
            customerName: finalCustomerName,
            serviceIds: [conversation.selectedServiceId],
            stylistId: conversation.selectedStaffId || undefined,
            date: dateStr,
            startTime: timeStr,
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
        const pendingReply = this.templates.buildQuickBookPendingReply(newAppt, true);
        await this.sendMessage(cleanNumber, pendingReply, phoneNumberId, salonId);
        return { replyMessage: pendingReply.bodyText, state: ConversationState.COMPLETED };
      }

      const newAppt = await this.appointmentsService.createAppointment(salonId, {
        customerPhone: cleanNumber,
        customerName: finalCustomerName,
        serviceIds: [conversation.selectedServiceId],
        stylistId: conversation.selectedStaffId || undefined,
        date: dateStr,
        startTime: timeStr,
        source: BookingSource.WHATSAPP,
      });

      await this.session.updateConversationState(
        conversation.id,
        ConversationState.START,
        newAppt.id,
        ActionUtils.getClearDraftData(),
      );
      const successReply = this.templates.buildBookingSuccessReply(newAppt, tz, salon);
      await this.sendMessage(cleanNumber, successReply, phoneNumberId, salonId);
      return { replyMessage: successReply.bodyText, state: ConversationState.START };
    } catch (err: any) {
      this.logger.warn(`[BookingAction] Failed creating appointment: ${err?.message}`);

      // Pillar 2: Toxic State Eviction & Direct Slot Recovery
      // 1. Immediately wipe the dead slot in DB so draft is clean and never deadlocks
      await this.session.updateConversationState(
        conversation.id,
        ConversationState.SELECT_TIME,
        undefined,
        { selectedStartTime: null },
      );

      // 2. Query fresh live slots for this date
      const availability = await this.availabilityService.getAvailableSlots(
        salonId,
        conversation.selectedServiceId,
        dateStr,
        conversation.selectedStaffId || undefined,
      );

      const nowDt = TimeUtility.now(tz);
      const isToday = dateStr === nowDt.toISODate();
      const nowMinutes = nowDt.hour * 60 + nowDt.minute;

      if (availability.availableSlots && availability.availableSlots.length > 0) {
        const slotRows = availability.availableSlots.map((s: any) => ({
          timeStr: s.startTime,
          displayTime: ActionUtils.formatTime12h(s.startTime),
        }));
        const slotMenu = this.templates.buildTimeSlotMenu(slotRows, false, SlotWindowType.EARLIEST, {
          isToday,
          nowMinutes,
          salonName: salon.name,
        });
        slotMenu.bodyText = `⚠️ *Slot Unavailable*\n\nThe slot at *${ActionUtils.formatTime12h(timeStr)}* was just booked or is no longer available. Please select another time slot from the list below:`;
        await this.sendMessage(cleanNumber, slotMenu, phoneNumberId, salonId);
        return { replyMessage: slotMenu.bodyText, state: ConversationState.SELECT_TIME };
      } else {
        const noMoreMsg = {
          bodyText: `⚠️ *No More Slots Available Today*\n\nThe slot at *${ActionUtils.formatTime12h(timeStr)}* is no longer available, and all remaining slots for today are fully booked.\n\nWould you like to pick another date?`,
          interactiveType: 'button' as const,
          buttons: [
            { id: WhatsAppButtonId.CHANGE_DATE, title: '📅 Pick Another Date' },
            { id: WhatsAppButtonId.START, title: '🏠 Main Menu' },
          ],
        };
        await this.sendMessage(cleanNumber, noMoreMsg, phoneNumberId, salonId);
        return { replyMessage: noMoreMsg.bodyText, state: ConversationState.SELECT_DATE };
      }
    }
  }

  /**
   * Direct Service Chosen handler for catalog lists
   */
  async handleServiceChosen(
    conversationId: string,
    customerPhone: string,
    salon: any,
    service: any,
    phoneNumberId?: string,
  ): Promise<ActionResult> {
    const cleanNumber = this.sender.cleanPhone(customerPhone);
    const tz = salon.timezone || 'Asia/Kolkata';
    const todayDateStr = TimeUtility.getTodayDate(tz);

    const availableSlots: any = await this.availabilityService.getAvailableSlots(
      salon.id,
      service.id,
      todayDateStr,
    );

    if (!availableSlots || !availableSlots.availableSlots || availableSlots.availableSlots.length === 0) {
      const reply = `⚠️ *Fully Booked Today!*\n\nSorry, no available slots remain for *${service.name}* today. Please select another date or service.`;
      await this.sendMessage(
        cleanNumber,
        {
          bodyText: reply,
          interactiveType: 'button',
          buttons: [
            { id: WhatsAppButtonId.BOOK, title: '📅 Select Date' },
            { id: WhatsAppButtonId.START, title: '🏠 Main Menu' },
          ],
        },
        phoneNumberId,
        salon.id,
      );
      return { replyMessage: reply, state: ConversationState.START };
    }

    await this.session.updateConversationState(conversationId, ConversationState.SELECT_STAFF, undefined, {
      selectedServiceId: service.id,
    });

    const qualifiedStylists = await this.availabilityService.getQualifiedStylists(salon.id, service.id);
    const staffMenu = this.templates.buildStaffSelectionMenu(qualifiedStylists);
    await this.sendMessage(cleanNumber, staffMenu, phoneNumberId, salon.id);
    return { replyMessage: staffMenu.bodyText, state: ConversationState.SELECT_STAFF };
  }

  /**
   * In-Funnel Time Slot Re-Selection (Bypasses Entry Collision Guard)
   */
  async handleTimeReSelection(ctx: ActionContext): Promise<ActionResult> {
    const { cleanNumber, phoneNumberId, salonId, salon, conversation } = ctx;
    const tz = salon.timezone || TimeUtility.DEFAULT_TIMEZONE;
    if (!conversation.selectedServiceId) {
      return this.handleStartBooking(ctx);
    }
    const datePart = conversation.selectedDate || new Date();
    const dateStr = TimeUtility.formatDateToISO(datePart, tz);
    const nowDt = TimeUtility.now(tz);
    const isToday = dateStr === nowDt.toISODate();
    const nowMinutes = nowDt.hour * 60 + nowDt.minute;

    await this.session.updateConversationState(
      conversation.id,
      ConversationState.SELECT_TIME,
      undefined,
      { selectedStartTime: null },
    );

    const availability = await this.availabilityService.getAvailableSlots(
      salonId,
      conversation.selectedServiceId,
      dateStr,
      conversation.selectedStaffId || undefined,
    );

    if (availability.availableSlots && availability.availableSlots.length > 0) {
      const slotRows = availability.availableSlots.map((s: any) => ({
        timeStr: s.startTime,
        displayTime: ActionUtils.formatTime12h(s.startTime),
      }));
      const slotMenu = this.templates.buildTimeSlotMenu(slotRows, false, SlotWindowType.EARLIEST, {
        isToday,
        nowMinutes,
        salonName: salon.name,
      });
      await this.sendMessage(cleanNumber, slotMenu, phoneNumberId, salonId);
      return { replyMessage: slotMenu.bodyText, state: ConversationState.SELECT_TIME };
    }

    return this.handleDateReSelection(ctx);
  }

  /**
   * In-Funnel Date Re-Selection (Bypasses Entry Collision Guard)
   */
  async handleDateReSelection(ctx: ActionContext): Promise<ActionResult> {
    const { cleanNumber, phoneNumberId, salonId, conversation } = ctx;
    if (!conversation.selectedServiceId) {
      return this.handleStartBooking(ctx);
    }

    await this.session.updateConversationState(
      conversation.id,
      ConversationState.SELECT_DATE,
      undefined,
      { selectedStartTime: null, selectedDate: null },
    );

    const openDates = await this.availabilityService.findAvailableDates(
      salonId,
      conversation.selectedServiceId,
      conversation.selectedStaffId || undefined,
      7,
    );

    const dateMenu = this.templates.buildDateSelectionMenu(openDates);
    await this.sendMessage(cleanNumber, dateMenu, phoneNumberId, salonId);
    return { replyMessage: dateMenu.bodyText, state: ConversationState.SELECT_DATE };
  }
}
