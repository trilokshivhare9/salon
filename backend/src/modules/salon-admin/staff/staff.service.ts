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
  UpdateStaffBreakDto,
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
  ) { }

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
        breaks: {
          orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
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
        breaks: {
          orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
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

      // Clone Salon Facility Working Hours to new stylist (Hard Architecture Contract)
      const salonHours = await tx.salonWorkingHours.findMany({
        where: { salonId },
      });
      if (salonHours.length > 0) {
        await tx.stylistWorkingHours.createMany({
          data: salonHours.map((sh: any) => ({
            salonId,
            stylistId: stylist.id,
            salonWorkingHoursId: sh.id,
            dayOfWeek: sh.dayOfWeek,
            isWorking: !sh.isClosed,
            isCustomized: false,
            startTime: sh.startTime,
            endTime: sh.endTime,
          })),
        });
      }

      // Clone Salon Facility Routine Breaks to new stylist
      const salonBreaks = await tx.salonBreak.findMany({
        where: { salonId },
      });
      if (salonBreaks.length > 0) {
        await tx.stylistBreak.createMany({
          data: salonBreaks.map((sb: any) => ({
            salonId,
            stylistId: stylist.id,
            salonBreakId: sb.id,
            dayOfWeek: sb.dayOfWeek,
            title: sb.title,
            startTime: sb.startTime,
            endTime: sb.endTime,
            isCustomized: false,
          })),
        });
      }

      return tx.stylist.findUnique({
        where: { id: stylist.id },
        include: {
          services: { include: { service: true } },
          workingHours: true,
          breaks: true,
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
      const salonBreaks = await this.prisma.salonBreak.findMany({ where: { salonId } });
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

        const breaksForDay = salonBreaks.filter((b) => b.dayOfWeek === dayOfWeek);
        for (const sb of breaksForDay) {
          if (apptStart < sb.endTime && apptEnd > sb.startTime) {
            throw new ConflictException(
              `Cannot switch stylist to salon schedule: future appointment #${appt.appointmentNumber} conflicts with salon break on ${dayOfWeek}.`,
            );
          }
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

    // 1. Sanitize and deduplicate target service IDs
    const serviceIds = Array.from(new Set(dto.serviceIds || []));

    if (serviceIds.length > 0) {
      // Verify all services belong to this salon and are ACTIVE
      const matchingServices = await this.prisma.service.findMany({
        where: {
          id: { in: serviceIds },
          salonId,
          status: ServiceStatus.ACTIVE,
        },
      });

      if (matchingServices.length !== serviceIds.length) {
        throw new BadRequestException(
          'One or more services do not exist, are inactive, or do not belong to this salon.',
        );
      }
    }

    const res = await this.prisma.$transaction(async (tx) => {
      const targetSet = new Set(serviceIds);

      // If user deselected all services, perform an unconditional clean wipe
      if (targetSet.size === 0) {
        await tx.stylistService.deleteMany({
          where: { stylistId: staffId },
        });
      } else {
        // 2. Fetch current assignments to perform atomic diffing
        const currentAssignments = await tx.stylistService.findMany({
          where: { stylistId: staffId },
          select: { serviceId: true },
        });
        const currentSet = new Set(currentAssignments.map((c) => c.serviceId));

        // 3. Atomically remove only deselected services
        const toRemove = [...currentSet].filter((id) => !targetSet.has(id));
        if (toRemove.length > 0) {
          await tx.stylistService.deleteMany({
            where: {
              stylistId: staffId,
              serviceId: { in: toRemove },
            },
          });
        }

        // 4. Atomically insert only newly selected services (with duplicate safety)
        const toAdd = [...targetSet].filter((id) => !currentSet.has(id));
        if (toAdd.length > 0) {
          await tx.stylistService.createMany({
            data: toAdd.map((serviceId) => ({
              salonId,
              stylistId: staffId,
              serviceId,
            })),
            skipDuplicates: true,
          });
        }
      }

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

        // Shift Time Validation & Seamless Salon Operating Schedule Harmonization
        if (item.isWorking) {
          if (item.startTime >= item.endTime) {
            throw new BadRequestException('Shift start time must be earlier than shift end time.');
          }

          // Harmonize Salon Operating Schedule with Stylist Shift:
          // In enterprise salon operations, scheduled stylist shifts define facility readiness.
          // If an admin schedules staff to start earlier, work later, or cover a previously closed day,
          // the salon facility schedule seamlessly expands to accommodate the operational window.
          if (!salonHours) {
            await tx.salonWorkingHours.create({
              data: {
                salonId,
                dayOfWeek: item.dayOfWeek,
                isClosed: false,
                startTime: item.startTime,
                endTime: item.endTime,
              },
            });
          } else {
            const needExpandStart = !salonHours.startTime || item.startTime < salonHours.startTime;
            const needExpandEnd = !salonHours.endTime || item.endTime > salonHours.endTime;
            const needReopen = Boolean(salonHours.isClosed);

            if (needExpandStart || needExpandEnd || needReopen) {
              const newStart = needExpandStart ? item.startTime : salonHours.startTime;
              const newEnd = needExpandEnd ? item.endTime : salonHours.endTime;
              await tx.salonWorkingHours.update({
                where: { salonId_dayOfWeek: { salonId, dayOfWeek: item.dayOfWeek } },
                data: {
                  isClosed: false,
                  startTime: newStart,
                  endTime: newEnd,
                },
              });
            }
          }
        }

        let breaksToSave: any[] = [];

        if (item.breaks && Array.isArray(item.breaks)) {
          for (const b of item.breaks) {
            if (b.startTime >= b.endTime) {
              throw new BadRequestException(`Break start time ${b.startTime} must be earlier than break end time ${b.endTime}.`);
            }
            if (item.isWorking && (b.startTime < item.startTime || b.endTime > item.endTime)) {
              // Gracefully omit breaks that no longer fit inside the new shift window
              continue;
            }
            breaksToSave.push({
              id: b.id || crypto.randomUUID(),
              startTime: b.startTime,
              endTime: b.endTime,
              title: b.title || 'Shift Break',
            });
          }
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
          },
          create: {
            salonId,
            stylistId: staffId,
            dayOfWeek: item.dayOfWeek,
            isWorking: item.isWorking,
            startTime: item.startTime,
            endTime: item.endTime,
          },
        });

        // Sync to first-class StylistBreak table
        if (item.breaks !== undefined) {
          const existingStylistBreaks = await tx.stylistBreak.findMany({
            where: { salonId, stylistId: staffId, dayOfWeek: item.dayOfWeek },
          });

          // Delete breaks that are no longer present
          for (const ex of existingStylistBreaks) {
            const stillPresent = breaksToSave.some(
              (b) => b.startTime === ex.startTime && b.endTime === ex.endTime,
            );
            if (!stillPresent) {
              await tx.stylistBreak.delete({ where: { id: ex.id } });
            }
          }

          // Add newly added breaks
          for (const b of breaksToSave) {
            const existing = existingStylistBreaks.find(
              (ex) => ex.startTime === b.startTime && ex.endTime === b.endTime,
            );
            if (!existing) {
              const matchingSalonBreak = await tx.salonBreak.findFirst({
                where: {
                  salonId,
                  dayOfWeek: item.dayOfWeek,
                  startTime: b.startTime,
                  endTime: b.endTime,
                },
              });

              await tx.stylistBreak.create({
                data: {
                  salonId,
                  stylistId: staffId,
                  salonBreakId: matchingSalonBreak ? matchingSalonBreak.id : null,
                  dayOfWeek: item.dayOfWeek,
                  title: b.title || 'Break',
                  startTime: b.startTime,
                  endTime: b.endTime,
                  isCustomized: matchingSalonBreak ? false : true,
                },
              });
            }
          }
        }
      }

      // Ensure global salon default start/end hours accommodate the widest shifts
      const activeWorkingHours = dto.hours.filter((h) => h.isWorking);
      if (activeWorkingHours.length > 0) {
        const earliestStart = activeWorkingHours.reduce(
          (min, h) => (!min || h.startTime < min ? h.startTime : min),
          activeWorkingHours[0].startTime,
        );
        const latestEnd = activeWorkingHours.reduce(
          (max, h) => (!max || h.endTime > max ? h.endTime : max),
          activeWorkingHours[0].endTime,
        );

        const salonRecord = await tx.salon.findUnique({
          where: { id: salonId },
          select: { defaultStartTime: true, defaultEndTime: true },
        });

        if (salonRecord) {
          let updateData: any = null;
          if (!salonRecord.defaultStartTime || earliestStart < salonRecord.defaultStartTime) {
            updateData = updateData || {};
            updateData.defaultStartTime = earliestStart;
          }
          if (!salonRecord.defaultEndTime || latestEnd > salonRecord.defaultEndTime) {
            updateData = updateData || {};
            updateData.defaultEndTime = latestEnd;
          }
          if (updateData) {
            await tx.salon.update({
              where: { id: salonId },
              data: updateData,
            });
          }
        }
      }

      const [finalHours, finalBreaks] = await Promise.all([
        tx.stylistWorkingHours.findMany({
          where: { stylistId: staffId },
          orderBy: { dayOfWeek: 'asc' },
        }),
        tx.stylistBreak.findMany({
          where: { stylistId: staffId },
          orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
        }),
      ]);

      return finalHours.map((h) => ({
        ...h,
        breaks: finalBreaks
          .filter((b) => b.dayOfWeek === h.dayOfWeek)
          .map((b) => ({
            id: b.id,
            salonBreakId: b.salonBreakId,
            title: b.title,
            startTime: b.startTime,
            endTime: b.endTime,
            isCustomized: b.isCustomized,
          })),
      }));
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

    const stylistBreaks = await this.prisma.stylistBreak.findMany({
      where: { salonId, stylistId: staffId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });

    return stylistBreaks.map((b) => ({
      id: b.id,
      salonBreakId: b.salonBreakId,
      dayOfWeek: b.dayOfWeek,
      startTime: b.startTime,
      endTime: b.endTime,
      title: b.title,
      isCustomized: b.isCustomized,
      origin: b.isCustomized ? (b.salonBreakId ? 'CUSTOMIZED' : 'PERSONAL') : 'SALON',
      isLocked: false,
    }));
  }

  async createStaffBreak(salonId: string, staffId: string, dto: CreateStaffBreakDto) {
    await this.getStaffById(salonId, staffId);

    if (dto.startTime >= dto.endTime) {
      throw new BadRequestException('Break start time must be earlier than end time');
    }

    const [bStartH, bStartM] = dto.startTime.split(':').map(Number);
    const [bEndH, bEndM] = dto.endTime.split(':').map(Number);
    const breakDuration = (bEndH * 60 + bEndM) - (bStartH * 60 + bStartM);
    if (breakDuration < 15 || breakDuration % 15 !== 0) {
      throw new BadRequestException('Break duration must be at least 15 minutes and divisible by 15.');
    }

    // 1. Check if this break overlaps with any existing break of this stylist on this day
    const existingBreaks = await this.prisma.stylistBreak.findMany({
      where: { stylistId: staffId, dayOfWeek: dto.dayOfWeek },
    });
    const hasOverlap = existingBreaks.some(
      (b) => b.startTime < dto.endTime && b.endTime > dto.startTime,
    );
    if (hasOverlap) {
      throw new BadRequestException('This break time overlaps with an existing scheduled break on this day.');
    }

    const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
    const tz = salon?.timezone || TimeUtility.DEFAULT_TIMEZONE;

    // 2. Check for future appointment collisions
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

    // 3. Create StylistBreak record (personal break)
    const stylistBreak = await this.prisma.stylistBreak.create({
      data: {
        salonId,
        stylistId: staffId,
        salonBreakId: null,
        dayOfWeek: dto.dayOfWeek,
        title: dto.title || 'Personal Break',
        startTime: dto.startTime,
        endTime: dto.endTime,
        isCustomized: true,
      },
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      staffId,
      action: 'CREATE_BREAK',
    });

    return {
      id: stylistBreak.id,
      dayOfWeek: stylistBreak.dayOfWeek,
      startTime: stylistBreak.startTime,
      endTime: stylistBreak.endTime,
      title: stylistBreak.title,
      isCustomized: true,
      origin: 'STYLIST',
      isLocked: false,
    };
  }

  async updateStaffBreak(salonId: string, staffId: string, breakId: string, dto: UpdateStaffBreakDto) {
    await this.getStaffById(salonId, staffId);

    const existingBreak = await this.prisma.stylistBreak.findUnique({
      where: { id: breakId },
    });
    if (!existingBreak || existingBreak.stylistId !== staffId) {
      throw new NotFoundException('Stylist break not found.');
    }

    const newStart = dto.startTime || existingBreak.startTime;
    const newEnd = dto.endTime || existingBreak.endTime;
    const newTitle = dto.title || existingBreak.title;

    if (newStart >= newEnd) {
      throw new BadRequestException('Break start time must be earlier than break end time.');
    }

    const otherBreaks = await this.prisma.stylistBreak.findMany({
      where: {
        stylistId: staffId,
        dayOfWeek: existingBreak.dayOfWeek,
        id: { not: breakId },
      },
    });
    const hasOverlap = otherBreaks.some(
      (b) => b.startTime < newEnd && b.endTime > newStart,
    );
    if (hasOverlap) {
      throw new BadRequestException('This updated break time overlaps with an existing scheduled break on this day.');
    }

    const updated = await this.prisma.stylistBreak.update({
      where: { id: breakId },
      data: {
        startTime: newStart,
        endTime: newEnd,
        title: newTitle,
        isCustomized: true, // Stylist customized it!
      },
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      staffId,
      action: 'UPDATE_BREAK',
    });

    return {
      id: updated.id,
      salonBreakId: updated.salonBreakId,
      dayOfWeek: updated.dayOfWeek,
      startTime: updated.startTime,
      endTime: updated.endTime,
      title: updated.title,
      isCustomized: updated.isCustomized,
      origin: updated.salonBreakId ? 'CUSTOMIZED' : 'PERSONAL',
      isLocked: false,
    };
  }

  async resetStaffBreak(salonId: string, staffId: string, breakId: string) {
    await this.getStaffById(salonId, staffId);

    const existingBreak = await this.prisma.stylistBreak.findUnique({
      where: { id: breakId },
      include: { salonBreak: true },
    });
    if (!existingBreak || existingBreak.stylistId !== staffId) {
      throw new NotFoundException('Stylist break not found.');
    }

    if (!existingBreak.salonBreakId || !existingBreak.salonBreak) {
      throw new BadRequestException('This is a personal break and cannot be reset to salon default.');
    }

    const restored = await this.prisma.stylistBreak.update({
      where: { id: breakId },
      data: {
        startTime: existingBreak.salonBreak.startTime,
        endTime: existingBreak.salonBreak.endTime,
        title: existingBreak.salonBreak.title,
        isCustomized: false, // Restored back to following salon!
      },
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      staffId,
      action: 'RESET_BREAK',
    });

    return {
      id: restored.id,
      salonBreakId: restored.salonBreakId,
      dayOfWeek: restored.dayOfWeek,
      startTime: restored.startTime,
      endTime: restored.endTime,
      title: restored.title,
      isCustomized: false,
      origin: 'SALON',
      isLocked: false,
    };
  }

  async deleteStaffBreak(salonId: string, staffId: string, breakId: string) {
    await this.getStaffById(salonId, staffId);

    const existingBreak = await this.prisma.stylistBreak.findUnique({
      where: { id: breakId },
    });
    if (!existingBreak || existingBreak.stylistId !== staffId) {
      throw new NotFoundException('Stylist break not found.');
    }

    const dayOfWeek = existingBreak.dayOfWeek;

    await this.prisma.stylistBreak.delete({
      where: { id: breakId },
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      staffId,
      action: 'UPDATE_HOURS',
    });

    return { success: true };
  }
}
