import { CalendarView } from '../calendar/calendar-view.js';

/**
 * SalonDayOffView
 * Dedicated modular view for Salon Admin > Holidays & Days Off.
 * Wraps the unified CalendarView engine in SALON mode.
 */
export class SalonDayOffView {
  static async mount(container, app) {
    if (!container) return null;
    const calendar = new CalendarView({
      app,
      calendarFor: 'SALON',
    });
    if (app) app.currentCalendarView = calendar;
    await calendar.mount(container);
    return calendar;
  }
}
