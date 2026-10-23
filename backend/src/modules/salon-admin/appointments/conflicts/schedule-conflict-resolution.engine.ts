import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { DayOfWeek, AppointmentStatus } from '@prisma/client';
import { DateTime } from 'luxon';
import { TimeUtility } from '../../../../common/utils/time.utility';
import { BOOKING_POLICY } from '../../../../common/constants/booking-policy.constants';
import { AvailabilityService } from '../../availability/availability.service';
import { AppointmentStatusService } from '../status/appointment-status.service';
import { CancellationService } from '../cancellation/cancellation.service';

export interface ScheduleConflictQuery {
  salonId: string;
  scope: 'SALON' | 'STYLIST';
  stylistId?: string;
  dayOfWeek?: DayOfWeek;
  dateRange?: {
    startDate: Date | string;
    endDate: Date | string;
    startTime?: string;
    endTime?: string;
    isPartialDay?: boolean;
  };
  shiftHours?: {
    startTime?: string;
    endTime?: string;
  };
  breakHours?: {
    startTime?: string;
    endTime?: string;
  };
  isClosedOrOff: boolean;
  reason?: string;
  adminId?: string;
}

export interface ProposedSlotResult {
  startAt: Date;
  endAt: Date;
  dateStr: string;
  startTime: string;
  endTime: string;
  eligibleStaffIds: string[];
}

export interface ConflictResolutionResult {
  totalAffected: number;
  rescheduledCount: number;
  cancelledCount: number;
  details: Array<{
    appointmentId: string;
    appointmentNumber: string;
    customerName: string;
    customerPhone?: string;
    action: 'PROPOSED_RESCHEDULE' | 'CANCELLED_ZERO_PENALTY';
    proposedSlot?: string;
    reason?: string;
  }>;
  message: string;
}

@Injectable()
export class ScheduleConflictResolutionEngine {
  private readonly logger = new Logger(ScheduleConflictResolutionEngine.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly availabilityService: AvailabilityService,
    @Inject(forwardRef(() => AppointmentStatusService))
    private readonly statusService: AppointmentStatusService,
    @Inject(forwardRef(() => CancellationService))
    private readonly cancellationService: CancellationService,
  ) { }

  /**
   * Method 1: Finds all active bookings that collide with the proposed schedule change.
   */
  async findConflictingAppointments(query: ScheduleConflictQuery): Promise<any[]> {
    const tz = await TimeUtility.getSalonTimezone(this.prisma, query.salonId);
    const now = new Date();

    const futureAppointments = await this.prisma.appointment.findMany({
      where: {
        salonId: query.salonId,
        ...(query.scope === 'STYLIST' && query.stylistId ? { stylistId: query.stylistId } : {}),
        status: {
          in: [
            AppointmentStatus.BOOKED,
            AppointmentStatus.CONFIRMED,
            AppointmentStatus.ON_THE_WAY,
            AppointmentStatus.PENDING_RESCHEDULE,
          ],
        },
        startAt: { gte: now },
      },
      include: {
        services: true,
        salonUser: {
          include: {
            user: {
              select: { name: true, phone: true },
            },
          },
        },
        stylist: {
          select: { id: true, name: true },
        },
      },
      orderBy: { startAt: 'asc' },
    });

    if (futureAppointments.length === 0) {
      return [];
    }

    const conflictingAppts: any[] = [];

    for (const appt of futureAppointments) {
      const apptStartDt = DateTime.fromJSDate(appt.startAt, { zone: tz });
      const apptEndDt = DateTime.fromJSDate(appt.endAt, { zone: tz });
      const apptDayOfWeek = apptStartDt.toFormat('cccc').toUpperCase() as DayOfWeek;
      const apptDateIso = apptStartDt.toISODate();
      const apptStartStr = apptStartDt.toFormat('HH:mm');
      const apptEndStr = apptEndDt.toFormat('HH:mm');

      // Scenario A: Recurring Weekly Day change (e.g. Day Off, shift reduced, or break)
      if (query.dayOfWeek) {
        if (apptDayOfWeek !== query.dayOfWeek) continue;

        if (query.isClosedOrOff) {
          conflictingAppts.push(appt);
        } else if (query.shiftHours?.startTime && query.shiftHours?.endTime) {
          // If shift is shortened, check if appointment falls outside new shift boundary
          if (apptStartStr < query.shiftHours.startTime || apptEndStr > query.shiftHours.endTime) {
            conflictingAppts.push(appt);
          }
        } else if (query.breakHours?.startTime && query.breakHours?.endTime) {
          // If break is added/updated, check if appointment overlaps break interval [breakStart, breakEnd]
          if (apptStartStr < query.breakHours.endTime && apptEndStr > query.breakHours.startTime) {
            conflictingAppts.push(appt);
          }
        }
        continue;
      }

      // Scenario B: Specific Calendar Date Range (Leave / Salon Closure / Holiday)
      if (query.dateRange) {
        const startIso = typeof query.dateRange.startDate === 'string'
          ? query.dateRange.startDate
          : DateTime.fromJSDate(query.dateRange.startDate, { zone: tz }).toISODate();
        const endIso = typeof query.dateRange.endDate === 'string'
          ? query.dateRange.endDate
          : DateTime.fromJSDate(query.dateRange.endDate, { zone: tz }).toISODate();

        if (apptDateIso >= startIso && apptDateIso <= endIso) {
          if (!query.dateRange.isPartialDay) {
            conflictingAppts.push(appt);
          } else if (query.dateRange.startTime && query.dateRange.endTime) {
            // Partial day closure or break overlap check
            if (apptStartStr < query.dateRange.endTime && apptEndStr > query.dateRange.startTime) {
              conflictingAppts.push(appt);
            }
          }
        }
      }
    }

    return conflictingAppts;
  }

