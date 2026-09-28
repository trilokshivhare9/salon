import { Module } from '@nestjs/common';
import { BookingService } from './booking.service';
import { BookingController } from './booking.controller';
import { AvailabilityModule } from '../../salon-admin/availability/availability.module';
import { AppointmentsModule } from '../../salon-admin/appointments/appointments.module';

@Module({
  imports: [AvailabilityModule, AppointmentsModule],
  controllers: [BookingController],
  providers: [BookingService],
  exports: [BookingService],
})
export class BookingModule {}
