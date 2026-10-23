import { Module, forwardRef } from '@nestjs/common';
import { ServicesService } from './services.service';
import { ServicesController } from './services.controller';
import { AppointmentsModule } from '../appointments/appointments.module';
import { ServicesAiScannerModule } from './ai-scanner/services-ai-scanner.module';

@Module({
  imports: [AppointmentsModule, forwardRef(() => ServicesAiScannerModule)],
  controllers: [ServicesController],
  providers: [ServicesService],
  exports: [ServicesService],
})
export class ServicesModule {}

