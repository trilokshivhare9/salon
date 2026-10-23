import { Module, forwardRef } from '@nestjs/common';
import { StaffService } from './staff.service';
import { StaffController } from './staff.controller';
import { StylistStatusEngine } from './engines/stylist-status.engine';
import { StaffLeaveModule } from './leave/staff-leave.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { AvailabilityModule } from '../availability/availability.module';
import { WhatsAppModule } from '../../channels/whatsapp/whatsapp.module';

@Module({
  imports: [
    StaffLeaveModule,
    AppointmentsModule,
    AvailabilityModule,
    forwardRef(() => WhatsAppModule),
  ],
  controllers: [StaffController],
  providers: [
    StaffService,
    StylistStatusEngine,
  ],
  exports: [
    StaffService,
    StaffLeaveModule,
    StylistStatusEngine,
  ],
})
export class StaffModule {}
