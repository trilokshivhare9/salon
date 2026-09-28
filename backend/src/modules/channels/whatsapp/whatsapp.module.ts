import { Module, forwardRef } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppWebhookQueue } from './queues/whatsapp-webhook.queue';
import { AvailabilityModule } from '../../salon-admin/availability/availability.module';
import { AppointmentsModule } from '../../salon-admin/appointments/appointments.module';
import { QuickBookingModule } from '../../salon-admin/quick-booking/quick-booking.module';
import { WhatsAppSenderService } from './services/whatsapp-sender.service';
import { WhatsAppTemplateService } from './services/whatsapp-template.service';
import { WhatsAppSessionService } from './services/whatsapp-session.service';
import { WhatsAppActionHandlerService } from './services/whatsapp-action-handler.service';

@Module({
  imports: [AvailabilityModule, forwardRef(() => AppointmentsModule), QuickBookingModule],
  controllers: [WhatsAppController],
  providers: [
    WhatsAppService,
    WhatsAppWebhookQueue,
    WhatsAppSenderService,
    WhatsAppTemplateService,
    WhatsAppSessionService,
    WhatsAppActionHandlerService,
  ],
  exports: [
    WhatsAppService,
    WhatsAppWebhookQueue,
    WhatsAppSenderService,
    WhatsAppTemplateService,
    WhatsAppSessionService,
    WhatsAppActionHandlerService,
  ],
})
export class WhatsAppModule {}

