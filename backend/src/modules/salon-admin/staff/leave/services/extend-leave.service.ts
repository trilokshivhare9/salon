import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../../database/prisma.service';
import { TimeUtility } from '../../../../../common/utils/time.utility';
import { ExtendLeaveDto } from '../dto/extend-leave.dto';
import { LeaveEdgeCaseEngine } from '../engines/leave-edge-case.engine';
import { AppointmentsService } from '../../../appointments/appointments.service';

@Injectable()
export class ExtendLeaveService {
  private readonly logger = new Logger(ExtendLeaveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly edgeCaseEngine: LeaveEdgeCaseEngine,
    private readonly appointmentsService: AppointmentsService,
  ) {}

  /**
   * Incremental Leave Extension: Extends endDate and delegates newly added dates
   * to the centralized schedule conflict engine.
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

    const newEndDateObj = TimeUtility.toDbDate(extension.newEndDateParsed.toISODate()!);
    const incrementalStartObj = TimeUtility.toDbDate(extension.incrementalStartParsed.toISODate()!);

    // 1. Update absence record in DB
    const updatedAbsence = await this.prisma.stylistAbsence.update({
      where: { id: leaveId },
      data: {
        endDate: newEndDateObj,
        notes: dto.notes ? `${existingAbsence.notes ? existingAbsence.notes + ' | ' : ''}${dto.notes}` : existingAbsence.notes,
      },
      include: {
        stylist: { select: { id: true, name: true } },
      },
    });

    // 2. Resolve conflicts for the newly extended date range using Centralized Engine
    const resolution = await this.appointmentsService.resolveScheduleConflicts({
      salonId,
      scope: 'STYLIST',
      stylistId,
      dateRange: {
        startDate: incrementalStartObj,
        endDate: newEndDateObj,
        isPartialDay: false,
      },
      isClosedOrOff: true,
      reason: `Staff Leave Extended: ${dto.reason || 'Leave extension'}`,
      adminId,
    });

    // 3. Emit Real-time Salon Events
    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      staffId: stylistId,
      action: 'ABSENCE_EXTENDED',
      absenceId: updatedAbsence.id,
    });

    return {
      absence: {
        ...updatedAbsence,
        statusKey: 'ON_LEAVE',
        statusTitle: '🟢 On Leave',
        isPast: false,
        canCancel: true,
      },
      rescheduledBookings: resolution.details,
      message: resolution.details.length > 0
        ? `Leave extended for ${stylist.name}. ${resolution.details.length} newly impacted booking(s) sent for reschedule via WhatsApp.`
        : `Leave extended successfully for ${stylist.name}.`,
    };
  }
}
