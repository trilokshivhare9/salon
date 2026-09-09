import { Module } from '@nestjs/common';
import { MasterCategoriesService } from './master-categories.service';
import { MasterCategoriesController } from './master-categories.controller';

@Module({
  controllers: [MasterCategoriesController],
  providers: [MasterCategoriesService],
  exports: [MasterCategoriesService],
})
export class MasterCategoriesModule {}
