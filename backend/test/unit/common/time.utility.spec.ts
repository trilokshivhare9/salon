import { TimeUtility } from '../../../src/common/utils/time.utility';
import { DayOfWeek } from '@prisma/client';
import { DateTime } from 'luxon';

describe('TimeUtility Unit Tests', () => {
  const tz = 'Asia/Kolkata';

  describe('formatTime12h', () => {
    it('formats 24h string correctly', () => {
      expect(TimeUtility.formatTime12h('14:30')).toBe('02:30 PM');
      expect(TimeUtility.formatTime12h('09:05')).toBe('09:05 AM');
      expect(TimeUtility.formatTime12h('00:00')).toBe('12:00 AM');
      expect(TimeUtility.formatTime12h('12:00')).toBe('12:00 PM');
      expect(TimeUtility.formatTime12h('23:59')).toBe('11:59 PM');
    });

    it('formats minutes from midnight correctly', () => {
      expect(TimeUtility.formatTime12h(870)).toBe('02:30 PM');
      expect(TimeUtility.formatTime12h(545)).toBe('09:05 AM');
      expect(TimeUtility.formatTime12h(0)).toBe('12:00 AM');
      expect(TimeUtility.formatTime12h(720)).toBe('12:00 PM');
    });

    it('formats JavaScript Date correctly in timezone', () => {
      // 2026-09-29 10:00 UTC is 15:30 IST (+5:30)
      const date = new Date('2026-09-29T10:00:00.000Z');
      expect(TimeUtility.formatTime12h(date, tz)).toBe('03:30 PM');
    });

    it('handles empty or invalid inputs gracefully', () => {
      expect(TimeUtility.formatTime12h('')).toBe('');
      expect(TimeUtility.formatTime12h(null)).toBe('');
      expect(TimeUtility.formatTime12h(undefined)).toBe('');
      expect(TimeUtility.formatTime12h('02:30 PM')).toBe('02:30 PM');
    });
  });

  describe('formatTime24h', () => {
    it('formats 12h string to 24h', () => {
      expect(TimeUtility.formatTime24h('02:30 PM')).toBe('14:30');
      expect(TimeUtility.formatTime24h('2:30 PM')).toBe('14:30');
      expect(TimeUtility.formatTime24h('09:05 AM')).toBe('09:05');
      expect(TimeUtility.formatTime24h('12:00 AM')).toBe('00:00');
      expect(TimeUtility.formatTime24h('12:00 PM')).toBe('12:00');
    });

    it('formats JavaScript Date to 24h in timezone', () => {
      const date = new Date('2026-09-29T10:00:00.000Z'); // 15:30 IST
      expect(TimeUtility.formatTime24h(date, tz)).toBe('15:30');
    });
  });

  describe('minutes and time conversions', () => {
    it('parses time string to minutes', () => {
      expect(TimeUtility.parseTimeStringToMinutes('14:30')).toBe(870);
      expect(TimeUtility.parseTimeStringToMinutes('09:15')).toBe(555);
      expect(TimeUtility.parseTimeStringToMinutes('')).toBe(0);
    });

    it('formats minutes to 24h string', () => {
      expect(TimeUtility.formatMinutesToTime(870)).toBe('14:30');
      expect(TimeUtility.formatMinutesToTime(555)).toBe('09:15');
      expect(TimeUtility.formatMinutesToTime(0)).toBe('00:00');
    });
  });

  describe('dates and formatting', () => {
    it('formats Date to ISO date string', () => {
      const date = new Date('2026-09-29T10:00:00.000Z');
      expect(TimeUtility.formatDateToISO(date, tz)).toBe('2026-09-29');
    });

    it('formats friendly date', () => {
      const date = new Date('2026-09-29T10:00:00.000Z'); // Tue, 29 Sep 2026
      expect(TimeUtility.formatDateFriendly(date, tz, 'dd LLL, EEE')).toBe('29 Sep, Tue');
      expect(TimeUtility.formatDateFriendly(date, tz, 'dd LLL, EEEE')).toBe('29 Sep, Tuesday');
    });

    it('resolves DayOfWeek enum', () => {
      const date = new Date('2026-09-29T10:00:00.000Z'); // Tuesday
      expect(TimeUtility.getDayOfWeekEnum(date, tz)).toBe(DayOfWeek.TUESDAY);
    });

    it('constructs JSDate correctly', () => {
      const jsDate = TimeUtility.toJSDate('2026-09-29', '14:30', tz);
      expect(TimeUtility.formatTime24h(jsDate, tz)).toBe('14:30');
      expect(TimeUtility.formatDateToISO(jsDate, tz)).toBe('2026-09-29');
    });
  });
});
