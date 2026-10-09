import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../../database/prisma.service';
import { DateTime } from 'luxon';
import { TimeUtility } from '../../../../../common/utils/time.utility';
import {
  ReassignmentOutcome,
  AppointmentStatus,
  LeaveProcessingStatus,
} from '@prisma/client';
import { ExtendLeaveDto } from '../dto/extend-leave.dto';
import { LeaveIntervalEngine } from '../engines/leave-interval.engine';
import { LeaveReassignmentEngine } from '../engines/leave-reassignment.engine';
import { LeaveEdgeCaseEngine } from '../engines/leave-edge-case.engine';
import { LeaveNotificationService } from './leave-notification.service';
import { AppointmentsService } from '../../../appointments/appointments.service';

@Injectable()
export class ExtendLeaveService {
  private readonly logger = new Logger(ExtendLeaveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly intervalEngine: LeaveIntervalEngine,
    private readonly reassignmentEngine: LeaveReassignmentEngine,
    private readonly edgeCaseEngine: LeaveEdgeCaseEngine,
    private readonly notificationService: LeaveNotificationService,
    private readonly appointmentsService: AppointmentsService,
  ) {}

  /**
   * Incremental Leave Extension: Extends endDate and evaluates reassignments strictly for newly added dates.
   */
  async extendLeave(
    salonId: string,
    stylistId: string,
    leaveId: string,
    dto: ExtendLeaveDto,
    adminId?: string,
  ) {
    const existingAbsence = await this.prisma.stylistAbsence.findFirst({
      where: { id: leaveId, salonId, stylistId },
    });
    if (!existingAbsence) {
      throw new NotFoundException('Leave record not found.');
    }

    const { stylist, timezone } = await this.edgeCaseEngine.validateStylistAndSalon(salonId, stylistId);
    const extension = this.edgeCaseEngine.validateLeaveExtension(existingAbsence, dto, timezone);

    const { updatedAbsence, reassignmentsToNotify, summaryDetails } = await this.prisma.$transaction(
      async (tx) => {
        let curr = extension.incrementalStartParsed;
        const incrementalDates: DateTime[] = [];
        while (curr <= extension.newEndDateParsed) {
          incrementalDates.push(curr);
          curr = curr.plus({ days: 1 });
        }

        let newReassigned = 0;
        let newUnresolvable = 0;
        let newAffected = 0;
        const reassignmentsToNotify: string[] = [];
        const summaryDetails: any[] = [];
        const followsSalon = stylist.followsSalonSchedule ?? true;

        for (const dateDt of incrementalDates) {
          const dateStr = dateDt.toISODate()!;
          const dateObj = TimeUtility.toDbDate(dateStr);
          const dayOfWeek = this.edgeCaseEngine.getDayOfWeekEnum(dateDt);

          const schedule = await this.intervalEngine.resolveDaySchedule(
            tx,
            salonId,
            stylistId,
            followsSalon,
            dayOfWeek,
          );

          const blockedInterval = this.intervalEngine.getLeaveBlockedMinutes(
            existingAbsence.leavePortion,
            existingAbsence.customStartTime || undefined,
            existingAbsence.customEndTime || undefined,
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
              newAffected++;

              const isInChair =
                appt.status === AppointmentStatus.CHECKED_IN ||
                appt.status === AppointmentStatus.SEATED_IN_CHAIR;

              const serviceIds =
                appt.services && appt.services.length > 0
                  ? appt.services.map((s: any) => s.serviceId)
                  : [appt.serviceId];

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
                    notes: `${appt.notes || ''} [Reassigned from ${stylist.name} due to extended leave]`.trim(),
                  },
                });

                const reassignment = await tx.bookingReassignment.upsert({
                  where: {
                    appointmentId_absenceId: {
                      appointmentId: appt.id,
                      absenceId: existingAbsence.id,
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
                    absenceId: existingAbsence.id,
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

                newReassigned++;
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
                      absenceId: existingAbsence.id,
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
                    absenceId: existingAbsence.id,
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

                newUnresolvable++;
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

        const updated = await tx.stylistAbsence.update({
          where: { id: leaveId },
          data: {
            endDate: extension.newEndDateObj,
            affectedBookingsCount: existingAbsence.affectedBookingsCount + newAffected,
            reassignedCount: existingAbsence.reassignedCount + newReassigned,
            unresolvableCount: existingAbsence.unresolvableCount + newUnresolvable,
            processingStatus: LeaveProcessingStatus.COMPLETED,
          },
          include: {
            stylist: { select: { id: true, name: true } },
          },
        });

        return {
          updatedAbsence: updated,
          reassignmentsToNotify,
          summaryDetails,
        };
      },
      { timeout: 30000 },
    );

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      staffId: stylistId,
      action: 'ABSENCE_EXTENDED',
      absenceId: leaveId,
    });

    for (const reassignmentId of reassignmentsToNotify) {
      this.notificationService.sendAbsenceNotification(reassignmentId).catch((err) => {
        this.logger.error(`Failed to dispatch notification for extended reassignment ${reassignmentId}: ${err.message}`);
      });
    }

    return {
      absence: {
        ...updatedAbsence,
        statusKey: 'ON_LEAVE',
        statusTitle: '🟢 On Leave',
        isPast: false,
        canCancel: true,
      },
      reassignmentSummary: {
        totalAdded: reassignmentsToNotify.length,
        details: summaryDetails,
      },
    };
  }
}
