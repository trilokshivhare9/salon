import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { GetQueueQueryDto } from './dto/get-queue.dto';
import { QueueResponse, QueueSummary } from './interfaces/queue-response.interface';
import { mapToQueueItem } from './mappers/queue-appointment.mapper';
import { appointmentInclude } from '../utils/appointment-helpers';
import { TimeUtility } from '../../../../common/utils/time.utility';
import { DateTime } from 'luxon';
import { AppointmentStatus, BookingType } from '@prisma/client';

@Injectable()
export class AppointmentQueueService {
  private readonly logger = new Logger(AppointmentQueueService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Fetches paginated operational queue for a given salon and date.
   * Applies operational priority weighting, computes full queue summary metrics,
   * and maps records to the canonical QueueItem model.
   */
  async getQueue(salonId: string, query: GetQueueQueryDto): Promise<QueueResponse> {
    const timezone = await TimeUtility.getSalonTimezone(this.prisma, salonId);

    const targetDate = query.date
      ? DateTime.fromISO(query.date, { zone: timezone })
      : DateTime.now().setZone(timezone);

    const dayStart = targetDate.startOf('day').toJSDate();
    const dayEnd = targetDate.endOf('day').toJSDate();

    const targetStylistId = query.stylistId || query.staffId;
    const whereClause: any = {
      salonId,
      OR: [
        { startAt: { gte: dayStart, lte: dayEnd } },
        { proposedStartAt: { gte: dayStart, lte: dayEnd } },
      ],
    };

    if (targetStylistId) {
      whereClause.stylistId = targetStylistId;
    }

    // Query all appointments for target date to compute accurate daily summary counters
    const allAppointments = await this.prisma.appointment.findMany({
      where: whereClause,
      include: appointmentInclude,
      orderBy: { startAt: 'asc' },
    });

    // 1. Calculate Queue Summary Metrics
    const queueSummary: QueueSummary = {
      inChair: 0,
      checkedIn: 0,
      upcoming: 0,
      completed: 0,
      cancelled: 0,
    };

    for (const appt of allAppointments) {
      const st = appt.status;
      if (st === AppointmentStatus.SEATED_IN_CHAIR) {
        queueSummary.inChair++;
      } else if (st === AppointmentStatus.CHECKED_IN || st === AppointmentStatus.ON_THE_WAY) {
        queueSummary.checkedIn++;
      } else if (
        st === AppointmentStatus.CONFIRMED ||
        st === AppointmentStatus.BOOKED ||
        st === AppointmentStatus.PENDING_ACCEPTANCE ||
        st === AppointmentStatus.PENDING_RESCHEDULE
      ) {
        queueSummary.upcoming++;
      } else if (st === AppointmentStatus.COMPLETED) {
        queueSummary.completed++;
      } else if (st === AppointmentStatus.CANCELLED || st === AppointmentStatus.REJECTED) {
        queueSummary.cancelled++;
      }
    }

    // 2. Filter by status if specified and not 'ALL'
    let filtered = allAppointments;
    if (query.status && query.status.toUpperCase() !== 'ALL') {
      const filterKey = query.status.toUpperCase();
      if (filterKey === 'IN_PROGRESS' || filterKey === 'SEATED_IN_CHAIR') {
        filtered = filtered.filter((a) => a.status === AppointmentStatus.SEATED_IN_CHAIR);
      } else if (filterKey === 'CHECKED_IN') {
        filtered = filtered.filter(
          (a) => a.status === AppointmentStatus.CHECKED_IN || a.status === AppointmentStatus.ON_THE_WAY,
        );
      } else if (filterKey === 'CONFIRMED') {
        filtered = filtered.filter(
          (a) => a.status === AppointmentStatus.CONFIRMED || a.status === AppointmentStatus.BOOKED,
        );
      } else if (filterKey === 'WAITLIST' || filterKey === 'QUICK') {
        filtered = filtered.filter((a) => a.bookingType === BookingType.QUICK);
      } else if (filterKey === 'COMPLETED') {
        filtered = filtered.filter((a) => a.status === AppointmentStatus.COMPLETED);
      } else if (filterKey === 'CANCELLED') {
        filtered = filtered.filter(
          (a) => a.status === AppointmentStatus.CANCELLED || a.status === AppointmentStatus.REJECTED,
        );
      } else {
        filtered = filtered.filter((a) => String(a.status) === filterKey);
      }
    }

    // 3. Operational Priority Sorting:
    // Tier 1: In Chair (SEATED_IN_CHAIR)
    // Tier 2: Checked In / Lobby (CHECKED_IN)
    // Tier 3: Traveling / En Route (ON_THE_WAY)
    // Tier 4: Confirmed upcoming (CONFIRMED)
    // Tier 5: Booked upcoming (BOOKED)
    // Tier 6: Pending Acceptance (PENDING_ACCEPTANCE)
    // Tier 7: Pending Reschedule (PENDING_RESCHEDULE)
    // Tier 8: Finished (COMPLETED)
    // Tier 9: Cancelled / Rejected (CANCELLED, REJECTED)
    const STATUS_PRIORITY_WEIGHT: Record<string, number> = {
      SEATED_IN_CHAIR: 1,
      CHECKED_IN: 2,
      ON_THE_WAY: 3,
      CONFIRMED: 4,
      BOOKED: 5,
      PENDING_ACCEPTANCE: 6,
      PENDING_RESCHEDULE: 7,
      COMPLETED: 8,
      CANCELLED: 9,
      REJECTED: 10,
    };

    filtered.sort((a, b) => {
      const weightA = STATUS_PRIORITY_WEIGHT[a.status] || 99;
      const weightB = STATUS_PRIORITY_WEIGHT[b.status] || 99;
      if (weightA !== weightB) return weightA - weightB;

      const timeA = a.startAt ? new Date(a.startAt).getTime() : 0;
      const timeB = b.startAt ? new Date(b.startAt).getTime() : 0;
      if (timeA !== timeB) return timeA - timeB;

      return String(a.id).localeCompare(String(b.id));
    });

    // 4. Pagination
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 25));
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / limit) || 1;
    const startIndex = (page - 1) * limit;
    const pagedAppointments = filtered.slice(startIndex, startIndex + limit);

    // 5. Map to Canonical Model
    const items = pagedAppointments.map((appt) => mapToQueueItem(appt));

    return {
      success: true,
      data: {
        items,
        pagination: {
          page,
          limit,
          totalItems,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        queueSummary,
      },
    };
  }
}
