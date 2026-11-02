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
import { CreateStaffBreakDto } from '../dto/create-staff-break.dto';
import { UpdateStaffBreakDto } from '../dto/update-staff-break.dto';
import { UpdateRoutineBreakDto, DeleteRoutineBreakDto, ResetRoutineBreakDto } from '../dto/routine-break.dto';
import { InheritSalonBreakDto } from '../dto/inherit-salon-break.dto';
import { AppointmentsService } from '../../appointments/appointments.service';
import { StaffBreaksListResponse, RoutineBreakSummary, InheritableSalonBreakSummary } from '../interfaces/break.interface';
import { TimeUtility } from '../../../../common/utils/time.utility';

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
export class StaffBreaksService {
  private readonly logger = new Logger(StaffBreaksService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => AppointmentsService))
    private appointmentsService: AppointmentsService,
  ) {}

  /**
   * Retrieves all breaks for a stylist (both inherited salon breaks and custom stylist breaks).
   */
  async getStaffBreaks(salonId: string, staffId: string): Promise<StaffBreaksListResponse> {
    const stylist = await this.prisma.stylist.findFirst({
      where: { id: staffId, salonId },
      include: {
        breaks: { orderBy: { startTime: 'asc' } },
      },
    });

    if (!stylist) throw new NotFoundException('Stylist not found in this salon.');

    const breaksToDisplay = stylist.breaks || [];

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

    for (const b of breaksToDisplay) {
      for (const d of (b.days || [])) {
        if (byDay[d]) {
          byDay[d].push({
            id: b.id,
            title: b.title,
            startTime: b.startTime,
            endTime: b.endTime,
            isCustomized: b.isCustomized,
            salonBreakId: b.salonBreakId,
          });
        }
      }

      routineBreaks.push({
        routineKey: `${b.title}_${b.startTime}_${b.endTime}`,
        salonBreakId: b.salonBreakId || null,
        title: b.title,
        startTime: b.startTime,
        endTime: b.endTime,
        days: b.days,
        breakIds: Object.fromEntries((b.days || []).map((d: DayOfWeek) => [d, b.id])),
        isCustomized: b.isCustomized,
      });
    }

    // Compute inheritable salon facility breaks
    const masterSalonBreaks = await this.prisma.salonBreak.findMany({
      where: { salonId },
      orderBy: { startTime: 'asc' },
    });

    const inheritableSalonBreaks: InheritableSalonBreakSummary[] = [];

    for (const master of masterSalonBreaks) {
      // Check if stylist already has this routine matching salon break hours across days
      const existingRoutine = routineBreaks.find(
        (r) =>
          r.startTime === master.startTime &&
          r.endTime === master.endTime &&
          !r.isCustomized &&
          (r.title === master.title || r.salonBreakId === master.id),
      );

      const missingDays = existingRoutine
        ? master.days.filter((d) => !existingRoutine.days.includes(d))
        : [...master.days];

      if (missingDays.length === 0) {
        continue; // Already fully matching salon break hours on all master days!
      }

      // Check conflicts on missing days
      const conflictingBreaks = breaksToDisplay.filter(
        (b: any) =>
          b.days.some((d: DayOfWeek) => missingDays.includes(d)) &&
          b.startTime < master.endTime &&
          b.endTime > master.startTime &&
          (b.salonBreakId !== master.id || b.isCustomized || b.startTime !== master.startTime || b.endTime !== master.endTime),
      );

      const hasConflict = conflictingBreaks.length > 0;
      const conflictReason = hasConflict
        ? `Overlaps with "${conflictingBreaks[0].title}" (${conflictingBreaks[0].startTime}–${conflictingBreaks[0].endTime})`
        : null;

      const isAlreadyInherited = Boolean(
        routineBreaks.find((r) => r.salonBreakId === master.id),
      );

      inheritableSalonBreaks.push({
        salonBreakId: master.id,
        title: master.title,
        startTime: master.startTime,
        endTime: master.endTime,
        days: missingDays,
        isAlreadyInherited,
        canInherit: true,
        conflictReason,
        conflictingBreakIds: conflictingBreaks.map((cb: any) => cb.id),
      });
    }

    return {
      stylistId: staffId,
      followsSalonSchedule: stylist.followsSalonSchedule,
      totalBreaks: breaksToDisplay.length,
      routineBreaks,
      inheritableSalonBreaks,
      byDay,
    };
  }

  /**
   * Adds custom break(s) for a specialist across one or multiple days.
   */
  async createStaffBreak(salonId: string, staffId: string, dto: CreateStaffBreakDto) {
    const stylist = await this.prisma.stylist.findFirst({
      where: { id: staffId, salonId },
      include: { salon: true },
    });
    if (!stylist) throw new NotFoundException('Stylist not found.');

    const title = (dto.title || 'Break').trim();
    const { startTime, endTime } = dto;

    if (startTime >= endTime) {
      throw new BadRequestException('Break start time must be earlier than break end time.');
    }

    const targetDays: DayOfWeek[] = dto.days && dto.days.length > 0
      ? dto.days
      : (dto.dayOfWeek ? [dto.dayOfWeek] : ALL_DAYS);

    // 1. Check for overlapping breaks for this stylist on targetDays
    const existingBreaks = await this.prisma.stylistBreak.findMany({
      where: { stylistId: staffId },
    });

    const overlap = existingBreaks.find(
      (b) =>
        b.startTime < endTime &&
        b.endTime > startTime &&
        b.days.some((d) => targetDays.includes(d)),
    );
    if (overlap) {
      throw new ConflictException(
        `Break time ${startTime}–${endTime} overlaps with existing break "${overlap.title}" (${overlap.startTime}–${overlap.endTime}).`,
      );
    }

    // 2. Create the customized stylist break (1 row!)
    const newBreak = await this.prisma.stylistBreak.create({
      data: {
        salonId,
        stylistId: staffId,
        title,
        startTime,
        endTime,
        days: targetDays,
        isCustomized: true,
      },
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      action: 'CREATE_STAFF_BREAK',
      staffId,
      days: targetDays,
    });

    for (const day of targetDays) {
      await this.appointmentsService.resolveScheduleConflicts({
        salonId,
        scope: 'STYLIST',
        stylistId: staffId,
        dayOfWeek: day,
        breakHours: { startTime, endTime },
        isClosedOrOff: false,
        reason: `Stylist break (${title}) on ${day} (${startTime}–${endTime})`,
      });
    }

    return {
      stylistId: staffId,
      title,
      startTime,
      endTime,
      days: targetDays,
      createdCount: 1,
      breaks: [newBreak],
    };
  }

  /**
   * Updates an individual staff break by ID.
   */
  async updateStaffBreak(salonId: string, staffId: string, breakId: string, dto: UpdateStaffBreakDto) {
    const existing = await this.prisma.stylistBreak.findFirst({
      where: { id: breakId, stylistId: staffId, salonId },
    });
    if (!existing) throw new NotFoundException('Stylist break not found.');

    const newTitle = dto.title ?? existing.title;
    const newStart = dto.startTime ?? existing.startTime;
    const newEnd = dto.endTime ?? existing.endTime;

    if (newStart >= newEnd) {
      throw new BadRequestException('Break start time must be earlier than break end time.');
    }

    const otherBreaks = await this.prisma.stylistBreak.findMany({
      where: {
        stylistId: staffId,
        id: { not: breakId },
      },
    });

    const overlap = otherBreaks.find(
      (b) =>
        b.startTime < newEnd &&
        b.endTime > newStart &&
        b.days.some((d) => existing.days.includes(d)),
    );
    if (overlap) {
      throw new ConflictException(
        `Break time ${newStart}–${newEnd} overlaps with existing break "${overlap.title}" (${overlap.startTime}–${overlap.endTime}).`,
      );
    }

    const updated = await this.prisma.stylistBreak.update({
      where: { id: breakId },
      data: {
        title: newTitle,
        startTime: newStart,
        endTime: newEnd,
        isCustomized: true,
      },
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      action: 'UPDATE_STAFF_BREAK',
      staffId,
      breakId,
    });

    return updated;
  }

  /**
   * Updates a stylist routine break pattern across days in-place.
   */
  async updateStaffRoutineBreak(salonId: string, staffId: string, dto: UpdateRoutineBreakDto) {
    const stylist = await this.prisma.stylist.findFirst({
      where: { id: staffId, salonId },
      include: { salon: true },
    });
    if (!stylist) throw new NotFoundException('Stylist not found in this salon.');

    const title = (dto.title || 'Break').trim();
    const { startTime, endTime, days, breakIds, salonBreakId } = dto;

    if (startTime >= endTime) {
      throw new BadRequestException('Break start time must be earlier than break end time.');
    }
    if (!days || days.length === 0) {
      throw new BadRequestException('At least one day must be selected.');
    }

    const targetId = (breakIds ? Object.values(breakIds)[0] : null) || salonBreakId;

    let existingBreak = targetId
      ? await this.prisma.stylistBreak.findFirst({
          where: {
            salonId,
            stylistId: staffId,
            OR: [{ id: targetId }, { salonBreakId: targetId }],
          },
        })
      : null;

    if (!existingBreak) {
      existingBreak = await this.prisma.stylistBreak.findFirst({
        where: {
          salonId,
          stylistId: staffId,
          OR: [
            { title, startTime, endTime },
            ...(dto.originalStartTime && dto.originalEndTime
              ? [{ startTime: dto.originalStartTime, endTime: dto.originalEndTime }]
              : []),
          ],
        },
      });
    }

    // Check collision against other breaks
    const otherBreaks = await this.prisma.stylistBreak.findMany({
      where: {
        salonId,
        stylistId: staffId,
        ...(existingBreak ? { id: { not: existingBreak.id } } : {}),
      },
    });

    const overlap = otherBreaks.find(
      (b) =>
        b.startTime < endTime &&
        b.endTime > startTime &&
        b.days.some((d) => days.includes(d)),
    );
    if (overlap) {
      throw new ConflictException(
        `Break time ${startTime}–${endTime} overlaps with existing break "${overlap.title}" (${overlap.startTime}–${overlap.endTime}).`,
      );
    }

    let savedBreak;
    if (existingBreak) {
      savedBreak = await this.prisma.stylistBreak.update({
        where: { id: existingBreak.id },
        data: {
          title,
          startTime,
          endTime,
          days,
          isCustomized: true,
        },
      });
    } else {
      savedBreak = await this.prisma.stylistBreak.create({
        data: {
          salonId,
          stylistId: staffId,
          salonBreakId: salonBreakId || null,
          title,
          startTime,
          endTime,
          days,
          isCustomized: true,
        },
      });
    }

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      action: 'UPDATE_STAFF_ROUTINE_BREAK',
      staffId,
      days,
    });

    for (const day of days) {
      await this.appointmentsService.resolveScheduleConflicts({
        salonId,
        scope: 'STYLIST',
        stylistId: staffId,
        dayOfWeek: day,
        breakHours: { startTime, endTime },
        isClosedOrOff: false,
        reason: `Stylist break updated (${title}) on ${day} (${startTime}–${endTime})`,
      });
    }

    return {
      success: true,
      stylistId: staffId,
      title,
      startTime,
      endTime,
      days,
      updatedCount: 1,
      breaks: [savedBreak],
    };
  }

  /**
   * Inherits an available salon facility break pattern for a specialist.
   */
  async inheritSalonBreak(salonId: string, staffId: string, dto: InheritSalonBreakDto) {
    const stylist = await this.prisma.stylist.findFirst({
      where: { id: staffId, salonId },
    });
    if (!stylist) throw new NotFoundException('Stylist not found in this salon.');

    const salonBreak = await this.prisma.salonBreak.findUnique({
      where: { id: dto.salonBreakId },
    });
    if (!salonBreak || salonBreak.salonId !== salonId) {
      throw new NotFoundException('Salon facility break not found.');
    }

    const targetDays = dto.days && dto.days.length > 0 ? dto.days : salonBreak.days;

    const savedBreak = await this.prisma.$transaction(async (tx) => {
      // 1. Remove or handle overlaps if replaceConflicts
      if (dto.replaceConflicts) {
        await tx.stylistBreak.deleteMany({
          where: {
            stylistId: staffId,
            salonId,
            startTime: { lt: salonBreak.endTime },
            endTime: { gt: salonBreak.startTime },
            OR: [
              { salonBreakId: null },
              { salonBreakId: { not: salonBreak.id } },
            ],
          },
        });
      } else {
        const conflicting = await tx.stylistBreak.findFirst({
          where: {
            stylistId: staffId,
            salonId,
            startTime: { lt: salonBreak.endTime },
            endTime: { gt: salonBreak.startTime },
            OR: [
              { salonBreakId: null },
              { salonBreakId: { not: salonBreak.id } },
            ],
            days: { hasSome: targetDays },
          },
        });
        if (conflicting) {
          throw new ConflictException(
            `Break overlaps with existing break "${conflicting.title}" (${conflicting.startTime}–${conflicting.endTime}).`,
          );
        }
      }

      // 2. Check if stylist already has a break linked to this salonBreak
      const existing = await tx.stylistBreak.findFirst({
        where: {
          stylistId: staffId,
          salonId,
          OR: [
            { salonBreakId: salonBreak.id },
            { title: salonBreak.title, startTime: salonBreak.startTime, endTime: salonBreak.endTime },
          ],
        },
      });

      if (existing) {
        return tx.stylistBreak.update({
          where: { id: existing.id },
          data: {
            salonBreakId: salonBreak.id,
            title: salonBreak.title,
            startTime: salonBreak.startTime,
            endTime: salonBreak.endTime,
            days: targetDays,
            isCustomized: false,
          },
        });
      }

      return tx.stylistBreak.create({
        data: {
          salonId,
          stylistId: staffId,
          salonBreakId: salonBreak.id,
          title: salonBreak.title,
          startTime: salonBreak.startTime,
          endTime: salonBreak.endTime,
          days: targetDays,
          isCustomized: false,
        },
      });
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      action: 'INHERIT_SALON_BREAK',
      staffId,
      salonBreakId: dto.salonBreakId,
    });

    return {
      success: true,
      stylistId: staffId,
      inheritedCount: 1,
      breaks: [savedBreak],
    };
  }

  /**
   * Resets a stylist routine break pattern in-place back to the salon facility timing.
   */
  async resetStaffRoutineBreak(salonId: string, staffId: string, dto: ResetRoutineBreakDto) {
    const stylist = await this.prisma.stylist.findFirst({
      where: { id: staffId, salonId },
    });
    if (!stylist) throw new NotFoundException('Stylist not found in this salon.');

    const targetId = (dto.breakIds ? Object.values(dto.breakIds)[0] : null) || dto.salonBreakId;

    let existingBreak = targetId
      ? await this.prisma.stylistBreak.findFirst({
          where: {
            salonId,
            stylistId: staffId,
            OR: [{ id: targetId }, { salonBreakId: targetId }],
          },
        })
      : null;

    if (!existingBreak && dto.title) {
      existingBreak = await this.prisma.stylistBreak.findFirst({
        where: {
          salonId,
          stylistId: staffId,
          title: dto.title,
        },
      });
    }

    if (!existingBreak) {
      throw new NotFoundException('Stylist break not found to reset.');
    }

    if (!existingBreak.salonBreakId && !dto.salonBreakId) {
      throw new BadRequestException('This is a custom break created specifically for this stylist with no parent salon break to reset to.');
    }

    const masterBreakId = existingBreak.salonBreakId || dto.salonBreakId;
    const masterBreak = masterBreakId
      ? await this.prisma.salonBreak.findUnique({ where: { id: masterBreakId } })
      : null;

    if (!masterBreak) {
      throw new NotFoundException('Master salon break could not be found to reset to.');
    }

    const resetBreak = await this.prisma.stylistBreak.update({
      where: { id: existingBreak.id },
      data: {
        salonBreakId: masterBreak.id,
        title: masterBreak.title,
        startTime: masterBreak.startTime,
        endTime: masterBreak.endTime,
        days: masterBreak.days,
        isCustomized: false,
      },
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      action: 'RESET_STAFF_ROUTINE_BREAK',
      staffId,
      breakId: resetBreak.id,
    });

    return {
      success: true,
      stylistId: staffId,
      title: masterBreak.title,
      startTime: masterBreak.startTime,
      endTime: masterBreak.endTime,
      days: masterBreak.days,
      resetCount: 1,
      breaks: [resetBreak],
    };
  }

  /**
   * Resets a customized stylist break back to the salon facility default.
   */
  async resetStaffBreak(salonId: string, staffId: string, breakId: string) {
    const existing = await this.prisma.stylistBreak.findFirst({
      where: { id: breakId, stylistId: staffId, salonId },
    });
    if (!existing) throw new NotFoundException('Stylist break not found.');

    if (!existing.salonBreakId) {
      throw new BadRequestException('This break has no parent salon facility break.');
    }

    const salonBreak = await this.prisma.salonBreak.findUnique({
      where: { id: existing.salonBreakId },
    });
    if (!salonBreak) {
      throw new NotFoundException('The original salon facility break no longer exists.');
    }

    const reverted = await this.prisma.stylistBreak.update({
      where: { id: breakId },
      data: {
        title: salonBreak.title,
        startTime: salonBreak.startTime,
        endTime: salonBreak.endTime,
        days: salonBreak.days,
        isCustomized: false,
      },
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      action: 'RESET_STAFF_BREAK',
      staffId,
      breakId,
    });

    return reverted;
  }

  /**
   * Deletes a single staff break by ID.
   */
  async deleteStaffBreak(salonId: string, staffId: string, breakId: string) {
    const existing = await this.prisma.stylistBreak.findFirst({
      where: { id: breakId, stylistId: staffId, salonId },
    });
    if (!existing) throw new NotFoundException('Stylist break not found.');

    await this.prisma.stylistBreak.delete({ where: { id: breakId } });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      action: 'DELETE_STAFF_BREAK',
      staffId,
      breakId,
    });

    return { success: true, message: 'Staff break deleted successfully.' };
  }

  /**
   * Deletes a staff routine break matching ID, title, or time window.
   */
  async deleteStaffRoutineBreak(salonId: string, staffId: string, dto: DeleteRoutineBreakDto | string) {
    let title: string | undefined;
    let startTime: string | undefined;
    let endTime: string | undefined;
    let breakIds: any;
    let salonBreakId: string | undefined;
    let targetId: string | null = null;

    if (typeof dto === 'string') {
      targetId = dto;
    } else if (dto) {
      title = dto.title;
      startTime = dto.startTime;
      endTime = dto.endTime;
      breakIds = dto.breakIds;
      salonBreakId = dto.salonBreakId;
      targetId = (breakIds ? (Object.values(breakIds)[0] as string) : null) || salonBreakId || null;
    }

    const orClauses: any[] = [];
    if (targetId) {
      orClauses.push({ id: targetId }, { salonBreakId: targetId });
    }
    if (startTime && endTime) {
      orClauses.push({
        startTime,
        endTime,
        ...(title ? { title } : {}),
      });
    }

    if (orClauses.length === 0) {
      return { success: true, deletedCount: 0 };
    }

    const matching = await this.prisma.stylistBreak.findMany({
      where: {
        salonId,
        stylistId: staffId,
        OR: orClauses,
      },
    });

    if (matching.length === 0) {
      return { success: true, deletedCount: 0 };
    }

    const { count } = await this.prisma.stylistBreak.deleteMany({
      where: { id: { in: matching.map((m) => m.id) } },
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      action: 'DELETE_STAFF_ROUTINE_BREAK',
      staffId,
    });

    return { success: true, deletedCount: count };
  }
}
