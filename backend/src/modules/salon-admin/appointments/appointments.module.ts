import { Module, forwardRef } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { RemindersService } from './reminders/reminders.service';
import { AppointmentEventsService } from './events/appointment-events.service';
import { CancellationService } from './cancellation/cancellation.service';
import { RescheduleService } from './reschedule/reschedule.service';
import { AppointmentCreationService } from './creation/appointment-creation.service';
import { AppointmentStatusService } from './status/appointment-status.service';
import { AppointmentAddonService } from './addons/appointment-addon.service';
import { AppointmentsController } from './appointments.controller';
import { AvailabilityModule } from '../availability/availability.module';
import { WhatsAppModule } from '../../channels/whatsapp/whatsapp.module';

@Module({
  imports: [AvailabilityModule, forwardRef(() => WhatsAppModule)],
  controllers: [AppointmentsController],
  providers: [
    AppointmentsService,
    AppointmentCreationService,
    AppointmentStatusService,
    AppointmentAddonService,
    RemindersService,
    AppointmentEventsService,
    CancellationService,
    RescheduleService,
  ],
  exports: [
    AppointmentsService,
    AppointmentCreationService,
    AppointmentStatusService,
    AppointmentAddonService,
    RemindersService,
    AppointmentEventsService,
    CancellationService,
    RescheduleService,
  ],
})
export class AppointmentsModule { }