  /**
   * Method 2: Searches for the next best available slot for the customer.
   * Checks from today forward up to maxDaysHorizon (default: BOOKING_POLICY.MAX_ADVANCE_BOOKING_DAYS).
   * Enforces minimum 2-hour lead time from current time so customer has adequate notice.
   * Picks the slot closest to the customer's originally preferred time of day.
   */
  async findNextAvailableSlot(
    salonId: string,
    appointment: any,
    preferredStylistId?: string,
    maxDaysHorizon: number = BOOKING_POLICY.MAX_ADVANCE_BOOKING_DAYS,
  ): Promise<ProposedSlotResult | null> {
    const tz = await TimeUtility.getSalonTimezone(this.prisma, salonId);

    // Extract service ID(s)
    let serviceIds: string[] = [];
    if (appointment.services && Array.isArray(appointment.services) && appointment.services.length > 0) {
      serviceIds = appointment.services.map((s: any) => s.serviceId).filter(Boolean);
    } else if (appointment.serviceId) {
      serviceIds = [appointment.serviceId];
    }

    // Fallback: If no service ID attached, query any active service for the salon
    if (serviceIds.length === 0) {
      const fallbackService = await this.prisma.service.findFirst({
        where: { salonId },
        select: { id: true },
      });
      if (fallbackService) {
        serviceIds = [fallbackService.id];
      } else {
        this.logger.warn(`No service ID found to compute available slots for appt #${appointment.appointmentNumber}`);
        return null;
      }
    }

    const nowInSalonZone = DateTime.now().setZone(tz);
    // Minimum 2-hour lead time from NOW for reschedule offers
    const minNoticeTime = nowInSalonZone.plus({ hours: 2 });

    const origStartDt = DateTime.fromJSDate(appointment.startAt, { zone: tz });
    const origTargetMinutes = origStartDt.hour * 60 + origStartDt.minute;

    // Search base date: if original start is in the past, anchor at today in salon timezone
    const baseDt = origStartDt.startOf('day') < nowInSalonZone.startOf('day') ? nowInSalonZone : origStartDt;

    // Search forward starting from Today (dayOffset 0 up to maxDaysHorizon - 1)
    for (let dayOffset = 0; dayOffset < maxDaysHorizon; dayOffset++) {
      const candidateDt = baseDt.plus({ days: dayOffset });
      const candidateDateStr = candidateDt.toISODate()!;

      try {
        const availability = await this.availabilityService.getAvailableSlots(
          salonId,
          serviceIds,
          candidateDateStr,
          preferredStylistId || appointment.stylistId,
          appointment.id,
        );

        if (availability && availability.availableSlots && availability.availableSlots.length > 0) {
          // Filter slots that have at least 2 hours remaining from NOW
          const validSlots = availability.availableSlots.filter((slot) => {
            const slotStartDt = DateTime.fromISO(slot.isoStartTime, { zone: tz });
            return slotStartDt >= minNoticeTime;
          });

          if (validSlots.length > 0) {
            // Select slot closest to original customer preferred time of day
            let bestSlot = validSlots[0];
            let minDiff = Infinity;

            for (const slot of validSlots) {
              const [h, m] = slot.startTime.split(':').map(Number);
              const slotMinutes = h * 60 + m;
              const diff = Math.abs(slotMinutes - origTargetMinutes);
              if (diff < minDiff) {
                minDiff = diff;
                bestSlot = slot;
              }
            }

            return {
              startAt: new Date(bestSlot.isoStartTime),
              endAt: new Date(bestSlot.isoEndTime),
              dateStr: candidateDateStr,
              startTime: bestSlot.startTime,
              endTime: bestSlot.endTime,
              eligibleStaffIds: bestSlot.eligibleStaffIds || [],
            };
          }
        }
      } catch (err: any) {
        this.logger.warn(`Availability check error on ${candidateDateStr}: ${err.message}`);
      }
    }

    return null;
  }

