import { Module, forwardRef } from '@nestjs/common';
import { ServicesAiScannerController } from './services-ai-scanner.controller';
import { ServicesAiScannerService } from './services-ai-scanner.service';
import { ServicesModule } from '../services.module';

@Module({
  imports: [forwardRef(() => ServicesModule)],
  controllers: [ServicesAiScannerController],
  providers: [ServicesAiScannerService],
  exports: [ServicesAiScannerService],
})
export class ServicesAiScannerModule {}
