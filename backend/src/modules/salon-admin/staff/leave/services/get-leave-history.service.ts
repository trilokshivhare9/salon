import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../../database/prisma.service';
import { AbsenceStatus } from '@prisma/client';
import { DateTime } from 'luxon';
import { LeaveHistoryQueryDto } from '../dto/leave-history-query.dto';

@Injectable()
export class GetLeaveHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves leave history records for a specialist.
   * Standardizes response to strictly:
   * - statusKey: "ON_LEAVE" | "CANCELLED"
   * - statusTitle: "🟢 On Leave" | "❌ Cancelled"
   * - isPast: boolean (true if endDate < today in salon timezone)
   * - canCancel: boolean (true if active and not in past)
   */
  async getLeaveHistory(
    salonId: string,
    stylistId: string,
    query?: LeaveHistoryQueryDto,
  ) {
    const whereClause: any = {
      salonId,
      stylistId,
    };

    if (query?.startDate || query?.endDate) {
      const filterStart = query.startDate
        ? new Date(`${query.startDate}T00:00:00.000Z`)
        : new Date('1970-01-01T00:00:00.000Z');
      const filterEnd = query.endDate
        ? new Date(`${query.endDate}T23:59:59.999Z`)
        : new Date('2099-12-31T23:59:59.999Z');

      whereClause.OR = [
        {
          AND: [
            { startDate: { lte: filterEnd } },
            { endDate: { gte: filterStart } },
          ],
        },
        {
          absenceDate: { gte: filterStart, lte: filterEnd },
        },
      ];
    }

    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: { timezone: true },
    });
    const timezone = salon?.timezone || 'Asia/Kolkata';
    const todayInSalon = DateTime.now().setZone(timezone).startOf('day');

    const absences = await this.prisma.stylistAbsence.findMany({
      where: whereClause,
      include: {
        reassignments: {
          include: {
            appointment: {
              select: {
                id: true,
                appointmentNumber: true,
                serviceNameSnapshot: true,
                startAt: true,
                endAt: true,
                status: true,
                salonUser: {
                  include: {
                    user: { select: { name: true, phone: true } },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return absences.map((ab) => {
      const eDate = ab.endDate || ab.absenceDate;
      const eIso = eDate ? eDate.toISOString().split('T')[0] : '';
      const eParsed = DateTime.fromISO(eIso, { zone: timezone }).startOf('day');
      const isPast = eParsed < todayInSalon;
      const isCancelled = ab.status === AbsenceStatus.CANCELLED;

      const statusKey = isCancelled ? 'CANCELLED' : 'ON_LEAVE';
      const statusTitle = isCancelled ? '❌ Cancelled' : '🟢 On Leave';

      return {
        ...ab,
        statusKey,
        statusTitle,
        isPast,
        canCancel: !isCancelled && !isPast,
      };
    });
  }
}
