import { Injectable } from '@nestjs/common';
import { StylistStatus, DayOfWeek, AppointmentStatus, LeavePortion } from '@prisma/client';
import { DateTime } from 'luxon';
import { TimeUtility } from '../../../../common/utils/time.utility';
import { PrismaService } from '../../../../database/prisma.service';

export enum StylistOperationalStatus {
  AVAILABLE = 'AVAILABLE',
  WORKING = 'WORKING',
  ON_BREAK = 'ON_BREAK',
  SALON_OFF = 'SALON_OFF',
  WEEKLY_OFF = 'WEEKLY_OFF',
  ON_LEAVE = 'ON_LEAVE',
  INACTIVE = 'INACTIVE',
}

export interface StylistStatusMetadata {
  appointmentId?: string;
  customerName?: string;
  breakWindow?: { start: string; end: string; name?: string };
  leaveType?: string;
  leavePortion?: string;
  closureReason?: string;
  closureType?: string;
}

export interface StylistOperationalStatusResult {
  status: StylistOperationalStatus;
  label: string;
  dotClass: string;
  badgeClass: string;
  reason: string;
  metadata?: StylistStatusMetadata;
}

export interface ResolveStylistStatusParams {
  stylist: {
    id: string;
    name?: string;
    status: StylistStatus | string;
    followsSalonSchedule?: boolean;
    workingHours?: any[];
  };
  salonWorkingHours?: any[];
  salonClosures?: any[];
  absences?: any[];
  appointments?: any[];
  timezone?: string;
  evaluationDateTime?: DateTime;
}

export interface ResolveBatchStatusesParams {
  stylists: any[];
  salonWorkingHours: any[];
  salonClosures: any[];
  absences: any[];
  appointments: any[];
  timezone?: string;
  evaluationDateTime?: DateTime;
}

@Injectable()
export class StylistStatusEngine {
  constructor(private readonly prisma?: PrismaService) {}

  /**
   * Helper to parse time string "HH:mm" to total minutes from midnight.
   * Delegated to centralized TimeUtility.
   */
  public parseTimeToMinutes(timeStr: string): number {
    return TimeUtility.parseTimeStringToMinutes(timeStr);
  }

  /**
   * Maps Luxon DateTime or Date to Prisma DayOfWeek enum.
   * Delegated to centralized TimeUtility.
   */
  public getDayOfWeekEnum(date: DateTime | Date | string, timezone?: string): DayOfWeek {
    return TimeUtility.getDayOfWeekEnum(date, timezone);
  }

  /**
   * Formats minutes from midnight to "hh:mm AM/PM" (12-hour readable string).
   * Delegated to centralized TimeUtility.
   */
  public formatMinutesToTime(totalMinutes: number): string {
    return TimeUtility.formatTime12h(totalMinutes);
  }

  /**
   * Attaches standard operational status fields to a stylist record.
   */
  public attachOperationalStatus<T extends object>(stylist: T, statusRes?: StylistOperationalStatusResult): T & {
    operationalStatus: StylistOperationalStatus;
    statusLabel: string;
    statusDotClass: string;
    statusBadgeClass: string;
    statusReason: string;
    statusMetadata: StylistStatusMetadata | null;
  } {
    return {
      ...stylist,
      operationalStatus: statusRes?.status || StylistOperationalStatus.AVAILABLE,
      statusLabel: statusRes?.label || 'Available',
      statusDotClass: statusRes?.dotClass || 'status-available',
      statusBadgeClass: statusRes?.badgeClass || 'badge-available',
      statusReason: statusRes?.reason || '',
      statusMetadata: statusRes?.metadata || null,
    };
  }

