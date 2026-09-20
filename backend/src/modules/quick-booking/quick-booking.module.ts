import { Module } from '@nestjs/common';
import { QuickCodeService } from './quick-code.service';
import { QuickBookingController } from './quick-booking.controller';
import { DatabaseModule } from '../../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [QuickBookingController],
  providers: [QuickCodeService],
  exports: [QuickCodeService],
})
export class QuickBookingModule {}
