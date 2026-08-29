import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateStaffDto,
  UpdateStaffDto,
  AssignStaffServicesDto,
  UpdateStaffWorkingHoursDto,
  CreateStaffBreakDto,
} from './dto/create-staff.dto';

@Injectable()
export class StaffService {
  constructor(private prisma: PrismaService) {}

  async getSalonStaff(salonId: string) {
    return this.prisma.staff.findMany({
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
        breaks: {
          orderBy: { startTime: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getStaffById(salonId: string, staffId: string) {
    const staff = await this.prisma.staff.findFirst({
      where: { id: staffId, salonId },
      include: {
        services: {
          include: { service: true },
        },
        workingHours: {
          orderBy: { dayOfWeek: 'asc' },
        },
        breaks: true,
      },
    });

    if (!staff) {
      throw new NotFoundException('Staff member not found.');
    }

    return staff;
  }

  async createStaff(salonId: string, dto: CreateStaffDto) {
    return this.prisma.$transaction(async (tx) => {
      const staff = await tx.staff.create({
        data: {
          salonId,
          name: dto.name,
          phone: dto.phone,
          email: dto.email,
          profileImageUrl: dto.profileImageUrl,
        },
      });

      // Link services if provided
      if (dto.serviceIds && dto.serviceIds.length > 0) {
        for (const serviceId of dto.serviceIds) {
          await tx.staffService.create({
            data: {
              staffId: staff.id,
              serviceId,
            },
          });
        }
      }

      // Initialize default working hours identical to salon hours
      const salonHours = await tx.workingHours.findMany({ where: { salonId } });
      for (const sh of salonHours) {
        await tx.staffWorkingHours.create({
          data: {
            staffId: staff.id,
            dayOfWeek: sh.dayOfWeek,
            isWorking: sh.isOpen,
            startTime: sh.openTime,
            endTime: sh.closeTime,
          },
        });
      }

      return tx.staff.findUnique({
        where: { id: staff.id },
        include: {
          services: { include: { service: true } },
          workingHours: true,
        },
      });
    });
  }

  async updateStaff(salonId: string, staffId: string, dto: UpdateStaffDto) {
    await this.getStaffById(salonId, staffId);

    return this.prisma.staff.update({
      where: { id: staffId },
      data: dto,
    });
  }

  async toggleStaffStatus(salonId: string, staffId: string) {
    const staff = await this.getStaffById(salonId, staffId);
    const newStatus = staff.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';

    return this.prisma.staff.update({
      where: { id: staffId },
      data: { status: newStatus },
    });
  }

  async assignServices(salonId: string, staffId: string, dto: AssignStaffServicesDto) {
    await this.getStaffById(salonId, staffId);

    return this.prisma.$transaction(async (tx) => {
      // Clear existing assignments
      await tx.staffService.deleteMany({ where: { staffId } });

      // Create new assignments
      for (const serviceId of dto.serviceIds) {
        await tx.staffService.create({
          data: {
            staffId,
            serviceId,
          },
        });
      }

      return tx.staff.findUnique({
        where: { id: staffId },
        include: { services: { include: { service: true } } },
      });
    });
  }

  async updateWorkingHours(salonId: string, staffId: string, dto: UpdateStaffWorkingHoursDto) {
    await this.getStaffById(salonId, staffId);

    return this.prisma.$transaction(async (tx) => {
      for (const item of dto.hours) {
        await tx.staffWorkingHours.upsert({
          where: {
            staffId_dayOfWeek: {
              staffId,
              dayOfWeek: item.dayOfWeek,
            },
          },
          update: {
            isWorking: item.isWorking,
            startTime: item.startTime,
            endTime: item.endTime,
          },
          create: {
            staffId,
            dayOfWeek: item.dayOfWeek,
            isWorking: item.isWorking,
            startTime: item.startTime,
            endTime: item.endTime,
          },
        });
      }

      return tx.staffWorkingHours.findMany({
        where: { staffId },
        orderBy: { dayOfWeek: 'asc' },
      });
    });
  }

  async addBreak(salonId: string, staffId: string, dto: CreateStaffBreakDto) {
    await this.getStaffById(salonId, staffId);

    return this.prisma.staffBreak.create({
      data: {
        staffId,
        dayOfWeek: dto.dayOfWeek,
        startTime: dto.startTime,
        endTime: dto.endTime,
        title: dto.title || 'Break',
      },
    });
  }

  async deleteBreak(salonId: string, staffId: string, breakId: string) {
    await this.getStaffById(salonId, staffId);

    return this.prisma.staffBreak.deleteMany({
      where: { id: breakId, staffId },
    });
  }
}
