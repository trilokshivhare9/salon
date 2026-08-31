import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../database/prisma.service';
import { AvailabilityService } from '../availability/availability.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { ConversationState, BookingSource, MessageDirection } from '@prisma/client';
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

    const input = (interactiveId || messageText).trim();
    const normalized = input.toLowerCase();

    this.logger.log(
      `[WhatsAppService] 💬 Processing message for ${cleanNumber} (Salon: "${salon.name}") | State: ${conversation.state} | Input: "${input}"`,
    );

    // Reset / Menu commands
    if (['hi', 'hello', 'hey', 'start', 'menu', 'reset', 'cancel', 'btn_start', 'btn_menu'].includes(normalized)) {
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          state: ConversationState.START,
          selectedServiceId: null,
          selectedStaffId: null,
          selectedDate: null,
          selectedStartTime: null,
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

    // -------------------------------------------------------------
    // STATE MACHINE
    // -------------------------------------------------------------
    switch (conversation.state) {
      case ConversationState.START: {
        if (input === '1' || input === 'btn_book' || normalized.includes('book')) {
          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: { state: ConversationState.SELECT_SERVICE },
          });

          // NATIVE RADIO LIST PICKER FOR SERVICES!
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
        } else if (input === '2' || input === 'btn_services' || normalized.includes('service')) {
          const serviceList = salon.services
            .map((s) => `• *${s.name}*: ₹${s.price} (${s.durationMinutes} mins)`)
            .join('\n');
          const reply = `✨ *Services Menu:*\n\n${serviceList}`;
          await this.sendMetaMessage(
            cleanNumber,
            {
              bodyText: reply,
              interactiveType: 'button',
              buttons: [{ id: 'btn_book', title: '📅 Book Now' }],
            },
            phoneNumberId,
          );
          return { replyMessage: reply, state: ConversationState.START };
        } else if (input === '3' || input === 'btn_info' || normalized.includes('info')) {
          const reply = `📍 *${salon.name}*\n\nAddress: ${salon.address || 'India'}, ${salon.city || ''}\nPhone: ${salon.phone}\nTimings: 10:00 AM – 08:00 PM`;
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

        await this.prisma.conversation.update({
          where: { id: conversation.id },
          data: {
            selectedServiceId: selectedService.id,
            state: ConversationState.SELECT_STAFF,
          },
        });

        const qualifiedStaff = salon.staff.filter((st) =>
          st.services.some((svc) => svc.serviceId === selectedService.id),
        );

        // NATIVE BUTTON / LIST PICKER FOR SPECIALIST
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

          const reply = `✅ Selected: *${selectedService.name}* (₹${selectedService.price})\n\nChoose your preferred stylist:`;
          await this.sendMetaMessage(
            cleanNumber,
            {
              bodyText: reply,
              buttonText: '👤 Select Specialist',
              interactiveType: 'list',
              listRows,
            },
            phoneNumberId,
          );
          return { replyMessage: reply, state: ConversationState.SELECT_STAFF, metadata: { qualifiedStaff } };
        }
      }

      case ConversationState.SELECT_STAFF: {
        const selectedServiceId = conversation.selectedServiceId!;
        const qualifiedStaff = salon.staff.filter((st) =>
          st.services.some((svc) => svc.serviceId === selectedServiceId),
        );

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

        // 3 QUICK DATE BUTTONS (Today, Tomorrow, Day After)
        const tz = salon.timezone || 'Asia/Kolkata';
        const today = DateTime.now().setZone(tz);
        const tomorrow = today.plus({ days: 1 });
        const dayAfter = today.plus({ days: 2 });

        const reply = `👤 Specialist: *${staffName}*\n\n📅 *Select Date:*`;
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
            selectedDate: targetDate.toJSDate(),
            state: ConversationState.SELECT_TIME,
          },
        });

        // NATIVE TIME SLOT RADIO PICKER (Up to 10 real slots)
        const slotsToShow = availability.availableSlots.slice(0, 10);
        const listRows: InteractiveListRow[] = slotsToShow.map((s) => ({
          id: `slot_${s.startTime}`,
          title: `⏰ ${s.startTime}`,
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

        return { replyMessage: reply, state: ConversationState.SELECT_TIME, metadata: { slots: slotsToShow } };
      }

      case ConversationState.SELECT_TIME: {
        const tz = salon.timezone || 'Asia/Kolkata';
        const targetDate = DateTime.fromJSDate(conversation.selectedDate!, { zone: tz }).toISODate()!;

        const availability = await this.availabilityService.getAvailableSlots(
          salonId,
          conversation.selectedServiceId!,
          targetDate,
          conversation.selectedStaffId || undefined,
        );

        let selectedSlot = null;
        if (input.startsWith('slot_')) {
          const slotTime = input.replace('slot_', '');
          selectedSlot = availability.availableSlots.find((s) => s.startTime === slotTime);
        } else {
          const num = parseInt(input, 10);
          if (!isNaN(num) && num >= 1 && num <= availability.availableSlots.length) {
            selectedSlot = availability.availableSlots[num - 1];
          } else {
            selectedSlot = availability.availableSlots.find((s) => s.startTime === input);
          }
        }

        if (!selectedSlot) {
          const slotsToShow = availability.availableSlots.slice(0, 10);
          const listRows = slotsToShow.map((s) => ({
            id: `slot_${s.startTime}`,
            title: `⏰ ${s.startTime}`,
          }));
          await this.sendMetaMessage(
            cleanNumber,
            {
              bodyText: '❌ Please select a time slot from the list:',
              buttonText: '⏰ Select Slot',
              interactiveType: 'list',
              listRows,
            },
            phoneNumberId,
          );
          return { replyMessage: 'Please select time slot', state: ConversationState.SELECT_TIME };
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

          const reply = `📋 *Booking Summary:*\n\n• Salon: *${salon.name}*\n• Service: *${selectedService?.name}* (₹${selectedService?.price})\n• Specialist: *${selectedStaff ? selectedStaff.name : 'Any Specialist'}*\n• Date: *${targetDate}*\n• Time: *${selectedSlot.startTime}*\n• Client: *${existingCustomer.name}*`;
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

          const reply = `⏰ Selected Time: *${selectedSlot.startTime}*\n\nPlease reply with your *Full Name* to complete the reservation:`;
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
        const dateStr = DateTime.fromJSDate(conversation.selectedDate!, { zone: tz }).toISODate()!;
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
          const dateStr = DateTime.fromJSDate(conversation.selectedDate!, { zone: tz }).toISODate()!;
          const timeSlotStr = DateTime.fromJSDate(conversation.selectedStartTime!, { zone: tz }).toFormat('HH:mm');

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
              data: { state: ConversationState.START },
            });

            const reply = `🎉 *APPOINTMENT CONFIRMED!*\n\n• Booking ID: *${appointment.appointmentNumber}*\n• Service: *${appointment.service.name}*\n• Specialist: *${appointment.staff.name}*\n• Date: *${dateStr}*\n• Time: *${timeSlotStr}*\n• Amount: *₹${appointment.price}*\n\n📍 *${salon.name}*\n${salon.address || ''}\n\nWe look forward to seeing you!`;
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

