import { Injectable, Logger, Inject, forwardRef, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { WhatsAppSenderService, WhatsAppButtonId } from './whatsapp-sender.service';
import { WhatsAppTemplateService } from './whatsapp-template.service';
import { WhatsAppSessionService } from './whatsapp-session.service';
import { WhatsAppService } from '../whatsapp.service';
import { ConversationState, AppointmentStatus } from '@prisma/client';
import { TimeUtility } from '../../../../common/utils/time.utility';
import { ActionContext, ActionResult } from '../actions/shared/action-context';
import { ActionUtils } from '../actions/shared/action-utils';
import { CatalogCacheService } from '../actions/shared/catalog-cache.service';
import { CheckinAction } from '../actions/checkin.action';
import { AppointmentAction } from '../actions/appointment.action';
import { DraftRecoveryAction } from '../actions/draft-recovery.action';
import { QuickBookingAction } from '../actions/quick-booking.action';
import { BookingAction } from '../actions/booking.action';
import { AvailabilityService } from '../../../salon-admin/availability/availability.service';

@Injectable()
export class WhatsAppActionHandlerService {
  private readonly logger = new Logger(WhatsAppActionHandlerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: WhatsAppSenderService,
    private readonly templates: WhatsAppTemplateService,
    private readonly session: WhatsAppSessionService,
    private readonly catalogCache: CatalogCacheService,
    private readonly checkinAction: CheckinAction,
    private readonly appointmentAction: AppointmentAction,
    private readonly draftRecoveryAction: DraftRecoveryAction,
    private readonly quickBookingAction: QuickBookingAction,
    private readonly bookingAction: BookingAction,
    @Inject(forwardRef(() => WhatsAppService))
    @Optional() public whatsAppService?: WhatsAppService,
    @Optional() private readonly availabilityService?: AvailabilityService,
  ) {}

  public setWhatsAppService(service: any): void {
    this.whatsAppService = service;
  }

  public invalidateSalonCatalog(salonId: string): void {
    this.catalogCache.invalidateSalonCatalog(salonId);
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
   * Main Smart Action Gateway & Guard Interceptor
   * Executes top-level validations and dispatches to dedicated domain action handlers.
   */
  async handleIncomingAction(
    salonId: string,
    customerPhone: string,
    messageText: string,
    interactiveId?: string,
    phoneNumberId?: string,
    senderName?: string,
  ): Promise<{ replyMessage: string; state: ConversationState; metadata?: any }> {
    const cleanNumber = this.sender.cleanPhone(customerPhone);
    const input = (interactiveId || messageText || '').trim();
    const normalizedInput = input.toLowerCase();

    // 1. Fetch Salon Details & Active Services/Staff from Catalog Cache
    const salon: any = await this.catalogCache.getCachedSalon(salonId);

    if (!salon || salon.status !== 'ACTIVE') {
      const reply = 'Sorry, this salon booking service is currently inactive.';
      await this.sendMessage(cleanNumber, { textBody: reply }, phoneNumberId, salonId);
      return { replyMessage: reply, state: ConversationState.START };
    }

    if (salon && !salon.staff) salon.staff = salon.stylists;
    const tz = salon.timezone || 'Asia/Kolkata';

    // 2. Resolve Customer User & Session State
    const { user, salonUser, conversation } = await this.session.getOrCreateSession(salonId, cleanNumber, senderName);

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

    // 4. Pre-Flight Action Classification & Target Appointment Resolution
    const isAppointmentAction =
      input.startsWith('remind_') ||
      input.startsWith('eta_') ||
      input.startsWith('btn_eta_') ||
      input.startsWith('appt_') ||
      input.startsWith('late_') ||
      input.startsWith('propose_') ||
      input === 'btn_running_late' ||
      input === WhatsAppButtonId.CANCEL_APPT ||
      input === WhatsAppButtonId.RESCHEDULE ||
      input === WhatsAppButtonId.REMIND_CONFIRM ||
      input === WhatsAppButtonId.REMIND_RESCHEDULE ||
      input === WhatsAppButtonId.REMIND_CANCEL;

    let activeAppointment: any = null;
    let targetAppointment: any = null;
    let pendingAppointment: any = null;

    if (conversation.activeAppointmentId) {
      targetAppointment = await this.prisma.appointment.findUnique({
        where: { id: conversation.activeAppointmentId },
        include: { service: true, stylist: true },
      });
    }

    if (
      !targetAppointment &&
      (isAppointmentAction ||
        !conversation.state ||
        conversation.state === ConversationState.START ||
        conversation.state === ConversationState.ACTIVE_HUB)
    ) {
      targetAppointment = await this.prisma.appointment.findFirst({
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
    }

    if (targetAppointment) {
      if (targetAppointment.status === AppointmentStatus.PENDING_ACCEPTANCE) {
        pendingAppointment = targetAppointment;
      } else {
        const activeStatuses = [
          AppointmentStatus.BOOKED,
          AppointmentStatus.CONFIRMED,
          AppointmentStatus.ON_THE_WAY,
          AppointmentStatus.CHECKED_IN,
          AppointmentStatus.SEATED_IN_CHAIR,
          AppointmentStatus.PENDING_RESCHEDULE,
        ];
        if (activeStatuses.includes(targetAppointment.status)) {
          activeAppointment = targetAppointment;
          if (conversation.activeAppointmentId !== targetAppointment.id) {
            await this.session.updateConversationState(conversation.id, conversation.state, targetAppointment.id);
          }
        }
      }
    }

    // Defensive check: if targetAppointment was not pending, check if user has an active pending quick request
    if (!pendingAppointment) {
      const activePending = await this.prisma.appointment.findFirst({
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
      if (activePending) {
        pendingAppointment = activePending;
      }
    }

    // 5. Pre-Flight Appointment Action Guard (Cancelled, Completed, Idempotent)
    if (isAppointmentAction) {
      if (!targetAppointment) {
        const expireReply = this.templates.buildExpiredActionReply(true);
        await this.sendMessage(cleanNumber, expireReply, phoneNumberId, salonId);
        return { replyMessage: expireReply.bodyText, state: ConversationState.START };
      }

      if (targetAppointment.status === AppointmentStatus.CANCELLED) {
        const timeStr = targetAppointment.startAt ? TimeUtility.formatTime12h(targetAppointment.startAt, tz) : undefined;
        const dateStr = targetAppointment.startAt ? TimeUtility.formatDateFriendly(targetAppointment.startAt, tz, 'dd LLL, EEEE') : undefined;
        const isAutoCanceled =
          targetAppointment.cancellationReason?.includes('GHOST') ||
          targetAppointment.cancellationReason?.includes('auto') ||
          targetAppointment.cancelReason?.includes('GHOST') ||
          targetAppointment.cancelReason?.includes('auto') ||
          targetAppointment.cancelledBy === 'SYSTEM' ||
          targetAppointment.cancelReasonCategory === 'CLIENT_UNRESPONSIVE';

        await this.session.updateConversationState(conversation.id, ConversationState.START, null, ActionUtils.getClearDraftData());
        const cancelNotice = this.templates.buildAppointmentAlreadyCanceledReply({
          timeStr,
          dateStr,
          isAutoCanceled,
        });
        await this.sendMessage(cleanNumber, cancelNotice, phoneNumberId, salonId);
        return { replyMessage: cancelNotice.bodyText, state: ConversationState.START };
      }

      if (targetAppointment.status === AppointmentStatus.COMPLETED) {
        const dateStr = targetAppointment.startAt ? TimeUtility.formatDateFriendly(targetAppointment.startAt, tz, 'dd LLL, EEEE') : undefined;
        await this.session.updateConversationState(conversation.id, ConversationState.START, null, ActionUtils.getClearDraftData());
        const completedNotice = this.templates.buildAppointmentAlreadyCompletedReply({
          serviceName: targetAppointment.service?.name,
          dateStr,
        });
        await this.sendMessage(cleanNumber, completedNotice, phoneNumberId, salonId);
        return { replyMessage: completedNotice.bodyText, state: ConversationState.START };
      }

      if (targetAppointment.status === AppointmentStatus.CONFIRMED && input === WhatsAppButtonId.REMIND_CONFIRM) {
        const timeStr = targetAppointment.startAt ? TimeUtility.formatTime12h(targetAppointment.startAt, tz) : undefined;
        const alreadyConfirmed = this.templates.buildAppointmentAlreadyConfirmedReply({
          timeStr,
          stylistName: targetAppointment.stylist?.name,
        });
        await this.sendMessage(cleanNumber, alreadyConfirmed, phoneNumberId, salonId);
        return { replyMessage: alreadyConfirmed.bodyText, state: conversation.state };
      }

      activeAppointment = targetAppointment;
    }

    // 6. Global Priority 1: Main Menu, Greetings & Salon Info
    const isGreetingOrReset =
      [WhatsAppButtonId.MENU, WhatsAppButtonId.START, 'hi', 'hello', 'hey', 'start', 'menu', 'restart', 'reset'].includes(normalizedInput) ||
      ['hi', 'hello', 'hey', 'start', 'menu'].some((kw) => normalizedInput === kw || normalizedInput.startsWith('hi ') || normalizedInput.startsWith('hello '));

    if (isGreetingOrReset) {
      await this.session.updateConversationState(
        conversation.id,
        ConversationState.START,
        activeAppointment ? activeAppointment.id : null,
        ActionUtils.getClearDraftData(),
      );
      let isQuickBookOpen = true;
      if (this.availabilityService) {
        try {
          isQuickBookOpen = await this.availabilityService.isQuickBookingOperationalToday(salonId, tz);
        } catch (err) {
          isQuickBookOpen = true;
        }
      }
      const welcome = this.templates.buildWelcomeMessage(salon, activeAppointment, { isQuickBookOpen });
      await this.sendMessage(cleanNumber, welcome, phoneNumberId, salonId);
      return { replyMessage: welcome.bodyText, state: ConversationState.START };
    }

    if (input === WhatsAppButtonId.INFO) {
      const infoMsg = this.templates.buildSalonInfoMessage(salon);
      await this.sendMessage(cleanNumber, infoMsg, phoneNumberId, salonId);
      return { replyMessage: infoMsg.bodyText, state: conversation.state };
    }

    if (input === WhatsAppButtonId.FEEDBACK_GREAT || input === 'btn_feedback_great') {
      const reviewUrl = salon.googleMapsUrl || undefined;
      const feedbackMsg = this.templates.buildFeedbackThanksReply(salon.name, reviewUrl);
      await this.sendMessage(cleanNumber, feedbackMsg, phoneNumberId, salonId);
      return { replyMessage: feedbackMsg.bodyText, state: conversation.state };
    }

    // Assemble Strongly Typed Context
    const ctx: ActionContext = {
      salonId,
      customerPhone,
      cleanNumber,
      input,
      normalizedInput,
      salon,
      user,
      salonUser,
      conversation,
      activeAppointment,
      targetAppointment,
      pendingAppointment,
      phoneNumberId,
      senderName,
      tz,
    };

    // 7. Global Priority 2: Stale Recovery Actions (Check Last Booking & Resume Draft)
    if (
      input === WhatsAppButtonId.CHECK_LAST_BOOKING ||
      input === 'btn_last_booking' ||
      input === WhatsAppButtonId.RESUME_BOOKING ||
      input === 'btn_resume_booking'
    ) {
      const updatedAt = conversation.updatedAt ? new Date(conversation.updatedAt).getTime() : 0;
      const isDraftFresh = updatedAt > 0 && Date.now() - updatedAt <= 30 * 60 * 1000;
      const hasActiveDraft = isDraftFresh && (!!conversation.selectedServiceId || !!conversation.selectedCategoryId);

      if (input === WhatsAppButtonId.RESUME_BOOKING && hasActiveDraft) {
        return this.draftRecoveryAction.resumeIncompleteBooking(ctx);
      }
      return this.draftRecoveryAction.handleCheckLastBooking(ctx);
    }

    // 8. Global Priority 2.5: In-Flight Booking Collision Guard
    const isEntryAction = ['btn_book', 'btn_quick_book', 'btn_services', 'btn_book_now'].includes(input);
    const preBookingStates: ConversationState[] = [
      ConversationState.SELECT_CATEGORY,
      ConversationState.SELECT_SERVICE,
      ConversationState.SELECT_STAFF,
      ConversationState.SELECT_DATE,
      ConversationState.SELECT_TIME,
      ConversationState.SELECT_ADDON,
      ConversationState.CONFIRMATION,
      ConversationState.COLLECT_NAME,
      ConversationState.QUICK_BOOK_CONFIRM,
    ];
    const draftUpdatedAt = conversation.updatedAt ? new Date(conversation.updatedAt).getTime() : 0;
    const isDraftWindowActive = draftUpdatedAt > 0 && Date.now() - draftUpdatedAt <= 30 * 60 * 1000;
    const hasInProgressDraft =
      isDraftWindowActive &&
      preBookingStates.includes(conversation.state as ConversationState) &&
      (!!conversation.selectedCategoryId || !!conversation.selectedServiceId || !!conversation.selectedStartTime);

    if (isEntryAction && hasInProgressDraft) {
      return this.draftRecoveryAction.promptDraftConflict(ctx);
    }

    // 9. Funnel Action Stale Check (>30m)
    const isFunnelAction =
      input.startsWith('cat_') ||
      input.startsWith('gender_select_') ||
      input === 'btn_switch_gender' ||
      input.startsWith('svc_') ||
      input.startsWith('staff_') ||
      input.startsWith('date_') ||
      input.startsWith('slot_') ||
      input.startsWith('addon_') ||
      input === WhatsAppButtonId.CHANGE_TIME ||
      input === 'btn_change_time' ||
      input === WhatsAppButtonId.CHANGE_DATE ||
      input === 'btn_change_date' ||
      input.startsWith('btn_confirm');

    if (isFunnelAction) {
      const updatedAt = conversation.updatedAt ? new Date(conversation.updatedAt).getTime() : 0;
      const isDraftStale = updatedAt > 0 && Date.now() - updatedAt > 30 * 60 * 1000;
      if (isDraftStale) {
        await this.session.updateConversationState(
          conversation.id,
          ConversationState.START,
          null,
          ActionUtils.getClearDraftData(),
        );
        const staleNotice = {
          bodyText: "⚠️ *SESSION EXPIRED*\n\nYour previous booking session was inactive for more than 30 minutes. Let's start fresh!",
          interactiveType: 'button' as const,
          buttons: [
            { id: WhatsAppButtonId.BOOK_NOW, title: '📅 Book Appointment' },
            { id: WhatsAppButtonId.START, title: '🏠 Main Menu' },
          ],
        };
        await this.sendMessage(cleanNumber, staleNotice, phoneNumberId, salonId);
        return { replyMessage: staleNotice.bodyText, state: ConversationState.START };
      }
    }

    // 10. Lifecycle Stage Validation
    const lifecycleStage = this.session.determineLifecycleStage(conversation, activeAppointment, pendingAppointment);
    const isValidAction = this.session.isActionValidForLifecycle(
      lifecycleStage,
      conversation.state as ConversationState,
      input,
    );

    if (!isValidAction) {
      this.logger.warn(`[WhatsAppGateway] Stale button input "${input}" ignored for state ${conversation.state}`);
      const expireReply = await this.session.sendLifecycleExpirationResponse(
        cleanNumber,
        lifecycleStage,
        phoneNumberId,
        salonId,
      );
      const replyText = typeof expireReply === 'string' ? expireReply : (expireReply as any)?.bodyText || '';
      return { replyMessage: replyText, state: conversation.state };
    }

    // ====================================================
    // 11. ACTION DECIDER & DOMAIN DISPATCHER
    // ====================================================

    // A. Check-in & Client ETA Actions
    if (
      input === WhatsAppButtonId.REMIND_CONFIRM ||
      input === WhatsAppButtonId.ETA_ON_THE_WAY ||
      input === 'btn_eta_on_the_way' ||
      input === WhatsAppButtonId.ETA_ARRIVED ||
      input === WhatsAppButtonId.ETA_LATE_15 ||
      input.startsWith('late_')
    ) {
      return this.checkinAction.handle(ctx);
    }

    // B. Cancellation Actions
    if (
      input === WhatsAppButtonId.CANCEL_PENDING_QUICK ||
      (!activeAppointment && pendingAppointment && (normalizedInput === 'cancel' || normalizedInput === 'cancel request'))
    ) {
      return this.quickBookingAction.cancelPendingQuickBook(ctx);
    }

    if (
      [WhatsAppButtonId.CANCEL_APPT, WhatsAppButtonId.REMIND_CANCEL, WhatsAppButtonId.ETA_CANCEL].includes(input as any) ||
      normalizedInput === 'cancel' ||
      normalizedInput === 'cancel appointment' ||
      (conversation.state === ConversationState.CONFIRM_CANCEL &&
        [WhatsAppButtonId.CANCEL_YES, WhatsAppButtonId.CANCEL_NO, 'yes', 'no', 'keep', '1', '2'].some((kw) =>
          normalizedInput.includes(kw),
        ))
    ) {
      // If customer has only a pending request awaiting salon approval, cancel with zero penalty
      if (!activeAppointment && pendingAppointment) {
        return this.quickBookingAction.cancelPendingQuickBook(ctx);
      }
      return this.appointmentAction.handleCancellation(ctx);
    }

    // C. Reschedule Actions
    if (
      input === WhatsAppButtonId.RESCHEDULE ||
      input === WhatsAppButtonId.REMIND_RESCHEDULE ||
      input.startsWith('rdate_') ||
      input.startsWith('rslot_')
    ) {
      if (!activeAppointment && pendingAppointment) {
        const blockedReply = this.templates.buildPendingModificationBlockedReply();
        await this.sendMessage(cleanNumber, blockedReply, phoneNumberId, salonId);
        return { replyMessage: blockedReply.bodyText, state: conversation.state };
      }
      return this.appointmentAction.handleReschedule(ctx);
    }

    // D. Add Service Guard for Pending Requests
    if (input === WhatsAppButtonId.ADD_SERVICE || input === 'btn_add_service') {
      if (!activeAppointment && pendingAppointment) {
        const blockedReply = this.templates.buildPendingModificationBlockedReply();
        await this.sendMessage(cleanNumber, blockedReply, phoneNumberId, salonId);
        return { replyMessage: blockedReply.bodyText, state: conversation.state };
      }
    }

    // D. Salon Owner Proposed Reschedule Actions
    if (
      input.startsWith(WhatsAppButtonId.PROPOSE_ACCEPT_PREFIX) ||
      input.startsWith(WhatsAppButtonId.PROPOSE_DECLINE_PREFIX)
    ) {
      return this.appointmentAction.handleOwnerProposal(ctx);
    }

    // E. Quick Booking Entry & Confirmation
    if (input === WhatsAppButtonId.QUICK_BOOK) {
      return this.quickBookingAction.startQuickBook(ctx);
    }

    if (
      input === WhatsAppButtonId.CONFIRM_QUICK ||
      input === 'btn_confirm_quick' ||
      input === 'quick_book_confirm' ||
      (conversation.state === ConversationState.QUICK_BOOK_CONFIRM &&
        ['confirm', 'btn_confirm_quick', 'quick_book_confirm', 'yes'].includes(normalizedInput))
    ) {
      return this.quickBookingAction.confirmQuickBook(ctx);
    }

    // F. Standard Booking Funnel Actions (Default Domain)
    return this.bookingAction.handle(ctx);
  }

  /**
   * Delegates external direct service chosen events (e.g., from catalog list picks)
   */
  async handleServiceChosen(
    conversationId: string,
    customerPhone: string,
    salon: any,
    service: any,
    phoneNumberId?: string,
  ): Promise<ActionResult> {
    return this.bookingAction.handleServiceChosen(conversationId, customerPhone, salon, service, phoneNumberId);
  }
}
