import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
  Optional,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../database/prisma.service';
import { WhatsAppMessageDirection, ConversationState, WhatsAppMessageStatus } from '@prisma/client';
import { AvailabilityService } from '../../salon-admin/availability/availability.service';
import { AppointmentsService } from '../../salon-admin/appointments/appointments.service';
import { CancellationService } from '../../salon-admin/appointments/cancellation/cancellation.service';
import { RescheduleService } from '../../salon-admin/appointments/reschedule/reschedule.service';
import { QuickCodeService } from '../../salon-admin/quick-booking/quick-code.service';
import { WhatsAppSenderService, InteractiveButton, InteractiveListRow } from './services/whatsapp-sender.service';
import { WhatsAppTemplateService } from './services/whatsapp-template.service';
import { WhatsAppSessionService, BookingLifecycleStage } from './services/whatsapp-session.service';
import { WhatsAppActionHandlerService } from './services/whatsapp-action-handler.service';

export { BookingLifecycleStage, InteractiveButton, InteractiveListRow };

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    @Optional() private availabilityService?: AvailabilityService,
    @Inject(forwardRef(() => AppointmentsService))
    @Optional() private appointmentsService?: AppointmentsService,
    @Inject(forwardRef(() => CancellationService))
    @Optional() private cancellationService?: CancellationService,
    @Inject(forwardRef(() => RescheduleService))
    @Optional() private rescheduleService?: RescheduleService,
    @Optional() private quickCodeService?: QuickCodeService,
    @Optional() private whatsAppSenderService?: WhatsAppSenderService,
    @Optional() private whatsAppTemplateService?: WhatsAppTemplateService,
    @Optional() private whatsAppSessionService?: WhatsAppSessionService,
    @Optional() private whatsAppActionHandlerService?: WhatsAppActionHandlerService,
  ) {
    if (!this.whatsAppSenderService) {
      this.whatsAppSenderService = new WhatsAppSenderService(this.prisma, this.configService);
    }
    (this.whatsAppSenderService as any).whatsAppService = this;
    if (!this.whatsAppTemplateService) {
      this.whatsAppTemplateService = new WhatsAppTemplateService();
    }
    if (!this.whatsAppSessionService) {
      this.whatsAppSessionService = new WhatsAppSessionService(this.prisma, this.whatsAppSenderService, this.whatsAppTemplateService);
    }
    if (!this.whatsAppActionHandlerService) {
      this.whatsAppActionHandlerService = new WhatsAppActionHandlerService(
        this.prisma,
        this.whatsAppSenderService,
        this.whatsAppTemplateService,
        this.whatsAppSessionService,
        this.availabilityService as any,
        this.quickCodeService as any,
        this.appointmentsService as any,
        this.cancellationService || (this.appointmentsService as any)?.cancellationService,
        this.rescheduleService || (this.appointmentsService as any)?.rescheduleService,
        this,
      );
    }
    if (this.whatsAppActionHandlerService) {
      this.whatsAppActionHandlerService.setWhatsAppService(this);
    }
    if (this.whatsAppSenderService) {
      (this.whatsAppSenderService as any).whatsAppService = this;
    }
  }

  // 1. Verify Webhook Handshake for Meta
  verifyWebhook(mode: string, token: string, challenge: string, expectedToken: string): string {
    if (mode === 'subscribe' && token === expectedToken) {
      this.logger.log('Meta WhatsApp Webhook successfully verified.');
      return challenge;
    }
    throw new BadRequestException('Webhook verification token mismatch.');
  }

  // 2. Outbound Dispatch to Meta Cloud API (Delegates 100% to WhatsAppSenderService)
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
  ): Promise<boolean> {
    if (this.whatsAppSenderService) {
      (this.whatsAppSenderService as any).whatsAppService = this;
    }
    return this.whatsAppSenderService.sendMetaMessage(toPhone, payload, phoneNumberId, salonId);
  }

  // 3. Core Action Handler (Delegates 100% to WhatsAppActionHandlerService)
  async handleIncomingMessage(
    salonId: string,
    customerPhone: string,
    messageText: string,
    interactiveId?: string,
    phoneNumberId?: string,
  ): Promise<{ replyMessage: string; state: ConversationState; metadata?: any }> {
    if (this.whatsAppActionHandlerService) {
      this.whatsAppActionHandlerService.setWhatsAppService(this);
      return this.whatsAppActionHandlerService.handleIncomingAction(
        salonId,
        customerPhone,
        messageText,
        interactiveId,
        phoneNumberId,
      );
    }
    const cleanNumber = this.whatsAppSenderService.cleanPhone(customerPhone);
    const reply = 'Action processed';
    return { replyMessage: reply, state: ConversationState.START };
  }

  async handleServiceChosen(
    conversationId: string,
    customerPhone: string,
    salon: any,
    service: any,
    phoneNumberId?: string,
  ) {
    if (this.whatsAppActionHandlerService) {
      this.whatsAppActionHandlerService.setWhatsAppService(this);
      return this.whatsAppActionHandlerService.handleServiceChosen(
        conversationId,
        customerPhone,
        salon,
        service,
        phoneNumberId,
      );
    }
    return { replyMessage: 'Service chosen', state: ConversationState.SELECT_SERVICE };
  }

  // 4. Inbound Logging & Status Callbacks
  async recordInboundLog(
    salonId: string | null,
    phone: string,
    messageText: string,
    interactiveId?: string,
    rawPayload?: any,
    metaMessageId?: string,
  ) {
    const cleanPhone = this.whatsAppSenderService.cleanPhone(phone);
    setImmediate(() => {
      this.prisma.whatsAppLog
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
    });
  }

  async recordStatusLog(statusObj: any) {
    const recipient = this.whatsAppSenderService.cleanPhone(statusObj.recipient_id || '');
    const metaMessageId: string | null = statusObj.id || null;
    const rawStatus = (statusObj.status || '').toLowerCase();
    const error = statusObj.errors?.[0];

    const status: WhatsAppMessageStatus =
      rawStatus === 'failed'
        ? WhatsAppMessageStatus.FAILED
        : WhatsAppMessageStatus.SENT;

    const errorCode = error?.code ? parseInt(String(error.code), 10) || null : null;
    const errorMessage = error?.title || error?.message || null;

    try {
      if (metaMessageId) {
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
      const clean = this.whatsAppSenderService.cleanPhone(filter.phone);
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

  // 5. Salon WhatsApp Account Management & Staff Chat
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

    await this.prisma.whatsAppAccount.upsert({
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

    if (this.whatsAppSenderService) {
      this.whatsAppSenderService.invalidateAccountCache(salonId);
    }
    if (this.whatsAppActionHandlerService) {
      this.whatsAppActionHandlerService.invalidateSalonCatalog(salonId);
    }
    if (this.availabilityService) {
      this.availabilityService.invalidateSalonScheduleCache(salonId);
    }

    return this.getSalonWhatsAppStatus(salonId);
  }

  public invalidateAccountCache(salonId: string): void {
    if (this.whatsAppSenderService) {
      this.whatsAppSenderService.invalidateAccountCache(salonId);
    }
  }

  public invalidateSalonCatalog(salonId: string): void {
    if (this.whatsAppActionHandlerService) {
      this.whatsAppActionHandlerService.invalidateSalonCatalog(salonId);
    }
    if (this.availabilityService) {
      this.availabilityService.invalidateSalonScheduleCache(salonId);
    }
  }

  async disconnectSalonWhatsApp(salonId: string) {
    const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
    if (!salon) throw new NotFoundException('Salon not found.');

    await this.prisma.whatsAppAccount.deleteMany({ where: { salonId } });

    if (this.whatsAppSenderService) {
      this.whatsAppSenderService.invalidateAccountCache(salonId);
    }
    if (this.whatsAppActionHandlerService) {
      this.whatsAppActionHandlerService.invalidateSalonCatalog(salonId);
    }
    if (this.availabilityService) {
      this.availabilityService.invalidateSalonScheduleCache(salonId);
    }

    return this.getSalonWhatsAppStatus(salonId);
  }

  async sendStaffChatMessage(salonId: string, customerPhone: string, messageText: string) {
    const cleanNumber = this.whatsAppSenderService.cleanPhone(customerPhone);
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
    } catch (err: any) {
      this.logger.warn(`[Staff Chat] Meta API send skipped/simulated: ${err?.message || err}`);
    }

    await this.prisma.whatsAppLog.create({
      data: {
        salonId,
        phone: cleanNumber,
        direction: WhatsAppMessageDirection.OUTBOUND,
        messageText,
        status: 'SENT',
      },
    });

    const botPausedUntil = new Date(Date.now() + 15 * 60 * 1000);
    await this.prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId, customerPhone: cleanNumber } },
      create: {
        salonId,
        customerPhone: cleanNumber,
        isBotPaused: true,
        botPausedUntil,
        state: ConversationState.START,
      },
      update: {
        isBotPaused: true,
        botPausedUntil,
      },
    });

    if (this.appointmentsService) {
      this.appointmentsService.emitSalonEvent(salonId, 'APPOINTMENT_UPDATED', {
        type: 'STAFF_CHAT_MESSAGE',
        customerPhone: cleanNumber,
        messageText,
        sentAt: new Date().toISOString(),
      });
    }

    return { success: true, message: 'Message sent cleanly to customer WhatsApp.', botPausedUntil };
  }

  async resumeBot(salonId: string, customerPhone: string) {
    const cleanNumber = this.whatsAppSenderService.cleanPhone(customerPhone);
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
    const cleanNumber = this.whatsAppSenderService.cleanPhone(customerPhone);
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