  /**
   * Attaches customer-facing status fields to a stylist record.
   */
  public attachCustomerFacingStatus<T extends object>(stylist: T, statusRes?: StylistOperationalStatusResult): T & {
    operationalStatus: StylistOperationalStatus;
    statusLabel: string;
    statusReason: string;
    customerStatusText: string;
    isAvailableToday: boolean;
  } {
    const opStatus = statusRes?.status || StylistOperationalStatus.AVAILABLE;
    const customerStatusText = this.formatCustomerStatusText(opStatus, (stylist as any).role);
    return {
      ...stylist,
      operationalStatus: opStatus,
      statusLabel: statusRes?.label || 'Available',
      statusReason: statusRes?.reason || '',
      customerStatusText,
      isAvailableToday:
        opStatus === StylistOperationalStatus.AVAILABLE ||
        opStatus === StylistOperationalStatus.WORKING ||
        opStatus === StylistOperationalStatus.ON_BREAK,
    };
  }

  /**
   * Single Source of Truth: Loads all salon operational context (closures, working hours,
   * absences, active appointments) and evaluates operational statuses for stylists in a single fast, batched operation.
   */
  public async resolveSalonStaffStatuses(
    salonId: string,
    options?: {
      targetDate?: string | Date | DateTime;
      stylists?: any[];
      stylistId?: string;
      timezone?: string;
    },
  ): Promise<Map<string, StylistOperationalStatusResult>> {
    if (!this.prisma) {
      throw new Error('PrismaService is required for resolveSalonStaffStatuses');
    }

    let timezone = options?.timezone;
    if (!timezone) {
      const salon = await this.prisma.salon.findUnique({
        where: { id: salonId },
        select: { timezone: true },
      });
      timezone = salon?.timezone || TimeUtility.DEFAULT_TIMEZONE;
    }

    const { evalDt, startOfDay, endOfDay } = TimeUtility.getDayBoundaries(options?.targetDate, timezone);

    // 1. Resolve target stylists
    let targetStylists = options?.stylists;
    if (!targetStylists) {
      targetStylists = await this.prisma.stylist.findMany({
        where: {
          salonId,
          ...(options?.stylistId ? { id: options.stylistId } : {}),
        },
        include: {
          services: { include: { service: true } },
          workingHours: { orderBy: { dayOfWeek: 'asc' } },
          absences: { where: { status: 'ACTIVE' } },
        },
        orderBy: { createdAt: 'asc' },
      });
    }

    // 2. Concurrently fetch operational records for the target day
    const [salonWorkingHours, salonClosures, absences, activeAppointments] = await Promise.all([
      this.prisma.salonWorkingHours.findMany({
        where: { salonId },
      }),
      this.prisma.salonClosure.findMany({
        where: {
          salonId,
          startDate: { lte: endOfDay },
          endDate: { gte: startOfDay },
        },
      }),
      this.prisma.stylistAbsence.findMany({
        where: {
          salonId,
          status: 'ACTIVE',
          startDate: { lte: endOfDay },
          endDate: { gte: startOfDay },
          ...(options?.stylistId ? { stylistId: options.stylistId } : {}),
        },
      }),
      this.prisma.appointment.findMany({
        where: {
          salonId,
          appointmentDate: {
            gte: startOfDay,
            lte: endOfDay,
          },
          status: {
            in: [
              AppointmentStatus.SEATED_IN_CHAIR,
              AppointmentStatus.CHECKED_IN,
              AppointmentStatus.CONFIRMED,
              AppointmentStatus.BOOKED,
            ],
          },
          ...(options?.stylistId ? { stylistId: options.stylistId } : {}),
        },
        select: {
          id: true,
          stylistId: true,
          status: true,
          startAt: true,
          endAt: true,
          serviceNameSnapshot: true,
          salonUser: {
            select: {
              user: {
                select: { name: true },
              },
            },
          },
        },
      }),
    ]);

    // 3. Resolve status map
    return this.resolveBatchStatuses({
      stylists: targetStylists,
      salonWorkingHours,
      salonClosures,
      absences,
      appointments: activeAppointments,
      timezone,
      evaluationDateTime: evalDt,
    });
  }

