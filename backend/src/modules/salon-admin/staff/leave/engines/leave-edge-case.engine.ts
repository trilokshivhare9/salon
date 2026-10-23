import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../../database/prisma.service';
import { DateTime } from 'luxon';
import { AbsenceStatus, DayOfWeek, StylistStatus } from '@prisma/client';
import { TimeUtility } from '../../../../../common/utils/time.utility';
import { ExtendLeaveDto } from '../dto/extend-leave.dto';

export interface EdgeCaseValidationResult {
  timezone: string;
  stylist: any;
  salon: any;
  startDateParsed: DateTime;
  endDateParsed: DateTime;
  validDates: DateTime[];
  skippedClosedDates: string[];
}

@Injectable()
export class LeaveEdgeCaseEngine {
  constructor(private readonly prisma: PrismaService) {}

  public getDayOfWeekEnum(dt: DateTime): DayOfWeek {
    const mapping: Record<number, DayOfWeek> = {
      1: DayOfWeek.MONDAY,
      2: DayOfWeek.TUESDAY,
      3: DayOfWeek.WEDNESDAY,
      4: DayOfWeek.THURSDAY,
      5: DayOfWeek.FRIDAY,
      6: DayOfWeek.SATURDAY,
      7: DayOfWeek.SUNDAY,
    };
    return mapping[dt.weekday];
  }

