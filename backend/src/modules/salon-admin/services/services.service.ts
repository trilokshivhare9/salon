import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { CreateServiceDto, UpdateServiceDto } from './dto/create-service.dto';
import { BulkImportItemDto } from './ai-scanner/dto/bulk-import-services.dto';
import { ServiceStatus, SalonStatus, StylistStatus, AppointmentStatus, ConversationState } from '@prisma/client';
import { AppointmentsService } from '../appointments/appointments.service';

@Injectable()
export class ServicesService {
  constructor(
    private prisma: PrismaService,
    private appointmentsService: AppointmentsService,
  ) {}

  private async syncSalonActiveStatus(salonId: string) {
    try {
      const [activeStylistCount, activeServiceCount] = await Promise.all([
        this.prisma.stylist.count({ where: { salonId, status: StylistStatus.ACTIVE } }),
        this.prisma.service.count({ where: { salonId, status: ServiceStatus.ACTIVE } }),
      ]);

      const meetsRequirements = activeStylistCount >= 1 && activeServiceCount >= 1;
      await this.prisma.salon.update({
        where: { id: salonId },
        data: { status: meetsRequirements ? SalonStatus.ACTIVE : SalonStatus.INACTIVE },
      });
    } catch (_) { }
  }

  async getSalonServices(salonId: string) {
    return this.prisma.service.findMany({
      where: { salonId },
      include: {
        serviceCategory: true,
        stylists: {
          include: {
            stylist: true,
          },
        },
        _count: {
          select: { stylists: true },
        },
      },
      orderBy: [
        { serviceCategory: { sortOrder: 'asc' } },
        { createdAt: 'desc' },
      ],
    });
  }

  // ---------------------------------------------------------------------------
  // SERVICE CATEGORY MANAGEMENT
  // ---------------------------------------------------------------------------
  async getServiceCategories(salonId: string) {
    return this.prisma.serviceCategory.findMany({
      where: { salonId },
      include: {
        _count: { select: { services: true } },
      },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async createServiceCategory(salonId: string, name: string, icon?: string, sortOrder?: number) {
    if (!name || typeof name !== 'string') {
      throw new BadRequestException('Category name is required');
    }
    const trimmedName = name.trim();
    if (!trimmedName) throw new BadRequestException('Category name cannot be empty');
    if (trimmedName.length > 255) {
      throw new BadRequestException('Category name cannot exceed 255 characters');
    }

    const existing = await this.prisma.serviceCategory.findFirst({
      where: { salonId, name: { equals: trimmedName, mode: 'insensitive' } },
    });
    if (existing) {
      throw new BadRequestException(`Category "${trimmedName}" already exists in this salon.`);
    }

    return this.prisma.serviceCategory.create({
      data: {
        salonId,
        name: trimmedName,
        icon: icon || 'scissors',
        sortOrder: sortOrder || 0,
      },
    });
  }

  async updateServiceCategory(salonId: string, categoryId: string, name?: string, icon?: string, sortOrder?: number) {
    const existing = await this.prisma.serviceCategory.findFirst({
      where: { id: categoryId, salonId },
    });
    if (!existing) throw new NotFoundException('Service category not found');

    const data: any = {};
    if (name !== undefined) {
      const trimmed = name.trim();
      if (!trimmed) throw new BadRequestException('Category name cannot be empty');
      data.name = trimmed;
    }
    if (icon !== undefined) data.icon = icon;
    if (sortOrder !== undefined) data.sortOrder = sortOrder;

    return this.prisma.serviceCategory.update({
      where: { id: categoryId },
      data,
    });
  }

  async deleteServiceCategory(salonId: string, categoryId: string) {
    const existing = await this.prisma.serviceCategory.findFirst({
      where: { id: categoryId, salonId },
    });
    if (!existing) throw new NotFoundException('Service category not found');

    // onDelete: SetNull on Prisma will unbind services safely
    return this.prisma.serviceCategory.delete({
      where: { id: categoryId },
    });
  }

  async getServiceById(salonId: string, serviceId: string) {
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, salonId },
      include: {
        serviceCategory: true,
        stylists: {
          include: {
            stylist: true,
          },
        },
        _count: {
          select: { stylists: true },
        },
      },
    });

    if (!service) {
      throw new NotFoundException('Service not found.');
    }

    return service;
  }

