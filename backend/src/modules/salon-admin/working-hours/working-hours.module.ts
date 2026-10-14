import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { WorkingHoursPropagationEngine } from './services/working-hours-propagation.engine';
import { SalonWorkingHoursService } from './services/salon-working-hours.service';
import { StaffWorkingHoursService } from './services/staff-working-hours.service';
import { SalonWorkingHoursController } from './controllers/salon-working-hours.controller';
import { StaffWorkingHoursController } from './controllers/staff-working-hours.controller';

@Module({
  imports: [DatabaseModule, AppointmentsModule],
  controllers: [SalonWorkingHoursController, StaffWorkingHoursController],
  providers: [
    WorkingHoursPropagationEngine,
    SalonWorkingHoursService,
    StaffWorkingHoursService,
  ],
  exports: [
    WorkingHoursPropagationEngine,
    SalonWorkingHoursService,
    StaffWorkingHoursService,
  ],
})
export class WorkingHoursModule {}
