import { Module } from '@nestjs/common';
import { SalonsService } from './salons.service';
import { SalonsController } from './salons.controller';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [WhatsAppModule],
  controllers: [SalonsController],
  providers: [SalonsService],
  exports: [SalonsService],
})
export class SalonsModule {}
