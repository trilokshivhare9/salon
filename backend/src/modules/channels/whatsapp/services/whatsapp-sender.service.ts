import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../../database/prisma.service';
import { WhatsAppMessageDirection } from '@prisma/client';

export enum WhatsAppButtonId {
  // Navigation
  START = 'btn_start',
  MENU = 'btn_menu',
  INFO = 'btn_info',
  SERVICES = 'btn_services',
  BOOK = 'btn_book',
  BOOK_NOW = 'btn_book_now',
  SWITCH_GENDER = 'btn_switch_gender',
  ADD_SERVICE = 'btn_add_service',
  CAT_BACK = 'cat_back',
  STAFF_ANY = 'staff_any',

  // Quick Booking
  QUICK_BOOK = 'btn_quick_book',
  CONFIRM_QUICK = 'btn_confirm_quick',

  // Confirmation
  CONFIRM_YES = 'btn_confirm_yes',
  CONFIRM_NO = 'btn_confirm_no',
  CONFIRM = 'btn_confirm',

  // Cancellation
  CANCEL_APPT = 'btn_cancel_appt',
  CANCEL_YES = 'btn_cancel_yes',
  CANCEL_NO = 'btn_cancel_no',
  ETA_CANCEL = 'btn_eta_cancel',

  // Reschedule & Proposed Reschedule
  RESCHEDULE = 'btn_reschedule',
  PROPOSE_ACCEPT_PREFIX = 'propose_accept_',
  PROPOSE_DECLINE_PREFIX = 'propose_decline_',

  // Check-In & ETA
  ETA_ARRIVED = 'btn_eta_arrived',
  ETA_LATE_15 = 'btn_eta_late_15',
  ETA_ON_THE_WAY = 'btn_eta_on_the_way',

  // Reminders
  REMIND_CONFIRM = 'remind_confirm',
  REMIND_CANCEL = 'remind_cancel',
  REMIND_RESCHEDULE = 'remind_reschedule',
}

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
export class WhatsAppSenderService {
  private readonly logger = new Logger(WhatsAppSenderService.name);
  public whatsAppService?: any;
  private _isDispatching = false;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  cleanPhone(phone: string): string {
    return phone.replace(/[^\d+]/g, '');
  }

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
    if (
      this.whatsAppService &&
      typeof this.whatsAppService.sendMetaMessage === 'function' &&
      !this._isDispatching
    ) {
      this._isDispatching = true;
      try {
        return await this.whatsAppService.sendMetaMessage(toPhone, payload, phoneNumberId, salonId);
      } finally {
        this._isDispatching = false;
      }
    }

    let accessToken =
      this.configService.get<string>('whatsapp.accessToken') ||
      process.env.WHATSAPP_ACCESS_TOKEN;
    let phoneId =
      phoneNumberId ||
      this.configService.get<string>('whatsapp.phoneNumberId');

    if (salonId) {
      const acc = await this.prisma.whatsAppAccount.findFirst({
        where: { salonId, isActive: true },
      });
      if (acc) {
        if (acc.phoneNumberId) phoneId = acc.phoneNumberId;
        if (acc.accessTokenEncrypted && acc.accessTokenEncrypted !== 'system_managed') {
          accessToken = acc.accessTokenEncrypted;
        }
      }
    }

    const cleanTo = this.cleanPhone(toPhone);

    if (!phoneId) {
      this.logger.warn(
        `[WhatsAppSenderService] Cannot send WhatsApp message to ${toPhone}: No Phone ID for salon (${salonId || 'unspecified'}).`,
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
            errorMessage: 'No WhatsApp Phone ID registered for this salon in DB.',
          },
        })
        .catch(() => {});
      return false;
    }

    if (!accessToken) {
      this.logger.warn(
        `[WhatsAppSenderService] Cannot send WhatsApp message to ${toPhone}: Access token missing.`,
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
            errorMessage: 'WHATSAPP_ACCESS_TOKEN is missing.',
          },
        })
        .catch(() => {});
      return false;
    }

    try {
      const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
      let bodyData: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toPhone.replace('+', ''),
      };

      if (payload.interactiveType === 'button' && payload.buttons && payload.buttons.length > 0) {
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
      } else if (
        payload.interactiveType === 'list' &&
        payload.listRows &&
        payload.listRows.length > 0
      ) {
        bodyData.type = 'interactive';
        bodyData.interactive = {
          type: 'list',
          header: payload.headerText
            ? { type: 'text', text: payload.headerText.slice(0, 60) }
            : undefined,
          body: { text: payload.bodyText || 'Please select from the menu:' },
          footer: payload.footerText ? { text: payload.footerText } : undefined,
          action: {
            button: (payload.buttonText || 'View Options').slice(0, 20),
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
        bodyData.type = 'text';
        bodyData.text = {
          body: payload.textBody || payload.bodyText || '',
        };
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bodyData),
      });

      const resJson: any = await response.json();

      if (!response.ok) {
        this.logger.error(
          `Meta WhatsApp API error (${response.status}): ${JSON.stringify(resJson)}`,
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
              errorMessage: JSON.stringify(resJson),
            },
          })
          .catch(() => {});
        return false;
      }

      const metaMsgId = resJson?.messages?.[0]?.id || null;

      await this.prisma.whatsAppLog
        .create({
          data: {
            salonId: salonId || null,
            phone: cleanTo,
            direction: WhatsAppMessageDirection.OUTBOUND,
            messageText: payload.bodyText || payload.textBody || '',
            interactiveId: payload.interactiveType || null,
            status: 'SENT',
            rawPayload: resJson,
          },
        })
        .catch(() => {});

      return true;
    } catch (err: any) {
      this.logger.error(`Exception dispatching Meta WhatsApp message: ${err.message}`, err.stack);
      return false;
    }
  }
}