  async createService(salonId: string, dto: CreateServiceDto) {
    if (!dto.name || dto.name.trim().length === 0) {
      throw new BadRequestException('Service name cannot be empty or blank.');
    }
    if (dto.price !== undefined && dto.price < 0) {
      throw new BadRequestException('Service price cannot be negative.');
    }
    if (dto.durationMinutes !== undefined && (dto.durationMinutes < 30 || dto.durationMinutes % 15 !== 0)) {
      throw new BadRequestException('Service duration must be at least 30 minutes and a multiple of 15.');
    }

    // Determine target stylists to link
    let targetStylistIds: string[] = [];

    if (dto.stylistIds !== undefined) {
      if (dto.stylistIds.length > 0) {
        const matchingStylists = await this.prisma.stylist.findMany({
          where: {
            id: { in: dto.stylistIds },
            salonId,
            status: StylistStatus.ACTIVE,
          },
          select: { id: true },
        });

        if (matchingStylists.length !== dto.stylistIds.length) {
          throw new BadRequestException(
            'One or more selected stylists do not exist, are inactive, or do not belong to this salon.',
          );
        }
        targetStylistIds = matchingStylists.map((s) => s.id);
      }
    } else {
      const activeStylists = await this.prisma.stylist.findMany({
        where: { salonId, status: StylistStatus.ACTIVE },
        select: { id: true },
      });
      targetStylistIds = activeStylists.map((s) => s.id);
    }

    // Validate or auto-resolve categoryId / category name strictly
    let resolvedCategoryId: string | null = null;
    let finalCategoryName = dto.category?.trim();

    if (dto.categoryId) {
      const cat = await this.prisma.serviceCategory.findFirst({
        where: { id: dto.categoryId, salonId },
      });
      if (!cat) throw new BadRequestException('Selected Service Category does not exist in this salon.');
      resolvedCategoryId = cat.id;
      finalCategoryName = cat.name;
    } else if (finalCategoryName) {
      let cat = await this.prisma.serviceCategory.findFirst({
        where: { salonId, name: { equals: finalCategoryName, mode: 'insensitive' } },
      });
      if (!cat) {
        cat = await this.prisma.serviceCategory.create({
          data: {
            salonId,
            name: finalCategoryName,
            icon: '✂️',
            sortOrder: 0,
          },
        });
      }
      resolvedCategoryId = cat.id;
      finalCategoryName = cat.name;
    } else {
      throw new BadRequestException('Service Category is required. Please select or specify a category.');
    }

    const service = await this.prisma.$transaction(async (tx) => {
      const created = await tx.service.create({
        data: {
          salonId,
          name: dto.name.trim(),
          description: dto.description?.trim(),
          price: dto.price,
          durationMinutes: dto.durationMinutes,
          category: finalCategoryName,
          categoryId: resolvedCategoryId,
          targetGender: dto.targetGender || 'UNISEX',
          status: ServiceStatus.ACTIVE,
        },
      });

      if (targetStylistIds.length > 0) {
        await tx.stylistService.createMany({
          data: targetStylistIds.map((stylistId) => ({
            salonId,
            stylistId,
            serviceId: created.id,
          })),
          skipDuplicates: true,
        });
      }

      return tx.service.findUnique({
        where: { id: created.id },
        include: {
          serviceCategory: true,
          stylists: {
            include: { stylist: true },
          },
          _count: {
            select: { stylists: true },
          },
        },
      });
    });

    setImmediate(() => this.syncSalonActiveStatus(salonId));
    this.appointmentsService.emitSalonEvent(salonId, 'SERVICE_UPDATED', { serviceId: service!.id, action: 'CREATE' });
    return service;
  }

  /**
   * High-performance batched bulk creation of services.
   * - Pre-fetches active stylists once (1 query)
   * - Resolves/creates categories in batch with an in-memory map (1-2 queries)
   * - Performs atomic bulk insert in a single transaction (1 transaction)
   * - Emits a single consolidated BULK_IMPORT real-time event
   */
  async bulkCreateServices(salonId: string, items: BulkImportItemDto[]) {
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('No services provided for bulk import.');
    }

    // Step 1: Pre-fetch active salon stylists once
    const activeStylists = await this.prisma.stylist.findMany({
      where: { salonId, status: StylistStatus.ACTIVE },
      select: { id: true },
    });
    const stylistIds = activeStylists.map((s) => s.id);

    // Step 2: Deduplicate unique category names and resolve/create in batch
    const uniqueCategoryNames = Array.from(
      new Set(
        items
          .map((item) => (item.category?.trim() || 'General'))
          .filter((cat) => cat.length > 0),
      ),
    );

    // Fetch existing categories matching any of these names
    const existingCats = await this.prisma.serviceCategory.findMany({
      where: {
        salonId,
        name: { in: uniqueCategoryNames, mode: 'insensitive' },
      },
    });

