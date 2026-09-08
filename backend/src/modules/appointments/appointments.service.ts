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
    AppointmentStatus.IN_SERVICE,
    AppointmentStatus.CANCELLED,
    AppointmentStatus.NO_SHOW,
    AppointmentStatus.PENDING_RESCHEDULE,
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
  [AppointmentStatus.PENDING_RESCHEDULE]: [
    AppointmentStatus.CONFIRMED,
    AppointmentStatus.CANCELLED,
  ],
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

    // Idempotency Protection: If already in target status or both current and target are CANCELLED/NO_SHOW, return existing record
    const isTargetCancelledNoShow = ([AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW] as string[]).includes(dto.status);
    const isCurrentCancelledNoShow = ([AppointmentStatus.CANCELLED, AppointmentStatus.NO_SHOW] as string[]).includes(appointment.status);
    if (appointment.status === dto.status || (isCurrentCancelledNoShow && isTargetCancelledNoShow)) {
      return appointment;
    }

    const allowedTransitions = VALID_STATUS_TRANSITIONS[appointment.status as AppointmentStatus] || [];
    if (!allowedTransitions.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition appointment status from ${appointment.status} to ${dto.status}.`,
      );
    }

    const nowMs = Date.now();
    const apptStartMs = new Date(appointment.startAt).getTime();
    const hoursRemaining = (apptStartMs - nowMs) / (1000 * 60 * 60);

    // Process Penalty Strike Calculation (< 2 hours remaining & client fault / unresponsive)
    let isPenaltyApplied = false;
    let remainingPenalties = 2;
    let newCount = 0;

    const isClientFault =
      dto.reasonCategory === 'CLIENT_UNRESPONSIVE' ||
      dto.reasonCategory === 'CLIENT_MISTAKE' ||
      !adminId;

    if (
      isTargetCancelledNoShow &&
      isClientFault &&
      dto.reasonCategory !== 'SALON_EMERGENCY' &&
      hoursRemaining < 2 &&
      appointment.salonUserId
    ) {
      const salonUser = await this.prisma.salonUser.findUnique({
        where: { id: appointment.salonUserId },
      });
      const currentCount = salonUser?.yearlyNoShowCount || 0;
      newCount = currentCount + 1;
      remainingPenalties = Math.max(0, 3 - newCount);
      const isBlocked = newCount >= 3;

      await this.prisma.salonUser.update({
        where: { id: appointment.salonUserId },
        data: {
          yearlyNoShowCount: newCount,
          lastNoShowDate: new Date(),
          isBookingBlocked: isBlocked,
        },
      });
      isPenaltyApplied = true;
    }

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: dto.status,
        notes: dto.reason ? `${appointment.notes || ''} [Note: ${dto.reason}]`.trim() : appointment.notes,
      },
      include: appointmentInclude,
    });

    const formatted = this.formatAppointment(updated);
    this.emitSalonEvent(salonId, 'STATUS_UPDATED', formatted);

    // Dispatch Customer WhatsApp Notifications
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      include: { whatsappAccount: true },
    });

    const userPhone = updated.salonUser?.user?.phone;
    const userName = updated.salonUser?.user?.name || 'Customer';

    if (salon && userPhone && salon.whatsappAccount?.phoneNumberId) {
      const phoneNumberId = salon.whatsappAccount.phoneNumberId;
      const tz = salon.timezone || 'Asia/Kolkata';
      const timeStr = DateTime.fromJSDate(new Date(updated.startAt), { zone: tz }).toFormat('hh:mm a');

      if (isTargetCancelledNoShow) {
        if (dto.reasonCategory === 'SALON_EMERGENCY') {
          // Salon Emergency Apology (NO Penalty)
          const apologyMsg = `🙏 *SALON NOTICE: APPOINTMENT CANCELED*\n\nHi *${userName}*, we sincerely apologize! Your appointment for *${timeStr}* at *${salon.name}* was canceled due to a salon emergency.\n\n✨ *No penalty has been applied* to your account. We welcome you to rebook at your convenience!`;
          await this.whatsappService.sendMetaMessage(
            userPhone,
            {
              bodyText: apologyMsg,
              interactiveType: 'button',
              buttons: [{ id: 'btn_book', title: '📅 Book New Visit' }],
            },
            phoneNumberId,
            salonId,
          ).catch(() => {});
        } else if (isPenaltyApplied) {
          // Penalty Strike Notice
          let message = '';
          if (remainingPenalties > 0) {
            message = `⚠️ *LATE CANCELLATION / NO-SHOW PENALTY RECORDED*\n\nHi *${userName}*, your appointment for *${timeStr}* at *${salon.name}* was canceled with less than 2 hours remaining.\n\n⚠️ *Penalty Strike Recorded:* You have *1 penalty strike* recorded. You have *${remainingPenalties} penalty strike(s) remaining* this year before automatic slot booking is locked.`;
          } else {
            message = `⚠️ *ACCOUNT BOOKING LOCKED*\n\nHi *${userName}*, you have accumulated *3 penalty strikes* this year for missed or late-canceled appointments. Automatic slot booking is now locked for your account.\n\n📞 *Please contact the Salon Owner* directly to request access unblock.`;
          }
          await this.whatsappService.sendMetaMessage(
            userPhone,
            {
              bodyText: message,
              interactiveType: 'button',
              buttons: [{ id: 'btn_start', title: '🏠 Main Menu' }],
            },
            phoneNumberId,
            salonId,
          ).catch(() => {});
        }
      } else if (dto.status === AppointmentStatus.CHECKED_IN) {
        const welcomeMsg = `👋 *WELCOME TO ${salon.name.toUpperCase()}!*\n\nHi *${userName}*, you are checked in! Your stylist *${updated.stylist?.name || 'Stylist'}* will call you to the chair shortly.`;
        await this.whatsappService.sendMetaMessage(
          userPhone,
          {
            bodyText: welcomeMsg,
            interactiveType: 'button',
            buttons: [{ id: 'btn_start', title: '🏠 Main Menu' }],
          },
          phoneNumberId,
          salonId,
        ).catch(() => {});
      } else if (dto.status === AppointmentStatus.COMPLETED) {
        const receiptMsg = `✨ *THANK YOU FOR VISITING ${salon.name.toUpperCase()}!*\n\nHi *${userName}*, thank you for visiting us today!\n\n• *Service:* *${updated.serviceNameSnapshot}*\n• *Stylist:* *${updated.stylist?.name || 'Stylist'}*\n• *Total Paid:* *₹${updated.price}*\n\n⭐ *How was your experience today?*`;
        await this.whatsappService.sendMetaMessage(
          userPhone,
          {
            bodyText: receiptMsg,
            interactiveType: 'button',
            buttons: [
              { id: 'btn_start', title: '⭐ Great Service!' },
              { id: 'btn_start', title: '📅 Book Next Visit' },
            ],
          },
          phoneNumberId,
          salonId,
        ).catch(() => {});
      }
    }

    // Trigger Smart Move-Up Broadcast (ONLY if appointment startAt is in the FUTURE: apptStartMs > Date.now())
    if (isTargetCancelledNoShow && apptStartMs > Date.now()) {
      await this.triggerSmartMoveUpBroadcast(formatted).catch((err) => {
        this.logger.warn(`Move-up broadcast trigger warning: ${err.message}`);
      });
    }

    return formatted;
  }


  async proposeAdminReschedule(
    salonId: string,
    appointmentId: string,
    newStartAt: Date,
    newEndAt: Date,
    adminId?: string,
  ) {
    const appointment = await this.getAppointmentById(salonId, appointmentId);
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      include: { whatsappAccount: true },
    });
    if (!salon) throw new NotFoundException('Salon not found');

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status: AppointmentStatus.PENDING_RESCHEDULE,
        proposedStartAt: newStartAt,
        proposedEndAt: newEndAt,
        proposedByAdminId: adminId,
      },
      include: appointmentInclude,
    });

    const formatted = this.formatAppointment(updated);
    this.emitSalonEvent(salonId, 'STATUS_UPDATED', formatted);

    const tz = salon.timezone || 'Asia/Kolkata';
    const dateStr = DateTime.fromJSDate(newStartAt, { zone: tz }).toFormat('dd LLL, EEE');
    const timeStr = DateTime.fromJSDate(newStartAt, { zone: tz }).toFormat('hh:mm a');
    const userPhone = appointment.salonUser?.user?.phone;

    if (userPhone && salon.whatsappAccount?.phoneNumberId) {
      const message = `📅 *RESCHEDULE REQUEST FROM SALON*

Hi *${appointment.salonUser?.user?.name || 'Customer'}*, *${salon.name}* requested to move your appointment to:

• *Date:* *${dateStr}*
• *Time:* *${timeStr}*
• *Stylist:* *${appointment.stylist?.name || 'Stylist'}*

Does this new time work for you?`;

      await this.whatsappService.sendMetaMessage(
        userPhone,
        {
          bodyText: message,
          interactiveType: 'button',
          buttons: [
            { id: `propose_accept_${appointment.id}`, title: '✅ Accept New Time' },
            { id: `propose_decline_${appointment.id}`, title: '❌ Decline & Keep' },
          ],
        },
        salon.whatsappAccount.phoneNumberId,
        salonId,
      ).catch(() => {});
    }

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

  async triggerSmartMoveUpBroadcast(freedAppointment: any): Promise<number> {
    try {
      const salon: any = await this.prisma.salon.findUnique({
        where: { id: freedAppointment.salonId },
        include: { whatsappAccount: true },
      });
      if (!salon) return 0;

      const tz = salon.timezone || 'Asia/Kolkata';
      const freedStart = DateTime.fromJSDate(freedAppointment.startAt, { zone: tz });
      const freedEnd = DateTime.fromJSDate(freedAppointment.endAt, { zone: tz });
      const freedDurationMin = Math.round(freedEnd.diff(freedStart, 'minutes').minutes);

      if (freedDurationMin <= 0) return 0;

      const dateEnd = freedStart.endOf('day').toJSDate();

      const candidateAppointments = await this.prisma.appointment.findMany({
        where: {
          salonId: freedAppointment.salonId,
          stylistId: freedAppointment.stylistId,
          status: AppointmentStatus.CONFIRMED,
          id: { not: freedAppointment.id },
          startAt: {
            gt: freedAppointment.endAt,
            lte: dateEnd,
          },
        },
        include: {
          salonUser: {
            include: { user: true },
          },
          service: true,
          stylist: true,
        },
        orderBy: { startAt: 'asc' },
      });

      let broadcastSentCount = 0;
      const freedSlotTimeStr = freedStart.toFormat('hh:mm a');

      for (const candidate of candidateAppointments) {
        const candidateDurationMin = candidate.durationMinutes || candidate.service?.durationMinutes || 30;

        // STRICT DURATION FILTER: Only notify if candidate service duration <= freed slot duration
        if (candidateDurationMin > freedDurationMin) {
          this.logger.log(
            `Skipping move-up broadcast for appt ${candidate.id}: candidate duration (${candidateDurationMin}m) exceeds freed slot (${freedDurationMin}m)`,
          );
          continue;
        }

        const candidateUser = candidate.salonUser?.user;
        if (!candidateUser?.phone) continue;

        const currentSlotTimeStr = DateTime.fromJSDate(candidate.startAt, { zone: tz }).toFormat('hh:mm a');

        const broadcastMessage = `⚡ *EARLY SLOT AVAILABLE TODAY!*

Hi *${candidateUser.name || 'Customer'}*, a *${freedSlotTimeStr}* slot just freed up today with *${candidate.stylist?.name || 'your stylist'}*!

Would you like to move your *${currentSlotTimeStr}* appointment earlier to *${freedSlotTimeStr}*?`;

        await this.whatsappService.sendMetaMessage(
          candidateUser.phone,
          {
            bodyText: broadcastMessage,
            interactiveType: 'button',
            buttons: [
              { id: `move_up_accept_${candidate.id}_${freedAppointment.id}`, title: `⚡ Move to ${freedSlotTimeStr}` },
              { id: `move_up_decline_${candidate.id}`, title: '⏰ Keep My Time' },
            ],
          },
          salon.whatsappAccount?.phoneNumberId,
          salon.id,
        );

        broadcastSentCount++;
      }

      this.logger.log(
        `Dispatched Smart Move-Up broadcast to ${broadcastSentCount} candidates for freed slot ${freedAppointment.id}`,
      );
      return broadcastSentCount;
    } catch (err) {
      this.logger.error('Error in triggerSmartMoveUpBroadcast:', err);
      return 0;
    }
  }
}
