import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { DayOfWeek } from '@prisma/client';
import * as crypto from 'crypto';
import { UpdateSalonWorkingHoursDto } from '../dto/update-salon-working-hours.dto';
import { WorkingHoursPropagationEngine } from './working-hours-propagation.engine';
import { AppointmentsService } from '../../appointments/appointments.service';

const DAY_ORDER: Record<DayOfWeek, number> = {
  MONDAY: 1,
  TUESDAY: 2,
  WEDNESDAY: 3,
  THURSDAY: 4,
  FRIDAY: 5,
  SATURDAY: 6,
  SUNDAY: 7,
};

@Injectable()
export class SalonWorkingHoursService {
  private readonly logger = new Logger(SalonWorkingHoursService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly propagationEngine: WorkingHoursPropagationEngine,
    private readonly appointmentsService: AppointmentsService,
  ) {}

  private hashToSignedInt32(input: string): number {
    return crypto.createHash('sha256').update(input).digest().readInt32BE(0);
  }

  /**
   * Retrieves all 7 operating days of the salon facility,
   * enriched with routine facility breaks and active scheduled stylist counts.
   */
  async getSalonWorkingHours(salonId: string) {
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
    });
    if (!salon) {
      throw new NotFoundException('Salon not found.');
    }

    const [hours, breaks, staffHours] = await Promise.all([
      this.prisma.salonWorkingHours.findMany({
        where: { salonId },
      }),
      this.prisma.salonBreak.findMany({
        where: { salonId },
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      }),
      this.prisma.stylistWorkingHours.findMany({
        where: {
          salonId,
          stylist: { status: 'ACTIVE' },
          isWorking: true,
        },
        select: {
          dayOfWeek: true,
          stylistId: true,
        },
      }),
    ]);

    // Count active stylists scheduled per day
    const activeStaffPerDay = new Map<DayOfWeek, number>();
    for (const sh of staffHours) {
      activeStaffPerDay.set(
        sh.dayOfWeek,
        (activeStaffPerDay.get(sh.dayOfWeek) || 0) + 1,
      );
    }

    const sortedHours = hours.sort(
      (a, b) => (DAY_ORDER[a.dayOfWeek] || 0) - (DAY_ORDER[b.dayOfWeek] || 0),
    );

    return sortedHours.map((h) => ({
      id: h.id,
      salonId: h.salonId,
      dayOfWeek: h.dayOfWeek,
      isClosed: h.isClosed,
      startTime: h.startTime,
      endTime: h.endTime,
      activeStaffCount: activeStaffPerDay.get(h.dayOfWeek) || 0,
      breaks: breaks
        .filter((b) => b.dayOfWeek === h.dayOfWeek)
        .map((b) => ({
          id: b.id,
          title: b.title,
          startTime: b.startTime,
          endTime: b.endTime,
        })),
      createdAt: h.createdAt,
      updatedAt: h.updatedAt,
    }));
  }

  /**
   * Updates salon facility operating hours,
   * enforces the facility boundary, and synchronizes uncustomized staff shifts.
   */
  async updateSalonWorkingHours(salonId: string, dto: UpdateSalonWorkingHoursDto) {
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
    });
    if (!salon) {
      throw new NotFoundException('Salon not found.');
    }

    // 1. Fetch current existing working hours to merge partial updates & detect diffs
    const existingHours = await this.prisma.salonWorkingHours.findMany({
      where: { salonId },
    });
    const existingMap = new Map(existingHours.map((h) => [h.dayOfWeek, h]));

    // 2. Validate & normalize incoming days (merge omitted fields with existing values)
    const normalizedDaysToUpdate: Array<{
      dayOfWeek: DayOfWeek;
      isClosed: boolean;
      startTime: string;
      endTime: string;
      hasChanged: boolean;
    }> = [];

    for (const item of dto.hours) {
      const current = existingMap.get(item.dayOfWeek);

      const isClosed =
        item.isClosed !== undefined
          ? item.isClosed
          : item.isOpen !== undefined
          ? !item.isOpen
          : (current?.isClosed ?? false);

      const startTime = item.startTime || current?.startTime || '09:00';
      const endTime = item.endTime || current?.endTime || '21:00';

      if (!isClosed && startTime >= endTime) {
        throw new BadRequestException(
          `Shift start time (${startTime}) must be earlier than shift end time (${endTime}) on ${item.dayOfWeek}.`,
        );
      }

      const hasChanged =
        !current ||
        current.isClosed !== isClosed ||
        current.startTime !== startTime ||
        current.endTime !== endTime;

      normalizedDaysToUpdate.push({
        dayOfWeek: item.dayOfWeek,
        isClosed,
        startTime,
        endTime,
        hasChanged,
      });
    }

    const lockKey = this.hashToSignedInt32(`salon_hours_${salonId}`);

    // 3. Fast Atomic Database Transaction (Persists hours & staff propagation in < 20ms)
    const { updatedHoursList, propagationResult, changedDaysForConflict } =
      await this.prisma.$transaction(
        async (tx) => {
          // Acquire advisory lock
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

          const updatedList: any[] = [];
          const changedList: typeof normalizedDaysToUpdate = [];

          for (const item of normalizedDaysToUpdate) {
            const updated = await tx.salonWorkingHours.upsert({
              where: {
                salonId_dayOfWeek: {
                  salonId,
                  dayOfWeek: item.dayOfWeek,
                },
              },
              create: {
                salonId,
                dayOfWeek: item.dayOfWeek,
                isClosed: item.isClosed,
                startTime: item.startTime,
                endTime: item.endTime,
              },
              update: {
                isClosed: item.isClosed,
                startTime: item.startTime,
                endTime: item.endTime,
              },
            });

            updatedList.push(updated);

            if (item.hasChanged) {
              changedList.push(item);
            }
          }

          // Cascade & propagate to staff members ONLY for the updated days
          const propResult =
            await this.propagationEngine.propagateSalonHoursToStylists(
              tx,
              salonId,
              updatedList,
            );

          return {
            updatedHoursList: updatedList,
            propagationResult: propResult,
            changedDaysForConflict: changedList,
          };
        },
        { maxWait: 10000, timeout: 20000 },
      );

    // 4. Emit real-time update event after transaction commit
    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      salonId,
      action: 'SALON_HOURS_UPDATED',
      updatedDays: updatedHoursList.map((h) => h.dayOfWeek),
      propagationResult,
    });

    // 5. Conflict Resolution OUTSIDE transaction: single batch call for all changed days!
    let totalAffected = 0;
    let totalRescheduled = 0;

    if (changedDaysForConflict.length > 0) {
      try {
        const res = await this.appointmentsService.resolveScheduleConflicts({
          salonId,
          scope: 'SALON',
          daysConfig: changedDaysForConflict.map((item) => ({
            dayOfWeek: item.dayOfWeek,
            startTime: item.startTime,
            endTime: item.endTime,
            isClosedOrOff: item.isClosed,
          })),
          reason: 'Salon facility hours updated',
        });
        totalAffected = res.totalAffected;
        totalRescheduled = res.rescheduledCount;
      } catch (conflictErr: any) {
        this.logger.error(
          `[ConflictResolver] Error resolving schedule conflicts: ${conflictErr.message}`,
          conflictErr.stack,
        );
      }
    }

    const statusMsg =
      totalAffected > 0
        ? `Salon facility hours updated. ${totalAffected} active booking(s) automatically sent reschedule request via WhatsApp.`
        : 'Salon facility operating hours updated successfully.';

    // 6. Return complete fresh 7-day schedule with activeStaffCount & breaks
    const allWorkingHours = await this.getSalonWorkingHours(salonId);

    return {
      success: true,
      message: statusMsg,
      hours: allWorkingHours,
      propagationResult,
      affectedBookingsCount: totalAffected,
      rescheduledCount: totalRescheduled,
    };
  }
}