    const categoryMap = new Map<string, { id: string; name: string }>();
    for (const cat of existingCats) {
      categoryMap.set(cat.name.toUpperCase(), { id: cat.id, name: cat.name });
    }

    // Identify categories that need to be created
    for (const catName of uniqueCategoryNames) {
      if (!categoryMap.has(catName.toUpperCase())) {
        const createdCat = await this.prisma.serviceCategory.create({
          data: {
            salonId,
            name: catName,
            icon: '✂️',
            sortOrder: 0,
          },
        });
        categoryMap.set(catName.toUpperCase(), { id: createdCat.id, name: createdCat.name });
      }
    }

    // Step 3: Atomic database transaction to insert all services & assignments
    const importedServices = await this.prisma.$transaction(async (tx) => {
      const createdList = [];

      for (const item of items) {
        const catKey = (item.category?.trim() || 'General').toUpperCase();
        const resolvedCategory = categoryMap.get(catKey);

        const validDuration = Math.max(30, Math.round((item.durationMinutes || 30) / 15) * 15);
        const validPrice = Math.max(0, item.price || 0);

        const createdService = await tx.service.create({
          data: {
            salonId,
            name: item.name.trim(),
            description: item.description?.trim(),
            price: validPrice,
            durationMinutes: validDuration,
            category: resolvedCategory ? resolvedCategory.name : 'General',
            categoryId: resolvedCategory ? resolvedCategory.id : null,
            targetGender: item.targetGender || 'UNISEX',
            status: ServiceStatus.ACTIVE,
          },
        });

        createdList.push(createdService);
      }

      // Step 3b: Bulk create stylist assignments in a single query
      if (stylistIds.length > 0 && createdList.length > 0) {
        const allAssignments = createdList.flatMap((svc) =>
          stylistIds.map((stId) => ({
            salonId,
            stylistId: stId,
            serviceId: svc.id,
          })),
        );

        await tx.stylistService.createMany({
          data: allAssignments,
          skipDuplicates: true,
        });
      }

      return createdList;
    });

    // Step 4: Sync salon active status
    setImmediate(() => this.syncSalonActiveStatus(salonId));

    // Step 5: Emit a SINGLE consolidated real-time event
    this.appointmentsService.emitSalonEvent(salonId, 'SERVICE_UPDATED', {
      action: 'BULK_IMPORT',
      count: importedServices.length,
      categoryCount: uniqueCategoryNames.length,
    });