  /**
   * Evaluates the operational status for a single stylist at a given date/time.
   */
  public resolveStylistStatus(params: ResolveStylistStatusParams): StylistOperationalStatusResult {
    const {
      stylist,
      salonWorkingHours = [],
      salonClosures = [],
      absences = [],
      appointments = [],
      timezone = TimeUtility.DEFAULT_TIMEZONE,
    } = params;

    const evalDt = params.evaluationDateTime || TimeUtility.now(timezone);
    const evalDateIso = evalDt.toISODate()!;
    const evalMin = evalDt.hour * 60 + evalDt.minute;
    const dayOfWeek = this.getDayOfWeekEnum(evalDt, timezone);

    // =========================================================================
    // LEVEL 1: SALON FACILITY LEVEL (Universally applies to all specialists)
    // =========================================================================

    // 1a. Store-wide closure or holiday active on this date
    const targetClosure = salonClosures.find((c) => {
      const startIso = c.startDate instanceof Date ? c.startDate.toISOString().split('T')[0] : (c.startDate || '').split('T')[0];
      const endIso = c.endDate instanceof Date ? c.endDate.toISOString().split('T')[0] : (c.endDate || '').split('T')[0];
      return evalDateIso >= startIso && evalDateIso <= endIso;
    });

    if (targetClosure) {
      if (!targetClosure.isPartialDay) {
        return {
          status: StylistOperationalStatus.SALON_OFF,
          label: 'Salon Off',
          dotClass: 'status-salon-off',
          badgeClass: 'badge-salon-off',
          reason: targetClosure.reason || 'Salon is closed for holiday.',
          metadata: {
            closureReason: targetClosure.reason,
            closureType: targetClosure.closureType,
          },
        };
      } else if (targetClosure.startTime && targetClosure.endTime) {
        const cStartMin = this.parseTimeToMinutes(targetClosure.startTime);
        const cEndMin = this.parseTimeToMinutes(targetClosure.endTime);
        if (evalMin >= cStartMin && evalMin <= cEndMin) {
          return {
            status: StylistOperationalStatus.SALON_OFF,
            label: 'Salon Off',
            dotClass: 'status-salon-off',
            badgeClass: 'badge-salon-off',
            reason: targetClosure.reason || 'Salon is closed for partial-day event.',
            metadata: {
              closureReason: targetClosure.reason,
              closureType: targetClosure.closureType,
            },
          };
        }
      }
    }

    // 1b. Store-wide Weekly Off for this day of week (in salonWorkingHours)
    const salonWh = salonWorkingHours.find((h) => h.dayOfWeek === dayOfWeek);
    if (salonWh && (salonWh.isClosed || salonWh.isOff)) {
      return {
        status: StylistOperationalStatus.SALON_OFF,
        label: 'Salon Off',
        dotClass: 'status-salon-off',
        badgeClass: 'badge-salon-off',
        reason: 'Salon Weekly Off',
      };
    }

    // 1c. Outside Salon Operating Hours
    let salonOpenMin = 9 * 60;
    let salonCloseMin = 21 * 60;
    if (salonWh) {
      if (salonWh.startTime) salonOpenMin = this.parseTimeToMinutes(salonWh.startTime);
      if (salonWh.endTime) salonCloseMin = this.parseTimeToMinutes(salonWh.endTime);
    }

    if (evalMin < salonOpenMin || evalMin >= salonCloseMin) {
      return {
        status: StylistOperationalStatus.SALON_OFF,
        label: 'Salon Off',
        dotClass: 'status-salon-off',
        badgeClass: 'badge-salon-off',
        reason: 'Outside operating hours.',
      };
    }

    // =========================================================================
    // LEVEL 2: INDIVIDUAL SPECIALIST LEVEL (Salon Facility is OPEN)
    // =========================================================================

    // 2a. Account Lifecycle Guard: INACTIVE
    if (stylist.status !== StylistStatus.ACTIVE) {
      return {
        status: StylistOperationalStatus.INACTIVE,
        label: 'Inactive',
        dotClass: 'status-inactive',
        badgeClass: 'badge-inactive',
        reason: 'Stylist account is deactivated by salon admin.',
      };
    }

    // 2b. Approved Specialist Leave / Absence
    const activeAbsence = absences.find((ab) => {
      if (ab.stylistId && ab.stylistId !== stylist.id) return false;
      if (ab.status && ab.status !== 'ACTIVE') return false;

      const sDate = ab.startDate instanceof Date ? ab.startDate.toISOString().split('T')[0] : (ab.startDate || ab.absenceDate || '').split('T')[0];
      const eDate = ab.endDate instanceof Date ? ab.endDate.toISOString().split('T')[0] : (ab.endDate || ab.absenceDate || '').split('T')[0];
      return evalDateIso >= sDate && evalDateIso <= eDate;
    });

    if (activeAbsence) {
      const portion = activeAbsence.leavePortion || LeavePortion.FULL_DAY;
      let isLeaveNow = false;

      let stShiftStart = salonOpenMin;
      let stShiftEnd = salonCloseMin;
      const customWh = (stylist.workingHours || []).find((h) => h.dayOfWeek === dayOfWeek);
      if (customWh && (!stylist.followsSalonSchedule || !customWh.isWorking) && customWh.isWorking) {
        if (customWh.startTime) stShiftStart = this.parseTimeToMinutes(customWh.startTime);
        if (customWh.endTime) stShiftEnd = this.parseTimeToMinutes(customWh.endTime);
      }

      if (portion === LeavePortion.FULL_DAY) {
        isLeaveNow = true;
      } else if (portion === LeavePortion.FIRST_HALF) {
        const midPoint = Math.floor(stShiftStart + (stShiftEnd - stShiftStart) / 2);
        isLeaveNow = evalMin < midPoint;
      } else if (portion === LeavePortion.SECOND_HALF) {
        const midPoint = Math.floor(stShiftStart + (stShiftEnd - stShiftStart) / 2);
        isLeaveNow = evalMin >= midPoint;
      } else if (portion === LeavePortion.CUSTOM_HOURS && activeAbsence.customStartTime && activeAbsence.customEndTime) {
        const cStart = this.parseTimeToMinutes(activeAbsence.customStartTime);
        const cEnd = this.parseTimeToMinutes(activeAbsence.customEndTime);
        isLeaveNow = evalMin >= cStart && evalMin < cEnd;
      }

      if (isLeaveNow) {
        return {
          status: StylistOperationalStatus.ON_LEAVE,
          label: 'On Leave',
          dotClass: 'status-leave',
          badgeClass: 'badge-leave',
          reason: activeAbsence.reason || (activeAbsence.leaveType ? `Leave (${activeAbsence.leaveType.replace('_', ' ')})` : 'On Leave'),
          metadata: {
            leaveType: activeAbsence.leaveType,
            leavePortion: activeAbsence.leavePortion,
          },
        };
      }
    }

    // 2c. Specialist Schedule (Weekly Off vs Shift Hours)
    let isStylistWeeklyOff = false;
    let shiftStartMin = salonOpenMin;
    let shiftEndMin = salonCloseMin;
    let breaksList: Array<{ start: number; end: number; name?: string }> = salonWh ? this.extractBreaks(salonWh) : [];

    const customWh = (stylist.workingHours || []).find((h) => h.dayOfWeek === dayOfWeek);

    if (customWh && (!stylist.followsSalonSchedule || !customWh.isWorking)) {
      if (!customWh.isWorking || customWh.isClosed || customWh.isOff) {
        isStylistWeeklyOff = true;
      } else {
        if (customWh.startTime) shiftStartMin = Math.max(salonOpenMin, this.parseTimeToMinutes(customWh.startTime));
        if (customWh.endTime) shiftEndMin = Math.min(salonCloseMin, this.parseTimeToMinutes(customWh.endTime));
      }
    }

    // Prioritize stylist breaks if custom breaks exist and override is flagged or salon has no breaks
    if (customWh) {
      const customBreaks = this.extractBreaks(customWh);
      if (customBreaks.length > 0 && (customWh.hasBreakOverride || breaksList.length === 0 || !stylist.followsSalonSchedule)) {
        breaksList = customBreaks;
      }
    }

    if (isStylistWeeklyOff) {
      return {
        status: StylistOperationalStatus.WEEKLY_OFF,
        label: 'Weekly Off',
        dotClass: 'status-weekly-off',
        badgeClass: 'badge-weekly-off',
        reason: 'Weekly Off',
      };
    }

    // 2d. Outside Specialist Personal Shift (Shift not started or ended)
    if (evalMin < shiftStartMin || evalMin >= shiftEndMin) {
      return {
        status: StylistOperationalStatus.SALON_OFF,
        label: 'Salon Off',
        dotClass: 'status-salon-off',
        badgeClass: 'badge-salon-off',
        reason: evalMin < shiftStartMin ? 'Shift starts later today.' : 'Shift completed for today.',
      };
    }

    // 2e. Scheduled Break Window: ON_BREAK
    const activeBreak = breaksList.find((b) => evalMin >= b.start && evalMin < b.end);
    if (activeBreak) {
      const breakLabel = activeBreak.name ? `${activeBreak.name}` : 'Break';
      const startStr = this.formatMinutesToTime(activeBreak.start);
      const endStr = this.formatMinutesToTime(activeBreak.end);
      return {
        status: StylistOperationalStatus.ON_BREAK,
        label: 'On Break',
        dotClass: 'status-break',
        badgeClass: 'badge-break',
        reason: `${breakLabel} (${startStr} - ${endStr})`,
        metadata: {
          breakWindow: {
            start: startStr,
            end: endStr,
            name: activeBreak.name,
          },
        },
      };
    }

    // =========================================================================
    // 5. Active In-Chair Service: WORKING
    // =========================================================================
    const seatedAppointment = appointments.find((appt) => {
      if (appt.stylistId !== stylist.id) return false;

      // Status explicitly marked SEATED_IN_CHAIR
      if (appt.status === AppointmentStatus.SEATED_IN_CHAIR) {
        return true;
      }

      // Or active booking spanning current evaluation time
      if (
        (appt.status === AppointmentStatus.CHECKED_IN || appt.status === AppointmentStatus.CONFIRMED || appt.status === AppointmentStatus.BOOKED) &&
        appt.startAt &&
        appt.endAt
      ) {
        const apptStartDt = DateTime.fromJSDate(new Date(appt.startAt)).setZone(timezone);
        const apptEndDt = DateTime.fromJSDate(new Date(appt.endAt)).setZone(timezone);
        return evalDt >= apptStartDt && evalDt < apptEndDt;
      }

      return false;
    });

    if (seatedAppointment) {
      const customer =
        seatedAppointment.salonUser?.user?.name ||
        seatedAppointment.customerName ||
        seatedAppointment.user?.name ||
        'Customer';
      const serviceName =
        seatedAppointment.serviceNameSnapshot ||
        seatedAppointment.service?.name ||
        seatedAppointment.services?.[0]?.service?.name ||
        'Service';
      return {
        status: StylistOperationalStatus.WORKING,
        label: 'In Chair',
        dotClass: 'status-working',
        badgeClass: 'badge-working',
        reason: `Serving ${customer} (${serviceName})`,
        metadata: {
          appointmentId: seatedAppointment.id,
          customerName: customer,
        },
      };
    }

    // =========================================================================
    // 6. Default Free & On Duty: AVAILABLE
    // =========================================================================
    return {
      status: StylistOperationalStatus.AVAILABLE,
      label: 'Available',
      dotClass: 'status-available',
      badgeClass: 'badge-available',
      reason: 'Available for walk-ins and appointments.',
    };
  }

