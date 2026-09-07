import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DateTime } from 'luxon';
import { DayOfWeek } from '@prisma/client';

export type AvailabilityStatus =
  | 'AVAILABLE'
  | 'PAST_DATE'
  | 'MAX_ADVANCE_EXCEEDED'
  | 'SALON_CLOSED'
  | 'NO_QUALIFIED_STAFF'
  | 'STAFF_UNAVAILABLE'
  | 'FULLY_BOOKED';

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
  status: AvailabilityStatus;
  statusReason?: string;
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
    serviceIdOrIds: string | string[],
    dateStr: string, // YYYY-MM-DD
    preferredStylistId?: string,
    excludeAppointmentId?: string,
    candidateStepMinutes?: number,
  ): Promise<AvailabilityResult> {
    const serviceIds = Array.isArray(serviceIdOrIds) ? serviceIdOrIds : [serviceIdOrIds];
    if (serviceIds.length === 0) {
      throw new BadRequestException('At least one serviceId must be provided.');
    }

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
        status: 'PAST_DATE',
        statusReason: 'Cannot book appointments for past dates.',
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
        status: 'MAX_ADVANCE_EXCEEDED',
        statusReason: `Bookings can only be made up to ${salon.maxAdvanceDays} days in advance.`,
      };
    }

    const dayOfWeek = this.getDayOfWeekEnum(requestedDate);

    // 2. Fetch Services & Salon Operating Hours in parallel
    const [services, salonWorkingHours] = await Promise.all([
      this.prisma.service.findMany({
        where: { id: { in: serviceIds }, salonId, status: 'ACTIVE' },
      }),
      this.prisma.salonWorkingHours.findUnique({
        where: { salonId_dayOfWeek: { salonId, dayOfWeek } },
      }),
    ]);

    if (services.length !== serviceIds.length) {
      throw new NotFoundException('One or more selected services are inactive or do not exist.');
    }

    const totalServiceDuration = services.reduce((sum, s) => sum + s.durationMinutes, 0);

    // Slot interval is driven directly by total service duration (e.g. 30m, 45m, 60m) unless explicitly overridden
    const stepMinutes =
      candidateStepMinutes !== undefined && candidateStepMinutes > 0
        ? candidateStepMinutes
        : (totalServiceDuration > 0 ? totalServiceDuration : 15);

    const isSalonClosed = !salonWorkingHours || salonWorkingHours.isClosed;
    const salonOpenMinutes =
      !isSalonClosed && salonWorkingHours
        ? this.parseTimeStringToMinutes(salonWorkingHours.startTime)
        : null;
    const salonCloseMinutes =
      !isSalonClosed && salonWorkingHours
        ? this.parseTimeStringToMinutes(salonWorkingHours.endTime)
        : null;

    const salonBreak =
      !isSalonClosed &&
      salonWorkingHours &&
      salonWorkingHours.breakStartTime &&
      salonWorkingHours.breakEndTime
        ? {
            start: this.parseTimeStringToMinutes(salonWorkingHours.breakStartTime),
            end: this.parseTimeStringToMinutes(salonWorkingHours.breakEndTime),
          }
        : null;

    // 3. Query eligible active stylists assigned to ALL requested services
    const stylistQueryWhere: any = {
      salonId,
      status: 'ACTIVE',
      AND: serviceIds.map((sId) => ({ services: { some: { serviceId: sId } } })),
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
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    if (eligibleStylists.length === 0) {
      // Diagnostic check: Does the salon have ANY active stylists qualified for these services?
      const totalSalonQualifiedCount = await this.prisma.stylist.count({
        where: {
          salonId,
          status: 'ACTIVE',
          AND: serviceIds.map((sId) => ({ services: { some: { serviceId: sId } } })),
        },
      });

      const diagnosticStatus: AvailabilityStatus =
        totalSalonQualifiedCount === 0 ? 'NO_QUALIFIED_STAFF' : 'STAFF_UNAVAILABLE';
      const diagnosticReason =
        totalSalonQualifiedCount === 0
          ? 'No active stylists in the salon are assigned or qualified to perform the selected service(s).'
          : 'The selected specialist is not available on this date.';

      return {
        date: dateStr,
        salonTimezone: timezone,
        serviceDurationMinutes: totalServiceDuration,
        availableSlots: [],
        status: diagnosticStatus,
        statusReason: diagnosticReason,
      };
    }


    // 4. Fetch existing active blocking appointments for eligible stylists on this date
    const apptWhere: any = {
      salonId,
      appointmentDate: new Date(dateStr),
      status: { in: ['CONFIRMED', 'CHECKED_IN', 'IN_SERVICE'] },
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

    // Advance notice check if booking for today: zero artificial buffer, only upcoming slots
    let earliestAllowedMinutes = 0;
    if (requestedDate.hasSame(todayInSalonZone, 'day')) {
      const nowMinuteOfDay = nowInSalonZone.hour * 60 + nowInSalonZone.minute;
      if (candidateStepMinutes !== undefined && candidateStepMinutes > 0) {
        const rem = nowMinuteOfDay % stepMinutes;
        earliestAllowedMinutes = rem === 0 ? nowMinuteOfDay : nowMinuteOfDay + (stepMinutes - rem);
      } else {
        earliestAllowedMinutes = nowMinuteOfDay;
      }
    }

    for (const stylist of eligibleStylists) {
      let effectiveOpen: number;
      let effectiveClose: number;
      const busyIntervals: { start: number; end: number }[] = [];

      if (stylist.followsSalonSchedule) {
        if (salonOpenMinutes === null || salonCloseMinutes === null) {
          continue; // Salon is closed today
        }
        effectiveOpen = salonOpenMinutes;
        effectiveClose = salonCloseMinutes;
        if (salonBreak) {
          busyIntervals.push(salonBreak);
        }
      } else {
        // Custom stylist schedule: independent of salon hours
        const customHours = stylist.workingHours[0];
        if (!customHours || !customHours.isWorking) {
          continue; // Stylist not working today
        }
        effectiveOpen = this.parseTimeStringToMinutes(customHours.startTime);
        effectiveClose = this.parseTimeStringToMinutes(customHours.endTime);
        if (customHours.breakStartTime && customHours.breakEndTime) {
          busyIntervals.push({
            start: this.parseTimeStringToMinutes(customHours.breakStartTime),
            end: this.parseTimeStringToMinutes(customHours.breakEndTime),
          });
        }
      }

      if (effectiveOpen >= effectiveClose) {
        continue;
      }

      // Add existing active appointments
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

      // Filter intervals that can accommodate the continuous total service duration
      const validFreeIntervals = freeIntervals.filter(
        (intv) => intv.end - intv.start >= totalServiceDuration,
      );

      // Generate candidate start times within continuous free intervals using the service-duration interval
      for (const interval of validFreeIntervals) {
        let candidateStart = interval.start;
        // If an explicit custom step was requested, align candidate start to that step
        if (candidateStepMinutes !== undefined && candidateStepMinutes > 0) {
          const remainder = candidateStart % stepMinutes;
          if (remainder !== 0) {
            candidateStart += stepMinutes - remainder;
          }
        }

        while (candidateStart + totalServiceDuration <= interval.end) {
          if (
            !requestedDate.hasSame(todayInSalonZone, 'day') ||
            candidateStart >= earliestAllowedMinutes
          ) {
            const timeKey = this.formatMinutesToTime(candidateStart);
            const endTimeKey = this.formatMinutesToTime(candidateStart + totalServiceDuration);

            if (!slotsMap.has(timeKey)) {
              slotsMap.set(timeKey, {
                startTime: timeKey,
                endTime: endTimeKey,
                eligibleStylistIds: new Set<string>(),
              });
            }
            slotsMap.get(timeKey)!.eligibleStylistIds.add(stylist.id);
          }
          candidateStart += stepMinutes;
        }
      }
    }

    // Build deterministic sorted stylist ID list reference for stable ordering
    const stylistIdOrderMap = new Map<string, number>();
    eligibleStylists.forEach((st, idx) => stylistIdOrderMap.set(st.id, idx));

    // 6. Format and sort final slots
    const availableSlots: AvailableSlotResponse[] = Array.from(slotsMap.values())
      .map((slot) => {
        const [h, m] = slot.startTime.split(':').map((v) => parseInt(v, 10));
        const [eh, em] = slot.endTime.split(':').map((v) => parseInt(v, 10));

        const isoStart = requestedDate.set({ hour: h, minute: m, second: 0, millisecond: 0 }).toUTC().toISO()!;
        const isoEnd = requestedDate.set({ hour: eh, minute: em, second: 0, millisecond: 0 }).toUTC().toISO()!;

        // Sort eligible stylists deterministically matching eligibleStylists order
        const sortedStaffIds = Array.from(slot.eligibleStylistIds).sort(
          (a, b) => (stylistIdOrderMap.get(a) ?? 0) - (stylistIdOrderMap.get(b) ?? 0),
        );

        return {
          startTime: slot.startTime,
          endTime: slot.endTime,
          isoStartTime: isoStart,
          isoEndTime: isoEnd,
          availableStaffCount: sortedStaffIds.length,
          eligibleStaffIds: sortedStaffIds,
        };
      })
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    let finalStatus: AvailabilityStatus = 'AVAILABLE';
    let finalReason = `${availableSlots.length} slot(s) available for booking.`;

    if (availableSlots.length === 0) {
      if (isSalonClosed && eligibleStylists.every((st) => st.followsSalonSchedule)) {
        finalStatus = 'SALON_CLOSED';
        finalReason = 'The salon is closed on this day.';
      } else {
        finalStatus = 'FULLY_BOOKED';
        finalReason = 'All appointment slots are fully booked or unavailable on this date.';
      }
    }

    return {
      date: dateStr,
      salonTimezone: timezone,
      serviceDurationMinutes: totalServiceDuration,
      availableSlots,
      status: finalStatus,
      statusReason: finalReason,
    };
  }
}
