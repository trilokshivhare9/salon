import { Injectable, Logger, Inject, forwardRef, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { AppointmentsService } from '../../../salon-admin/appointments/appointments.service';
import { CancellationService } from '../../../salon-admin/appointments/cancellation/cancellation.service';
import { RescheduleService } from '../../../salon-admin/appointments/reschedule/reschedule.service';
import { AvailabilityService } from '../../../salon-admin/availability/availability.service';
import { QuickCodeService } from '../../../salon-admin/quick-booking/quick-code.service';
import { WhatsAppSenderService, WhatsAppButtonId, InteractiveButton, InteractiveListRow } from './whatsapp-sender.service';
import { WhatsAppTemplateService } from './whatsapp-template.service';
import { WhatsAppSessionService } from './whatsapp-session.service';
import { WhatsAppService } from '../whatsapp.service';
import { ConversationState, AppointmentStatus, ClientEtaStatus, ServiceGender, BookingSource, CancelledBy } from '@prisma/client';
import { DateTime } from 'luxon';
import { TimeUtility } from '../../../../common/utils/time.utility';

@Injectable()
export class WhatsAppActionHandlerService {
  private readonly logger = new Logger(WhatsAppActionHandlerService.name);

  constructor(
    private prisma: PrismaService,
    private sender: WhatsAppSenderService,
    private templates: WhatsAppTemplateService,
    private session: WhatsAppSessionService,
    private availabilityService: AvailabilityService,
    private quickCodeService: QuickCodeService,
    @Inject(forwardRef(() => AppointmentsService))
    private appointmentsService: AppointmentsService,
    @Inject(forwardRef(() => CancellationService))
    private cancellationService: CancellationService,
    @Inject(forwardRef(() => RescheduleService))
    private rescheduleService: RescheduleService,
    @Inject(forwardRef(() => WhatsAppService))
    @Optional() public whatsAppService?: WhatsAppService,
  ) { }

  // Multi-tenant in-memory catalog cache with 3-minute TTL to eliminate repetitive heavy joins
  private readonly catalogCache = new Map<string, { salon: any; cachedAt: number }>();
  private readonly CATALOG_CACHE_TTL_MS = 3 * 60 * 1000;
  private readonly MAX_CATALOG_CACHE_SIZE = 500;

  public invalidateSalonCatalog(salonId: string): void {
    this.catalogCache.delete(salonId);
  }

  private async getCachedSalon(salonId: string): Promise<any> {
    const now = Date.now();
    const entry = this.catalogCache.get(salonId);
    if (entry && now - entry.cachedAt < this.CATALOG_CACHE_TTL_MS) {
      // Defensive shallow copy to prevent downstream mutation of shared cached reference
      return { ...entry.salon, staff: entry.salon.stylists || entry.salon.staff };
    }

    const salon: any = await this.prisma.salon.findUnique({
      where: { id: salonId },
      include: {
        serviceCategories: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
        services: {
          where: {
            status: 'ACTIVE',
          },
          include: { serviceCategory: true, stylists: { include: { stylist: true } } },
          orderBy: { name: 'asc' },
        },
        stylists: { where: { status: 'ACTIVE' }, include: { services: true } },
      },
    });

    if (salon) {
      if (salon.stylists) salon.staff = salon.stylists;
      // Bounded capacity: evict oldest if cache exceeds 500 salons to prevent memory leaks
      if (this.catalogCache.size >= this.MAX_CATALOG_CACHE_SIZE) {
        const oldestKey = this.catalogCache.keys().next().value;
        if (oldestKey) this.catalogCache.delete(oldestKey);
      }
      this.catalogCache.set(salonId, { salon, cachedAt: now });
      return { ...salon };
    }

    return null;
  }

  public setWhatsAppService(service: any) {
    this.whatsAppService = service;
  }

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
   * Helper: Formats 24h 'HH:mm' time string, Date, or minutes into 12h 'hh:mm AM/PM'
   */
  private formatTime12h(timeStr: string | Date | number | null | undefined): string {
    return TimeUtility.formatTime12h(timeStr);
  }

  /**
   * Main Smart Action Entry Point
   * Handles 100% of WhatsApp user actions, button clicks, and text replies.
   */
  async handleIncomingAction(
    salonId: string,
    customerPhone: string,
    messageText: string,
    interactiveId?: string,
    phoneNumberId?: string,
  ): Promise<{ replyMessage: string; state: ConversationState; metadata?: any }> {
    const cleanNumber = this.sender.cleanPhone(customerPhone);
    const input = (interactiveId || messageText || '').trim();
    const normalized = input.toLowerCase();

    // 1. Fetch Salon Details & Active Services/Staff (Optimized In-Memory Cache)
    const salon: any = await this.getCachedSalon(salonId);

    if (!salon || salon.status !== 'ACTIVE') {
      const reply = 'Sorry, this salon booking service is currently inactive.';
      await this.sendMessage(cleanNumber, { textBody: reply }, phoneNumberId, salonId);
      return { replyMessage: reply, state: ConversationState.START };
    }

    if (salon && !salon.staff) salon.staff = salon.stylists;
    const tz = salon.timezone || 'Asia/Kolkata';

    // 2. Resolve Customer User & Session State
    const { user, salonUser, conversation } = await this.session.getOrCreateSession(salonId, cleanNumber);

    // 3. Blocked User Check (3 Penalty Strikes)
    if (salonUser?.isBookingBlocked) {
      const isBookingAttempt =
        [WhatsAppButtonId.BOOK, WhatsAppButtonId.SERVICES, WhatsAppButtonId.BOOK_NOW].includes(input as any) ||
        input.startsWith('svc_') ||
        input.startsWith('slot_') ||
        input.startsWith('date_');

      if (isBookingAttempt) {
        const blockMessage = `⚠️ *BOOKING RESTRICTED*\n\nYou have accumulated *3 penalty strikes* this year for missed appointments. Automatic slot booking is currently locked for your account.\n\n📞 *Please contact the Salon Owner* directly at *${salon.phone || 'the salon desk'}* to request access unblock.`;
        await this.sendMessage(
          cleanNumber,
          {
            bodyText: blockMessage,
            interactiveType: 'button',
            buttons: [{ id: WhatsAppButtonId.START, title: '🏠 Main Menu' }],
          },
          phoneNumberId,
          salonId,
        );
        return { replyMessage: blockMessage, state: ConversationState.START };
      }
    }

    // 4. Resolve Active Appointment
    let activeAppointment: any = null;
    if (conversation.activeAppointmentId) {
      activeAppointment = await this.prisma.appointment.findUnique({
        where: { id: conversation.activeAppointmentId },
        include: { service: true, stylist: true },
      });
      if (!activeAppointment || [AppointmentStatus.CANCELLED, AppointmentStatus.COMPLETED, AppointmentStatus.REJECTED].includes(activeAppointment.status)) {
        activeAppointment = null;
        await this.session.updateConversationState(conversation.id, conversation.state, null);
      }
    }

    // Fallback: ONLY check appointment table on initial START or ACTIVE_HUB states to avoid 600ms scan during active booking funnel
    if (!activeAppointment && (!conversation.state || conversation.state === ConversationState.START || conversation.state === ConversationState.ACTIVE_HUB)) {
      activeAppointment = await this.prisma.appointment.findFirst({
        where: {
          salonId,
          salonUser: { userId: user.id },
          status: {
            in: [
              AppointmentStatus.BOOKED,
              AppointmentStatus.CONFIRMED,
              AppointmentStatus.ON_THE_WAY,
              AppointmentStatus.CHECKED_IN,
              AppointmentStatus.SEATED_IN_CHAIR,
              AppointmentStatus.PENDING_ACCEPTANCE,
              AppointmentStatus.PENDING_RESCHEDULE,
            ],
          },
        },
        include: { service: true, stylist: true },
        orderBy: { startAt: 'desc' },
      });
      if (activeAppointment) {
        await this.session.updateConversationState(conversation.id, conversation.state, activeAppointment.id);
      }
    }

    // ----------------------------------------------------
    // GLOBAL PRIORITY 1: MAIN MENU, GREETINGS & SALON INFO
    // Always allowed from ANY screen or state. Never replies "Expired option"!
    // ----------------------------------------------------
    const isGreetingOrReset =
      [WhatsAppButtonId.MENU, WhatsAppButtonId.START, 'hi', 'hello', 'hey', 'start', 'menu', 'restart', 'reset'].includes(normalized) ||
      ['hi', 'hello', 'hey', 'start', 'menu'].some((kw) => normalized === kw || normalized.startsWith('hi ') || normalized.startsWith('hello '));

    if (isGreetingOrReset) {
      await this.session.updateConversationState(conversation.id, ConversationState.START);
      const welcome = this.templates.buildWelcomeMessage(salon, activeAppointment);
      await this.sendMessage(cleanNumber, welcome, phoneNumberId, salonId);
      return { replyMessage: welcome.bodyText, state: ConversationState.START };
    }

    if (input === WhatsAppButtonId.INFO) {
      const infoMsg = this.templates.buildSalonInfoMessage(salon);
      await this.sendMessage(cleanNumber, infoMsg, phoneNumberId, salonId);
      return { replyMessage: infoMsg.bodyText, state: conversation.state };
    }

    // ----------------------------------------------------
    // GLOBAL PRIORITY 2: STALE RECOVERY ACTIONS (RESUME & NEW BOOKING)
    // Triggered when user clicks [ ▶️ Continue Booking ] or [ 📅 New Booking ]
    // ----------------------------------------------------
    if (input === WhatsAppButtonId.NEW_BOOKING || input === 'btn_new_booking') {
      await this.session.updateConversationState(conversation.id, ConversationState.START, null, {
        selectedCategoryId: null,
        selectedServiceId: null,
        selectedStaffId: null,
        selectedDate: null,
        selectedStartTime: null,
        quickCodeVerifiedAt: null,
      });
      const welcome = this.templates.buildWelcomeMessage(salon, activeAppointment);
      await this.sendMessage(cleanNumber, welcome, phoneNumberId, salonId);
      return { replyMessage: welcome.bodyText, state: ConversationState.START };
    }

    if (input === WhatsAppButtonId.RESUME_BOOKING || input === 'btn_resume_booking') {
      return this.resumeIncompleteBooking(conversation, salon, cleanNumber, phoneNumberId, salonId);
    }

    // ----------------------------------------------------
    // GLOBAL PRIORITY 3: STALE BUTTON / LIFECYCLE STAGE VALIDATION
    // Guardrail against clicking historical chat buttons
    // ----------------------------------------------------
    const lifecycleStage = this.session.determineLifecycleStage(conversation, activeAppointment);
    const isValidAction = this.session.isActionValidForLifecycle(lifecycleStage, conversation.state as ConversationState, input);

    if (!isValidAction) {
      this.logger.warn(`[ActionHandler] Stale button input "${input}" ignored for state ${conversation.state}`);
      const expireReply = await this.session.sendLifecycleExpirationResponse(
        cleanNumber,
        lifecycleStage,
        phoneNumberId,
        salonId,
        this.whatsAppService,
      );
      return { replyMessage: expireReply, state: conversation.state as ConversationState };
    }

    // ----------------------------------------------------
    // CATEGORY 1: CANCELLATION ACTIONS
    // Calls existing CancellationService.cancelBooking()
    // ----------------------------------------------------
    if (
      [WhatsAppButtonId.CANCEL_APPT, WhatsAppButtonId.REMIND_CANCEL, WhatsAppButtonId.ETA_CANCEL].includes(input as any) ||
      (conversation.state === ConversationState.CONFIRM_CANCEL &&
        [WhatsAppButtonId.CANCEL_YES, WhatsAppButtonId.CANCEL_NO, 'yes', 'no', 'keep', '1', '2'].some((kw) => normalized.includes(kw)))
    ) {
      if (input === WhatsAppButtonId.CANCEL_APPT || input === WhatsAppButtonId.REMIND_CANCEL || input === WhatsAppButtonId.ETA_CANCEL) {
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

      if (input === WhatsAppButtonId.CANCEL_YES || normalized.includes('yes') || normalized === '1') {
        const apptId = conversation.activeAppointmentId || activeAppointment?.id;
        if (apptId) {
          await this.cancellationService.cancelBooking(salonId, apptId, {
            source: 'CUSTOMER_WHATSAPP',
            fault: 'CLIENT',
            reason: 'Cancelled by customer via WhatsApp Active Hub',
            skipWhatsAppNotify: true,
          });
        }
        await this.session.updateConversationState(conversation.id, ConversationState.START, null);
        const reply = this.templates.buildCancelSuccessReply();
        await this.sendMessage(cleanNumber, reply, phoneNumberId, salonId);
        return { replyMessage: reply.bodyText, state: ConversationState.START };
      }

      if (input === WhatsAppButtonId.CANCEL_NO || normalized.includes('no') || normalized.includes('keep') || normalized === '2') {
        await this.session.updateConversationState(conversation.id, ConversationState.START);
        const reply = this.templates.buildCancelKeepReply();
        await this.sendMessage(cleanNumber, reply, phoneNumberId, salonId);
        return { replyMessage: reply.bodyText, state: ConversationState.START };
      }
    }

    // ----------------------------------------------------
    // CATEGORY 2: CHECK-IN & ETA ACTIONS
    // Calls existing AppointmentsService status & ETA methods
    // ----------------------------------------------------
    if (input === WhatsAppButtonId.REMIND_CONFIRM) {
      const apptId = conversation.activeAppointmentId || activeAppointment?.id;
      if (apptId) {
        await this.appointmentsService.updateStatus(salonId, apptId, {
          status: AppointmentStatus.CONFIRMED,
        });
        await this.appointmentsService.updateEtaStatus(salonId, apptId, ClientEtaStatus.ON_TIME);
      }
      const reply = `✅ *Thank you for confirming!*\n\nWe've noted your confirmation and your stylist will be ready for you at your scheduled time. See you soon!`;
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

    if (input === WhatsAppButtonId.ETA_ON_THE_WAY || input === 'btn_eta_on_the_way') {
      const apptId = conversation.activeAppointmentId || activeAppointment?.id;
      if (apptId) {
        await this.appointmentsService.updateStatus(salonId, apptId, {
          status: AppointmentStatus.ON_THE_WAY,
        });
        await this.appointmentsService.updateEtaStatus(salonId, apptId, ClientEtaStatus.ON_THE_WAY);
      }
      const reply = `🚗 *Safe travels!*\n\nWe've notified your stylist that you are on your way. Your chair will be ready for you!`;
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

    if (input === WhatsAppButtonId.ETA_ARRIVED) {
      const apptId = conversation.activeAppointmentId || activeAppointment?.id;
      if (apptId) {
        await this.appointmentsService.updateStatus(salonId, apptId, {
          status: AppointmentStatus.CHECKED_IN,
        });
        await this.appointmentsService.updateEtaStatus(salonId, apptId, ClientEtaStatus.ARRIVED);
      }
      const reply = this.templates.buildCheckinSuccessReply();
      await this.sendMessage(cleanNumber, reply, phoneNumberId, salonId);
      return { replyMessage: reply.bodyText, state: conversation.state };
    }

    if (input === WhatsAppButtonId.ETA_LATE_15 || input.startsWith('late_')) {
      const minutes = input.startsWith('late_') ? parseInt(input.split('_')[1], 10) || 15 : 15;
      const etaEnum = minutes > 15 ? ClientEtaStatus.RUNNING_LATE_20M : ClientEtaStatus.RUNNING_LATE_10M;

      const apptId = conversation.activeAppointmentId || activeAppointment?.id;
      if (apptId) {
        await this.appointmentsService.updateEtaStatus(salonId, apptId, etaEnum);
      }
      const reply = this.templates.buildLateNotificationReply(minutes);
      await this.sendMessage(cleanNumber, reply, phoneNumberId, salonId);
      return { replyMessage: reply.bodyText, state: conversation.state };
    }

    // ----------------------------------------------------
    // CATEGORY 3: RESCHEDULE & PROPOSED RESCHEDULE ACTIONS
    // Calls existing RescheduleService.rescheduleAppointment()
    // ----------------------------------------------------
    if (input === WhatsAppButtonId.RESCHEDULE || input === WhatsAppButtonId.REMIND_RESCHEDULE) {
      const now = DateTime.now().setZone(tz);
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
        await this.sendMessage(
          cleanNumber,
          payload,
          phoneNumberId,
          salonId,
        );
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

      await this.session.updateConversationState(conversation.id, ConversationState.SELECT_RESCHEDULE_DATE, apptToReschedule.id);
      const prompt = this.templates.buildDateSelectionMenu(openDates, true);
      await this.sendMessage(cleanNumber, prompt, phoneNumberId, salonId);
      return { replyMessage: prompt.bodyText, state: ConversationState.SELECT_RESCHEDULE_DATE };
    }

    // Step R1: Reschedule Date Selected
    if (input.startsWith('rdate_')) {
      let dateStr = input.replace('rdate_', '');
      if (dateStr === 'today' || dateStr === '1') {
        dateStr = DateTime.now().setZone(tz).toISODate()!;
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

      await this.session.updateConversationState(conversation.id, ConversationState.SELECT_RESCHEDULE_TIME, appt.id, {
        selectedDate: new Date(dateStr),
      });

      const slotRows = availability.availableSlots.map((s) => ({
        timeStr: s.startTime,
        displayTime: this.formatTime12h(s.startTime),
      }));

      const slotMenu = this.templates.buildTimeSlotMenu(slotRows, true);
      await this.sendMessage(cleanNumber, slotMenu, phoneNumberId, salonId);
      return { replyMessage: slotMenu.bodyText, state: ConversationState.SELECT_RESCHEDULE_TIME };
    }

    // Step R2: Reschedule Time Slot Selected
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

      const dateStr = TimeUtility.formatDateToISO(conversation.selectedDate, tz);

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
      const successReply = this.templates.buildRescheduleSuccessReply(dateStr, TimeUtility.formatTime12h(newStartTime));
      await this.sendMessage(cleanNumber, successReply, phoneNumberId, salonId);
      return { replyMessage: successReply.bodyText, state: ConversationState.START };
    }

    // Salon Owner Proposed Reschedule Accept/Decline Handlers
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
          appointmentDate: DateTime.fromJSDate(newStart, { zone: tz }).startOf('day').toJSDate(),
          status: AppointmentStatus.CONFIRMED,
          proposedStartAt: null,
          proposedEndAt: null,
          proposedByAdminId: null,
          notes: `${appt.notes || ''} [Rescheduled by salon admin and accepted by customer.]`.trim(),
        },
      });

      const newTimeStr = DateTime.fromJSDate(newStart, { zone: tz }).toFormat('hh:mm a');
      const replyPayload = this.templates.buildRescheduleAcceptedReply({
        salonName: salon.name,
        stylistName: appt.stylist?.name || 'Stylist',
        newTimeStr,
      });

      await this.sendMessage(
        cleanNumber,
        replyPayload,
        phoneNumberId,
        salonId,
      );

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
      await this.sendMessage(
        cleanNumber,
        replyPayload,
        phoneNumberId,
        salonId,
      );

        this.appointmentsService?.emitSalonEvent(salonId, 'STATUS_UPDATED', updated);
        this.appointmentsService?.emitSalonEvent(salonId, 'APPOINTMENT_UPDATED', updated);
        this.appointmentsService?.emitSalonEvent(salonId, 'BOOKING_CANCELLED', updated);

        if (this.cancellationService && typeof (this.cancellationService as any).triggerSmartMoveUpBroadcast === 'function') {
          await (this.cancellationService as any).triggerSmartMoveUpBroadcast(updated).catch(() => {});
        }

        return { replyMessage: replyPayload.bodyText, state: ConversationState.START };
      }

    // ----------------------------------------------------
    // CATEGORY 4: ADD-ON SERVICE ACTION
    // ----------------------------------------------------
    if (input === WhatsAppButtonId.ADD_SERVICE || input === 'btn_add_service') {
      const appt = activeAppointment;
      const availableAddons = (salon.services || []).filter((s: any) => !appt || s.id !== appt.serviceId);

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

    // ----------------------------------------------------
    // CATEGORY 5: PRE-BOOKING & QUICK BOOKING SELECTION FLOW
    // ----------------------------------------------------

    // Quick Book Bypass Action
    if (input === WhatsAppButtonId.QUICK_BOOK) {
      await this.session.updateConversationState(conversation.id, ConversationState.SELECT_CATEGORY, undefined, {
        quickCodeVerifiedAt: new Date(),
      });
      const categoryMenu = this.templates.buildQuickBookCategoryMenu(salon.serviceCategories || []);
      await this.sendMessage(cleanNumber, categoryMenu, phoneNumberId, salonId);
      return { replyMessage: categoryMenu.bodyText, state: ConversationState.SELECT_CATEGORY };
    }

    // Quick Book Confirmation Action
    if (
      input === WhatsAppButtonId.CONFIRM_QUICK ||
      input === 'btn_confirm_quick' ||
      (conversation.state === ConversationState.QUICK_BOOK_CONFIRM && ['confirm', 'btn_confirm_quick', 'yes'].includes(normalized))
    ) {
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

      const todayDateStr = conversation.selectedDate
        ? DateTime.fromJSDate(conversation.selectedDate).setZone(tz).toISODate()!
        : DateTime.now().setZone(tz).toISODate()!;
      let slotTime = conversation.selectedStartTime
        ? TimeUtility.formatTime24h(conversation.selectedStartTime, tz)
        : DateTime.now().setZone(tz).toFormat('HH:mm');

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

      const newAppt = await this.appointmentsService.createAppointment(
        salonId,
        {
          customerPhone: cleanNumber,
          customerName: user.name || 'WhatsApp Customer',
          serviceIds: [conversation.selectedServiceId],
          stylistId: conversation.selectedStaffId || undefined,
          date: todayDateStr,
          startTime: slotTime,
          source: BookingSource.QUICK_BOOK,
        },
        undefined,
        { initialStatus: AppointmentStatus.PENDING_ACCEPTANCE } as any,
      );

      await this.session.updateConversationState(conversation.id, ConversationState.COMPLETED, newAppt?.id);
      const pendingReply = this.templates.buildQuickBookPendingReply(newAppt);
      await this.sendMessage(cleanNumber, pendingReply, phoneNumberId, salonId);
      return { replyMessage: pendingReply.bodyText, state: ConversationState.COMPLETED };
    }

    // Step A: Start Booking / Services / Quick Book
    if (['btn_book', 'btn_services', 'btn_book_now', 'btn_quick_book'].includes(input)) {
      const isQuick = input === 'btn_quick_book';
      await this.session.updateConversationState(conversation.id, ConversationState.SELECT_CATEGORY, undefined, {
        quickCodeVerifiedAt: isQuick ? new Date() : null,
      });

      // 1. Single-Prompt Gender Check:
      // If user has already chosen gender in this session, DO NOT ASK AGAIN!
      let effectiveGender = conversation.tempBookingGender;

      // 2. Auto-detect if salon serves only a single target gender (e.g. Barber shop or Women-only salon)
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

      // If gender is already known or single-gender salon: skip gender selection menu!
      if (effectiveGender) {
        const categories = (salon.serviceCategories || []).filter((cat: any) => {
          if (effectiveGender === 'UNISEX') return true;
          return salon.services.some(
            (s: any) =>
              (s.categoryId || s.serviceCategoryId) === cat.id &&
              ((s.targetGender || s.gender) === effectiveGender || (s.targetGender || s.gender) === 'UNISEX'),
          );
        });

        const genderLabel = effectiveGender !== 'UNISEX' ? effectiveGender : undefined;
        const categoryMenu = this.templates.buildCategoryMenu(
          categories.length > 0 ? categories : salon.serviceCategories || [],
          genderLabel,
        );
        await this.sendMessage(cleanNumber, categoryMenu, phoneNumberId, salonId);
        return { replyMessage: categoryMenu.bodyText, state: ConversationState.SELECT_CATEGORY };
      }

      // Otherwise, prompt gender selection ONCE:
      const genderMenu = this.templates.buildGenderSelectionMenu();
      await this.sendMessage(cleanNumber, genderMenu, phoneNumberId, salonId);
      return { replyMessage: genderMenu.bodyText, state: ConversationState.SELECT_CATEGORY };
    }

    // Step B: Gender Selection / Switch
    if (input === WhatsAppButtonId.SWITCH_GENDER || input === 'btn_switch_gender') {
      await this.session.updateConversationState(conversation.id, ConversationState.SELECT_CATEGORY);
      const genderMenu = this.templates.buildGenderSelectionMenu();
      await this.sendMessage(cleanNumber, genderMenu, phoneNumberId, salonId);
      return { replyMessage: genderMenu.bodyText, state: ConversationState.SELECT_CATEGORY };
    }

    if (input.startsWith('gender_select_')) {
      const tempBookingGender = input.replace('gender_select_', '') as ServiceGender;
      await this.session.updateConversationState(conversation.id, ConversationState.SELECT_CATEGORY, undefined, { tempBookingGender });

      const categories = (salon.serviceCategories || []).filter((cat: any) => {
        if (tempBookingGender === 'UNISEX') return true;
        return salon.services.some(
          (s: any) =>
            (s.categoryId || s.serviceCategoryId) === cat.id &&
            ((s.targetGender || s.gender) === tempBookingGender || (s.targetGender || s.gender) === 'UNISEX'),
        );
      });

      const genderLabel = tempBookingGender !== 'UNISEX' ? tempBookingGender : undefined;
      const categoryMenu = this.templates.buildCategoryMenu(
        categories.length > 0 ? categories : salon.serviceCategories || [],
        genderLabel,
      );
      await this.sendMessage(cleanNumber, categoryMenu, phoneNumberId, salonId);
      return { replyMessage: categoryMenu.bodyText, state: ConversationState.SELECT_CATEGORY };
    }

    // Back to Category Menu from Service List
    if (input === WhatsAppButtonId.CAT_BACK || input === 'cat_back') {
      await this.session.updateConversationState(conversation.id, ConversationState.SELECT_CATEGORY);
      const gender = conversation.tempBookingGender;
      const categories = (salon.serviceCategories || []).filter((cat: any) => {
        if (!gender || gender === 'UNISEX') return true;
        return salon.services.some(
          (s: any) =>
            (s.categoryId || s.serviceCategoryId) === cat.id &&
            ((s.targetGender || s.gender) === gender || (s.targetGender || s.gender) === 'UNISEX'),
        );
      });
      const genderLabel = gender && gender !== 'UNISEX' ? gender : undefined;
      const categoryMenu = this.templates.buildCategoryMenu(
        categories.length > 0 ? categories : salon.serviceCategories || [],
        genderLabel,
      );
      await this.sendMessage(cleanNumber, categoryMenu, phoneNumberId, salonId);
      return { replyMessage: categoryMenu.bodyText, state: ConversationState.SELECT_CATEGORY };
    }

    // Step C: Category Selection -> List Services
    if (input.startsWith('cat_')) {
      const catId = input.replace('cat_', '');
      const selectedCategory = salon.serviceCategories.find((c: any) => c.id === catId);
      const gender = conversation.tempBookingGender;

      const categoryServices = salon.services.filter((s: any) => {
        const inCat = (s.categoryId || s.serviceCategoryId) === catId || (catId === 'uncategorized' && !s.categoryId && !s.serviceCategoryId);
        if (!inCat) return false;
        if (!gender || gender === 'UNISEX') return true;
        return (s.targetGender || s.gender) === gender || (s.targetGender || s.gender) === 'UNISEX';
      });

      if (categoryServices.length === 0) {
        const reply = `⚠️ No services found in this category for the selected section. Please pick another category:`;
        const categories = (salon.serviceCategories || []).filter((cat: any) => {
          if (!gender || gender === 'UNISEX') return true;
          return salon.services.some(
            (s: any) =>
              (s.categoryId || s.serviceCategoryId) === cat.id &&
              ((s.targetGender || s.gender) === gender || (s.targetGender || s.gender) === 'UNISEX'),
          );
        });
        const categoryMenu = this.templates.buildCategoryMenu(categories.length > 0 ? categories : salon.serviceCategories || []);
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

    // Step D: Service Selection -> Route by Booking Type (NORMAL vs QUICK)
    if (input.startsWith('svc_')) {
      const svcId = input.replace('svc_', '');
      const selectedService = salon.services.find((s: any) => s.id === svcId);

      if (!selectedService) {
        const reply = `⚠️ Selected service not found. Please choose another service:`;
        const serviceMenu = this.templates.buildServiceMenu(salon.services || [], 'Services');
        serviceMenu.bodyText = reply;
        await this.sendMessage(cleanNumber, serviceMenu, phoneNumberId, salonId);
        return { replyMessage: reply, state: ConversationState.SELECT_SERVICE };
      }

      const bookingType = this.session.getBookingType(conversation);

      if (bookingType === 'QUICK') {
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

        const dateIso = DateTime.fromISO(earliest.dateStr, { zone: tz }).toJSDate();
        const startDt = TimeUtility.toJSDate(earliest.dateStr, earliest.startTime, tz);
        const assignedStylistId = earliest.eligibleStaffIds && earliest.eligibleStaffIds.length > 0 ? earliest.eligibleStaffIds[0] : null;
        const stylist = assignedStylistId ? (salon.stylists || []).find((s: any) => s.id === assignedStylistId) : null;

        await this.session.updateConversationState(conversation.id, ConversationState.QUICK_BOOK_CONFIRM, undefined, {
          selectedServiceId: svcId,
          selectedDate: dateIso,
          selectedStartTime: startDt,
          selectedStaffId: assignedStylistId,
        });

        const time12h = earliest.displayTime || TimeUtility.formatTime12h(earliest.startTime, tz);
        const dateFriendly = TimeUtility.formatDateFriendly(earliest.dateStr, tz);

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

      // NORMAL Booking: Query qualified active stylists via AvailabilityService
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

    // Step E: Staff Selection -> Scan Real Open Dates
    if (input.startsWith('staff_')) {
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

    // Step F: Date Selection -> Query Real Slots via AvailabilityService
    if (input.startsWith('date_')) {
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
        selectedDate: new Date(dateStr),
      });

      const slotRows = availability.availableSlots.map((s) => ({
        timeStr: s.startTime,
        displayTime: this.formatTime12h(s.startTime),
      }));

      const slotMenu = this.templates.buildTimeSlotMenu(slotRows);
      await this.sendMessage(cleanNumber, slotMenu, phoneNumberId, salonId);
      return { replyMessage: slotMenu.bodyText, state: ConversationState.SELECT_TIME };
    }

    // Step G: Time Slot Selection -> Confirmation Prompt
    if (input.startsWith('slot_')) {
      const timeStr = input.replace('slot_', '');
      const selectedService = salon.services.find((s: any) => s.id === conversation.selectedServiceId);
      const selectedStaff = salon.stylists?.find((st: any) => st.id === conversation.selectedStaffId);

      const datePart = conversation.selectedDate || new Date();
      const slotDateTime = TimeUtility.toJSDate(datePart, timeStr, tz);

      await this.session.updateConversationState(conversation.id, ConversationState.CONFIRMATION, undefined, {
        selectedStartTime: slotDateTime,
      });

      const formattedDate = TimeUtility.formatDateFriendly(datePart, tz, 'dd LLL, EEEE');
      const formattedTime = TimeUtility.formatTime12h(timeStr);

      const confirmPrompt = this.templates.buildBookingConfirmationPrompt({
        serviceName: selectedService?.name || 'Service',
        staffName: selectedStaff?.name || 'Any Specialist',
        dateStr: formattedDate,
        timeStr: formattedTime,
        price: selectedService?.price || 0,
      });
      await this.sendMessage(cleanNumber, confirmPrompt, phoneNumberId, salonId);
      return { replyMessage: confirmPrompt.bodyText, state: ConversationState.CONFIRMATION };
    }

    // Step H: Booking Final Confirmation -> Call AppointmentsService.createAppointment()
    if (
      conversation.state === ConversationState.CONFIRMATION &&
      ['btn_confirm_yes', 'btn_confirm', 'yes', 'confirm'].includes(normalized)
    ) {
      const timeStr = conversation.selectedStartTime
        ? TimeUtility.formatTime24h(conversation.selectedStartTime, tz)
        : '10:00';
      const dateStr = conversation.selectedDate
        ? TimeUtility.formatDateToISO(conversation.selectedDate, tz)
        : TimeUtility.formatDateToISO(new Date(), tz);

      const newAppt = await this.appointmentsService.createAppointment(salonId, {
        customerPhone: cleanNumber,
        customerName: user.name || 'WhatsApp Customer',
        serviceIds: [conversation.selectedServiceId],
        stylistId: conversation.selectedStaffId || undefined,
        date: dateStr,
        startTime: timeStr,
        source: BookingSource.WHATSAPP,
      });

      await this.session.updateConversationState(conversation.id, ConversationState.START, newAppt.id);
      const successReply = this.templates.buildBookingSuccessReply(newAppt);
      await this.sendMessage(cleanNumber, successReply, phoneNumberId, salonId);
      return { replyMessage: successReply.bodyText, state: ConversationState.START };
    }

    // Fallback: Return standard welcome menu
    const defaultWelcome = this.templates.buildWelcomeMessage(salon, activeAppointment);
    await this.sendMessage(cleanNumber, defaultWelcome, phoneNumberId, salonId);
    return { replyMessage: defaultWelcome.bodyText, state: ConversationState.START };
  }

  /**
   * Intelligently resumes an incomplete draft session when the user clicks [ ▶️ Continue Booking ]
   */
  private async resumeIncompleteBooking(
    conversation: any,
    salon: any,
    cleanNumber: string,
    phoneNumberId?: string,
    salonId?: string,
  ): Promise<{ replyMessage: string; state: ConversationState }> {
    const tz = salon.timezone || 'Asia/Kolkata';

    // 1. If at Confirmation step and date/time/service present
    if (
      conversation.state === ConversationState.CONFIRMATION &&
      conversation.selectedServiceId &&
      conversation.selectedStartTime
    ) {
      const selectedService = salon.services.find((s: any) => s.id === conversation.selectedServiceId);
      const selectedStaff = salon.stylists?.find((st: any) => st.id === conversation.selectedStaffId);
      const datePart = conversation.selectedDate || new Date();
      const timeStr = TimeUtility.formatTime24h(conversation.selectedStartTime, tz);
      const formattedDate = TimeUtility.formatDateFriendly(datePart, tz, 'dd LLL, EEEE');
      const formattedTime = TimeUtility.formatTime12h(timeStr);

      const confirmPrompt = this.templates.buildBookingConfirmationPrompt({
        serviceName: selectedService?.name || 'Service',
        staffName: selectedStaff?.name || 'Any Specialist',
        dateStr: formattedDate,
        timeStr: formattedTime,
        price: selectedService?.price || 0,
      });
      await this.sendMessage(cleanNumber, confirmPrompt, phoneNumberId, salonId);
      return { replyMessage: confirmPrompt.bodyText, state: ConversationState.CONFIRMATION };
    }

    // 2. If at Select Time step and date is selected
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
          displayTime: this.formatTime12h(s.startTime),
        }));
        const slotMenu = this.templates.buildTimeSlotMenu(slotRows);
        await this.sendMessage(cleanNumber, slotMenu, phoneNumberId, salonId);
        return { replyMessage: slotMenu.bodyText, state: ConversationState.SELECT_TIME };
      }
    }

    // 3. If at Select Date step and service is selected
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

    // 4. If at Select Service step and category is selected
    if (conversation.selectedCategoryId) {
      const catId = conversation.selectedCategoryId;
      const selectedCategory = salon.serviceCategories.find((c: any) => c.id === catId);
      const gender = conversation.tempBookingGender;
      const categoryServices = salon.services.filter((s: any) => {
        const inCat =
          (s.categoryId || s.serviceCategoryId) === catId ||
          (catId === 'uncategorized' && !s.categoryId && !s.serviceCategoryId);
        if (!inCat) return false;
        if (!gender || gender === 'UNISEX') return true;
        return (s.targetGender || s.gender) === gender || (s.targetGender || s.gender) === 'UNISEX';
      });
      if (categoryServices.length > 0) {
        const serviceMenu = this.templates.buildServiceMenu(categoryServices, selectedCategory?.name || 'Services');
        await this.sendMessage(cleanNumber, serviceMenu, phoneNumberId, salonId);
        return { replyMessage: serviceMenu.bodyText, state: ConversationState.SELECT_SERVICE };
      }
    }

    // 5. Fallback: Re-render Category Menu
    await this.session.updateConversationState(conversation.id, ConversationState.SELECT_CATEGORY);
    const gender = conversation.tempBookingGender;
    const categories = (salon.serviceCategories || []).filter((cat: any) => {
      if (!gender || gender === 'UNISEX') return true;
      return salon.services.some(
        (s: any) =>
          (s.categoryId || s.serviceCategoryId) === cat.id &&
          ((s.targetGender || s.gender) === gender || (s.targetGender || s.gender) === 'UNISEX'),
      );
    });
    const genderLabel = gender && gender !== 'UNISEX' ? gender : undefined;
    const categoryMenu = this.templates.buildCategoryMenu(
      categories.length > 0 ? categories : salon.serviceCategories || [],
      genderLabel,
    );
    await this.sendMessage(cleanNumber, categoryMenu, phoneNumberId, salonId);
    return { replyMessage: categoryMenu.bodyText, state: ConversationState.SELECT_CATEGORY };
  }

  async handleServiceChosen(
    conversationId: string,
    customerPhone: string,
    salon: any,
    service: any,
    phoneNumberId?: string,
  ) {
    const cleanNumber = this.sender.cleanPhone(customerPhone);
    const tz = salon.timezone || 'Asia/Kolkata';
    const todayDateStr = DateTime.now().setZone(tz).toISODate()!;

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
}
