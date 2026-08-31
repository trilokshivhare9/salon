import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Res,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { WhatsAppService } from './whatsapp.service';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../database/prisma.service';

@Public()
@Controller('whatsapp')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(
    private readonly whatsappService: WhatsAppService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  // Meta Cloud API Webhook Verification
  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const expectedToken =
      this.configService.get<string>('whatsapp.verifyToken') ||
      'salon_webhook_verify_token_mvp';

    try {
      const responseChallenge = this.whatsappService.verifyWebhook(
        mode,
        token,
        challenge,
        expectedToken,
      );
      return res.status(HttpStatus.OK).send(responseChallenge);
    } catch (err) {
      return res.status(HttpStatus.FORBIDDEN).send('Forbidden');
    }
  }

  // Meta Cloud API Incoming Webhook Message
  @Post('webhook')
  async handleWebhook(@Body() payload: any, @Res() res: Response) {
    try {
      // Check if entry exists in Meta payload
      const entry = payload?.entry?.[0];
      const changes = entry?.changes?.[0]?.value;
      const message = changes?.messages?.[0];
      const statuses = changes?.statuses?.[0];

      // 1. Log Delivery Status Callbacks (sent, delivered, read, failed)
      if (statuses) {
        const recipient = statuses.recipient_id;
        const status = statuses.status;
        if (status === 'failed') {
          this.logger.error(
            `[Meta Webhook] ❌ WhatsApp Delivery FAILED to ${recipient}: ${JSON.stringify(statuses.errors || statuses)}`,
          );
        } else {
          this.logger.log(`[Meta Webhook] ℹ️ WhatsApp Delivery Status for ${recipient}: ${status}`);
        }
        await this.whatsappService.recordStatusLog(statuses);
      }

      // 2. Process Incoming Messages
      if (message) {
        const fromPhone = message.from;
        const phoneNumberId = changes.metadata?.phone_number_id;

        const text =
          message.text?.body ||
          message.interactive?.button_reply?.title ||
          message.interactive?.list_reply?.title ||
          '';
        const interactiveId =
          message.interactive?.button_reply?.id || message.interactive?.list_reply?.id;
        const normalizedText = text.trim().toLowerCase();

        this.logger.log(
          `[Meta Webhook] 📩 Incoming message from ${fromPhone} [PhoneId: ${phoneNumberId}]: "${text}" (interactiveId: ${interactiveId || 'none'})`,
        );

        let salon: any = null;

        // 1. Direct Phone ID Routing: Resolve target salon by the WhatsApp Phone ID the customer messaged
        if (phoneNumberId) {
          salon = await this.prisma.salon.findFirst({
            where: {
              whatsappAccount: { phoneNumberId },
            },
          });
        }

        // 2. Keyword/Slug Routing: If customer sends "BOOK <slug>" or "Hi <slug>"
        if (!salon && (normalizedText.startsWith('book ') || normalizedText.startsWith('hi '))) {
          const requestedSlug = normalizedText.replace(/^(book|hi)\s+/i, '').trim();
          salon = await this.prisma.salon.findFirst({
            where: {
              OR: [
                { slug: requestedSlug },
                { name: { contains: requestedSlug, mode: 'insensitive' } },
              ],
            },
          });
        }

        // 3. Ongoing Active Conversation fallback
        if (!salon) {
          const cleanFrom = fromPhone.replace(/[^\d+]/g, '');
          const existingConv = await this.prisma.conversation.findFirst({
            where: {
              customerPhone: { in: [cleanFrom, fromPhone, cleanFrom.replace('+', '')] },
            },
            orderBy: { updatedAt: 'desc' },
            include: { salon: true },
          });

          if (existingConv && existingConv.salon?.status === 'ACTIVE') {
            salon = existingConv.salon;
          }
        }

        // 4. Default Fallback to pilot salon
        if (!salon) {
          salon = await this.prisma.salon.findFirst({ where: { status: 'ACTIVE' } });
        }

        // Persist Inbound Log to database
        await this.whatsappService.recordInboundLog(
          salon?.id || null,
          fromPhone,
          text,
          interactiveId,
          payload,
        );

        if (salon) {
          this.logger.log(`[Meta Webhook] 🏢 Routed message to salon: "${salon.name}" (${salon.id})`);
          await this.whatsappService.handleIncomingMessage(
            salon.id,
            fromPhone,
            text,
            interactiveId,
            phoneNumberId,
          );
        } else {
          this.logger.warn(`[Meta Webhook] ⚠️ No active salon found to process incoming message from ${fromPhone}`);
        }
      }

      return res.status(HttpStatus.OK).send('EVENT_RECEIVED');
    } catch (err) {
      this.logger.error('[Meta Webhook] Error processing Meta Webhook payload:', err);
      return res.status(HttpStatus.OK).send('EVENT_RECEIVED');
    }
  }

  // Built-in Web Simulator Endpoint (Allows instant testing in browser!)
  @Post('simulate')
  async simulateMessage(
    @Body()
    body: {
      salonSlug: string;
      customerPhone: string;
      messageText: string;
      interactiveId?: string;
    },
  ) {
    const salon = await this.prisma.salon.findUnique({
      where: { slug: body.salonSlug || 'glamour-studio' },
    });

    if (!salon) {
      return {
        replyMessage: 'Salon not found.',
        state: 'START',
      };
    }

    return this.whatsappService.handleIncomingMessage(
      salon.id,
      body.customerPhone || '+919811122233',
      body.messageText || 'Hi',
      body.interactiveId,
    );
  }

  // -------------------------------------------------------------
  // DATABASE AUDIT LOGS ENDPOINT (Check any phone number from DB!)
  // -------------------------------------------------------------
  @Get('logs')
  async getLogs(
    @Query('phone') phone?: string,
    @Query('salonId') salonId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.whatsappService.getLogs({
      phone,
      salonId,
      limit: limit ? parseInt(limit, 10) : 50,
    });
  }

  // -------------------------------------------------------------
  // REAL-WORLD META EMBEDDED SIGNUP & MANAGEMENT API
  // -------------------------------------------------------------
  @Get('status')
  async getStatus(@Query('salonId') salonId?: string) {
    let targetSalonId = salonId;
    if (!targetSalonId) {
      const firstSalon = await this.prisma.salon.findFirst({ where: { status: 'ACTIVE' } });
      targetSalonId = firstSalon?.id || '';
    }
    return this.whatsappService.getSalonWhatsAppStatus(targetSalonId);
  }

  @Post('embedded-signup/connect')
  async connectEmbeddedSignup(
    @Body()
    body: {
      salonId: string;
      phoneNumberId: string;
      wabaId?: string;
      displayPhoneNumber?: string;
      code?: string;
    },
  ) {
    return this.whatsappService.connectSalonWhatsApp(body.salonId, body);
  }

  @Post('disconnect')
  async disconnect(@Body() body: { salonId: string }) {
    return this.whatsappService.disconnectSalonWhatsApp(body.salonId);
  }
}

