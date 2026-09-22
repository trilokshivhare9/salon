import { Module, forwardRef } from '@nestjs/common';
import { SalonsService } from './salons.service';
import { SalonsController } from './salons.controller';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { AppointmentsModule } from '../appointments/appointments.module';

@Module({
  imports: [WhatsAppModule, forwardRef(() => AppointmentsModule)],
  controllers: [SalonsController],
  providers: [SalonsService],
  exports: [SalonsService],
})
export class SalonsModule {}
