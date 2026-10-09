import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../../../database/prisma.service';
import { DateTime } from 'luxon';
import { TimeUtility } from '../../../../../common/utils/time.utility';
import { LeavePortion, AppointmentStatus } from '@prisma/client';
import { PreviewLeaveQueryDto } from '../dto/preview-leave.dto';
import { LeaveIntervalEngine } from '../engines/leave-interval.engine';
import { LeaveReassignmentEngine } from '../engines/leave-reassignment.engine';
import { LeaveEdgeCaseEngine } from '../engines/leave-edge-case.engine';

@Injectable()
export class PreviewLeaveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly edgeCaseEngine: LeaveEdgeCaseEngine,
    private readonly intervalEngine: LeaveIntervalEngine,
    private readonly reassignmentEngine: LeaveReassignmentEngine,
  ) {}

  /**
   * Dry-run preview of leave impact across dates without database mutations.
   * Identifies:
   * 1. Total affected bookings.
   * 2. Feasible peer reassignments.
   * 3. Unresolvable bookings (including clients currently in chair or no peer capacity).
   */
  async previewLeaveImpact(
    salonId: string,
    stylistId: string,
    query: PreviewLeaveQueryDto,
  ) {
    const startDateStr = query.startDate || query.date;
    const endDateStr = query.endDate || query.date || startDateStr;

    if (!startDateStr || !endDateStr) {
      throw new BadRequestException('Start date and end date must be provided.');
    }

    const { timezone, stylist, validDates } = await this.edgeCaseEngine.validateLeaveApplication(
      salonId,
      stylistId,
      {
        startDateStr,
        endDateStr,
        customStartTime: query.customStartTime,
        customEndTime: query.customEndTime,
      },
    );

    const leavePortion = query.leavePortion || LeavePortion.FULL_DAY;
    const candidatePreview: any[] = [];
    const followsSalon = stylist.followsSalonSchedule ?? true;

    for (const dateDt of validDates) {
      const dateStr = dateDt.toISODate()!;
      const dateObj = TimeUtility.toDbDate(dateStr);
      const dayOfWeek = this.edgeCaseEngine.getDayOfWeekEnum(dateDt);

      const schedule = await this.intervalEngine.resolveDaySchedule(
        this.prisma,
        salonId,
        stylistId,
        followsSalon,
        dayOfWeek,
      );

      const blockedInterval = this.intervalEngine.getLeaveBlockedMinutes(
        leavePortion,
        query.customStartTime,
        query.customEndTime,
        schedule,
      );

      if (!blockedInterval) continue;

      const apptsOnDate = await this.prisma.appointment.findMany({
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
          const serviceIds =
            appt.services && appt.services.length > 0
              ? appt.services.map((s: any) => s.serviceId)
              : [appt.serviceId];

          const isInChair =
            appt.status === AppointmentStatus.CHECKED_IN ||
            appt.status === AppointmentStatus.SEATED_IN_CHAIR;

          // In-chair services cannot be auto-reassigned mid-service
          let replacementId: string | null = null;
          if (!isInChair) {
            replacementId = await this.reassignmentEngine.findReplacementStylistCandidate(
              this.prisma,
              salonId,
              dateObj,
              serviceIds,
              appt.startAt,
              appt.endAt,
              stylistId,
              timezone,
            );
          }

          candidatePreview.push({
            appointmentId: appt.id,
            appointmentNumber: appt.appointmentNumber,
            date: dateStr,
            startAt: appt.startAt,
            endAt: appt.endAt,
            customerName: appt.salonUser?.user?.name || 'Customer',
            customerPhone: appt.salonUser?.user?.phone,
            serviceName: appt.serviceNameSnapshot,
            status: appt.status,
            isInChair,
            canReassign: !!replacementId,
            suggestedReplacementStylistId: replacementId,
          });
        }
      }
    }

    const reassignable = candidatePreview.filter((c) => c.canReassign).length;
    const unresolvable = candidatePreview.filter((c) => !c.canReassign).length;

    return {
      stylistId,
      stylistName: stylist.name,
      totalAffected: candidatePreview.length,
      reassignable,
      unresolvable,
      appointments: candidatePreview,
    };
  }
}