    return {
      importedCount: importedServices.length,
      services: importedServices,
    };
  }

  async updateService(salonId: string, serviceId: string, dto: UpdateServiceDto) {
    await this.getServiceById(salonId, serviceId);

    if (dto.name !== undefined) {
      const trimmedName = dto.name.trim();
      if (trimmedName.length === 0) {
        throw new BadRequestException('Service name cannot be empty or blank.');
      }
      dto.name = trimmedName;
    }
    if (dto.description !== undefined) {
      dto.description = dto.description?.trim();
    }
    if (dto.category !== undefined) {
      dto.category = dto.category?.trim();
    }
    if (dto.price !== undefined && dto.price < 0) {
      throw new BadRequestException('Service price cannot be negative.');
    }
    if (dto.durationMinutes !== undefined && (dto.durationMinutes < 30 || dto.durationMinutes % 15 !== 0)) {
      throw new BadRequestException('Service duration must be at least 30 minutes and a multiple of 15.');
    }

    let resolvedCategoryId: string | undefined = dto.categoryId;
    let finalCategoryName = dto.category?.trim();

    if (dto.categoryId) {
      const cat = await this.prisma.serviceCategory.findFirst({
        where: { id: dto.categoryId, salonId },
      });
      if (!cat) throw new BadRequestException('Selected Service Category does not exist in this salon.');
      resolvedCategoryId = cat.id;
      finalCategoryName = cat.name;
    } else if (finalCategoryName) {
      let cat = await this.prisma.serviceCategory.findFirst({
        where: { salonId, name: { equals: finalCategoryName, mode: 'insensitive' } },
      });
      if (!cat) {
        cat = await this.prisma.serviceCategory.create({
          data: {
            salonId,
            name: finalCategoryName,
            icon: '✂️',
            sortOrder: 0,
          },
        });
      }
      resolvedCategoryId = cat.id;
      finalCategoryName = cat.name;
    }

    const { stylistIds, ...serviceData } = dto;

    // Validate stylistIds if provided
    if (stylistIds !== undefined && stylistIds.length > 0) {
      const matchingStylists = await this.prisma.stylist.findMany({
        where: {
          id: { in: stylistIds },
          salonId,
          status: StylistStatus.ACTIVE,
        },
        select: { id: true },
      });

      if (matchingStylists.length !== stylistIds.length) {
        throw new BadRequestException(
          'One or more selected stylists do not exist, are inactive, or do not belong to this salon.',
        );
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.service.update({
        where: { id: serviceId },
        data: {
          ...serviceData,
          ...(resolvedCategoryId !== undefined ? { categoryId: resolvedCategoryId } : {}),
        },
      });

      // If stylistIds was provided, update stylist_services mapping
      if (stylistIds !== undefined) {
        await tx.stylistService.deleteMany({
          where: { salonId, serviceId },
        });

        if (stylistIds.length > 0) {
          await tx.stylistService.createMany({
            data: stylistIds.map((stylistId) => ({
              salonId,
              stylistId,
              serviceId,
            })),
            skipDuplicates: true,
          });
        }
      }

      return tx.service.findUnique({
        where: { id: serviceId },
        include: {
          serviceCategory: true,
          stylists: {
            include: { stylist: true },
          },
          _count: {
            select: { stylists: true },
          },
        },
      });
    });

    setImmediate(() => this.syncSalonActiveStatus(salonId));
    this.appointmentsService.emitSalonEvent(salonId, 'SERVICE_UPDATED', { serviceId, action: 'UPDATE' });
    return updated;
  }

  async toggleServiceStatus(salonId: string, serviceId: string) {
    const service = await this.getServiceById(salonId, serviceId);
    const newStatus = service.status === ServiceStatus.ACTIVE ? ServiceStatus.INACTIVE : ServiceStatus.ACTIVE;

    const updated = await this.prisma.service.update({
      where: { id: serviceId },
      data: { status: newStatus },
      include: {
        stylists: {
          include: { stylist: true },
        },
        _count: {
          select: { stylists: true },
        },
      },
    });

    setImmediate(() => this.syncSalonActiveStatus(salonId));
    this.appointmentsService.emitSalonEvent(salonId, 'SERVICE_UPDATED', { serviceId, action: 'TOGGLE' });
    return updated;
  }

  async deleteService(salonId: string, serviceId: string) {
    await this.getServiceById(salonId, serviceId);

    // Guard: Prevent deletion ONLY if there are ACTIVE / UPCOMING / IN-PROGRESS appointments
    const activeAppointmentsCount = await this.prisma.appointment.count({
      where: {
        salonId,
        serviceId,
        status: {
          in: [
            AppointmentStatus.BOOKED,
            AppointmentStatus.CONFIRMED,
            AppointmentStatus.ON_THE_WAY,
            AppointmentStatus.CHECKED_IN,
            AppointmentStatus.SEATED_IN_CHAIR,
            AppointmentStatus.PENDING_RESCHEDULE,
          ],
        },
      },
    });

    if (activeAppointmentsCount > 0) {
      throw new BadRequestException(
        `Cannot delete service: There are ${activeAppointmentsCount} active appointment(s) currently booked or in service. Please complete or cancel these active appointments before deleting the service.`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Reset active conversations referencing this deleted service
      await tx.conversation.updateMany({
        where: { salonId, selectedServiceId: serviceId },
        data: {
          state: ConversationState.START,
          selectedServiceId: null,
          selectedStaffId: null,
          selectedDate: null,
          selectedStartTime: null,
          selectedCategoryId: null,
          tempBookingGender: null,
          pendingAddonServiceId: null,
        },
      });

      // 2. Disassociate cancelled/historical appointment service references (preserving immutable snapshots)
      await tx.appointment.updateMany({
        where: { salonId, serviceId },
        data: { serviceId: null },
      });

      await tx.appointmentService.updateMany({
        where: { salonId, serviceId },
        data: { serviceId: null },
      });

      // 3. Delete the service record (Prisma cascades stylist_services)
      const deleted = await tx.service.delete({
        where: { id: serviceId },
      });

      // 4. Sync salon active status (auto-deactivates if < 1 active stylist or service)
      const activeStylistCount = await tx.stylist.count({
        where: { salonId, status: StylistStatus.ACTIVE },
      });
      const activeServiceCount = await tx.service.count({
        where: { salonId, status: ServiceStatus.ACTIVE },
      });
      const meetsRequirements = activeStylistCount >= 1 && activeServiceCount >= 1;
      await tx.salon.update({
        where: { id: salonId },
        data: { status: meetsRequirements ? SalonStatus.ACTIVE : SalonStatus.INACTIVE },
      });

      return deleted;
    });

    this.appointmentsService.emitSalonEvent(salonId, 'SERVICE_UPDATED', { serviceId, action: 'DELETE' });
    return result;
  }
}

