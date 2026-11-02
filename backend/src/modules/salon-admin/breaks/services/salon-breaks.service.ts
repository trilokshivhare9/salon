import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { DayOfWeek } from '@prisma/client';
import { CreateFacilityBreakDto } from '../dto/create-facility-break.dto';
import { UpdateFacilityBreakDto } from '../dto/update-facility-break.dto';
import { UpdateRoutineBreakDto, DeleteRoutineBreakDto } from '../dto/routine-break.dto';
import { BreakPropagationEngine } from './break-propagation.engine';
import { AppointmentsService } from '../../appointments/appointments.service';
import { SalonBreaksListResponse, RoutineBreakSummary } from '../interfaces/break.interface';

const ALL_DAYS: DayOfWeek[] = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
];

@Injectable()
export class SalonBreaksService {
  private readonly logger = new Logger(SalonBreaksService.name);

  constructor(
    private prisma: PrismaService,
    private propagationEngine: BreakPropagationEngine,
    @Inject(forwardRef(() => AppointmentsService))
    private appointmentsService: AppointmentsService,
  ) {}

  /**
   * Retrieves all salon facility breaks with routine break groupings.
   */
  async getSalonBreaks(salonId: string, dayOfWeek?: DayOfWeek): Promise<SalonBreaksListResponse> {
    const rawBreaks = await this.prisma.salonBreak.findMany({
      where: {
        salonId,
        ...(dayOfWeek ? { days: { has: dayOfWeek } } : {}),
      },
      orderBy: { startTime: 'asc' },
    });

    const byDay: Record<string, any[]> = {
      MONDAY: [],
      TUESDAY: [],
      WEDNESDAY: [],
      THURSDAY: [],
      FRIDAY: [],
      SATURDAY: [],
      SUNDAY: [],
    };

    const routineBreaks: RoutineBreakSummary[] = [];

    for (const b of rawBreaks) {
      for (const d of b.days) {
        if (byDay[d]) {
          byDay[d].push({
            id: b.id,
            title: b.title,
            startTime: b.startTime,
            endTime: b.endTime,
            createdAt: b.createdAt,
            updatedAt: b.updatedAt,
          });
        }
      }

      routineBreaks.push({
        routineKey: `${b.title}_${b.startTime}_${b.endTime}`,
        salonBreakId: b.id,
        title: b.title,
        startTime: b.startTime,
        endTime: b.endTime,
        days: b.days,
        breakIds: Object.fromEntries(b.days.map((d) => [d, b.id])),
      });
    }

    return {
      totalBreaks: rawBreaks.length,
      routineBreaks,
      byDay,
    };
  }

