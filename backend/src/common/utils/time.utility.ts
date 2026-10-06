import { DateTime } from 'luxon';
import { DayOfWeek } from '@prisma/client';

/**
 * Universal Salon Time & Date Utility
 * Single source of truth for all timezone-aware time and date formatting across the salon platform.
 */
export class TimeUtility {
  public static readonly DEFAULT_TIMEZONE = 'Asia/Kolkata';

  /**
   * Returns current Luxon DateTime in the given timezone (defaults to Asia/Kolkata).
   */
  public static now(timezone?: string): DateTime {
    return DateTime.now().setZone(timezone || this.DEFAULT_TIMEZONE);
  }

  /**
   * Formats a 24h "HH:mm" time string, Date, ISO string, or minute count into 12-hour "hh:mm AM/PM" format.
   * e.g. "14:30" -> "02:30 PM", "09:05" -> "09:05 AM"
   */
  public static formatTime12h(
    timeInput: string | Date | number | null | undefined,
    timezone?: string,
  ): string {
    if (timeInput === null || timeInput === undefined || timeInput === '') return '';

    if (typeof timeInput === 'number') {
      const hours = Math.floor(timeInput / 60);
      const mins = timeInput % 60;
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const hour12 = hours % 12 === 0 ? 12 : hours % 12;
      return `${hour12.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')} ${ampm}`;
    }

    if (timeInput instanceof Date) {
      return DateTime.fromJSDate(timeInput, { zone: timezone || this.DEFAULT_TIMEZONE }).toFormat('hh:mm a');
    }

    const str = String(timeInput).trim();
    // If it's an ISO timestamp string
    if (str.includes('T') || str.includes('Z')) {
      const dt = DateTime.fromISO(str, { zone: timezone || this.DEFAULT_TIMEZONE });
      if (dt.isValid) return dt.toFormat('hh:mm a');
    }

    // If it already has AM/PM
    if (/am|pm/i.test(str)) {
      return str;
    }

    // Normal "HH:mm" or "H:m"
    const [hStr, mStr] = str.split(':');
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr || '0', 10);
    if (isNaN(h) || isNaN(m)) return str;

