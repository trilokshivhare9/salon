import { Module } from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { AvailabilityEngineService } from './availability-engine.service';
import { SlotSqueezePolicy } from './policies/slot-squeeze.policy';
import { StylistStatusEngine } from '../staff/engines/stylist-status.engine';

@Module({
  providers: [AvailabilityService, AvailabilityEngineService, SlotSqueezePolicy, StylistStatusEngine],
  exports: [AvailabilityService, AvailabilityEngineService, SlotSqueezePolicy, StylistStatusEngine],
})
export class AvailabilityModule {}
