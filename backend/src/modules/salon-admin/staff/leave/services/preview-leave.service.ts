import { Injectable, BadRequestException } from '@nestjs/common';
import { TimeUtility } from '../../../../../common/utils/time.utility';
import { LeavePortion } from '@prisma/client';
import { PreviewLeaveQueryDto } from '../dto/preview-leave.dto';
import { LeaveEdgeCaseEngine } from '../engines/leave-edge-case.engine';
import { AppointmentsService } from '../../../appointments/appointments.service';

@Injectable()
export class PreviewLeaveService {
  constructor(
    private readonly edgeCaseEngine: LeaveEdgeCaseEngine,
    private readonly appointmentsService: AppointmentsService,
  ) {}

  /**
   * Dry-run preview of leave impact across dates using centralized conflict engine.
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

    await this.edgeCaseEngine.validateLeaveApplication(
      salonId,
      stylistId,
      {
        startDateStr,
        endDateStr,
        customStartTime: query.customStartTime,
        customEndTime: query.customEndTime,
      },
    );

    const startDateObj = TimeUtility.toDbDate(startDateStr);
    const endDateObj = TimeUtility.toDbDate(endDateStr);
    const leavePortion = query.leavePortion || LeavePortion.FULL_DAY;

    const conflicts = await (this.appointmentsService as any).conflictEngine?.findConflictingAppointments?.({
      salonId,
      scope: 'STYLIST',
      stylistId,
      dateRange: {
        startDate: startDateObj,
        endDate: endDateObj,
        startTime: query.customStartTime,
        endTime: query.customEndTime,
        isPartialDay: leavePortion !== LeavePortion.FULL_DAY,
      },
      isClosedOrOff: true,
    }) || [];

    return {
      conflicts,
    };
  }
}
