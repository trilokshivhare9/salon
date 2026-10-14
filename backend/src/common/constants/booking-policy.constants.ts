/**
 * Universal Salon Booking Policy & Horizon Constants
 * Single source of truth for booking and reschedule horizons across all channels
 * (WhatsApp Bot, Web Customer Portal, Admin Conflict Engine, Availability Engine).
 */
export const BOOKING_POLICY = {
  /**
   * Maximum calendar days in advance a client or admin can book/reschedule an appointment.
   * Default: 3 calendar days (e.g. Today, Tomorrow, Day After Tomorrow).
   */
  MAX_ADVANCE_BOOKING_DAYS: 3,

  /**
   * Minimum hours in advance required when proposing an admin reschedule.
   * Gives client sufficient time to review, respond, and travel.
   */
  MIN_RESCHEDULE_LEAD_HOURS: 2,

  /**
   * Cutoff notice in minutes before appointment for client self-reschedule.
   */
  CLIENT_RESCHEDULE_CUTOFF_MINS: 90,
} as const;
