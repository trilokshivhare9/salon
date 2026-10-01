import { Injectable, Logger, Inject, forwardRef, Optional } from '@nestjs/common';
import { AppointmentsService } from '../../../salon-admin/appointments/appointments.service';
import { WhatsAppSenderService, WhatsAppButtonId } from '../services/whatsapp-sender.service';
import { WhatsAppTemplateService } from '../services/whatsapp-template.service';
import { WhatsAppService } from '../whatsapp.service';
import { AppointmentStatus, ClientEtaStatus } from '@prisma/client';
import { ActionContext, ActionResult } from './shared/action-context';

@Injectable()
export class CheckinAction {
  private readonly logger = new Logger(CheckinAction.name);

  constructor(
    private readonly sender: WhatsAppSenderService,
    private readonly templates: WhatsAppTemplateService,
    @Inject(forwardRef(() => AppointmentsService))
    private readonly appointmentsService: AppointmentsService,
    @Inject(forwardRef(() => WhatsAppService))
    @Optional() private readonly whatsAppService?: WhatsAppService,
  ) {}

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
   * Handles Remind Confirm, On The Way, Arrived, and Running Late actions
   */
  async handle(ctx: ActionContext): Promise<ActionResult> {
    const { input, cleanNumber, phoneNumberId, salonId, conversation, activeAppointment } = ctx;
    const apptId = conversation.activeAppointmentId || activeAppointment?.id;

    this.logger.log(`[CheckinAction] Handling action="${input}" for user=${cleanNumber} apptId=${apptId}`);

    // 1. Remind Confirm (On Time)
    if (input === WhatsAppButtonId.REMIND_CONFIRM) {
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

    // 2. On The Way
    if (input === WhatsAppButtonId.ETA_ON_THE_WAY || input === 'btn_eta_on_the_way') {
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

    // 3. Arrived / Check-in
    if (input === WhatsAppButtonId.ETA_ARRIVED) {
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

    // 4. Running Late (10m or 20m)
    if (input === WhatsAppButtonId.ETA_LATE_15 || input.startsWith('late_')) {
      const minutes = input.startsWith('late_') ? parseInt(input.split('_')[1], 10) || 15 : 15;
      const etaEnum = minutes > 15 ? ClientEtaStatus.RUNNING_LATE_20M : ClientEtaStatus.RUNNING_LATE_10M;

      if (apptId) {
        await this.appointmentsService.updateEtaStatus(salonId, apptId, etaEnum);
      }
      const reply = this.templates.buildLateNotificationReply(minutes);
      await this.sendMessage(cleanNumber, reply, phoneNumberId, salonId);
      return { replyMessage: reply.bodyText, state: conversation.state };
    }

    this.logger.warn(`[CheckinAction] Unhandled checkin input "${input}"`);
    return { replyMessage: '', state: conversation.state };
  }
}
