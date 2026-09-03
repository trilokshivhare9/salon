import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DateTime } from 'luxon';
import { DayOfWeek } from '@prisma/client';

export interface AvailableSlotResponse {
  startTime: string; // "10:00" (Local salon time)
  endTime: string;   // "10:45"
  isoStartTime: string; // UTC ISO string
  isoEndTime: string;   // UTC ISO string
  availableStaffCount: number;
  eligibleStaffIds: string[];
}

export interface AvailabilityResult {
  date: string;
  salonTimezone: string;
  serviceDurationMinutes: number;
  availableSlots: AvailableSlotResponse[];
}

// In-memory salon cache (timezone + config rarely changes)
const salonCache = new Map<string, { data: any; ts: number }>();
const SALON_CACHE_TTL = 300000; // 5 minutes

@Injectable()
export class AvailabilityService {
  constructor(private prisma: PrismaService) {}

  private parseTimeStringToMinutes(timeStr: string): number {
    const [hours, mins] = timeStr.split(':').map((v) => parseInt(v, 10));
    return hours * 60 + mins;
  }

  private formatMinutesToTime(totalMinutes: number): string {
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  }

  private getDayOfWeekEnum(luxonDateTime: DateTime): DayOfWeek {
    const dayNumber = luxonDateTime.weekday; // 1 = Monday, 7 = Sunday
    const mapping: Record<number, DayOfWeek> = {
      1: DayOfWeek.MONDAY,
      2: DayOfWeek.TUESDAY,
      3: DayOfWeek.WEDNESDAY,
      4: DayOfWeek.THURSDAY,
      5: DayOfWeek.FRIDAY,
      6: DayOfWeek.SATURDAY,
      7: DayOfWeek.SUNDAY,
    };
    return mapping[dayNumber];
  }

