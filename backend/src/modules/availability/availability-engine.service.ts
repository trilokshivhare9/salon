import { Injectable } from '@nestjs/common';
import { DayOfWeek } from '@prisma/client';

export interface BreakInterval {
  id?: string;
  startTime: string; // "HH:mm"
  endTime: string;   // "HH:mm"
  title?: string;
}

export interface MinuteInterval {
  start: number; // minutes from 00:00
  end: number;   // minutes from 00:00
}

export interface EffectiveShiftWindow {
  isWorking: boolean;
  salonOpenMinutes: number | null;
  salonCloseMinutes: number | null;
  effectiveOpenMinutes: number | null;
  effectiveCloseMinutes: number | null;
  effectiveBreaks: MinuteInterval[];
  statusReason?: string;
}

@Injectable()
export class AvailabilityEngineService {
  /**
   * Parse "HH:mm" time string into total minutes from start of day.
   */
  parseTimeStringToMinutes(timeStr: string): number {
    if (!timeStr || typeof timeStr !== 'string') return 0;
    const [hours, mins] = timeStr.split(':').map((v) => parseInt(v, 10));
    return (hours || 0) * 60 + (mins || 0);
  }

  /**
   * Format total minutes into "HH:mm" string.
   */
  formatMinutesToTime(totalMinutes: number): string {
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  }

  /**
   * Merge overlapping or adjacent minute intervals deterministically.
   * e.g. [{start:780, end:840}, {start:810, end:870}] => [{start:780, end:870}]
   */
  mergeIntervals(intervals: MinuteInterval[]): MinuteInterval[] {
    if (intervals.length === 0) return [];
    const sorted = [...intervals].sort((a, b) => a.start - b.start);
    const merged: MinuteInterval[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const last = merged[merged.length - 1];
      const current = sorted[i];

      if (current.start <= last.end) {
        last.end = Math.max(last.end, current.end);
      } else {
        merged.push(current);
      }
    }
    return merged;
  }

  /**
   * Extract break intervals from a Json field or legacy breakStartTime/breakEndTime.
   */
  extractBreaks(breaksJson: any, legacyStart?: string | null, legacyEnd?: string | null): MinuteInterval[] {
    const rawBreaks: { startTime: string; endTime: string }[] = [];

    if (Array.isArray(breaksJson) && breaksJson.length > 0) {
      for (const b of breaksJson) {
        if (b && typeof b.startTime === 'string' && typeof b.endTime === 'string') {
          rawBreaks.push({ startTime: b.startTime, endTime: b.endTime });
        }
      }
    } else if (legacyStart && legacyEnd) {
      rawBreaks.push({ startTime: legacyStart, endTime: legacyEnd });
    }

    const minuteIntervals: MinuteInterval[] = [];
    for (const b of rawBreaks) {
      const start = this.parseTimeStringToMinutes(b.startTime);
      const end = this.parseTimeStringToMinutes(b.endTime);
      if (start < end) {
        minuteIntervals.push({ start, end });
      }
    }

    return this.mergeIntervals(minuteIntervals);
  }

