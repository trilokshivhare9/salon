import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ErrorStatus, ErrorSeverity, Prisma } from '@prisma/client';
import { SanitizationUtility } from '../../common/utils/sanitization.utility';
import { QueryErrorLogsDto } from './dto/query-error-logs.dto';
import * as crypto from 'crypto';

export interface LogErrorOptions {
  error: any;
  request?: any;
  customMessage?: string;
  severity?: ErrorSeverity;
  moduleName?: string;
  controllerName?: string;
  handlerName?: string;
}

@Injectable()
export class ErrorLogService {
  private readonly logger = new Logger(ErrorLogService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Centralized Fail-Safe Asynchronous Error Recording Engine.
   * Never throws or throws errors back to caller flow.
   */
  async logError(options: LogErrorOptions): Promise<void> {
    try {
      const { error, request, customMessage, severity: overrideSeverity, moduleName, controllerName, handlerName } = options;

      const rawMessage = customMessage || error?.message || (typeof error === 'string' ? error : 'Unknown Application Error');
      const errorType = error?.constructor?.name || error?.name || 'ApplicationError';
      const stackTrace = error?.stack || null;

      // Extract origin location from stack trace if available
      let originFile = null;
      if (stackTrace) {
        const stackLines = stackTrace.split('\n');
        const appLine = stackLines.find((line: string) => line.includes('/src/') && !line.includes('node_modules'));
        if (appLine) {
          originFile = appLine.trim();
        }
      }

      // Request Details
      const httpMethod = request?.method || 'INTERNAL';
      const endpoint = request?.originalUrl || request?.url || 'INTERNAL_TASK';
      const statusCode = error?.status || error?.statusCode || 500;
      const correlationId = request?.correlationId || request?.headers?.['x-correlation-id'] || null;

      // Sanitized Payloads
      const sanitizedHeaders = request?.headers ? SanitizationUtility.sanitize(request.headers) : null;
      const sanitizedQueryParams = request?.query ? SanitizationUtility.sanitize(request.query) : null;
      const sanitizedRequestBody = request?.body ? SanitizationUtility.sanitize(request.body) : null;

      // User & Multi-Tenant Context
      const user = request?.user || null;
      const userId = user?.id || user?.sub || null;
      const userRole = user?.role || null;
      const userEmail = user?.email || null;
      const isSuperAdmin = userRole === 'SUPER_ADMIN';

      const salonId = request?.tenantSalonId || user?.salonId || null;
      let salonName = user?.salon?.name || null;

      if (salonId && !salonName) {
        const salon = await this.prisma.salon.findUnique({
          where: { id: salonId },
          select: { name: true },
        }).catch(() => null);
        if (salon) salonName = salon.name;
      }

      // Calculate Error Fingerprint (SHA-256 hash of errorType + endpoint + originFile/message)
      const fingerprintContent = `${errorType}:${httpMethod}:${endpoint}:${originFile || rawMessage.slice(0, 100)}`;
      const fingerprint = crypto.createHash('sha256').update(fingerprintContent).digest('hex');

      // Determine Severity
      let severity: ErrorSeverity = overrideSeverity || ErrorSeverity.HIGH;
      if (statusCode >= 500 || errorType.includes('Prisma') || errorType.includes('Database')) {
        severity = ErrorSeverity.CRITICAL;
      }

      // Deduplication Window: Check if same fingerprint exists UNRESOLVED within last 15 mins
      const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
      const existingUnresolved = await this.prisma.errorLog.findFirst({
        where: {
          fingerprint,
          status: ErrorStatus.UNRESOLVED,
          updatedAt: { gte: fifteenMinsAgo },
        },
      }).catch(() => null);

      if (existingUnresolved) {
        // Increment frequency count on existing error record
        await this.prisma.errorLog.update({
          where: { id: existingUnresolved.id },
          data: {
            occurrenceCount: { increment: 1 },
            lastSeenAt: new Date(),
          },
        }).catch((err) => {
          this.logger.error(`Failed to update duplicate ErrorLog record: ${err.message}`);
        });
      } else {
        // Create new ErrorLog record
        await this.prisma.errorLog.create({
          data: {
            fingerprint,
            status: ErrorStatus.UNRESOLVED,
            severity,
            errorType,
            message: rawMessage,
            stackTrace,
            controller: controllerName || null,
            handler: handlerName || null,
            module: moduleName || null,
            originFile,
            httpMethod,
            endpoint,
            statusCode,
            correlationId,
            headers: sanitizedHeaders ? (sanitizedHeaders as Prisma.InputJsonValue) : Prisma.DbNull,
            queryParams: sanitizedQueryParams ? (sanitizedQueryParams as Prisma.InputJsonValue) : Prisma.DbNull,
            requestBody: sanitizedRequestBody ? (sanitizedRequestBody as Prisma.InputJsonValue) : Prisma.DbNull,
            userId,
            userRole,
            userEmail,
            salonId,
            salonName,
            isSuperAdmin,
            occurrenceCount: 1,
            firstSeenAt: new Date(),
            lastSeenAt: new Date(),
          },
        }).catch((err) => {
          this.logger.error(`Failed to insert ErrorLog record into database: ${err.message}`);
        });
      }
    } catch (err: any) {
      // Fail-safe execution: fallback console log if error logger itself encounters an issue
      this.logger.error(`ErrorLogService.logError internal failure: ${err?.message || err}`);
    }
  }

  /**
   * Super Admin Query Method for Error Management Dashboard.
   */
  async findAll(query: QueryErrorLogsDto) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.ErrorLogWhereInput = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.severity) {
      where.severity = query.severity;
    }