  private async getCachedSalon(salonId: string) {
    const cached = salonCache.get(salonId);
    if (cached && Date.now() - cached.ts < SALON_CACHE_TTL) {
      return cached.data;
    }
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
    });
    if (salon) {
      salonCache.set(salonId, { data: salon, ts: Date.now() });
    }
    return salon;
  }

  async getAvailableSlots(
    salonId: string,
    serviceId: string,
    dateStr: string, // YYYY-MM-DD
    preferredStaffId?: string,
    excludeAppointmentId?: string,
  ): Promise<AvailabilityResult> {
    // 1. Load Salon (cached — rarely changes)
    const salon = await this.getCachedSalon(salonId);

    if (!salon || salon.status !== 'ACTIVE') {
      throw new NotFoundException('Salon is inactive or not found.');
    }

    const timezone = salon.timezone || 'Asia/Kolkata';

    // Parse date in salon local timezone
    const requestedDate = DateTime.fromISO(dateStr, { zone: timezone }).startOf('day');
    if (!requestedDate.isValid) {
      throw new BadRequestException('Invalid date format. Expected YYYY-MM-DD.');
    }

    const nowInSalonZone = DateTime.now().setZone(timezone);
    const todayInSalonZone = nowInSalonZone.startOf('day');

    // Past date check
    if (requestedDate < todayInSalonZone) {
      return {
        date: dateStr,
        salonTimezone: timezone,
        serviceDurationMinutes: 0,
        availableSlots: [],
      };
    }

    // Maximum advance days check
    const maxDateAllowed = todayInSalonZone.plus({ days: salon.maxAdvanceDays });
    if (requestedDate > maxDateAllowed) {
      return {
        date: dateStr,
        salonTimezone: timezone,
        serviceDurationMinutes: 0,
        availableSlots: [],
      };
    }

    const dayOfWeek = this.getDayOfWeekEnum(requestedDate);

    // 2. OPTIMIZED: Batch all independent queries in parallel (saves ~150ms)
    const staffQueryWhere: any = {
      salonId,
      status: 'ACTIVE',
      services: { some: { serviceId } },
    };
    if (preferredStaffId) {
      staffQueryWhere.id = preferredStaffId;
    }

    const [holiday, service, eligibleStaff, salonWorkingHours] = await Promise.all([
      this.prisma.holiday.findFirst({
        where: { salonId, date: new Date(dateStr) },
      }),
      this.prisma.service.findFirst({
        where: { id: serviceId, salonId, status: 'ACTIVE' },
      }),
      this.prisma.staff.findMany({
        where: staffQueryWhere,
        include: { workingHours: true, breaks: true },
      }),
      this.prisma.workingHours.findUnique({
        where: { salonId_dayOfWeek: { salonId, dayOfWeek } },
      }),
    ]);

    if (holiday) {
      return { date: dateStr, salonTimezone: timezone, serviceDurationMinutes: 0, availableSlots: [] };
    }

    if (!service) {
      throw new NotFoundException('Service is inactive or does not exist.');
    }

    if (eligibleStaff.length === 0) {
      return { date: dateStr, salonTimezone: timezone, serviceDurationMinutes: service.durationMinutes, availableSlots: [] };
    }

    if (!salonWorkingHours || !salonWorkingHours.isOpen) {
      return { date: dateStr, salonTimezone: timezone, serviceDurationMinutes: service.durationMinutes, availableSlots: [] };
    }

    const serviceDuration = service.durationMinutes;
    const slotInterval = salon.slotIntervalMinutes || 30;

    // 3. OPTIMIZED: Fetch appointments + blocked times in parallel
    const dayStartUtc = requestedDate.toUTC().toJSDate();
    const dayEndUtc = requestedDate.endOf('day').toUTC().toJSDate();

    const apptWhere: any = {
      salonId,
      date: new Date(dateStr),
      status: { notIn: ['CANCELLED', 'NO_SHOW', 'RESCHEDULED'] },
    };
    if (excludeAppointmentId) {
      apptWhere.id = { not: excludeAppointmentId };
    }

    const [existingAppointments, blockedTimes] = await Promise.all([
      this.prisma.appointment.findMany({
        where: apptWhere,
        select: { staffId: true, startTime: true, endTime: true },
      }),
      this.prisma.blockedTime.findMany({
        where: {
          salonId,
          startTime: { lte: dayEndUtc },
          endTime: { gte: dayStartUtc },
        },
      }),
    ]);


    // 4. Calculate Available Slots per Staff Member (pure in-memory computation)
    const slotsMap = new Map<string, { startTime: string; endTime: string; eligibleStaffIds: Set<string> }>();

    // Pre-compute blocked time ranges for fast lookup
    const blockedRanges = blockedTimes.map((bt) => ({
      staffId: bt.staffId,
      start: bt.startTime.getTime(),
      end: bt.endTime.getTime(),
    }));

    // Pre-compute appointment ranges grouped by staff for O(1) staff lookup
    const appointmentsByStaff = new Map<string, { start: number; end: number }[]>();
    for (const appt of existingAppointments) {
      if (!appt.staffId) continue;
      if (!appointmentsByStaff.has(appt.staffId)) {
        appointmentsByStaff.set(appt.staffId, []);
      }
      appointmentsByStaff.get(appt.staffId)!.push({
        start: appt.startTime.getTime(),
        end: appt.endTime.getTime(),
      });
    }

    for (const staff of eligibleStaff) {
      const staffHours = staff.workingHours.find((wh) => wh.dayOfWeek === dayOfWeek);
      if (!staffHours || !staffHours.isWorking) continue;

      const openMinutes = this.parseTimeStringToMinutes(staffHours.startTime || salonWorkingHours.openTime);
      const closeMinutes = this.parseTimeStringToMinutes(staffHours.endTime || salonWorkingHours.closeTime);

      const staffBreaks = staff.breaks
        .filter((b) => b.dayOfWeek === dayOfWeek)
        .map((b) => ({
          start: this.parseTimeStringToMinutes(b.startTime),
          end: this.parseTimeStringToMinutes(b.endTime),
        }));

      const staffAppts = appointmentsByStaff.get(staff.id) || [];

      // Candidate slot loop
      for (let slotStartMin = openMinutes; slotStartMin + serviceDuration <= closeMinutes; slotStartMin += slotInterval) {
        const slotEndMin = slotStartMin + serviceDuration;

        // Check breaks overlap
        const overlapsBreak = staffBreaks.some(
          (brk) => Math.max(slotStartMin, brk.start) < Math.min(slotEndMin, brk.end),
        );
        if (overlapsBreak) continue;

        // Construct slot timestamp in salon timezone
        const slotStartDt = requestedDate.plus({ minutes: slotStartMin });
        const slotEndDt = requestedDate.plus({ minutes: slotEndMin });

        // Advance notice constraint (if booking for today)
        if (requestedDate.hasSame(todayInSalonZone, 'day')) {
          const earliestAllowed = nowInSalonZone.plus({ minutes: salon.minAdvanceNoticeMins });
          if (slotStartDt < earliestAllowed) continue;
        }

        const slotStartMs = slotStartDt.toUTC().toMillis();
        const slotEndMs = slotEndDt.toUTC().toMillis();

        // Check blocked times overlap (using pre-computed ranges)
        const overlapsBlocked = blockedRanges.some((bt) => {
          if (bt.staffId && bt.staffId !== staff.id) return false;
          return Math.max(slotStartMs, bt.start) < Math.min(slotEndMs, bt.end);
        });
        if (overlapsBlocked) continue;

        // Check existing appointments overlap (using pre-indexed staff map)
        const overlapsAppointment = staffAppts.some(
          (appt) => Math.max(slotStartMs, appt.start) < Math.min(slotEndMs, appt.end),
        );
        if (overlapsAppointment) continue;

        // Valid slot found!
        const timeKey = this.formatMinutesToTime(slotStartMin);
        const endTimeKey = this.formatMinutesToTime(slotEndMin);

        if (!slotsMap.has(timeKey)) {
          slotsMap.set(timeKey, {
            startTime: timeKey,
            endTime: endTimeKey,
            eligibleStaffIds: new Set<string>(),
          });
        }
        slotsMap.get(timeKey)!.eligibleStaffIds.add(staff.id);
      }
    }

    // 5. Transform and sort response
    const sortedTimeKeys = Array.from(slotsMap.keys()).sort((a, b) => {
      return this.parseTimeStringToMinutes(a) - this.parseTimeStringToMinutes(b);
    });

    const availableSlots: AvailableSlotResponse[] = sortedTimeKeys.map((timeKey) => {
      const entry = slotsMap.get(timeKey)!;
      const startMin = this.parseTimeStringToMinutes(entry.startTime);
      const endMin = this.parseTimeStringToMinutes(entry.endTime);

      const slotStartDt = requestedDate.plus({ minutes: startMin });
      const slotEndDt = requestedDate.plus({ minutes: endMin });

      return {
        startTime: entry.startTime,
        endTime: entry.endTime,
        isoStartTime: slotStartDt.toUTC().toISO()!,
        isoEndTime: slotEndDt.toUTC().toISO()!,
        availableStaffCount: entry.eligibleStaffIds.size,
        eligibleStaffIds: Array.from(entry.eligibleStaffIds),
      };
    });

    return {
      date: dateStr,
      salonTimezone: timezone,
      serviceDurationMinutes: serviceDuration,
      availableSlots,
    };
  }
}
