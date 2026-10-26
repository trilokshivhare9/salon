import { Module, forwardRef } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { RemindersService } from './reminders/reminders.service';
import { AppointmentEventsService } from './events/appointment-events.service';
import { CancellationService } from './cancellation/cancellation.service';
import { RescheduleService } from './reschedule/reschedule.service';
import { AppointmentCreationService } from './creation/appointment-creation.service';
import { AppointmentStatusService } from './status/appointment-status.service';
import { AppointmentAddonService } from './addons/appointment-addon.service';
import { AppointmentModifierService } from './modifier/appointment-modifier.service';
import { AppointmentNextActionService } from './next-action/appointment-next-action.service';
import { AppointmentQueueService } from './queue/queue.service';
import { AppointmentsController } from './appointments.controller';
import { AvailabilityModule } from '../availability/availability.module';
import { WhatsAppModule } from '../../channels/whatsapp/whatsapp.module';
import { QuickBookingModule } from '../quick-booking/quick-booking.module';

import { ScheduleConflictResolutionEngine } from './conflicts/schedule-conflict-resolution.engine';

@Module({
  imports: [AvailabilityModule, forwardRef(() => WhatsAppModule), forwardRef(() => QuickBookingModule)],
  controllers: [AppointmentsController],
  providers: [
    AppointmentsService,
    AppointmentCreationService,
    AppointmentModifierService,
    AppointmentNextActionService,
    AppointmentStatusService,
    AppointmentAddonService,
    AppointmentQueueService,
    RemindersService,
    AppointmentEventsService,
    CancellationService,
    RescheduleService,
    ScheduleConflictResolutionEngine,
  ],
  exports: [
    AppointmentsService,
    AppointmentCreationService,
    AppointmentModifierService,
    AppointmentStatusService,
    AppointmentAddonService,
    AppointmentQueueService,
    RemindersService,
    AppointmentEventsService,
    CancellationService,
    RescheduleService,
    ScheduleConflictResolutionEngine,
  ],
})
export class AppointmentsModule { }