  /**
   * Resolves operational status for an entire list of stylists in a single fast pass.
   */
  public resolveBatchStatuses(params: ResolveBatchStatusesParams): Map<string, StylistOperationalStatusResult> {
    const {
      stylists,
      salonWorkingHours,
      salonClosures,
      absences,
      appointments,
      timezone = TimeUtility.DEFAULT_TIMEZONE,
      evaluationDateTime,
    } = params;

    const resultMap = new Map<string, StylistOperationalStatusResult>();

    for (const stylist of stylists) {
      const stylistAbsences = absences.filter((a) => a.stylistId === stylist.id);
      const stylistAppts = appointments.filter((a) => a.stylistId === stylist.id);

      const statusResult = this.resolveStylistStatus({
        stylist,
        salonWorkingHours,
        salonClosures,
        absences: stylistAbsences,
        appointments: stylistAppts,
        timezone,
        evaluationDateTime,
      });

      resultMap.set(stylist.id, statusResult);
    }

    return resultMap;
  }

  /**
   * Extracts parsed break intervals from working hours record.
   */
  private extractBreaks(hoursRecord: any): Array<{ start: number; end: number; name?: string }> {
    const breaks: Array<{ start: number; end: number; name?: string }> = [];

    if (hoursRecord.breaks) {
      try {
        const rawBreaks = Array.isArray(hoursRecord.breaks)
          ? hoursRecord.breaks
          : JSON.parse(hoursRecord.breaks as string);

        for (const b of rawBreaks) {
          if (b.startTime && b.endTime) {
            breaks.push({
              start: this.parseTimeToMinutes(b.startTime),
              end: this.parseTimeToMinutes(b.endTime),
              name: b.name,
            });
          }
        }
      } catch {
        // Fall back to legacy break fields
      }
    }

    if (breaks.length === 0 && hoursRecord.breakStartTime && hoursRecord.breakEndTime) {
      breaks.push({
        start: this.parseTimeToMinutes(hoursRecord.breakStartTime),
        end: this.parseTimeToMinutes(hoursRecord.breakEndTime),
        name: 'Lunch Break',
      });
    }

    return breaks;
  }

