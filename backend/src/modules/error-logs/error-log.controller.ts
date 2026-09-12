import {
  Controller,
  Get,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminRole } from '@prisma/client';
import { ErrorLogService } from './error-log.service';
import { QueryErrorLogsDto, ResolveErrorLogDto } from './dto/query-error-logs.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

@ApiTags('Super Admin Error Management')
@ApiBearerAuth()
@Controller('super-admin/errors')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(AdminRole.SUPER_ADMIN)
export class ErrorLogController {
  constructor(private readonly errorLogService: ErrorLogService) {}

  @Get()
  @ApiOperation({ summary: 'List and filter system error logs (Super Admin Only)' })
  async findAll(@Query() queryDto: QueryErrorLogsDto) {
    return this.errorLogService.findAll(queryDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get complete error log details by ID (Super Admin Only)' })
  async findOne(@Param('id') id: string) {
    return this.errorLogService.findOne(id);
  }

  @Patch(':id/resolve')
  @ApiOperation({ summary: 'Mark an error as RESOLVED with resolution notes (Super Admin Only)' })
  async resolve(
    @Param('id') id: string,
    @Body() resolveDto: ResolveErrorLogDto,
    @CurrentUser() adminUser: any,
  ) {
    return this.errorLogService.resolveError(id, adminUser, resolveDto.resolutionNotes);
  }
}
