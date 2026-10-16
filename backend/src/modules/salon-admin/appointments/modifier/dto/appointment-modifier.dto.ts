import { AppointmentStatus, CancelledBy, ClientEtaStatus } from '@prisma/client';

export interface ModifyAppointmentDto {
  status: AppointmentStatus;
  notes?: string;
  reason?: string;
  reasonCategory?: string;
  cancellationReason?: string;
  cancelledAt?: Date;
  cancelledBy?: CancelledBy;
  penaltyApplied?: boolean;
  proposedStartAt?: Date | null;
  proposedEndAt?: Date | null;
  proposedStylistId?: string | null;
  proposedByAdminId?: string | null;
  expiresAt?: Date | null;
  appointmentDate?: Date;
  startAt?: Date;
  endAt?: Date;
  stylistId?: string;
  reminder2hSentAt?: Date | null;
  reminder10mSentAt?: Date | null;
  clientEtaStatus?: ClientEtaStatus | null;
  adminId?: string;
  skipTransitionValidation?: boolean;
  existingAppointment?: any;
  tx?: any;
}
