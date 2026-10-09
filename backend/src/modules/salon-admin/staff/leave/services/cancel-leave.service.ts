import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../../../database/prisma.service';
import { AbsenceStatus } from '@prisma/client';
import { DateTime } from 'luxon';
import { AppointmentsService } from '../../../appointments/appointments.service';

@Injectable()
export class CancelLeaveService {
  private readonly logger = new Logger(CancelLeaveService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly appointmentsService: AppointmentsService,
  ) {}

  /**
   * Cancels/reverses a leave record.
   * Strictly validates:
   * 1. Cannot cancel an already cancelled leave.
   * 2. Cannot cancel a leave whose dates have already passed (protecting historical roster & completed appointments).
   */
  async cancelLeave(
    salonId: string,
    stylistId: string,
    leaveId: string,
    adminId?: string,
  ) {
    const absence = await this.prisma.stylistAbsence.findFirst({
      where: { id: leaveId, salonId, stylistId },
      include: { stylist: { select: { id: true, name: true } } },
    });
    if (!absence) {
      throw new NotFoundException('Leave record not found.');
    }

    if (absence.status === AbsenceStatus.CANCELLED) {
      throw new BadRequestException('This leave has already been cancelled.');
    }

    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: { timezone: true },
    });
    const timezone = salon?.timezone || 'Asia/Kolkata';
    const todayInSalon = DateTime.now().setZone(timezone).startOf('day');

    const leaveEndDate = absence.endDate || absence.absenceDate;
    const leaveEndIso = leaveEndDate ? leaveEndDate.toISOString().split('T')[0] : '';
    const leaveEndParsed = DateTime.fromISO(leaveEndIso, { zone: timezone }).startOf('day');

    if (leaveEndParsed < todayInSalon) {
      throw new BadRequestException('Cannot cancel a leave that has already passed.');
    }

    const updated = await this.prisma.stylistAbsence.update({
      where: { id: leaveId },
      data: { status: AbsenceStatus.CANCELLED },
      include: { stylist: { select: { id: true, name: true } } },
    });

    await this.prisma.auditLog.create({
      data: {
        salonId,
        adminId: adminId || null,
        action: 'CANCEL_STYLIST_LEAVE',
        entityType: 'StylistAbsence',
        entityId: leaveId,
        metadata: { stylistId, stylistName: updated.stylist?.name },
      },
    }).catch((err) => {
      this.logger.warn(`AuditLog creation failed: ${err.message}`);
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      staffId: stylistId,
      action: 'ABSENCE_CANCELLED',
      absenceId: leaveId,
    });

    return {
      ...updated,
      statusKey: 'CANCELLED',
      statusTitle: '❌ Cancelled',
      isPast: false,
      canCancel: false,
    };
  }
}