  /**
   * Calculate effective shift window and breaks for a stylist on a given day.
   * ENFORCES: Salon Operating Schedule is the HARD outer boundary.
   * ENFORCES: Salon breaks are DEFAULT unless Stylist Break Override is active.
   */
  getEffectiveShiftWindow(
    salonWorkingHours: any,
    stylist: any,
    stylistWorkingHours?: any,
  ): EffectiveShiftWindow {
    // 1. Salon Closed check -> Hard boundary
    if (!salonWorkingHours || salonWorkingHours.isClosed) {
      return {
        isWorking: false,
        salonOpenMinutes: null,
        salonCloseMinutes: null,
        effectiveOpenMinutes: null,
        effectiveCloseMinutes: null,
        effectiveBreaks: [],
        statusReason: 'Salon is closed on this day.',
      };
    }

    const salonOpen = this.parseTimeStringToMinutes(salonWorkingHours.startTime);
    const salonClose = this.parseTimeStringToMinutes(salonWorkingHours.endTime);

    if (salonOpen >= salonClose) {
      return {
        isWorking: false,
        salonOpenMinutes: salonOpen,
        salonCloseMinutes: salonClose,
        effectiveOpenMinutes: null,
        effectiveCloseMinutes: null,
        effectiveBreaks: [],
        statusReason: 'Salon operating hours are invalid.',
      };
    }

    const salonBreaks = this.extractBreaks(
      salonWorkingHours.breaks,
      salonWorkingHours.breakStartTime,
      salonWorkingHours.breakEndTime,
    );

    const followsSalon = stylist?.followsSalonSchedule ?? true;

    if (followsSalon) {
      return {
        isWorking: true,
        salonOpenMinutes: salonOpen,
        salonCloseMinutes: salonClose,
        effectiveOpenMinutes: salonOpen,
        effectiveCloseMinutes: salonClose,
        effectiveBreaks: salonBreaks,
      };
    }

    // Custom stylist schedule
    if (!stylistWorkingHours || !stylistWorkingHours.isWorking) {
      return {
        isWorking: false,
        salonOpenMinutes: salonOpen,
        salonCloseMinutes: salonClose,
        effectiveOpenMinutes: null,
        effectiveCloseMinutes: null,
        effectiveBreaks: [],
        statusReason: 'Stylist is not scheduled to work on this day.',
      };
    }

    const customOpen = this.parseTimeStringToMinutes(stylistWorkingHours.startTime);
    const customClose = this.parseTimeStringToMinutes(stylistWorkingHours.endTime);

    // Hard boundary clamping: Stylist shift MUST be contained within salon window
    const effectiveOpen = Math.max(customOpen, salonOpen);
    const effectiveClose = Math.min(customClose, salonClose);

    if (effectiveOpen >= effectiveClose) {
      return {
        isWorking: false,
        salonOpenMinutes: salonOpen,
        salonCloseMinutes: salonClose,
        effectiveOpenMinutes: null,
        effectiveCloseMinutes: null,
        effectiveBreaks: [],
        statusReason: 'Stylist working hours fall completely outside salon operating window.',
      };
    }

    // Break Inheritance & Override Rule:
    // If hasBreakOverride === true, use stylist custom breaks.
    // If hasBreakOverride === false, INHERIT SALON BREAKS.
    let unmergedBreaks: MinuteInterval[] = [];
    const hasOverride = stylistWorkingHours.hasBreakOverride === true;

    if (hasOverride) {
      unmergedBreaks = this.extractBreaks(
        stylistWorkingHours.breaks,
        stylistWorkingHours.breakStartTime,
        stylistWorkingHours.breakEndTime,
      );
    } else {
      unmergedBreaks = salonBreaks;
    }

    // Clamp breaks to effective shift window
    const clampedBreaks: MinuteInterval[] = [];
    for (const b of unmergedBreaks) {
      const cStart = Math.max(effectiveOpen, b.start);
      const cEnd = Math.min(effectiveClose, b.end);
      if (cStart < cEnd) {
        clampedBreaks.push({ start: cStart, end: cEnd });
      }
    }

    return {
      isWorking: true,
      salonOpenMinutes: salonOpen,
      salonCloseMinutes: salonClose,
      effectiveOpenMinutes: effectiveOpen,
      effectiveCloseMinutes: effectiveClose,
      effectiveBreaks: this.mergeIntervals(clampedBreaks),
    };
  }

  /**
   * Calculate blocked minute intervals for an active leave/absence record relative to the effective shift.
   */
  getLeaveBlockedIntervals(
    absence: any,
    effectiveOpen: number,
    effectiveClose: number,
    effectiveBreaks: MinuteInterval[],
  ): MinuteInterval[] {
    if (!absence.leavePortion || absence.leavePortion === 'FULL_DAY') {
      return [{ start: effectiveOpen, end: effectiveClose }];
    }

    const midPoint = Math.floor(effectiveOpen + (effectiveClose - effectiveOpen) / 2);
    const firstBreak = effectiveBreaks.length > 0 ? effectiveBreaks[0] : null;

    const firstHalfEnd = firstBreak ? firstBreak.start : midPoint;
    const secondHalfStart = firstBreak ? firstBreak.end : midPoint;

    if (absence.leavePortion === 'FIRST_HALF') {
      return [{ start: effectiveOpen, end: firstHalfEnd }];
    }
    if (absence.leavePortion === 'SECOND_HALF') {
      return [{ start: secondHalfStart, end: effectiveClose }];
    }
    if (absence.leavePortion === 'CUSTOM_HOURS' && absence.customStartTime && absence.customEndTime) {
      const customStart = this.parseTimeStringToMinutes(absence.customStartTime);
      const customEnd = this.parseTimeStringToMinutes(absence.customEndTime);
      const clampedStart = Math.max(effectiveOpen, customStart);
      const clampedEnd = Math.min(effectiveClose, customEnd);
      if (clampedStart < clampedEnd) {
        return [{ start: clampedStart, end: clampedEnd }];
      }
    }

    return [{ start: effectiveOpen, end: effectiveClose }];
  }

  /**
   * Subtract busy intervals (Breaks + Absences + Appointments) from effective shift window.
   */
  calculateFreeIntervals(
    effectiveOpen: number,
    effectiveClose: number,
    busyIntervals: MinuteInterval[],
  ): MinuteInterval[] {
    if (effectiveOpen >= effectiveClose) return [];

    let freeIntervals: MinuteInterval[] = [{ start: effectiveOpen, end: effectiveClose }];

    for (const busy of busyIntervals) {
      const nextFree: MinuteInterval[] = [];
      for (const free of freeIntervals) {
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

    return freeIntervals.filter((intv) => intv.end > intv.start);
  }
}
