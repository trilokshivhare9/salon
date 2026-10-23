import { Module } from '@nestjs/common';
import { ClosuresController } from './closures.controller';
import { ClosuresService } from './closures.service';
import { HolidaysProviderService } from './holidays-provider.service';
import { DatabaseModule } from '../../../database/database.module';
import { AppointmentsModule } from '../appointments/appointments.module';

@Module({
  imports: [DatabaseModule, AppointmentsModule],
  controllers: [ClosuresController],
  providers: [ClosuresService, HolidaysProviderService],
  exports: [ClosuresService, HolidaysProviderService],
})
export class ClosuresModule {}

