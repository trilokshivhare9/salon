import { Module, forwardRef } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { AppointmentsController } from './appointments.controller';
import { AvailabilityModule } from '../availability/availability.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [AvailabilityModule, forwardRef(() => WhatsAppModule)],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
