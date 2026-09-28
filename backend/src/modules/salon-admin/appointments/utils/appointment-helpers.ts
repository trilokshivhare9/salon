import * as crypto from 'crypto';
import { AppointmentStatus } from '@prisma/client';

export const VALID_STATUS_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  [AppointmentStatus.CONFIRMED]: [
    AppointmentStatus.CHECKED_IN,
    AppointmentStatus.IN_SERVICE,
    AppointmentStatus.CANCELLED,
    AppointmentStatus.NO_SHOW,
    AppointmentStatus.PENDING_RESCHEDULE,
  ],
  [AppointmentStatus.CHECKED_IN]: [
    AppointmentStatus.IN_SERVICE,
    AppointmentStatus.CANCELLED,
    AppointmentStatus.NO_SHOW,
  ],
  [AppointmentStatus.IN_SERVICE]: [
    AppointmentStatus.COMPLETED,
  ],
  [AppointmentStatus.COMPLETED]: [], // Terminal
  [AppointmentStatus.CANCELLED]: [], // Terminal
  [AppointmentStatus.NO_SHOW]: [],   // Terminal
  [AppointmentStatus.PENDING_RESCHEDULE]: [
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.CANCELLED,
  ],
  [AppointmentStatus.PENDING_ACCEPTANCE]: [
    AppointmentStatus.CHECKED_IN,
    AppointmentStatus.CONFIRMED,
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
