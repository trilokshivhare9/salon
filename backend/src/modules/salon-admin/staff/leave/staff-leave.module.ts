import { Module, forwardRef } from '@nestjs/common';
import { AppointmentsModule } from '../../appointments/appointments.module';
import { AvailabilityModule } from '../../availability/availability.module';
import { WhatsAppModule } from '../../../channels/whatsapp/whatsapp.module';

// DTOs
export * from './dto';

// Engines
import { LeaveIntervalEngine } from './engines/leave-interval.engine';
import { LeaveReassignmentEngine } from './engines/leave-reassignment.engine';
import { LeaveEdgeCaseEngine } from './engines/leave-edge-case.engine';

// Services
import { ApplyLeaveService } from './services/apply-leave.service';
import { CancelLeaveService } from './services/cancel-leave.service';
import { ExtendLeaveService } from './services/extend-leave.service';
import { GetLeaveHistoryService } from './services/get-leave-history.service';
import { PreviewLeaveService } from './services/preview-leave.service';
import { LeaveNotificationService } from './services/leave-notification.service';

// Facade
import { StaffLeaveFacade } from './staff-leave.facade';

@Module({
  imports: [
    AppointmentsModule,
    AvailabilityModule,
    forwardRef(() => WhatsAppModule),
  ],
  providers: [
    LeaveIntervalEngine,
    LeaveReassignmentEngine,
    LeaveEdgeCaseEngine,
    ApplyLeaveService,
    CancelLeaveService,
    ExtendLeaveService,
    GetLeaveHistoryService,
    PreviewLeaveService,
    LeaveNotificationService,
    StaffLeaveFacade,
  ],
  exports: [
    LeaveIntervalEngine,
    LeaveReassignmentEngine,
    LeaveEdgeCaseEngine,
    ApplyLeaveService,
    CancelLeaveService,
    ExtendLeaveService,
    GetLeaveHistoryService,
    PreviewLeaveService,
    LeaveNotificationService,
    StaffLeaveFacade,
  ],
})
export class StaffLeaveModule {}
