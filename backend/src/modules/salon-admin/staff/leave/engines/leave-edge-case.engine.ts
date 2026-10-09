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
      customStartTime?: string;
      customEndTime?: string;
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

    // 3. Validate Custom Hours (if applicable)
    if (params.customStartTime && params.customEndTime) {
      const [sh, sm] = params.customStartTime.split(':').map((v) => parseInt(v, 10));
      const [eh, em] = params.customEndTime.split(':').map((v) => parseInt(v, 10));
      const sMin = sh * 60 + sm;
      const eMin = eh * 60 + em;
      if (sMin >= eMin) {
        throw new BadRequestException('Custom start time must be strictly before custom end time.');
      }
    }

    // 4. Duplicate / Overlapping Leave Collision Check
    const startDbDate = TimeUtility.toDbDate(startDt.toISODate()!);
    const endDbDate = TimeUtility.toDbDate(endDt.toISODate()!);

    const overlappingLeave = await this.prisma.stylistAbsence.findFirst({
      where: {
        salonId,
        stylistId,
        status: AbsenceStatus.ACTIVE,
        OR: [
          {
            AND: [
              { startDate: { lte: endDbDate } },
              { endDate: { gte: startDbDate } },
            ],
          },
          {
            absenceDate: { gte: startDbDate, lte: endDbDate },
          },
        ],
      },
    });

    if (overlappingLeave) {
      const s = (overlappingLeave.startDate || overlappingLeave.absenceDate)?.toISOString().split('T')[0];
      const e = (overlappingLeave.endDate || overlappingLeave.absenceDate)?.toISOString().split('T')[0];
      throw new BadRequestException(
        `Specialist already has an active leave scheduled from ${s} to ${e}. Use 'Extend Date' if you wish to lengthen an existing leave.`,
      );
    }

    // 5. Check Salon Closures (Holidays / Emergency Closures)
    const closures = await this.prisma.salonClosure.findMany({
      where: {
        salonId,
        startDate: { lte: endDbDate },
        endDate: { gte: startDbDate },
      },
    });

    const isSingleDay = startDt.hasSame(endDt, 'day');
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

    // 6. Stylist Weekly Off Check for Single Day
    if (isSingleDay) {
      const dayOfWeek = this.getDayOfWeekEnum(startDt);
      const shift = stylist.workingHours.find((w: any) => w.dayOfWeek === dayOfWeek);
      if (shift && !shift.isWorking) {
        throw new BadRequestException(
          `Specialist already has a scheduled weekly off on this day (${dayOfWeek}).`,
        );
      }
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
