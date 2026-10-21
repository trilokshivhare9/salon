import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../../database/prisma.service';
import { TimeUtility } from '../../../../../common/utils/time.utility';
import { AbsenceStatus, LeaveType } from '@prisma/client';
import { ApplyLeaveDto } from '../dto/apply-leave.dto';
import { LeaveEdgeCaseEngine } from '../engines/leave-edge-case.engine';
import { AppointmentsService } from '../../../appointments/appointments.service';

@Injectable()
export class ApplyLeaveService {
  private readonly logger = new Logger(ApplyLeaveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly edgeCaseEngine: LeaveEdgeCaseEngine,
    private readonly appointmentsService: AppointmentsService,
  ) {}

  /**
   * Applies staff leave cleanly and delegates conflict resolution
   * to the centralized schedule conflict engine (auto-rescheduling via WhatsApp).
   */
  async applyLeave(
    salonId: string,
    stylistId: string,
    dto: ApplyLeaveDto,
    adminId?: string,
  ) {
    const startDateStr = dto.startDate || dto.date;
    const endDateStr = dto.endDate || dto.date || startDateStr;

    const isPartial = Boolean(dto.isPartialDay);
    const sTime = isPartial ? (dto.startTime || null) : null;
    const eTime = isPartial ? (dto.endTime || null) : null;

    // 1. Run Complete Edge-Case Validation (Closures, Duplicate Overlaps, Shift Boundaries)
    const { stylist, startDateParsed, endDateParsed } =
      await this.edgeCaseEngine.validateLeaveApplication(salonId, stylistId, {
        startDateStr: startDateStr!,
        endDateStr: endDateStr!,
        isPartialDay: isPartial,
        startTime: sTime || undefined,
        endTime: eTime || undefined,
      });

    const leaveType = dto.leaveType || LeaveType.SICK_LEAVE;
    const startDateObj = TimeUtility.toDbDate(startDateParsed.toISODate()!);
    const endDateObj = TimeUtility.toDbDate(endDateParsed.toISODate()!);

    // 2. Persist Leave Record
    const createdLeave = await this.prisma.stylistAbsence.create({
      data: {
        salonId,
        stylistId,
        startDate: startDateObj,
        endDate: endDateObj,
        isPartialDay: isPartial,
        startTime: sTime,
        endTime: eTime,
        leaveType,
        reason: dto.reason || null,
        notes: dto.notes || null,
        status: AbsenceStatus.ACTIVE,
        createdByAdminId: adminId || null,
      },
      include: {
        stylist: { select: { id: true, name: true } },
      },
    });

    // 3. Resolve active conflicting appointments using Centralized Engine
    const resolution = await this.appointmentsService.resolveScheduleConflicts({
      salonId,
      scope: 'STYLIST',
      stylistId,
      dateRange: {
        startDate: startDateObj,
        endDate: endDateObj,
        startTime: sTime || undefined,
        endTime: eTime || undefined,
        isPartialDay: isPartial,
      },
      isClosedOrOff: true,
      reason: `Staff Leave: ${dto.reason || 'Staff absence'}`,
      adminId,
    });

    // 4. Emit Real-time Salon Events
    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      staffId: stylistId,
      action: 'ABSENCE_MARKED',
      absenceId: createdLeave.id,
    });

    return {
      absence: {
        ...createdLeave,
        statusKey: 'ON_LEAVE',
        statusTitle: '🟢 On Leave',
        isPast: false,
        canCancel: true,
      },
      rescheduledBookings: resolution.details,
      message: resolution.details.length > 0
        ? `Leave applied for ${stylist.name}. ${resolution.details.length} booking(s) sent for reschedule via WhatsApp.`
        : `Leave applied successfully for ${stylist.name}.`,
    };
  }
}
