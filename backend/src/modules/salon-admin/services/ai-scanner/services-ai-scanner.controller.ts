import {
  Controller,
  Post,
  Body,
  UseGuards,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { ServicesAiScannerService } from './services-ai-scanner.service';
import { ScanMenuRequestDto } from './dto/scan-menu-request.dto';
import { BulkImportServicesDto } from './dto/bulk-import-services.dto';
import { ServicesService } from '../services.service';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../../common/guards/roles.guard';
import { Roles } from '../../../../common/decorators/roles.decorator';
import { CurrentSalonId } from '../../../../common/decorators/tenant.decorator';
import { AdminRole } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('services')
export class ServicesAiScannerController {
  private readonly logger = new Logger(ServicesAiScannerController.name);

  constructor(
    private readonly aiScannerService: ServicesAiScannerService,
    private readonly servicesService: ServicesService,
  ) {}

  /**
   * POST /api/v1/services/ai-scan
   * Accepts a base64 encoded photo of a salon menu/rate card and extracts structured services
   */
  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Post('ai-scan')
  async scanMenuCard(
    @CurrentSalonId() salonId: string,
    @Body() dto: ScanMenuRequestDto,
  ) {
    if (!dto.imageBase64) {
      throw new BadRequestException('imageBase64 is required');
    }

    this.logger.log(`[AI Scanner] Processing menu card scan for salon [${salonId}]...`);
    const services = await this.aiScannerService.scanMenuCard(dto.imageBase64, dto.mimeType);

    return {
      success: true,
      count: services.length,
      services,
    };
  }

  /**
   * POST /api/v1/services/bulk-import
   * Imports an array of reviewed/edited services into the salon catalog
   */
  @Roles(AdminRole.SALON_OWNER, AdminRole.SUPER_ADMIN)
  @Post('bulk-import')
  async bulkImportServices(
    @CurrentSalonId() salonId: string,
    @Body() dto: BulkImportServicesDto,
  ) {
    if (!dto.services || !Array.isArray(dto.services) || dto.services.length === 0) {
      throw new BadRequestException('No services provided for import.');
    }

    this.logger.log(`[Bulk Import] Importing ${dto.services.length} services for salon [${salonId}]...`);

    const imported = [];
    const errors = [];

    for (const item of dto.services) {
      try {
        const created = await this.servicesService.createService(salonId, {
          name: item.name,
          category: item.category,
          price: item.price,
          durationMinutes: item.durationMinutes,
          targetGender: item.targetGender,
          description: item.description,
        });
        imported.push(created);
      } catch (err: any) {
        this.logger.error(`Failed to import service [${item.name}]: ${err.message}`);
        errors.push({ name: item.name, error: err.message });
      }
    }

    return {
      success: true,
      importedCount: imported.length,
      failedCount: errors.length,
      services: imported,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}
