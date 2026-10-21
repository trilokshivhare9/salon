import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../../database/database.module';
import { PersonalProfileController } from './personal-profile.controller';
import { PersonalProfileService } from './personal-profile.service';

@Module({
  imports: [DatabaseModule],
  controllers: [PersonalProfileController],
  providers: [PersonalProfileService],
  exports: [PersonalProfileService],
})
export class PersonalProfileModule {}