  /**
   * Formats a concise, customer-friendly status description for WhatsApp interactive rows and public web badges.
   * Ensures the text remains within WhatsApp's 72-character limit.
   */
  public formatCustomerStatusText(status: StylistOperationalStatus, role?: string): string {
    const baseRole = (role || 'Specialist').trim();

    let statusSuffix = '';
    switch (status) {
      case StylistOperationalStatus.AVAILABLE:
        statusSuffix = '🟢 Available';
        break;
      case StylistOperationalStatus.WORKING:
        statusSuffix = '✂️ In chair (Next slots open)';
        break;
      case StylistOperationalStatus.ON_BREAK:
        statusSuffix = '☕ On break (Resuming soon)';
        break;
      case StylistOperationalStatus.ON_LEAVE:
        statusSuffix = '🏖️ On leave today';
        break;
      case StylistOperationalStatus.WEEKLY_OFF:
        statusSuffix = '💤 Weekly off today';
        break;
      case StylistOperationalStatus.SALON_OFF:
        statusSuffix = '🔒 Salon closed';
        break;
      case StylistOperationalStatus.INACTIVE:
        statusSuffix = 'Unavailable';
        break;
      default:
        statusSuffix = 'Available';
    }

    const combined = baseRole ? `${baseRole} · ${statusSuffix}` : statusSuffix;
    if (combined.length <= 72) {
      return combined;
    }
    return statusSuffix.slice(0, 72);
  }
}
