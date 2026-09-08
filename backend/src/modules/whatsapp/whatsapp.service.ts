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
import { ConversationState, BookingSource, WhatsAppMessageDirection, AppointmentStatus, ClientEtaStatus, WhatsAppMessageStatus, ServiceGender } from '@prisma/client';
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
  ) { }

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
            direction: WhatsAppMessageDirection.OUTBOUND,
            messageText: payload.bodyText || payload.textBody || '',
            interactiveId: payload.interactiveType || null,
            status: 'FAILED',
            errorMessage: 'WHATSAPP_ACCESS_TOKEN is missing or not configured.',
          },
        })
        .catch(() => { });
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
            button: (payload.buttonText || '👉 Tap to Choose').slice(0, 20),
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
            direction: WhatsAppMessageDirection.OUTBOUND,
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
          let fallbackText = payload.textBody || payload.bodyText || 'Please reply to choose an option.';
          if (payload.interactiveType === 'list' && payload.listRows && payload.listRows.length > 0) {
            const rowsList = payload.listRows
              .filter((r) => !r.id.includes('period_'))
              .map((r, idx) => `*${idx + 1}.* ${r.title}`)
              .join('\n');
            if (rowsList && !fallbackText.includes(payload.listRows[0].title)) {
              fallbackText += `\n\n${rowsList}\n\n_Reply with a number (e.g. *1*, *2*) or your time directly._`;
            }
          } else if (payload.interactiveType === 'button' && payload.buttons && payload.buttons.length > 0) {
            const btnList = payload.buttons.map((b, idx) => `*${idx + 1}.* ${b.title}`).join('\n');
            if (btnList && !fallbackText.includes(payload.buttons[0].title)) {
              fallbackText += `\n\n${btnList}\n\n_Reply with *1*, *2*, or *3* to continue._`;
            }
          }

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
    metaMessageId?: string,
  ) {
    const cleanPhone = this.cleanPhone(fromPhone);
    return this.prisma.whatsAppLog
      .create({
        data: {
          salonId: salonId || null,
          phone: cleanPhone,
          direction: WhatsAppMessageDirection.INBOUND,
          messageText,
          interactiveId: interactiveId || null,
          status: 'RECEIVED',
          metaMessageId: metaMessageId || null,
          rawPayload: rawPayload || null,
        },
      })
      .catch((e) => this.logger.error('Failed to persist inbound WhatsApp log:', e));
  }

  async recordStatusLog(statusObj: any) {
    const recipient = this.cleanPhone(statusObj.recipient_id || '');
    const metaMessageId: string | null = statusObj.id || null;
    const rawStatus = (statusObj.status || '').toLowerCase();
    const error = statusObj.errors?.[0];

    // Map Meta delivery statuses ('sent', 'delivered', 'read', 'failed') to Prisma enum
    const status: WhatsAppMessageStatus =
      rawStatus === 'failed'
        ? WhatsAppMessageStatus.FAILED
        : WhatsAppMessageStatus.SENT;

    const errorCode = error?.code ? parseInt(String(error.code), 10) || null : null;
    const errorMessage = error?.title || error?.message || null;

    try {
      if (metaMessageId) {
        // Find existing outbound message log to update with delivery/read receipt
        const existing = await this.prisma.whatsAppLog.findUnique({
          where: { metaMessageId },
        });

        if (existing) {
          return await this.prisma.whatsAppLog.update({
            where: { id: existing.id },
            data: {
              status,
              errorCode: errorCode ?? existing.errorCode,
              errorMessage: errorMessage || existing.errorMessage,
              rawPayload: statusObj,
            },
          });
        }

        return await this.prisma.whatsAppLog.create({
          data: {
            phone: recipient,
            direction: WhatsAppMessageDirection.OUTBOUND,
            status,
            metaMessageId,
            errorCode,
            errorMessage,
            rawPayload: statusObj,
          },
        });
      }

      return await this.prisma.whatsAppLog.create({
        data: {
          phone: recipient,
          direction: WhatsAppMessageDirection.OUTBOUND,
          status,
          errorCode,
          errorMessage,
          rawPayload: statusObj,
        },
      });
    } catch (e: any) {
      this.logger.warn(
        `[WhatsAppService] Delivery status log note (${rawStatus} for ${recipient}): ${e?.message || e}`,
      );
    }
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

  private async findActiveUpcomingAppointments(salonId: string, cleanNumber: string) {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000); // within last 30 mins or in future
    return this.prisma.appointment.findMany({
      where: {
        salonId,
        salonUser: { user: { phone: cleanNumber } },
        status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN] },
        startAt: { gte: cutoff },
      },
      include: {
        salonUser: { include: { user: true } },
        stylist: true,
        service: true,
      },
      orderBy: { startAt: 'asc' },
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
        selectedStaffId: activeAppt.stylistId || activeAppt.staffId,
      },
    });

    const tz = salon.timezone || 'Asia/Kolkata';
    const apptTime = activeAppt.startAt || activeAppt.startTime;
    const timeFormatted = DateTime.fromJSDate(apptTime, { zone: tz }).toFormat('hh:mm a');
    const dateFormatted = DateTime.fromJSDate(apptTime, { zone: tz }).toFormat('dd LLL, EEE');

    const customerName = activeAppt.salonUser?.user?.name || activeAppt.user?.name || activeAppt.customer?.name || 'Customer';
    const stylistName = activeAppt.stylist?.name || activeAppt.staff?.name || 'Stylist';

    const reply = `👋 Welcome back, *${customerName}*!\n\n📅 *Your Upcoming Appointment:*\n• Service: *${activeAppt.service.name}* (₹${activeAppt.price})\n• Specialist: *${stylistName}*\n• Date: *${dateFormatted}*\n• Time: *${timeFormatted}*\n• Status: *${activeAppt.status}* (Ref: *#${activeAppt.appointmentNumber}*)\n\nWhat would you like to do?`;

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

  // Helper: Handle add-on service scheduling conflict
  // When the add-on doesn't fit in the current slot, this method:
  // 1. Checks if the same barber has another combined-duration slot today
  // 2. If not, checks if another qualified barber is available today
  // 3. Presents smart options accordingly (Reschedule / Change Specialist / Change Date / Keep As Is)
  private async handleAddonConflict(
    conversation: any,
    salon: any,
    cleanNumber: string,
    addonServiceId: string,
    conflictBooking: any,
    phoneNumberId?: string,
  ) {
    const tz = salon.timezone || 'Asia/Kolkata';
    const today = DateTime.now().setZone(tz);
    const dateStr = today.toISODate()!;
    const stylistName = conflictBooking?.staff?.name || conflictBooking?.stylist?.name || 'Stylist';

    // Save pending add-on and transition to ADDON_CONFLICT state
    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        state: ConversationState.ADDON_CONFLICT,
        pendingAddonServiceId: addonServiceId,
      },
    });

    // Get active appointment and current specialist ID
    let activeAppt = (conversation as any).activeAppointment;
    if (!activeAppt && conversation.activeAppointmentId) {
      activeAppt = await this.appointmentsService.getAppointmentById(salon.id, conversation.activeAppointmentId).catch(() => null);
    }
    const currentStylistId = conflictBooking?.stylistId || conflictBooking?.staffId || activeAppt?.stylistId || conversation.selectedStaffId;
    const originalServiceId = activeAppt?.serviceId || conversation.selectedServiceId;

    // Check if other qualified specialists exist in the salon for BOTH original service + add-on service
    const otherQualifiedStylists = salon.stylists?.filter((st: any) => {
      if (st.id === currentStylistId) return false;
      const serviceIdsForStylist = st.services?.map((s: any) => s.serviceId) || [];
      const hasOriginal = !originalServiceId || serviceIdsForStylist.includes(originalServiceId);
      const hasAddon = serviceIdsForStylist.includes(addonServiceId);
      return hasOriginal && hasAddon;
    }) || [];

    const reply = `⚠️ Specialist *${stylistName}* has another client booked right after your slot.\n\nHow would you like to proceed?`;

    const buttons = [
      { id: 'btn_reschedule', title: '🔄 Reschedule Both' },
    ];

    if (otherQualifiedStylists.length > 0) {
      buttons.push({ id: 'btn_change_stylist', title: '💇‍♂️ Change Specialist' });
    }

    buttons.push({ id: 'btn_keep', title: '🔙 Keep As Is' });

    await this.sendMetaMessage(
      cleanNumber,
      {
        bodyText: reply,
        interactiveType: 'button',
        buttons,
      },
      phoneNumberId,
    );

    return { replyMessage: reply, state: ConversationState.ADDON_CONFLICT };
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

  // -------------------------------------------------------------------------
  // 2-TIER SERVICE HIERARCHY & GENDER FILTERING HELPERS
  // -------------------------------------------------------------------------

  public getEffectiveGender(conversation: any, salonUser: any): ServiceGender {
    if (conversation.tempBookingGender) {
      return conversation.tempBookingGender as ServiceGender;
    }
    if (salonUser?.gender) {
      return salonUser.gender as ServiceGender;
    }
    return ServiceGender.UNISEX;
  }

  public filterServicesByGender(services: any[], effectiveGender: ServiceGender): any[] {
    if (!effectiveGender || effectiveGender === ServiceGender.UNISEX) {
      return services;
    }
    return services.filter((s) => {
      const tgt = s.targetGender || ServiceGender.UNISEX;
      if (effectiveGender === ServiceGender.MALE) {
        return tgt === ServiceGender.MALE || tgt === ServiceGender.UNISEX;
      }
      if (effectiveGender === ServiceGender.FEMALE) {
        return tgt === ServiceGender.FEMALE || tgt === ServiceGender.UNISEX;
      }
      if (effectiveGender === ServiceGender.KIDS) {
        return tgt === ServiceGender.KIDS || tgt === ServiceGender.UNISEX;
      }
      return true;
    });
  }

  public getGenderLabel(gender: ServiceGender): string {
    switch (gender) {
      case ServiceGender.MALE:
        return '👨 Men';
      case ServiceGender.FEMALE:
        return '👩 Women';
      case ServiceGender.KIDS:
        return '👶 Kids';
      case ServiceGender.UNISEX:
      default:
        return '✂️ Unisex / All';
    }
  }

  public getGenderBadge(gender: ServiceGender): string {
    switch (gender) {
      case ServiceGender.MALE:
        return '👨';
      case ServiceGender.FEMALE:
        return '👩';
      case ServiceGender.KIDS:
        return '👶';
      case ServiceGender.UNISEX:
      default:
        return '✂️';
    }
  }

  async promptGenderSelection(
    conversationId: string,
    cleanNumber: string,
    salon: any,
    phoneNumberId?: string,
  ): Promise<{ replyMessage: string; state: ConversationState }> {
    const reply = `👤 *Choose Booking Audience*\n\nWho are you booking this appointment for?`;
    await this.sendMetaMessage(
      cleanNumber,
      {
        headerText: `${salon.name} Gender Filter`,
        bodyText: reply,
        interactiveType: 'button',
        buttons: [
          { id: 'gender_select_MALE', title: '👨 Men' },
          { id: 'gender_select_FEMALE', title: '👩 Women' },
          { id: 'gender_select_UNISEX', title: '✂️ Show All' },
        ],
      },
      phoneNumberId,
    );
    return { replyMessage: reply, state: ConversationState.SELECT_CATEGORY };
  }

  async promptCategorySelection(
    conversation: any,
    cleanNumber: string,
    salon: any,
    salonUser: any,
    phoneNumberId?: string,
  ): Promise<{ replyMessage: string; state: ConversationState }> {
    const effectiveGender = this.getEffectiveGender(conversation, salonUser);
    const genderLabel = this.getGenderLabel(effectiveGender);

    const activeServices = this.filterServicesByGender(salon.services || [], effectiveGender);

    if (activeServices.length === 0) {
      const reply = `⚠️ No services found for *${genderLabel}*. Tap *Switch Gender* to view other services:`;
      await this.sendMetaMessage(
        cleanNumber,
        {
          bodyText: reply,
          interactiveType: 'button',
          buttons: [
            { id: 'btn_switch_gender', title: '🔄 Switch Gender' },
            { id: 'btn_start', title: '🏠 Main Menu' },
          ],
        },
        phoneNumberId,
      );
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { state: ConversationState.SELECT_CATEGORY, selectedCategoryId: null },
      });
      return { replyMessage: reply, state: ConversationState.SELECT_CATEGORY };
    }

    const categoriesWithServices = (salon.serviceCategories || [])
      .map((cat: any) => {
        const catServices = activeServices.filter((s) => s.categoryId === cat.id);
        return { ...cat, matchingCount: catServices.length };
      })
      .filter((cat: any) => cat.matchingCount > 0);

    const uncategorizedServices = activeServices.filter((s) => !s.categoryId);

    // If salon has no categories OR all services are uncategorized, jump to service list directly
    if (categoriesWithServices.length === 0) {
      return this.promptServiceSelection(conversation, cleanNumber, salon, salonUser, phoneNumberId);
    }

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: { state: ConversationState.SELECT_CATEGORY, selectedCategoryId: null },
    });

    const totalItems = categoriesWithServices.length + (uncategorizedServices.length > 0 ? 1 : 0);

    if (totalItems <= 2) {
      const buttons: Array<{ id: string; title: string }> = categoriesWithServices.map((cat: any) => ({
        id: `cat_${cat.id}`,
        title: `${cat.icon || '📂'} ${cat.name}`.slice(0, 20),
      }));

      if (uncategorizedServices.length > 0) {
        buttons.push({ id: 'cat_uncategorized', title: 'General Services'.slice(0, 20) });
      }

      if (buttons.length < 3) {
        buttons.push({ id: 'btn_switch_gender', title: '🔄 Switch Gender'.slice(0, 20) });
      }

      const reply = `📂 *Select Category*\nFilter: *${genderLabel}*\n\nPlease choose a category:`;
      await this.sendMetaMessage(
        cleanNumber,
        {
          headerText: `${salon.name} Menu`,
          bodyText: reply,
          interactiveType: 'button',
          buttons,
        },
        phoneNumberId,
      );
      return { replyMessage: reply, state: ConversationState.SELECT_CATEGORY };
    } else {
      const listRows: InteractiveListRow[] = categoriesWithServices.map((cat: any) => ({
        id: `cat_${cat.id}`,
        title: `${cat.icon || '📂'} ${cat.name}`,
        description: `${cat.matchingCount} service${cat.matchingCount > 1 ? 's' : ''} available`,
      }));

      if (uncategorizedServices.length > 0) {
        listRows.push({
          id: 'cat_uncategorized',
          title: 'General Services',
          description: `${uncategorizedServices.length} service${uncategorizedServices.length > 1 ? 's' : ''}`,
        });
      }

      listRows.push({
        id: 'btn_switch_gender',
        title: '🔄 Switch Gender Filter',
        description: `Currently showing: ${genderLabel}`,
      });

      const reply = `📂 *Service Categories*\nFilter: *${genderLabel}*\n\nPlease tap below to choose a category:`;
      await this.sendMetaMessage(
        cleanNumber,
        {
          headerText: `${salon.name} Menu`,
          bodyText: reply,
          footerText: 'Tap below to select category',
          buttonText: '📂 View Categories',
          interactiveType: 'list',
          listRows,
        },
        phoneNumberId,
      );
      return { replyMessage: reply, state: ConversationState.SELECT_CATEGORY };
    }
  }

  async promptServiceSelection(
    conversation: any,
    cleanNumber: string,
    salon: any,
    salonUser: any,
    phoneNumberId?: string,
    categoryId?: string | null,
  ): Promise<{ replyMessage: string; state: ConversationState; metadata?: any }> {
    const effectiveGender = this.getEffectiveGender(conversation, salonUser);
    const genderLabel = this.getGenderLabel(effectiveGender);

    const activeGenderServices = this.filterServicesByGender(salon.services || [], effectiveGender);
    const targetCatId = categoryId !== undefined ? categoryId : conversation.selectedCategoryId;

    let targetServices = activeGenderServices;
    let categoryName = '';

    if (targetCatId) {
      if (targetCatId === 'uncategorized') {
        targetServices = activeGenderServices.filter((s) => !s.categoryId);
        categoryName = 'General Services';
      } else {
        targetServices = activeGenderServices.filter((s) => s.categoryId === targetCatId);
        const cat = (salon.serviceCategories || []).find((c: any) => c.id === targetCatId);
        categoryName = cat ? cat.name : '';
      }
    }

    if (targetServices.length === 0) {
      const reply = `⚠️ No services available in this category for *${genderLabel}*.`;
      await this.sendMetaMessage(
        cleanNumber,
        {
          bodyText: reply,
          interactiveType: 'button',
          buttons: [
            { id: 'cat_back', title: '⬅️ Categories' },
            { id: 'btn_switch_gender', title: '🔄 Switch Gender' },
          ],
        },
        phoneNumberId,
      );
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { state: ConversationState.SELECT_SERVICE },
      });
      return { replyMessage: reply, state: ConversationState.SELECT_SERVICE };
    }

    const hasCategories = (salon.serviceCategories || []).length > 0;
    if (targetServices.length === 1 && !hasCategories) {
      return this.handleServiceChosen(conversation.id, cleanNumber, salon, targetServices[0], phoneNumberId);
    }

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        state: ConversationState.SELECT_SERVICE,
        selectedCategoryId: targetCatId || null,
      },
    });

    const listRows: InteractiveListRow[] = targetServices.map((s) => {
      const genderIcon = this.getGenderBadge(s.targetGender);
      return {
        id: `svc_${s.id}`,
        title: s.name,
        description: `${genderIcon} ₹${s.price} • ${s.durationMinutes} mins`,
      };
    });

    if (hasCategories) {
      listRows.push({
        id: 'cat_back',
        title: '⬅️ Back to Categories',
        description: 'Browse other service categories',
      });
    }

    listRows.push({
      id: 'btn_switch_gender',
      title: '🔄 Switch Gender Filter',
      description: `Current filter: ${genderLabel}`,
    });

    const catHeader = categoryName ? ` (${categoryName})` : '';
    const reply = `✂️ *Select a Service${catHeader}*\nFilter: *${genderLabel}*\n\nPlease choose a service below:`;

    await this.sendMetaMessage(
      cleanNumber,
      {
        headerText: `${salon.name} Services`,
        bodyText: reply,
        footerText: 'Tap below to select',
        buttonText: '✂️ Select Service',
        interactiveType: 'list',
        listRows,
      },
      phoneNumberId,
    );

    return { replyMessage: reply, state: ConversationState.SELECT_SERVICE, metadata: { services: targetServices } };
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

  /**
   * Builds an interactive list view for a selected time period (Morning, Afternoon, Evening)
   * with complete pagination so no slots between 12 PM - 4 PM or 4 PM - Close are ever cut off.
   */
  private buildPeriodSlotView(
    allSlots: AvailableSlotResponse[],
    cleanInput: string,
    isReschedule: boolean,
    targetDateStr: string,
  ): {
    headerText: string;
    bodyText: string;
    listRows: InteractiveListRow[];
    scopedSlots: AvailableSlotResponse[];
    chosenPeriod: 'morning' | 'afternoon' | 'evening';
  } {
    const morningSlots = allSlots.filter((s) => parseInt(s.startTime.split(':')[0], 10) < 12);
    const afternoonSlots = allSlots.filter((s) => {
      const h = parseInt(s.startTime.split(':')[0], 10);
      return h >= 12 && h < 16;
    });
    const eveningSlots = allSlots.filter((s) => parseInt(s.startTime.split(':')[0], 10) >= 16);

    let chosenPeriod: 'morning' | 'afternoon' | 'evening' = 'morning';
    if (cleanInput.includes('afternoon')) chosenPeriod = 'afternoon';
    else if (cleanInput.includes('evening')) chosenPeriod = 'evening';
    else if (morningSlots.length === 0 && afternoonSlots.length > 0) chosenPeriod = 'afternoon';
    else if (morningSlots.length === 0 && afternoonSlots.length === 0 && eveningSlots.length > 0) chosenPeriod = 'evening';

    const periodSlots = chosenPeriod === 'morning' ? morningSlots : chosenPeriod === 'afternoon' ? afternoonSlots : eveningSlots;
    const slotsForPeriod = periodSlots.length > 0 ? periodSlots : allSlots;

    // Parse page index (e.g. period_afternoon_p2 or rperiod_evening_2)
    let page = 1;
    const pageMatch = cleanInput.match(/(?:_p|_page|_)(\d+)/);
    if (pageMatch) {
      page = Math.max(1, parseInt(pageMatch[1], 10));
    }

    const prefix = isReschedule ? 'r' : '';
    const periodTitle = chosenPeriod === 'morning' ? '🌅 Morning' : chosenPeriod === 'afternoon' ? '☀️ Afternoon' : '🌙 Evening';
    const totalSlots = slotsForPeriod.length;

    // Meta Interactive List allows max 10 rows.
    // If totalSlots <= 8, everything fits in 1 single page!
    // If totalSlots > 8 and <= 16, 8 slots per page (2 pages).
    // If totalSlots > 16, 7 slots per page.
    let pageSize = 8;
    if (totalSlots > 16) pageSize = 7;
    const totalPages = Math.max(1, Math.ceil(totalSlots / pageSize));
    if (page > totalPages) page = totalPages;

    const startIndex = (page - 1) * pageSize;
    const pageSlots = slotsForPeriod.slice(startIndex, startIndex + pageSize);

    const listRows: InteractiveListRow[] = pageSlots.map((s) => ({
      id: `${prefix}slot_${s.startTime}`,
      title: `⏰ ${this.formatTime12h(s.startTime)}`,
      description: s.availableStaffCount ? `Available with ${s.availableStaffCount} stylist(s)` : `Available slot`,
    }));

    // Pagination Row: Next Page (if more slots exist in this period)
    if (page < totalPages) {
      const nextStart = page * pageSize;
      const nextSlotsRemaining = slotsForPeriod.slice(nextStart);
      const nextRangeStart = this.formatTime12h(nextSlotsRemaining[0].startTime);
      const nextRangeEnd = this.formatTime12h(nextSlotsRemaining[nextSlotsRemaining.length - 1].startTime);
      listRows.push({
        id: `${prefix}period_${chosenPeriod}_p${page + 1}`,
        title: `▶️ More ${chosenPeriod === 'morning' ? 'Morning' : chosenPeriod === 'afternoon' ? 'Afternoon' : 'Evening'} →`.slice(0, 24),
        description: `${nextRangeStart} – ${nextRangeEnd}`.slice(0, 72),
      });
    }

    // Pagination Row: Previous Page (if coming back)
    if (page > 1) {
      const prevSlots = slotsForPeriod.slice(0, startIndex);
      const prevRangeStart = this.formatTime12h(prevSlots[0].startTime);
      const prevRangeEnd = this.formatTime12h(prevSlots[prevSlots.length - 1].startTime);
      listRows.push({
        id: `${prefix}period_${chosenPeriod}_p${page - 1}`,
        title: `◀️ Earlier ${chosenPeriod === 'morning' ? 'Morning' : chosenPeriod === 'afternoon' ? 'Afternoon' : 'Evening'}`.slice(0, 24),
        description: `${prevRangeStart} – ${prevRangeEnd}`.slice(0, 72),
      });
    }

    // Cross-Period Switcher Rows (switch between periods)
    if (listRows.length < 10) {
      if (chosenPeriod === 'morning' && afternoonSlots.length > 0) {
        listRows.push({
          id: `${prefix}period_afternoon`,
          title: '☀️ Afternoon Slots →',
          description: '12:00 PM – 4:00 PM',
        });
      } else if (chosenPeriod === 'afternoon' && eveningSlots.length > 0) {
        listRows.push({
          id: `${prefix}period_evening`,
          title: '🌙 Evening Slots →',
          description: '4:00 PM – Close',
        });
      } else if (chosenPeriod === 'evening' && morningSlots.length > 0) {
        listRows.push({
          id: `${prefix}period_morning`,
          title: '🌅 Morning Slots →',
          description: 'Open – 12:00 PM',
        });
      }
    }

    if (listRows.length < 10 && chosenPeriod === 'evening' && afternoonSlots.length > 0) {
      listRows.push({
        id: `${prefix}period_afternoon`,
        title: '☀️ Afternoon Slots →',
        description: '12:00 PM – 4:00 PM',
      });
    }

    // Strict guard to never exceed Meta's 10-row limit
    while (listRows.length > 10) {
      listRows.pop();
    }

    // Format numbered text list for the message body
    const slotListFormatted = pageSlots
      .map((s, idx) => `*${startIndex + idx + 1}.* ⏰ *${this.formatTime12h(s.startTime)}*`)
      .join('\n');

    const pageIndicator = totalPages > 1 ? ` (Page ${page} of ${totalPages})` : '';
    const dateFormatted = DateTime.fromISO(targetDateStr).isValid
      ? DateTime.fromISO(targetDateStr).toFormat('dd LLL, EEEE')
      : targetDateStr;

    let periodReply = `📅 *${dateFormatted}* — ${periodTitle} Slots${pageIndicator}:\n\n${slotListFormatted}`;

    if (totalPages > 1 && page < totalPages) {
      const nextStart = page * pageSize;
      const nextSlotsRemaining = slotsForPeriod.slice(nextStart);
      const nextRangeStart = this.formatTime12h(nextSlotsRemaining[0].startTime);
      const nextRangeEnd = this.formatTime12h(nextSlotsRemaining[nextSlotsRemaining.length - 1].startTime);
      periodReply += `\n\n_(Showing ${startIndex + 1}–${startIndex + pageSlots.length} of ${totalSlots} ${chosenPeriod} slots. Tap **"More ${chosenPeriod === 'afternoon' ? 'Afternoon' : 'Evening'} →"** below for ${nextRangeStart} – ${nextRangeEnd})_`;
    }

    periodReply += `\n\n👉 Tap *Choose Time* below, or reply with the slot number or your desired time (e.g. *${this.formatTime12h(pageSlots[0].startTime)}*):`;

    return {
      headerText: `${periodTitle} Slots${pageIndicator}`.slice(0, 60),
      bodyText: periodReply,
      listRows,
      scopedSlots: slotsForPeriod,
      chosenPeriod,
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

    const salon: any = await this.prisma.salon.findUnique({
      where: { id: salonId },
      include: {
        serviceCategories: {
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        },
        services: {
          where: {
            status: 'ACTIVE',
            stylists: {
              some: {
                stylist: { status: 'ACTIVE' },
              },
            },
          },
          include: {
            serviceCategory: true,
          },
          orderBy: { name: 'asc' },
        },
        stylists: { where: { status: 'ACTIVE' }, include: { services: true } },
      },
    });

    if (salon) {
      salon.staff = salon.stylists;
    }

    if (!salon || salon.status !== 'ACTIVE') {
      const reply = 'Sorry, this salon booking service is currently inactive.';
      await this.sendMetaMessage(cleanNumber, { textBody: reply }, phoneNumberId);
      return { replyMessage: reply, state: ConversationState.START };
    }

    // 1. Ensure customer User record exists (Section 1 & 24)
    let user = await this.prisma.user.findUnique({
      where: { phone: cleanNumber },
    });
    if (!user) {
      user = await this.prisma.user.create({
        data: {
          phone: cleanNumber,
          name: null,
        },
      });
    }

    // 2. Ensure link to this salon via SalonUser
    const salonUser = await this.prisma.salonUser.upsert({
      where: {
        salonId_userId: { salonId, userId: user.id },
      },
      update: {},
      create: {
        salonId,
        userId: user.id,
      },
    });

    const input = (interactiveId || messageText || '').trim();

    // Check if customer is blocked from booking due to 3 yearly no-shows
    if (salonUser?.isBookingBlocked) {
      const isBookingAttempt =
        ['btn_book', 'btn_services', 'btn_book_now'].includes(input) ||
        input.startsWith('svc_') ||
        input.startsWith('slot_') ||
        input.startsWith('date_');

      if (isBookingAttempt) {
        const blockMessage = `⚠️ *BOOKING RESTRICTED*

You have accumulated *3 penalty strikes* this year for missed appointments. Automatic slot booking is currently locked for your account.

📞 *Please contact the Salon Owner* directly at *${salon.phone || 'the salon desk'}* to request access unblock.`;

        await this.sendMetaMessage(
          cleanNumber,
          {
            bodyText: blockMessage,
            interactiveType: 'button',
            buttons: [{ id: 'btn_start', title: '🏠 Main Menu' }],
          },
          phoneNumberId,
          salonId,
        );
        return { replyMessage: blockMessage, state: ConversationState.START };
      }
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
          customerName: user.name || null,
          state: ConversationState.START,
        },
      });
    } else if (!conversation.customerName && user.name) {
      conversation = await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { customerName: user.name },
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
    // REMINDER & LATE-ARRIVAL RESPONSES & SMART MOVE-UP
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

    if (input === 'remind_10m_on_way' || input.startsWith('late_on_way')) {
      const activeAppts = await this.findActiveUpcomingAppointments(salonId, cleanNumber);
      if (activeAppts.length > 0) {
        await this.prisma.appointment.update({
          where: { id: activeAppts[0].id },
          data: { clientEtaStatus: ClientEtaStatus.ON_THE_WAY },
        }).catch(() => { });
      }

      const reply = `🚗 *Thanks for letting us know!*\n\nWe have notified your stylist that you are on your way. Drive safely and see you shortly!`;
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

    if (input === 'remind_10m_cancel' || input.startsWith('late_cancel') || input === 'remind_cancel') {
      const apptId = input.startsWith('late_cancel_') ? input.replace('late_cancel_', '') : null;
      let targetAppt: any = null;
      if (apptId) {
        targetAppt = await this.prisma.appointment.findUnique({ where: { id: apptId } });
      } else {
        const activeAppts = await this.findActiveUpcomingAppointments(salonId, cleanNumber);
        if (activeAppts.length > 0) targetAppt = activeAppts[0];
      }

      if (targetAppt) {
        await this.appointmentsService.updateStatus(
          salonId,
          targetAppt.id,
          {
            status: AppointmentStatus.CANCELLED,
            reason: 'Cancelled by client via WhatsApp reminder / 10-minute check-in.',
          },
          'SYSTEM_WHATSAPP_BOT',
        ).catch(() => { });
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

      if (targetAppt) {
        // Trigger Smart Express Move-Up Broadcast for the newly freed slot!
        await this.appointmentsService.triggerSmartMoveUpBroadcast(targetAppt);
      }

      return { replyMessage: reply, state: ConversationState.START };
    }

    if (input.startsWith('move_up_accept_')) {
      const parts = input.replace('move_up_accept_', '').split('_');
      const candidateApptId = parts[0];
      const freedApptId = parts[1];

      if (candidateApptId && freedApptId) {
        const freedAppt = await this.prisma.appointment.findUnique({ where: { id: freedApptId } });
        const candidateAppt = await this.prisma.appointment.findUnique({
          where: { id: candidateApptId },
          include: { stylist: true, service: true },
        });

        if (freedAppt && candidateAppt && candidateAppt.status === AppointmentStatus.CONFIRMED) {
          const oldStart = candidateAppt.startAt;
          const oldEnd = candidateAppt.endAt;

          const tz = salon.timezone || 'Asia/Kolkata';
          const newTimeStr = DateTime.fromJSDate(freedAppt.startAt, { zone: tz }).toFormat('hh:mm a');

          // Atomically update freed appointment to CANCELLED and shift candidate appointment into freed slot
          await this.prisma.$transaction([
            this.prisma.appointment.update({
              where: { id: freedApptId },
              data: {
                status: AppointmentStatus.CANCELLED,
                notes: 'Replaced by customer via Express Move-Up.',
              },
            }),
            this.prisma.appointment.update({
              where: { id: candidateApptId },
              data: {
                startAt: freedAppt.startAt,
                endAt: freedAppt.endAt,
                appointmentDate: freedAppt.appointmentDate,
                notes: `Moved earlier via Express Move-Up from ${DateTime.fromJSDate(oldStart, { zone: tz }).toFormat('hh:mm a')}`,
              },
            }),
          ]);

          const reply = `⚡ *APPOINTMENT MOVED EARLIER!*

Hi *${conversation.customerName || 'Customer'}*, your appointment with *${candidateAppt.stylist?.name || 'your stylist'}* has been successfully rescheduled to *${newTimeStr}* today!

We look forward to seeing you earlier today.`;

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

          // Now trigger smart move-up broadcast for candidate's OLD freed slot!
          await this.appointmentsService.triggerSmartMoveUpBroadcast({
            id: candidateApptId,
            salonId,
            stylistId: candidateAppt.stylistId,
            startAt: oldStart,
            endAt: oldEnd,
          });

          return { replyMessage: reply, state: ConversationState.START };
        }
      }
    }

    if (input.startsWith('move_up_decline_')) {
      const reply = `👍 *No problem!* We've kept your original appointment time as scheduled. See you then!`;
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

    if (input.startsWith('propose_accept_')) {
      const apptId = input.replace('propose_accept_', '');
      const appt = await this.prisma.appointment.findUnique({
        where: { id: apptId },
        include: { service: true, stylist: true },
      });

      if (appt && appt.proposedStartAt && appt.proposedEndAt) {
        const newStart = appt.proposedStartAt;
        const newEnd = appt.proposedEndAt;

        await this.prisma.appointment.update({
          where: { id: apptId },
          data: {
            startAt: newStart,
            endAt: newEnd,
            appointmentDate: DateTime.fromJSDate(newStart, { zone: salon.timezone || 'Asia/Kolkata' }).startOf('day').toJSDate(),
            status: AppointmentStatus.CONFIRMED,
            proposedStartAt: null,
            proposedEndAt: null,
            proposedByAdminId: null,
            notes: `${appt.notes || ''} [Rescheduled by salon admin and accepted by customer.]`.trim(),
          },
        });

        const tz = salon.timezone || 'Asia/Kolkata';
        const newTimeStr = DateTime.fromJSDate(newStart, { zone: tz }).toFormat('hh:mm a');
        const reply = `🎉 *RESCHEDULE CONFIRMED!*\n\nThank you for accepting! Your appointment with *${appt.stylist?.name || 'Stylist'}* at *${salon.name}* is now set for *${newTimeStr}*.`;

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

        this.appointmentsService.emitSalonEvent(salonId, 'STATUS_UPDATED', appt);
        return { replyMessage: reply, state: ConversationState.START };
      }
    }

    if (input.startsWith('propose_decline_')) {
      const apptId = input.replace('propose_decline_', '');
      const appt = await this.prisma.appointment.findUnique({ where: { id: apptId } });

      if (appt) {
        const isPast = new Date(appt.startAt).getTime() < Date.now();
        await this.prisma.appointment.update({
          where: { id: apptId },
          data: {
            status: isPast ? AppointmentStatus.CANCELLED : AppointmentStatus.CONFIRMED,
            proposedStartAt: null,
            proposedEndAt: null,
            proposedByAdminId: null,
            notes: `${appt.notes || ''} [Proposed reschedule declined by customer.]`.trim(),
          },
        });

        const reply = `👍 *No problem!* We have kept your original appointment details. Contact the salon if you need further adjustments!`;
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

        this.appointmentsService.emitSalonEvent(salonId, 'STATUS_UPDATED', appt);
        return { replyMessage: reply, state: ConversationState.START };
      }
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
          return this.handleAddonConflict(
            conversation,
            salon,
            cleanNumber,
            addonId,
            result.conflictBooking,
            phoneNumberId,
          );
        }
      }
    }

    // -------------------------------------------------------------
    // EXPIRED INTERACTIVE BUTTON GUARD (Strict Old Message Button Locking)
    // -------------------------------------------------------------
    const isGlobalButton =
      ['btn_menu', 'btn_start', 'btn_book', 'btn_services'].includes(input) ||
      input.startsWith('remind_') ||
      input.startsWith('propose_') ||
      input.startsWith('late_') ||
      input.startsWith('move_up_');

    const isKnownButtonPayload =
      isGlobalButton ||
      input.startsWith('btn_') ||
      input.startsWith('cat_') ||
      input.startsWith('gender_select_') ||
      input.startsWith('addon_') ||
      input.startsWith('rdate_') ||
      input.startsWith('rslot_') ||
      input.startsWith('date_') ||
      input.startsWith('slot_') ||
      input.startsWith('staff_') ||
      input.startsWith('svc_') ||
      input.startsWith('appt_');

    if (isKnownButtonPayload) {
      let isAllowedForState = isGlobalButton;
      if (!isAllowedForState) {
        switch (conversation.state) {
          case ConversationState.CONFIRMATION:
            isAllowedForState = ['btn_confirm_yes', 'btn_confirm_no', 'btn_confirm'].includes(input);
            break;
          case ConversationState.ACTIVE_HUB:
            isAllowedForState = ['btn_add_service', 'btn_add_addon', 'btn_reschedule', 'btn_cancel_appt', 'btn_running_late', 'btn_eta_late_15'].includes(input) || input.startsWith('svc_');
            break;
          case ConversationState.CONFIRM_CANCEL:
            isAllowedForState = ['btn_cancel_yes', 'btn_cancel_no'].includes(input);
            break;
          case ConversationState.ADDON_CONFLICT:
            isAllowedForState = ['btn_reschedule', 'btn_change_stylist', 'btn_keep_appt'].includes(input);
            break;
          case ConversationState.SELECT_RESCHEDULE_DATE:
            isAllowedForState = input.startsWith('rdate_');
            break;
          case ConversationState.SELECT_RESCHEDULE_TIME:
            isAllowedForState = input.startsWith('rslot_');
            break;
          case ConversationState.SELECT_CATEGORY:
            isAllowedForState = input.startsWith('cat_') || input.startsWith('gender_select_') || input === 'btn_switch_gender';
            break;
          case ConversationState.SELECT_SERVICE:
            isAllowedForState = input.startsWith('svc_') || input === 'cat_back' || input.startsWith('gender_select_') || input === 'btn_switch_gender';
            break;
          case ConversationState.SELECT_STAFF:
            isAllowedForState = input.startsWith('staff_');
            break;
          case ConversationState.SELECT_DATE:
            isAllowedForState = input.startsWith('date_');
            break;
          case ConversationState.SELECT_TIME:
            isAllowedForState = input.startsWith('slot_');
            break;
          case ConversationState.SELECT_ADDON:
            isAllowedForState = input.startsWith('addon_');
            break;
          case ConversationState.SELECT_APPOINTMENT:
            isAllowedForState = input.startsWith('appt_');
            break;
          case ConversationState.START:
          case ConversationState.COMPLETED:
            isAllowedForState = true;
            break;
          default:
            isAllowedForState = true;
        }
      }

      if (!isAllowedForState) {
        const reply = `⚠️ *That button option has expired.*\n\nPlease use the action buttons on the latest message below to continue.`;
        await this.sendMetaMessage(
          cleanNumber,
          { bodyText: reply },
          phoneNumberId,
          salonId,
        );
        return { replyMessage: reply, state: conversation.state };
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
              include: { stylist: true, service: true },
            });

            if (activeAppt) {
              const apptStart = DateTime.fromJSDate(activeAppt.startAt, { zone: tz });
              const hoursUntilAppt = apptStart.diff(now, 'hours').hours;
              const cancelWindowHours = salon.cancelWindowHours ?? 2;

              if (hoursUntilAppt < cancelWindowHours && hoursUntilAppt > -1) {
                // Critical Window (< 2 hours): Protect salon chair from last-minute abandonment
                const reply = `⚠️ *Appointment is in less than ${cancelWindowHours} hours!*\n\nSpecialist *${activeAppt.stylist?.name || 'Your specialist'}* has already reserved your chair for *${activeAppt.serviceNameSnapshot || activeAppt.service?.name}*.\n\n• If you are delayed in traffic, tap *'Running 15m Late'* to hold your station.\n• To change your slot today, call our front desk directly at *${salon.phone || 'our desk'}*.`;
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
          const tz = salon.timezone || 'Asia/Kolkata';
          const now = DateTime.now().setZone(tz);

          if (conversation.activeAppointmentId) {
            const activeAppt = await this.prisma.appointment.findUnique({
              where: { id: conversation.activeAppointmentId },
              include: { stylist: true, service: true },
            });

            if (activeAppt) {
              const apptStart = DateTime.fromJSDate(activeAppt.startAt, { zone: tz });
              const hoursUntilAppt = apptStart.diff(now, 'hours').hours;
              const cancelWindowHours = salon.cancelWindowHours ?? 2;

              if (hoursUntilAppt < cancelWindowHours && hoursUntilAppt > -1) {
                // Critical Window (< 2 hours): Protect salon chair from last-minute cancellation
                const reply = `⚠️ *Appointment is in less than ${cancelWindowHours} hours!*\n\nSpecialist *${activeAppt.stylist?.name || 'Your specialist'}* has already reserved your chair for *${activeAppt.serviceNameSnapshot || activeAppt.service?.name}*.\n\nAppointments cannot be cancelled online within ${cancelWindowHours} hours of your scheduled time.\n\n• If you are delayed in traffic, tap *'Running 15m Late'* to hold your station.\n• For emergency changes, please call our front desk directly at *${salon.phone || 'our desk'}*.`;
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
          return this.handleAddonConflict(
            conversation,
            salon,
            cleanNumber,
            addonService.id,
            result.conflictBooking,
            phoneNumberId,
          );
        }
      }

      case ConversationState.ADDON_CONFLICT: {
        if (input === 'btn_addon_reschedule' || normalized.includes('reschedule')) {
          // Reschedule both services with same barber → go to date picker
          const tz = salon.timezone || 'Asia/Kolkata';
          const today = DateTime.now().setZone(tz);
          const tomorrow = today.plus({ days: 1 });
          const dayAfter = today.plus({ days: 2 });

          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: { state: ConversationState.SELECT_RESCHEDULE_DATE },
          });

          const reply = `📅 *Select a new date to reschedule both services:*`;
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
        }

        if (input === 'btn_change_stylist' || input === 'btn_addon_change_specialist' || normalized.includes('change specialist') || normalized.includes('specialist')) {
          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: { state: ConversationState.SELECT_STAFF },
          });

          const activeAppt = (conversation as any).activeAppointment || (conversation.activeAppointmentId ? await this.appointmentsService.getAppointmentById(salon.id, conversation.activeAppointmentId).catch(() => null) : null);
          const currentStylistId = activeAppt?.stylistId || conversation.selectedStaffId;
          const originalServiceId = activeAppt?.serviceId || conversation.selectedServiceId;
          const addonServiceId = conversation.pendingAddonServiceId;

          const otherQualifiedStylists = salon.stylists?.filter((st: any) => {
            if (st.id === currentStylistId) return false;
            const svcIds = st.services?.map((s: any) => s.serviceId) || [];
            const hasOriginal = !originalServiceId || svcIds.includes(originalServiceId);
            const hasAddon = !addonServiceId || svcIds.includes(addonServiceId);
            return hasOriginal && hasAddon;
          }) || salon.stylists || [];

          const listRows: InteractiveListRow[] = otherQualifiedStylists.map((st: any) => ({
            id: `staff_${st.id}`,
            title: st.name,
            description: `Qualified specialist`,
          }));

          const reply = `💇 *Select a specialist for your combined services:*`;
          await this.sendMetaMessage(
            cleanNumber,
            {
              headerText: 'Change Specialist',
              bodyText: reply,
              footerText: 'Select a specialist to see time slots',
              buttonText: '💇 Choose Specialist',
              interactiveType: 'list',
              listRows,
            },
            phoneNumberId,
          );

          return { replyMessage: reply, state: ConversationState.SELECT_STAFF };
        }

        if (input.startsWith('addon_specialist_')) {
          // Customer selected an alternative specialist → update staff and go to date selection
          const newStylistId = input.replace('addon_specialist_', '');
          const newStylist = salon.stylists?.find((st: any) => st.id === newStylistId);

          if (!newStylist) {
            const reply = `❌ Specialist not found. Please try again.`;
            await this.sendMetaMessage(cleanNumber, { textBody: reply }, phoneNumberId);
            return { replyMessage: reply, state: ConversationState.ADDON_CONFLICT };
          }

          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: {
              selectedStaffId: newStylist.id,
              state: ConversationState.SELECT_RESCHEDULE_DATE,
            },
          });

          const tz = salon.timezone || 'Asia/Kolkata';
          const today = DateTime.now().setZone(tz);
          const tomorrow = today.plus({ days: 1 });
          const dayAfter = today.plus({ days: 2 });

          const reply = `✅ Switched to *${newStylist.name}*!\n\n📅 *Select a date for your appointment:*`;
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
        }

        if (input === 'btn_addon_change_date' || normalized.includes('change date')) {
          // Change date with same barber → go to date picker
          const tz = salon.timezone || 'Asia/Kolkata';
          const today = DateTime.now().setZone(tz);
          const tomorrow = today.plus({ days: 1 });
          const dayAfter = today.plus({ days: 2 });

          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: { state: ConversationState.SELECT_RESCHEDULE_DATE },
          });

          const reply = `📅 *Select a new date for your combined services:*`;
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
        }

        if (input === 'btn_addon_keep' || input === 'btn_start' || normalized.includes('keep')) {
          // Keep original appointment as-is, clear pending add-on
          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: {
              state: ConversationState.ACTIVE_HUB,
              pendingAddonServiceId: null,
            },
          });

          // Re-enter the hub to show appointment summary
          return this.handleIncomingMessage(salon.id, cleanNumber, 'hi', undefined, phoneNumberId);
        }

        // Fallback: unrecognized input in this state
        const addonFallbackReply = 'Please tap one of the options above to continue, or type *keep* to keep your current appointment.';
        await this.sendMetaMessage(cleanNumber, { textBody: addonFallbackReply }, phoneNumberId);
        return { replyMessage: addonFallbackReply, state: ConversationState.ADDON_CONFLICT };
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
        // Build service ID(s) — if pending add-on exists, use both for combined duration
        const rescheduleServiceIds = conversation.pendingAddonServiceId
          ? [conversation.selectedServiceId, conversation.pendingAddonServiceId].filter(Boolean)
          : conversation.selectedServiceId || salon.services[0].id;

        const availability = await this.availabilityService.getAvailableSlots(
          salonId,
          rescheduleServiceIds,
          dateStr,
          conversation.selectedStaffId || undefined,
          conversation.activeAppointmentId || undefined,
        );


        if (availability.availableSlots.length === 0) {
          let reply = `⚠️ No available slots on *${targetDate.toFormat('dd LLL, EEEE')}*. Please choose another date:`;
          if (availability.status === 'SALON_CLOSED') {
            reply = `📅 We are closed on *${targetDate.toFormat('EEEE')}s*. Please choose another date:`;
          } else if (availability.status === 'FULLY_BOOKED') {
            reply = `⚠️ All slots on *${targetDate.toFormat('dd LLL, EEEE')}* are fully booked! Please choose another date:`;
          } else if (availability.status === 'STAFF_UNAVAILABLE') {
            reply = `⚠️ Our specialists are not available on *${targetDate.toFormat('dd LLL, EEEE')}*. Please choose another date:`;
          } else if (availability.status === 'NO_QUALIFIED_STAFF') {
            reply = `⚠️ This service is currently unavailable for booking. Please choose another date or service:`;
          }

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
        // Check if user clicked or typed a period filter or pagination
        let effectiveInput = cleanInput;
        if (
          (cleanInput.includes('more') || cleanInput.includes('next') || cleanInput.includes('later') || cleanInput.includes('earlier') || cleanInput.includes('back')) &&
          !cleanInput.includes('afternoon') && !cleanInput.includes('evening') && !cleanInput.includes('morning')
        ) {
          try {
            const lastOutbound = await this.prisma.whatsAppLog.findFirst({
              where: { phone: cleanNumber, direction: WhatsAppMessageDirection.OUTBOUND },
              orderBy: { createdAt: 'desc' },
            });
            if (lastOutbound?.messageText) {
              const txt = lastOutbound.messageText;
              let currentPeriod = 'afternoon';
              if (txt.includes('Evening Slots')) currentPeriod = 'evening';
              else if (txt.includes('Morning Slots')) currentPeriod = 'morning';

              const pageMatch = txt.match(/Page (\d+) of (\d+)/);
              let currentPage = pageMatch ? parseInt(pageMatch[1], 10) : 1;
              if (cleanInput.includes('earlier') || cleanInput.includes('back')) {
                currentPage = Math.max(1, currentPage - 1);
              } else {
                currentPage += 1;
              }
              effectiveInput = `rperiod_${currentPeriod}_p${currentPage}`;
            }
          } catch { }
        }

        // Period switcher in reschedule flow
        if (
          effectiveInput.startsWith('rperiod_') ||
          effectiveInput.startsWith('period_') ||
          effectiveInput.includes('morning') ||
          effectiveInput.includes('afternoon') ||
          effectiveInput.includes('evening')
        ) {
          const view = this.buildPeriodSlotView(allSlots, effectiveInput, true, dateStr);
          await this.sendMetaMessage(
            cleanNumber,
            {
              headerText: view.headerText,
              bodyText: view.bodyText,
              buttonText: '⏰ Choose Time',
              interactiveType: 'list',
              listRows: view.listRows,
            },
            phoneNumberId,
          );
          return { replyMessage: view.bodyText, state: ConversationState.SELECT_RESCHEDULE_TIME };
        }

        let selectedSlot = this.parseTimeSlot(input, availability.availableSlots);

        // If numeric input ("1", "2", etc.), check if customer was viewing a specific period
        const indexNum = parseInt(cleanInput, 10);
        if (!isNaN(indexNum) && indexNum >= 1) {
          try {
            const lastOutbound = await this.prisma.whatsAppLog.findFirst({
              where: { phone: cleanNumber, direction: WhatsAppMessageDirection.OUTBOUND },
              orderBy: { createdAt: 'desc' },
            });
            if (lastOutbound?.messageText) {
              let scopedSlots: AvailableSlotResponse[] = allSlots;
              if (lastOutbound.messageText.includes('Afternoon Slots')) {
                scopedSlots = afternoonSlots;
              } else if (lastOutbound.messageText.includes('Evening Slots')) {
                scopedSlots = eveningSlots;
              } else if (lastOutbound.messageText.includes('Morning Slots')) {
                scopedSlots = morningSlots;
              }
              if (indexNum <= scopedSlots.length) {
                selectedSlot = scopedSlots[indexNum - 1];
              }
            }
          } catch { }
        }
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
          const newAppt: any = await this.appointmentsService.rescheduleAppointment(
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

          const timeFormatted = DateTime.fromJSDate(newAppt.startAt, { zone: tz }).toFormat('hh:mm a');
          const dateFormatted = DateTime.fromJSDate(newAppt.startAt, { zone: tz }).toFormat('dd LLL, EEE');

          const reply = `✅ *Appointment Rescheduled Successfully!*\n\n• *New Date:* ${dateFormatted}\n• *New Time:* ${timeFormatted}\n• *Service:* ${newAppt.service.name}\n• *Specialist:* ${newAppt.stylist.name}\n• *New Ref:* #${newAppt.appointmentNumber}\n\nYour previous chair reservation was released. See you soon!`;
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
        if (input === '1' || input === 'btn_book' || normalized.includes('book') || input === '2' || input === 'btn_services' || normalized.includes('service') || normalized.includes('menu')) {
          if ((salon.serviceCategories || []).length > 0) {
            return this.promptCategorySelection(conversation, cleanNumber, salon, salonUser, phoneNumberId);
          } else {
            return this.promptServiceSelection(conversation, cleanNumber, salon, salonUser, phoneNumberId);
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

      case ConversationState.SELECT_CATEGORY: {
        if (input === 'btn_switch_gender' || input.startsWith('gender_select_')) {
          if (input.startsWith('gender_select_')) {
            const newGender = input.replace('gender_select_', '') as ServiceGender;
            conversation = await this.prisma.conversation.update({
              where: { id: conversation.id },
              data: { tempBookingGender: newGender },
            });
            if (salonUser && !salonUser.gender) {
              await this.prisma.salonUser.update({
                where: { id: salonUser.id },
                data: { gender: newGender },
              });
              salonUser.gender = newGender;
            }
          } else {
            return this.promptGenderSelection(conversation.id, cleanNumber, salon, phoneNumberId);
          }
          return this.promptCategorySelection(conversation, cleanNumber, salon, salonUser, phoneNumberId);
        }

        let selectedCatId: string | null = null;
        if (input.startsWith('cat_')) {
          selectedCatId = input.replace('cat_', '');
        } else {
          const effectiveGender = this.getEffectiveGender(conversation, salonUser);
          const activeServices = this.filterServicesByGender(salon.services || [], effectiveGender);
          const categoriesWithServices = (salon.serviceCategories || []).filter((cat: any) =>
            activeServices.some((s) => s.categoryId === cat.id),
          );

          const num = parseInt(input, 10);
          if (!isNaN(num) && num >= 1 && num <= categoriesWithServices.length) {
            selectedCatId = categoriesWithServices[num - 1].id;
          } else {
            const matchedCat = categoriesWithServices.find((cat: any) =>
              cat.name.toLowerCase().includes(normalized),
            );
            if (matchedCat) {
              selectedCatId = matchedCat.id;
            } else if (normalized.includes('general') || normalized.includes('uncategorized')) {
              selectedCatId = 'uncategorized';
            }
          }
        }

        if (!selectedCatId) {
          return this.promptCategorySelection(conversation, cleanNumber, salon, salonUser, phoneNumberId);
        }

        return this.promptServiceSelection(
          conversation,
          cleanNumber,
          salon,
          salonUser,
          phoneNumberId,
          selectedCatId,
        );
      }

      case ConversationState.SELECT_SERVICE: {
        if (input === 'cat_back') {
          return this.promptCategorySelection(conversation, cleanNumber, salon, salonUser, phoneNumberId);
        }

        if (input === 'btn_switch_gender' || input.startsWith('gender_select_')) {
          if (input.startsWith('gender_select_')) {
            const newGender = input.replace('gender_select_', '') as ServiceGender;
            conversation = await this.prisma.conversation.update({
              where: { id: conversation.id },
              data: { tempBookingGender: newGender },
            });
            if (salonUser && !salonUser.gender) {
              await this.prisma.salonUser.update({
                where: { id: salonUser.id },
                data: { gender: newGender },
              });
              salonUser.gender = newGender;
            }
            return this.promptServiceSelection(
              conversation,
              cleanNumber,
              salon,
              salonUser,
              phoneNumberId,
              conversation.selectedCategoryId,
            );
          } else {
            return this.promptGenderSelection(conversation.id, cleanNumber, salon, phoneNumberId);
          }
        }

        const effectiveGender = this.getEffectiveGender(conversation, salonUser);
        const activeGenderServices = this.filterServicesByGender(salon.services || [], effectiveGender);
        const targetServices = conversation.selectedCategoryId
          ? conversation.selectedCategoryId === 'uncategorized'
            ? activeGenderServices.filter((s) => !s.categoryId)
            : activeGenderServices.filter((s) => s.categoryId === conversation.selectedCategoryId)
          : activeGenderServices;

        let selectedService = null;
        if (input.startsWith('svc_')) {
          const svcId = input.replace('svc_', '');
          selectedService = targetServices.find((s) => s.id === svcId) || (salon.services || []).find((s: any) => s.id === svcId);
        } else {
          const num = parseInt(input, 10);
          if (!isNaN(num) && num >= 1 && num <= targetServices.length) {
            selectedService = targetServices[num - 1];
          } else {
            selectedService = targetServices.find((s) => s.name.toLowerCase().includes(normalized)) || (salon.services || []).find((s: any) => s.name.toLowerCase().includes(normalized));
          }
        }

        if (!selectedService) {
          return this.promptServiceSelection(
            conversation,
            cleanNumber,
            salon,
            salonUser,
            phoneNumberId,
            conversation.selectedCategoryId,
          );
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
          if (availability.status === 'NO_QUALIFIED_STAFF') {
            const selectedSvc = await this.prisma.service.findUnique({
              where: { id: conversation.selectedServiceId! },
              select: { name: true },
            });
            const svcName = selectedSvc?.name || 'Selected service';
            const reply = `⚠️ *${svcName}* is temporarily unavailable for online booking. Please choose another service:`;

            await this.prisma.conversation.update({
              where: { id: conversation.id },
              data: { state: ConversationState.SELECT_SERVICE, selectedServiceId: null },
            });

            const listRows: InteractiveListRow[] = salon.services.map((s: any) => ({
              id: `svc_${s.id}`,
              title: s.name,
              description: `₹${s.price} • ${s.durationMinutes} mins`,
            }));

            if (listRows.length > 0) {
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
            } else {
              await this.sendMetaMessage(cleanNumber, { textBody: reply }, phoneNumberId);
            }
            return { replyMessage: reply, state: ConversationState.SELECT_SERVICE };
          }

          let reply = `⚠️ Sorry, no slots available on *${targetDate.toFormat('dd LLL, EEEE')}*.`;
          if (availability.status === 'SALON_CLOSED') {
            reply = `📅 We are closed on *${targetDate.toFormat('EEEE')}s*. Please pick another date:`;
          } else if (availability.status === 'FULLY_BOOKED') {
            reply = `⚠️ All slots on *${targetDate.toFormat('dd LLL, EEEE')}* are fully booked! Please pick another date:`;
          } else if (availability.status === 'STAFF_UNAVAILABLE') {
            reply = `⚠️ Our specialists are not available on *${targetDate.toFormat('dd LLL, EEEE')}*. Please pick another date:`;
          }

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
              buttonText: '⏰ Choose Time',
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
          let reply = `⚠️ Sorry, no slots are currently available on *${targetDate}*. Please choose another date:`;
          if (availability.status === 'SALON_CLOSED') {
            reply = `📅 The salon is closed on this day. Please choose another date:`;
          } else if (availability.status === 'FULLY_BOOKED') {
            reply = `⚠️ All slots on *${targetDate}* are fully booked! Please choose another date:`;
          } else if (availability.status === 'STAFF_UNAVAILABLE') {
            reply = `⚠️ Our specialists are not available on *${targetDate}*. Please choose another date:`;
          } else if (availability.status === 'NO_QUALIFIED_STAFF') {
            reply = `⚠️ This service is currently unavailable for booking. Please choose another service:`;
          }

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
        // Check if user clicked or typed a period filter or pagination
        let effectiveInput = cleanInput;
        if (
          (cleanInput.includes('more') || cleanInput.includes('next') || cleanInput.includes('later') || cleanInput.includes('earlier') || cleanInput.includes('back')) &&
          !cleanInput.includes('afternoon') && !cleanInput.includes('evening') && !cleanInput.includes('morning')
        ) {
          try {
            const lastOutbound = await this.prisma.whatsAppLog.findFirst({
              where: { phone: cleanNumber, direction: WhatsAppMessageDirection.OUTBOUND },
              orderBy: { createdAt: 'desc' },
            });
            if (lastOutbound?.messageText) {
              const txt = lastOutbound.messageText;
              let currentPeriod = 'afternoon';
              if (txt.includes('Evening Slots')) currentPeriod = 'evening';
              else if (txt.includes('Morning Slots')) currentPeriod = 'morning';

              const pageMatch = txt.match(/Page (\d+) of (\d+)/);
              let currentPage = pageMatch ? parseInt(pageMatch[1], 10) : 1;
              if (cleanInput.includes('earlier') || cleanInput.includes('back')) {
                currentPage = Math.max(1, currentPage - 1);
              } else {
                currentPage += 1;
              }
              effectiveInput = `period_${currentPeriod}_p${currentPage}`;
            }
          } catch { }
        }

        // Check if user clicked or typed a period filter
        if (
          effectiveInput.startsWith('period_') ||
          effectiveInput.startsWith('rperiod_') ||
          effectiveInput.includes('morning') ||
          effectiveInput.includes('afternoon') ||
          effectiveInput.includes('evening')
        ) {
          const view = this.buildPeriodSlotView(allSlots, effectiveInput, false, targetDate);
          await this.sendMetaMessage(
            cleanNumber,
            {
              headerText: view.headerText,
              bodyText: view.bodyText,
              buttonText: '⏰ Choose Time',
              interactiveType: 'list',
              listRows: view.listRows,
            },
            phoneNumberId,
          );
          return { replyMessage: view.bodyText, state: ConversationState.SELECT_TIME, metadata: { slots: view.scopedSlots } };
        }

        let selectedSlot = this.parseTimeSlot(input, availability.availableSlots);

        // If numeric input ("1", "2", etc.), check if customer was viewing a specific period
        const indexNum = parseInt(cleanInput, 10);
        if (!isNaN(indexNum) && indexNum >= 1) {
          try {
            const lastOutbound = await this.prisma.whatsAppLog.findFirst({
              where: { phone: cleanNumber, direction: WhatsAppMessageDirection.OUTBOUND },
              orderBy: { createdAt: 'desc' },
            });
            if (lastOutbound?.messageText) {
              let scopedSlots: AvailableSlotResponse[] = allSlots;
              if (lastOutbound.messageText.includes('Afternoon Slots')) {
                scopedSlots = afternoonSlots;
              } else if (lastOutbound.messageText.includes('Evening Slots')) {
                scopedSlots = eveningSlots;
              } else if (lastOutbound.messageText.includes('Morning Slots')) {
                scopedSlots = morningSlots;
              }
              if (indexNum <= scopedSlots.length) {
                selectedSlot = scopedSlots[indexNum - 1];
              }
            }
          } catch { }
        }

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

        const existingCustomer = await this.prisma.user.findUnique({
          where: {
            phone: cleanNumber,
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
            const appointment: any = await this.appointmentsService.createAppointment(salonId, {
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

            const reply = `🎉 *APPOINTMENT CONFIRMED!*\n\n• Booking ID: *${appointment.appointmentNumber}*\n• Service: *${appointment.service.name}*\n• Specialist: *${appointment.stylist.name}*\n• Date: *${dateStr}*\n• Time: *${time12hStr}*\n• Amount: *₹${appointment.price}*\n\n📍 *${salon.name}*\n${salon.address || ''}\n\nWe look forward to seeing you!`;
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

  async sendStaffChatMessage(salonId: string, customerPhone: string, messageText: string) {
    const cleanNumber = this.cleanPhone(customerPhone);
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      include: { whatsappAccount: true },
    });
    if (!salon) {
      throw new NotFoundException('Salon not found.');
    }

    const phoneNumberId = salon.whatsappAccount?.phoneNumberId || 'sandbox_whatsapp_phone_id';

    try {
      await this.sendMetaMessage(
        cleanNumber,
        { bodyText: messageText },
        phoneNumberId,
        salonId,
      );
    } catch (err) {
      this.logger.warn(`[Staff Chat] Meta API send skipped/simulated: ${err.message}`);
    }

    // Record outbound log
    await this.prisma.whatsAppLog.create({
      data: {
        salonId,
        phone: cleanNumber,
        direction: 'OUTBOUND',
        messageText,
        status: 'SENT',
      },
    });

    // Pause AI bot auto-replies for 15 minutes when staff sends manual text
    const botPausedUntil = new Date(Date.now() + 15 * 60 * 1000);
    await this.prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId, customerPhone: cleanNumber } },
      create: {
        salonId,
        customerPhone: cleanNumber,
        isBotPaused: true,
        botPausedUntil,
        state: 'START',
      },
      update: {
        isBotPaused: true,
        botPausedUntil,
      },
    });

    // Emit real-time event for UI update
    this.appointmentsService.emitSalonEvent(salonId, 'APPOINTMENT_UPDATED', {
      type: 'STAFF_CHAT_MESSAGE',
      customerPhone: cleanNumber,
      messageText,
      sentAt: new Date().toISOString(),
    });

    return { success: true, message: 'Message sent cleanly to customer WhatsApp.', botPausedUntil };
  }


  async resumeBot(salonId: string, customerPhone: string) {
    const cleanNumber = this.cleanPhone(customerPhone);
    await this.prisma.conversation.updateMany({
      where: { salonId, customerPhone: cleanNumber },
      data: {
        isBotPaused: false,
        botPausedUntil: null,
      },
    });

    return { success: true, message: 'AI Bot auto-replies resumed.' };
  }

  async getChatHistory(salonId: string, customerPhone: string) {
    const cleanNumber = this.cleanPhone(customerPhone);
    const logs = await this.prisma.whatsAppLog.findMany({
      where: {
        salonId,
        phone: { contains: cleanNumber.slice(-10) },
      },

      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    const conversation = await this.prisma.conversation.findUnique({
      where: { salonId_customerPhone: { salonId, customerPhone: cleanNumber } },
    });

    return {
      logs,
      isBotPaused: conversation?.isBotPaused || false,
      botPausedUntil: conversation?.botPausedUntil || null,
    };
  }
}

