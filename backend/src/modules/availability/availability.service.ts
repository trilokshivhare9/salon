import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DateTime } from 'luxon';
import { DayOfWeek } from '@prisma/client';

export interface AvailableSlotResponse {
  startTime: string;       // "17:00" (Local salon time)
  endTime: string;         // "18:30" (startTime + serviceDuration)
  isoStartTime: string;    // UTC ISO timestamp
  isoEndTime: string;      // UTC ISO timestamp
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
    const dayNumber = luxonDateTime.weekday; // 1 = Monday ... 7 = Sunday
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
    preferredStylistId?: string,
    excludeAppointmentId?: string,
    candidateStepMinutes: number = 15,
  ): Promise<AvailabilityResult> {
    // 1. Load Salon & validate
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

    const dayOfWeek = this.getDayOfWeekEnum(requestedDate);

    // 2. Fetch Service & Salon Operating Hours in parallel
    const [service, salonWorkingHours] = await Promise.all([
      this.prisma.service.findFirst({
        where: { id: serviceId, salonId, status: 'ACTIVE' },
      }),
      this.prisma.salonWorkingHours.findUnique({
        where: { salonId_dayOfWeek: { salonId, dayOfWeek } },
      }),
    ]);

    if (!service) {
      throw new NotFoundException('Service is inactive or does not exist.');
    }

    const serviceDuration = service.durationMinutes;

    // Check if salon is closed on this day
    if (!salonWorkingHours || salonWorkingHours.isClosed) {
      return {
        date: dateStr,
        salonTimezone: timezone,
        serviceDurationMinutes: serviceDuration,
        availableSlots: [],
      };
    }

    const salonOpenMinutes = this.parseTimeStringToMinutes(salonWorkingHours.startTime);
    const salonCloseMinutes = this.parseTimeStringToMinutes(salonWorkingHours.endTime);

    const salonBreak =
      salonWorkingHours.breakStartTime && salonWorkingHours.breakEndTime
        ? {
            start: this.parseTimeStringToMinutes(salonWorkingHours.breakStartTime),
            end: this.parseTimeStringToMinutes(salonWorkingHours.breakEndTime),
          }
        : null;

    // 3. Query eligible active stylists assigned to this service
    const stylistQueryWhere: any = {
      salonId,
      status: 'ACTIVE',
      services: { some: { serviceId } },
    };
    if (preferredStylistId) {
      stylistQueryWhere.id = preferredStylistId;
    }

    const eligibleStylists = await this.prisma.stylist.findMany({
      where: stylistQueryWhere,
      include: {
        workingHours: {
          where: { dayOfWeek },
        },
      },
    });

    if (eligibleStylists.length === 0) {
      return {
        date: dateStr,
        salonTimezone: timezone,
        serviceDurationMinutes: serviceDuration,
        availableSlots: [],
      };
    }

    // 4. Fetch existing appointments for eligible stylists on this date
    const apptWhere: any = {
      salonId,
      appointmentDate: new Date(dateStr),
      status: { notIn: ['CANCELLED', 'NO_SHOW', 'RESCHEDULED', 'EXPIRED'] },
    };
    if (excludeAppointmentId) {
      apptWhere.id = { not: excludeAppointmentId };
    }

    const existingAppointments = await this.prisma.appointment.findMany({
      where: apptWhere,
      select: { stylistId: true, startAt: true, endAt: true },
    });

    const appointmentsByStylist = new Map<string, { start: number; end: number }[]>();
    for (const appt of existingAppointments) {
      if (!appt.stylistId) continue;
      if (!appointmentsByStylist.has(appt.stylistId)) {
        appointmentsByStylist.set(appt.stylistId, []);
      }
      const apptStartDt = DateTime.fromJSDate(appt.startAt).setZone(timezone);
      const apptEndDt = DateTime.fromJSDate(appt.endAt).setZone(timezone);
      const startMin = apptStartDt.hour * 60 + apptStartDt.minute;
      const endMin = apptEndDt.hour * 60 + apptEndDt.minute;
      appointmentsByStylist.get(appt.stylistId)!.push({ start: startMin, end: endMin });
    }

    // 5. Continuous Free-Interval Calculation per Stylist
    const slotsMap = new Map<string, { startTime: string; endTime: string; eligibleStylistIds: Set<string> }>();

    for (const stylist of eligibleStylists) {
      let stylistOpen = salonOpenMinutes;
      let stylistClose = salonCloseMinutes;
      let stylistBreak: { start: number; end: number } | null = null;

      if (!stylist.followsSalonSchedule) {
        const customHours = stylist.workingHours[0];
        if (!customHours || !customHours.isWorking) {
          continue; // Stylist not working today
        }
        stylistOpen = this.parseTimeStringToMinutes(customHours.startTime);
        stylistClose = this.parseTimeStringToMinutes(customHours.endTime);
        if (customHours.breakStartTime && customHours.breakEndTime) {
          stylistBreak = {
            start: this.parseTimeStringToMinutes(customHours.breakStartTime),
            end: this.parseTimeStringToMinutes(customHours.breakEndTime),
          };
        }
      }

      // Effective operating interval: stylist hours bounded by salon operating hours
      const effectiveOpen = Math.max(salonOpenMinutes, stylistOpen);
      const effectiveClose = Math.min(salonCloseMinutes, stylistClose);

      if (effectiveOpen >= effectiveClose) {
        continue;
      }

      // Collect all busy intervals to subtract
      const busyIntervals: { start: number; end: number }[] = [];

      // Mandatory salon break (highest priority)
      if (salonBreak) {
        busyIntervals.push(salonBreak);
      }

      // Stylist break (if custom)
      if (stylistBreak) {
        busyIntervals.push(stylistBreak);
      }

      // Existing appointments
      const appts = appointmentsByStylist.get(stylist.id) || [];
      for (const a of appts) {
        busyIntervals.push(a);
      }

      // Subtract busy intervals to find continuous free intervals
      let freeIntervals: { start: number; end: number }[] = [
        { start: effectiveOpen, end: effectiveClose },
      ];

      for (const busy of busyIntervals) {
        const nextFree: { start: number; end: number }[] = [];
        for (const free of freeIntervals) {
          // Check overlap
          if (Math.max(free.start, busy.start) < Math.min(free.end, busy.end)) {
            if (free.start < busy.start) {
              nextFree.push({ start: free.start, end: Math.min(free.end, busy.start) });
            }
            if (free.end > busy.end) {
              nextFree.push({ start: Math.max(free.start, busy.end), end: free.end });
            }
          } else {
            nextFree.push(free);
          }
        }
        freeIntervals = nextFree;
      }

      // Filter intervals that can accommodate the continuous service duration
      const validFreeIntervals = freeIntervals.filter(
        (intv) => intv.end - intv.start >= serviceDuration,
      );

      // Advance notice check if booking for today
      let earliestAllowedMinutes = 0;
      if (requestedDate.hasSame(todayInSalonZone, 'day')) {
        const earliestAllowedDt = nowInSalonZone.plus({ minutes: 15 }); // 15 min buffer
        earliestAllowedMinutes = earliestAllowedDt.hour * 60 + earliestAllowedDt.minute;
      }

      // Generate candidate start times within continuous free intervals
      for (const interval of validFreeIntervals) {
        // Step in candidate resolution (default: 15 min)
        let candidateStart = interval.start;
        // Align candidate start to the step if desired
        const remainder = candidateStart % candidateStepMinutes;
        if (remainder !== 0) {
          candidateStart += candidateStepMinutes - remainder;
        }

        while (candidateStart + serviceDuration <= interval.end) {
          if (
            !requestedDate.hasSame(todayInSalonZone, 'day') ||
            candidateStart >= earliestAllowedMinutes
          ) {
            const timeKey = this.formatMinutesToTime(candidateStart);
            const endTimeKey = this.formatMinutesToTime(candidateStart + serviceDuration);

            if (!slotsMap.has(timeKey)) {
              slotsMap.set(timeKey, {
                startTime: timeKey,
                endTime: endTimeKey,
                eligibleStylistIds: new Set<string>(),
              });
            }
            slotsMap.get(timeKey)!.eligibleStylistIds.add(stylist.id);
          }
          candidateStart += candidateStepMinutes;
        }
      }
    }

    // 6. Format and sort final slots
    const availableSlots: AvailableSlotResponse[] = Array.from(slotsMap.values())
      .map((slot) => {
        const [h, m] = slot.startTime.split(':').map((v) => parseInt(v, 10));
        const [eh, em] = slot.endTime.split(':').map((v) => parseInt(v, 10));

        const isoStart = requestedDate.set({ hour: h, minute: m, second: 0, millisecond: 0 }).toUTC().toISO()!;
        const isoEnd = requestedDate.set({ hour: eh, minute: em, second: 0, millisecond: 0 }).toUTC().toISO()!;

        return {
          startTime: slot.startTime,
          endTime: slot.endTime,
          isoStartTime: isoStart,
          isoEndTime: isoEnd,
          availableStaffCount: slot.eligibleStylistIds.size,
          eligibleStaffIds: Array.from(slot.eligibleStylistIds),
        };
      })
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    return {
      date: dateStr,
      salonTimezone: timezone,
      serviceDurationMinutes: serviceDuration,
      availableSlots,
    };
  }
}
