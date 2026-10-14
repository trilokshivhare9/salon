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

    // Validation
    for (const item of dto.hours) {
      const isClosed =
        item.isClosed !== undefined
          ? item.isClosed
          : item.isOpen !== undefined
          ? !item.isOpen
          : false;

      if (!isClosed && item.startTime >= item.endTime) {
        throw new BadRequestException(
          `Shift start time (${item.startTime}) must be earlier than shift end time (${item.endTime}) on ${item.dayOfWeek}.`,
        );
      }
    }

    const lockKey = this.hashToSignedInt32(`salon_hours_${salonId}`);

    return this.prisma.$transaction(async (tx) => {
      // 1. Acquire advisory lock
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

      const updatedHoursList: any[] = [];

      for (const item of dto.hours) {
        const isClosed =
          item.isClosed !== undefined
            ? item.isClosed
            : item.isOpen !== undefined
            ? !item.isOpen
            : false;

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
            isClosed,
            startTime: item.startTime,
            endTime: item.endTime,
          },
          update: {
            isClosed,
            startTime: item.startTime,
            endTime: item.endTime,
          },
        });

        updatedHoursList.push(updated);
      }

      // 2. Cascade & propagate to staff members
      const propagationResult = await this.propagationEngine.propagateSalonHoursToStylists(
        tx,
        salonId,
        updatedHoursList,
      );

      // 3. Emit real-time update
      this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
        salonId,
        action: 'SALON_HOURS_UPDATED',
        updatedDays: updatedHoursList.map((h) => h.dayOfWeek),
        propagationResult,
      });

      return {
        success: true,
        message: 'Salon facility operating hours updated successfully.',
        hours: updatedHoursList,
        propagationResult,
      };
    });
  }
}
