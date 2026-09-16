import { Module } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { AvailabilityEngineService } from './availability-engine.service';

@Module({
  providers: [AvailabilityService, AvailabilityEngineService],
  exports: [AvailabilityService, AvailabilityEngineService],
})
export class AvailabilityModule {}
