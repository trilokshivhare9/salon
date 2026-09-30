import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { ConversationState } from '@prisma/client';
import { WhatsAppSenderService, WhatsAppButtonId } from './whatsapp-sender.service';
import { WhatsAppTemplateService } from './whatsapp-template.service';

export enum BookingLifecycleStage {
  PRE_BOOKING = 'PRE_BOOKING',
  POST_BOOKING = 'POST_BOOKING',
  IDLE = 'IDLE',
}

@Injectable()
export class WhatsAppSessionService {
  private readonly logger = new Logger(WhatsAppSessionService.name);

  constructor(
    private prisma: PrismaService,
    private sender: WhatsAppSenderService,
    private templates: WhatsAppTemplateService,
  ) {}

  getBookingType(conversation: { quickCodeVerifiedAt?: Date | null }): 'NORMAL' | 'QUICK' {
    if (!conversation?.quickCodeVerifiedAt) {
      return 'NORMAL';
    }
    const minsDiff = (Date.now() - new Date(conversation.quickCodeVerifiedAt).getTime()) / (1000 * 60);
    return minsDiff <= 30 ? 'QUICK' : 'NORMAL';
  }

  determineLifecycleStage(
    conversation: any,
    activeAppointment: any,
  ): BookingLifecycleStage {
    if (activeAppointment) {
      return BookingLifecycleStage.POST_BOOKING;
    }
    const preBookingStates: ConversationState[] = [
      ConversationState.SELECT_CATEGORY,
      ConversationState.SELECT_SERVICE,
      ConversationState.SELECT_STAFF,
      ConversationState.SELECT_DATE,
      ConversationState.SELECT_TIME,
      ConversationState.SELECT_ADDON,
      ConversationState.CONFIRMATION,
      ConversationState.COLLECT_NAME,
      ConversationState.QUICK_BOOK_CODE,
      ConversationState.QUICK_BOOK_CONFIRM,
    ];
    if (preBookingStates.includes(conversation.state as ConversationState)) {
      return BookingLifecycleStage.PRE_BOOKING;
    }
    return BookingLifecycleStage.IDLE;
  }

  isActionValidForLifecycle(
    stage: BookingLifecycleStage,
    conversationState: ConversationState,
    input: string,
  ): boolean {
    // Navigation buttons & greetings are always valid globally
    const normalizedInput = (input || '').trim().toLowerCase();
    if (
      ['btn_menu', 'btn_start', 'btn_services', 'btn_quick_book', 'btn_book', 'btn_info', 'btn_resume_booking', 'btn_new_booking'].includes(input) ||
      ['hi', 'hello', 'start', 'menu', 'restart', 'reset'].includes(normalizedInput)
    ) {
      return true;
    }

    if (['btn_cancel_yes', 'btn_cancel_no'].includes(input) && conversationState === ConversationState.CONFIRM_CANCEL) return true;
    if (['btn_confirm_yes', 'btn_confirm_no', 'btn_confirm'].includes(input) && conversationState === ConversationState.CONFIRMATION) return true;
    if (['btn_confirm_quick', 'confirm'].includes(input) && conversationState === ConversationState.QUICK_BOOK_CONFIRM) return true;
    if (['btn_reschedule', 'btn_change_stylist', 'btn_keep_appt'].includes(input) && conversationState === ConversationState.ADDON_CONFLICT) return true;
    if (input.startsWith('flow_response:') || input === 'flow_submit') return true;

    if (stage === BookingLifecycleStage.PRE_BOOKING) {
      switch (conversationState) {
        case ConversationState.QUICK_BOOK_CODE:
          return true;
        case ConversationState.SELECT_CATEGORY:
          return input.startsWith('cat_') || input.startsWith('gender_select_') || input === 'btn_switch_gender' || input.startsWith('svc_') || input.startsWith('qsvc_');
        case ConversationState.SELECT_SERVICE:
          return input.startsWith('svc_') || input.startsWith('qsvc_') || input === 'cat_back' || input.startsWith('gender_select_') || input === 'btn_switch_gender' || input === 'btn_all_categories';
        case ConversationState.SELECT_STAFF:
          return input.startsWith('staff_');
        case ConversationState.SELECT_DATE:
          return input.startsWith('date_');
        case ConversationState.SELECT_TIME:
          return input.startsWith('slot_') || input.startsWith('qslot_') || input.startsWith('btn_pick_stylist_') || input.startsWith('btn_pick_custom_date_');
        case ConversationState.SELECT_ADDON:
          return input.startsWith('addon_');
        default:
          return false;
      }
    } else if (stage === BookingLifecycleStage.POST_BOOKING) {
      if (['btn_add_service', 'btn_add_addon', 'btn_reschedule', 'btn_cancel_appt', 'btn_running_late', 'btn_eta_late_15', 'btn_eta_arrived', 'btn_eta_on_the_way', 'btn_eta_cancel', 'remind_confirm', 'remind_reschedule', 'remind_cancel', 'btn_book', 'btn_cancel_no', 'btn_cancel_yes'].includes(input)) {
        return true;
      }
      if (input.startsWith('svc_') || input.startsWith('remind_') || input.startsWith('appt_') || input.startsWith('propose_') || input.startsWith('late_') || input.startsWith('move_up_')) {
        return true;
      }

      switch (conversationState) {
        case ConversationState.SELECT_RESCHEDULE_DATE:
          return input.startsWith('rdate_');
        case ConversationState.SELECT_RESCHEDULE_TIME:
          return input.startsWith('rslot_');
        default:
          if (conversationState === ConversationState.ACTIVE_HUB) return true;
          return false;
      }
    }

    if (stage === BookingLifecycleStage.IDLE) {
      const isStaleInteractive =
        input.startsWith('remind_') ||
        input.startsWith('date_') ||
        input.startsWith('rdate_') ||
        input.startsWith('slot_') ||
        input.startsWith('qslot_') ||
        input.startsWith('rslot_') ||
        input.startsWith('svc_') ||
        input.startsWith('qsvc_') ||
        input.startsWith('staff_') ||
        ['btn_confirm_yes', 'btn_confirm', 'btn_cancel_yes', 'btn_eta_arrived', 'btn_eta_late_15'].includes(input);
      if (isStaleInteractive) return false;
    }

    return true;
  }

