import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateServiceDto, UpdateServiceDto } from './dto/create-service.dto';
import { ServiceStatus, SalonStatus, StylistStatus, AppointmentStatus } from '@prisma/client';
import { AppointmentsService } from '../appointments/appointments.service';

@Injectable()
export class ServicesService {
  constructor(
    private prisma: PrismaService,
    private appointmentsService: AppointmentsService,
  ) {}

  private async syncSalonActiveStatus(salonId: string) {
    const activeStylistCount = await this.prisma.stylist.count({
      where: { salonId, status: StylistStatus.ACTIVE },
    });
    const activeServiceCount = await this.prisma.service.count({
      where: { salonId, status: ServiceStatus.ACTIVE },
    });

    const meetsRequirements = activeStylistCount >= 1 && activeServiceCount >= 1;
    await this.prisma.salon.update({
      where: { id: salonId },
      data: { status: meetsRequirements ? SalonStatus.ACTIVE : SalonStatus.INACTIVE },
    });
  }

  async getSalonServices(salonId: string) {
    return this.prisma.service.findMany({
      where: { salonId },
      include: {
        stylists: {
          include: {
            stylist: true,
          },
        },
        _count: {
          select: { stylists: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getServiceById(salonId: string, serviceId: string) {
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, salonId },
      include: {
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
      // Explicit stylist list provided (can be empty array if explicitly desired)
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
      // Default: automatically assign all active stylists in the salon
      const activeStylists = await this.prisma.stylist.findMany({
        where: { salonId, status: StylistStatus.ACTIVE },
        select: { id: true },
      });
      targetStylistIds = activeStylists.map((s) => s.id);
    }

    const service = await this.prisma.$transaction(async (tx) => {
      const created = await tx.service.create({
        data: {
          salonId,
          name: dto.name.trim(),
          description: dto.description?.trim(),
          price: dto.price,
          durationMinutes: dto.durationMinutes,
          category: dto.category?.trim(),
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
          stylists: {
            include: { stylist: true },
          },
          _count: {
            select: { stylists: true },
          },
        },
      });
    });

    await this.syncSalonActiveStatus(salonId);
    this.appointmentsService.emitSalonEvent(salonId, 'SERVICE_UPDATED', { serviceId: service!.id, action: 'CREATE' });
    return service;
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
        data: serviceData,
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
          stylists: {
            include: { stylist: true },
          },
          _count: {
            select: { stylists: true },
          },
        },
      });
    });

    await this.syncSalonActiveStatus(salonId);
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

    await this.syncSalonActiveStatus(salonId);
    this.appointmentsService.emitSalonEvent(salonId, 'SERVICE_UPDATED', { serviceId, action: 'TOGGLE' });
    return updated;
  }

  async deleteService(salonId: string, serviceId: string) {
    await this.getServiceById(salonId, serviceId);

    // Guard: Prevent deletion if ANY appointment (historical or active) is tied to this service
    const totalAppointmentsCount = await this.prisma.appointment.count({
      where: {
        salonId,
        serviceId,
      },
    });

    if (totalAppointmentsCount > 0) {
      throw new BadRequestException(
        `Cannot delete service: There are ${totalAppointmentsCount} appointment(s) (historical or active) booked for this service. Please deactivate the service instead to preserve business records and customer visit history.`,
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Clear active conversation reference if any
      await tx.conversation.updateMany({
        where: { salonId, selectedServiceId: serviceId },
        data: { selectedServiceId: null },
      });

      // 2. Delete the service record (Prisma cascades stylist_services)
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

