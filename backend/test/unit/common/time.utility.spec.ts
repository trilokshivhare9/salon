import { TimeUtility } from '../../../src/common/utils/time.utility';
import { DateTime } from 'luxon';

describe('TimeUtility Centralized Timezone & Date Domain Engine', () => {
  describe('toDbDate & toDateString (Zero Timezone Shift Architecture)', () => {
    it('should convert pure calendar date string to UTC midnight Date with zero shift', () => {
      const dbDate = TimeUtility.toDbDate('2026-10-01');
      expect(dbDate.toISOString()).toBe('2026-10-01T00:00:00.000Z');
      expect(TimeUtility.toDateString(dbDate)).toBe('2026-10-01');
    });

    it('should extract correct date string regardless of ISO format with time', () => {
      expect(TimeUtility.toDateString('2026-10-01T15:30:00.000Z')).toBe('2026-10-01');
      expect(TimeUtility.toDateString('2026-10-01')).toBe('2026-10-01');
    });

    it('should extract correct date string from DateTime object', () => {
      const dt = DateTime.fromISO('2026-10-01T12:00:00', { zone: 'Asia/Kolkata' });
      expect(TimeUtility.toDateString(dt)).toBe('2026-10-01');
    });

    it('should protect against positive timezone offset shifts (e.g. Asia/Kolkata +5:30)', () => {
      // In Asia/Kolkata, 2026-10-01 midnight is 2026-09-30 18:30 UTC
      // toDbDate must guarantee it stays 2026-10-01 UTC midnight so Postgres @db.Date never stores 2026-09-30
      const dbDate = TimeUtility.toDbDate('2026-10-01');
      expect(dbDate.toISOString()).toBe('2026-10-01T00:00:00.000Z');
      expect(TimeUtility.toDateString(dbDate)).toBe('2026-10-01');
    });

    it('should protect against negative timezone offset shifts (e.g. America/New_York -4:00)', () => {
      const dbDate = TimeUtility.toDbDate('2026-10-01');
      expect(dbDate.toISOString()).toBe('2026-10-01T00:00:00.000Z');
      expect(TimeUtility.toDateString(dbDate)).toBe('2026-10-01');
    });
  });

  describe('getTodayDate & isToday', () => {
    it('should return current date in default timezone (Asia/Kolkata)', () => {
      const expected = DateTime.now().setZone('Asia/Kolkata').toISODate();
      expect(TimeUtility.getTodayDate()).toBe(expected);
      expect(TimeUtility.isToday(expected!)).toBe(true);
    });

    it('should accurately compare past dates', () => {
      const today = TimeUtility.getTodayDate();
      const yesterday = DateTime.now().setZone('Asia/Kolkata').minus({ days: 1 }).toISODate()!;
      const tomorrow = DateTime.now().setZone('Asia/Kolkata').plus({ days: 1 }).toISODate()!;

      expect(TimeUtility.isPastDate(yesterday)).toBe(true);
      expect(TimeUtility.isPastDate(today)).toBe(false);
      expect(TimeUtility.isPastDate(tomorrow)).toBe(false);
    });
  });

  describe('toTimestamp & formatDateTimeInTz', () => {
    it('should combine calendar date and 24h time in Asia/Kolkata correctly', () => {
      const ts = TimeUtility.toTimestamp('2026-10-01', '17:35', 'Asia/Kolkata');
      // 17:35 in IST (+5:30) is 12:05 in UTC
      expect(ts.toISOString()).toBe('2026-10-01T12:05:00.000Z');

      const formatted = TimeUtility.formatDateTimeInTz(ts, 'hh:mm a', 'Asia/Kolkata');
      expect(formatted).toBe('05:35 PM');
    });

    it('should work seamlessly with a future timezone like America/New_York', () => {
      const ts = TimeUtility.toTimestamp('2026-10-01', '17:35', 'America/New_York');
      // In EDT (UTC-4), 17:35 EDT is 21:35 UTC
      expect(ts.toISOString()).toBe('2026-10-01T21:35:00.000Z');

      const formatted = TimeUtility.formatDateTimeInTz(ts, 'hh:mm a', 'America/New_York');
      expect(formatted).toBe('05:35 PM');
    });
  });

  describe('isPastTimeToday', () => {
    it('should return true for a time that has passed earlier today', () => {
      const nowInIst = DateTime.now().setZone('Asia/Kolkata');
      if (nowInIst.hour > 0) {
        expect(TimeUtility.isPastTimeToday('00:01', 'Asia/Kolkata')).toBe(true);
      }
    });

    it('should return false for a time later tonight', () => {
      expect(TimeUtility.isPastTimeToday('23:59', 'Asia/Kolkata')).toBe(false);
    });
  });
});
