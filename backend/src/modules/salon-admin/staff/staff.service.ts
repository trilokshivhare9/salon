import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import {
  CreateStaffDto,
  UpdateStaffDto,
  AssignStaffServicesDto,
  UpdateStaffWorkingHoursDto,
  CreateStaffBreakDto,
} from './dto/create-staff.dto';
import { StylistStatus, ServiceStatus, SalonStatus, DayOfWeek, AppointmentStatus } from '@prisma/client';
import { AppointmentsService } from '../appointments/appointments.service';
import { StylistStatusEngine, StylistOperationalStatus } from './engines/stylist-status.engine';
import { TimeUtility } from '../../../common/utils/time.utility';
import { DateTime } from 'luxon';
import * as crypto from 'crypto';

@Injectable()
export class StaffService {
  constructor(
    private prisma: PrismaService,
    private appointmentsService: AppointmentsService,
    private statusEngine: StylistStatusEngine,
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

  async getSalonStaff(salonId: string, targetDateStr?: string) {
    const stylists = await this.prisma.stylist.findMany({
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
        absences: {
          where: { status: 'ACTIVE' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const statusMap = await this.statusEngine.resolveSalonStaffStatuses(salonId, {
      targetDate: targetDateStr,
      stylists,
    });

    return stylists.map((st) => this.statusEngine.attachOperationalStatus(st, statusMap.get(st.id)));
  }

  async getStaffById(salonId: string, staffId: string, targetDateStr?: string) {
    const stylist = await this.prisma.stylist.findFirst({
      where: { id: staffId, salonId },
      include: {
        services: {
          include: { service: true },
        },
        workingHours: {
          orderBy: { dayOfWeek: 'asc' },
        },
        absences: {
          where: { status: 'ACTIVE' },
        },
      },
    });

    if (!stylist) {
      throw new NotFoundException('Stylist not found.');
    }

    const statusMap = await this.statusEngine.resolveSalonStaffStatuses(salonId, {
      targetDate: targetDateStr,
      stylistId: staffId,
      stylists: [stylist],
    });

    return this.statusEngine.attachOperationalStatus(stylist, statusMap.get(staffId));
  }

  async createStaff(salonId: string, dto: CreateStaffDto) {
    let serviceIds: string[] = [];

    if (dto.serviceIds !== undefined) {
      serviceIds = (dto.serviceIds || []).filter(Boolean);
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
    } else {
      // Default: auto-assign all active services in the salon so staff can take bookings immediately
      const activeServices = await this.prisma.service.findMany({
        where: { salonId, status: ServiceStatus.ACTIVE },
        select: { id: true },
      });
      serviceIds = activeServices.map((s) => s.id);
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

      // Link assigned services if any
      if (serviceIds.length > 0) {
        await tx.stylistService.createMany({
          data: serviceIds.map((serviceId) => ({
            salonId,
            stylistId: stylist.id,
            serviceId,
          })),
          skipDuplicates: true,
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
      const tz = salon?.timezone || TimeUtility.DEFAULT_TIMEZONE;
      const salonHours = await this.prisma.salonWorkingHours.findMany({ where: { salonId } });
      const hoursMap = new Map(salonHours.map((h) => [h.dayOfWeek, h]));

      const now = new Date();
      const futureAppointments = await this.prisma.appointment.findMany({
        where: {
          salonId,
          stylistId: staffId,
          startAt: { gt: now },
          status: { in: [AppointmentStatus.BOOKED, AppointmentStatus.CONFIRMED, AppointmentStatus.ON_THE_WAY, AppointmentStatus.CHECKED_IN, AppointmentStatus.SEATED_IN_CHAIR] },
        },
      });

      for (const appt of futureAppointments) {
        const dayOfWeek = DateTime.fromJSDate(appt.startAt, { zone: tz }).toFormat('cccc').toUpperCase() as DayOfWeek;
        const sh: any = hoursMap.get(dayOfWeek);
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
    const tz = salon.timezone || TimeUtility.DEFAULT_TIMEZONE;

    const res = await this.prisma.$transaction(async (tx) => {
      const followsSchedule = dto.followsSalonSchedule !== undefined ? dto.followsSalonSchedule : (dto.hours && dto.hours.length > 0 ? false : true);
      await tx.stylist.update({
        where: { id: staffId },
        data: { followsSalonSchedule: followsSchedule },
      });

      if (followsSchedule) {
        await tx.stylistWorkingHours.deleteMany({
          where: { stylistId: staffId },
        });
        return [];
      }

      const now = new Date();
      const futureAppointments = await tx.appointment.findMany({
        where: {
          salonId,
          stylistId: staffId,
          startAt: { gt: now },
          status: { in: [AppointmentStatus.BOOKED, AppointmentStatus.CONFIRMED, AppointmentStatus.ON_THE_WAY, AppointmentStatus.CHECKED_IN, AppointmentStatus.SEATED_IN_CHAIR] },
        },
      });

      for (const item of dto.hours) {
        // Level 1: Acquire exclusive schedule lock for this day
        const key1 = this.hashToSignedInt32(`salon:${salonId}`);
        const scheduleKey2 = this.hashToSignedInt32(`schedule:${item.dayOfWeek}`);
        await tx.$executeRawUnsafe(
          `SELECT pg_advisory_xact_lock(${key1}, ${scheduleKey2})`,
        );

        // Fetch Salon Working Hours for this day of week
        const salonHours = await tx.salonWorkingHours.findUnique({
          where: { salonId_dayOfWeek: { salonId, dayOfWeek: item.dayOfWeek } },
        });

        // RULE 1 & 2: Hard Salon Boundary Validation at write time
        if (item.isWorking) {
          if (!salonHours || salonHours.isClosed) {
            throw new BadRequestException(
              `Cannot set working hours on ${item.dayOfWeek}: salon is closed on this day.`,
            );
          }
          if (salonHours.startTime && item.startTime < salonHours.startTime) {
            throw new BadRequestException(
              `Stylist start time ${item.startTime} cannot be earlier than salon opening time ${salonHours.startTime} on ${item.dayOfWeek}.`,
            );
          }
          if (salonHours.endTime && item.endTime > salonHours.endTime) {
            throw new BadRequestException(
              `Stylist end time ${item.endTime} cannot be later than salon closing time ${salonHours.endTime} on ${item.dayOfWeek}.`,
            );
          }
          if (item.startTime >= item.endTime) {
            throw new BadRequestException('Shift start time must be earlier than shift end time.');
          }
        }

        const hasOverride = item.hasBreakOverride ?? (item.breaks && item.breaks.length > 0);
        let breaksToSave: any[] = [];

        if (hasOverride && item.breaks && item.breaks.length > 0) {
          for (const b of item.breaks) {
            if (b.startTime >= b.endTime) {
              throw new BadRequestException(`Break start time ${b.startTime} must be earlier than break end time ${b.endTime}.`);
            }
            if (item.isWorking && (b.startTime < item.startTime || b.endTime > item.endTime)) {
              throw new BadRequestException(`Break ${b.startTime}-${b.endTime} must fall strictly within working hours (${item.startTime}-${item.endTime}).`);
            }
            breaksToSave.push({
              id: b.id || crypto.randomUUID(),
              startTime: b.startTime,
              endTime: b.endTime,
              title: b.title || 'Shift Break',
            });
          }
        } else if (item.breakStartTime && item.breakEndTime) {
          if (item.breakStartTime >= item.breakEndTime) {
            throw new BadRequestException('Break start time must be earlier than break end time.');
          }
          breaksToSave.push({
            id: crypto.randomUUID(),
            startTime: item.breakStartTime,
            endTime: item.breakEndTime,
            title: 'Lunch Break',
          });
        }

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

            for (const b of breaksToSave) {
              if (apptStart < b.endTime && apptEnd > b.startTime) {
                throw new ConflictException(
                  `Cannot set stylist break on ${item.dayOfWeek} to ${b.startTime}-${b.endTime}: future appointment #${appt.appointmentNumber} conflicts with the break.`,
                );
              }
            }
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
            hasBreakOverride: hasOverride,
            breaks: breaksToSave,
            breakStartTime: item.breakStartTime || null,
            breakEndTime: item.breakEndTime || null,
          },
          create: {
            stylistId: staffId,
            dayOfWeek: item.dayOfWeek,
            isWorking: item.isWorking,
            startTime: item.startTime,
            endTime: item.endTime,
            hasBreakOverride: hasOverride,
            breaks: breaksToSave,
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
            status: { in: [AppointmentStatus.BOOKED, AppointmentStatus.CONFIRMED, AppointmentStatus.ON_THE_WAY, AppointmentStatus.CHECKED_IN, AppointmentStatus.SEATED_IN_CHAIR] },
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

    // 1. Fetch Salon Facility Breaks (The Immutable Foundation)
    const salonWorkingHours = await this.prisma.salonWorkingHours.findMany({
      where: { salonId },
      orderBy: { dayOfWeek: 'asc' },
    });

    const salonBreaks: any[] = [];
    for (const s of salonWorkingHours) {
      if (!s.isClosed) {
        if (Array.isArray(s.breaks) && s.breaks.length > 0) {
          for (const b of (s.breaks as any[])) {
            salonBreaks.push({
              id: b.id || `salon-brk-${s.dayOfWeek}-${b.startTime}`,
              dayOfWeek: s.dayOfWeek,
              startTime: b.startTime,
              endTime: b.endTime,
              title: b.title || 'Salon Lunch',
              origin: 'SALON',
              isLocked: true,
            });
          }
        } else if (s.breakStartTime && s.breakEndTime) {
          salonBreaks.push({
            id: `salon-brk-${s.dayOfWeek}-legacy`,
            dayOfWeek: s.dayOfWeek,
            startTime: s.breakStartTime,
            endTime: s.breakEndTime,
            title: 'Salon Lunch',
            origin: 'SALON',
            isLocked: true,
          });
        }
      }
    }

    // 2. Fetch Stylist Personal Shift Breaks
    const stylistHours = await this.prisma.stylistWorkingHours.findMany({
      where: { stylistId: staffId },
      orderBy: { dayOfWeek: 'asc' },
    });

    const stylistPersonalBreaks: any[] = [];
    for (const st of stylistHours) {
      if (st.isWorking && st.hasBreakOverride) {
        if (Array.isArray(st.breaks) && st.breaks.length > 0) {
          for (const b of (st.breaks as any[])) {
            stylistPersonalBreaks.push({
              id: b.id || `st-brk-${st.dayOfWeek}-${b.startTime}`,
              dayOfWeek: st.dayOfWeek,
              startTime: b.startTime,
              endTime: b.endTime,
              title: b.title || 'Personal Break',
              origin: 'STYLIST',
              isLocked: false,
            });
          }
        } else if (st.breakStartTime && st.breakEndTime) {
          stylistPersonalBreaks.push({
            id: `st-brk-${st.dayOfWeek}-legacy`,
            dayOfWeek: st.dayOfWeek,
            startTime: st.breakStartTime,
            endTime: st.breakEndTime,
            title: 'Personal Break',
            origin: 'STYLIST',
            isLocked: false,
          });
        }
      }
    }

    // Discrete Origin-Tagged Break Collection: Both coexist with zero destructive merge
    return [...salonBreaks, ...stylistPersonalBreaks];
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

    // Check if an identical break is already covered by Salon Facility Breaks
    const salonHours = await this.prisma.salonWorkingHours.findUnique({
      where: {
        salonId_dayOfWeek: {
          salonId,
          dayOfWeek: dto.dayOfWeek,
        },
      },
    });

    if (salonHours && !salonHours.isClosed) {
      const sBreaks = Array.isArray(salonHours.breaks) ? (salonHours.breaks as any[]) : [];
      const exactMatch = sBreaks.find((b: any) => b.startTime === dto.startTime && b.endTime === dto.endTime);
      if (exactMatch || (salonHours.breakStartTime === dto.startTime && salonHours.breakEndTime === dto.endTime)) {
        throw new BadRequestException(`This break time (${dto.startTime}-${dto.endTime}) is already active as a Salon Facility Break. All stylists observe it automatically.`);
      }
    }

    const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
    const tz = salon?.timezone || TimeUtility.DEFAULT_TIMEZONE;

    // Verify break does not conflict with existing future appointments for this stylist
    const now = new Date();
    const futureAppointments = await this.prisma.appointment.findMany({
      where: {
        salonId,
        stylistId: staffId,
        startAt: { gt: now },
        status: { in: [AppointmentStatus.BOOKED, AppointmentStatus.CONFIRMED, AppointmentStatus.ON_THE_WAY, AppointmentStatus.CHECKED_IN, AppointmentStatus.SEATED_IN_CHAIR] },
      },
    });

    const dayAppointments = futureAppointments.filter((appt) => {
      const dayName = DateTime.fromJSDate(appt.startAt, { zone: tz }).toFormat('cccc').toUpperCase();
      return dayName === dto.dayOfWeek;
    });

    const conflictingAppts: any[] = [];
    for (const appt of dayAppointments) {
      const apptStart = DateTime.fromJSDate(appt.startAt, { zone: tz }).toFormat('HH:mm');
      const apptEnd = DateTime.fromJSDate(appt.endAt, { zone: tz }).toFormat('HH:mm');

      if (apptStart < dto.endTime && apptEnd > dto.startTime) {
        conflictingAppts.push({ appt, apptStart, apptEnd });
      }
    }

    if (conflictingAppts.length > 0) {
      if (dto.autoReschedule) {
        // Automatically flag conflicting appointments for rescheduling
        for (const c of conflictingAppts) {
          await this.prisma.appointment.update({
            where: { id: c.appt.id },
            data: { status: AppointmentStatus.PENDING_RESCHEDULE },
          });
        }
      } else {
        const c = conflictingAppts[0];
        throw new ConflictException(
          `Cannot schedule break at ${dto.startTime}-${dto.endTime}: stylist has existing future appointment #${c.appt.appointmentNumber} (${c.apptStart}-${c.apptEnd}). Enable auto-reschedule to notify the customer.`,
        );
      }
    }

    const newBreakId = crypto.randomUUID();
    const newBreakItem = {
      id: newBreakId,
      origin: 'STYLIST',
      startTime: dto.startTime,
      endTime: dto.endTime,
      title: dto.title || 'Personal Break',
    };

    const res = await this.prisma.$transaction(async (tx) => {
      const existingRecord = await tx.stylistWorkingHours.findUnique({
        where: {
          stylistId_dayOfWeek: {
            stylistId: staffId,
            dayOfWeek: dto.dayOfWeek,
          },
        },
      });

      let existingBreaks: any[] = [];
      if (existingRecord && Array.isArray(existingRecord.breaks)) {
        existingBreaks = [...(existingRecord.breaks as any[])];
      }

      existingBreaks.push(newBreakItem);

      return tx.stylistWorkingHours.upsert({
        where: {
          stylistId_dayOfWeek: {
            stylistId: staffId,
            dayOfWeek: dto.dayOfWeek,
          },
        },
        update: {
          hasBreakOverride: true,
          breaks: existingBreaks,
          breakStartTime: dto.startTime,
          breakEndTime: dto.endTime,
        },
        create: {
          stylistId: staffId,
          dayOfWeek: dto.dayOfWeek,
          isWorking: salonHours ? !salonHours.isClosed : true,
          startTime: salonHours?.startTime || '09:00',
          endTime: salonHours?.endTime || '21:00',
          hasBreakOverride: true,
          breaks: existingBreaks,
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
      id: newBreakId,
      dayOfWeek: res.dayOfWeek,
      startTime: dto.startTime,
      endTime: dto.endTime,
      title: dto.title || 'Personal Break',
      origin: 'STYLIST',
      isLocked: false,
    };
  }

  async deleteStaffBreak(salonId: string, staffId: string, breakId: string) {
    await this.getStaffById(salonId, staffId);

    // Guard: Salon Facility Breaks CANNOT be deleted at stylist level
    const salonWorkingHours = await this.prisma.salonWorkingHours.findMany({
      where: { salonId },
    });

    for (const s of salonWorkingHours) {
      if (Array.isArray(s.breaks)) {
        const foundSalonBreak = (s.breaks as any[]).find((b: any) => b.id === breakId);
        if (foundSalonBreak || breakId.startsWith(`salon-brk-`)) {
          throw new BadRequestException(
            'Salon facility breaks cannot be deleted at the stylist level. Please modify or remove them in the Salon Operating Schedule.',
          );
        }
      }
    }

    // Delete from stylist personal breaks
    const stylistHours = await this.prisma.stylistWorkingHours.findMany({
      where: { stylistId: staffId },
    });

    for (const st of stylistHours) {
      if (Array.isArray(st.breaks)) {
        const remaining = (st.breaks as any[]).filter((b: any) => b.id !== breakId);
        if (remaining.length !== (st.breaks as any[]).length) {
          await this.prisma.stylistWorkingHours.update({
            where: { id: st.id },
            data: {
              breaks: remaining,
              hasBreakOverride: remaining.length > 0,
              breakStartTime: remaining.length > 0 ? remaining[0].startTime : null,
              breakEndTime: remaining.length > 0 ? remaining[0].endTime : null,
            },
          });
        }
      } else if (st.id === breakId || breakId.toUpperCase() === st.dayOfWeek) {
        await this.prisma.stylistWorkingHours.update({
          where: { id: st.id },
          data: { breakStartTime: null, breakEndTime: null, breaks: [], hasBreakOverride: false },
        });
      }
    }

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      staffId,
      action: 'UPDATE_HOURS',
    });

    return { success: true };
  }
}
