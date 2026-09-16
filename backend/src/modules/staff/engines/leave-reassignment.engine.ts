import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { DateTime } from 'luxon';
import {
  AbsenceStatus,
  ReassignmentOutcome,
  DayOfWeek,
  AppointmentStatus,
  StylistStatus,
} from '@prisma/client';

export interface ReassignmentResult {
  reassignedCount: number;
  unresolvableCount: number;
  totalAffectedBookings: number;
  reassignmentsToNotify: string[];
  summaryDetails: any[];
}

@Injectable()
export class LeaveReassignmentEngine {
  private hashToSignedInt32(input: string): number {
    return crypto.createHash('sha256').update(input).digest().readInt32BE(0);
  }

  private parseTimeStringToMinutes(timeStr: string): number {
    const [hours, mins] = timeStr.split(':').map((v) => parseInt(v, 10));
    return hours * 60 + mins;
  }

  private getDayOfWeekEnum(luxonDateTime: DateTime): DayOfWeek {
    const dayNumber = luxonDateTime.weekday;
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

  /**
   * Evaluates candidate replacement stylists for a specific appointment time window.
   */
  async findReplacementStylistCandidate(
    tx: any,
    salonId: string,
    absenceDate: Date,
    serviceIds: string[],
    startAt: Date,
    endAt: Date,
    excludeStylistId: string,
    timezone: string,
  ): Promise<string | null> {
    const luxonStart = DateTime.fromJSDate(startAt).setZone(timezone);
    const luxonEnd = DateTime.fromJSDate(endAt).setZone(timezone);
    const dayOfWeek = this.getDayOfWeekEnum(luxonStart);

    const apptStartMinutes = luxonStart.hour * 60 + luxonStart.minute;
    const apptEndMinutes = luxonEnd.hour * 60 + luxonEnd.minute;

    const salonWorkingHours = await tx.salonWorkingHours.findFirst({
      where: { salonId, dayOfWeek },
    });

    const candidates = await tx.stylist.findMany({
      where: {
        salonId,
        id: { not: excludeStylistId },
        status: StylistStatus.ACTIVE,
        AND: serviceIds.map((sId: string) => ({
          services: { some: { serviceId: sId } },
        })),
        absences: {
          none: {
            status: AbsenceStatus.ACTIVE,
            OR: [
              { startDate: { lte: absenceDate }, endDate: { gte: absenceDate } },
              { absenceDate },
            ],
          },
        },
      },
      include: {
        workingHours: {
          where: { dayOfWeek },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    for (const candidate of candidates) {
      if (candidate.followsSalonSchedule) {
        if (!salonWorkingHours || salonWorkingHours.isClosed) {
          continue;
        }
        const salonOpen = this.parseTimeStringToMinutes(salonWorkingHours.startTime);
        const salonClose = this.parseTimeStringToMinutes(salonWorkingHours.endTime);
        if (apptStartMinutes < salonOpen || apptEndMinutes > salonClose) {
          continue;
        }
        if (salonWorkingHours.breakStartTime && salonWorkingHours.breakEndTime) {
          const bStart = this.parseTimeStringToMinutes(salonWorkingHours.breakStartTime);
          const bEnd = this.parseTimeStringToMinutes(salonWorkingHours.breakEndTime);
          if (apptStartMinutes < bEnd && apptEndMinutes > bStart) {
            continue;
          }
        }
      } else {
        const staffHours = candidate.workingHours[0];
        if (!staffHours || !staffHours.isWorking) {
          continue;
        }
        const staffOpen = this.parseTimeStringToMinutes(staffHours.startTime);
        const staffClose = this.parseTimeStringToMinutes(staffHours.endTime);
        if (apptStartMinutes < staffOpen || apptEndMinutes > staffClose) {
          continue;
        }
        if (staffHours.breakStartTime && staffHours.breakEndTime) {
          const bStart = this.parseTimeStringToMinutes(staffHours.breakStartTime);
          const bEnd = this.parseTimeStringToMinutes(staffHours.breakEndTime);
          if (apptStartMinutes < bEnd && apptEndMinutes > bStart) {
            continue;
          }
        }
      }

      const key1 = this.hashToSignedInt32(`salon:${salonId}`);
      const dateIso = DateTime.fromJSDate(absenceDate, { zone: 'UTC' }).toISODate()!;
      const candLockKey = this.hashToSignedInt32(`stylist:${candidate.id}:${dateIso}`);
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock($1::integer, $2::integer)',
        key1,
        candLockKey,
      );

      const conflictAppt = await tx.appointment.findFirst({
        where: {
          salonId,
          stylistId: candidate.id,
          status: {
            in: [
              AppointmentStatus.CONFIRMED,
              AppointmentStatus.CHECKED_IN,
              AppointmentStatus.IN_SERVICE,
            ],
          },
          startAt: { lt: endAt },
          endAt: { gt: startAt },
        },
      });

      if (!conflictAppt) {
        return candidate.id;
      }
    }

    return null;
  }
}
