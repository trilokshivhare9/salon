import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AvailabilityService } from '../availability/availability.service';
import {
  CreateAppointmentDto,
  UpdateAppointmentStatusDto,
  RescheduleAppointmentDto,
} from './dto/create-appointment.dto';
import { DateTime } from 'luxon';
import { AppointmentStatus, BookingSource } from '@prisma/client';

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private prisma: PrismaService,
    private availabilityService: AvailabilityService,
  ) {}

  private sanitizePhone(phone: string): string {
    return phone.replace(/[^\d+]/g, '');
  }

  private getLockKey(salonId: string, staffId: string, dateStr: string): number {
    const str = `${salonId}:${staffId}:${dateStr}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // Convert to 32-bit signed integer
    }
    return Math.abs(hash);
  }

  async createAppointment(
    salonId: string,
    dto: CreateAppointmentDto,
    createdByUserId?: string,
  ) {
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
    });

    if (!salon || salon.status !== 'ACTIVE') {
      throw new NotFoundException('Salon is inactive or not found.');
    }

    const timezone = salon.timezone || 'Asia/Kolkata';

    // 1. Verify Availability
    const availability = await this.availabilityService.getAvailableSlots(
      salonId,
      dto.serviceId,
      dto.date,
      dto.staffId,
    );

    const matchingSlot = availability.availableSlots.find(
      (slot) => slot.startTime === dto.startTime,
    );

    if (!matchingSlot || matchingSlot.eligibleStaffIds.length === 0) {
      throw new ConflictException(
        'This slot is no longer available. Please select another time.',
      );
    }

    // 2. Select Staff (either requested staff or auto-assign least loaded staff)
    let assignedStaffId = dto.staffId;
    if (!assignedStaffId || !matchingSlot.eligibleStaffIds.includes(assignedStaffId)) {
      const appointmentCounts = await this.prisma.appointment.groupBy({
        by: ['staffId'],
        where: {
          salonId,
          date: new Date(dto.date),
          staffId: { in: matchingSlot.eligibleStaffIds },
          status: { notIn: ['CANCELLED', 'NO_SHOW', 'RESCHEDULED'] },
        },
        _count: { id: true },
      });

      const countMap = new Map<string, number>();
      matchingSlot.eligibleStaffIds.forEach((id) => countMap.set(id, 0));
      appointmentCounts.forEach((c) => countMap.set(c.staffId, c._count.id));

      const sortedStaff = matchingSlot.eligibleStaffIds.sort(
        (a, b) => (countMap.get(a) || 0) - (countMap.get(b) || 0),
      );
      assignedStaffId = sortedStaff[0];
    }

    const service = await this.prisma.service.findUnique({
      where: { id: dto.serviceId },
    });

    if (!service) {
      throw new NotFoundException('Service not found.');
    }

    const [startH, startM] = dto.startTime.split(':').map((v) => parseInt(v, 10));
    const startDt = DateTime.fromISO(dto.date, { zone: timezone }).set({
      hour: startH,
      minute: startM,
      second: 0,
      millisecond: 0,
    });
    const endDt = startDt.plus({ minutes: service.durationMinutes });

    const cleanPhone = this.sanitizePhone(dto.customerPhone);
    const lockKey = this.getLockKey(salonId, assignedStaffId, dto.date);

    // 3. Atomic Database Insertion with PostgreSQL Advisory Lock & GiST Protection
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          // Acquire Transaction-Level Advisory Lock for this staff and date
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;

          // Re-verify availability inside the lock boundary
          const conflict = await tx.appointment.findFirst({
            where: {
              staffId: assignedStaffId,
              status: { notIn: ['CANCELLED', 'NO_SHOW', 'RESCHEDULED'] },
              OR: [
                {
                  startTime: { lte: startDt.toUTC().toJSDate() },
                  endTime: { gt: startDt.toUTC().toJSDate() },
                },
                {
                  startTime: { lt: endDt.toUTC().toJSDate() },
                  endTime: { gte: endDt.toUTC().toJSDate() },
                },
                {
                  startTime: { gte: startDt.toUTC().toJSDate() },
                  endTime: { lte: endDt.toUTC().toJSDate() },
                },
              ],
            },
          });

          if (conflict) {
            throw new ConflictException(
              'This slot was just booked by another customer. Please select another time.',
            );
          }

          // Upsert Customer
          let customer = await tx.customer.findUnique({
            where: {
              salonId_phone: {
                salonId,
                phone: cleanPhone,
              },
            },
          });

          if (!customer) {
            customer = await tx.customer.create({
              data: {
                salonId,
                name: dto.customerName,
                phone: cleanPhone,
                email: dto.customerEmail,
              },
            });
          } else {
            customer = await tx.customer.update({
              where: { id: customer.id },
              data: {
                name: dto.customerName,
                email: dto.customerEmail || customer.email,
              },
            });
          }

          // Sequence number
          const count = await tx.appointment.count({ where: { salonId } });
          const appointmentNumber = `SAL-${1000 + count + 1}`;

          // Create Appointment
          const appointment = await tx.appointment.create({
            data: {
              appointmentNumber,
              salonId,
              customerId: customer.id,
              staffId: assignedStaffId,
              serviceId: service.id,
              date: new Date(dto.date),
              startTime: startDt.toUTC().toJSDate(),
              endTime: endDt.toUTC().toJSDate(),
              price: service.price,
              status: AppointmentStatus.CONFIRMED,
              source: dto.source || BookingSource.WEB,
              notes: dto.notes,
              createdByUserId,
            },
            include: {
              customer: true,
              staff: true,
              service: true,
              salon: {
                select: {
                  id: true,
                  name: true,
                  phone: true,
                  address: true,
                  timezone: true,
                },
              },
            },
          });

          // Record Status History Audit
          await tx.appointmentStatusHistory.create({
            data: {
              appointmentId: appointment.id,
              newStatus: AppointmentStatus.CONFIRMED,
              changedByUserId: createdByUserId,
              reason: 'Initial appointment booking created.',
            },
          });

          return appointment;
        },
        {
          timeout: 10000,
        },
      );
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error.message?.includes('slot was just booked') ||
        error.code === '23P01' || // PostgreSQL Exclusion Constraint Violation
        error.code === '40P01'    // PostgreSQL Deadlock
      ) {
        throw new ConflictException(
          'This slot was just booked by another customer. Please select another time.',
        );
      }
      this.logger.error('Failed to create appointment:', error);
      throw error;
    }
  }

  async getAppointments(
    salonId: string,
    filters: {
      startDate?: string;
      endDate?: string;
      staffId?: string;
      status?: AppointmentStatus;
      customerId?: string;
    },
  ) {
    const where: any = { salonId };

    if (filters.startDate && filters.endDate) {
      where.date = {
        gte: new Date(filters.startDate),
        lte: new Date(filters.endDate),
      };
    } else if (filters.startDate) {
      where.date = new Date(filters.startDate);
    }

    if (filters.staffId) {
      where.staffId = filters.staffId;
    }

    if (filters.status) {
      where.status = filters.status;
    }

    if (filters.customerId) {
      where.customerId = filters.customerId;
    }

    return this.prisma.appointment.findMany({
      where,
      include: {
        customer: true,
        staff: { select: { id: true, name: true, profileImageUrl: true } },
        service: { select: { id: true, name: true, durationMinutes: true, price: true, category: true } },
      },
      orderBy: { startTime: 'asc' },
    });
  }

  async getAppointmentById(salonId: string, appointmentId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, salonId },
      include: {
        customer: true,
        staff: true,
        service: true,
        statusHistory: { orderBy: { createdAt: 'desc' } },
        salon: true,
      },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found.');
    }

    return appointment;
  }

  async updateStatus(
    salonId: string,
    appointmentId: string,
    dto: UpdateAppointmentStatusDto,
    userId?: string,
  ) {
    const appointment = await this.getAppointmentById(salonId, appointmentId);

    const validTransitions: Record<AppointmentStatus, AppointmentStatus[]> = {
      PENDING: [AppointmentStatus.CONFIRMED, AppointmentStatus.CANCELLED],
      CONFIRMED: [
        AppointmentStatus.CHECKED_IN,
        AppointmentStatus.CANCELLED,
        AppointmentStatus.NO_SHOW,
        AppointmentStatus.RESCHEDULED,
      ],
      CHECKED_IN: [AppointmentStatus.IN_SERVICE, AppointmentStatus.CANCELLED],
      IN_SERVICE: [AppointmentStatus.COMPLETED],
      COMPLETED: [],
      CANCELLED: [],
      NO_SHOW: [],
      RESCHEDULED: [],
    };

    const allowed = validTransitions[appointment.status] || [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Invalid status transition from ${appointment.status} to ${dto.status}.`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.appointment.update({
        where: { id: appointmentId },
        data: { status: dto.status },
        include: { customer: true, staff: true, service: true },
      });

      await tx.appointmentStatusHistory.create({
        data: {
          appointmentId,
          previousStatus: appointment.status,
          newStatus: dto.status,
          changedByUserId: userId,
          reason: dto.reason,
        },
      });

      if (dto.status === AppointmentStatus.COMPLETED) {
        await tx.customer.update({
          where: { id: appointment.customerId },
          data: {
            totalVisits: { increment: 1 },
            totalSpend: { increment: appointment.price },
            lastVisitAt: new Date(),
          },
        });
      } else if (dto.status === AppointmentStatus.CANCELLED) {
        await tx.customer.update({
          where: { id: appointment.customerId },
          data: { cancelledVisits: { increment: 1 } },
        });
      } else if (dto.status === AppointmentStatus.NO_SHOW) {
        await tx.customer.update({
          where: { id: appointment.customerId },
          data: { noShowCount: { increment: 1 } },
        });
      }

      return updated;
    });
  }

  async rescheduleAppointment(
    salonId: string,
    appointmentId: string,
    dto: RescheduleAppointmentDto,
    userId?: string,
  ) {
    const existing = await this.getAppointmentById(salonId, appointmentId);

    if (
      existing.status === AppointmentStatus.COMPLETED ||
      existing.status === AppointmentStatus.CANCELLED
    ) {
      throw new BadRequestException('Cannot reschedule completed or cancelled appointment.');
    }

    const newAppointment = await this.createAppointment(
      salonId,
      {
        serviceId: existing.serviceId,
        staffId: dto.staffId || existing.staffId,
        date: dto.newDate,
        startTime: dto.newStartTime,
        customerName: existing.customer.name,
        customerPhone: existing.customer.phone,
        customerEmail: existing.customer.email || undefined,
        notes: `Rescheduled from ${existing.appointmentNumber}. ${existing.notes || ''}`,
      },
      userId,
    );

    await this.updateStatus(
      salonId,
      appointmentId,
      {
        status: AppointmentStatus.RESCHEDULED,
        reason: `Rescheduled to new appointment ${newAppointment.appointmentNumber}.`,
      },
      userId,
    );

    return newAppointment;
  }
}
