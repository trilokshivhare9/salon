import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { DayOfWeek } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { TimeUtility } from '../../../common/utils/time.utility';
import { AppointmentsService } from '../appointments/appointments.service';
import { HolidaysProviderService, CalendarHoliday } from './holidays-provider.service';
import { CreateClosureDto, GetCalendarScheduleDto, CalendarScope } from './dto';

@Injectable()
export class ClosuresService {
  private readonly logger = new Logger(ClosuresService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly appointmentsService: AppointmentsService,
    private readonly holidaysProvider: HolidaysProviderService,
  ) {}

  /**
   * Internal helper: Resolves exact operating shift for a given calendar date's day-of-week.
   * Dynamically inspects the salon's configured working hours without hardcoded arbitrary times.
   */
  private async getSalonHoursForDate(salonId: string, dateStr: string) {
    const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
    if (!salon) throw new NotFoundException('Salon not found.');

    const tz = salon.timezone || TimeUtility.DEFAULT_TIMEZONE;
    const dt = DateTime.fromISO(dateStr, { zone: tz });
    if (!dt.isValid) {
      throw new BadRequestException('Invalid date format. Expected YYYY-MM-DD.');
    }

    const dayOfWeek = TimeUtility.getDayOfWeekEnum(dt);
    const wh = await this.prisma.salonWorkingHours.findUnique({
      where: { salonId_dayOfWeek: { salonId, dayOfWeek } },
    });

    if (wh && !wh.isClosed && wh.startTime && wh.endTime) {
      return {
        date: dateStr,
        dayOfWeek,
        isClosed: false,
        startTime: wh.startTime,
        endTime: wh.endTime,
      };
    }

    if (wh && wh.isClosed) {
      return {
        date: dateStr,
        dayOfWeek,
        isClosed: true,
        startTime: wh.startTime || '00:00',
        endTime: wh.endTime || '23:59',
      };
    }

    // Dynamic fallback: Derive window from the salon's other configured active days
    const activeDays = await this.prisma.salonWorkingHours.findMany({
      where: { salonId, isClosed: false },
      orderBy: { startTime: 'asc' },
    });

    if (activeDays.length > 0) {
      const earliestOpen = activeDays[0].startTime;
      const latestClose = activeDays.reduce(
        (max, d) => (d.endTime > max ? d.endTime : max),
        activeDays[0].endTime,
      );
      return {
        date: dateStr,
        dayOfWeek,
        isClosed: false,
        startTime: earliestOpen,
        endTime: latestClose,
      };
    }

    // Default full calendar day coverage if salon has no schedule configured yet
    return {
      date: dateStr,
      dayOfWeek,
      isClosed: false,
      startTime: '00:00',
      endTime: '23:59',
    };
  }

