import { Injectable } from '@nestjs/common';
import { AppointmentStatus, ClientEtaStatus } from '@prisma/client';
import {
  AppointmentActionType,
  getActionLeadMs,
} from '../../../../common/constants/booking-policy.constants';

export interface NextActionInput {
  status: AppointmentStatus;
  startAt: Date;
  endAt: Date;
  bookingType?: string | null;
  reminder2hSentAt?: Date | null;
  reminder10mSentAt?: Date | null;
  clientEtaStatus?: ClientEtaStatus | null;
  proposedStartAt?: Date | null;
  expiresAt?: Date | null;
  createdAt?: Date | null;
}

export interface NextActionResult {
  nextActionAt: Date | null;
  nextActionType: AppointmentActionType;
}

/**
 * AppointmentNextActionService (The Calculation Engine / Brain)
 *
 * SOLE RESPONSIBILITY:
 * Given an appointment's current status and timestamps, calculate the
 * next lifecycle action type and the exact Date timestamp when it is due.
 *
 * PURE BUSINESS LOGIC:
 * - ZERO database queries.
 * - ZERO Redis calls.
 * - ZERO network calls.
 * Completely deterministic and isolated for ultra-fast, robust unit testing.
 */
@Injectable()
export class AppointmentNextActionService {
  /**
   * Pure calculation of the next lifecycle action and timestamp for an appointment.
   */
  calculateNextAction(input: NextActionInput): NextActionResult {
    const now = Date.now();
    const startMs = new Date(input.startAt).getTime();
    const endMs = new Date(input.endAt).getTime();

    switch (input.status) {
      case AppointmentStatus.BOOKED: {
        if (!input.reminder2hSentAt) {
          const reminderLeadTime = startMs - getActionLeadMs(AppointmentActionType.REMINDER_2H);
          const cutoffTime = startMs - getActionLeadMs(AppointmentActionType.CUTOFF_60M);
          if (now >= cutoffTime) {
            return { nextActionAt: new Date(now), nextActionType: AppointmentActionType.CUTOFF_60M };
          }
          if (now >= reminderLeadTime) {
            return { nextActionAt: new Date(now), nextActionType: AppointmentActionType.REMINDER_2H };
          }
          return { nextActionAt: new Date(reminderLeadTime), nextActionType: AppointmentActionType.REMINDER_2H };
        } else {
          const cutoffTime = startMs - getActionLeadMs(AppointmentActionType.CUTOFF_60M);
          if (now >= cutoffTime) {
            return { nextActionAt: new Date(now), nextActionType: AppointmentActionType.CUTOFF_60M };
          }
          return { nextActionAt: new Date(cutoffTime), nextActionType: AppointmentActionType.CUTOFF_60M };
        }
      }

      case AppointmentStatus.CONFIRMED: {
        // Quick booking walk-in is immediate -> directly schedule AUTO_COMPLETE at endAt
        if (input.bookingType === 'QUICK') {
          return { nextActionAt: new Date(endMs), nextActionType: AppointmentActionType.AUTO_COMPLETE };
        }

        // If client already marked ON_THE_WAY or ARRIVED, no arrival alert needed -> directly schedule AUTO_COMPLETE
        if (
          input.clientEtaStatus === ClientEtaStatus.ON_THE_WAY ||
          input.clientEtaStatus === ClientEtaStatus.ARRIVED
        ) {
          return { nextActionAt: new Date(endMs), nextActionType: AppointmentActionType.AUTO_COMPLETE };
        }

        if (!input.reminder10mSentAt) {
          const arrivalLeadTime = startMs - getActionLeadMs(AppointmentActionType.ARRIVAL_15M);
          if (now >= endMs) {
            return { nextActionAt: new Date(now), nextActionType: AppointmentActionType.AUTO_COMPLETE };
          }
          if (now >= arrivalLeadTime) {
            // Remaining time is 15 minutes or less (Quick Booking confirmed by salon, or slot about to start)!
            // Skip 15m reminder, directly schedule AUTO_COMPLETE at endAt.
            return { nextActionAt: new Date(endMs), nextActionType: AppointmentActionType.AUTO_COMPLETE };
          }
          return { nextActionAt: new Date(arrivalLeadTime), nextActionType: AppointmentActionType.ARRIVAL_15M };
        } else {
          // 15m arrival alert was already sent. Check if customer has responded or not.
          const hasCustomerResponded = Boolean(input.clientEtaStatus);
          if (!hasCustomerResponded) {
            // Cutoff is 10 minutes after arrival reminder was sent
            const reminderSentMs = new Date(input.reminder10mSentAt).getTime();
            const cutoffTime = reminderSentMs + getActionLeadMs(AppointmentActionType.CUTOFF_10M);
            if (now >= cutoffTime) {
              return { nextActionAt: new Date(now), nextActionType: AppointmentActionType.CUTOFF_10M };
            }
            return { nextActionAt: new Date(cutoffTime), nextActionType: AppointmentActionType.CUTOFF_10M };
          } else {
            return { nextActionAt: new Date(endMs), nextActionType: AppointmentActionType.AUTO_COMPLETE };
          }
        }
      }

      case AppointmentStatus.CHECKED_IN:
      case AppointmentStatus.SEATED_IN_CHAIR:
      case AppointmentStatus.ON_THE_WAY: {
        return { nextActionAt: new Date(endMs), nextActionType: AppointmentActionType.AUTO_COMPLETE };
      }

      case AppointmentStatus.PENDING_ACCEPTANCE: {
        // Quick booking awaiting salon acceptance: 5-minute auto-decline cutoff from creation
        const createdAtMs = input.createdAt ? new Date(input.createdAt).getTime() : now;
        const cutoffTime = createdAtMs + 5 * 60 * 1000;
        if (now >= cutoffTime) {
          return { nextActionAt: new Date(now), nextActionType: AppointmentActionType.CUTOFF_5M };
        }
        return { nextActionAt: new Date(cutoffTime), nextActionType: AppointmentActionType.CUTOFF_5M };
      }

      case AppointmentStatus.PENDING_RESCHEDULE: {
        let cutoffTime: number;
        if (input.expiresAt) {
          cutoffTime = new Date(input.expiresAt).getTime();
        } else if (input.proposedStartAt) {
          const sixtyMinFromNow = now + 60 * 60 * 1000;
          const sixtyMinBeforeSlot = new Date(input.proposedStartAt).getTime() - 60 * 60 * 1000;
          cutoffTime = Math.min(sixtyMinFromNow, sixtyMinBeforeSlot);
        } else {
          cutoffTime = now + 60 * 60 * 1000;
        }

        if (now >= cutoffTime) {
          return { nextActionAt: new Date(now), nextActionType: AppointmentActionType.CUTOFF_60M };
        }
        return { nextActionAt: new Date(cutoffTime), nextActionType: AppointmentActionType.CUTOFF_60M };
      }

      case AppointmentStatus.CANCELLED:
      case AppointmentStatus.COMPLETED:
      case AppointmentStatus.REJECTED:
      default: {
        // Terminal states -> No further action performed
        return { nextActionAt: null, nextActionType: AppointmentActionType.NONE };
      }
    }
  }
}