  /**
   * Method 3: Centralized Coordinator
   * Scans for conflicts, auto-finds next slot, transitions to PENDING_RESCHEDULE,
   * sends WhatsApp reschedule proposal, or cancels with zero customer penalty.
   */
  async resolveScheduleConflicts(query: ScheduleConflictQuery): Promise<ConflictResolutionResult> {
    const conflicts = await this.findConflictingAppointments(query);

    if (conflicts.length === 0) {
      return {
        totalAffected: 0,
        rescheduledCount: 0,
        cancelledCount: 0,
        details: [],
        message: 'No active customer appointments impacted.',
      };
    }

    this.logger.log(
      `Found ${conflicts.length} conflicting booking(s) for salon ${query.salonId}. Resolving via automated reschedule...`,
    );

    const maxHorizon = BOOKING_POLICY.MAX_ADVANCE_BOOKING_DAYS;

    let rescheduledCount = 0;
    let cancelledCount = 0;
    const details: ConflictResolutionResult['details'] = [];

    for (const appt of conflicts) {
      const customerName = appt.salonUser?.user?.name || 'Customer';
      const customerPhone = appt.salonUser?.user?.phone;

      // 1. Attempt to find the closest next open slot
      // Check original stylist first; if no slot or stylist unavailable, check qualified peer staff
      let nextSlot = await this.findNextAvailableSlot(
        query.salonId,
        appt,
        appt.stylistId,
        maxHorizon,
      );

      let proposedStylistId: string | undefined = undefined;

      if (!nextSlot) {
        // Search across all qualified stylists on duty
        nextSlot = await this.findNextAvailableSlot(
          query.salonId,
          appt,
          undefined,
          maxHorizon,
        );
        if (nextSlot && nextSlot.eligibleStaffIds.length > 0) {
          proposedStylistId = nextSlot.eligibleStaffIds[0];
        }
      }

      if (nextSlot) {
        try {
          // Propose reschedule and dispatch interactive WhatsApp prompt
          await this.statusService.proposeAdminReschedule(
            query.salonId,
            appt.id,
            nextSlot.startAt,
            nextSlot.endAt,
            query.adminId,
            proposedStylistId,
          );

          rescheduledCount++;
          details.push({
            appointmentId: appt.id,
            appointmentNumber: appt.appointmentNumber,
            customerName,
            customerPhone,
            action: 'PROPOSED_RESCHEDULE',
            proposedSlot: `${nextSlot.dateStr} ${nextSlot.startTime} – ${nextSlot.endTime}`,
          });

          this.logger.log(
            `Reschedule proposal sent to ${customerName} for appt #${appt.appointmentNumber} to ${nextSlot.dateStr} at ${nextSlot.startTime}`,
          );
        } catch (err: any) {
          this.logger.error(
            `Failed to propose reschedule for appt #${appt.appointmentNumber}: ${err.message}`,
          );
        }
      } else {
        // Fallback: No slots found in maxHorizon days -> Cancel with SALON fault & zero penalty
        try {
          await this.cancellationService.cancelBooking(query.salonId, appt.id, {
            source: 'SYSTEM_STORE_CLOSURE',
            fault: 'SALON',
            reason: query.reason || 'Salon schedule update / closure',
          });

          cancelledCount++;
          details.push({
            appointmentId: appt.id,
            appointmentNumber: appt.appointmentNumber,
            customerName,
            customerPhone,
            action: 'CANCELLED_ZERO_PENALTY',
            reason: `No open slot available within ${maxHorizon} days. Cancelled with 0 customer fee.`,
          });

          this.logger.log(
            `Cancelled appt #${appt.appointmentNumber} with zero customer fee (no open slot found within ${maxHorizon} days).`,
          );
        } catch (err: any) {
          this.logger.error(
            `Failed to cancel conflicting appt #${appt.appointmentNumber}: ${err.message}`,
          );
        }
      }
    }

    return {
      totalAffected: conflicts.length,
      rescheduledCount,
      cancelledCount,
      details,
      message: `${conflicts.length} booking(s) affected: ${rescheduledCount} proposed next slot via WhatsApp, ${cancelledCount} cancelled with zero fee.`,
    };
  }
}
