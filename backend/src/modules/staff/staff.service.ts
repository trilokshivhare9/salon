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

      const created = await tx.staff.findUnique({
        where: { id: staff.id },
        include: {
          services: { include: { service: true } },
          workingHours: true,
        },
      });

      // Auto-evaluate Salon Activation
      const [activeStaffCount, activeServicesCount] = await Promise.all([
        tx.staff.count({ where: { salonId, status: 'ACTIVE' } }),
        tx.service.count({ where: { salonId, status: 'ACTIVE' } }),
      ]);

      if (activeStaffCount > 0 && activeServicesCount > 0) {
        await tx.salon.update({
          where: { id: salonId },
          data: { status: 'ACTIVE' },
        });
      }

      return created;
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

    const updated = await this.prisma.staff.update({
      where: { id: staffId },
      data: { status: newStatus },
    });

    // Auto-evaluate Salon Activation
    const [activeStaffCount, activeServicesCount] = await Promise.all([
      this.prisma.staff.count({ where: { salonId, status: 'ACTIVE' } }),
      this.prisma.service.count({ where: { salonId, status: 'ACTIVE' } }),
    ]);

    const salonStatus = activeStaffCount > 0 && activeServicesCount > 0 ? 'ACTIVE' : 'DEACTIVATED';
    await this.prisma.salon.update({
      where: { id: salonId },
      data: { status: salonStatus as any },
    });

    return updated;
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

  async deleteStaff(salonId: string, staffId: string) {
    await this.getStaffById(salonId, staffId);

    return this.prisma.$transaction(async (tx) => {
      // 1. Delete associated breaks, working hours, and service capabilities
      await tx.staffBreak.deleteMany({ where: { staffId } });
      await tx.staffWorkingHours.deleteMany({ where: { staffId } });
      await tx.staffService.deleteMany({ where: { staffId } });

      // 2. Delete staff member
      const deleted = await tx.staff.delete({ where: { id: staffId } });

      // 3. Auto-evaluate salon activation status
      const [activeStaffCount, activeServicesCount] = await Promise.all([
        tx.staff.count({ where: { salonId, status: 'ACTIVE' } }),
        tx.service.count({ where: { salonId, status: 'ACTIVE' } }),
      ]);

      const newStatus = activeStaffCount > 0 && activeServicesCount > 0 ? 'ACTIVE' : 'DEACTIVATED';
      await tx.salon.update({
        where: { id: salonId },
        data: { status: newStatus as any },
      });

      return deleted;
    });
  }
}
