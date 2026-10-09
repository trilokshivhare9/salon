import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../../../../../database/prisma.service';
import { DateTime } from 'luxon';
import { TimeUtility } from '../../../../../common/utils/time.utility';
import {
  AbsenceStatus,
  ReassignmentOutcome,
  AppointmentStatus,
  LeaveType,
  LeavePortion,
  LeaveProcessingStatus,
} from '@prisma/client';
import { ApplyLeaveDto } from '../dto/apply-leave.dto';
import { LeaveIntervalEngine } from '../engines/leave-interval.engine';
import { LeaveReassignmentEngine } from '../engines/leave-reassignment.engine';
import { LeaveEdgeCaseEngine } from '../engines/leave-edge-case.engine';
import { LeaveNotificationService } from './leave-notification.service';
import { AppointmentsService } from '../../../appointments/appointments.service';

@Injectable()
export class ApplyLeaveService {
  private readonly logger = new Logger(ApplyLeaveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly edgeCaseEngine: LeaveEdgeCaseEngine,
    private readonly intervalEngine: LeaveIntervalEngine,
    private readonly reassignmentEngine: LeaveReassignmentEngine,
    private readonly notificationService: LeaveNotificationService,
    private readonly appointmentsService: AppointmentsService,
  ) {}

  private hashToSignedInt32(input: string): number {
    return crypto.createHash('sha256').update(input).digest().readInt32BE(0);
  }

  /**
   * Applies/records staff leave with comprehensive edge-case validation,
   * in-chair appointment protection, and atomic peer reassignments.
   */
  async applyLeave(
    salonId: string,
    stylistId: string,
    dto: ApplyLeaveDto,
    adminId?: string,
  ) {
    const startDateStr = dto.startDate || dto.date;
    const endDateStr = dto.endDate || dto.date || startDateStr;

    // 1. Run Complete Edge-Case Validation (Closures, Duplicate Overlaps, Shift Boundaries)
    const { timezone, stylist, validDates, startDateParsed, endDateParsed } =
      await this.edgeCaseEngine.validateLeaveApplication(salonId, stylistId, {
        startDateStr: startDateStr!,
        endDateStr: endDateStr!,
        customStartTime: dto.customStartTime,
        customEndTime: dto.customEndTime,
      });

    const leaveType = dto.leaveType || LeaveType.SICK_LEAVE;
    const leavePortion = dto.leavePortion || LeavePortion.FULL_DAY;
    const startDateObj = TimeUtility.toDbDate(startDateParsed.toISODate()!);
    const endDateObj = TimeUtility.toDbDate(endDateParsed.toISODate()!);

    // 2. Atomic Transaction: Leave Record Creation & Peer Reassignments
    const result = await this.prisma.$transaction(
      async (tx) => {
        const createdLeave = await tx.stylistAbsence.create({
          data: {
            salonId,
            stylistId,
            startDate: startDateObj,
            endDate: endDateObj,
            absenceDate: startDateObj,
            leaveType,
            leavePortion,
            customStartTime: dto.customStartTime || null,
            customEndTime: dto.customEndTime || null,
            reason: dto.reason || null,
            notes: dto.notes || null,
            status: AbsenceStatus.ACTIVE,
            processingStatus: LeaveProcessingStatus.COMPLETED,
            createdByAdminId: adminId || null,
          },
        });

        let reassignedCount = 0;
        let unresolvableCount = 0;
        let totalAffectedBookings = 0;
        const reassignmentsToNotify: string[] = [];
        const summaryDetails: any[] = [];
        const followsSalon = stylist.followsSalonSchedule ?? true;

        for (const dateDt of validDates) {
          const dateStr = dateDt.toISODate()!;
          const dateObj = TimeUtility.toDbDate(dateStr);
          const dayOfWeek = this.edgeCaseEngine.getDayOfWeekEnum(dateDt);

          const key1 = this.hashToSignedInt32(`salon:${salonId}`);
          const stylistLockKey = this.hashToSignedInt32(`stylist:${stylistId}:${dateStr}`);
          await tx.$executeRawUnsafe(
            'SELECT pg_advisory_xact_lock($1::integer, $2::integer)',
            key1,
            stylistLockKey,
          );

          const schedule = await this.intervalEngine.resolveDaySchedule(
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
              status: {
                in: [
                  AppointmentStatus.BOOKED,
                  AppointmentStatus.CONFIRMED,
                  AppointmentStatus.ON_THE_WAY,
                  AppointmentStatus.CHECKED_IN,
                  AppointmentStatus.SEATED_IN_CHAIR,
                ],
              },
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

              const isInChair =
                appt.status === AppointmentStatus.CHECKED_IN ||
                appt.status === AppointmentStatus.SEATED_IN_CHAIR;

              const serviceIds =
                appt.services && appt.services.length > 0
                  ? appt.services.map((s: any) => s.serviceId)
                  : [appt.serviceId];

              // In-chair services cannot be auto-reassigned mid-service
              let replacementId: string | null = null;
              if (!isInChair) {
                replacementId = await this.reassignmentEngine.findReplacementStylistCandidate(
                  tx,
                  salonId,
                  dateObj,
                  serviceIds,
                  appt.startAt,
                  appt.endAt,
                  stylistId,
                  timezone,
                );
              }

              if (replacementId) {
                await tx.appointment.update({
                  where: { id: appt.id },
                  data: {
                    stylistId: replacementId,
                    notes: `${appt.notes || ''} [Reassigned from ${stylist.name} due to leave]`.trim(),
                  },
                });

                const reassignment = await tx.bookingReassignment.create({
                  data: {
                    salonId,
                    appointmentId: appt.id,
                    absenceId: createdLeave.id,
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
                await tx.bookingReassignment.create({
                  data: {
                    salonId,
                    appointmentId: appt.id,
                    absenceId: createdLeave.id,
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
                summaryDetails.push({
                  appointmentId: appt.id,
                  appointmentNumber: appt.appointmentNumber,
                  startAt: appt.startAt,
                  customerName: appt.salonUser?.user?.name || 'Customer',
                  customerPhone: appt.salonUser?.user?.phone,
                  outcome: ReassignmentOutcome.NO_REPLACEMENT,
                  newStylistId: null,
                  isInChair,
                });
              }
            }
          }
        }

        const finalLeave = await tx.stylistAbsence.update({
          where: { id: createdLeave.id },
          data: {
            affectedBookingsCount: totalAffectedBookings,
            reassignedCount,
            unresolvableCount,
          },
          include: {
            stylist: { select: { id: true, name: true } },
          },
        });

        return {
          leave: finalLeave,
          reassignmentsToNotify,
          summaryDetails,
        };
      },
      { timeout: 30000 },
    );

    // 3. Emit Real-time Salon Events
    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      staffId: stylistId,
      action: 'ABSENCE_MARKED',
      absenceId: result.leave.id,
    });

    // 4. Dispatch Async Notifications
    for (const reassignmentId of result.reassignmentsToNotify) {
      this.notificationService.sendAbsenceNotification(reassignmentId).catch((err) => {
        this.logger.error(`Notification failed for reassignment ${reassignmentId}: ${err.message}`);
      });
    }

    return {
      absence: {
        ...result.leave,
        statusKey: 'ON_LEAVE',
        statusTitle: '🟢 On Leave',
        isPast: false,
        canCancel: true,
      },
      reassignmentSummary: {
        total: result.leave.affectedBookingsCount,
        reassigned: result.leave.reassignedCount,
        unresolvable: result.leave.unresolvableCount,
        details: result.summaryDetails,
      },
    };
  }
}
