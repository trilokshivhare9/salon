import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { DateTime } from 'luxon';
import { PrismaService } from '../../../database/prisma.service';
import { LeaveIntervalEngine, DayScheduleDetails } from '../engines/leave-interval.engine';
import { LeaveReassignmentEngine } from '../engines/leave-reassignment.engine';
import { MarkAbsentDto, ExtendLeaveDto } from '../dto/absence.dto';
import {
  AbsenceStatus,
  ReassignmentOutcome,
  DayOfWeek,
  AppointmentStatus,
  LeaveType,
  LeavePortion,
  LeaveProcessingStatus,
} from '@prisma/client';

@Injectable()
export class LeaveProcessingService {
  private readonly logger = new Logger(LeaveProcessingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly intervalEngine: LeaveIntervalEngine,
    private readonly reassignmentEngine: LeaveReassignmentEngine,
  ) {}

  private hashToSignedInt32(input: string): number {
    return crypto.createHash('sha256').update(input).digest().readInt32BE(0);
  }

  private getDayOfWeekEnum(luxonDateTime: DateTime): DayOfWeek {
    const dayNumber = luxonDateTime.weekday;
    const mapping: Record<number, DayOfWeek> = {
      1: DayOfWeek.MONDAY,
      2: DayOfWeek.TUESDAY,
      3: DayOfWeek.WEDNESDAY,
      4: DayOfWeek.THURSDAY,
      5: DayOfWeek.FRIDAY,
      6: DayOfWeek.SATURDAY,
      7: DayOfWeek.SUNDAY,
    };
    return mapping[dayNumber];
  }

  /**
   * Resolves working hours & break interval for a stylist on a calendar date.
   */
  async resolveDaySchedule(
    tx: any,
    salonId: string,
    stylistId: string,
    followsSalonSchedule: boolean,
    dayOfWeek: DayOfWeek,
  ): Promise<DayScheduleDetails> {
    const [salonWH, stylistWH] = await Promise.all([
      tx.salonWorkingHours.findFirst({ where: { salonId, dayOfWeek } }),
      tx.stylistWorkingHours.findFirst({ where: { stylistId, dayOfWeek } }),
    ]);

    if (followsSalonSchedule) {
      if (!salonWH || salonWH.isClosed) {
        return { openMin: 0, closeMin: 0, breakInterval: null, isOff: true };
      }
      const openMin = this.intervalEngine.parseTimeStringToMinutes(salonWH.startTime);
      const closeMin = this.intervalEngine.parseTimeStringToMinutes(salonWH.endTime);
      let breakInterval: { start: number; end: number } | null = null;
      if (salonWH.breakStartTime && salonWH.breakEndTime) {
        breakInterval = {
          start: this.intervalEngine.parseTimeStringToMinutes(salonWH.breakStartTime),
          end: this.intervalEngine.parseTimeStringToMinutes(salonWH.breakEndTime),
        };
      }
      return { openMin, closeMin, breakInterval, isOff: false };
    } else {
      if (!stylistWH || !stylistWH.isWorking) {
        return { openMin: 0, closeMin: 0, breakInterval: null, isOff: true };
      }
      const openMin = this.intervalEngine.parseTimeStringToMinutes(stylistWH.startTime);
      const closeMin = this.intervalEngine.parseTimeStringToMinutes(stylistWH.endTime);
      let breakInterval: { start: number; end: number } | null = null;
      if (stylistWH.breakStartTime && stylistWH.breakEndTime) {
        breakInterval = {
          start: this.intervalEngine.parseTimeStringToMinutes(stylistWH.breakStartTime),
          end: this.intervalEngine.parseTimeStringToMinutes(stylistWH.breakEndTime),
        };
      }
      return { openMin, closeMin, breakInterval, isOff: false };
    }
  }