  async sendLifecycleExpirationResponse(
    cleanNumber: string,
    stage: BookingLifecycleStage,
    phoneNumberId?: string,
    salonId?: string,
    whatsAppService?: any,
  ) {
    const isPostBooking = stage === BookingLifecycleStage.POST_BOOKING || stage === BookingLifecycleStage.IDLE;
    const payload = this.templates.buildExpiredActionReply(isPostBooking);
    if (whatsAppService && typeof whatsAppService.sendMetaMessage === 'function') {
      await whatsAppService.sendMetaMessage(cleanNumber, payload, phoneNumberId, salonId);
    } else {
      await this.sender.sendMetaMessage(cleanNumber, payload, phoneNumberId, salonId);
    }
    return payload.bodyText;
  }

  // Multi-tenant in-memory customer user cache (15-min sliding TTL)
  // Eliminates 2 sequential DB round trips (user, salonUser) on active WhatsApp chats
  private readonly userCache = new Map<string, {
    user: any;
    salonUser: any;
    cachedAt: number;
  }>();
  private readonly USER_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
  private readonly MAX_USER_CACHE_SIZE = 5000;

  public getUserKey(salonId: string, cleanNumber: string): string {
    return `${salonId}:${cleanNumber}`;
  }

  public invalidateUserCache(salonId?: string, cleanNumber?: string): void {
    if (salonId && cleanNumber) {
      this.userCache.delete(this.getUserKey(salonId, cleanNumber));
    } else {
      this.userCache.clear();
    }
  }

  async getOrCreateSession(salonId: string, cleanNumber: string) {
    const key = this.getUserKey(salonId, cleanNumber);
    const now = Date.now();

    let user: any;
    let salonUser: any;

    // 1. Fast in-memory RAM lookup for User & SalonUser (< 0.001ms)
    const cached = this.userCache.get(key);
    if (cached && now - cached.cachedAt < this.USER_CACHE_TTL_MS) {
      cached.cachedAt = now; // Slide TTL
      user = cached.user;
      salonUser = cached.salonUser;
    } else {
      user = await this.prisma.user.findUnique({
        where: { phone: cleanNumber },
      });
      if (!user) {
        user = await this.prisma.user.create({
          data: { phone: cleanNumber, name: null },
        });
      }

      salonUser = await this.prisma.salonUser.upsert({
        where: { salonId_userId: { salonId, userId: user.id } },
        update: {},
        create: { salonId, userId: user.id },
      });

      if (this.userCache.size >= this.MAX_USER_CACHE_SIZE) {
        const oldestKey = this.userCache.keys().next().value;
        if (oldestKey) this.userCache.delete(oldestKey);
      }

      this.userCache.set(key, { user, salonUser, cachedAt: now });
    }

    // 2. Fetch Conversation by unique index (Always 100% authoritative and in-sync)
    let conversation = await this.prisma.conversation.findUnique({
      where: { salonId_customerPhone: { salonId, customerPhone: cleanNumber } },
    });

    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: {
          salonId,
          customerPhone: cleanNumber,
          customerName: user.name || null,
          state: ConversationState.START,
        },
      });
    }

    return {
      user: { ...user },
      salonUser: { ...salonUser },
      conversation,
    };
  }

  async updateConversationState(
    conversationId: string,
    state: ConversationState,
    activeAppointmentId?: string | null,
    extraData?: any,
  ) {
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        state,
        ...(activeAppointmentId !== undefined ? { activeAppointmentId } : {}),
        ...(extraData || {}),
      },
    });
  }
}
