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
import { DayOfWeek, AppointmentStatus } from '@prisma/client';
import { DateTime } from 'luxon';
import { CreateStaffBreakDto } from '../dto/create-staff-break.dto';
import { UpdateStaffBreakDto } from '../dto/update-staff-break.dto';
import { UpdateRoutineBreakDto, DeleteRoutineBreakDto } from '../dto/routine-break.dto';
import { InheritSalonBreakDto } from '../dto/inherit-salon-break.dto';
import { AppointmentsService } from '../../appointments/appointments.service';
import { StaffBreaksListResponse, RoutineBreakSummary, InheritableSalonBreakSummary } from '../interfaces/break.interface';
import { TimeUtility } from '../../../../common/utils/time.utility';

@Injectable()
export class StaffBreaksService {
  private readonly logger = new Logger(StaffBreaksService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => AppointmentsService))
    private appointmentsService: AppointmentsService,
  ) { }

  /**
   * Retrieves all breaks for a stylist (both inherited salon breaks and custom stylist breaks).
   */
  async getStaffBreaks(salonId: string, staffId: string): Promise<StaffBreaksListResponse> {
    const stylist = await this.prisma.stylist.findFirst({
      where: { id: staffId, salonId },
      include: {
        breaks: { orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] },
      },
    });

    if (!stylist) throw new NotFoundException('Stylist not found in this salon.');

    let breaksToDisplay = stylist.breaks;

    // If stylist follows salon schedule and has no custom breaks, fetch master salon breaks
    if (stylist.followsSalonSchedule && stylist.breaks.length === 0) {
      const salonBreaks = await this.prisma.salonBreak.findMany({
        where: { salonId },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      });
      breaksToDisplay = salonBreaks.map((sb) => ({
        id: sb.id,
        salonId: sb.salonId,
        stylistId: staffId,
        salonBreakId: sb.id,
        dayOfWeek: sb.dayOfWeek,
        title: sb.title,
        startTime: sb.startTime,
        endTime: sb.endTime,
        isCustomized: false,
        createdAt: sb.createdAt,
        updatedAt: sb.updatedAt,
      })) as any;
    }

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

    for (const b of breaksToDisplay) {
      if (byDay[b.dayOfWeek]) {
        byDay[b.dayOfWeek].push({
          id: b.id,
          title: b.title,
          startTime: b.startTime,
          endTime: b.endTime,
          isCustomized: b.isCustomized,
          salonBreakId: b.salonBreakId,
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
          isCustomized: b.isCustomized,
          salonBreakId: b.salonBreakId || null,
        });
      }

      const summary = groupedMap.get(routineKey)!;
      if (!summary.days.includes(b.dayOfWeek)) {
        summary.days.push(b.dayOfWeek);
      }
      summary.breakIds[b.dayOfWeek] = b.id;
      if (b.salonBreakId && !summary.salonBreakId) {
        summary.salonBreakId = b.salonBreakId;
      }
      if (b.isCustomized) {
        summary.isCustomized = true;
      }
    }

    // Compute inheritable salon facility breaks
    const masterSalonBreaks = await this.prisma.salonBreak.findMany({
      where: { salonId },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });

    const masterGrouped = new Map<string, {
      salonBreakId: string;
      title: string;
      startTime: string;
      endTime: string;
      days: DayOfWeek[];
      breakIds: Record<string, string>;
    }>();

    for (const mb of masterSalonBreaks) {
      const key = `${mb.title}_${mb.startTime}_${mb.endTime}`;
      if (!masterGrouped.has(key)) {
        masterGrouped.set(key, {
          salonBreakId: mb.id,
          title: mb.title,
          startTime: mb.startTime,
          endTime: mb.endTime,
          days: [],
          breakIds: {},
        });
      }
      const g = masterGrouped.get(key)!;
      if (!g.days.includes(mb.dayOfWeek)) g.days.push(mb.dayOfWeek);
      g.breakIds[mb.dayOfWeek] = mb.id;
    }

    const inheritableSalonBreaks: InheritableSalonBreakSummary[] = [];

    for (const master of masterGrouped.values()) {
      // Check if stylist already has this routine inherited across days
      const existingRoutine = Array.from(groupedMap.values()).find(
        (r) => r.salonBreakId === master.salonBreakId || (r.title === master.title && r.startTime === master.startTime && r.endTime === master.endTime && !r.isCustomized),
      );

      // Determine days of this master salon break that the stylist does NOT have yet
      const missingDays = existingRoutine
        ? master.days.filter((d) => !existingRoutine.days.includes(d))
        : [...master.days];

      if (missingDays.length === 0) {
        continue; // Already fully inherited on all master days!
      }

      const masterBreakIdSet = new Set(Object.values(master.breakIds));

      // Check conflicts ONLY on missing days and breaks that are NOT part of this master routine
      const conflictingBreaks = breaksToDisplay.filter(
        (b: any) =>
          missingDays.includes(b.dayOfWeek) &&
          b.startTime < master.endTime &&
          b.endTime > master.startTime &&
          !masterBreakIdSet.has(b.salonBreakId),
      );

      const hasConflict = conflictingBreaks.length > 0;
      const conflictReason = hasConflict
        ? `Overlaps on ${[...new Set(conflictingBreaks.map((c: any) => c.dayOfWeek.slice(0, 3)))].join(', ')} with "${conflictingBreaks[0].title}" (${conflictingBreaks[0].startTime}–${conflictingBreaks[0].endTime})`
        : null;

      inheritableSalonBreaks.push({
        salonBreakId: master.salonBreakId,
        title: master.title,
        startTime: master.startTime,
        endTime: master.endTime,
        days: missingDays,
        isAlreadyInherited: Boolean(existingRoutine),
        canInherit: true,
        conflictReason,
        conflictingBreakIds: conflictingBreaks.map((cb: any) => cb.id),
      });
    }

    return {
      stylistId: staffId,
      followsSalonSchedule: stylist.followsSalonSchedule,
      totalBreaks: breaksToDisplay.length,
      routineBreaks: Array.from(groupedMap.values()),
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

    const tz = stylist.salon?.timezone || TimeUtility.DEFAULT_TIMEZONE;
    const title = (dto.title || 'Break').trim();
    const { startTime, endTime, autoReschedule = false } = dto;

    if (startTime >= endTime) {
      throw new BadRequestException('Break start time must be earlier than break end time.');
    }

    const targetDays: DayOfWeek[] = dto.days && dto.days.length > 0
      ? dto.days
      : (dto.dayOfWeek ? [dto.dayOfWeek] : ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']);

    const createdBreaks = await this.prisma.$transaction(async (tx) => {
      const results: any[] = [];

      for (const day of targetDays) {
        // 1. Check for overlapping breaks on this day
        const existingBreaks = await tx.stylistBreak.findMany({
          where: { stylistId: staffId, dayOfWeek: day },
        });

        const overlap = existingBreaks.find(
          (b) => b.startTime < endTime && b.endTime > startTime,
        );
        if (overlap) {
          throw new ConflictException(
            `Break time ${startTime}–${endTime} overlaps with existing break "${overlap.title}" (${overlap.startTime}–${overlap.endTime}) on ${day}.`,
          );
        }

        // 2. Create the customized stylist break
        const newBreak = await tx.stylistBreak.create({
          data: {
            salonId,
            stylistId: staffId,
            dayOfWeek: day,
            title,
            startTime,
            endTime,
            isCustomized: true,
          },
        });
        results.push(newBreak);
      }

      return results;
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      action: 'CREATE_STAFF_BREAK',
      staffId,
      days: targetDays,
    });

    // Resolve any conflicting bookings in background and send WhatsApp reschedule proposal
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
      createdCount: createdBreaks.length,
      breaks: createdBreaks,
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
   * Modifies existing StylistBreak records, handles day differences (updates shared, removes deselected, creates added),
   * sets isCustomized = true, and NEVER duplicates breaks or touches salon_breaks.
   */
  async updateStaffRoutineBreak(salonId: string, staffId: string, dto: UpdateRoutineBreakDto) {
    const stylist = await this.prisma.stylist.findFirst({
      where: { id: staffId, salonId },
      include: { salon: true },
    });
    if (!stylist) throw new NotFoundException('Stylist not found in this salon.');

    const tz = stylist.salon?.timezone || TimeUtility.DEFAULT_TIMEZONE;
    const title = (dto.title || 'Break').trim();
    const { startTime, endTime, days, autoReschedule = false } = dto;

    if (startTime >= endTime) {
      throw new BadRequestException('Break start time must be earlier than break end time.');
    }
    if (!days || days.length === 0) {
      throw new BadRequestException('At least one day must be selected.');
    }

    // 1. Locate existing breaks belonging to this routine
    let existingBreaks: any[] = [];

    // Approach A: lookup by breakIds if provided
    if (dto.breakIds && Object.keys(dto.breakIds).length > 0) {
      const ids = Object.values(dto.breakIds).filter(Boolean);
      existingBreaks = await this.prisma.stylistBreak.findMany({
        where: {
          id: { in: ids },
          stylistId: staffId,
          salonId,
        },
      });
    }

    // Approach B: fallback to matching by originalStartTime and originalEndTime
    if (existingBreaks.length === 0 && (dto.originalStartTime || dto.originalEndTime)) {
      existingBreaks = await this.prisma.stylistBreak.findMany({
        where: {
          stylistId: staffId,
          salonId,
          startTime: dto.originalStartTime || startTime,
          endTime: dto.originalEndTime || endTime,
        },
      });
    }

    // Approach C: If still not found and staff has a parent salonBreakId
    let parentSalonBreakId = dto.salonBreakId;
    if (existingBreaks.length === 0 && parentSalonBreakId) {
      existingBreaks = await this.prisma.stylistBreak.findMany({
        where: {
          stylistId: staffId,
          salonId,
          salonBreakId: parentSalonBreakId,
        },
      });
    }

    // Determine parent salonBreakId to preserve if any existing break has it or if passed in dto
    if (!parentSalonBreakId && existingBreaks.length > 0) {
      const foundWithParent = existingBreaks.find((b) => b.salonBreakId);
      if (foundWithParent) {
        parentSalonBreakId = foundWithParent.salonBreakId;
      }
    }

    const existingBreakIds = existingBreaks.map((b) => b.id);
    const existingDayMap = new Map<DayOfWeek, any>();
    for (const b of existingBreaks) {
      existingDayMap.set(b.dayOfWeek, b);
    }

    // 2. Validate Overlaps: Check against OTHER breaks for this stylist on target days
    for (const targetDay of days) {
      const otherBreaksOnDay = await this.prisma.stylistBreak.findMany({
        where: {
          stylistId: staffId,
          dayOfWeek: targetDay,
          id: { notIn: existingBreakIds },
        },
      });

      const overlap = otherBreaksOnDay.find(
        (b) => b.startTime < endTime && b.endTime > startTime,
      );
      if (overlap) {
        throw new ConflictException(
          `Break time ${startTime}–${endTime} overlaps with another break "${overlap.title}" (${overlap.startTime}–${overlap.endTime}) on ${targetDay}.`,
        );
      }

    }

    // 3. Perform In-Place Atomic Mutations
    const updatedBreaks = await this.prisma.$transaction(async (tx) => {
      const results: any[] = [];

      // A. If existing breaks exist, compute diff:
      if (existingBreaks.length > 0) {
        // (i) Delete days removed by user
        const removedBreaks = existingBreaks.filter((b) => !days.includes(b.dayOfWeek));
        if (removedBreaks.length > 0) {
          await tx.stylistBreak.deleteMany({
            where: { id: { in: removedBreaks.map((b) => b.id) } },
          });
        }

        // (ii) Update existing days in-place
        for (const targetDay of days) {
          const existingRow = existingDayMap.get(targetDay);
          if (existingRow) {
            const updated = await tx.stylistBreak.update({
              where: { id: existingRow.id },
              data: {
                title,
                startTime,
                endTime,
                isCustomized: true,
                ...(parentSalonBreakId ? { salonBreakId: parentSalonBreakId } : {}),
              },
            });
            results.push(updated);
          } else {
            // (iii) Create new day entry added by user
            const created = await tx.stylistBreak.create({
              data: {
                salonId,
                stylistId: staffId,
                dayOfWeek: targetDay,
                title,
                startTime,
                endTime,
                isCustomized: true,
                ...(parentSalonBreakId ? { salonBreakId: parentSalonBreakId } : {}),
              },
            });
            results.push(created);
          }
        }
      } else {
        // Fallback: No existing records matched, create fresh records
        for (const targetDay of days) {
          const created = await tx.stylistBreak.create({
            data: {
              salonId,
              stylistId: staffId,
              dayOfWeek: targetDay,
              title,
              startTime,
              endTime,
              isCustomized: true,
              ...(parentSalonBreakId ? { salonBreakId: parentSalonBreakId } : {}),
            },
          });
          results.push(created);
        }
      }

      return results;
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      action: 'UPDATE_STAFF_ROUTINE_BREAK',
      staffId,
      days,
    });

    // Resolve any conflicting bookings in background and send WhatsApp reschedule proposal
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
      updatedCount: updatedBreaks.length,
      breaks: updatedBreaks,
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

    // Find all master days for this routine (matching title, startTime, endTime)
    const masterRoutineDays = await this.prisma.salonBreak.findMany({
      where: {
        salonId,
        title: salonBreak.title,
        startTime: salonBreak.startTime,
        endTime: salonBreak.endTime,
      },
    });

    const targetDays = dto.days && dto.days.length > 0
      ? dto.days
      : masterRoutineDays.map((m) => m.dayOfWeek);

    const created = await this.prisma.$transaction(async (tx) => {
      const masterBreakIds = masterRoutineDays.map((m) => m.id);

      // 1. If replaceConflicts, remove any overlapping breaks on target days (excluding records already belonging to this routine)
      if (dto.replaceConflicts) {
        await tx.stylistBreak.deleteMany({
          where: {
            stylistId: staffId,
            dayOfWeek: { in: targetDays },
            startTime: { lt: salonBreak.endTime },
            endTime: { gt: salonBreak.startTime },
            OR: [
              { salonBreakId: null },
              { salonBreakId: { notIn: masterBreakIds } },
            ],
          },
        });
      } else {
        // Verify no collisions with existing non-routine breaks
        const overlaps = await tx.stylistBreak.findMany({
          where: {
            stylistId: staffId,
            dayOfWeek: { in: targetDays },
            startTime: { lt: salonBreak.endTime },
            endTime: { gt: salonBreak.startTime },
            OR: [
              { salonBreakId: null },
              { salonBreakId: { notIn: masterBreakIds } },
            ],
          },
        });
        if (overlaps.length > 0) {
          throw new ConflictException(
            `Cannot inherit break: overlaps with existing break "${overlaps[0].title}" on ${overlaps[0].dayOfWeek}. Set replaceConflicts to true to replace it.`,
          );
        }
      }

      // 2. Insert or update the stylist breaks
      const results: any[] = [];
      for (const masterDay of masterRoutineDays) {
        if (!targetDays.includes(masterDay.dayOfWeek)) continue;

        // Upsert by checking if existing break exists for this salonBreakId or day
        const existing = await tx.stylistBreak.findFirst({
          where: {
            stylistId: staffId,
            dayOfWeek: masterDay.dayOfWeek,
            salonBreakId: masterDay.id,
          },
        });

        if (existing) {
          const updated = await tx.stylistBreak.update({
            where: { id: existing.id },
            data: {
              title: masterDay.title,
              startTime: masterDay.startTime,
              endTime: masterDay.endTime,
              isCustomized: false,
            },
          });
          results.push(updated);
        } else {
          const newBreak = await tx.stylistBreak.create({
            data: {
              salonId,
              stylistId: staffId,
              salonBreakId: masterDay.id,
              dayOfWeek: masterDay.dayOfWeek,
              title: masterDay.title,
              startTime: masterDay.startTime,
              endTime: masterDay.endTime,
              isCustomized: false,
            },
          });
          results.push(newBreak);
        }
      }

      return results;
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      action: 'INHERIT_SALON_BREAK',
      staffId,
      salonBreakId: dto.salonBreakId,
    });

    // Resolve any conflicting bookings for inherited break
    for (const masterDay of masterRoutineDays) {
      if (!targetDays.includes(masterDay.dayOfWeek)) continue;
      await this.appointmentsService.resolveScheduleConflicts({
        salonId,
        scope: 'STYLIST',
        stylistId: staffId,
        dayOfWeek: masterDay.dayOfWeek,
        breakHours: { startTime: masterDay.startTime, endTime: masterDay.endTime },
        isClosedOrOff: false,
        reason: `Stylist break inherited (${masterDay.title}) on ${masterDay.dayOfWeek} (${masterDay.startTime}–${masterDay.endTime})`,
      });
    }

    return {
      success: true,
      stylistId: staffId,
      inheritedCount: created.length,
      breaks: created,
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
      throw new BadRequestException('This break is a custom break created for this stylist and cannot be reset to a salon default.');
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
   * Deletes a staff routine break across matching days.
   */
  async deleteStaffRoutineBreak(salonId: string, staffId: string, dto: DeleteRoutineBreakDto) {
    const { title, startTime, endTime, days } = dto;

    const matching = await this.prisma.stylistBreak.findMany({
      where: {
        salonId,
        stylistId: staffId,
        startTime,
        endTime,
        ...(title ? { title } : {}),
        ...(days && days.length > 0 ? { dayOfWeek: { in: days } } : {}),
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
