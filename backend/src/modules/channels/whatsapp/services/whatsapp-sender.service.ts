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
  CHANGE_TIME = 'btn_change_time',
  CHANGE_DATE = 'btn_change_date',

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
  CANCEL_PENDING_QUICK = 'btn_cancel_pending_quick',

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

  // Incomplete Booking & Stale Action Recovery
  RESUME_BOOKING = 'btn_resume_booking',
  CHECK_LAST_BOOKING = 'btn_last_booking',
  NEW_BOOKING = 'btn_new_booking',

  // Post-Service Review & Feedback
  FEEDBACK_GREAT = 'btn_feedback_great',
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

  // In-memory cache for salon WhatsApp account credentials (5 min TTL)
  private readonly accountCache = new Map<string, { account: any; cachedAt: number }>();
  private readonly ACCOUNT_CACHE_TTL_MS = 5 * 60 * 1000;
  private readonly MAX_ACCOUNT_CACHE_SIZE = 500;

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) { }

  public invalidateAccountCache(salonId: string): void {
    this.accountCache.delete(salonId);
  }

  private async getCachedAccount(salonId: string): Promise<any> {
    const now = Date.now();
    const entry = this.accountCache.get(salonId);
    if (entry && now - entry.cachedAt < this.ACCOUNT_CACHE_TTL_MS) {
      return entry.account ? { ...entry.account } : null;
    }

    const acc = await this.prisma.whatsAppAccount.findFirst({
      where: { salonId, isActive: true },
    });

    if (this.accountCache.size >= this.MAX_ACCOUNT_CACHE_SIZE) {
      const oldestKey = this.accountCache.keys().next().value;
      if (oldestKey) this.accountCache.delete(oldestKey);
    }

    this.accountCache.set(salonId, { account: acc, cachedAt: now });
    return acc ? { ...acc } : null;
  }

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
      sections?: { title: string; rows: InteractiveListRow[] }[];
    },
    phoneNumberId?: string,
    salonId?: string,
  ): Promise<boolean> {
    let accessToken =
      this.configService.get<string>('whatsapp.accessToken') ||
      process.env.WHATSAPP_ACCESS_TOKEN;
    let phoneId =
      phoneNumberId ||
      this.configService.get<string>('whatsapp.phoneNumberId');

    if (salonId) {
      const acc = await this.getCachedAccount(salonId);
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
      this.prisma.whatsAppLog
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
        .catch(() => { });
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
        .catch(() => { });
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
            buttons: (() => {
              const seenIds = new Set<string>();
              return payload.buttons.slice(0, 3).map((b: any, idx: number) => {
                let id = String(b.id || `btn_${idx}`);
                if (seenIds.has(id)) {
                  this.logger.warn(
                    `[WhatsAppSenderService] Protocol Defense Guard: Duplicate button id "${id}" detected at index ${idx}. Auto-sanitizing to avoid Meta #131009 rejection.`,
                  );
                  id = `${id}_${idx + 1}`;
                }
                seenIds.add(id);
                return {
                  type: 'reply',
                  reply: {
                    id: id.slice(0, 256),
                    title: String(b.title || '').slice(0, 20),
                  },
                };
              });
            })(),
          },
        };
      } else if (
        payload.interactiveType === 'list' &&
        ((payload.sections && payload.sections.length > 0) || (payload.listRows && payload.listRows.length > 0))
      ) {
        let sectionsData: any[] = [];
        if (payload.sections && payload.sections.length > 0) {
          let totalRows = 0;
          for (const sec of payload.sections) {
            if (totalRows >= 10) break;
            const remaining = 10 - totalRows;
            const rowsToTake = (sec.rows || []).slice(0, remaining);
            if (rowsToTake.length > 0) {
              sectionsData.push({
                title: (sec.title || 'Available Options').slice(0, 24),
                rows: rowsToTake.map((r: any) => ({
                  id: String(r.id).slice(0, 200),
                  title: String(r.title).slice(0, 24),
                  description: r.description ? String(r.description).slice(0, 72) : undefined,
                })),
              });
              totalRows += rowsToTake.length;
            }
          }
        } else if (payload.listRows && payload.listRows.length > 0) {
          sectionsData = [
            {
              title: 'Available Options',
              rows: payload.listRows.slice(0, 10).map((r: any) => ({
                id: String(r.id).slice(0, 200),
                title: String(r.title).slice(0, 24),
                description: r.description ? String(r.description).slice(0, 72) : undefined,
              })),
            },
          ];
        }

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
            sections: sectionsData,
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
          Connection: 'keep-alive',
        },
        body: JSON.stringify(bodyData),
        keepalive: true,
        signal: AbortSignal.timeout(6000),
      });

      const resJson: any = await response.json();

      if (!response.ok) {
        this.logger.error(
          `Meta WhatsApp API error (${response.status}): ${JSON.stringify(resJson)}`,
        );
        setImmediate(() => {
          this.prisma.whatsAppLog
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
            .catch(() => { });
        });
        return false;
      }

      const metaMsgId = resJson?.messages?.[0]?.id || null;

      // Fully detached async log write so outbound dispatch returns instantly to user
      setImmediate(() => {
        this.prisma.whatsAppLog
          .create({
            data: {
              salonId: salonId || null,
              phone: cleanTo,
              direction: WhatsAppMessageDirection.OUTBOUND,
              messageText: payload.bodyText || payload.textBody || '',
              interactiveId: payload.interactiveType || null,
              status: 'SENT',
              rawPayload: resJson,
              metaMessageId: metaMsgId,
            },
          })
          .catch((err) => {
            this.logger.warn(`Failed to write outbound audit log: ${err.message}`);
          });
      });

      return true;
    } catch (err: any) {
      this.logger.error(`Exception dispatching Meta WhatsApp message: ${err.message}`, err.stack);
      return false;
    }
  }

  /**
   * Dispatches a pre-approved Meta WhatsApp Template message.
   * Required for business-initiated notifications outside the 24-hour customer service window
   * (e.g. notifications sent to Salon Owners or Desk Managers).
   */
  async sendTemplateMessage(
    toPhone: string,
    templateName: string,
    parameters: Array<{ type: 'text'; text: string }> = [],
    languageCode = 'en',
    phoneNumberId?: string,
    salonId?: string,
  ): Promise<boolean> {
    let accessToken =
      this.configService.get<string>('whatsapp.accessToken') ||
      process.env.WHATSAPP_ACCESS_TOKEN;
    let phoneId =
      phoneNumberId ||
      this.configService.get<string>('whatsapp.phoneNumberId');

    if (salonId) {
      const acc = await this.getCachedAccount(salonId);
      if (acc) {
        if (acc.phoneNumberId) phoneId = acc.phoneNumberId;
        if (acc.accessTokenEncrypted && acc.accessTokenEncrypted !== 'system_managed') {
          accessToken = acc.accessTokenEncrypted;
        }
      }
    }

    const cleanTo = this.cleanPhone(toPhone);

    if (!phoneId || !accessToken) {
      this.logger.warn(
        `[WhatsAppSenderService] Cannot send WhatsApp template to ${toPhone}: Missing phoneId or accessToken.`,
      );
      return false;
    }

    try {
      const url = `https://graph.facebook.com/v20.0/${phoneId}/messages`;
      const bodyData: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: cleanTo.replace('+', ''),
        type: 'template',
        template: {
          name: templateName,
          language: { code: languageCode },
          components: parameters.length > 0 ? [
            {
              type: 'body',
              parameters,
            },
          ] : undefined,
        },
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Connection: 'keep-alive',
        },
        body: JSON.stringify(bodyData),
        keepalive: true,
        signal: AbortSignal.timeout(6000),
      });

      const resJson: any = await response.json();

      if (!response.ok) {
        this.logger.error(
          `Meta WhatsApp Template API error (${response.status}): ${JSON.stringify(resJson)}`,
        );
        setImmediate(() => {
          this.prisma.whatsAppLog
            .create({
              data: {
                salonId: salonId || null,
                phone: cleanTo,
                direction: WhatsAppMessageDirection.OUTBOUND,
                messageText: `[TEMPLATE: ${templateName}]`,
                status: 'FAILED',
                errorMessage: JSON.stringify(resJson),
              },
            })
            .catch(() => {});
        });
        return false;
      }

      const metaMsgId = resJson?.messages?.[0]?.id || null;
      setImmediate(() => {
        this.prisma.whatsAppLog
          .create({
            data: {
              salonId: salonId || null,
              phone: cleanTo,
              direction: WhatsAppMessageDirection.OUTBOUND,
              messageText: `[TEMPLATE: ${templateName}]`,
              status: 'SENT',
              rawPayload: resJson,
              metaMessageId: metaMsgId,
            },
          })
          .catch(() => {});
      });

      return true;
    } catch (err: any) {
      this.logger.error(`Exception dispatching Meta WhatsApp template: ${err.message}`, err.stack);
      return false;
    }
  }
}
