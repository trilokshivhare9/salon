import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { AppointmentStatus, BookingSource, CancelledBy } from '@prisma/client';

export class CreateAppointmentDto {
  @IsString()
  @IsOptional()
  serviceId?: string;

  @IsOptional()
  serviceIds?: string[];

  @IsString()
  @IsOptional()
  stylistId?: string;

  @IsString()
  @IsOptional()
  staffId?: string; // backwards compatibility

  @IsDateString()
  @IsNotEmpty()
  date: string; // "YYYY-MM-DD"

  @IsString()
  @IsNotEmpty()
  startTime: string; // "10:00" (Local salon time)

  @IsString()
  @IsOptional()
  customerName?: string;

  @IsString()
  @IsNotEmpty()
  customerPhone: string;

  @IsString()
  @IsOptional()
  customerEmail?: string;

  @IsEnum(BookingSource)
  @IsOptional()
  source?: BookingSource;

  @IsString()
  @IsOptional()
  notes?: string;
}

/**
 * Backward-compatible status alias dictionary.
 * Protects against cached PWA clients, stale mobile app bundles, and legacy webhooks.
 */
export const STATUS_ALIAS_MAP: Record<string, AppointmentStatus> = {
  IN_SERVICE: AppointmentStatus.SEATED_IN_CHAIR,
  ARRIVED: AppointmentStatus.CHECKED_IN,
  DONE: AppointmentStatus.COMPLETED,
  REJECT: AppointmentStatus.REJECTED,
};

export class UpdateAppointmentStatusDto {
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      const sanitized = value.trim().toUpperCase();
      return STATUS_ALIAS_MAP[sanitized] || sanitized;
    }
    return value;
  })
  @IsEnum(AppointmentStatus)
  @IsNotEmpty()
  status: AppointmentStatus;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsString()
  @IsOptional()
  reasonCategory?: string; // 'CLIENT_UNRESPONSIVE' | 'CLIENT_MISTAKE' | 'SALON_EMERGENCY'
}


export class RescheduleAppointmentDto {
  @IsDateString()
  @IsNotEmpty()
  newDate: string; // "YYYY-MM-DD"

  @IsString()
  @IsNotEmpty()
  newStartTime: string; // "14:00"

  @IsString()
  @IsOptional()
  stylistId?: string;

  @IsString()
  @IsOptional()
  staffId?: string; // backwards compatibility
}


// ─── Cancel Booking Types ─────────────────────────────────────────────────

/**
 * Identifies which system path triggered the cancellation.
 * Used for debugging, logging, and determining correct WhatsApp notification template.
 */
export type CancellationSource =
  | 'ADMIN_DASHBOARD'            // Salon owner cancels from dashboard
  | 'CUSTOMER_WHATSAPP'          // Customer cancels via WhatsApp Active Hub
  | 'CUSTOMER_ABSENCE'           // Customer cancels after stylist absence notification
  | 'CUSTOMER_REMINDER'          // Customer cancels from 10-min reminder
  | 'SYSTEM_AUTO_NOSHOW'         // Auto-cancel after 5-min grace period (no arrival)
  | 'SYSTEM_AUTO_CUTOFF'         // Auto-cancel at T-60m for unconfirmed BOOKED appointments
  | 'SYSTEM_AUTO_EXPIRED'        // Quick booking expired (start time passed)
  | 'SYSTEM_SALON_DEACTIVATION'  // Super Admin deactivated salon
  | 'SYSTEM_STORE_CLOSURE'       // Emergency salon closure
  | 'SYSTEM_MOVE_UP'             // Express Move-Up replaced old slot
  | 'SALON_REJECTED';            // Salon rejected quick booking request

/**
 * Determines penalty responsibility.
 * - CLIENT: Client's fault → may apply penalty if within cancel window
 * - SALON: Salon's fault → zero penalty always
 * - SYSTEM: System action → zero penalty always
 */
export type CancellationFault =
  | 'CLIENT'
  | 'SALON'
  | 'SYSTEM';

/**
 * Unified context for all cancel booking operations.
 * Every cancel path MUST provide this context to cancelBooking().
 */
export interface CancelBookingContext {
  source: CancellationSource;
  fault: CancellationFault;
  reason?: string;              // Human-readable reason note
  reasonCategory?: string;      // e.g. 'CLIENT_UNRESPONSIVE', 'SALON_EMERGENCY'
  adminId?: string;             // If admin-initiated
  skipWhatsAppNotify?: boolean; // For callers that send their own custom reply (e.g., WhatsApp bot)
  skipMoveUp?: boolean;         // Skip Smart Move-Up broadcast (e.g., bulk cancels)
  applyPenalty?: boolean;       // Optional explicit penalty override from salon admin (true = mark penalty, false = without penalty)
  noPenalty?: boolean;          // Explicit flag: when true, skip penalty logic and NEVER mark any penalty strike
  cancelledBy?: CancelledBy;    // Actor who cancelled (USER, SALON, SYSTEM)
}

/**
 * Structured result from cancelBooking() with penalty details.
 * Callers can use this to display penalty info or make further decisions.
 */
export interface CancelBookingResult {
  appointment: any;             // Formatted appointment
  penaltyApplied: boolean;
  penaltyCount: number;         // Total strikes after this cancel
  remainingStrikes: number;     // Strikes remaining before block
  isBlocked: boolean;           // Whether account is now locked
  status: string;               // Final status (CANCELLED)
}
