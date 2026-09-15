import { Module, forwardRef } from '@nestjs/common';
import { StaffService } from './staff.service';
import { AbsenceService } from './absence.service';
import { StaffController } from './staff.controller';
import { AppointmentsModule } from '../appointments/appointments.module';
import { AvailabilityModule } from '../availability/availability.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [
    AppointmentsModule,
    AvailabilityModule,
    forwardRef(() => WhatsAppModule),
  ],
  controllers: [StaffController],
  providers: [StaffService, AbsenceService],
  exports: [StaffService, AbsenceService],
})
export class StaffModule {}