  /**
   * Retrieve consolidated calendar operational schedule:
   * 1. Salon weekly working hours & weekly offs (7 days)
   * 2. Salon closures (full-day & partial-day) within date range
   * 3. Stylist working hours & weekly offs (7 days per stylist)
   * 4. Stylist approved leaves (flattened list with embedded stylist info)
   */
  async getCalendarSchedule(salonId: string, query: GetCalendarScheduleDto) {
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: { id: true, name: true, timezone: true },
    });
    if (!salon) throw new NotFoundException('Salon not found.');

    const tz = salon.timezone || TimeUtility.DEFAULT_TIMEZONE;
    const now = DateTime.now().setZone(tz);

    let startIso: string;
    let endIso: string;

    if (query.month) {
      if (!/^\d{4}-\d{2}$/.test(query.month)) {
        throw new BadRequestException('Invalid month format. Expected YYYY-MM.');
      }
      const [yearStr, monthStr] = query.month.split('-');
      const y = parseInt(yearStr, 10);
      const m = parseInt(monthStr, 10);
      const startDt = DateTime.fromObject({ year: y, month: m, day: 1 }, { zone: tz });
      if (!startDt.isValid) throw new BadRequestException('Invalid month format. Expected YYYY-MM.');
      startIso = startDt.startOf('month').toISODate()!;
      endIso = startDt.endOf('month').toISODate()!;
    } else if (query.startDate && query.endDate) {
      const sDt = DateTime.fromISO(query.startDate, { zone: tz });
      const eDt = DateTime.fromISO(query.endDate, { zone: tz });
      if (!sDt.isValid || !eDt.isValid) {
        throw new BadRequestException('Invalid startDate or endDate format. Expected YYYY-MM-DD.');
      }
      if (sDt > eDt) {
        throw new BadRequestException('startDate cannot be after endDate.');
      }
      startIso = sDt.toISODate()!;
      endIso = eDt.toISODate()!;
    } else {
      // Default to current month
      startIso = now.startOf('month').toISODate()!;
      endIso = now.endOf('month').toISODate()!;
    }

    const startDbDate = TimeUtility.toDbDate(startIso);
    const endDbDate = TimeUtility.toDbDate(endIso);

    // Resolve calendar scope (SALON vs STAFF)
    const calendarFor = query.calendarFor || CalendarScope.SALON;
    const targetStaffId = query.staffId || query.stylistId || null;

    if (calendarFor === CalendarScope.STAFF && !targetStaffId) {
      throw new BadRequestException("staffId is required and must be a valid UUID when calendarFor is 'STAFF'.");
    }

    // Parallel batch query for optimal single-roundtrip performance
    const [salonWorkingHours, salonClosures, stylists, stylistAbsences] = await Promise.all([
      // 1. Salon weekly operating hours (all 7 days)
      this.prisma.salonWorkingHours.findMany({
        where: { salonId },
        orderBy: { dayOfWeek: 'asc' },
      }),

      // 2. Salon closures overlapping the target range
      this.prisma.salonClosure.findMany({
        where: {
          salonId,
          startDate: { lte: endDbDate },
          endDate: { gte: startDbDate },
        },
        include: {
          createdByAdmin: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { startDate: 'asc' },
      }),

      // 3. Stylists with their scheduled working hours (filtered if in STAFF mode)
      this.prisma.stylist.findMany({
        where: {
          salonId,
          status: 'ACTIVE',
          ...(targetStaffId ? { id: targetStaffId } : {}),
        },
        select: {
          id: true,
          name: true,
          profileImageUrl: true,
          followsSalonSchedule: true,
          workingHours: {
            orderBy: { dayOfWeek: 'asc' },
          },
        },
        orderBy: { name: 'asc' },
      }),

      // 4. Stylist approved active leaves overlapping the range (filtered if in STAFF mode)
      this.prisma.stylistAbsence.findMany({
        where: {
          salonId,
          status: 'ACTIVE',
          startDate: { lte: endDbDate },
          endDate: { gte: startDbDate },
          ...(targetStaffId ? { stylistId: targetStaffId } : {}),
        },
        include: {
          stylist: {
            select: { id: true, name: true, profileImageUrl: true },
          },
        },
        orderBy: { startDate: 'asc' },
      }),
    ]);

    if (calendarFor === CalendarScope.STAFF && stylists.length === 0) {
      throw new NotFoundException('Specialist not found in this salon.');
    }


    // Standard day-of-week sequence: MONDAY through SUNDAY
    const DAYS_ORDER: DayOfWeek[] = [
      DayOfWeek.MONDAY,
      DayOfWeek.TUESDAY,
      DayOfWeek.WEDNESDAY,
      DayOfWeek.THURSDAY,
      DayOfWeek.FRIDAY,
      DayOfWeek.SATURDAY,
      DayOfWeek.SUNDAY,
    ];

    // Standardize salon 7-day schedule with varying shifts
    const salonWeeklyHours = DAYS_ORDER.map((day) => {
      const match = salonWorkingHours.find((h) => h.dayOfWeek === day);
      return {
        dayOfWeek: day,
        isClosed: match?.isClosed ?? false,
        startTime: match && !match.isClosed ? match.startTime : null,
        endTime: match && !match.isClosed ? match.endTime : null,
      };
    });

    // Format closures
    const formattedClosures = salonClosures.map((c: any) => ({
      id: c.id,
      closureType: c.closureType,
      startDate: TimeUtility.formatDateToISO(c.startDate, tz),
      endDate: TimeUtility.formatDateToISO(c.endDate, tz),
      isPartialDay: c.isPartialDay,
      startTime: c.startTime,
      endTime: c.endTime,
      reason: c.reason || 'Salon Closed',
      notes: c.notes || null,
      createdAt: c.createdAt ? c.createdAt.toISOString() : null,
      createdBy: c.createdByAdmin
        ? {
            id: c.createdByAdmin.id,
            name: c.createdByAdmin.name,
            email: c.createdByAdmin.email,
          }
        : null,
    }));

    // Iterate day-by-day across target range in salon timezone for precision calendar calculations
    const startDt = DateTime.fromISO(startIso, { zone: tz });
    const endDt = DateTime.fromISO(endIso, { zone: tz });
    const allDaysInRange: Array<{
      dateStr: string;
      dow: DayOfWeek;
      isSalonWeeklyOff: boolean;
      isClosure: boolean;
    }> = [];

    let curr = startDt;
    while (curr <= endDt) {
      const dateStr = curr.toISODate()!;
      const dow = TimeUtility.getDayOfWeekEnum(curr, tz);

      const salonHour = salonWorkingHours.find((h) => h.dayOfWeek === dow);
      const isSalonWeeklyOff = salonHour?.isClosed ?? false;
      const isClosure = formattedClosures.some(
        (c) => dateStr >= c.startDate && dateStr <= c.endDate && !c.isPartialDay,
      );

      allDaysInRange.push({
        dateStr,
        dow,
        isSalonWeeklyOff,
        isClosure,
      });

      curr = curr.plus({ days: 1 });
    }

    // ARCHITECTURAL VALIDATION RULE:
    // A specialist weekly off ONLY exists on days when the salon is OPEN.
    // If the salon is already closed on Tuesday, Tuesday is a Salon Weekly Off,
    // NOT an individual staff off. If staff marks an OTHER day (e.g. Wednesday),
    // it is an authentic staff off and is returned.
    const staffWeeklyOffs = stylists
      .map((st) => {
        const effectiveOffDays: DayOfWeek[] = [];

        DAYS_ORDER.forEach((day) => {
          const stHour = st.workingHours.find((h) => h.dayOfWeek === day);
          const isWorking = stHour ? stHour.isWorking : true;
          const salonHour = salonWorkingHours.find((h) => h.dayOfWeek === day);
          const isSalonClosed = salonHour?.isClosed ?? false;

          // Only valid if stylist is off AND salon is OPEN on that day
          if (!isWorking && !isSalonClosed) {
            effectiveOffDays.push(day);
          }
        });

        // Resolve exact dates within range where stylist is off and no store closure applies
        const dates: string[] = [];
        allDaysInRange.forEach((dayObj) => {
          if (effectiveOffDays.includes(dayObj.dow) && !dayObj.isClosure) {
            dates.push(dayObj.dateStr);
          }
        });

        const dayLabels = effectiveOffDays.map((d) => d.charAt(0) + d.slice(1).toLowerCase());

        return {
          stylistId: st.id,
          stylistName: st.name,
          profileImageUrl: st.profileImageUrl || null,
          offDays: effectiveOffDays,
          formattedDays: dayLabels.join(', '),
          dates,
          totalDatesCount: dates.length,
        };
      })
      .filter((st) => st.totalDatesCount > 0);

    // Format stylists with their individual 7-day shift schedules enriched with effective off flag
    const formattedStylists = stylists.map((st) => {
      const stylistWeeklyHours = DAYS_ORDER.map((day) => {
        const match = st.workingHours.find((h) => h.dayOfWeek === day);
        const isWorking = match ? match.isWorking : true;
        const salonHour = salonWorkingHours.find((h) => h.dayOfWeek === day);
        const isSalonClosed = salonHour?.isClosed ?? false;
        const isEffectiveStaffOff = !isWorking && !isSalonClosed;

        return {
          dayOfWeek: day,
          isWorking,
          isSalonClosed,
          isEffectiveStaffOff,
          startTime: match && isWorking ? match.startTime : null,
          endTime: match && isWorking ? match.endTime : null,
        };
      });

      return {
        stylistId: st.id,
        name: st.name,
        profileImageUrl: st.profileImageUrl || null,
        followsSalonSchedule: st.followsSalonSchedule,
        weeklyHours: stylistWeeklyHours,
      };
    });

    const todayIso = now.toISODate()!;

    // Format single flat leaves list with embedded stylist metadata & calculated duration
    const formattedLeaves = stylistAbsences.map((ab) => {
      const sDate = TimeUtility.formatDateToISO(ab.startDate, tz);
      const eDate = TimeUtility.formatDateToISO(ab.endDate, tz);
      const isPast = eDate < todayIso;

      const sDt = DateTime.fromISO(sDate, { zone: tz });
      const eDt = DateTime.fromISO(eDate, { zone: tz });
      const durationDays = Math.max(1, Math.round(eDt.diff(sDt, 'days').days) + 1);

      return {
        id: ab.id,
        stylistId: ab.stylistId,
        stylistName: ab.stylist?.name || 'Specialist',
        profileImageUrl: ab.stylist?.profileImageUrl || null,
        startDate: sDate,
        endDate: eDate,
        durationDays,
        isPast,
        isPartialDay: Boolean(ab.isPartialDay),
        startTime: ab.startTime || null,
        endTime: ab.endTime || null,
        leaveType: ab.leaveType,
        status: ab.status,
        reason: ab.reason || null,
        notes: ab.notes || null,
        createdAt: ab.createdAt || null,
      };
    });

    // 5. Authentic Indian Festivals & Gazetted Holidays enriched with operational status flags
    const rawFestivals = this.holidaysProvider.getHolidaysForRange(startIso, endIso);
    const enrichedFestivals = rawFestivals.map((fest) => {
      const isPast = fest.date < todayIso;
      const isClosed = formattedClosures.some(
        (c) => fest.date >= c.startDate && fest.date <= c.endDate && !c.isPartialDay,
      );
      const festDt = DateTime.fromISO(fest.date, { zone: tz });
      const festDow = TimeUtility.getDayOfWeekEnum(festDt, tz);
      const salonHour = salonWorkingHours.find((h) => h.dayOfWeek === festDow);
      const isSalonWeeklyOff = salonHour?.isClosed ?? false;
      const canClose = !isPast && !isClosed && !isSalonWeeklyOff;

      return {
        ...fest,
        isPast,
        isClosed,
        isSalonWeeklyOff,
        canClose,
      };
    });

    // Single source of truth summary counts
    const distinctSalonWeeklyOffDates = new Set(
      allDaysInRange.filter((d) => d.isSalonWeeklyOff).map((d) => d.dateStr),
    );
    const distinctStaffOffDates = new Set<string>();
    staffWeeklyOffs.forEach((st) => {
      st.dates.forEach((d) => distinctStaffOffDates.add(d));
    });

    const summaryCounts = {
      closuresCount: formattedClosures.length,
      salonWeeklyOffCount: distinctSalonWeeklyOffDates.size,
      staffWeeklyOffCount: distinctStaffOffDates.size,
      staffLeavesCount: formattedLeaves.length,
      festivalsCount: enrichedFestivals.length,
    };

    return {
      success: true,
      data: {
        calendarFor,
        targetStaff:
          calendarFor === CalendarScope.STAFF && stylists.length > 0
            ? {
                id: stylists[0].id,
                name: stylists[0].name,
                profileImageUrl: stylists[0].profileImageUrl || null,
              }
            : null,
        dateRange: {
          startDate: startIso,
          endDate: endIso,
        },
        summaryCounts,
        salonSchedule: {
          weeklyHours: salonWeeklyHours,
          closures: formattedClosures,
        },
        stylists: formattedStylists,
        staffWeeklyOffs,
        leaves: formattedLeaves,
        festivals: enrichedFestivals,
      },
    };
  }

  /**
   * Retrieve authentic Indian festivals and gazetted holidays for any range or month/year
   * Directly from @aryanjsx/indian-festivals and date-holidays dependencies.
   */
  async getHolidays(options: { startDate?: string; endDate?: string; year?: number; month?: number }): Promise<CalendarHoliday[]> {
    if (options.startDate && options.endDate) {
      return this.holidaysProvider.getHolidaysForRange(options.startDate, options.endDate);
    }
    const now = DateTime.now();
    const year = options.year || now.year;
    const month = options.month || now.month;
    return this.holidaysProvider.getHolidaysForMonth(month, year);
  }

  /**
   * Retrieve all closures and holidays for a salon (ordered newest first)
   */
  async getClosures(salonId: string) {
    return this.prisma.salonClosure.findMany({
      where: { salonId },
      orderBy: { startDate: 'desc' },
      include: {
        createdByAdmin: { select: { id: true, name: true, email: true } },
      },
    });
  }

  /**
   * Create a new salon closure, automatically resolving conflicting bookings via WhatsApp
   */
  async createClosure(salonId: string, dto: CreateClosureDto, adminId?: string) {
    const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
    if (!salon) throw new NotFoundException('Salon not found.');

    const tz = salon.timezone || TimeUtility.DEFAULT_TIMEZONE;
    const nowInTz = DateTime.now().setZone(tz);
    const todayDt = nowInTz.startOf('day');

    const startDt = DateTime.fromISO(dto.startDate, { zone: tz }).startOf('day');
    const endDt = DateTime.fromISO(dto.endDate, { zone: tz }).endOf('day');

    if (!startDt.isValid || !endDt.isValid) {
      throw new BadRequestException('Invalid date format. Expected YYYY-MM-DD.');
    }

    // Edge Case 1: Inverted Dates
    if (startDt > endDt) {
      throw new BadRequestException('Closure start date must be on or before end date.');
    }

    // Edge Case 2: Past Historical Dates
    if (startDt < todayDt) {
      throw new BadRequestException('Cannot schedule closures or holidays for dates that have already passed.');
    }

    // Edge Case 3: Excessive Duration (prevent accidental multi-year date selections)
    const diffDays = Math.ceil(endDt.diff(startDt, 'days').days);
    if (diffDays > 60) {
      throw new BadRequestException('A single salon closure range cannot exceed 60 consecutive days.');
    }

    // Edge Case 4: Advance Booking Horizon
    const maxDays = salon.maxAdvanceDays || 365;
    if (startDt.diff(todayDt, 'days').days > maxDays) {
      throw new BadRequestException(`Cannot schedule closures more than ${maxDays} days in advance.`);
    }

    const isSingleDay = dto.startDate === dto.endDate;
    const isPartial = dto.isPartialDay === true;

    // Edge Case 5: Partial-day closures must be strictly single-day
    if (isPartial && !isSingleDay) {
      throw new BadRequestException(
        'Partial-day closures can only be scheduled for a single date. For multi-day closures, select Full Day.',
      );
    }

    // Resolve working hours for start date and end date
    const startWorkingHours = await this.getSalonHoursForDate(salonId, dto.startDate);
    const endWorkingHours = isSingleDay ? startWorkingHours : await this.getSalonHoursForDate(salonId, dto.endDate);

    // Edge Case 5a: Single-day closures cannot be scheduled on an existing regular weekly off
    if (isSingleDay && startWorkingHours.isClosed) {
      const dayLabel = startWorkingHours.dayOfWeek
        ? startWorkingHours.dayOfWeek.charAt(0) + startWorkingHours.dayOfWeek.slice(1).toLowerCase()
        : 'This day';
      throw new BadRequestException(
        `${dayLabel} is already a scheduled weekly off for the salon. You cannot schedule a single-day closure on a regular off day.`,
      );
    }

    const finalStart = isPartial && dto.startTime ? dto.startTime : startWorkingHours.startTime;
    const finalEnd = isPartial && dto.endTime ? dto.endTime : startWorkingHours.endTime;

    if (isPartial) {
      if (startWorkingHours.isClosed) {
        throw new BadRequestException('Cannot schedule a partial closure on a regular weekly off day.');
      }

      const startMin = TimeUtility.parseTimeStringToMinutes(finalStart);
      const endMin = TimeUtility.parseTimeStringToMinutes(finalEnd);
      const shiftStartMin = TimeUtility.parseTimeStringToMinutes(startWorkingHours.startTime);
      const shiftEndMin = TimeUtility.parseTimeStringToMinutes(startWorkingHours.endTime);

      // Edge Case 6: Inverted or zero-duration partial hours
      if (startMin >= endMin) {
        throw new BadRequestException('Closure start time must be strictly before end time.');
      }

      // Edge Case 7: Minimum closure duration (at least 15 minutes)
      if (endMin - startMin < 15) {
        throw new BadRequestException('Partial-day closures must be at least 15 minutes in duration.');
      }

      // Edge Case 7a: Operating Shift Containment
      if (startMin < shiftStartMin) {
        throw new BadRequestException(
          `Closure start time (${TimeUtility.formatTime12h(finalStart)}) cannot be before the operating shift start (${TimeUtility.formatTime12h(startWorkingHours.startTime)}).`,
        );
      }

      if (endMin > shiftEndMin) {
        throw new BadRequestException(
          `Closure end time (${TimeUtility.formatTime12h(finalEnd)}) cannot be after the operating shift end (${TimeUtility.formatTime12h(startWorkingHours.endTime)}).`,
        );
      }

      // Edge Case 8: Past hours today (cannot close for a window that has already elapsed today)
      if (dto.startDate === nowInTz.toISODate()) {
        const currentMinutes = nowInTz.hour * 60 + nowInTz.minute;
        if (endMin <= currentMinutes) {
          throw new BadRequestException('Cannot schedule a partial closure for hours that have already passed today.');
        }
      }
    }

    // Edge Case 9: Overlapping closure collision check (normalized UTC dates)
    const startDbDate = TimeUtility.toDbDate(dto.startDate);
    const endDbDate = TimeUtility.toDbDate(dto.endDate);

    const existingClosures = await this.prisma.salonClosure.findMany({
      where: {
        salonId,
        startDate: { lte: endDbDate },
        endDate: { gte: startDbDate },
      },
    });

    if (existingClosures.length > 0) {
      for (const existing of existingClosures) {
        // If either existing or new closure is Full Day, collision is absolute
        if (!isPartial || !existing.isPartialDay) {
          throw new BadRequestException(
            `A closure already exists overlapping these dates (${existing.reason || 'Salon Closure'}). Reopen or cancel the existing closure first.`,
          );
        }

        // If both are partial closures on the same single day, check for time window overlap
        const [exSh, exSm] = existing.startTime.split(':').map(Number);
        const [exEh, exEm] = existing.endTime.split(':').map(Number);
        const exStartMin = exSh * 60 + exSm;
        const exEndMin = exEh * 60 + exEm;

        const [sh, sm] = finalStart.split(':').map(Number);
        const [eh, em] = finalEnd.split(':').map(Number);
        const newStartMin = sh * 60 + sm;
        const newEndMin = eh * 60 + em;

        // Collision occurs if NOT (newEnd <= exStart || newStart >= exEnd)
        if (!(newEndMin <= exStartMin || newStartMin >= exEndMin)) {
          throw new BadRequestException(
            `Partial closure hours (${finalStart} - ${finalEnd}) overlap with an existing closure on this date (${existing.startTime} - ${existing.endTime}: "${existing.reason}").`,
          );
        }
      }
    }

    const cleanReason = dto.reason?.trim() || 'Salon Store Closure';

    // 3. Centralized Conflict Engine (WhatsApp Auto-Rescheduling)
    const resolution = await this.appointmentsService.resolveScheduleConflicts({
      salonId,
      scope: 'SALON',
      dateRange: {
        startDate: startDbDate,
        endDate: endDbDate,
        isPartialDay: isPartial,
        startTime: finalStart,
        endTime: finalEnd,
      },
      isClosedOrOff: true,
      reason: cleanReason,
      adminId,
    });

    // 4. Save SalonClosure record in PostgreSQL
    const closure = await this.prisma.salonClosure.create({
      data: {
        salonId,
        closureType: dto.closureType,
        startDate: startDbDate,
        endDate: endDbDate,
        isPartialDay: isPartial,
        startTime: finalStart,
        endTime: finalEnd,
        reason: cleanReason,
        notes: dto.notes?.trim() || null,
        createdByAdminId: adminId || null,
      },
    });

    // 5. Broadcast Realtime WebSocket Event to dashboard
    this.appointmentsService.emitSalonEvent(salonId, 'STATUS_UPDATED', {
      type: 'SALON_CLOSURE_CREATED',
      closure,
    });

    const affectedCount = resolution?.totalAffected ?? (resolution?.details?.length || 0);

    return {
      closure,
      rescheduledCount: affectedCount,
      message: resolution?.message || (affectedCount > 0
        ? `Salon closure scheduled. ${affectedCount} customer appointment(s) sent for WhatsApp reschedule.`
        : 'Salon closure scheduled successfully.'),
    };
  }

  /**
   * Delete an upcoming closure and reopen booking calendar
   */
  async deleteClosure(salonId: string, closureId: string) {
    const closure = await this.prisma.salonClosure.findFirst({
      where: { id: closureId, salonId },
    });
    if (!closure) throw new NotFoundException('Salon closure record not found.');

    const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
    const tz = salon?.timezone || TimeUtility.DEFAULT_TIMEZONE;
    const todayDt = DateTime.now().setZone(tz).startOf('day');
    const closureEndDt = DateTime.fromJSDate(closure.endDate, { zone: tz }).endOf('day');

    if (closureEndDt < todayDt) {
      throw new BadRequestException('Past historical closures cannot be reopened.');
    }

    await this.prisma.salonClosure.delete({
      where: { id: closureId },
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STATUS_UPDATED', {
      type: 'SALON_CLOSURE_DELETED',
      closureId,
    });

    return { message: 'Salon closure cancelled and calendar reopened successfully.' };
  }
}
