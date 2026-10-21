import { Injectable } from '@nestjs/common';
import { DayOfWeek } from '@prisma/client';
import { AvailabilityEngineService } from '../../../availability/availability-engine.service';

export interface LeaveInterval {
  start: number; // Minutes from 00:00
  end: number;   // Minutes from 00:00
}

export interface DayScheduleDetails {
  openMin: number;
  closeMin: number;
  breakInterval: { start: number; end: number } | null;
  isOff: boolean;
}

@Injectable()
export class LeaveIntervalEngine {
  constructor(private readonly availabilityEngine: AvailabilityEngineService) {}

  /**
   * Helper to parse time string "HH:mm" to total minutes from midnight.
   */
  parseTimeStringToMinutes(timeStr: string): number {
    const [hours, mins] = timeStr.split(':').map((v) => parseInt(v, 10));
    return hours * 60 + mins;
  }

  /**
   * Resolves working hours & break interval for a stylist on a calendar date.
   */
  async resolveDaySchedule(
    tx: any,
    salonId: string,
    stylistId: string,
    followsSalonSchedule: boolean,
    dayOfWeek: DayOfWeek,
  ): Promise<DayScheduleDetails> {
    const [salonWH, stylistWH] = await Promise.all([
      tx.salonWorkingHours.findFirst({ where: { salonId, dayOfWeek } }),
      tx.stylistWorkingHours.findFirst({ where: { stylistId, dayOfWeek } }),
    ]);

    const stylist = { followsSalonSchedule };
    const shiftWindow = this.availabilityEngine.getEffectiveShiftWindow(salonWH, stylist, stylistWH);

    if (
      !shiftWindow.isWorking ||
      shiftWindow.effectiveOpenMinutes === null ||
      shiftWindow.effectiveCloseMinutes === null
    ) {
      return { openMin: 0, closeMin: 0, breakInterval: null, isOff: true };
    }

    const firstBreak = shiftWindow.effectiveBreaks.length > 0 ? shiftWindow.effectiveBreaks[0] : null;

    return {
      openMin: shiftWindow.effectiveOpenMinutes,
      closeMin: shiftWindow.effectiveCloseMinutes,
      breakInterval: firstBreak,
      isOff: false,
    };
  }

  /**
   * Computes the blocked time interval [L_start, L_end] in minutes for a specific date.
   * Full day: [openMin, closeMin]
   * Partial day: Clamped [startTime, endTime] within schedule bounds
   */
  getLeaveBlockedMinutes(
    isPartialDay: boolean | undefined,
    startTime: string | undefined | null,
    endTime: string | undefined | null,
    schedule: DayScheduleDetails,
  ): LeaveInterval | null {
    if (schedule.isOff || schedule.openMin >= schedule.closeMin) {
      return null;
    }

    const { openMin, closeMin } = schedule;

    if (isPartialDay && startTime && endTime) {
      const customStart = this.parseTimeStringToMinutes(startTime);
      const customEnd = this.parseTimeStringToMinutes(endTime);
      const clampedStart = Math.max(openMin, customStart);
      const clampedEnd = Math.min(closeMin, customEnd);
      if (clampedStart < clampedEnd) {
        return { start: clampedStart, end: clampedEnd };
      }
    }

    return { start: openMin, end: closeMin };
  }

  /**
   * Checks whether an appointment interval [apptStartMin, apptEndMin] overlaps with a leave interval.
   */
  isAppointmentOverlappingLeave(
    apptStartMin: number,
    apptEndMin: number,
    leaveInterval: LeaveInterval,
  ): boolean {
    return Math.max(apptStartMin, leaveInterval.start) < Math.min(apptEndMin, leaveInterval.end);
  }
}