  /**
   * Creates a facility break across one or multiple days atomically.
   */
  async createFacilityBreak(salonId: string, dto: CreateFacilityBreakDto) {
    const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
    if (!salon) throw new NotFoundException('Salon not found.');

    const { title, startTime, endTime } = dto;
    if (startTime >= endTime) {
      throw new BadRequestException('Break start time must be earlier than break end time.');
    }

    const [sH, sM] = startTime.split(':').map(Number);
    const [eH, eM] = endTime.split(':').map(Number);
    const duration = (eH * 60 + (eM || 0)) - (sH * 60 + (sM || 0));
    if (duration < 15) {
      throw new BadRequestException('Break duration must be at least 15 minutes.');
    }

    const targetDays: DayOfWeek[] = dto.days && dto.days.length > 0
      ? dto.days
      : (dto.dayOfWeek ? [dto.dayOfWeek] : ALL_DAYS);

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Harmonize operating schedule for target days if needed
      for (const day of targetDays) {
        const salonHours = await tx.salonWorkingHours.findUnique({
          where: { salonId_dayOfWeek: { salonId, dayOfWeek: day } },
        });

        if (!salonHours) {
          await tx.salonWorkingHours.create({
            data: {
              salonId,
              dayOfWeek: day,
              isClosed: false,
              startTime,
              endTime,
            },
          });
        } else {
          const needStart = !salonHours.startTime || startTime < salonHours.startTime;
          const needEnd = !salonHours.endTime || endTime > salonHours.endTime;
          if (needStart || needEnd) {
            await tx.salonWorkingHours.update({
              where: { salonId_dayOfWeek: { salonId, dayOfWeek: day } },
              data: {
                isClosed: false,
                startTime: needStart ? startTime : salonHours.startTime,
                endTime: needEnd ? endTime : salonHours.endTime,
              },
            });
          }
        }
      }

      // 2. Check if a break with exact title, startTime, endTime already exists
      const existing = await tx.salonBreak.findFirst({
        where: { salonId, startTime, endTime, title },
      });

      let salonBreak;
      if (existing) {
        const combinedDays = Array.from(new Set([...existing.days, ...targetDays]));
        salonBreak = await tx.salonBreak.update({
          where: { id: existing.id },
          data: { days: combinedDays },
        });
      } else {
        salonBreak = await tx.salonBreak.create({
          data: {
            salonId,
            title,
            startTime,
            endTime,
            days: targetDays,
          },
        });
      }

      // 3. Propagate to non-customized stylists
      const { propagatedCount } = await this.propagationEngine.propagateSalonBreak(tx, {
        salonId,
        salonBreakId: salonBreak.id,
        days: salonBreak.days,
        title,
        startTime,
        endTime,
      });

      return {
        salonBreak,
        propagatedStylistsCount: propagatedCount,
      };
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      action: 'CREATE_FACILITY_BREAK',
      title,
      days: targetDays,
    });

    // Resolve any conflicting bookings across salon facility and send WhatsApp reschedule proposal
    for (const day of targetDays) {
      await this.appointmentsService.resolveScheduleConflicts({
        salonId,
        scope: 'SALON',
        dayOfWeek: day,
        breakHours: { startTime, endTime },
        isClosedOrOff: false,
        reason: `Salon facility break (${title}) on ${day} (${startTime}–${endTime})`,
      });
    }

    return {
      title,
      startTime,
      endTime,
      days: targetDays,
      breakId: result.salonBreak.id,
      propagatedStylistsCount: result.propagatedStylistsCount,
      breaks: [result.salonBreak],
    };
  }

  /**
   * Updates a specific salon facility break by ID.
   */
  async updateFacilityBreak(salonId: string, breakId: string, dto: UpdateFacilityBreakDto) {
    const existing = await this.prisma.salonBreak.findFirst({
      where: { id: breakId, salonId },
    });
    if (!existing) throw new NotFoundException('Salon break not found.');

    const newTitle = dto.title ?? existing.title;
    const newStart = dto.startTime ?? existing.startTime;
    const newEnd = dto.endTime ?? existing.endTime;

    if (newStart >= newEnd) {
      throw new BadRequestException('Break start time must be earlier than break end time.');
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // 1. Update master salon facility break
      const sb = await tx.salonBreak.update({
        where: { id: breakId },
        data: {
          title: newTitle,
          startTime: newStart,
          endTime: newEnd,
        },
      });

      // 2. In-place sync for stylists who currently inherit this break (uncustomized).
      // Opted-out stylists have no row with salonBreakId and stay opted out.
      // Customized stylists (isCustomized === true) have their custom hours preserved.
      await tx.stylistBreak.updateMany({
        where: {
          salonBreakId: sb.id,
          isCustomized: false,
        },
        data: {
          title: sb.title,
          startTime: sb.startTime,
          endTime: sb.endTime,
          days: sb.days,
        },
      });

      return sb;
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      action: 'UPDATE_FACILITY_BREAK',
      breakId,
    });

    for (const day of updated.days) {
      await this.appointmentsService.resolveScheduleConflicts({
        salonId,
        scope: 'SALON',
        dayOfWeek: day,
        breakHours: { startTime: newStart, endTime: newEnd },
        isClosedOrOff: false,
        reason: `Salon facility break updated (${newTitle}) on ${day} (${newStart}–${newEnd})`,
      });
    }

    return updated;
  }

  /**
   * Updates a routine break pattern across its active days.
   */
  async updateRoutineBreak(salonId: string, dto: UpdateRoutineBreakDto) {
    const { title, startTime, endTime, days, salonBreakId, breakIds } = dto;
    if (startTime >= endTime) {
      throw new BadRequestException('Break start time must be earlier than break end time.');
    }

    const targetId = salonBreakId || (breakIds ? Object.values(breakIds)[0] : null);

    let existingBreak = targetId
      ? await this.prisma.salonBreak.findFirst({ where: { id: targetId, salonId } })
      : null;

    if (!existingBreak) {
      existingBreak = await this.prisma.salonBreak.findFirst({
        where: {
          salonId,
          OR: [
            { title, startTime, endTime },
            ...(dto.originalStartTime && dto.originalEndTime
              ? [{ startTime: dto.originalStartTime, endTime: dto.originalEndTime }]
              : []),
          ],
        },
      });
    }

    if (existingBreak) {
      const updated = await this.prisma.$transaction(async (tx) => {
        const sb = await tx.salonBreak.update({
          where: { id: existingBreak.id },
          data: {
            title,
            startTime,
            endTime,
            ...(days && days.length > 0 ? { days } : {}),
          },
        });

        // In-place sync for stylists who currently inherit this break (uncustomized).
        // Opted-out stylists have no row with salonBreakId and stay opted-out.
        // Customized stylists (isCustomized === true) have their custom hours preserved.
        await tx.stylistBreak.updateMany({
          where: {
            salonBreakId: sb.id,
            isCustomized: false,
          },
          data: {
            title: sb.title,
            startTime: sb.startTime,
            endTime: sb.endTime,
            days: sb.days,
          },
        });

        return sb;
      });

      return {
        success: true,
        title: updated.title,
        startTime: updated.startTime,
        endTime: updated.endTime,
        days: updated.days,
        breaks: [updated],
      };
    }

    return this.createFacilityBreak(salonId, {
      title,
      startTime,
      endTime,
      days,
    });
  }

  /**
   * Deletes a single facility break by ID.
   */
  async deleteFacilityBreak(salonId: string, breakId: string) {
    const existing = await this.prisma.salonBreak.findFirst({
      where: { id: breakId, salonId },
    });
    if (!existing) throw new NotFoundException('Salon break not found.');

    await this.prisma.$transaction(async (tx) => {
      await this.propagationEngine.cleanupPropagatedBreaks(tx, breakId);
      await tx.salonBreak.delete({ where: { id: breakId } });
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      action: 'DELETE_FACILITY_BREAK',
      breakId,
    });

    return { success: true, message: 'Facility break deleted successfully.' };
  }

  /**
   * Deletes a routine break matching ID, title, or time window.
   */
  async deleteRoutineBreak(salonId: string, dto: DeleteRoutineBreakDto) {
    const { title, startTime, endTime, salonBreakId, breakIds } = dto;

    const targetId = salonBreakId || (breakIds ? Object.values(breakIds)[0] : null);

    const matchingBreaks = await this.prisma.salonBreak.findMany({
      where: {
        salonId,
        OR: [
          ...(targetId ? [{ id: targetId }] : []),
          {
            startTime,
            endTime,
            ...(title ? { title } : {}),
          },
        ],
      },
    });

    if (matchingBreaks.length === 0) {
      return { success: true, deletedCount: 0 };
    }

    await this.prisma.$transaction(async (tx) => {
      for (const b of matchingBreaks) {
        await this.propagationEngine.cleanupPropagatedBreaks(tx, b.id);
        await tx.salonBreak.delete({ where: { id: b.id } });
      }
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      action: 'DELETE_ROUTINE_BREAK',
      startTime,
      endTime,
    });

    return { success: true, deletedCount: matchingBreaks.length };
  }
}