    if (query.salonId) {
      where.salonId = query.salonId;
    }

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      if (query.startDate) where.createdAt.gte = new Date(query.startDate);
      if (query.endDate) where.createdAt.lte = new Date(query.endDate);
    }

    if (query.search && query.search.trim()) {
      const searchTerm = query.search.trim();
      where.OR = [
        { message: { contains: searchTerm, mode: 'insensitive' } },
        { errorType: { contains: searchTerm, mode: 'insensitive' } },
        { endpoint: { contains: searchTerm, mode: 'insensitive' } },
        { userEmail: { contains: searchTerm, mode: 'insensitive' } },
        { salonName: { contains: searchTerm, mode: 'insensitive' } },
        { correlationId: { contains: searchTerm, mode: 'insensitive' } },
      ];
    }

    const sortOrder = query.sortOrder || 'desc';
    const sortBy = query.sortBy || 'createdAt';

    const [items, total, unresolvedCount, criticalCount, highCount] = await Promise.all([
      this.prisma.errorLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      this.prisma.errorLog.count({ where }),
      this.prisma.errorLog.count({ where: { status: ErrorStatus.UNRESOLVED } }),
      this.prisma.errorLog.count({ where: { status: ErrorStatus.UNRESOLVED, severity: ErrorSeverity.CRITICAL } }),
      this.prisma.errorLog.count({ where: { status: ErrorStatus.UNRESOLVED, severity: ErrorSeverity.HIGH } }),
    ]);

    return {
      data: items,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        unresolvedCount,
        criticalCount,
        highCount,
      },
    };
  }

  async findOne(id: string) {
    const errorLog = await this.prisma.errorLog.findUnique({
      where: { id },
      include: {
        salon: {
          select: { id: true, name: true, slug: true, status: true },
        },
      },
    });

    if (!errorLog) {
      throw new NotFoundException(`Error log record '${id}' not found.`);
    }

    return errorLog;
  }

  async resolveError(id: string, adminUser: any, resolutionNotes?: string) {
    const errorLog = await this.prisma.errorLog.findUnique({
      where: { id },
    });

    if (!errorLog) {
      throw new NotFoundException(`Error log record '${id}' not found.`);
    }

    const updated = await this.prisma.errorLog.update({
      where: { id },
      data: {
        status: ErrorStatus.RESOLVED,
        resolvedAt: new Date(),
        resolvedById: adminUser.id || adminUser.sub,
        resolvedByName: adminUser.name || adminUser.email || 'Super Admin',
        resolutionNotes: resolutionNotes || 'Marked as resolved by platform administration.',
      },
    });

    return updated;
  }
}
