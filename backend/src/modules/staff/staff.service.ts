import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateStaffDto,
  UpdateStaffDto,
  AssignStaffServicesDto,
  UpdateStaffWorkingHoursDto,
} from './dto/create-staff.dto';
import { StylistStatus, ServiceStatus, SalonStatus } from '@prisma/client';

@Injectable()
export class StaffService {
  constructor(private prisma: PrismaService) {}

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

  async getSalonStaff(salonId: string) {
    return this.prisma.stylist.findMany({
      where: { salonId },
      include: {
        services: {
          include: {
            service: true,
          },
        },
        workingHours: {
          orderBy: { dayOfWeek: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getStaffById(salonId: string, staffId: string) {
    const stylist = await this.prisma.stylist.findFirst({
      where: { id: staffId, salonId },
      include: {
        services: {
          include: { service: true },
        },
        workingHours: {
          orderBy: { dayOfWeek: 'asc' },
        },
      },
    });

    if (!stylist) {
      throw new NotFoundException('Stylist not found.');
    }

    return stylist;
  }

  async createStaff(salonId: string, dto: CreateStaffDto) {
    // 1. Verify that active services exist in the salon
    const totalServices = await this.prisma.service.count({
      where: { salonId, status: ServiceStatus.ACTIVE },
    });

    if (totalServices === 0) {
      throw new BadRequestException(
        'Cannot create stylist: Salon must have at least one active service before stylists can be created.',
      );
    }

    const serviceIds = (dto.serviceIds || []).filter(Boolean);

    // If service IDs are provided, verify that all provided serviceIds exist, belong to this salon, and are ACTIVE
    if (serviceIds.length > 0) {
      const matchingServices = await this.prisma.service.findMany({
        where: {
          id: { in: serviceIds },
          salonId,
          status: ServiceStatus.ACTIVE,
        },
      });

      if (matchingServices.length !== serviceIds.length) {
        throw new BadRequestException(
          'One or more selected services do not exist, are inactive, or do not belong to this salon.',
        );
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const stylist = await tx.stylist.create({
        data: {
          salonId,
          name: dto.name.trim(),
          phone: dto.phone?.trim() || null,
          email: dto.email?.trim() || null,
          profileImageUrl: dto.profileImageUrl || null,
          status: StylistStatus.ACTIVE,
          followsSalonSchedule: dto.followsSalonSchedule !== undefined ? dto.followsSalonSchedule : true,
        },
      });

      // Link assigned services if provided
      for (const serviceId of serviceIds) {
        await tx.stylistService.create({
          data: {
            stylistId: stylist.id,
            serviceId,
          },
        });
      }

      return tx.stylist.findUnique({
        where: { id: stylist.id },
        include: {
          services: { include: { service: true } },
          workingHours: true,
        },
      });
    });

    await this.syncSalonActiveStatus(salonId);
    return created;
  }

  async updateStaff(salonId: string, staffId: string, dto: UpdateStaffDto) {
    await this.getStaffById(salonId, staffId);

    return this.prisma.stylist.update({
      where: { id: staffId },
      data: {
        name: dto.name?.trim(),
        phone: dto.phone?.trim(),
        email: dto.email?.trim(),
        profileImageUrl: dto.profileImageUrl,
        followsSalonSchedule: dto.followsSalonSchedule,
      },
      include: {
        services: { include: { service: true } },
        workingHours: true,
      },
    });
  }

  async assignServices(salonId: string, staffId: string, dto: AssignStaffServicesDto) {
    await this.getStaffById(salonId, staffId);

    if (!dto.serviceIds || dto.serviceIds.length === 0) {
      throw new BadRequestException('At least one service must be assigned.');
    }

    // Verify all services belong to this salon and are ACTIVE
    const matchingServices = await this.prisma.service.findMany({
      where: {
        id: { in: dto.serviceIds },
        salonId,
        status: ServiceStatus.ACTIVE,
      },
    });

    if (matchingServices.length !== dto.serviceIds.length) {
      throw new BadRequestException(
        'One or more services do not exist, are inactive, or do not belong to this salon.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Clear previous and replace
      await tx.stylistService.deleteMany({ where: { stylistId: staffId } });

      for (const serviceId of dto.serviceIds) {
        await tx.stylistService.create({
          data: {
            stylistId: staffId,
            serviceId,
          },
        });
      }

      return tx.stylist.findUnique({
        where: { id: staffId },
        include: { services: { include: { service: true } } },
      });
    });
  }

  async updateWorkingHours(salonId: string, staffId: string, dto: UpdateStaffWorkingHoursDto) {
    await this.getStaffById(salonId, staffId);

    return this.prisma.$transaction(async (tx) => {
      // Stylist has custom hours now
      await tx.stylist.update({
        where: { id: staffId },
        data: { followsSalonSchedule: false },
      });

      for (const item of dto.hours) {
        await tx.stylistWorkingHours.upsert({
          where: {
            stylistId_dayOfWeek: {
              stylistId: staffId,
              dayOfWeek: item.dayOfWeek,
            },
          },
          update: {
            isWorking: item.isWorking,
            startTime: item.startTime,
            endTime: item.endTime,
            breakStartTime: item.breakStartTime || null,
            breakEndTime: item.breakEndTime || null,
          },
          create: {
            stylistId: staffId,
            dayOfWeek: item.dayOfWeek,
            isWorking: item.isWorking,
            startTime: item.startTime,
            endTime: item.endTime,
            breakStartTime: item.breakStartTime || null,
            breakEndTime: item.breakEndTime || null,
          },
        });
      }

      return tx.stylistWorkingHours.findMany({
        where: { stylistId: staffId },
        orderBy: { dayOfWeek: 'asc' },
      });
    });
  }

  async toggleStaffStatus(salonId: string, staffId: string) {
    const stylist = await this.getStaffById(salonId, staffId);
    const newStatus = stylist.status === StylistStatus.ACTIVE ? StylistStatus.INACTIVE : StylistStatus.ACTIVE;

    const updated = await this.prisma.stylist.update({
      where: { id: staffId },
      data: { status: newStatus },
      include: {
        services: { include: { service: true } },
        workingHours: true,
      },
    });

    await this.syncSalonActiveStatus(salonId);
    return updated;
  }

  async deleteStaff(salonId: string, staffId: string) {
    await this.getStaffById(salonId, staffId);

    const deleted = await this.prisma.stylist.delete({
      where: { id: staffId },
    });

    await this.syncSalonActiveStatus(salonId);
    return deleted;
  }
}
