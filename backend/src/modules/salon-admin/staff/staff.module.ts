import { Module, forwardRef } from '@nestjs/common';
import { StaffService } from './staff.service';
import { AbsenceService } from './absence.service';
import { StaffController } from './staff.controller';
import { LeaveIntervalEngine } from './engines/leave-interval.engine';
import { LeaveReassignmentEngine } from './engines/leave-reassignment.engine';
import { StylistStatusEngine } from './engines/stylist-status.engine';
import { LeaveValidationService } from './services/leave-validation.service';
import { LeaveProcessingService } from './services/leave-processing.service';
import { AppointmentsModule } from '../appointments/appointments.module';
import { AvailabilityModule } from '../availability/availability.module';
import { WhatsAppModule } from '../../channels/whatsapp/whatsapp.module';

@Module({
  imports: [
    AppointmentsModule,
    AvailabilityModule,
    forwardRef(() => WhatsAppModule),
  ],
  controllers: [StaffController],
  providers: [
    StaffService,
    AbsenceService,
    LeaveIntervalEngine,
    LeaveReassignmentEngine,
    StylistStatusEngine,
    LeaveValidationService,
    LeaveProcessingService,
  ],
  exports: [
    StaffService,
    AbsenceService,
    LeaveIntervalEngine,
    LeaveReassignmentEngine,
    StylistStatusEngine,
    LeaveValidationService,
    LeaveProcessingService,
  ],
})
export class StaffModule {}
