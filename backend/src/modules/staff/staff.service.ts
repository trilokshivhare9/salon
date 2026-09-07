import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  CreateStaffDto,
  UpdateStaffDto,
  AssignStaffServicesDto,
  UpdateStaffWorkingHoursDto,
  CreateStaffBreakDto,
} from './dto/create-staff.dto';
import { StylistStatus, ServiceStatus, SalonStatus, DayOfWeek, AppointmentStatus } from '@prisma/client';
import { AppointmentsService } from '../appointments/appointments.service';
import { DateTime } from 'luxon';
import * as crypto from 'crypto';

@Injectable()
export class StaffService {
  constructor(
    private prisma: PrismaService,
    private appointmentsService: AppointmentsService,
  ) {}

  private hashToSignedInt32(input: string): number {
    return crypto.createHash('sha256').update(input).digest().readInt32BE(0);
  }

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
            salonId,
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
    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', { staffId: created.id, action: 'CREATE' });
    return created;
  }

  async updateStaff(salonId: string, staffId: string, dto: UpdateStaffDto) {
    const existing = await this.getStaffById(salonId, staffId);

    // If switching to follow salon schedule, ensure future appointments fit within salon operating hours
    if (dto.followsSalonSchedule === true && !existing.followsSalonSchedule) {
      const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
      const tz = salon?.timezone || 'Asia/Kolkata';
      const salonHours = await this.prisma.salonWorkingHours.findMany({ where: { salonId } });
      const hoursMap = new Map(salonHours.map((h) => [h.dayOfWeek, h]));

      const now = new Date();
      const futureAppointments = await this.prisma.appointment.findMany({
        where: {
          salonId,
          stylistId: staffId,
          startAt: { gt: now },
          status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_SERVICE] },
        },
      });

      for (const appt of futureAppointments) {
        const dayOfWeek = DateTime.fromJSDate(appt.startAt, { zone: tz }).toFormat('cccc').toUpperCase() as DayOfWeek;
        const sh = hoursMap.get(dayOfWeek);
        const apptStart = DateTime.fromJSDate(appt.startAt, { zone: tz }).toFormat('HH:mm');
        const apptEnd = DateTime.fromJSDate(appt.endAt, { zone: tz }).toFormat('HH:mm');

        if (!sh || sh.isClosed || apptStart < sh.startTime || apptEnd > sh.endTime) {
          throw new ConflictException(
            `Cannot switch stylist to salon schedule: future appointment #${appt.appointmentNumber} falls outside salon hours on ${dayOfWeek}.`,
          );
        }
        if (sh.breakStartTime && sh.breakEndTime && apptStart < sh.breakEndTime && apptEnd > sh.breakStartTime) {
          throw new ConflictException(
            `Cannot switch stylist to salon schedule: future appointment #${appt.appointmentNumber} conflicts with salon break on ${dayOfWeek}.`,
          );
        }
      }
    }

    const updated = await this.prisma.stylist.update({
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

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', { staffId, action: 'UPDATE' });
    return updated;
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

    const res = await this.prisma.$transaction(async (tx) => {
      // Clear previous and replace
      await tx.stylistService.deleteMany({ where: { stylistId: staffId } });

      await tx.stylistService.createMany({
        data: dto.serviceIds.map((serviceId) => ({
          salonId,
          stylistId: staffId,
          serviceId,
        })),
      });

      return tx.stylist.findUnique({
        where: { id: staffId },
        include: {
          services: { include: { service: true } },
          workingHours: true,
        },
      });
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', { staffId, action: 'ASSIGN_SERVICES' });
    return res;
  }

  async updateWorkingHours(salonId: string, staffId: string, dto: UpdateStaffWorkingHoursDto) {
    await this.getStaffById(salonId, staffId);
    const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
    if (!salon) throw new NotFoundException('Salon not found.');
    const tz = salon.timezone || 'Asia/Kolkata';

    const res = await this.prisma.$transaction(async (tx) => {
      // Stylist has custom hours now
      await tx.stylist.update({
        where: { id: staffId },
        data: { followsSalonSchedule: false },
      });

      const now = new Date();
      const futureAppointments = await tx.appointment.findMany({
        where: {
          salonId,
          stylistId: staffId,
          startAt: { gt: now },
          status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_SERVICE] },
        },
      });

      for (const item of dto.hours) {
        // Level 1: Acquire exclusive schedule lock for this day
        const key1 = this.hashToSignedInt32(`salon:${salonId}`);
        const scheduleKey2 = this.hashToSignedInt32(`schedule:${item.dayOfWeek}`);
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(${key1}, ${scheduleKey2})`,
        );

        const dayAppointments = futureAppointments.filter((appt) => {
          const dayName = DateTime.fromJSDate(appt.startAt, { zone: tz }).toFormat('cccc').toUpperCase();
          return dayName === item.dayOfWeek;
        });

        if (!item.isWorking) {
          if (dayAppointments.length > 0) {
            const conflicting = dayAppointments[0];
            throw new ConflictException(
              `Cannot set day off for stylist on ${item.dayOfWeek}: stylist has existing future appointment #${conflicting.appointmentNumber}.`,
            );
          }
        } else {
          for (const appt of dayAppointments) {
            const apptStart = DateTime.fromJSDate(appt.startAt, { zone: tz }).toFormat('HH:mm');
            const apptEnd = DateTime.fromJSDate(appt.endAt, { zone: tz }).toFormat('HH:mm');

            if (apptStart < item.startTime || apptEnd > item.endTime) {
              throw new ConflictException(
                `Cannot update working hours on ${item.dayOfWeek} to ${item.startTime}-${item.endTime}: future appointment #${appt.appointmentNumber} (${apptStart}-${apptEnd}) falls outside the working window.`,
              );
            }

            if (item.breakStartTime && item.breakEndTime) {
              if (apptStart < item.breakEndTime && apptEnd > item.breakStartTime) {
                throw new ConflictException(
                  `Cannot set stylist break on ${item.dayOfWeek} to ${item.breakStartTime}-${item.breakEndTime}: future appointment #${appt.appointmentNumber} conflicts with the break.`,
                );
              }
            }
          }
        }

        if (item.startTime >= item.endTime) {
          throw new BadRequestException('Shift start time must be earlier than shift end time.');
        }

        if (item.breakStartTime || item.breakEndTime) {
          if (!item.breakStartTime || !item.breakEndTime) {
            throw new BadRequestException('Both break start time and break end time must be specified.');
          }
          if (item.breakStartTime >= item.breakEndTime) {
            throw new BadRequestException('Break start time must be earlier than break end time.');
          }
          if (item.breakStartTime <= item.startTime || item.breakEndTime >= item.endTime) {
            throw new BadRequestException('Break times must fall strictly within the shift.');
          }
          const [bStartH, bStartM] = item.breakStartTime.split(':').map(Number);
          const [bEndH, bEndM] = item.breakEndTime.split(':').map(Number);
          const breakDuration = (bEndH * 60 + bEndM) - (bStartH * 60 + bStartM);
          if (breakDuration < 15 || breakDuration % 15 !== 0) {
            throw new BadRequestException('Break duration must be at least 15 minutes and divisible by 15.');
          }
        }

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

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', { staffId, action: 'UPDATE_HOURS' });
    return res;
  }

  async toggleStaffStatus(salonId: string, staffId: string) {
    const stylist = await this.getStaffById(salonId, staffId);
    const newStatus = stylist.status === StylistStatus.ACTIVE ? StylistStatus.INACTIVE : StylistStatus.ACTIVE;

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT id FROM stylists WHERE id = '${staffId}' FOR UPDATE`);

      if (newStatus === StylistStatus.INACTIVE) {
        const now = new Date();
        const futureBlocking = await tx.appointment.findFirst({
          where: {
            salonId,
            stylistId: staffId,
            startAt: { gt: now },
            status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_SERVICE] },
          },
        });

        if (futureBlocking) {
          throw new ConflictException(
            `Cannot deactivate stylist: stylist has existing future appointment #${futureBlocking.appointmentNumber}.`,
          );
        }
      }

      return tx.stylist.update({
        where: { id: staffId },
        data: { status: newStatus },
        include: {
          services: { include: { service: true } },
          workingHours: true,
        },
      });
    });

    await this.syncSalonActiveStatus(salonId);
    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', { staffId, action: 'TOGGLE' });
    return updated;
  }

  async deleteStaff(salonId: string, staffId: string) {
    await this.getStaffById(salonId, staffId);

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Remove appointments tied to this stylist so ON DELETE RESTRICT does not block deletion
      await tx.appointment.deleteMany({
        where: { salonId, stylistId: staffId },
      });

      // 2. Clear active conversation reference if any
      await tx.conversation.updateMany({
        where: { salonId, selectedStaffId: staffId },
        data: { selectedStaffId: null },
      });

      // 3. Delete the stylist record (Prisma cascades stylist_services and stylist_working_hours)
      const deleted = await tx.stylist.delete({
        where: { id: staffId },
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

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', { staffId, action: 'DELETE' });
    return result;
  }

  async getStaffBreaks(salonId: string, staffId: string) {
    await this.getStaffById(salonId, staffId);
    const records = await this.prisma.stylistWorkingHours.findMany({
      where: {
        stylistId: staffId,
        breakStartTime: { not: null },
        breakEndTime: { not: null },
      },
      orderBy: { dayOfWeek: 'asc' },
    });
    return records.map((r) => ({
      id: r.id,
      dayOfWeek: r.dayOfWeek,
      startTime: r.breakStartTime,
      endTime: r.breakEndTime,
      title: 'Shift Break',
    }));
  }

  async createStaffBreak(salonId: string, staffId: string, dto: CreateStaffBreakDto) {
    await this.getStaffById(salonId, staffId);

    // Validate times (HH:mm)
    if (dto.startTime >= dto.endTime) {
      throw new BadRequestException('Break start time must be earlier than end time');
    }

    const [bStartH, bStartM] = dto.startTime.split(':').map(Number);
    const [bEndH, bEndM] = dto.endTime.split(':').map(Number);
    const breakDuration = (bEndH * 60 + bEndM) - (bStartH * 60 + bStartM);
    if (breakDuration < 15 || breakDuration % 15 !== 0) {
      throw new BadRequestException('Break duration must be at least 15 minutes and divisible by 15.');
    }

    const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
    const tz = salon?.timezone || 'Asia/Kolkata';

    // Verify break does not conflict with existing future appointments for this stylist
    const now = new Date();
    const futureAppointments = await this.prisma.appointment.findMany({
      where: {
        salonId,
        stylistId: staffId,
        startAt: { gt: now },
        status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_SERVICE] },
      },
    });

    const dayAppointments = futureAppointments.filter((appt) => {
      const dayName = DateTime.fromJSDate(appt.startAt, { zone: tz }).toFormat('cccc').toUpperCase();
      return dayName === dto.dayOfWeek;
    });

    for (const appt of dayAppointments) {
      const apptStart = DateTime.fromJSDate(appt.startAt, { zone: tz }).toFormat('HH:mm');
      const apptEnd = DateTime.fromJSDate(appt.endAt, { zone: tz }).toFormat('HH:mm');

      if (apptStart < dto.endTime && apptEnd > dto.startTime) {
        throw new ConflictException(
          `Cannot schedule break at ${dto.startTime}-${dto.endTime}: stylist has existing future appointment #${appt.appointmentNumber} (${apptStart}-${apptEnd}).`,
        );
      }
    }

    const salonHours = await this.prisma.salonWorkingHours.findUnique({
      where: {
        salonId_dayOfWeek: {
          salonId,
          dayOfWeek: dto.dayOfWeek,
        },
      },
    });

    const res = await this.prisma.$transaction(async (tx) => {
      // Mark stylist with custom schedule so break is respected
      await tx.stylist.update({
        where: { id: staffId },
        data: { followsSalonSchedule: false },
      });

      return tx.stylistWorkingHours.upsert({
        where: {
          stylistId_dayOfWeek: {
            stylistId: staffId,
            dayOfWeek: dto.dayOfWeek,
          },
        },
        update: {
          breakStartTime: dto.startTime,
          breakEndTime: dto.endTime,
        },
        create: {
          stylistId: staffId,
          dayOfWeek: dto.dayOfWeek,
          isWorking: salonHours ? !salonHours.isClosed : true,
          startTime: salonHours?.startTime || '09:00',
          endTime: salonHours?.endTime || '21:00',
          breakStartTime: dto.startTime,
          breakEndTime: dto.endTime,
        },
      });
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      staffId,
      action: 'UPDATE_HOURS',
    });

    return {
      id: res.id,
      dayOfWeek: res.dayOfWeek,
      startTime: res.breakStartTime,
      endTime: res.breakEndTime,
      title: dto.title || 'Shift Break',
    };
  }

  async deleteStaffBreak(salonId: string, staffId: string, breakId: string) {
    await this.getStaffById(salonId, staffId);

    const isDay = Object.values(DayOfWeek).includes(breakId.toUpperCase() as DayOfWeek);
    if (isDay) {
      await this.prisma.stylistWorkingHours.updateMany({
        where: { stylistId: staffId, dayOfWeek: breakId.toUpperCase() as DayOfWeek },
        data: { breakStartTime: null, breakEndTime: null },
      });
    } else {
      await this.prisma.stylistWorkingHours.updateMany({
        where: { id: breakId, stylistId: staffId },
        data: { breakStartTime: null, breakEndTime: null },
      });
    }

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      staffId,
      action: 'UPDATE_HOURS',
    });

    return { success: true };
  }
}
