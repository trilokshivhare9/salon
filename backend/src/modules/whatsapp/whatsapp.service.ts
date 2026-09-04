import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { AvailabilityService, AvailableSlotResponse } from '../availability/availability.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { ConversationState, BookingSource, MessageDirection, AppointmentStatus } from '@prisma/client';
import { DateTime } from 'luxon';

export interface InteractiveButton {
  id: string;
  title: string;
}

export interface InteractiveListRow {
  id: string;
  title: string;
  description?: string;
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private availabilityService: AvailabilityService,
    @Inject(forwardRef(() => AppointmentsService))
    private appointmentsService: AppointmentsService,
  ) {}

  // Verify Webhook Handshake for Meta
  verifyWebhook(mode: string, token: string, challenge: string, expectedToken: string): string {
    if (mode === 'subscribe' && token === expectedToken) {
      this.logger.log('Meta WhatsApp Webhook successfully verified.');
      return challenge;
    }
    throw new BadRequestException('Webhook verification token mismatch.');
  }

  private cleanPhone(phone: string): string {
    return phone.replace(/[^\d+]/g, '');
  }

  // Outbound Dispatch to Meta Cloud API Graph endpoint (Supports Text, Buttons, and Radio List Pickers)
  async sendMetaMessage(
    toPhone: string,
    payload: {
      textBody?: string;
      interactiveType?: 'button' | 'list';
      headerText?: string;
      bodyText?: string;
      footerText?: string;
      buttonText?: string;
      buttons?: InteractiveButton[];
      listRows?: InteractiveListRow[];
    },
    phoneNumberId?: string,
    salonId?: string,
  ) {
    const accessToken =
      this.configService.get<string>('whatsapp.accessToken') ||
      process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneId =
      phoneNumberId ||
      this.configService.get<string>('whatsapp.phoneNumberId') ||
      process.env.WHATSAPP_PHONE_NUMBER_ID ||
      '1266237649907696';

    const cleanTo = this.cleanPhone(toPhone);

    if (!accessToken) {
      this.logger.warn(
        `[WhatsAppService] ⚠️ Cannot send outbound WhatsApp message to ${toPhone}: WHATSAPP_ACCESS_TOKEN is missing or not configured in environment variables.`,
      );
      await this.prisma.whatsAppLog
        .create({
          data: {
            salonId: salonId || null,
            phone: cleanTo,
            direction: MessageDirection.OUTBOUND,
            messageText: payload.bodyText || payload.textBody || '',
            interactiveId: payload.interactiveType || null,
            status: 'FAILED',
            errorMessage: 'WHATSAPP_ACCESS_TOKEN is missing or not configured.',
          },
        })
        .catch(() => {});
      return;
    }

    try {
      const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
      let bodyData: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toPhone.replace('+', ''),
      };

      if (payload.interactiveType === 'button' && payload.buttons && payload.buttons.length > 0) {
        // WhatsApp Interactive Buttons (Up to 3 tap buttons)
        bodyData.type = 'interactive';
        bodyData.interactive = {
          type: 'button',
          body: { text: payload.bodyText || 'Please select an option:' },
          footer: payload.footerText ? { text: payload.footerText } : undefined,
          action: {
            buttons: payload.buttons.slice(0, 3).map((b) => ({
              type: 'reply',
              reply: { id: b.id, title: b.title.slice(0, 20) },
            })),
          },
        };
      } else if (payload.interactiveType === 'list' && payload.listRows && payload.listRows.length > 0) {
        // WhatsApp Interactive Radio List Picker (Native sheet popup on mobile!)
        bodyData.type = 'interactive';
        bodyData.interactive = {
          type: 'list',
          header: payload.headerText ? { type: 'text', text: payload.headerText } : undefined,
          body: { text: payload.bodyText || 'Please choose from the menu:' },
          footer: { text: payload.footerText || 'Tap button below to select' },
          action: {
            button: payload.buttonText || '👉 Tap to Choose',
            sections: [
              {
                title: 'Available Options',
                rows: payload.listRows.slice(0, 10).map((r) => ({
                  id: r.id,
                  title: r.title.slice(0, 24),
                  description: r.description ? r.description.slice(0, 72) : undefined,
                })),
              },
            ],
          },
        };
      } else {
        // Standard Text Message
        bodyData.type = 'text';
        bodyData.text = { preview_url: false, body: payload.textBody || payload.bodyText || '' };
      }

      this.logger.log(
        `[WhatsAppService] 🚀 Dispatching to Meta Cloud API (phoneId=${phoneId}, to=${toPhone}, type=${bodyData.type})`,
      );

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bodyData),
        signal: AbortSignal.timeout(5000),
      });

      const data = await res.json();
      const errObj = data?.error || {};

      // Persist Outbound Log directly into PostgreSQL database
      await this.prisma.whatsAppLog
        .create({
          data: {
            salonId: salonId || null,
            phone: cleanTo,
            direction: MessageDirection.OUTBOUND,
            messageText: payload.bodyText || payload.textBody || '',
            interactiveId: payload.interactiveType || null,
            status: res.ok ? 'SENT' : 'FAILED',
            metaMessageId: data?.messages?.[0]?.id || null,
            errorCode: errObj.code || null,
            errorMessage: errObj.message || null,
            rawPayload: data,
          },
        })
        .catch((dbErr) => this.logger.error('Failed to persist outbound WhatsApp log:', dbErr));

      if (!res.ok) {
        this.logger.error(
          `[WhatsAppService] ❌ Meta Cloud API Error (HTTP ${res.status}): ${JSON.stringify(data)}`,
        );

        // Provide clear diagnostic hints in logs for common Meta Cloud API issues
        if (errObj.code === 190) {
          this.logger.error(
            `[WhatsAppService] 🔑 DIAGNOSTIC HINT: WHATSAPP_ACCESS_TOKEN is invalid or has expired. Generate a Permanent System User Token in Meta Business Manager.`,
          );
        } else if (errObj.code === 131030) {
          this.logger.error(
            `[WhatsAppService] 📱 DIAGNOSTIC HINT: Recipient ${toPhone} is not in your allowed test numbers list. Add ${toPhone} under "To" numbers in Meta Developers WhatsApp Dashboard (Sandbox mode).`,
          );
        } else if (errObj.code === 131047 || errObj.code === 131026) {
          this.logger.error(
            `[WhatsAppService] ⏳ DIAGNOSTIC HINT: Re-engagement window expired. More than 24 hours have passed since the customer messaged.`,
          );
        }

        // Fallback to plain text if interactive message was rejected
        if (bodyData.type === 'interactive') {
          this.logger.warn(`[WhatsAppService] 🔄 Retrying outbound message as plain text fallback to ${toPhone}...`);
          const fallbackText = payload.textBody || payload.bodyText || 'Please reply to choose an option.';
          await fetch(url, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              messaging_product: 'whatsapp',
              recipient_type: 'individual',
              to: toPhone.replace('+', ''),
              type: 'text',
              text: { preview_url: false, body: fallbackText },
            }),
            signal: AbortSignal.timeout(5000),
          }).catch((fallbackErr) => {
            this.logger.error('[WhatsAppService] Fallback text message also failed:', fallbackErr);
          });
        }
      } else {
        this.logger.log(
          `[WhatsAppService] ✅ Outbound WhatsApp successfully sent to ${toPhone} | Message ID: ${data?.messages?.[0]?.id}`,
        );
      }
    } catch (err) {
      this.logger.error('[WhatsAppService] Network exception sending Meta Cloud API message:', err);
    }
  }

  // Database Logging Helpers
  async recordInboundLog(
    salonId: string | null,
    fromPhone: string,
    messageText: string,
    interactiveId?: string,
    rawPayload?: any,
  ) {
    const cleanPhone = this.cleanPhone(fromPhone);
    return this.prisma.whatsAppLog
      .create({
        data: {
          salonId: salonId || null,
          phone: cleanPhone,
          direction: MessageDirection.INBOUND,
          messageText,
          interactiveId: interactiveId || null,
          status: 'RECEIVED',
          rawPayload: rawPayload || null,
        },
      })
      .catch((e) => this.logger.error('Failed to persist inbound WhatsApp log:', e));
  }

  async recordStatusLog(statusObj: any) {
    const recipient = this.cleanPhone(statusObj.recipient_id || '');
    const metaMessageId = statusObj.id || null;
    const status = (statusObj.status || 'UNKNOWN').toUpperCase();
    const error = statusObj.errors?.[0];

    return this.prisma.whatsAppLog
      .create({
        data: {
          phone: recipient,
          direction: MessageDirection.OUTBOUND,
          status,
          metaMessageId,
          errorCode: error?.code || null,
          errorMessage: error?.title || error?.message || null,
          rawPayload: statusObj,
        },
      })
      .catch((e) => this.logger.error('Failed to persist status WhatsApp log:', e));
  }

  async getLogs(filter: { phone?: string; salonId?: string; limit?: number }) {
    const where: any = {};
    if (filter.phone) {
      const clean = this.cleanPhone(filter.phone);
      where.phone = { contains: clean.replace('+', '') };
    }
    if (filter.salonId) {
      where.salonId = filter.salonId;
    }

    const logs = await this.prisma.whatsAppLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: filter.limit || 50,
      include: { salon: { select: { id: true, name: true, slug: true } } },
    });

    return {
      total: logs.length,
      logs,
    };
  }

  // Helper: Prompt Date Selection (3 Quick Date Buttons)
  private async promptDateSelection(
    conversationId: string,
    cleanNumber: string,
    salon: any,
    selectedService: any,
    selectedStaffName: string,
    phoneNumberId?: string,
  ) {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { state: ConversationState.SELECT_DATE },
    });

    const tz = salon.timezone || 'Asia/Kolkata';
    const today = DateTime.now().setZone(tz);
    const tomorrow = today.plus({ days: 1 });
    const dayAfter = today.plus({ days: 2 });

    const reply = `✅ Service: *${selectedService.name}* (₹${selectedService.price})\n👤 Specialist: *${selectedStaffName}*\n\n📅 *Select Date for your appointment:*`;
    await this.sendMetaMessage(
      cleanNumber,
      {
        bodyText: reply,
        interactiveType: 'button',
        buttons: [
          { id: 'date_1', title: `Today (${today.toFormat('dd LLL')})` },
          { id: 'date_2', title: `Tmrw (${tomorrow.toFormat('dd LLL')})` },
          { id: 'date_3', title: dayAfter.toFormat('EEE dd LLL') },
        ],
      },
      phoneNumberId,
    );

    return { replyMessage: reply, state: ConversationState.SELECT_DATE };
  }

  // Helper: Prompt Specialist / Staff Selection
  private async promptStaffSelection(
    conversationId: string,
    cleanNumber: string,
    salon: any,
    selectedService: any,
    qualifiedStaff: any[],
    phoneNumberId?: string,
  ) {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        selectedServiceId: selectedService.id,
        state: ConversationState.SELECT_STAFF,
      },
    });

    if (qualifiedStaff.length <= 2) {
      const buttons: InteractiveButton[] = [
        { id: 'staff_any', title: '✨ Any Specialist' },
        ...qualifiedStaff.map((st) => ({ id: `staff_${st.id}`, title: st.name })),
      ];

      const reply = `✅ Selected: *${selectedService.name}* (₹${selectedService.price})\n\nWho would you like as your specialist?`;
      await this.sendMetaMessage(
        cleanNumber,
        {
          bodyText: reply,
          interactiveType: 'button',
          buttons: buttons.slice(0, 3),
        },
        phoneNumberId,
      );
      return { replyMessage: reply, state: ConversationState.SELECT_STAFF, metadata: { qualifiedStaff } };
    } else {
      const listRows: InteractiveListRow[] = [
        { id: 'staff_any', title: '✨ Any Specialist', description: 'Fastest available slot' },
        ...qualifiedStaff.map((st) => ({
          id: `staff_${st.id}`,
          title: st.name,
          description: 'Specialist Stylist',
        })),
      ];

      const reply = `✅ Selected: *${selectedService.name}* (₹${selectedService.price})\n\nChoose your preferred specialist:`;
      await this.sendMetaMessage(
        cleanNumber,
        {
          headerText: `${salon.name} Specialists`,
          bodyText: reply,
          footerText: 'Tap below to select',
          buttonText: '👤 Select Specialist',
          interactiveType: 'list',
          listRows,
        },
        phoneNumberId,
      );
      return { replyMessage: reply, state: ConversationState.SELECT_STAFF, metadata: { qualifiedStaff } };
    }
  }

  // Helper: Query active upcoming appointments for a customer
  private async findActiveUpcomingAppointments(salonId: string, cleanNumber: string) {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000); // within last 30 mins or in future
    return this.prisma.appointment.findMany({
      where: {
        salonId,
        customer: { phone: cleanNumber },
        status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN] },
        startTime: { gte: cutoff },
      },
      include: {
        customer: true,
        staff: true,
        service: true,
      },
      orderBy: { startTime: 'asc' },
    });
  }

  // Helper: Present the Active Booking Hub
  private async showActiveBookingHub(
    conversationId: string,
    cleanNumber: string,
    salon: any,
    activeAppt: any,
    phoneNumberId?: string,
  ) {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        state: ConversationState.ACTIVE_HUB,
        activeAppointmentId: activeAppt.id,
        selectedServiceId: activeAppt.serviceId,
        selectedStaffId: activeAppt.staffId,
      },
    });

    const tz = salon.timezone || 'Asia/Kolkata';
    const timeFormatted = DateTime.fromJSDate(activeAppt.startTime, { zone: tz }).toFormat('hh:mm a');
    const dateFormatted = DateTime.fromJSDate(activeAppt.startTime, { zone: tz }).toFormat('dd LLL, EEE');

    const reply = `👋 Welcome back, *${activeAppt.customer.name}*!\n\n📅 *Your Upcoming Appointment:*\n• Service: *${activeAppt.service.name}* (₹${activeAppt.price})\n• Specialist: *${activeAppt.staff.name}*\n• Date: *${dateFormatted}*\n• Time: *${timeFormatted}*\n• Status: *${activeAppt.status}* (Ref: *#${activeAppt.appointmentNumber}*)\n\nWhat would you like to do?`;

    await this.sendMetaMessage(
      cleanNumber,
      {
        bodyText: reply,
        interactiveType: 'button',
        buttons: [
          { id: 'btn_add_service', title: '➕ Add Service' },
          { id: 'btn_reschedule', title: '🔄 Reschedule' },
          { id: 'btn_cancel_appt', title: '✕ Cancel Slot' },
        ],
      },
      phoneNumberId,
    );

    return { replyMessage: reply, state: ConversationState.ACTIVE_HUB, metadata: { activeAppointment: activeAppt } };
  }

  // Helper: Fast-track Service Chosen logic (Auto-bypasses staff if single staff)
  private async handleServiceChosen(
    conversationId: string,
    cleanNumber: string,
    salon: any,
    selectedService: any,
    phoneNumberId?: string,
  ) {
    const qualifiedStaff = salon.staff.filter((st: any) =>
      st.services.some((svc: any) => svc.serviceId === selectedService.id),
    );

    // Auto-bypass: If only 1 or 0 qualified staff -> auto-assign and advance directly to Date selection!
    if (qualifiedStaff.length <= 1) {
      const autoStaff = qualifiedStaff[0] || null;
      await this.prisma.conversation.update({
        where: { id: conversationId },
        data: {
          selectedServiceId: selectedService.id,
          selectedStaffId: autoStaff ? autoStaff.id : null,
          state: ConversationState.SELECT_DATE,
        },
      });
      return this.promptDateSelection(
        conversationId,
        cleanNumber,
        salon,
        selectedService,
        autoStaff ? autoStaff.name : 'Specialist',
        phoneNumberId,
      );
    }

    // Multiple qualified staff -> prompt staff selection
    return this.promptStaffSelection(
      conversationId,
      cleanNumber,
      salon,
      selectedService,
      qualifiedStaff,
      phoneNumberId,
    );
  }

  /**
   * Helper to format "HH:mm" time strings to 12-hour AM/PM format (e.g. "14:00" -> "2:00 PM")
   */
  public formatTime12h(timeStr: string): string {
    if (!timeStr) return '';
    const parts = timeStr.trim().split(':');
    let h = parseInt(parts[0], 10);
    const m = parts[1] || '00';
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${m} ${ampm}`;
  }

  /**
   * Universal Time Slot Parser: Handles list taps, clean times, 12h AM/PM, and list indices
   */
  public parseTimeSlot(
    input: string,
    availableSlots: AvailableSlotResponse[],
  ): AvailableSlotResponse | null {
    if (!availableSlots || availableSlots.length === 0) return null;

    const raw = input.trim();
    // 1. Direct interactive IDs: slot_10:00, rslot_10:00
    const cleanId = raw.replace(/^r?slot_/, '').trim();
    const exactMatch = availableSlots.find((s) => s.startTime === cleanId);
    if (exactMatch) return exactMatch;

    // 2. Numeric index: "1", "2", "3"
    const indexNum = parseInt(raw, 10);
    if (!isNaN(indexNum) && indexNum >= 1 && indexNum <= availableSlots.length) {
      return availableSlots[indexNum - 1];
    }

    // 3. Regex parser: matches "09:30", "9:30", "9:30 am", "9:30pm", "9pm", "14:30"
    const timeRegex = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
    const match = raw.match(timeRegex);
    if (match) {
      let hours = parseInt(match[1], 10);
      const minutes = match[2] ? match[2] : '00';
      const meridian = match[3]?.toLowerCase();

      if (meridian === 'pm' && hours < 12) hours += 12;
      if (meridian === 'am' && hours === 12) hours = 0;

      const formatted24 = `${hours.toString().padStart(2, '0')}:${minutes.padStart(2, '0')}`;
      const found24 = availableSlots.find((s) => s.startTime === formatted24);
      if (found24) return found24;

      const foundFuzzy = availableSlots.find((s) => {
        const [sh, sm] = s.startTime.split(':').map((v) => parseInt(v, 10));
        return sh === hours && sm === parseInt(minutes, 10);
      });
      if (foundFuzzy) return foundFuzzy;
    }

    // 4. Substring contains: e.g. "⏰ 10:00" or "⏰ 2:00 PM"
    const subMatch = availableSlots.find((s) => {
      const s12 = this.formatTime12h(s.startTime).toLowerCase();
      const rawLower = raw.toLowerCase();
      return raw.includes(s.startTime) || rawLower.includes(s12);
    });
    if (subMatch) return subMatch;

    return null;
  }

  // Core Conversation Handler for both Meta Webhook and Web Simulator
  async handleIncomingMessage(
    salonId: string,
    customerPhone: string,
    messageText: string,
    interactiveId?: string,
    phoneNumberId?: string,
  ): Promise<{ replyMessage: string; state: ConversationState; metadata?: any }> {
    const cleanNumber = this.cleanPhone(customerPhone);

    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      include: {
        services: { where: { status: 'ACTIVE' }, orderBy: { name: 'asc' } },
        staff: { where: { status: 'ACTIVE' }, include: { services: true } },
      },
    });

    if (!salon || salon.status !== 'ACTIVE') {
      const reply = 'Sorry, this salon booking service is currently inactive.';
      await this.sendMetaMessage(cleanNumber, { textBody: reply }, phoneNumberId);
      return { replyMessage: reply, state: ConversationState.START };
    }

    let conversation = await this.prisma.conversation.findUnique({
      where: {
        salonId_customerPhone: {
          salonId,
          customerPhone: cleanNumber,
        },
      },
    });

    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: {
          salonId,
          customerPhone: cleanNumber,
          state: ConversationState.START,
        },
      });
    }

    // Stale Conversation Recovery (Auto-reset if idle for > 2 hours in an unfinished booking step)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const isStale =
      conversation.updatedAt < twoHoursAgo &&
      ![ConversationState.START as string, ConversationState.ACTIVE_HUB as string].includes(conversation.state);

    if (isStale) {
      this.logger.log(`[WhatsAppService] ⏳ Session for ${cleanNumber} expired (idle > 2h). Resetting to fresh state.`);
      const activeAppts = await this.findActiveUpcomingAppointments(salonId, cleanNumber);
      if (activeAppts.length > 0) {
        return this.showActiveBookingHub(conversation.id, cleanNumber, salon, activeAppts[0], phoneNumberId);
      }
      conversation = await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          state: ConversationState.START,
          selectedServiceId: null,
          selectedStaffId: null,
          selectedDate: null,
          selectedStartTime: null,
          activeAppointmentId: null,
        },
      });
    }

    const input = (interactiveId || messageText).trim();
    const normalized = input.toLowerCase();

    this.logger.log(
      `[WhatsAppService] 💬 Processing message for ${cleanNumber} (Salon: "${salon.name}") | State: ${conversation.state} | Input: "${input}"`,
    );

    // Reset / Menu commands
    if (['hi', 'hello', 'hey', 'start', 'menu', 'reset', 'btn_start', 'btn_menu'].includes(normalized)) {
      // Check if client has an active upcoming appointment
      const activeAppts = await this.findActiveUpcomingAppointments(salonId, cleanNumber);
      if (activeAppts.length > 0) {
        return this.showActiveBookingHub(conversation.id, cleanNumber, salon, activeAppts[0], phoneNumberId);
      }

      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          state: ConversationState.START,
          selectedServiceId: null,
          selectedStaffId: null,
          selectedDate: null,
          selectedStartTime: null,
          activeAppointmentId: null,
        },
      });

      const reply = `👋 *Welcome to ${salon.name}!*\n\nHow can we help you today?`;
      await this.sendMetaMessage(
        cleanNumber,
        {
          bodyText: reply,
          interactiveType: 'button',
          buttons: [
            { id: 'btn_book', title: '📅 Book Slot' },
            { id: 'btn_services', title: '✂️ Services Menu' },
            { id: 'btn_info', title: '📍 Salon Info' },
          ],
        },
        phoneNumberId,
      );

      return { replyMessage: reply, state: ConversationState.START };
    }

    // -------------------------------------------------------------------------
    // REMINDER & LATE-ARRIVAL RESPONSES
    // -------------------------------------------------------------------------
    if (input === 'remind_confirm') {
      const reply = `🎉 *Thank you for confirming!*\n\nWe have your seat reserved and look forward to welcoming you at *${salon.name}*!`;
      await this.sendMetaMessage(
        cleanNumber,
        {
          bodyText: reply,
          interactiveType: 'button',
          buttons: [{ id: 'btn_start', title: '🏠 Main Menu' }],
        },
        phoneNumberId,
        salonId,
      );
      return { replyMessage: reply, state: ConversationState.START };
    }

    if (input.startsWith('late_on_way')) {
      const apptId = input.replace('late_on_way_', '');
      if (apptId && apptId !== 'late_on_way') {
        await this.prisma.appointment.update({
          where: { id: apptId },
          data: { clientEtaStatus: 'ON_WAY_10M' },
        }).catch(() => {});
      } else {
        const activeAppts = await this.findActiveUpcomingAppointments(salonId, cleanNumber);
        if (activeAppts.length > 0) {
          await this.prisma.appointment.update({
            where: { id: activeAppts[0].id },
            data: { clientEtaStatus: 'ON_WAY_10M' },
          }).catch(() => {});
        }
      }

      const reply = `🚗 *Thanks for letting us know!*\n\nWe have held your specialist's chair for the next 10 minutes. Please drive safely and see you shortly!`;
      await this.sendMetaMessage(
        cleanNumber,
        {
          bodyText: reply,
          interactiveType: 'button',
          buttons: [{ id: 'btn_start', title: '🏠 Main Menu' }],
        },
        phoneNumberId,
        salonId,
      );
      return { replyMessage: reply, state: ConversationState.START };
    }

    if (input.startsWith('late_cancel') || input === 'remind_cancel') {
      const apptId = input.startsWith('late_cancel_') ? input.replace('late_cancel_', '') : null;
      let targetApptId = apptId;
      if (!targetApptId) {
        const activeAppts = await this.findActiveUpcomingAppointments(salonId, cleanNumber);
        if (activeAppts.length > 0) targetApptId = activeAppts[0].id;
      }

      if (targetApptId) {
        await this.appointmentsService.updateStatus(salonId, targetApptId, {
          status: AppointmentStatus.CANCELLED,
          reason: 'Cancelled by client via WhatsApp reminder/late follow-up.',
        }).catch(() => {});
      }

      const reply = `✅ *Your chair has been released.*\n\nThank you for informing us in advance so another client could be accommodated. Reply *'Hi'* anytime to book a new slot!`;
      await this.sendMetaMessage(
        cleanNumber,
        {
          bodyText: reply,
          interactiveType: 'button',
          buttons: [{ id: 'btn_start', title: '📅 Book New Slot' }],
        },
        phoneNumberId,
        salonId,
      );
      return { replyMessage: reply, state: ConversationState.START };
    }

    if (input === 'remind_reschedule') {
      const activeAppts = await this.findActiveUpcomingAppointments(salonId, cleanNumber);
      if (activeAppts.length > 0) {
        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            state: ConversationState.SELECT_RESCHEDULE_DATE,
            activeAppointmentId: activeAppts[0].id,
          },
        });

        const tz = salon.timezone || 'Asia/Kolkata';
        const today = DateTime.now().setZone(tz);
        const tomorrow = today.plus({ days: 1 });
        const dayAfter = today.plus({ days: 2 });

        const reply = `📅 *Select a new Date to Reschedule:*`;
        await this.sendMetaMessage(
          cleanNumber,
          {
            bodyText: reply,
            interactiveType: 'button',
            buttons: [
              { id: 'rdate_1', title: `Today (${today.toFormat('dd LLL')})` },
              { id: 'rdate_2', title: `Tmrw (${tomorrow.toFormat('dd LLL')})` },
              { id: 'rdate_3', title: dayAfter.toFormat('EEE dd LLL') },
            ],
          },
          phoneNumberId,
          salonId,
        );

        return { replyMessage: reply, state: ConversationState.SELECT_RESCHEDULE_DATE };
      }
    }

    // Direct Service Trigger (from Menu buttons or list selections from any state)
    if (input.startsWith('svc_')) {
      const svcId = input.replace('svc_', '');
      const svc = salon.services.find((s) => s.id === svcId);
      if (svc) {
        return this.handleServiceChosen(conversation.id, cleanNumber, salon, svc, phoneNumberId);
      }
    }

    // Direct Add-on Trigger
    if (input.startsWith('addon_')) {
      const addonId = input.replace('addon_', '');
      if (conversation.activeAppointmentId) {
        const result = await this.appointmentsService.addServiceToAppointment(
          salonId,
          conversation.activeAppointmentId,
          addonId,
        );

        if (result.success) {
          const tz = salon.timezone || 'Asia/Kolkata';
          const timeFormatted = DateTime.fromJSDate(result.updatedAppointment.startTime, { zone: tz }).toFormat('hh:mm a');
          const endFormatted = DateTime.fromJSDate(result.updatedAppointment.endTime, { zone: tz }).toFormat('hh:mm a');

          const reply = `✅ *Added to Your Visit!*\n\n• *Added Service:* ${result.extraService.name} (+₹${result.extraService.price})\n• *Updated Total:* ₹${result.updatedAppointment.price}\n• *Appointment Window:* ${timeFormatted} – ${endFormatted}\n• *Specialist:* ${result.updatedAppointment.staff.name}\n\nWe look forward to seeing you!`;
          await this.sendMetaMessage(
            cleanNumber,
            {
              bodyText: reply,
              interactiveType: 'button',
              buttons: [{ id: 'btn_start', title: '🏠 Main Menu' }],
            },
            phoneNumberId,
          );

          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: { state: ConversationState.START },
          });

          return { replyMessage: reply, state: ConversationState.START };
        } else if (result.conflict) {
          const reply = `⚠️ Specialist *${result.conflictBooking?.staff?.name || 'Stylist'}* has another client booked right after your slot.\n\nWould you like to reschedule both services together to a new time slot?`;
          await this.sendMetaMessage(
            cleanNumber,
            {
              bodyText: reply,
              interactiveType: 'button',
              buttons: [
                { id: 'btn_reschedule', title: '🔄 Reschedule Both' },
                { id: 'btn_start', title: '🔙 Keep As Is' },
              ],
            },
            phoneNumberId,
          );
          return { replyMessage: reply, state: ConversationState.ACTIVE_HUB };
        }
      }
    }

    // -------------------------------------------------------------
    // STATE MACHINE
    // -------------------------------------------------------------
    switch (conversation.state) {
      case ConversationState.ACTIVE_HUB: {
        if (input === 'btn_add_service' || normalized.includes('add')) {
          const activeAppt = conversation.activeAppointmentId
            ? await this.appointmentsService.getAppointmentById(salonId, conversation.activeAppointmentId).catch(() => null)
            : null;

          const remainingServices = salon.services.filter(
            (s) => !activeAppt || s.id !== activeAppt.serviceId,
          );

          if (remainingServices.length === 0) {
            const reply = 'You already have our available services selected for this visit!';
            await this.sendMetaMessage(cleanNumber, { textBody: reply }, phoneNumberId);
            return { replyMessage: reply, state: ConversationState.ACTIVE_HUB };
          }

          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: { state: ConversationState.SELECT_ADDON },
          });

          const listRows: InteractiveListRow[] = remainingServices.map((s) => ({
            id: `addon_${s.id}`,
            title: `+ ${s.name}`,
            description: `+₹${s.price} • +${s.durationMinutes} mins`,
          }));

          const reply = `✨ *Choose an extra service to add to your appointment:*`;
          await this.sendMetaMessage(
            cleanNumber,
            {
              headerText: 'Add-on Services',
              bodyText: reply,
              footerText: 'Tap below to add',
              buttonText: '➕ Select Add-on',
              interactiveType: 'list',
              listRows,
            },
            phoneNumberId,
          );

          return { replyMessage: reply, state: ConversationState.SELECT_ADDON };
        } else if (input === 'btn_reschedule' || normalized.includes('reschedule')) {
          const tz = salon.timezone || 'Asia/Kolkata';
          const now = DateTime.now().setZone(tz);

          if (conversation.activeAppointmentId) {
            const activeAppt = await this.prisma.appointment.findUnique({
              where: { id: conversation.activeAppointmentId },
              include: { staff: true, service: true },
            });

            if (activeAppt) {
              const apptStart = DateTime.fromJSDate(activeAppt.startTime, { zone: tz });
              const hoursUntilAppt = apptStart.diff(now, 'hours').hours;
              const cancelWindowHours = salon.cancelWindowHours ?? 2;

              if (hoursUntilAppt < cancelWindowHours && hoursUntilAppt > -1) {
                // Critical Window (< 2 hours): Protect salon chair from last-minute abandonment
                const reply = `⚠️ *Appointment is in less than ${cancelWindowHours} hours!*\n\nSpecialist *${activeAppt.staff?.name || 'Your specialist'}* has already reserved your chair for *${activeAppt.service?.name}*.\n\n• If you are delayed in traffic, tap *'Running 15m Late'* to hold your station.\n• To change your slot today, call our front desk directly at *${salon.phone || 'our desk'}*.`;
                await this.sendMetaMessage(
                  cleanNumber,
                  {
                    bodyText: reply,
                    interactiveType: 'button',
                    buttons: [
                      { id: 'btn_eta_late_15', title: '🚗 Running 15m Late' },
                      { id: 'btn_menu', title: '📋 Main Menu' },
                    ],
                  },
                  phoneNumberId,
                );
                return { replyMessage: reply, state: ConversationState.START };
              }
            }
          }

          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: { state: ConversationState.SELECT_RESCHEDULE_DATE },
          });

          const today = DateTime.now().setZone(tz);
          const tomorrow = today.plus({ days: 1 });
          const dayAfter = today.plus({ days: 2 });

          const reply = `📅 *Select a new Date to Reschedule:*`;
          await this.sendMetaMessage(
            cleanNumber,
            {
              bodyText: reply,
              interactiveType: 'button',
              buttons: [
                { id: 'rdate_1', title: `Today (${today.toFormat('dd LLL')})` },
                { id: 'rdate_2', title: `Tmrw (${tomorrow.toFormat('dd LLL')})` },
                { id: 'rdate_3', title: dayAfter.toFormat('EEE dd LLL') },
              ],
            },
            phoneNumberId,
          );

          return { replyMessage: reply, state: ConversationState.SELECT_RESCHEDULE_DATE };

        } else if (input === 'btn_cancel_appt' || normalized.includes('cancel')) {
          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: { state: ConversationState.CONFIRM_CANCEL },
          });

          const reply = `⚠️ *Are you sure you want to cancel your appointment?*\n\nYour reserved chair slot will be released immediately.`;
          await this.sendMetaMessage(
            cleanNumber,
            {
              bodyText: reply,
              interactiveType: 'button',
              buttons: [
                { id: 'btn_cancel_yes', title: '✅ Yes, Cancel' },
                { id: 'btn_cancel_no', title: '🔙 Keep Slot' },
              ],
            },
            phoneNumberId,
          );

          return { replyMessage: reply, state: ConversationState.CONFIRM_CANCEL };
        } else {
          // If customer wants to start a fresh booking anyway
          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: { state: ConversationState.START },
          });
          return this.handleIncomingMessage(salonId, cleanNumber, 'hi', undefined, phoneNumberId);
        }
      }

      case ConversationState.SELECT_ADDON: {
        let addonService = null;
        if (input.startsWith('addon_')) {
          const addonId = input.replace('addon_', '');
          addonService = salon.services.find((s) => s.id === addonId);
        } else {
          addonService = salon.services.find((s) => s.name.toLowerCase().includes(normalized));
        }

        if (!addonService || !conversation.activeAppointmentId) {
          const reply = `❌ Service not recognized. Returning to active hub.`;
          await this.sendMetaMessage(cleanNumber, { textBody: reply }, phoneNumberId);
          return { replyMessage: reply, state: ConversationState.ACTIVE_HUB };
        }

        const result = await this.appointmentsService.addServiceToAppointment(
          salonId,
          conversation.activeAppointmentId,
          addonService.id,
        );

        if (result.success) {
          const tz = salon.timezone || 'Asia/Kolkata';
          const timeFormatted = DateTime.fromJSDate(result.updatedAppointment.startTime, { zone: tz }).toFormat('hh:mm a');
          const endFormatted = DateTime.fromJSDate(result.updatedAppointment.endTime, { zone: tz }).toFormat('hh:mm a');

          const reply = `✅ *Added to Your Visit!*\n\n• *Added:* ${result.extraService.name} (+₹${result.extraService.price})\n• *Total:* ₹${result.updatedAppointment.price}\n• *Appointment Window:* ${timeFormatted} – ${endFormatted}\n• *Specialist:* ${result.updatedAppointment.staff.name}\n\nWe look forward to giving you a great experience!`;
          await this.sendMetaMessage(
            cleanNumber,
            {
              bodyText: reply,
              interactiveType: 'button',
              buttons: [{ id: 'btn_start', title: '🏠 Main Menu' }],
            },
            phoneNumberId,
          );

          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: { state: ConversationState.START },
          });

          return { replyMessage: reply, state: ConversationState.START };
        } else {
          const reply = `⚠️ Specialist *${result.conflictBooking?.staff?.name || 'Stylist'}* has another booking right after.\n\nWould you like to reschedule both services together?`;
          await this.sendMetaMessage(
            cleanNumber,
            {
              bodyText: reply,
              interactiveType: 'button',
              buttons: [
                { id: 'btn_reschedule', title: '🔄 Reschedule' },
                { id: 'btn_start', title: '🔙 Keep As Is' },
              ],
            },
            phoneNumberId,
          );
          return { replyMessage: reply, state: ConversationState.ACTIVE_HUB };
        }
      }

      case ConversationState.SELECT_RESCHEDULE_DATE: {
        const tz = salon.timezone || 'Asia/Kolkata';
        const today = DateTime.now().setZone(tz);
        let targetDate = today;

        if (input === 'rdate_1' || input === 'date_1' || input === '1' || normalized.includes('today')) {
          targetDate = today;
        } else if (input === 'rdate_2' || input === 'date_2' || input === '2' || normalized.includes('tmrw') || normalized.includes('tomorrow')) {
          targetDate = today.plus({ days: 1 });
        } else if (input === 'rdate_3' || input === 'date_3' || input === '3') {
          targetDate = today.plus({ days: 2 });
        } else {
          const parsed = DateTime.fromISO(input, { zone: tz });
          if (parsed.isValid) targetDate = parsed;
        }

        const dateStr = targetDate.toISODate()!;
        const availability = await this.availabilityService.getAvailableSlots(
          salonId,
          conversation.selectedServiceId || salon.services[0].id,
          dateStr,
          conversation.selectedStaffId || undefined,
          conversation.activeAppointmentId || undefined,
        );


        if (availability.availableSlots.length === 0) {
          const reply = `⚠️ No available slots on *${targetDate.toFormat('dd LLL, EEEE')}*. Please choose another date:`;
          await this.sendMetaMessage(
            cleanNumber,
            {
              bodyText: reply,
              interactiveType: 'button',
              buttons: [
                { id: 'rdate_1', title: 'Today' },
                { id: 'rdate_2', title: 'Tomorrow' },
              ],
            },
            phoneNumberId,
          );
          return { replyMessage: reply, state: ConversationState.SELECT_RESCHEDULE_DATE };
        }

        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            selectedDate: new Date(`${dateStr}T00:00:00Z`),
            state: ConversationState.SELECT_RESCHEDULE_TIME,
          },
        });

        const allSlots = availability.availableSlots;
        const morningSlots = allSlots.filter((s) => parseInt(s.startTime.split(':')[0], 10) < 12);
        const afternoonSlots = allSlots.filter((s) => {
          const h = parseInt(s.startTime.split(':')[0], 10);
          return h >= 12 && h < 16;
        });
        const eveningSlots = allSlots.filter((s) => parseInt(s.startTime.split(':')[0], 10) >= 16);

        if (allSlots.length <= 10) {
          const listRows: InteractiveListRow[] = allSlots.map((s) => ({
            id: `rslot_${s.startTime}`,
            title: `⏰ ${this.formatTime12h(s.startTime)}`,
            description: `Available slot`,
          }));

          const reply = `📅 Date: *${targetDate.toFormat('dd LLL, EEEE')}*\n\nChoose your new appointment time:`;
          await this.sendMetaMessage(
            cleanNumber,
            {
              headerText: 'Reschedule Slot',
              bodyText: reply,
              buttonText: '⏰ Choose New Time',
              interactiveType: 'list',
              listRows,
            },
            phoneNumberId,
          );

          return { replyMessage: reply, state: ConversationState.SELECT_RESCHEDULE_TIME };
        } else {
          const periodButtons = [];
          if (morningSlots.length > 0) periodButtons.push({ id: 'rperiod_morning', title: `🌅 Morning (${morningSlots.length})` });
          if (afternoonSlots.length > 0) periodButtons.push({ id: 'rperiod_afternoon', title: `☀️ Afternoon (${afternoonSlots.length})` });
          if (eveningSlots.length > 0) periodButtons.push({ id: 'rperiod_evening', title: `🌙 Evening (${eveningSlots.length})` });

          const reply = `📅 Date: *${targetDate.toFormat('dd LLL, EEEE')}*\n⏰ Salon Hours: *${this.formatTime12h(allSlots[0].startTime)} – ${this.formatTime12h(allSlots[allSlots.length - 1].endTime)}* (${allSlots.length} slots all day)\n\nChoose your new appointment time period below, or type any time directly (e.g. *5:30 PM*):`;
          await this.sendMetaMessage(
            cleanNumber,
            {
              bodyText: reply,
              interactiveType: 'button',
              buttons: periodButtons.slice(0, 3),
            },
            phoneNumberId,
          );

          return { replyMessage: reply, state: ConversationState.SELECT_RESCHEDULE_TIME };
        }
      }

      case ConversationState.SELECT_RESCHEDULE_TIME: {
        const tz = salon.timezone || 'Asia/Kolkata';
        const dateStr = conversation.selectedDate
          ? DateTime.fromJSDate(conversation.selectedDate).toUTC().toISODate()!
          : DateTime.now().setZone(tz).toISODate()!;

        if (!conversation.activeAppointmentId) {
          const reply = `Session expired. Type Hi to start again.`;
          await this.sendMetaMessage(cleanNumber, { textBody: reply }, phoneNumberId);
          return { replyMessage: reply, state: ConversationState.START };
        }

        const availability = await this.availabilityService.getAvailableSlots(
          salonId,
          conversation.selectedServiceId || salon.services[0].id,
          dateStr,
          conversation.selectedStaffId || undefined,
          conversation.activeAppointmentId || undefined,
        );

        const cleanInput = input.trim().toLowerCase();
        const allSlots = availability.availableSlots;
        const morningSlots = allSlots.filter((s) => parseInt(s.startTime.split(':')[0], 10) < 12);
        const afternoonSlots = allSlots.filter((s) => {
          const h = parseInt(s.startTime.split(':')[0], 10);
          return h >= 12 && h < 16;
        });
        const eveningSlots = allSlots.filter((s) => parseInt(s.startTime.split(':')[0], 10) >= 16);

        // Period switcher in reschedule flow
        if (cleanInput.startsWith('rperiod_') || cleanInput.startsWith('period_') || ['morning', 'afternoon', 'evening'].includes(cleanInput)) {
          let chosenPeriod: 'morning' | 'afternoon' | 'evening' = 'morning';
          if (cleanInput.includes('afternoon')) chosenPeriod = 'afternoon';
          else if (cleanInput.includes('evening')) chosenPeriod = 'evening';

          let slotsForPeriod = chosenPeriod === 'morning' ? morningSlots : chosenPeriod === 'afternoon' ? afternoonSlots : eveningSlots;
          if (slotsForPeriod.length === 0) slotsForPeriod = allSlots.slice(0, 10);

          const periodTitle = chosenPeriod === 'morning' ? '🌅 Morning' : chosenPeriod === 'afternoon' ? '☀️ Afternoon' : '🌙 Evening';
          const listRows: InteractiveListRow[] = slotsForPeriod.slice(0, 9).map((s) => ({
            id: `rslot_${s.startTime}`,
            title: `⏰ ${this.formatTime12h(s.startTime)}`,
            description: `Available slot`,
          }));

          if (chosenPeriod === 'morning' && afternoonSlots.length > 0) {
            listRows.push({ id: 'rperiod_afternoon', title: '☀️ View Afternoon Slots →', description: '12:00 PM – 4:00 PM' });
          } else if (chosenPeriod === 'afternoon' && eveningSlots.length > 0) {
            listRows.push({ id: 'rperiod_evening', title: '🌙 View Evening Slots →', description: '4:00 PM – Close' });
          } else if (chosenPeriod === 'evening' && morningSlots.length > 0) {
            listRows.push({ id: 'rperiod_morning', title: '🌅 View Morning Slots →', description: '9:00 AM – 12:00 PM' });
          }

          const periodReply = `📅 *${DateTime.fromISO(dateStr).toFormat('dd LLL, EEEE')}* — ${periodTitle} Slots:\n\nSelect your new time slot below (or reply with any time, e.g. *5:30 PM*):`;
          await this.sendMetaMessage(
            cleanNumber,
            {
              headerText: `${periodTitle} Slots`,
              bodyText: periodReply,
              buttonText: `⏰ Choose ${chosenPeriod.charAt(0).toUpperCase() + chosenPeriod.slice(1)} Time`,
              interactiveType: 'list',
              listRows,
            },
            phoneNumberId,
          );
          return { replyMessage: periodReply, state: ConversationState.SELECT_RESCHEDULE_TIME };
        }

        const selectedSlot = this.parseTimeSlot(input, availability.availableSlots);
        if (!selectedSlot) {
          if (allSlots.length <= 10) {
            const listRows: InteractiveListRow[] = allSlots.map((s) => ({
              id: `rslot_${s.startTime}`,
              title: `⏰ ${this.formatTime12h(s.startTime)}`,
              description: `Available slot`,
            }));
            const reply = `❌ Please select a new time slot from the list:`;
            await this.sendMetaMessage(
              cleanNumber,
              {
                headerText: 'Reschedule Slot',
                bodyText: reply,
                buttonText: '⏰ Choose New Time',
                interactiveType: 'list',
                listRows,
              },
              phoneNumberId,
            );
          } else {
            const periodButtons = [];
            if (morningSlots.length > 0) periodButtons.push({ id: 'rperiod_morning', title: `🌅 Morning (${morningSlots.length})` });
            if (afternoonSlots.length > 0) periodButtons.push({ id: 'rperiod_afternoon', title: `☀️ Afternoon (${afternoonSlots.length})` });
            if (eveningSlots.length > 0) periodButtons.push({ id: 'rperiod_evening', title: `🌙 Evening (${eveningSlots.length})` });

            await this.sendMetaMessage(
              cleanNumber,
              {
                bodyText: `❌ That time is not available. Please choose a time window below, or type an exact time (e.g. *2:30 PM* or *6 PM*):`,
                interactiveType: 'button',
                buttons: periodButtons.slice(0, 3),
              },
              phoneNumberId,
            );
          }
          return { replyMessage: 'Please select an available time slot', state: ConversationState.SELECT_RESCHEDULE_TIME };
        }

        try {
          const newAppt = await this.appointmentsService.rescheduleAppointment(
            salonId,
            conversation.activeAppointmentId,
            {
              newDate: dateStr,
              newStartTime: selectedSlot.startTime,
              staffId: conversation.selectedStaffId || undefined,
            },
          );

          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: {
              state: ConversationState.START,
              activeAppointmentId: null,
            },
          });

          const timeFormatted = DateTime.fromJSDate(newAppt.startTime, { zone: tz }).toFormat('hh:mm a');
          const dateFormatted = DateTime.fromJSDate(newAppt.startTime, { zone: tz }).toFormat('dd LLL, EEE');

          const reply = `✅ *Appointment Rescheduled Successfully!*\n\n• *New Date:* ${dateFormatted}\n• *New Time:* ${timeFormatted}\n• *Service:* ${newAppt.service.name}\n• *Specialist:* ${newAppt.staff.name}\n• *New Ref:* #${newAppt.appointmentNumber}\n\nYour previous chair reservation was released. See you soon!`;
          await this.sendMetaMessage(
            cleanNumber,
            {
              bodyText: reply,
              interactiveType: 'button',
              buttons: [{ id: 'btn_start', title: '🏠 Main Menu' }],
            },
            phoneNumberId,
          );

          return { replyMessage: reply, state: ConversationState.START };
        } catch (error: any) {
          this.logger.error('Failed to reschedule:', error);
          const reply = `⚠️ Could not reschedule to that slot: ${error.message || 'Please pick another time'}.`;
          await this.sendMetaMessage(cleanNumber, { textBody: reply }, phoneNumberId);
          return { replyMessage: reply, state: ConversationState.ACTIVE_HUB };
        }
      }

      case ConversationState.CONFIRM_CANCEL: {
        if (input === 'btn_cancel_yes' || normalized.includes('yes') || normalized === '1') {
          if (conversation.activeAppointmentId) {
            await this.appointmentsService.updateStatus(
              salonId,
              conversation.activeAppointmentId,
              {
                status: AppointmentStatus.CANCELLED,
                reason: 'Cancelled by customer via WhatsApp Active Hub',
              },
            );
          }

          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: {
              state: ConversationState.START,
              activeAppointmentId: null,
            },
          });

          const reply = `✅ *Appointment Cancelled*\n\nYour reservation has been cancelled and your slot released. We hope to see you again soon!`;
          await this.sendMetaMessage(
            cleanNumber,
            {
              bodyText: reply,
              interactiveType: 'button',
              buttons: [
                { id: 'btn_book', title: '📅 Book Slot' },
                { id: 'btn_services', title: '✂️ Services Menu' },
              ],
            },
            phoneNumberId,
          );

          return { replyMessage: reply, state: ConversationState.START };
        } else {
          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: { state: ConversationState.START },
          });

          const reply = `👍 *Your appointment remains confirmed!* See you at your scheduled time.`;
          await this.sendMetaMessage(
            cleanNumber,
            {
              bodyText: reply,
              interactiveType: 'button',
              buttons: [{ id: 'btn_start', title: '🏠 Main Menu' }],
            },
            phoneNumberId,
          );

          return { replyMessage: reply, state: ConversationState.START };
        }
      }
      case ConversationState.START: {
        if (input === '1' || input === 'btn_book' || normalized.includes('book')) {
          // If only 1 service in the salon -> auto select and advance!
          if (salon.services.length === 1) {
            return this.handleServiceChosen(conversation.id, cleanNumber, salon, salon.services[0], phoneNumberId);
          }

          // Multiple services -> show list picker
          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: { state: ConversationState.SELECT_SERVICE },
          });

          const listRows: InteractiveListRow[] = salon.services.map((s) => ({
            id: `svc_${s.id}`,
            title: s.name,
            description: `₹${s.price} • ${s.durationMinutes} mins`,
          }));

          const reply = `✂️ *Select a Service*\nPlease choose a service from the list:`;
          await this.sendMetaMessage(
            cleanNumber,
            {
              headerText: `${salon.name} Menu`,
              bodyText: reply,
              footerText: 'Tap below to select',
              buttonText: '✂️ Select Service',
              interactiveType: 'list',
              listRows,
            },
            phoneNumberId,
          );

          return { replyMessage: reply, state: ConversationState.SELECT_SERVICE, metadata: { services: salon.services } };
        } else if (input === '2' || input === 'btn_services' || normalized.includes('service') || normalized.includes('menu')) {
          if (salon.services.length === 1) {
            const singleSvc = salon.services[0];
            const reply = `✨ *Services Menu:*\n\n• *${singleSvc.name}*: ₹${singleSvc.price} (${singleSvc.durationMinutes} mins)${singleSvc.description ? `\n  _${singleSvc.description}_` : ''}`;
            await this.sendMetaMessage(
              cleanNumber,
              {
                bodyText: reply,
                interactiveType: 'button',
                buttons: [{ id: `svc_${singleSvc.id}`, title: `📅 Book (₹${singleSvc.price})` }],
              },
              phoneNumberId,
            );
            return { replyMessage: reply, state: ConversationState.START };
          } else {
            const listRows: InteractiveListRow[] = salon.services.map((s) => ({
              id: `svc_${s.id}`,
              title: s.name,
              description: `₹${s.price} • ${s.durationMinutes} mins`,
            }));
            const reply = `✨ *${salon.name} Services Menu*\n\nSelect a service below to book directly:`;
            await this.sendMetaMessage(
              cleanNumber,
              {
                headerText: 'Services Menu',
                bodyText: reply,
                footerText: 'Tap below to book',
                buttonText: '✂️ Choose Service to Book',
                interactiveType: 'list',
                listRows,
              },
              phoneNumberId,
            );
            return { replyMessage: reply, state: ConversationState.SELECT_SERVICE, metadata: { services: salon.services } };
          }
        } else if (input === '3' || input === 'btn_info' || normalized.includes('info')) {
          const reply = `📍 *${salon.name}*\n\nAddress: ${salon.address || 'India'}, ${salon.city || ''}\nPhone: ${salon.phone}\nTimings: 09:00 AM – 09:00 PM`;
          await this.sendMetaMessage(
            cleanNumber,
            {
              bodyText: reply,
              interactiveType: 'button',
              buttons: [{ id: 'btn_book', title: '📅 Book Slot' }],
            },
            phoneNumberId,
          );
          return { replyMessage: reply, state: ConversationState.START };
        } else {
          await this.sendMetaMessage(
            cleanNumber,
            {
              bodyText: `Welcome to ${salon.name}! Tap a button below to get started:`,
              interactiveType: 'button',
              buttons: [{ id: 'btn_book', title: '📅 Book Slot' }, { id: 'btn_services', title: '✂️ Services' }],
            },
            phoneNumberId,
          );
          return { replyMessage: 'Please tap Book Slot', state: ConversationState.START };
        }
      }

      case ConversationState.SELECT_SERVICE: {
        let selectedService = null;
        if (input.startsWith('svc_')) {
          const svcId = input.replace('svc_', '');
          selectedService = salon.services.find((s) => s.id === svcId);
        } else {
          const num = parseInt(input, 10);
          if (!isNaN(num) && num >= 1 && num <= salon.services.length) {
            selectedService = salon.services[num - 1];
          } else {
            selectedService = salon.services.find((s) => s.name.toLowerCase().includes(normalized));
          }
        }

        if (!selectedService) {
          const listRows: InteractiveListRow[] = salon.services.map((s) => ({
            id: `svc_${s.id}`,
            title: s.name,
            description: `₹${s.price} • ${s.durationMinutes} mins`,
          }));
          await this.sendMetaMessage(
            cleanNumber,
            {
              bodyText: `❌ Please select a service from the list below:`,
              buttonText: '✂️ View Services',
              interactiveType: 'list',
              listRows,
            },
            phoneNumberId,
          );
          return { replyMessage: 'Please select a service', state: ConversationState.SELECT_SERVICE };
        }

        return this.handleServiceChosen(conversation.id, cleanNumber, salon, selectedService, phoneNumberId);
      }

      case ConversationState.SELECT_STAFF: {
        const selectedServiceId = conversation.selectedServiceId!;
        const qualifiedStaff = salon.staff.filter((st) =>
          st.services.some((svc) => svc.serviceId === selectedServiceId),
        );
        const selectedService = salon.services.find((s) => s.id === selectedServiceId) || { name: 'Service', price: 0 };

        let selectedStaffId: string | null = null;
        let staffName = 'Any Specialist';

        if (input === 'staff_any' || input === '1' || normalized.includes('any')) {
          selectedStaffId = null;
        } else if (input.startsWith('staff_')) {
          const stId = input.replace('staff_', '');
          const staff = qualifiedStaff.find((st) => st.id === stId);
          if (staff) {
            selectedStaffId = staff.id;
            staffName = staff.name;
          }
        } else {
          const staff = qualifiedStaff.find((st) => st.name.toLowerCase().includes(normalized));
          if (staff) {
            selectedStaffId = staff.id;
            staffName = staff.name;
          }
        }

        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            selectedStaffId,
            state: ConversationState.SELECT_DATE,
          },
        });

        return this.promptDateSelection(
          conversation.id,
          cleanNumber,
          salon,
          selectedService,
          staffName,
          phoneNumberId,
        );
      }

      case ConversationState.SELECT_DATE: {
        const tz = salon.timezone || 'Asia/Kolkata';
        const today = DateTime.now().setZone(tz);
        let targetDate = today;

        if (input === 'date_1' || input === '1' || normalized.includes('today')) {
          targetDate = today;
        } else if (input === 'date_2' || input === '2' || normalized.includes('tmrw') || normalized.includes('tomorrow')) {
          targetDate = today.plus({ days: 1 });
        } else if (input === 'date_3' || input === '3') {
          targetDate = today.plus({ days: 2 });
        } else {
          const parsed = DateTime.fromISO(input, { zone: tz });
          if (parsed.isValid) {
            targetDate = parsed;
          }
        }

        const dateStr = targetDate.toISODate()!;

        // Real-Time Slot Engine
        const availability = await this.availabilityService.getAvailableSlots(
          salonId,
          conversation.selectedServiceId!,
          dateStr,
          conversation.selectedStaffId || undefined,
        );

        if (availability.availableSlots.length === 0) {
          const reply = `⚠️ Sorry, no slots available on *${targetDate.toFormat('dd LLL, EEEE')}*.`;
          await this.sendMetaMessage(
            cleanNumber,
            {
              bodyText: reply,
              interactiveType: 'button',
              buttons: [
                { id: 'date_1', title: 'Today' },
                { id: 'date_2', title: 'Tomorrow' },
              ],
            },
            phoneNumberId,
          );
          return { replyMessage: reply, state: ConversationState.SELECT_DATE };
        }

        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            selectedDate: new Date(`${dateStr}T00:00:00Z`),
            state: ConversationState.SELECT_TIME,
          },
        });

        // NATIVE TIME SLOT RADIO PICKER (Whole Day Support)
        const allSlots = availability.availableSlots;
        const morningSlots = allSlots.filter((s) => parseInt(s.startTime.split(':')[0], 10) < 12);
        const afternoonSlots = allSlots.filter((s) => {
          const h = parseInt(s.startTime.split(':')[0], 10);
          return h >= 12 && h < 16;
        });
        const eveningSlots = allSlots.filter((s) => parseInt(s.startTime.split(':')[0], 10) >= 16);

        if (allSlots.length <= 10) {
          const listRows: InteractiveListRow[] = allSlots.map((s) => ({
            id: `slot_${s.startTime}`,
            title: `⏰ ${this.formatTime12h(s.startTime)}`,
            description: `Available with ${s.availableStaffCount} stylist(s)`,
          }));

          const reply = `📅 Date: *${targetDate.toFormat('dd LLL, EEEE')}*\n\nChoose an appointment time slot:`;
          await this.sendMetaMessage(
            cleanNumber,
            {
              headerText: 'Available Times',
              bodyText: reply,
              buttonText: '⏰ Choose Time Slot',
              interactiveType: 'list',
              listRows,
            },
            phoneNumberId,
          );

          return { replyMessage: reply, state: ConversationState.SELECT_TIME, metadata: { slots: allSlots } };
        } else {
          const periodButtons = [];
          if (morningSlots.length > 0) periodButtons.push({ id: 'period_morning', title: `🌅 Morning (${morningSlots.length})` });
          if (afternoonSlots.length > 0) periodButtons.push({ id: 'period_afternoon', title: `☀️ Afternoon (${afternoonSlots.length})` });
          if (eveningSlots.length > 0) periodButtons.push({ id: 'period_evening', title: `🌙 Evening (${eveningSlots.length})` });

          const reply = `📅 Date: *${targetDate.toFormat('dd LLL, EEEE')}*\n⏰ Salon Hours: *${this.formatTime12h(allSlots[0].startTime)} – ${this.formatTime12h(allSlots[allSlots.length - 1].endTime)}* (${allSlots.length} slots all day)\n\nChoose an appointment time slot period below, or type any time directly (e.g. *2:30 PM* or *6 PM*):`;
          await this.sendMetaMessage(
            cleanNumber,
            {
              bodyText: reply,
              interactiveType: 'button',
              buttons: periodButtons.slice(0, 3),
            },
            phoneNumberId,
          );

          return { replyMessage: reply, state: ConversationState.SELECT_TIME, metadata: { slots: allSlots } };
        }
      }

      case ConversationState.SELECT_TIME: {
        const tz = salon.timezone || 'Asia/Kolkata';
        const targetDate = conversation.selectedDate
          ? DateTime.fromJSDate(conversation.selectedDate).toUTC().toISODate()!
          : DateTime.now().setZone(tz).toISODate()!;

        const availability = await this.availabilityService.getAvailableSlots(
          salonId,
          conversation.selectedServiceId!,
          targetDate,
          conversation.selectedStaffId || undefined,
        );

        if (availability.availableSlots.length === 0) {
          const reply = `⚠️ Sorry, no slots are currently available on *${targetDate}*. Please choose another date:`;
          await this.sendMetaMessage(
            cleanNumber,
            {
              bodyText: reply,
              interactiveType: 'button',
              buttons: [
                { id: 'date_1', title: 'Today' },
                { id: 'date_2', title: 'Tomorrow' },
              ],
            },
            phoneNumberId,
          );
          return { replyMessage: reply, state: ConversationState.SELECT_DATE };
        }

        const cleanInput = input.trim().toLowerCase();
        const allSlots = availability.availableSlots;
        const morningSlots = allSlots.filter((s) => parseInt(s.startTime.split(':')[0], 10) < 12);
        const afternoonSlots = allSlots.filter((s) => {
          const h = parseInt(s.startTime.split(':')[0], 10);
          return h >= 12 && h < 16;
        });
        const eveningSlots = allSlots.filter((s) => parseInt(s.startTime.split(':')[0], 10) >= 16);

        // Check if user clicked or typed a period filter
        if (cleanInput.startsWith('period_') || ['morning', 'afternoon', 'evening'].includes(cleanInput)) {
          let chosenPeriod: 'morning' | 'afternoon' | 'evening' = 'morning';
          if (cleanInput.includes('afternoon')) chosenPeriod = 'afternoon';
          else if (cleanInput.includes('evening')) chosenPeriod = 'evening';

          let slotsForPeriod = chosenPeriod === 'morning' ? morningSlots : chosenPeriod === 'afternoon' ? afternoonSlots : eveningSlots;
          if (slotsForPeriod.length === 0) slotsForPeriod = allSlots.slice(0, 10);

          const periodTitle = chosenPeriod === 'morning' ? '🌅 Morning' : chosenPeriod === 'afternoon' ? '☀️ Afternoon' : '🌙 Evening';
          const listRows: InteractiveListRow[] = slotsForPeriod.slice(0, 9).map((s) => ({
            id: `slot_${s.startTime}`,
            title: `⏰ ${this.formatTime12h(s.startTime)}`,
            description: `Available with ${s.availableStaffCount} stylist(s)`,
          }));

          // Add quick-switch row if other periods exist
          if (chosenPeriod === 'morning' && afternoonSlots.length > 0) {
            listRows.push({ id: 'period_afternoon', title: '☀️ View Afternoon Slots →', description: '12:00 PM – 4:00 PM' });
          } else if (chosenPeriod === 'afternoon' && eveningSlots.length > 0) {
            listRows.push({ id: 'period_evening', title: '🌙 View Evening Slots →', description: '4:00 PM – Close' });
          } else if (chosenPeriod === 'evening' && morningSlots.length > 0) {
            listRows.push({ id: 'period_morning', title: '🌅 View Morning Slots →', description: '9:00 AM – 12:00 PM' });
          }

          const periodReply = `📅 *${DateTime.fromISO(targetDate).toFormat('dd LLL, EEEE')}* — ${periodTitle} Slots:\n\nSelect your preferred time slot below (or reply with any time, e.g. *5:30 PM*):`;
          await this.sendMetaMessage(
            cleanNumber,
            {
              headerText: `${periodTitle} Slots`,
              bodyText: periodReply,
              buttonText: `⏰ Choose ${chosenPeriod.charAt(0).toUpperCase() + chosenPeriod.slice(1)} Time`,
              interactiveType: 'list',
              listRows,
            },
            phoneNumberId,
          );
          return { replyMessage: periodReply, state: ConversationState.SELECT_TIME, metadata: { slots: slotsForPeriod } };
        }

        const selectedSlot = this.parseTimeSlot(input, availability.availableSlots);

        if (!selectedSlot) {
          if (allSlots.length <= 10) {
            const listRows = allSlots.map((s) => ({
              id: `slot_${s.startTime}`,
              title: `⏰ ${this.formatTime12h(s.startTime)}`,
              description: `Available with ${s.availableStaffCount} stylist(s)`,
            }));
            await this.sendMetaMessage(
              cleanNumber,
              {
                bodyText: '❌ Please select an available time slot from the list:',
                buttonText: '⏰ Select Slot',
                interactiveType: 'list',
                listRows,
              },
              phoneNumberId,
            );
          } else {
            const periodButtons = [];
            if (morningSlots.length > 0) periodButtons.push({ id: 'period_morning', title: `🌅 Morning (${morningSlots.length})` });
            if (afternoonSlots.length > 0) periodButtons.push({ id: 'period_afternoon', title: `☀️ Afternoon (${afternoonSlots.length})` });
            if (eveningSlots.length > 0) periodButtons.push({ id: 'period_evening', title: `🌙 Evening (${eveningSlots.length})` });

            await this.sendMetaMessage(
              cleanNumber,
              {
                bodyText: `❌ That time is not available. Please choose a time window below, or type an exact time (e.g. *2:30 PM* or *6 PM*):`,
                interactiveType: 'button',
                buttons: periodButtons.slice(0, 3),
              },
              phoneNumberId,
            );
          }
          return { replyMessage: 'Please select an available time slot', state: ConversationState.SELECT_TIME };
        }

        const existingCustomer = await this.prisma.customer.findUnique({
          where: {
            salonId_phone: {
              salonId,
              phone: cleanNumber,
            },
          },
        });

        const selectedService = salon.services.find((s) => s.id === conversation.selectedServiceId);
        const selectedStaff = salon.staff.find((st) => st.id === conversation.selectedStaffId);

        if (existingCustomer && existingCustomer.name) {
          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: {
              selectedStartTime: new Date(selectedSlot.isoStartTime),
              customerName: existingCustomer.name,
              state: ConversationState.CONFIRMATION,
            },
          });

          const reply = `📋 *Booking Summary:*\n\n• Salon: *${salon.name}*\n• Service: *${selectedService?.name}* (₹${selectedService?.price})\n• Specialist: *${selectedStaff ? selectedStaff.name : 'Any Specialist'}*\n• Date: *${targetDate}*\n• Time: *${this.formatTime12h(selectedSlot.startTime)}*\n• Client: *${existingCustomer.name}*`;
          await this.sendMetaMessage(
            cleanNumber,
            {
              bodyText: reply,
              interactiveType: 'button',
              buttons: [
                { id: 'btn_confirm_yes', title: '✅ Confirm Booking' },
                { id: 'btn_menu', title: '❌ Cancel' },
              ],
            },
            phoneNumberId,
          );
          return { replyMessage: reply, state: ConversationState.CONFIRMATION };
        } else {
          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: {
              selectedStartTime: new Date(selectedSlot.isoStartTime),
              state: ConversationState.COLLECT_NAME,
            },
          });

          const reply = `⏰ Selected Time: *${this.formatTime12h(selectedSlot.startTime)}*\n\nPlease reply with your *Full Name* to complete the reservation:`;
          await this.sendMetaMessage(cleanNumber, { textBody: reply }, phoneNumberId);
          return { replyMessage: reply, state: ConversationState.COLLECT_NAME };
        }
      }

      case ConversationState.COLLECT_NAME: {
        const customerName = input.trim();
        if (customerName.length < 2) {
          const reply = `Please reply with your valid Full Name.`;
          await this.sendMetaMessage(cleanNumber, { textBody: reply }, phoneNumberId);
          return { replyMessage: reply, state: ConversationState.COLLECT_NAME };
        }

        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            customerName,
            state: ConversationState.CONFIRMATION,
          },
        });

        const tz = salon.timezone || 'Asia/Kolkata';
        const dateStr = conversation.selectedDate
          ? DateTime.fromJSDate(conversation.selectedDate).toUTC().toISODate()!
          : DateTime.now().setZone(tz).toISODate()!;
        const timeStr = DateTime.fromJSDate(conversation.selectedStartTime!, { zone: tz }).toFormat('hh:mm a');
        const selectedService = salon.services.find((s) => s.id === conversation.selectedServiceId);
        const selectedStaff = salon.staff.find((st) => st.id === conversation.selectedStaffId);

        const reply = `📋 *Please Confirm Your Appointment:*\n\n• Salon: *${salon.name}*\n• Service: *${selectedService?.name}* (₹${selectedService?.price})\n• Specialist: *${selectedStaff ? selectedStaff.name : 'Any Specialist'}*\n• Date: *${dateStr}*\n• Time: *${timeStr}*\n• Client: *${customerName}*`;
        await this.sendMetaMessage(
          cleanNumber,
          {
            bodyText: reply,
            interactiveType: 'button',
            buttons: [
              { id: 'btn_confirm_yes', title: '✅ Confirm Booking' },
              { id: 'btn_menu', title: '❌ Cancel' },
            ],
          },
          phoneNumberId,
        );
        return { replyMessage: reply, state: ConversationState.CONFIRMATION };
      }

      case ConversationState.CONFIRMATION: {
        if (
          input === 'btn_confirm_yes' ||
          normalized.includes('confirm') ||
          normalized === 'yes' ||
          normalized === '1' ||
          normalized === 'ok'
        ) {
          const tz = salon.timezone || 'Asia/Kolkata';
          const dateStr = conversation.selectedDate
            ? DateTime.fromJSDate(conversation.selectedDate).toUTC().toISODate()!
            : DateTime.now().setZone(tz).toISODate()!;
          const timeSlotStr = DateTime.fromJSDate(conversation.selectedStartTime!, { zone: tz }).toFormat('HH:mm');
          const time12hStr = this.formatTime12h(timeSlotStr);

          try {
            const appointment = await this.appointmentsService.createAppointment(salonId, {
              serviceId: conversation.selectedServiceId!,
              staffId: conversation.selectedStaffId || undefined,
              date: dateStr,
              startTime: timeSlotStr,
              customerName: conversation.customerName || 'WhatsApp Client',
              customerPhone: cleanNumber,
              source: BookingSource.WHATSAPP,
              notes: 'Booked via WhatsApp Cloud Bot',
            });

            await this.prisma.conversation.update({
              where: { id: conversation.id },
              data: { state: ConversationState.COMPLETED, activeAppointmentId: appointment.id },
            });

            const reply = `🎉 *APPOINTMENT CONFIRMED!*\n\n• Booking ID: *${appointment.appointmentNumber}*\n• Service: *${appointment.service.name}*\n• Specialist: *${appointment.staff.name}*\n• Date: *${dateStr}*\n• Time: *${time12hStr}*\n• Amount: *₹${appointment.price}*\n\n📍 *${salon.name}*\n${salon.address || ''}\n\nWe look forward to seeing you!`;
            await this.sendMetaMessage(
              cleanNumber,
              {
                bodyText: reply,
                interactiveType: 'button',
                buttons: [{ id: 'btn_menu', title: '🏠 Main Menu' }],
              },
              phoneNumberId,
            );
            return { replyMessage: reply, state: ConversationState.COMPLETED, metadata: { appointment } };
          } catch (err) {
            this.logger.error('WhatsApp booking confirmation error:', err);
            const reply = `⚠️ ${err.message || 'Sorry, this slot was just taken.'}`;
            await this.sendMetaMessage(
              cleanNumber,
              {
                bodyText: reply,
                interactiveType: 'button',
                buttons: [{ id: 'btn_book', title: '📅 Choose Another' }],
              },
              phoneNumberId,
            );
            return { replyMessage: reply, state: ConversationState.START };
          }
        } else {
          const reply = `Reply *CONFIRM* to finalize your booking, or tap Cancel:`;
          await this.sendMetaMessage(
            cleanNumber,
            {
              bodyText: reply,
              interactiveType: 'button',
              buttons: [
                { id: 'btn_confirm_yes', title: '✅ Confirm' },
                { id: 'btn_menu', title: '❌ Cancel' },
              ],
            },
            phoneNumberId,
          );
          return { replyMessage: reply, state: ConversationState.CONFIRMATION };
        }
      }

      default: {
        const reply = `👋 Welcome to ${salon.name}!`;
        await this.sendMetaMessage(
          cleanNumber,
          {
            bodyText: reply,
            interactiveType: 'button',
            buttons: [{ id: 'btn_book', title: '📅 Book Slot' }],
          },
          phoneNumberId,
        );
        return { replyMessage: reply, state: ConversationState.START };
      }
    }
  }

  // -------------------------------------------------------------
  // REAL-WORLD META EMBEDDED SIGNUP & MANAGEMENT
  // -------------------------------------------------------------
  async getSalonWhatsAppStatus(salonId: string) {
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      include: { whatsappAccount: true },
    });

    if (!salon) throw new NotFoundException('Salon not found.');

    const isConnected = !!salon.whatsappAccount && salon.whatsappAccount.isActive;
    const cleanPhone = salon.phone ? salon.phone.replace(/[^\d]/g, '') : '';
    const waChatUrl = isConnected && cleanPhone
      ? `https://wa.me/${cleanPhone}`
      : `https://wa.me/15556749314?text=BOOK%20${salon.slug}`;

    return {
      isConnected,
      salonId: salon.id,
      salonName: salon.name,
      salonSlug: salon.slug,
      phone: salon.phone,
      phoneNumberId: salon.whatsappAccount?.phoneNumberId || null,
      wabaId: salon.whatsappAccount?.wabaId || null,
      waChatUrl,
      metaAppId: process.env.META_APP_ID || '4157743837690470',
    };
  }

  async connectSalonWhatsApp(
    salonId: string,
    data: {
      phoneNumberId: string;
      wabaId?: string;
      displayPhoneNumber?: string;
      code?: string;
    },
  ) {
    const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
    if (!salon) throw new NotFoundException('Salon not found.');

    const accessToken =
      this.configService.get<string>('whatsapp.accessToken') ||
      process.env.WHATSAPP_ACCESS_TOKEN;

    // 1. If WABA is provided, auto-subscribe WABA to platform Webhook
    if (data.wabaId && accessToken) {
      try {
        const subRes = await fetch(
          `https://graph.facebook.com/v20.0/${data.wabaId}/subscribed_apps`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          },
        );
        const subData = await subRes.json();
        this.logger.log(`Subscribed WABA ${data.wabaId} to App webhooks: ${JSON.stringify(subData)}`);
      } catch (err) {
        this.logger.warn(`Could not auto-subscribe WABA ${data.wabaId}: ${err}`);
      }
    }

    // 2. Query Meta Graph API for verified display phone number
    let verifiedDisplayNumber = data.displayPhoneNumber;
    if (data.phoneNumberId && accessToken) {
      try {
        const phoneRes = await fetch(
          `https://graph.facebook.com/v20.0/${data.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
          },
        );
        if (phoneRes.ok) {
          const phoneData = await phoneRes.json();
          if (phoneData.display_phone_number) {
            verifiedDisplayNumber = phoneData.display_phone_number;
            this.logger.log(`Fetched Meta verified phone: ${verifiedDisplayNumber}`);
          }
        }
      } catch (err) {
        this.logger.warn(`Could not fetch Meta phone details: ${err}`);
      }
    }

    // 3. Upsert WhatsApp Account
    const account = await this.prisma.whatsAppAccount.upsert({
      where: { salonId },
      update: {
        phoneNumberId: data.phoneNumberId,
        wabaId: data.wabaId || undefined,
        accessTokenEncrypted: 'system_managed',
        webhookVerifyToken: 'salon_webhook_verify_token_mvp',
        isActive: true,
      },
      create: {
        salonId,
        phoneNumberId: data.phoneNumberId,
        wabaId: data.wabaId || null,
        accessTokenEncrypted: 'system_managed',
        webhookVerifyToken: 'salon_webhook_verify_token_mvp',
        isActive: true,
      },
    });

    if (verifiedDisplayNumber) {
      await this.prisma.salon.update({
        where: { id: salonId },
        data: { phone: verifiedDisplayNumber },
      });
    }

    return this.getSalonWhatsAppStatus(salonId);
  }

  async disconnectSalonWhatsApp(salonId: string) {
    const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
    if (!salon) throw new NotFoundException('Salon not found.');

    await this.prisma.whatsAppAccount.deleteMany({ where: { salonId } });
    return this.getSalonWhatsAppStatus(salonId);
  }
}

