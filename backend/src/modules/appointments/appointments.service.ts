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
import { AppointmentStatus, BookingSource, ClientEtaStatus } from '@prisma/client';
import { Subject, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';

export interface SalonRealtimeEvent {
  salonId: string;
  type: 'NEW_BOOKING' | 'STATUS_UPDATED' | 'RESCHEDULED' | 'CANCELLED' | 'BOOKING_CANCELLED' | 'APPOINTMENT_UPDATED';
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
  ) {}

  getSalonEvents(salonId: string): Observable<SalonRealtimeEvent> {
    return this.events$.asObservable().pipe(
      filter((event) => event.salonId === salonId),
    );
  }

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

  private getLockKeys(salonId: string, stylistId: string, dateStr: string): [number, number] {
    const str1 = `${salonId}:${dateStr}`;
    const str2 = `${stylistId}:${dateStr}`;
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

  async getAppointments(
    salonId: string,
    filters: {
      startDate?: string;
      endDate?: string;
      staffId?: string;
      stylistId?: string;
      status?: AppointmentStatus;
      customerId?: string;
      userId?: string;
    },
  ) {
    const whereClause: any = { salonId };

    if (filters.status) {
      whereClause.status = filters.status;
    }
    const targetStylist = filters.stylistId || filters.staffId;
    if (targetStylist) {
      whereClause.stylistId = targetStylist;
    }
    const targetUser = filters.userId || filters.customerId;
    if (targetUser) {
      whereClause.userId = targetUser;
    }
    if (filters.startDate && filters.endDate) {
      whereClause.appointmentDate = {
        gte: new Date(filters.startDate),
        lte: new Date(filters.endDate),
      };
    } else if (filters.startDate) {
      whereClause.appointmentDate = new Date(filters.startDate);
    }

    return this.prisma.appointment.findMany({
      where: whereClause,
      include: {
        user: true,
        stylist: true,
        service: true,
      },
      orderBy: { startAt: 'asc' },
    });
  }

  async getSalonAppointments(salonId: string, dateStr?: string, status?: AppointmentStatus) {
    return this.getAppointments(salonId, { startDate: dateStr, status });
  }

  async getAppointmentById(salonId: string, appointmentId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, salonId },
      include: {
        user: true,
        stylist: true,
        service: true,
      },
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found.');
    }

    return appointment;
  }

  async createAppointment(
    salonId: string,
    dto: CreateAppointmentDto,
    createdByAdminId?: string,
  ) {
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
    });

    if (!salon || salon.status !== 'ACTIVE') {
      throw new NotFoundException('Salon is inactive or not found.');
    }

    const timezone = salon.timezone || 'Asia/Kolkata';
    const requestedStylistId = dto.stylistId || dto.staffId;

    // 1. Verify availability
    const availability = await this.availabilityService.getAvailableSlots(
      salonId,
      dto.serviceId,
      dto.date,
      requestedStylistId,
    );

    const matchingSlot = availability.availableSlots.find(
      (slot) => slot.startTime === dto.startTime,
    );

    if (!matchingSlot || matchingSlot.eligibleStaffIds.length === 0) {
      throw new ConflictException(
        'This slot is no longer available. Please select another time.',
      );
    }

    // 2. Select stylist (either requested stylist or auto-assign least loaded stylist)
    let assignedStylistId = requestedStylistId;
    if (!assignedStylistId || !matchingSlot.eligibleStaffIds.includes(assignedStylistId)) {
      const appointmentCounts = await this.prisma.appointment.groupBy({
        by: ['stylistId'],
        where: {
          salonId,
          appointmentDate: new Date(dto.date),
          stylistId: { in: matchingSlot.eligibleStaffIds },
          status: { notIn: ['CANCELLED', 'NO_SHOW', 'RESCHEDULED', 'EXPIRED'] },
        },
        _count: { id: true },
      });

      const countMap = new Map<string, number>();
      matchingSlot.eligibleStaffIds.forEach((id) => countMap.set(id, 0));
      appointmentCounts.forEach((c) => countMap.set(c.stylistId, c._count.id));

      const sortedStaff = matchingSlot.eligibleStaffIds.sort(
        (a, b) => (countMap.get(a) || 0) - (countMap.get(b) || 0),
      );
      assignedStylistId = sortedStaff[0];
    }

    // 3. Fetch Service Details for Timing & Pricing Snapshots
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
    const [key1, key2] = this.getLockKeys(salonId, assignedStylistId, dto.date);

    try {
      const createdAppt = await this.prisma.$transaction(
        async (tx) => {
          // Acquire transaction-scoped advisory lock for the stylist on this date
          await tx.$executeRawUnsafe(
            `SELECT pg_advisory_xact_lock(${key1}, ${key2})`,
          );

          // Find or create global User record
          let user = await tx.user.findUnique({
            where: { phone: cleanPhone },
          });

          if (!user) {
            user = await tx.user.create({
              data: {
                phone: cleanPhone,
                name: dto.customerName || null,
                email: dto.customerEmail || null,
              },
            });
          } else if (dto.customerName && !user.name) {
            user = await tx.user.update({
              where: { id: user.id },
              data: { name: dto.customerName },
            });
          }

          // Link customer to salon via SalonUser
          await tx.salonUser.upsert({
            where: {
              salonId_userId: { salonId, userId: user.id },
            },
            update: {},
            create: {
              salonId,
              userId: user.id,
            },
          });

          // Check for overlapping active appointment on this stylist
          const overlap = await tx.appointment.findFirst({
            where: {
              salonId,
              stylistId: assignedStylistId,
              appointmentDate: new Date(dto.date),
              status: { notIn: ['CANCELLED', 'NO_SHOW', 'RESCHEDULED', 'EXPIRED'] },
              AND: [
                { startAt: { lt: endDt.toJSDate() } },
                { endAt: { gt: startDt.toJSDate() } },
              ],
            },
          });

          if (overlap) {
            throw new ConflictException(
              'A concurrent booking just took this stylist time. Please choose another slot.',
            );
          }

          // Generate Human-friendly sequential appointment number
          const appointmentNumber = `SAL-${Math.floor(100000 + Math.random() * 900000)}`;

          // Create appointment with historical snapshots
          const appointment = await tx.appointment.create({
            data: {
              appointmentNumber,
              salonId,
              userId: user.id,
              stylistId: assignedStylistId,
              serviceId: service.id,
              serviceNameSnapshot: service.name,
              durationMinutes: service.durationMinutes,
              price: service.price,
              appointmentDate: new Date(dto.date),
              startAt: startDt.toJSDate(),
              endAt: endDt.toJSDate(),
              status: AppointmentStatus.CONFIRMED,
              source: dto.source || BookingSource.WEB,
              notes: dto.notes,
              createdByAdminId: createdByAdminId || null,
            },
            include: {
              user: true,
              stylist: true,
              service: true,
            },
          });

          // Create notification ledger row
          await tx.notification.create({
            data: {
              salonId,
              appointmentId: appointment.id,
              userId: user.id,
              recipientPhone: cleanPhone,
              messageBody: `Your appointment #${appointment.appointmentNumber} for ${service.name} is confirmed for ${dto.date} at ${dto.startTime}.`,
              status: 'PENDING',
            },
          });

          return appointment;
        },
        { timeout: 10000 },
      );

      this.emitSalonEvent(salonId, 'NEW_BOOKING', createdAppt);
      return createdAppt;
    } catch (err) {
      if (err instanceof ConflictException) throw err;
      this.logger.error(`Error creating appointment: ${err.message}`, err.stack);
      throw err;
    }
  }

  async updateAppointmentStatus(
    salonId: string,
    appointmentId: string,
    dto: UpdateAppointmentStatusDto,
  ) {
    await this.getAppointmentById(salonId, appointmentId);

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: dto.status },
      include: {
        user: true,
        stylist: true,
        service: true,
      },
    });

    this.emitSalonEvent(salonId, 'STATUS_UPDATED', updated);
    return updated;
  }

  async updateStatus(
    salonId: string,
    appointmentId: string,
    dto: UpdateAppointmentStatusDto,
    adminId?: string,
  ) {
    return this.updateAppointmentStatus(salonId, appointmentId, dto);
  }

  async updateEtaStatus(salonId: string, appointmentId: string, etaStatus: any) {
    await this.getAppointmentById(salonId, appointmentId);

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { clientEtaStatus: etaStatus as ClientEtaStatus },
      include: {
        user: true,
        stylist: true,
        service: true,
      },
    });

    this.emitSalonEvent(salonId, 'APPOINTMENT_UPDATED', updated);
    return updated;
  }

  async rescheduleAppointment(
    salonId: string,
    appointmentId: string,
    dto: RescheduleAppointmentDto,
    adminId?: string,
  ) {
    const appointment = await this.getAppointmentById(salonId, appointmentId);

    const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
    const timezone = salon?.timezone || 'Asia/Kolkata';

    const targetStylistId = dto.stylistId || dto.staffId || appointment.stylistId;

    // Check availability
    const availability = await this.availabilityService.getAvailableSlots(
      salonId,
      appointment.serviceId,
      dto.newDate,
      targetStylistId,
      appointmentId,
    );

    const matchingSlot = availability.availableSlots.find(
      (slot) => slot.startTime === dto.newStartTime,
    );

    if (!matchingSlot) {
      throw new ConflictException('Requested new slot is not available.');
    }

    const [startH, startM] = dto.newStartTime.split(':').map((v) => parseInt(v, 10));
    const startDt = DateTime.fromISO(dto.newDate, { zone: timezone }).set({
      hour: startH,
      minute: startM,
      second: 0,
      millisecond: 0,
    });
    const endDt = startDt.plus({ minutes: appointment.durationMinutes });

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        appointmentDate: new Date(dto.newDate),
        startAt: startDt.toJSDate(),
        endAt: endDt.toJSDate(),
        stylistId: targetStylistId,
        status: AppointmentStatus.CONFIRMED,
      },
      include: {
        user: true,
        stylist: true,
        service: true,
      },
    });

    this.emitSalonEvent(salonId, 'RESCHEDULED', updated);
    return updated;
  }

  async addServiceToAppointment(salonId: string, appointmentId: string, serviceId: string) {
    const appointment = await this.getAppointmentById(salonId, appointmentId);
    const extraService = await this.prisma.service.findFirst({
      where: { id: serviceId, salonId, status: 'ACTIVE' },
    });

    if (!extraService) {
      throw new NotFoundException('Service not found or inactive.');
    }

    const newEndAt = DateTime.fromJSDate(appointment.endAt).plus({ minutes: extraService.durationMinutes }).toJSDate();

    // Check if stylist has conflicting appointment
    const conflictBooking = await this.prisma.appointment.findFirst({
      where: {
        salonId,
        stylistId: appointment.stylistId,
        appointmentDate: appointment.appointmentDate,
        id: { not: appointmentId },
        status: { notIn: ['CANCELLED', 'NO_SHOW', 'RESCHEDULED'] },
        startAt: { lt: newEndAt },
        endAt: { gt: appointment.endAt },
      },
      include: { stylist: true, service: true },
    });

    if (conflictBooking) {
      return {
        success: false,
        conflict: true,
        conflictBooking: {
          ...conflictBooking,
          staff: conflictBooking.stylist,
        },
        extraService,
      };
    }

    const updatedAppointment = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        endAt: newEndAt,
        durationMinutes: appointment.durationMinutes + extraService.durationMinutes,
        price: Number(appointment.price) + Number(extraService.price),
      },
      include: { stylist: true, service: true, user: true },
    });

    return {
      success: true,
      updatedAppointment: {
        ...updatedAppointment,
        startTime: updatedAppointment.startAt,
        endTime: updatedAppointment.endAt,
        staff: updatedAppointment.stylist,
      },
      extraService,
    };
  }

  async cancelAppointment(salonId: string, appointmentId: string, reason?: string) {
    const appointment = await this.getAppointmentById(salonId, appointmentId);

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: AppointmentStatus.CANCELLED,
        notes: reason ? `${appointment.notes || ''} [Cancelled: ${reason}]` : appointment.notes,
      },
      include: {
        user: true,
        stylist: true,
        service: true,
      },
    });

    this.emitSalonEvent(salonId, 'CANCELLED', updated);
    return updated;
  }
}
