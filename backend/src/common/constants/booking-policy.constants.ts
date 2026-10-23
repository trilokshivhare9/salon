/**
 * Universal Salon Booking Policy & Horizon Constants
 * Single source of truth for booking horizons, reminder lead times, and cutoff windows.
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

/**
 * Appointment Lifecycle Action Types
 * Single source of truth for all scheduled lifecycle event types
 * stored in PostgreSQL (next_action_type) and Redis (reminders:schedule).
 */
export enum AppointmentActionType {
  REMINDER_2H = 'REMINDER_2H',
  CUTOFF_60M = 'CUTOFF_60M',
  CUTOFF_5M = 'CUTOFF_5M',
  ARRIVAL_15M = 'ARRIVAL_15M',
  CUTOFF_10M = 'CUTOFF_10M',
  AUTO_COMPLETE = 'AUTO_COMPLETE',
  NONE = 'NONE',
}

/**
 * Clean timing configuration in pure minutes mapped directly to each Action Type.
 * Edit here to update reminder intervals or cutoff windows across the entire system.
 */
export const APPOINTMENT_ACTION_TIMING_MINS: Record<AppointmentActionType, number | null> = {
  [AppointmentActionType.REMINDER_2H]: 120, // 2 hours before startAt
  [AppointmentActionType.CUTOFF_60M]: 60,   // 60 minutes before startAt
  [AppointmentActionType.CUTOFF_5M]: 5,     // 5 minutes operator approval cutoff
  [AppointmentActionType.ARRIVAL_15M]: 15,  // 15 minutes before startAt
  [AppointmentActionType.CUTOFF_10M]: 10,   // 10 minutes response cutoff after arrival reminder
  [AppointmentActionType.AUTO_COMPLETE]: 0, // When appointment duration ends (at endAt)
  [AppointmentActionType.NONE]: null,       // Terminal (completed / cancelled) -> zero action
};

/**
 * Helper: Converts configured action lead minutes into milliseconds.
 */
export const getActionLeadMs = (action: AppointmentActionType): number => {
  const mins = APPOINTMENT_ACTION_TIMING_MINS[action];
  return mins !== null ? mins * 60 * 1000 : 0;
};
