/**
 * Single Source of Truth (SSOT) for Appointment Statuses across the Web App.
 * Strictly aligned with backend PostgreSQL AppointmentStatus enum.
 */
export const AppointmentStatus = Object.freeze({
  PENDING_ACCEPTANCE: 'PENDING_ACCEPTANCE',
  REJECTED: 'REJECTED',
  BOOKED: 'BOOKED',
  CONFIRMED: 'CONFIRMED',
  ON_THE_WAY: 'ON_THE_WAY',
  CHECKED_IN: 'CHECKED_IN',
  SEATED_IN_CHAIR: 'SEATED_IN_CHAIR',
  COMPLETED: 'COMPLETED',
  PENDING_RESCHEDULE: 'PENDING_RESCHEDULE',
  CANCELLED: 'CANCELLED',
});

/**
 * Domain State Predicates
 * Eliminates fragile inline string comparisons and guarantees uniform state evaluation.
 */
export const StatusPredicates = Object.freeze({
  isInChair: (status) => status === AppointmentStatus.SEATED_IN_CHAIR || status === 'IN_SERVICE',
  isCheckedIn: (status) => status === AppointmentStatus.CHECKED_IN,
  isActiveQueue: (status) => [
    AppointmentStatus.BOOKED,
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.ON_THE_WAY,
    AppointmentStatus.CHECKED_IN,
    AppointmentStatus.SEATED_IN_CHAIR,
  ].includes(status),
  isDone: (status) => status === AppointmentStatus.COMPLETED,
  isCancelled: (status) => status === AppointmentStatus.CANCELLED || status === AppointmentStatus.REJECTED,
});

if (typeof window !== 'undefined') {
  window.AppointmentStatus = AppointmentStatus;
  window.StatusPredicates = StatusPredicates;
}
