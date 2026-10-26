import { Module, forwardRef } from '@nestjs/common';
import { QuickCodeService } from './quick-code.service';
import { QuickBookingService } from './quick-booking.service';
import { QuickBookingController } from './quick-booking.controller';
import { DatabaseModule } from '../../../database/database.module';
import { AvailabilityModule } from '../availability/availability.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { WhatsAppModule } from '../../channels/whatsapp/whatsapp.module';

@Module({
  imports: [
    DatabaseModule,
    AvailabilityModule,
    forwardRef(() => AppointmentsModule),
    forwardRef(() => WhatsAppModule),
  ],
  controllers: [QuickBookingController],
  providers: [QuickCodeService, QuickBookingService],
  exports: [QuickCodeService, QuickBookingService],
})
export class QuickBookingModule {}

