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
import { AppointmentStatus, BookingSource, ClientEtaStatus, DayOfWeek, StylistStatus, ServiceStatus } from '@prisma/client';
import { Subject, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';
import * as crypto from 'crypto';

export interface SalonRealtimeEvent {
  salonId: string;
  type:
    | 'NEW_BOOKING'
    | 'STATUS_UPDATED'
    | 'RESCHEDULED'
    | 'CANCELLED'
    | 'BOOKING_CANCELLED'
    | 'APPOINTMENT_UPDATED'
    | 'STAFF_UPDATED'
    | 'SERVICE_UPDATED';
  data: any;
  timestamp: string;
}

export const VALID_STATUS_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  [AppointmentStatus.CONFIRMED]: [
    AppointmentStatus.CHECKED_IN,
    AppointmentStatus.CANCELLED,
    AppointmentStatus.NO_SHOW,
  ],
  [AppointmentStatus.CHECKED_IN]: [
    AppointmentStatus.IN_SERVICE,
    AppointmentStatus.CANCELLED,
    AppointmentStatus.NO_SHOW,
  ],
  [AppointmentStatus.IN_SERVICE]: [
    AppointmentStatus.COMPLETED,
  ],
  [AppointmentStatus.COMPLETED]: [], // Terminal
  [AppointmentStatus.CANCELLED]: [], // Terminal
  [AppointmentStatus.NO_SHOW]: [],   // Terminal
};