    const ampm = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')} ${ampm}`;
  }

  /**
   * Formats a Date or time string into 24-hour "HH:mm" format in the given timezone.
   * e.g. Date -> "14:30", "02:30 PM" -> "14:30"
   */
  public static formatTime24h(
    timeInput: Date | string | null | undefined,
    timezone?: string,
  ): string {
    if (!timeInput) return '';

    if (timeInput instanceof Date) {
      return DateTime.fromJSDate(timeInput, { zone: timezone || this.DEFAULT_TIMEZONE }).toFormat('HH:mm');
    }

    const str = String(timeInput).trim();
    if (str.includes('T') || str.includes('Z')) {
      const dt = DateTime.fromISO(str, { zone: timezone || this.DEFAULT_TIMEZONE });
      if (dt.isValid) return dt.toFormat('HH:mm');
    }

    // If "hh:mm AM/PM":
    if (/am|pm/i.test(str)) {
      const match = str.match(/(\d+):(\d+)\s*(am|pm)/i);
      if (match) {
        let h = parseInt(match[1], 10);
        const m = parseInt(match[2], 10);
        const isPm = match[3].toLowerCase() === 'pm';
        if (isPm && h < 12) h += 12;
        if (!isPm && h === 12) h = 0;
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
      }
    }

    // Normal "HH:mm"
    const [hStr, mStr] = str.split(':');
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr || '0', 10);
    if (!isNaN(h) && !isNaN(m)) {
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    }

    return str;
  }

  /**
   * Parses "HH:mm" time string into total minutes from start of day.
   */
  public static parseTimeStringToMinutes(timeStr: string): number {
    if (!timeStr || typeof timeStr !== 'string') return 0;
    const [hours, mins] = timeStr.split(':').map((v) => parseInt(v, 10));
    return (hours || 0) * 60 + (mins || 0);
  }

  /**
   * Formats total minutes from midnight into 24-hour "HH:mm" string.
   */
  public static formatMinutesToTime(totalMinutes: number): string {
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
  }

  /**
   * Formats Date into ISO date "YYYY-MM-DD" in salon timezone.
   */
  public static formatDateToISO(date: Date | DateTime | string, timezone?: string): string {
    if (!date) return '';
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return date;
    }
    const zone = timezone || this.DEFAULT_TIMEZONE;
    if (date instanceof Date) {
      return DateTime.fromJSDate(date, { zone }).toISODate()!;
    }
    if (date instanceof DateTime) {
      return date.setZone(zone).toISODate()!;
    }
    return DateTime.fromISO(String(date), { zone }).toISODate()!;
  }

  /**
   * Formats Date into user-friendly date format, e.g. "29 Sep, Tue" or "29 Sep, Tuesday".
   */
  public static formatDateFriendly(
    date: Date | DateTime | string,
    timezone?: string,
    formatStr: string = 'dd LLL, EEE',
  ): string {
    if (!date) return '';
    const zone = timezone || this.DEFAULT_TIMEZONE;
    let dt: DateTime;
    if (date instanceof Date) {
      dt = DateTime.fromJSDate(date, { zone });
    } else if (date instanceof DateTime) {
      dt = date.setZone(zone);
    } else {
      dt = DateTime.fromISO(String(date), { zone });
    }
    return dt.isValid ? dt.toFormat(formatStr) : String(date);
  }

  /**
   * Formats date with relative label: "Today (29 Sep)", "Tomorrow (30 Sep)", or "Tue, 29 Sep".
   */
  public static formatDateLabel(
    targetDate: Date | DateTime | string,
    timezone?: string,
  ): string {
    const zone = timezone || this.DEFAULT_TIMEZONE;
    const now = DateTime.now().setZone(zone);
    const todayStr = now.startOf('day').toISODate()!;
    const tomorrowStr = now.startOf('day').plus({ days: 1 }).toISODate()!;

    let dt: DateTime;
    if (targetDate instanceof Date) {
      dt = DateTime.fromJSDate(targetDate, { zone });
    } else if (targetDate instanceof DateTime) {
      dt = targetDate.setZone(zone);
    } else {
      dt = DateTime.fromISO(String(targetDate), { zone });
    }

    const dateStr = dt.toISODate()!;
    if (dateStr === todayStr) {
      return `Today (${dt.toFormat('dd LLL')})`;
    }
    if (dateStr === tomorrowStr) {
      return `Tomorrow (${dt.toFormat('dd LLL')})`;
    }
    return dt.toFormat('EEE, dd LLL');
  }

  /**
   * Combines date string ("YYYY-MM-DD") and time string ("HH:mm") into a UTC JavaScript Date object in the salon timezone.
   */
  public static toJSDate(
    dateStr: string | Date,
    timeStr?: string,
    timezone?: string,
  ): Date {
    const zone = timezone || this.DEFAULT_TIMEZONE;
    const baseDateStr = typeof dateStr === 'string' ? dateStr : DateTime.fromJSDate(dateStr, { zone }).toISODate()!;
    const cleanTime = timeStr || '00:00';
    const [h, m] = cleanTime.split(':').map((v) => parseInt(v, 10));

    return DateTime.fromISO(baseDateStr, { zone })
      .set({ hour: h || 0, minute: m || 0, second: 0, millisecond: 0 })
      .toJSDate();
  }

  /**
   * Resolves evaluation DateTime and start/end Date boundaries for any target date in salon timezone.
   * If targetDate is undefined, uses current salon time and today's full boundaries.
   */
  public static getDayBoundaries(
    targetDate?: string | Date | DateTime,
    timezone?: string,
  ): { evalDt: DateTime; startOfDay: Date; endOfDay: Date } {
    const zone = timezone || this.DEFAULT_TIMEZONE;
    const now = this.now(zone);

    let evalDt: DateTime;
    if (!targetDate) {
      evalDt = now;
    } else if (typeof targetDate === 'string') {
      const parsed = DateTime.fromISO(targetDate, { zone });
      if (targetDate.includes('T')) {
        evalDt = parsed;
      } else {
        evalDt = parsed.set({
          hour: now.hour,
          minute: now.minute,
        });
      }
    } else if (targetDate instanceof Date) {
      evalDt = DateTime.fromJSDate(targetDate, { zone });
    } else {
      evalDt = targetDate.setZone(zone);
    }

    return {
      evalDt,
      startOfDay: evalDt.startOf('day').toJSDate(),
      endOfDay: evalDt.endOf('day').toJSDate(),
    };
  }

  /**
   * Resolves the DayOfWeek enum ("MONDAY", "TUESDAY", etc.) for a given date in the salon timezone.
   */
  public static getDayOfWeekEnum(
    date: Date | DateTime | string,
    timezone?: string,
  ): DayOfWeek {
    const zone = timezone || this.DEFAULT_TIMEZONE;
    let dt: DateTime;
    if (date instanceof Date) {
      dt = DateTime.fromJSDate(date, { zone });
    } else if (date instanceof DateTime) {
      dt = date.setZone(zone);
    } else {
      dt = DateTime.fromISO(String(date), { zone });
    }
    return dt.toFormat('cccc').toUpperCase() as DayOfWeek;
  }

  /**
   * Converts any date input ("YYYY-MM-DD", Date, or DateTime) into a pure UTC midnight Date object.
   * Format: YYYY-MM-DDT00:00:00.000Z.
   * This is mathematically immune to timezone shifts when stored into PostgreSQL @db.Date columns.
   */
  public static toDbDate(dateInput: string | Date | DateTime | null | undefined): Date {
    if (!dateInput) {
      const todayIso = this.getTodayDate();
      return new Date(`${todayIso}T00:00:00.000Z`);
    }
    const isoStr = this.toDateString(dateInput);
    return new Date(`${isoStr}T00:00:00.000Z`);
  }

  /**
   * Extracts clean "YYYY-MM-DD" calendar date string without timezone drift.
   */
  public static toDateString(
    dateInput: string | Date | DateTime | null | undefined,
    timezone?: string,
  ): string {
    if (!dateInput) return '';
    if (typeof dateInput === 'string') {
      const clean = dateInput.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
      if (clean.includes('T')) return clean.split('T')[0];
      const parsed = DateTime.fromISO(clean, { zone: timezone || this.DEFAULT_TIMEZONE });
      if (parsed.isValid) return parsed.toISODate()!;
      return clean.slice(0, 10);
    }
    if (dateInput instanceof Date) {
      // If date was created as UTC midnight (e.g. from @db.Date), toISOString() yields the pure calendar date
      return dateInput.toISOString().split('T')[0];
    }
    if (dateInput instanceof DateTime) {
      return dateInput.toISODate()!;
    }
    return '';
  }

  /**
   * Returns today's calendar date string ("YYYY-MM-DD") evaluated in the specified timezone (defaults to Asia/Kolkata).
   */
  public static getTodayDate(timezone?: string): string {
    return DateTime.now().setZone(timezone || this.DEFAULT_TIMEZONE).toISODate()!;
  }

  /**
   * Combines date ("YYYY-MM-DD") and 24h time ("HH:mm") into a full JavaScript Date (TIMESTAMPTZ) in the given timezone.
   */
  public static toTimestamp(
    dateStr: string | Date,
    timeStr: string,
    timezone?: string,
  ): Date {
    const zone = timezone || this.DEFAULT_TIMEZONE;
    const baseDateStr = this.toDateString(dateStr, zone);
    const cleanTime = timeStr || '00:00';
    const [h, m] = cleanTime.split(':').map((v) => parseInt(v, 10));

    return DateTime.fromISO(baseDateStr, { zone })
      .set({ hour: h || 0, minute: m || 0, second: 0, millisecond: 0 })
      .toJSDate();
  }

  /**
   * Formats any Date or timestamp into a customized pattern in the specified timezone.
   */
  public static formatDateTimeInTz(
    dateInput: Date | DateTime | string,
    formatStr: string,
    timezone?: string,
  ): string {
    const zone = timezone || this.DEFAULT_TIMEZONE;
    let dt: DateTime;
    if (dateInput instanceof Date) {
      dt = DateTime.fromJSDate(dateInput, { zone });
    } else if (dateInput instanceof DateTime) {
      dt = dateInput.setZone(zone);
    } else {
      dt = DateTime.fromISO(String(dateInput), { zone });
    }
    return dt.isValid ? dt.toFormat(formatStr) : '';
  }

  /**
   * Checks whether a given date is today in the salon's timezone.
   */
  public static isToday(dateStr: string | Date | DateTime, timezone?: string): boolean {
    const zone = timezone || this.DEFAULT_TIMEZONE;
    return this.toDateString(dateStr, zone) === this.getTodayDate(zone);
  }

  /**
   * Checks whether a date is strictly before today in the salon's timezone.
   */
  public static isPastDate(dateStr: string | Date | DateTime, timezone?: string): boolean {
    const zone = timezone || this.DEFAULT_TIMEZONE;
    return this.toDateString(dateStr, zone) < this.getTodayDate(zone);
  }

  /**
   * Checks whether a 24h time string has already passed by clock today in the salon's timezone.
   */
  public static isPastTimeToday(timeStr: string, timezone?: string): boolean {
    const zone = timezone || this.DEFAULT_TIMEZONE;
    const now = DateTime.now().setZone(zone);
    const nowMinutes = now.hour * 60 + now.minute;
    const [h, m] = timeStr.split(':').map((v) => parseInt(v, 10));
    return (h * 60 + m) <= nowMinutes;
  }
}
