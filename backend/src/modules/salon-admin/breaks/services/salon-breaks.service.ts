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
        ...(dayOfWeek ? { dayOfWeek } : {}),
      },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
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

    const groupedMap = new Map<string, RoutineBreakSummary>();

    for (const b of rawBreaks) {
      if (byDay[b.dayOfWeek]) {
        byDay[b.dayOfWeek].push({
          id: b.id,
          title: b.title,
          startTime: b.startTime,
          endTime: b.endTime,
          createdAt: b.createdAt,
          updatedAt: b.updatedAt,
        });
      }

      const routineKey = `${b.title}_${b.startTime}_${b.endTime}`;
      if (!groupedMap.has(routineKey)) {
        groupedMap.set(routineKey, {
          routineKey,
          title: b.title,
          startTime: b.startTime,
          endTime: b.endTime,
          days: [],
          breakIds: {},
        });
      }

      const summary = groupedMap.get(routineKey)!;
      if (!summary.days.includes(b.dayOfWeek)) {
        summary.days.push(b.dayOfWeek);
      }
      summary.breakIds[b.dayOfWeek] = b.id;
    }

    return {
      totalBreaks: rawBreaks.length,
      routineBreaks: Array.from(groupedMap.values()),
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

    // Resolve target days (multi-day priority, fallback to single dayOfWeek)
    const targetDays: DayOfWeek[] = dto.days && dto.days.length > 0
      ? dto.days
      : (dto.dayOfWeek ? [dto.dayOfWeek] : ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']);

    const result = await this.prisma.$transaction(async (tx) => {
      const createdBreaks: any[] = [];
      let totalPropagated = 0;

      for (const day of targetDays) {
        // 1. Harmonize salon operating schedule for this day to comfortably cover the break
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

        // 2. Check if identical break already exists for this day
        const existing = await tx.salonBreak.findFirst({
          where: { salonId, dayOfWeek: day, startTime, endTime },
        });

        let salonBreak = existing;
        if (!existing) {
          salonBreak = await tx.salonBreak.create({
            data: {
              salonId,
              dayOfWeek: day,
              title,
              startTime,
              endTime,
            },
          });
        } else {
          salonBreak = await tx.salonBreak.update({
            where: { id: existing.id },
            data: { title },
          });
        }

        createdBreaks.push(salonBreak);

        // 3. Propagate to non-customized stylists
        const { propagatedCount } = await this.propagationEngine.propagateSalonBreak(tx, {
          salonId,
          salonBreakId: salonBreak.id,
          dayOfWeek: day,
          title,
          startTime,
          endTime,
        });
        totalPropagated += propagatedCount;
      }

      return {
        title,
        startTime,
        endTime,
        days: targetDays,
        createdCount: createdBreaks.length,
        propagatedStylistsCount: totalPropagated,
        breaks: createdBreaks,
      };
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      action: 'CREATE_FACILITY_BREAK',
      title,
      days: targetDays,
    });

    return result;
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
      // 1. Clean up old propagated stylist breaks
      await this.propagationEngine.cleanupPropagatedBreaks(tx, breakId);

      // 2. Update break
      const sb = await tx.salonBreak.update({
        where: { id: breakId },
        data: {
          title: newTitle,
          startTime: newStart,
          endTime: newEnd,
        },
      });

      // 3. Re-propagate to stylists
      await this.propagationEngine.propagateSalonBreak(tx, {
        salonId,
        salonBreakId: sb.id,
        dayOfWeek: sb.dayOfWeek,
        title: sb.title,
        startTime: sb.startTime,
        endTime: sb.endTime,
      });

      return sb;
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      action: 'UPDATE_FACILITY_BREAK',
      breakId,
    });

    return updated;
  }

  /**
   * Updates a routine break pattern across its active days.
   */
  async updateRoutineBreak(salonId: string, dto: UpdateRoutineBreakDto) {
    const { title, startTime, endTime, days } = dto;
    if (startTime >= endTime) {
      throw new BadRequestException('Break start time must be earlier than break end time.');
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
   * Deletes a routine break across days matching the title & time window.
   */
  async deleteRoutineBreak(salonId: string, dto: DeleteRoutineBreakDto) {
    const { title, startTime, endTime, days } = dto;

    const matchingBreaks = await this.prisma.salonBreak.findMany({
      where: {
        salonId,
        startTime,
        endTime,
        ...(title ? { title } : {}),
        ...(days && days.length > 0 ? { dayOfWeek: { in: days } } : {}),
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