const appointmentInclude = {
  salonUser: {
    include: {
      user: true,
    },
  },
  stylist: true,
  service: true,
  services: {
    include: {
      service: true,
    },
    orderBy: { orderIndex: 'asc' as const },
  },
};

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

  private hashToSignedInt32(input: string): number {
    return crypto.createHash('sha256').update(input).digest().readInt32BE(0);
  }

  private formatAppointment(appt: any) {
    if (!appt) return null;
    return {
      ...appt,
      user: appt.salonUser?.user || null,
    };
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
      whereClause.OR = [
        { salonUserId: targetUser },
        { salonUser: { userId: targetUser } },
      ];
    }
    if (filters.startDate && filters.endDate) {
      whereClause.appointmentDate = {
        gte: new Date(filters.startDate),
        lte: new Date(filters.endDate),
      };
    } else if (filters.startDate) {
      whereClause.appointmentDate = new Date(filters.startDate);
    }

    const appointments = await this.prisma.appointment.findMany({
      where: whereClause,
      include: appointmentInclude,
      orderBy: { startAt: 'asc' },
    });

    return appointments.map((appt) => this.formatAppointment(appt));
  }

  async getSalonAppointments(salonId: string, dateStr?: string, status?: AppointmentStatus) {
    return this.getAppointments(salonId, { startDate: dateStr, status });
  }

  async getAppointmentById(salonId: string, appointmentId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, salonId },
      include: appointmentInclude,
    });

    if (!appointment) {
      throw new NotFoundException('Appointment not found.');
    }

    return this.formatAppointment(appointment);
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

    // 1. Resolve Services (Multi-service support)
    const serviceIds =
      dto.serviceIds && dto.serviceIds.length > 0
        ? dto.serviceIds
        : dto.serviceId
        ? [dto.serviceId]
        : [];

    if (serviceIds.length === 0) {
      throw new BadRequestException('At least one service must be selected.');
    }

    const services = await this.prisma.service.findMany({
      where: {
        id: { in: serviceIds },
        salonId,
        status: 'ACTIVE',
      },
    });

    if (services.length !== serviceIds.length) {
      throw new NotFoundException('One or more selected services are invalid, inactive, or not found.');
    }

    // Preserve the requested service selection order
    const orderedServices = serviceIds.map((id) => services.find((s) => s.id === id)!);
    const totalDuration = orderedServices.reduce((sum, s) => sum + s.durationMinutes, 0);
    const totalPrice = orderedServices.reduce((sum, s) => sum + Number(s.price), 0);
    const primaryService = orderedServices[0];
    const serviceNameSnapshot = orderedServices.map((s) => s.name).join(', ');

    // 2. Verify availability
    const availability = await this.availabilityService.getAvailableSlots(
      salonId,
      serviceIds,
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

    // Calculate start and end times in local salon timezone
    const [startH, startM] = dto.startTime.split(':').map((v) => parseInt(v, 10));
    const startDt = DateTime.fromISO(dto.date, { zone: timezone }).set({
      hour: startH,
      minute: startM,
      second: 0,
      millisecond: 0,
    });
    const endDt = startDt.plus({ minutes: totalDuration });
    const dayOfWeek = startDt.toFormat('cccc').toUpperCase() as DayOfWeek;

    const cleanPhone = this.sanitizePhone(dto.customerPhone);

    // 3. Resolve Customer & SalonUser Identity
    let user = await this.prisma.user.findUnique({
      where: { phone: cleanPhone },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          phone: cleanPhone,
          name: dto.customerName || null,
          email: dto.customerEmail || null,
        },
      });
    } else if (dto.customerName && !user.name) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { name: dto.customerName },
      });
    }

    const salonUser = await this.prisma.salonUser.upsert({
      where: {
        salonId_userId: { salonId, userId: user.id },
      },
      update: {},
      create: {
        salonId,
        userId: user.id,
      },
    });

    // 4. Global 3-Level Lock Hierarchy & Atomic Transaction
    const key1 = this.hashToSignedInt32(`salon:${salonId}`);
    const scheduleKey2 = this.hashToSignedInt32(`schedule:${dayOfWeek}`);
    const customerKey2 = this.hashToSignedInt32(`cust:${salonUser.id}:${dto.date}`);

    try {
      const createdAppt = await this.prisma.$transaction(
        async (tx) => {
          // Level 1: Acquire shared schedule resource lock (allows concurrent bookings on the same day)
          await tx.$executeRawUnsafe(
            `SELECT pg_advisory_xact_lock_shared(${key1}, ${scheduleKey2})`,
          );

          // Level 2: Acquire customer resource lock
          await tx.$executeRawUnsafe(
            `SELECT pg_advisory_xact_lock(${key1}, ${customerKey2})`,
          );

          // Check for salon-scoped customer overlap
          const customerOverlap = await tx.appointment.findFirst({
            where: {
              salonId,
              salonUserId: salonUser.id,
              status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_SERVICE] },
              AND: [
                { startAt: { lt: endDt.toJSDate() } },
                { endAt: { gt: startDt.toJSDate() } },
              ],
            },
          });

          if (customerOverlap) {
            throw new ConflictException(
              'You already have an active appointment at this salon during the selected time.',
            );
          }

          // Level 3: Stylist Resource Lock
          let assignedStylistId: string | null = null;

          if (requestedStylistId) {
            // Specific Stylist: exclusive lock
            const stylistKey2 = this.hashToSignedInt32(`stylist:${requestedStylistId}:${dto.date}`);
            await tx.$executeRawUnsafe(
              `SELECT pg_advisory_xact_lock(${key1}, ${stylistKey2})`,
            );

            const overlap = await tx.appointment.findFirst({
              where: {
                salonId,
                stylistId: requestedStylistId,
                status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_SERVICE] },
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
            assignedStylistId = requestedStylistId;
          } else {
            // Any Stylist: Deterministic candidate ordering with try-lock fallback
            const candidateIds = [...matchingSlot.eligibleStaffIds].sort();

            for (const candidateId of candidateIds) {
              const candKey2 = this.hashToSignedInt32(`stylist:${candidateId}:${dto.date}`);
              const lockRows = await tx.$queryRawUnsafe<[{ pg_try_advisory_xact_lock: boolean }]>(
                `SELECT pg_try_advisory_xact_lock(${key1}, ${candKey2})`,
              );

              if (lockRows?.[0]?.pg_try_advisory_xact_lock) {
                // Lock acquired; verify candidate has no overlapping active appointments
                const overlap = await tx.appointment.findFirst({
                  where: {
                    salonId,
                    stylistId: candidateId,
                    status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_SERVICE] },
                    AND: [
                      { startAt: { lt: endDt.toJSDate() } },
                      { endAt: { gt: startDt.toJSDate() } },
                    ],
                  },
                });

                if (!overlap) {
                  assignedStylistId = candidateId;
                  break;
                }
              }
            }

            if (!assignedStylistId) {
              throw new ConflictException(
                'All eligible specialists are currently occupied or being booked. Please choose another slot.',
              );
            }
          }

          // Re-verify assigned stylist status under lock (FOR SHARE to serialize with deactivation)
          await tx.$executeRawUnsafe(
            `SELECT id FROM stylists WHERE id = '${assignedStylistId!}' FOR SHARE`,
          );
          const assignedStylist = await tx.stylist.findUnique({
            where: { id: assignedStylistId! },
            select: { id: true, followsSalonSchedule: true, status: true },
          });

          if (!assignedStylist || assignedStylist.status !== StylistStatus.ACTIVE) {
            throw new ConflictException('Selected specialist is inactive or no longer available.');
          }

          // Re-verify services status under lock
          const activeServices = await tx.service.findMany({
            where: {
              id: { in: serviceIds },
              salonId,
              status: ServiceStatus.ACTIVE,
            },
          });
          if (activeServices.length !== serviceIds.length) {
            throw new ConflictException('One or more selected services are inactive or no longer available.');
          }

          // Re-verify stylist-service assignments under lock
          const activeAssignments = await tx.stylistService.findMany({
            where: {
              salonId,
              stylistId: assignedStylistId!,
              serviceId: { in: serviceIds },
            },
          });
          if (activeAssignments.length !== serviceIds.length) {
            throw new ConflictException('Specialist is no longer assigned to perform the selected services.');
          }

          if (assignedStylist.followsSalonSchedule) {
            const currentSalonHours = await tx.salonWorkingHours.findUnique({
              where: { salonId_dayOfWeek: { salonId, dayOfWeek } },
            });

            if (!currentSalonHours || currentSalonHours.isClosed) {
              throw new ConflictException(`Salon is closed on ${dayOfWeek}.`);
            }

            const apptStartStr = dto.startTime;
            const apptEndStr = endDt.toFormat('HH:mm');

            if (currentSalonHours.startTime && apptStartStr < currentSalonHours.startTime) {
              throw new ConflictException(
                `Appointment start time ${apptStartStr} is earlier than salon opening time ${currentSalonHours.startTime}.`,
              );
            }
            if (currentSalonHours.endTime && apptEndStr > currentSalonHours.endTime) {
              throw new ConflictException(
                `Appointment end time ${apptEndStr} exceeds salon closing time ${currentSalonHours.endTime}.`,
              );
            }
            if (currentSalonHours.breakStartTime && currentSalonHours.breakEndTime) {
              if (apptStartStr < currentSalonHours.breakEndTime && apptEndStr > currentSalonHours.breakStartTime) {
                throw new ConflictException(
                  `Appointment conflicts with salon break (${currentSalonHours.breakStartTime}-${currentSalonHours.breakEndTime}).`,
                );
              }
            }
          }

          // Generate Human-friendly sequential appointment number
          const appointmentNumber = `SAL-${Math.floor(100000 + Math.random() * 900000)}`;

          // Create parent Appointment record with snapshots
          const appointment = await tx.appointment.create({
            data: {
              appointmentNumber,
              salonId,
              salonUserId: salonUser.id,
              stylistId: assignedStylistId,
              serviceId: primaryService.id,
              serviceNameSnapshot,
              durationMinutes: totalDuration,
              price: totalPrice,
              appointmentDate: new Date(dto.date),
              startAt: startDt.toJSDate(),
              endAt: endDt.toJSDate(),
              status: AppointmentStatus.CONFIRMED,
              source: dto.source || BookingSource.WEB,
              notes: dto.notes,
              createdByAdminId: createdByAdminId || null,
            },
            include: appointmentInclude,
          });

          // Insert individual AppointmentService rows
          await tx.appointmentService.createMany({
            data: orderedServices.map((s, idx) => ({
              salonId,
              appointmentId: appointment.id,
              serviceId: s.id,
              serviceNameSnapshot: s.name,
              durationMinutes: s.durationMinutes,
              price: s.price,
              orderIndex: idx,
            })),
          });

          // Create notification ledger row
          await tx.notification.create({
            data: {
              salonId,
              appointmentId: appointment.id,
              userId: user.id,
              recipientPhone: cleanPhone,
              messageBody: `Your appointment #${appointment.appointmentNumber} for ${serviceNameSnapshot} is confirmed for ${dto.date} at ${dto.startTime}.`,
              status: 'PENDING',
            },
          });

          return appointment;
        },
        { timeout: 15000 },
      );

      const formatted = this.formatAppointment(createdAppt);
      this.emitSalonEvent(salonId, 'NEW_BOOKING', formatted);
      return formatted;
    } catch (err: any) {
      if (err?.code === '23P01') {
        throw new ConflictException(
          'A concurrent booking just took this slot. Please select another time.',
        );
      }
      if (
        err instanceof ConflictException ||
        err instanceof BadRequestException ||
        err instanceof NotFoundException
      ) {
        throw err;
      }
      this.logger.error(`Error creating appointment: ${err.message}`, err.stack);
      throw err;
    }
  }

  async updateAppointmentStatus(
    salonId: string,
    appointmentId: string,
    dto: UpdateAppointmentStatusDto,
    adminId?: string,
  ) {
    const appointment = await this.getAppointmentById(salonId, appointmentId);

    const allowedTransitions = VALID_STATUS_TRANSITIONS[appointment.status as AppointmentStatus] || [];
    if (!allowedTransitions.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition appointment status from ${appointment.status} to ${dto.status}.`,
      );
    }

    // 2-hour cutoff rule for customers on cancellation (admin can override)
    if (dto.status === AppointmentStatus.CANCELLED && !adminId) {
      const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
      const cancelWindowHours = salon?.cancelWindowHours ?? 2;
      const nowMs = Date.now();
      const apptStartMs = new Date(appointment.startAt).getTime();
      if (apptStartMs - nowMs < cancelWindowHours * 60 * 60 * 1000) {
        throw new BadRequestException(
          `Appointments cannot be cancelled within ${cancelWindowHours} hours of the start time.`,
        );
      }
    }

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: dto.status,
        notes: dto.reason ? `${appointment.notes || ''} [Status note: ${dto.reason}]`.trim() : appointment.notes,
      },
      include: appointmentInclude,
    });

    const formatted = this.formatAppointment(updated);
    this.emitSalonEvent(salonId, 'STATUS_UPDATED', formatted);
    return formatted;
  }

  async updateStatus(
    salonId: string,
    appointmentId: string,
    dto: UpdateAppointmentStatusDto,
    adminId?: string,
  ) {
    return this.updateAppointmentStatus(salonId, appointmentId, dto, adminId);
  }

  async updateEtaStatus(salonId: string, appointmentId: string, etaStatus: any) {
    await this.getAppointmentById(salonId, appointmentId);

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { clientEtaStatus: etaStatus as ClientEtaStatus },
      include: appointmentInclude,
    });

    const formatted = this.formatAppointment(updated);
    this.emitSalonEvent(salonId, 'APPOINTMENT_UPDATED', formatted);
    return formatted;
  }

  async rescheduleAppointment(
    salonId: string,
    appointmentId: string,
    dto: RescheduleAppointmentDto,
    adminId?: string,
  ) {
    const appointment = await this.getAppointmentById(salonId, appointmentId);

    if (appointment.status !== AppointmentStatus.CONFIRMED) {
      throw new BadRequestException(
        `Only CONFIRMED appointments can be rescheduled. Current status: ${appointment.status}.`,
      );
    }

    const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
    if (!salon) throw new NotFoundException('Salon not found.');
    const timezone = salon.timezone || 'Asia/Kolkata';

    // 2-hour cutoff rule for customers (admin can override)
    const cancelWindowHours = salon.cancelWindowHours ?? 2;
    if (!adminId) {
      const nowMs = Date.now();
      const apptStartMs = new Date(appointment.startAt).getTime();
      if (apptStartMs - nowMs < cancelWindowHours * 60 * 60 * 1000) {
        throw new BadRequestException(
          `Appointments cannot be rescheduled within ${cancelWindowHours} hours of the start time.`,
        );
      }
    }

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
    const dayOfWeek = startDt.toFormat('cccc').toUpperCase() as DayOfWeek;

    // Lock hierarchy for rescheduling:
    // Level 1: Schedule lock on new day
    // Level 2: Customer lock on new date
    // Level 3: Stylist lock on new date
    const key1 = this.hashToSignedInt32(`salon:${salonId}`);
    const newScheduleKey2 = this.hashToSignedInt32(`schedule:${dayOfWeek}`);
    const customerKey2 = this.hashToSignedInt32(`cust:${appointment.salonUserId}:${dto.newDate}`);
    const targetStylistKey2 = this.hashToSignedInt32(`stylist:${targetStylistId}:${dto.newDate}`);

    try {
      const updated = await this.prisma.$transaction(
        async (tx) => {
          // Level 1: Shared schedule lock
          await tx.$executeRawUnsafe(
            `SELECT pg_advisory_xact_lock_shared(${key1}, ${newScheduleKey2})`,
          );

          // Level 2: Customer lock
          await tx.$executeRawUnsafe(
            `SELECT pg_advisory_xact_lock(${key1}, ${customerKey2})`,
          );

          // Check salon customer overlap (excluding current appointment being rescheduled)
          const custOverlap = await tx.appointment.findFirst({
            where: {
              salonId,
              salonUserId: appointment.salonUserId,
              id: { not: appointmentId },
              status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_SERVICE] },
              AND: [
                { startAt: { lt: endDt.toJSDate() } },
                { endAt: { gt: startDt.toJSDate() } },
              ],
            },
          });

          if (custOverlap) {
            throw new ConflictException(
              'You already have another appointment at this salon during this rescheduled time.',
            );
          }

          // Level 3: Stylist lock
          await tx.$executeRawUnsafe(
            `SELECT pg_advisory_xact_lock(${key1}, ${targetStylistKey2})`,
          );

          // Check stylist overlap (excluding current appointment being rescheduled)
          const stylistOverlap = await tx.appointment.findFirst({
            where: {
              salonId,
              stylistId: targetStylistId,
              id: { not: appointmentId },
              status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_SERVICE] },
              AND: [
                { startAt: { lt: endDt.toJSDate() } },
                { endAt: { gt: startDt.toJSDate() } },
              ],
            },
          });

          if (stylistOverlap) {
            throw new ConflictException(
              'A concurrent booking just took this specialist time. Please choose another slot.',
            );
          }

          // Re-verify target stylist status under lock (FOR SHARE to serialize with deactivation)
          await tx.$executeRawUnsafe(
            `SELECT id FROM stylists WHERE id = '${targetStylistId}' FOR SHARE`,
          );
          const targetStylist = await tx.stylist.findUnique({
            where: { id: targetStylistId },
            select: { id: true, followsSalonSchedule: true, status: true },
          });

          if (!targetStylist || targetStylist.status !== StylistStatus.ACTIVE) {
            throw new ConflictException('Selected specialist is inactive or no longer available.');
          }

          // Re-verify service status under lock
          const activeService = await tx.service.findFirst({
            where: {
              id: appointment.serviceId,
              salonId,
              status: ServiceStatus.ACTIVE,
            },
          });
          if (!activeService) {
            throw new ConflictException('Selected service is inactive or no longer available.');
          }

          // Re-verify stylist-service assignment under lock
          const activeAssignment = await tx.stylistService.findFirst({
            where: {
              salonId,
              stylistId: targetStylistId,
              serviceId: appointment.serviceId,
            },
          });
          if (!activeAssignment) {
            throw new ConflictException('Specialist is no longer assigned to perform this service.');
          }

          if (targetStylist.followsSalonSchedule) {
            const currentSalonHours = await tx.salonWorkingHours.findUnique({
              where: { salonId_dayOfWeek: { salonId, dayOfWeek } },
            });

            if (!currentSalonHours || currentSalonHours.isClosed) {
              throw new ConflictException(`Salon is closed on ${dayOfWeek}.`);
            }

            const apptStartStr = dto.newStartTime;
            const apptEndStr = endDt.toFormat('HH:mm');

            if (currentSalonHours.startTime && apptStartStr < currentSalonHours.startTime) {
              throw new ConflictException(
                `Rescheduled start time ${apptStartStr} is earlier than salon opening time ${currentSalonHours.startTime}.`,
              );
            }
            if (currentSalonHours.endTime && apptEndStr > currentSalonHours.endTime) {
              throw new ConflictException(
                `Rescheduled end time ${apptEndStr} exceeds salon closing time ${currentSalonHours.endTime}.`,
              );
            }
            if (currentSalonHours.breakStartTime && currentSalonHours.breakEndTime) {
              if (apptStartStr < currentSalonHours.breakEndTime && apptEndStr > currentSalonHours.breakStartTime) {
                throw new ConflictException(
                  `Rescheduled appointment conflicts with salon break (${currentSalonHours.breakStartTime}-${currentSalonHours.breakEndTime}).`,
                );
              }
            }
          }

          // In-place mutation of the appointment
          return tx.appointment.update({
            where: { id: appointmentId },
            data: {
              appointmentDate: new Date(dto.newDate),
              startAt: startDt.toJSDate(),
              endAt: endDt.toJSDate(),
              stylistId: targetStylistId,
              status: AppointmentStatus.CONFIRMED,
            },
            include: appointmentInclude,
          });
        },
        { timeout: 15000 },
      );

      const formatted = this.formatAppointment(updated);
      this.emitSalonEvent(salonId, 'RESCHEDULED', formatted);
      return formatted;
    } catch (err: any) {
      if (err?.code === '23P01') {
        throw new ConflictException(
          'A concurrent booking just took this slot. Please select another time.',
        );
      }
      if (
        err instanceof ConflictException ||
        err instanceof BadRequestException ||
        err instanceof NotFoundException
      ) {
        throw err;
      }
      this.logger.error(`Error rescheduling appointment: ${err.message}`, err.stack);
      throw err;
    }
  }

  async addServiceToAppointment(salonId: string, appointmentId: string, serviceId: string) {
    const appointment = await this.getAppointmentById(salonId, appointmentId);
    if (![AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_SERVICE].includes(appointment.status)) {
      throw new BadRequestException('No active confirmed appointment found for add-on modification.');
    }

    const extraService = await this.prisma.service.findFirst({
      where: { id: serviceId, salonId, status: 'ACTIVE' },
    });

    if (!extraService) {
      throw new NotFoundException('Service not found or inactive.');
    }

    const newEndAt = DateTime.fromJSDate(appointment.endAt)
      .plus({ minutes: extraService.durationMinutes })
      .toJSDate();

    // Check salon closing time and break window boundaries
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      include: { workingHours: true },
    });
    const tz = salon?.timezone || 'Asia/Kolkata';
    const apptDt = DateTime.fromJSDate(appointment.startAt).setZone(tz);
    const dayOfWeek = apptDt.weekdayLong?.toUpperCase() as any;

    const workingHours = salon?.workingHours?.find((wh) => wh.dayOfWeek === dayOfWeek);

    if (workingHours && !workingHours.isClosed) {
      const [closeHour, closeMin] = workingHours.endTime.split(':').map(Number);
      const salonClosingAt = apptDt.set({ hour: closeHour, minute: closeMin, second: 0, millisecond: 0 }).toJSDate();

      if (newEndAt > salonClosingAt) {
        return {
          success: false,
          conflict: true,
          conflictBooking: {
            stylist: appointment.stylist,
            staff: appointment.stylist,
            stylistId: appointment.stylistId,
            name: 'Salon Closing Time',
          },
          extraService,
        };
      }

      if (workingHours.breakStartTime && workingHours.breakEndTime) {
        const [bStartH, bStartM] = workingHours.breakStartTime.split(':').map(Number);
        const [bEndH, bEndM] = workingHours.breakEndTime.split(':').map(Number);
        const breakStartAt = apptDt.set({ hour: bStartH, minute: bStartM, second: 0, millisecond: 0 }).toJSDate();
        const breakEndAt = apptDt.set({ hour: bEndH, minute: bEndM, second: 0, millisecond: 0 }).toJSDate();

        if (newEndAt > breakStartAt && appointment.endAt < breakEndAt) {
          return {
            success: false,
            conflict: true,
            conflictBooking: {
              stylist: appointment.stylist,
              staff: appointment.stylist,
              stylistId: appointment.stylistId,
              name: 'Salon Break Time',
            },
            extraService,
          };
        }
      }
    }

    // Check if stylist has conflicting appointment
    const conflictBooking = await this.prisma.appointment.findFirst({
      where: {
        salonId,
        stylistId: appointment.stylistId,
        appointmentDate: appointment.appointmentDate,
        id: { not: appointmentId },
        status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN, AppointmentStatus.IN_SERVICE] },
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

    const existingServicesCount = await this.prisma.appointmentService.count({
      where: { salonId, appointmentId },
    });

    const updatedAppointment = await this.prisma.$transaction(async (tx) => {
      await tx.appointmentService.create({
        data: {
          salonId,
          appointmentId,
          serviceId: extraService.id,
          serviceNameSnapshot: extraService.name,
          durationMinutes: extraService.durationMinutes,
          price: extraService.price,
          orderIndex: existingServicesCount,
        },
      });

      return tx.appointment.update({
        where: { id: appointmentId },
        data: {
          endAt: newEndAt,
          durationMinutes: appointment.durationMinutes + extraService.durationMinutes,
          price: Number(appointment.price) + Number(extraService.price),
          serviceNameSnapshot: `${appointment.serviceNameSnapshot}, ${extraService.name}`,
        },
        include: appointmentInclude,
      });
    });

    const formatted = this.formatAppointment(updatedAppointment);
    return {
      success: true,
      updatedAppointment: {
        ...formatted,
        startTime: formatted.startAt,
        endTime: formatted.endAt,
        staff: formatted.stylist,
      },
      extraService,
    };
  }

  async cancelAppointment(
    salonId: string,
    appointmentId: string,
    reason?: string,
    adminId?: string,
  ) {
    return this.updateAppointmentStatus(
      salonId,
      appointmentId,
      {
        status: AppointmentStatus.CANCELLED,
        reason,
      },
      adminId,
    );
  }
}
