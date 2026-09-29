import * as crypto from 'crypto';
import { AppointmentStatus } from '@prisma/client';

export const VALID_STATUS_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  [AppointmentStatus.BOOKED]: [
    AppointmentStatus.BOOKED,
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.CANCELLED,
    AppointmentStatus.PENDING_RESCHEDULE,
  ],
  [AppointmentStatus.CONFIRMED]: [
    AppointmentStatus.BOOKED,
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.ON_THE_WAY,
    AppointmentStatus.CHECKED_IN,
    AppointmentStatus.SEATED_IN_CHAIR,
    AppointmentStatus.CANCELLED,
    AppointmentStatus.PENDING_RESCHEDULE,
    AppointmentStatus.COMPLETED,
  ],
  [AppointmentStatus.ON_THE_WAY]: [
    AppointmentStatus.CHECKED_IN,
    AppointmentStatus.SEATED_IN_CHAIR,
    AppointmentStatus.CANCELLED,
    AppointmentStatus.COMPLETED,
  ],
  [AppointmentStatus.CHECKED_IN]: [
    AppointmentStatus.SEATED_IN_CHAIR,
    AppointmentStatus.COMPLETED,
    AppointmentStatus.CANCELLED,
  ],
  [AppointmentStatus.SEATED_IN_CHAIR]: [
    AppointmentStatus.COMPLETED,
    AppointmentStatus.CANCELLED,
  ],
  [AppointmentStatus.COMPLETED]: [], // Terminal
  [AppointmentStatus.CANCELLED]: [], // Terminal
  [AppointmentStatus.REJECTED]: [],  // Terminal
  [AppointmentStatus.PENDING_RESCHEDULE]: [
    AppointmentStatus.BOOKED,
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.CANCELLED,
  ],
  [AppointmentStatus.PENDING_ACCEPTANCE]: [
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.CHECKED_IN,
    AppointmentStatus.REJECTED,
    AppointmentStatus.CANCELLED,
  ],
};

export const appointmentInclude = {
  salonUser: {
    include: {
      user: true,
    },
  },
  stylist: true,
  service: true,
  services: {
    include: {
      service: true,
    },
    orderBy: { orderIndex: 'asc' as const },
  },
};

export function formatAppointment(appt: any) {
  if (!appt) return null;
  return {
    ...appt,
    user: appt.salonUser?.user || null,
  };
}

export function hashToSignedInt32(input: string): number {
  return crypto.createHash('sha256').update(input).digest().readInt32BE(0);
}

export function sanitizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `+91${digits}`;
  }
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+${digits}`;
  }
  return phone.startsWith('+') ? phone : `+${digits}`;
}
