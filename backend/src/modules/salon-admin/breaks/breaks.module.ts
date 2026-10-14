import { Module, forwardRef } from '@nestjs/common';
import { SalonBreaksController } from './controllers/salon-breaks.controller';
import { StaffBreaksController } from './controllers/staff-breaks.controller';
import { SalonBreaksService } from './services/salon-breaks.service';
import { StaffBreaksService } from './services/staff-breaks.service';
import { BreakPropagationEngine } from './services/break-propagation.engine';
import { AppointmentsModule } from '../appointments/appointments.module';

@Module({
  imports: [forwardRef(() => AppointmentsModule)],
  controllers: [SalonBreaksController, StaffBreaksController],
  providers: [SalonBreaksService, StaffBreaksService, BreakPropagationEngine],
  exports: [SalonBreaksService, StaffBreaksService, BreakPropagationEngine],
})
export class BreaksModule {}
