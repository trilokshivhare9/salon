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
import { TimeSlotWindowEngine } from './services/time-slot-window.engine';
import { CatalogCacheService } from './actions/shared/catalog-cache.service';
import { CheckinAction } from './actions/checkin.action';
import { AppointmentAction } from './actions/appointment.action';
import { DraftRecoveryAction } from './actions/draft-recovery.action';
import { QuickBookingAction } from './actions/quick-booking.action';
import { BookingAction } from './actions/booking.action';

@Module({
  imports: [AvailabilityModule, forwardRef(() => AppointmentsModule), QuickBookingModule],
  controllers: [WhatsAppController],
  providers: [
    WhatsAppService,
    WhatsAppWebhookQueue,
    WhatsAppSenderService,
    WhatsAppTemplateService,
    WhatsAppSessionService,
    TimeSlotWindowEngine,
    CatalogCacheService,
    CheckinAction,
    AppointmentAction,
    DraftRecoveryAction,
    QuickBookingAction,
    BookingAction,
    WhatsAppActionHandlerService,
  ],
  exports: [
    WhatsAppService,
    WhatsAppWebhookQueue,
    WhatsAppSenderService,
    WhatsAppTemplateService,
    WhatsAppSessionService,
    TimeSlotWindowEngine,
    CatalogCacheService,
    CheckinAction,
    AppointmentAction,
    DraftRecoveryAction,
    QuickBookingAction,
    BookingAction,
    WhatsAppActionHandlerService,
  ],
})
export class WhatsAppModule {}
