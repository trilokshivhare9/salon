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

  async getAvailableSlots(
    salonId: string,
    serviceId: string,
    dateStr: string, // YYYY-MM-DD
    preferredStaffId?: string,
  ): Promise<AvailabilityResult> {
    // 1. Load Salon & Rules
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
    });

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

    // 2. Check Salon Holiday
    const holiday = await this.prisma.holiday.findFirst({
      where: {
        salonId,
        date: new Date(dateStr),
      },
    });

    if (holiday) {
      return {
        date: dateStr,
        salonTimezone: timezone,
        serviceDurationMinutes: 0,
        availableSlots: [],
      };
    }

    // 3. Load Service
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, salonId, status: 'ACTIVE' },
    });

    if (!service) {
      throw new NotFoundException('Service is inactive or does not exist.');
    }

    const serviceDuration = service.durationMinutes;
    const slotInterval = salon.slotIntervalMinutes || 30;

    // 4. Resolve Eligible Staff
    const staffQueryWhere: any = {
      salonId,
      status: 'ACTIVE',
      services: {
        some: { serviceId },
      },
    };

    if (preferredStaffId) {
      staffQueryWhere.id = preferredStaffId;
    }

    const eligibleStaff = await this.prisma.staff.findMany({
      where: staffQueryWhere,
      include: {
        workingHours: true,
        breaks: true,
      },
    });

    if (eligibleStaff.length === 0) {
      return {
        date: dateStr,
        salonTimezone: timezone,
        serviceDurationMinutes: serviceDuration,
        availableSlots: [],
      };
    }

    const dayOfWeek = this.getDayOfWeekEnum(requestedDate);

    // 5. Check Salon-level Working Hours
    const salonWorkingHours = await this.prisma.workingHours.findUnique({
      where: {
        salonId_dayOfWeek: {
          salonId,
          dayOfWeek,
        },
      },
    });

    if (!salonWorkingHours || !salonWorkingHours.isOpen) {
      return {
        date: dateStr,
        salonTimezone: timezone,
        serviceDurationMinutes: serviceDuration,
        availableSlots: [],
      };
    }

    // 6. Fetch Day-level Appointments & Blocked Times
    const dayStartUtc = requestedDate.toUTC().toJSDate();
    const dayEndUtc = requestedDate.endOf('day').toUTC().toJSDate();

    const existingAppointments = await this.prisma.appointment.findMany({
      where: {
        salonId,
        date: new Date(dateStr),
        status: {
          notIn: ['CANCELLED', 'NO_SHOW', 'RESCHEDULED'],
        },
      },
      select: {
        staffId: true,
        startTime: true,
        endTime: true,
      },
    });

    const blockedTimes = await this.prisma.blockedTime.findMany({
      where: {
        salonId,
        startTime: { lte: dayEndUtc },
        endTime: { gte: dayStartUtc },
      },
    });

    // 7. Calculate Available Slots per Staff Member
    const slotsMap = new Map<string, { startTime: string; endTime: string; eligibleStaffIds: Set<string> }>();

    for (const staff of eligibleStaff) {
      const staffHours = staff.workingHours.find((wh) => wh.dayOfWeek === dayOfWeek);
      if (!staffHours || !staffHours.isWorking) {
        continue;
      }

      const openMinutes = this.parseTimeStringToMinutes(staffHours.startTime || salonWorkingHours.openTime);
      const closeMinutes = this.parseTimeStringToMinutes(staffHours.endTime || salonWorkingHours.closeTime);

      const staffBreaks = staff.breaks
        .filter((b) => b.dayOfWeek === dayOfWeek)
        .map((b) => ({
          start: this.parseTimeStringToMinutes(b.startTime),
          end: this.parseTimeStringToMinutes(b.endTime),
        }));

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
          if (slotStartDt < earliestAllowed) {
            continue;
          }
        }

        const slotStartUtc = slotStartDt.toUTC().toJSDate();
        const slotEndUtc = slotEndDt.toUTC().toJSDate();

        // Check salon/staff blocked times overlap
        const overlapsBlocked = blockedTimes.some((bt) => {
          if (bt.staffId && bt.staffId !== staff.id) return false;
          return Math.max(slotStartUtc.getTime(), bt.startTime.getTime()) < Math.min(slotEndUtc.getTime(), bt.endTime.getTime());
        });
        if (overlapsBlocked) continue;

        // Check existing appointments overlap for this staff member
        const overlapsAppointment = existingAppointments.some((appt) => {
          if (appt.staffId !== staff.id) return false;
          return Math.max(slotStartUtc.getTime(), appt.startTime.getTime()) < Math.min(slotEndUtc.getTime(), appt.endTime.getTime());
        });
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

    // 8. Transform and sort response
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