  /**
   * Processes leave creation and auto-reassignments across a date range.
   */
  async processLeaveCreation(
    salonId: string,
    stylistId: string,
    stylist: any,
    dto: MarkAbsentDto,
    normalizedDates: any,
    timezone: string,
    adminId?: string,
  ) {
    const leaveType = dto.leaveType || LeaveType.SICK_LEAVE;
    const leavePortion = dto.leavePortion || LeavePortion.FULL_DAY;

    return this.prisma.$transaction(
      async (tx) => {
        const existingAbsence = await tx.stylistAbsence.findFirst({
          where: {
            salonId,
            stylistId,
            startDate: normalizedDates.startDateObj,
            endDate: normalizedDates.endDateObj,
          },
        });

        let currentAbsence: any;
        if (existingAbsence) {
          currentAbsence = await tx.stylistAbsence.update({
            where: { id: existingAbsence.id },
            data: {
              status: AbsenceStatus.ACTIVE,
              leaveType,
              leavePortion,
              customStartTime: dto.customStartTime || null,
              customEndTime: dto.customEndTime || null,
              reason: dto.reason || null,
              notes: dto.notes || null,
              processingStatus: LeaveProcessingStatus.PROCESSING,
              createdByAdminId: adminId || null,
            },
          });
        } else {
          currentAbsence = await tx.stylistAbsence.create({
            data: {
              salonId,
              stylistId,
              startDate: normalizedDates.startDateObj,
              endDate: normalizedDates.endDateObj,
              absenceDate: normalizedDates.startDateObj,
              leaveType,
              leavePortion,
              customStartTime: dto.customStartTime || null,
              customEndTime: dto.customEndTime || null,
              reason: dto.reason || null,
              notes: dto.notes || null,
              status: AbsenceStatus.ACTIVE,
              processingStatus: LeaveProcessingStatus.PROCESSING,
              createdByAdminId: adminId || null,
            },
          });
        }

        let curr = normalizedDates.startDateParsed;
        const datesList: DateTime[] = [];
        while (curr <= normalizedDates.endDateParsed) {
          datesList.push(curr);
          curr = curr.plus({ days: 1 });
        }

        let reassignedCount = 0;
        let unresolvableCount = 0;
        let totalAffectedBookings = 0;
        const reassignmentsToNotify: string[] = [];
        const summaryDetails: any[] = [];

        const followsSalon = stylist.followsSalonSchedule ?? true;

        for (const dateDt of datesList) {
          const dateStr = dateDt.toISODate()!;
          const dateObj = new Date(`${dateStr}T00:00:00.000Z`);
          const dayOfWeek = this.getDayOfWeekEnum(dateDt);

          const key1 = this.hashToSignedInt32(`salon:${salonId}`);
          const stylistLockKey = this.hashToSignedInt32(`stylist:${stylistId}:${dateStr}`);
          await tx.$executeRawUnsafe(
            'SELECT pg_advisory_xact_lock($1::integer, $2::integer)',
            key1,
            stylistLockKey,
          );

          const schedule = await this.resolveDaySchedule(
            tx,
            salonId,
            stylistId,
            followsSalon,
            dayOfWeek,
          );

          const blockedInterval = this.intervalEngine.getLeaveBlockedMinutes(
            leavePortion,
            dto.customStartTime,
            dto.customEndTime,
            schedule,
          );

          if (!blockedInterval) continue;

          const apptsOnDate = await tx.appointment.findMany({
            where: {
              salonId,
              stylistId,
              appointmentDate: dateObj,
              status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN] },
            },
            include: {
              services: { select: { serviceId: true } },
              salonUser: { include: { user: true } },
            },
            orderBy: { startAt: 'asc' },
          });

          for (const appt of apptsOnDate) {
            const apptStartDt = DateTime.fromJSDate(appt.startAt).setZone(timezone);
            const apptEndDt = DateTime.fromJSDate(appt.endAt).setZone(timezone);
            const apptStartMin = apptStartDt.hour * 60 + apptStartDt.minute;
            const apptEndMin = apptEndDt.hour * 60 + apptEndDt.minute;

            if (this.intervalEngine.isAppointmentOverlappingLeave(apptStartMin, apptEndMin, blockedInterval)) {
              totalAffectedBookings++;

              const serviceIds =
                appt.services && appt.services.length > 0
                  ? appt.services.map((s: any) => s.serviceId)
                  : [appt.serviceId];

              const replacementId = await this.reassignmentEngine.findReplacementStylistCandidate(
                tx,
                salonId,
                dateObj,
                serviceIds,
                appt.startAt,
                appt.endAt,
                stylistId,
                timezone,
              );

              if (replacementId) {
                await tx.appointment.update({
                  where: { id: appt.id },
                  data: {
                    stylistId: replacementId,
                    notes: `${appt.notes || ''} [Reassigned from ${stylist.name} due to leave]`.trim(),
                  },
                });

                const reassignment = await tx.bookingReassignment.upsert({
                  where: {
                    appointmentId_absenceId: {
                      appointmentId: appt.id,
                      absenceId: currentAbsence.id,
                    },
                  },
                  update: {
                    originalStylistId: stylistId,
                    newStylistId: replacementId,
                    originalStartAt: appt.startAt,
                    originalEndAt: appt.endAt,
                    newStartAt: appt.startAt,
                    newEndAt: appt.endAt,
                    outcome: ReassignmentOutcome.AUTO_ASSIGNED,
                    processedAt: new Date(),
                  },
                  create: {
                    salonId,
                    appointmentId: appt.id,
                    absenceId: currentAbsence.id,
                    originalStylistId: stylistId,
                    newStylistId: replacementId,
                    originalStartAt: appt.startAt,
                    originalEndAt: appt.endAt,
                    newStartAt: appt.startAt,
                    newEndAt: appt.endAt,
                    outcome: ReassignmentOutcome.AUTO_ASSIGNED,
                    processedAt: new Date(),
                  },
                });

                reassignedCount++;
                reassignmentsToNotify.push(reassignment.id);
                summaryDetails.push({
                  appointmentId: appt.id,
                  appointmentNumber: appt.appointmentNumber,
                  startAt: appt.startAt,
                  customerName: appt.salonUser?.user?.name || 'Customer',
                  customerPhone: appt.salonUser?.user?.phone,
                  outcome: ReassignmentOutcome.AUTO_ASSIGNED,
                  newStylistId: replacementId,
                });
              } else {
                const reassignment = await tx.bookingReassignment.upsert({
                  where: {
                    appointmentId_absenceId: {
                      appointmentId: appt.id,
                      absenceId: currentAbsence.id,
                    },
                  },
                  update: {
                    originalStylistId: stylistId,
                    newStylistId: null,
                    originalStartAt: appt.startAt,
                    originalEndAt: appt.endAt,
                    newStartAt: null,
                    newEndAt: null,
                    outcome: ReassignmentOutcome.NO_REPLACEMENT,
                    processedAt: new Date(),
                  },
                  create: {
                    salonId,
                    appointmentId: appt.id,
                    absenceId: currentAbsence.id,
                    originalStylistId: stylistId,
                    newStylistId: null,
                    originalStartAt: appt.startAt,
                    originalEndAt: appt.endAt,
                    newStartAt: null,
                    newEndAt: null,
                    outcome: ReassignmentOutcome.NO_REPLACEMENT,
                    processedAt: new Date(),
                  },
                });

                unresolvableCount++;
                reassignmentsToNotify.push(reassignment.id);
                summaryDetails.push({
                  appointmentId: appt.id,
                  appointmentNumber: appt.appointmentNumber,
                  startAt: appt.startAt,
                  customerName: appt.salonUser?.user?.name || 'Customer',
                  customerPhone: appt.salonUser?.user?.phone,
                  outcome: ReassignmentOutcome.NO_REPLACEMENT,
                  newStylistId: null,
                });
              }
            }
          }
        }

        const finalAbsence = await tx.stylistAbsence.update({
          where: { id: currentAbsence.id },
          data: {
            affectedBookingsCount: totalAffectedBookings,
            reassignedCount,
            unresolvableCount,
            processingStatus: LeaveProcessingStatus.COMPLETED,
          },
          include: {
            stylist: { select: { id: true, name: true, phone: true } },
          },
        });

        await tx.auditLog.create({
          data: {
            salonId,
            adminId: adminId || null,
            action: 'MARK_STYLIST_LEAVE',
            entityType: 'StylistAbsence',
            entityId: finalAbsence.id,
            metadata: {
              stylistId,
              stylistName: stylist.name,
              startDate: normalizedDates.startIso,
              endDate: normalizedDates.endIso,
              leaveType,
              leavePortion,
              affectedBookingsCount: totalAffectedBookings,
              reassignedCount,
              unresolvableCount,
            },
          },
        }).catch((err) => {
          this.logger.warn(`AuditLog creation failed: ${err.message}`);
        });

        return {
          absence: finalAbsence,
          reassignmentsToNotify,
          summaryDetails,
        };
      },
      {
        timeout: Math.max(
          30000,
          (Math.ceil(
            (normalizedDates.endDateParsed.toMillis() - normalizedDates.startDateParsed.toMillis()) /
              (24 * 60 * 60 * 1000),
          ) +
            1) *
            3000,
        ),
      },
    );
  }
}
