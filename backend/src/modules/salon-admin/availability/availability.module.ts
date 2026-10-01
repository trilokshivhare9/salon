import { Module } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { AvailabilityEngineService } from './availability-engine.service';
import { SlotSqueezePolicy } from './policies/slot-squeeze.policy';

@Module({
  providers: [AvailabilityService, AvailabilityEngineService, SlotSqueezePolicy],
  exports: [AvailabilityService, AvailabilityEngineService, SlotSqueezePolicy],
})
export class AvailabilityModule {}