  /**
   * Validates stylist existence, active status, and salon membership.
   */
  async validateStylistAndSalon(salonId: string, stylistId: string) {
    const stylist = await this.prisma.stylist.findFirst({
      where: { id: stylistId, salonId },
      include: { workingHours: true },
    });
    if (!stylist) {
      throw new NotFoundException('Stylist not found in this salon.');
    }

    const effectiveStatus = stylist.status ?? StylistStatus.ACTIVE;
    if (effectiveStatus !== StylistStatus.ACTIVE) {
      throw new BadRequestException('Cannot schedule leaves for an inactive stylist account.');
    }

    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
    });
    if (!salon) {
      throw new NotFoundException('Salon not found.');
    }

    return { stylist, salon, timezone: salon.timezone || 'Asia/Kolkata' };
  }

  /**
   * Validates leave extension parameters against an existing leave record.
   */
  validateLeaveExtension(existingAbsence: any, dto: ExtendLeaveDto, timezone: string) {
    const newEndIso = dto.newEndDate.includes('T') ? dto.newEndDate.split('T')[0] : dto.newEndDate;
    const newEndDateParsed = DateTime.fromISO(newEndIso, { zone: timezone }).startOf('day');
    const oldEndDateParsed = DateTime.fromJSDate(existingAbsence.endDate, { zone: timezone }).startOf('day');

    if (newEndDateParsed <= oldEndDateParsed) {
      throw new BadRequestException('New end date must be strictly after the current end date.');
    }

    const incrementalStartParsed = oldEndDateParsed.plus({ days: 1 });
    const newEndDateObj = new Date(`${newEndIso}T00:00:00.000Z`);

    return {
      newEndIso,
      newEndDateParsed,
      oldEndDateParsed,
      incrementalStartParsed,
      newEndDateObj,
    };
  }

  /**
   * Runs the comprehensive Edge-Case Defense checks before applying or previewing leave.
   */
  async validateLeaveApplication(
    salonId: string,
    stylistId: string,
    params: {
      startDateStr: string;
      endDateStr: string;
      isPartialDay?: boolean;
      startTime?: string;
      endTime?: string;
    },
  ): Promise<EdgeCaseValidationResult> {
    const { stylist, salon, timezone } = await this.validateStylistAndSalon(salonId, stylistId);

    // 2. Validate and Parse Dates in Salon Timezone
    const startDt = DateTime.fromISO(params.startDateStr, { zone: timezone }).startOf('day');
    const endDt = DateTime.fromISO(params.endDateStr, { zone: timezone }).startOf('day');

    if (!startDt.isValid || !endDt.isValid) {
      throw new BadRequestException('Invalid date format. Expected YYYY-MM-DD.');
    }

    if (endDt < startDt) {
      throw new BadRequestException('Leave end date cannot be earlier than start date.');
    }

    // 3. Weekly Off and Operating Shift Invariants
    const isSingleDay = startDt.hasSame(endDt, 'day');
    const startDayOfWeek = this.getDayOfWeekEnum(startDt);
    const endDayOfWeek = this.getDayOfWeekEnum(endDt);

    const startShift = stylist.workingHours?.find((w: any) => w.dayOfWeek === startDayOfWeek);
    const endShift = isSingleDay ? startShift : stylist.workingHours?.find((w: any) => w.dayOfWeek === endDayOfWeek);

    // Rule: Single-day leave cannot be scheduled on an existing weekly off
    if (isSingleDay) {
      if (startShift && !startShift.isWorking) {
        const dayLabel = startDayOfWeek.charAt(0) + startDayOfWeek.slice(1).toLowerCase();
        throw new BadRequestException(
          `${stylist.name || 'Specialist'} already has a scheduled weekly off on this day (${dayLabel}). Single-day leave cannot be recorded on an off day.`,
        );
      }
    } else {
      // Multi-Day Range: Cannot START on a weekly off (specialist already off)
      if (startShift && !startShift.isWorking) {
        const dayLabel = startDayOfWeek.charAt(0) + startDayOfWeek.slice(1).toLowerCase();
        throw new BadRequestException(
          `Cannot start leave on ${dayLabel} because ${stylist.name || 'specialist'} is already on weekly off. Please select their first working day as the start date.`,
        );
      }
      // Nor can it END on a weekly off (specialist already off)
      if (endShift && !endShift.isWorking) {
        const dayLabel = endDayOfWeek.charAt(0) + endDayOfWeek.slice(1).toLowerCase();
        throw new BadRequestException(
          `Cannot end leave on ${dayLabel} because ${stylist.name || 'specialist'} is already on weekly off. Please select their last working day as the end date.`,
        );
      }
    }

    // 4. Validate Partial Hours Window and Shift Containment (if applicable)
    const finalStart = params.startTime;
    const finalEnd = params.endTime;
    const isPartial = Boolean(params.isPartialDay || (finalStart && finalEnd));

    if (isPartial && finalStart && finalEnd) {
      if (!isSingleDay) {
        throw new BadRequestException('Partial-day leave can only be scheduled for a single date.');
      }

      if (startShift && !startShift.isWorking) {
        throw new BadRequestException(`Cannot schedule partial leave on a scheduled weekly off day (${startDayOfWeek}).`);
      }

      const sMin = TimeUtility.parseTimeStringToMinutes(finalStart);
      const eMin = TimeUtility.parseTimeStringToMinutes(finalEnd);

      if (sMin >= eMin) {
        throw new BadRequestException('Leave start time must be strictly before leave end time.');
      }

      if (eMin - sMin < 15) {
        throw new BadRequestException('Partial-day leave must be at least 15 minutes in duration.');
      }

      if (startShift && startShift.startTime && startShift.endTime) {
        const shiftStartMin = TimeUtility.parseTimeStringToMinutes(startShift.startTime);
        const shiftEndMin = TimeUtility.parseTimeStringToMinutes(startShift.endTime);

        if (sMin < shiftStartMin) {
          throw new BadRequestException(
            `Leave start time (${TimeUtility.formatTime12h(finalStart)}) cannot be before specialist shift start (${TimeUtility.formatTime12h(startShift.startTime)}).`,
          );
        }

        if (eMin > shiftEndMin) {
          throw new BadRequestException(
            `Leave end time (${TimeUtility.formatTime12h(finalEnd)}) cannot be after specialist shift end (${TimeUtility.formatTime12h(startShift.endTime)}).`,
          );
        }
      }
    }

    // 4. Duplicate / Overlapping Leave Collision Check (Precision Time Interval Parity)
    const startDbDate = TimeUtility.toDbDate(startDt.toISODate()!);
    const endDbDate = TimeUtility.toDbDate(endDt.toISODate()!);

    const overlappingLeaves = await this.prisma.stylistAbsence.findMany({
      where: {
        salonId,
        stylistId,
        status: AbsenceStatus.ACTIVE,
        startDate: { lte: endDbDate },
        endDate: { gte: startDbDate },
      },
    });

    if (overlappingLeaves.length > 0) {
      for (const existing of overlappingLeaves) {
        const existingIsPartial = Boolean(existing.isPartialDay);
        const existingStart = existing.startTime;
        const existingEnd = existing.endTime;

        // If either is a full-day leave, collision is absolute
        if (!isPartial || !existingIsPartial || !finalStart || !finalEnd || !existingStart || !existingEnd) {
          const s = existing.startDate.toISOString().split('T')[0];
          const e = existing.endDate.toISOString().split('T')[0];
          throw new BadRequestException(
            `Specialist already has an active leave scheduled from ${s} to ${e} (${existing.reason || 'Leave'}).`,
          );
        }

        // If both are partial on the same single date, verify non-overlapping time windows
        const [exSh, exSm] = existingStart.split(':').map(Number);
        const [exEh, exEm] = existingEnd.split(':').map(Number);
        const exStartMin = exSh * 60 + exSm;
        const exEndMin = exEh * 60 + exEm;

        const [sh, sm] = finalStart.split(':').map(Number);
        const [eh, em] = finalEnd.split(':').map(Number);
        const newStartMin = sh * 60 + sm;
        const newEndMin = eh * 60 + em;

        // Overlap occurs if NOT (newEnd <= exStart || newStart >= exEnd)
        if (!(newEndMin <= exStartMin || newStartMin >= exEndMin)) {
          throw new BadRequestException(
            `Partial leave hours (${finalStart} - ${finalEnd}) overlap with an existing leave on this date (${existingStart} - ${existingEnd}: "${existing.reason || 'Scheduled leave'}").`,
          );
        }
      }
    }

    // 5. Check Salon Closures (Holidays / Emergency Closures)
    const closures = await this.prisma.salonClosure.findMany({
      where: {
        salonId,
        startDate: { lte: endDbDate },
        endDate: { gte: startDbDate },
      },
    });

    const validDates: DateTime[] = [];
    const skippedClosedDates: string[] = [];

    let curr = startDt;
    while (curr <= endDt) {
      const currIso = curr.toISODate()!;

      const isClosed = closures.some((c) => {
        const cStart = c.startDate.toISOString().split('T')[0];
        const cEnd = c.endDate.toISOString().split('T')[0];
        return currIso >= cStart && currIso <= cEnd && !c.isPartialDay;
      });

      if (isClosed) {
        skippedClosedDates.push(currIso);
      } else {
        validDates.push(curr);
      }
      curr = curr.plus({ days: 1 });
    }

    if (isSingleDay && skippedClosedDates.length > 0) {
      throw new BadRequestException('The salon is closed on this date. Specialist leave cannot be recorded.');
    }

    if (validDates.length === 0) {
      throw new BadRequestException('All selected dates fall on salon closures/holidays.');
    }



    return {
      timezone,
      stylist,
      salon,
      startDateParsed: startDt,
      endDateParsed: endDt,
      validDates,
      skippedClosedDates,
    };
  }
}
