import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AvailabilityService } from '../availability/availability.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import {
  CreateAppointmentDto,
  UpdateAppointmentStatusDto,
  RescheduleAppointmentDto,
} from './dto/create-appointment.dto';
import { DateTime } from 'luxon';
import { AppointmentStatus, BookingSource } from '@prisma/client';
import { Subject, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';

export interface SalonRealtimeEvent {
  salonId: string;
  type: 'NEW_BOOKING' | 'STATUS_UPDATED' | 'RESCHEDULED' | 'CANCELLED';
  data: any;
  timestamp: string;
}

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);
  private readonly events$ = new Subject<SalonRealtimeEvent>();

  constructor(
    private prisma: PrismaService,
    private availabilityService: AvailabilityService,
    @Inject(forwardRef(() => WhatsAppService))
    private whatsappService: WhatsAppService,
  ) { }

  // Observable stream for SSE filtered by salonId
  getSalonEvents(salonId: string): Observable<SalonRealtimeEvent> {
    return this.events$.asObservable().pipe(
      filter((event) => event.salonId === salonId),
    );
  }

  // Broadcast event to connected salon PWA instances
  emitSalonEvent(salonId: string, type: SalonRealtimeEvent['type'], data: any) {
    this.events$.next({
      salonId,
      type,
      data,
      timestamp: new Date().toISOString(),
    });
  }

  private sanitizePhone(phone: string): string {
    return phone.replace(/[^\d+]/g, '');
  }

  private getLockKeys(salonId: string, staffId: string, dateStr: string): [number, number] {
    const str1 = `${salonId}:${dateStr}`;
    const str2 = `${staffId}:${dateStr}`;
    let hash1 = 0;
    let hash2 = 0;
    for (let i = 0; i < str1.length; i++) {
      hash1 = (hash1 << 5) - hash1 + str1.charCodeAt(i);
      hash1 |= 0;
    }
    for (let i = 0; i < str2.length; i++) {
      hash2 = (hash2 << 5) - hash2 + str2.charCodeAt(i);
      hash2 |= 0;
    }
    return [Math.abs(hash1), Math.abs(hash2)];
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

    // 3. Fetch Details for Timing & Pricing
    const service = await this.prisma.service.findUnique({
      where: { id: dto.serviceId },
    });

    if (!service || service.status !== 'ACTIVE') {
      throw new NotFoundException('Selected service not found or inactive.');
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

    // 4. PostgreSQL Advisory Locking & Atomic Transaction
    const [key1, key2] = this.getLockKeys(salonId, assignedStaffId, dto.date);

    try {
      const createdAppt = await this.prisma.$transaction(
        async (tx) => {
          // Acquire transaction-scoped advisory lock for the specialist on this date
          await tx.$executeRawUnsafe(
            `SELECT pg_advisory_xact_lock(${key1}, ${key2})`,
          );

          // Find or create Customer record for Salon
          let customer = await tx.customer.findFirst({
            where: {
              salonId,
              phone: cleanPhone,
            },
          });

          if (!customer) {
            customer = await tx.customer.create({
              data: {
                salonId,
                phone: cleanPhone,
                name: dto.customerName,
                email: dto.customerEmail,
              },
            });
          } else {
            // Update name/email if provided
            if (dto.customerName && customer.name !== dto.customerName) {
              customer = await tx.customer.update({
                where: { id: customer.id },
                data: {
                  name: dto.customerName,
                  email: dto.customerEmail || customer.email,
                },
              });
            }
          }

          // Generate next appointment number
          const lastAppointment = await tx.appointment.findFirst({
            where: { salonId },
            orderBy: { createdAt: 'desc' },
            select: { appointmentNumber: true },
          });

          let nextNum = 1001;
          if (lastAppointment?.appointmentNumber) {
            const parsed = parseInt(
              lastAppointment.appointmentNumber.replace('SAL-', ''),
              10,
            );
            if (!isNaN(parsed)) nextNum = parsed + 1;
          }
          const appointmentNumber = `SAL-${nextNum}`;

          // Create Appointment
          const appointment = await tx.appointment.create({
            data: {
              salonId,
              customerId: customer.id,
              staffId: assignedStaffId,
              serviceId: dto.serviceId,
              appointmentNumber,
              date: new Date(dto.date),
              startTime: startDt.toUTC().toJSDate(),
              endTime: endDt.toUTC().toJSDate(),
              price: service.price,
              status: AppointmentStatus.CONFIRMED,
              source: dto.source || BookingSource.WEB,
              notes: dto.notes,
            },
            include: {
              customer: true,
              staff: true,
              service: true,
              salon: true,
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

      // Emit real-time event to Salon PWA instances
      this.emitSalonEvent(salonId, 'NEW_BOOKING', createdAppt);

      return createdAppt;
    } catch (error: any) {
      if (
        error instanceof ConflictException ||
        error.message?.includes('slot was just booked') ||
        error.message?.includes('23P01') ||
        error.message?.includes('no_overlapping_staff_appointments') ||
        error.message?.includes('exclusion constraint') ||
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

    const updated = await this.prisma.$transaction(async (tx) => {
      const res = await tx.appointment.update({
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

      return res;
    });

    // 1. Broadcast real-time update to dashboard PWA
    this.emitSalonEvent(salonId, 'STATUS_UPDATED', updated);

    // 2. Outbound WhatsApp: If CANCELLED, alert the customer immediately
    if (dto.status === AppointmentStatus.CANCELLED && appointment.customer?.phone) {
      try {
        const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
        const dateStr = DateTime.fromJSDate(appointment.startTime, { zone: salon?.timezone || 'Asia/Kolkata' }).toFormat('dd LLL yyyy');
        const timeStr = DateTime.fromJSDate(appointment.startTime, { zone: salon?.timezone || 'Asia/Kolkata' }).toFormat('hh:mm a');
        const cancelMsg = `❌ *APPOINTMENT CANCELLED*\n\nHello *${appointment.customer.name}*, your appointment for *${appointment.service?.name || 'Service'}* at *${salon?.name || 'our salon'}* on *${dateStr}* at *${timeStr}* has been cancelled by the salon.\n\nIf you would like to book a new appointment, simply reply *'Hi'* to this message.`;
        await this.whatsappService.sendMetaMessage(appointment.customer.phone, { bodyText: cancelMsg });
        this.logger.log(`Outbound WhatsApp cancellation alert dispatched to ${appointment.customer.phone}`);
      } catch (err) {
        this.logger.warn(`Could not send cancellation WhatsApp message: ${err.message}`);
      }
    }

    // 3. Outbound WhatsApp: If COMPLETED, trigger automated Next-In-Line "Chair Ready" call-up!
    if (dto.status === AppointmentStatus.COMPLETED) {
      this.triggerNextClientCallup(salonId, appointment.staffId).catch((err) => {
        this.logger.warn(`Could not trigger next client call-up: ${err.message}`);
      });
    }

    return updated;
  }

  // Helper: Find next waiting client and send "Your chair is ready" call-up
  async triggerNextClientCallup(salonId: string, staffId: string) {
    const nowMinus15 = new Date(Date.now() - 15 * 60 * 1000);
    const nowPlus45 = new Date(Date.now() + 45 * 60 * 1000);

    const nextAppt = await this.prisma.appointment.findFirst({
      where: {
        salonId,
        staffId,
        status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN] },
        startTime: {
          gte: nowMinus15,
          lte: nowPlus45,
        },
      },
      orderBy: { startTime: 'asc' },
      include: { customer: true, service: true, staff: true, salon: true },
    });

    if (nextAppt && nextAppt.customer?.phone) {
      const callupMsg = `👋 *YOUR CHAIR IS READY!*\n\nHello *${nextAppt.customer.name}*, *${nextAppt.staff.name}* has just finished their previous appointment and your chair is ready at *${nextAppt.salon.name}*!\n\n• *Service:* *${nextAppt.service.name}*\n• *Specialist:* *${nextAppt.staff.name}*\n\nPlease proceed to the chair. We look forward to seeing you! ✂️`;
      await this.whatsappService.sendMetaMessage(nextAppt.customer.phone, { bodyText: callupMsg });
      this.logger.log(`Automated 'Chair Ready' WhatsApp call-up dispatched to ${nextAppt.customer.phone} for specialist ${nextAppt.staff.name}`);
    }
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

    // Broadcast reschedule event
    this.emitSalonEvent(salonId, 'RESCHEDULED', newAppointment);

    // Outbound WhatsApp: Send reschedule confirmation to customer
    if (newAppointment.customer?.phone) {
      try {
        const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
        const newDateStr = DateTime.fromJSDate(newAppointment.startTime, { zone: salon?.timezone || 'Asia/Kolkata' }).toFormat('dd LLL yyyy');
        const newTimeStr = DateTime.fromJSDate(newAppointment.startTime, { zone: salon?.timezone || 'Asia/Kolkata' }).toFormat('hh:mm a');
        const reschedMsg = `🔄 *APPOINTMENT RESCHEDULED*\n\nHello *${newAppointment.customer.name}*, your appointment at *${salon?.name || 'our salon'}* has been rescheduled.\n\n• *Service:* *${newAppointment.service?.name || 'Service'}*\n• *Specialist:* *${newAppointment.staff?.name || 'Specialist'}*\n• *New Date:* *${newDateStr}*\n• *New Time:* *${newTimeStr}*\n\n📍 *${salon?.name || 'Salon'}*\n${salon?.address || ''}\n\nReply *'Hi'* if you need any adjustments.`;
        await this.whatsappService.sendMetaMessage(newAppointment.customer.phone, { bodyText: reschedMsg });
        this.logger.log(`Outbound WhatsApp reschedule alert dispatched to ${newAppointment.customer.phone}`);
      } catch (err) {
        this.logger.warn(`Could not send reschedule WhatsApp message: ${err.message}`);
      }
    }

    return newAppointment;
  }

  async addServiceToAppointment(
    salonId: string,
    appointmentId: string,
    extraServiceId: string,
  ): Promise<{ success: boolean; conflict?: boolean; conflictBooking?: any; updatedAppointment?: any; extraService?: any; message?: string }> {
    const appointment = await this.getAppointmentById(salonId, appointmentId);

    if (appointment.status !== AppointmentStatus.CONFIRMED && appointment.status !== AppointmentStatus.CHECKED_IN) {
      return { success: false, message: 'Only active confirmed appointments can be updated.' };
    }

    const extraService = await this.prisma.service.findFirst({
      where: { id: extraServiceId, salonId, status: 'ACTIVE' },
    });

    if (!extraService) {
      return { success: false, message: 'Extra service not found or inactive.' };
    }

    const currentEndTime = new Date(appointment.endTime);
    const newEndTime = new Date(currentEndTime.getTime() + extraService.durationMinutes * 60 * 1000);

    // Check if the stylist has an overlapping appointment between currentEndTime and newEndTime
    const conflict = await this.prisma.appointment.findFirst({
      where: {
        salonId,
        staffId: appointment.staffId,
        id: { not: appointment.id },
        status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_SERVICE] },
        startTime: { lt: newEndTime },
        endTime: { gt: currentEndTime },
      },
      include: { customer: true },
    });

    if (conflict) {
      return {
        success: false,
        conflict: true,
        conflictBooking: conflict,
        extraService,
        message: `Specialist ${appointment.staff.name} is booked right after at ${DateTime.fromJSDate(conflict.startTime).toFormat('hh:mm a')}.`,
      };
    }

    // Update appointment with extra duration and price
    const updated = await this.prisma.$transaction(async (tx) => {
      const appt = await tx.appointment.update({
        where: { id: appointment.id },
        data: {
          endTime: newEndTime,
          price: { increment: extraService.price },
          notes: `${appointment.notes || ''} | + ${extraService.name} (₹${extraService.price})`.trim(),
        },
        include: { customer: true, staff: true, service: true },
      });

      await tx.appointmentStatusHistory.create({
        data: {
          appointmentId: appointment.id,
          previousStatus: appointment.status,
          newStatus: appointment.status,
          reason: `Added extra service: ${extraService.name} (₹${extraService.price}, +${extraService.durationMinutes}m).`,
        },
      });

      return appt;
    });

    return { success: true, updatedAppointment: updated, extraService };
  }
}
