import { Injectable, BadRequestException } from '@nestjs/common';
import { TimeUtility } from '../../../../../common/utils/time.utility';
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

    const isPartial = Boolean(query.isPartialDay);
    const sTime = isPartial ? (query.startTime || null) : null;
    const eTime = isPartial ? (query.endTime || null) : null;

    await this.edgeCaseEngine.validateLeaveApplication(
      salonId,
      stylistId,
      {
        startDateStr,
        endDateStr,
        isPartialDay: isPartial,
        startTime: sTime || undefined,
        endTime: eTime || undefined,
      },
    );

    const startDateObj = TimeUtility.toDbDate(startDateStr);
    const endDateObj = TimeUtility.toDbDate(endDateStr);

    const conflicts = await this.appointmentsService.findConflictingAppointments({
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
    });

    return {
      conflicts,
    };
  }
}

