import {
  Injectable,
  Logger,
  ConflictException,
  BadRequestException,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { AvailabilityService } from '../../availability/availability.service';
import { AvailabilityEngineService } from '../../availability/availability-engine.service';
import { AppointmentEventsService } from '../events/appointment-events.service';
import { CreateAppointmentDto } from '../dto/create-appointment.dto';
import {
  AppointmentStatus,
  BookingSource,
  DayOfWeek,
  StylistStatus,
  ServiceStatus,
  AbsenceStatus,
  LeavePortion,
} from '@prisma/client';
import { DateTime } from 'luxon';
import {
  appointmentInclude,
  formatAppointment,
  hashToSignedInt32,
  sanitizePhone,
} from '../utils/appointment-helpers';

@Injectable()
export class AppointmentCreationService {
  private readonly logger = new Logger(AppointmentCreationService.name);

  constructor(
    private prisma: PrismaService,
    private availabilityService: AvailabilityService,
    private engine: AvailabilityEngineService,
    private eventsService: AppointmentEventsService,
  ) {}

  /**
   * Helper: checks if appointment time window overlaps with stylist leave intervals
   */
  private async isApptOverlappingAbsence(
    absence: any,
    apptStartDt: DateTime,
    apptEndDt: DateTime,
    dayOfWeek: DayOfWeek,
    salonWorkingHours: any,
    tx: any,
    stylist?: any,
  ): Promise<boolean> {
    if (!absence.leavePortion || absence.leavePortion === LeavePortion.FULL_DAY) {
      return true;
    }

    const apptStartMin = apptStartDt.hour * 60 + apptStartDt.minute;
    const apptEndMin = apptEndDt.hour * 60 + apptEndDt.minute;

    const targetStylist = stylist || (await tx.stylist.findUnique({
      where: { id: absence.stylistId },
      select: { id: true, followsSalonSchedule: true },
    }));

    const stylistHours = tx.stylistWorkingHours
      ? (await (tx.stylistWorkingHours.findUnique
        ? tx.stylistWorkingHours.findUnique({ where: { stylistId_dayOfWeek: { stylistId: absence.stylistId, dayOfWeek } } })
        : tx.stylistWorkingHours.findFirst({ where: { stylistId: absence.stylistId, dayOfWeek } })))
      : null;

    const shiftWindow = this.engine.getEffectiveShiftWindow(
      salonWorkingHours,
      targetStylist,
      stylistHours,
    );

    if (!shiftWindow.isWorking || shiftWindow.effectiveOpenMinutes === null || shiftWindow.effectiveCloseMinutes === null) {
      return true; // Salon closed or stylist not working => unavailable
    }

    const leaveBlocks = this.engine.getLeaveBlockedIntervals(
      absence,
      shiftWindow.effectiveOpenMinutes,
      shiftWindow.effectiveCloseMinutes,
      shiftWindow.effectiveBreaks,
    );

    for (const lb of leaveBlocks) {
      if (apptStartMin < lb.end && apptEndMin > lb.start) {
        return true;
      }
    }

    return false;
  }

  /**
   * Dedicated Quick Booking Creation:
   * Fast-tracks slot resolution for today and initiates booking with PENDING_ACCEPTANCE status.
   */
  async createQuickBooking(
    salonId: string,
    dto: {
      customerPhone: string;
      customerName?: string;
      serviceId?: string;
      serviceIds?: string[];
      stylistId?: string;
      startTime?: string;
      notes?: string;
    },
  ) {
    const serviceIds = dto.serviceIds && dto.serviceIds.length > 0
      ? dto.serviceIds
      : dto.serviceId
        ? [dto.serviceId]
        : [];

    if (serviceIds.length === 0) {
      throw new BadRequestException('At least one service must be selected for quick booking.');
    }

    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: { timezone: true, status: true },
    });
    if (!salon || salon.status !== 'ACTIVE') {
      throw new NotFoundException('Salon is inactive or not found.');
    }

    const tz = salon.timezone || 'Asia/Kolkata';
    const todayDateStr = DateTime.now().setZone(tz).toISODate()!;
    let slotTime = dto.startTime;

    if (!slotTime) {
      const earliest = await this.availabilityService.findEarliestAvailableSlotToday(
        salonId,
        serviceIds,
        dto.stylistId || null,
      );
      if (!earliest) {
        throw new ConflictException('No available time slots remain for today.');
      }
      slotTime = earliest.startTime;
    }

    return this.createAppointment(
      salonId,
      {
        customerPhone: dto.customerPhone,
        customerName: dto.customerName || 'Walk-in / WhatsApp Customer',
        serviceIds,
        stylistId: dto.stylistId,
        date: todayDateStr,
        startTime: slotTime,
        source: BookingSource.QUICK_BOOK,
        notes: dto.notes,
      },
      undefined,
      { initialStatus: AppointmentStatus.PENDING_ACCEPTANCE },
    );
  }

  /**
   * Master Appointment Creation Engine:
   * 1. Multi-service resolution & duration/price aggregation
   * 2. Availability checking & past date rejection
   * 3. Customer & SalonUser identity upsert
   * 4. 3-level PostgreSQL advisory locking hierarchy
   * 5. Stylist try-lock resolution & absence/shift window evaluation
   * 6. Atomic database creation & real-time dashboard notification
   */
  async createAppointment(
    salonId: string,
    dto: CreateAppointmentDto,
    createdByAdminId?: string,
    options?: { initialStatus?: AppointmentStatus },
  ) {
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: {
        id: true,
        name: true,
        status: true,
        timezone: true,
        phone: true,
        cancelWindowHours: true,
      },
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
    const nowInSalonZone = DateTime.now().setZone(timezone);
    if (startDt < nowInSalonZone.minus({ minutes: 2 })) {
      throw new ConflictException('The selected appointment time has already passed. Please select a fresh slot.');
    }

    const cleanPhone = sanitizePhone(dto.customerPhone);

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

    // Canonical ISO date string for lock identity & date queries
    const dateStr = dto.date.includes('T') ? dto.date.split('T')[0] : dto.date;

    // 4. Global 3-Level Lock Hierarchy & Atomic Transaction
    const key1 = hashToSignedInt32(`salon:${salonId}`);
    const scheduleKey2 = hashToSignedInt32(`schedule:${dayOfWeek}`);
    const customerKey2 = hashToSignedInt32(`cust:${salonUser.id}:${dateStr}`);

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

          // Fetch salon working hours for leave interval evaluation
          const salonWorkingHours = await tx.salonWorkingHours.findUnique({
            where: { salonId_dayOfWeek: { salonId, dayOfWeek } },
          });

          // Level 3: Stylist Resource Lock
          let assignedStylistId: string | null = null;

          if (requestedStylistId) {
            // Specific Stylist: exclusive lock using normalized dateStr
            const stylistKey2 = hashToSignedInt32(`stylist:${requestedStylistId}:${dateStr}`);
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

            // Re-verify requested stylist has no active leave overlapping this appointment window
            const targetDateObj = new Date(`${dateStr}T00:00:00.000Z`);
            const activeAbsences = await tx.stylistAbsence.findMany({
              where: {
                salonId,
                stylistId: requestedStylistId,
                status: AbsenceStatus.ACTIVE,
                OR: [
                  { startDate: { lte: targetDateObj }, endDate: { gte: targetDateObj } },
                  { absenceDate: targetDateObj },
                ],
              },
            });

            const reqStylistObj = await tx.stylist.findUnique({
              where: { id: requestedStylistId },
              select: { id: true, followsSalonSchedule: true },
            });

            for (const abs of activeAbsences) {
              if (await this.isApptOverlappingAbsence(abs, startDt, endDt, dayOfWeek, salonWorkingHours, tx, reqStylistObj)) {
                throw new ConflictException(
                  'Selected specialist is on leave during the requested appointment time.',
                );
              }
            }

            assignedStylistId = requestedStylistId;
          } else {
            // Any Stylist: Deterministic candidate ordering with try-lock fallback
            const candidateIds = [...matchingSlot.eligibleStaffIds].sort();

            for (const candidateId of candidateIds) {
              const candKey2 = hashToSignedInt32(`stylist:${candidateId}:${dateStr}`);
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
                  // Re-verify candidate has no active absence overlapping this appointment window
                  const targetDateObj = new Date(`${dateStr}T00:00:00.000Z`);
                  const candidateAbsences = await tx.stylistAbsence.findMany({
                    where: {
                      salonId,
                      stylistId: candidateId,
                      status: AbsenceStatus.ACTIVE,
                      OR: [
                        { startDate: { lte: targetDateObj }, endDate: { gte: targetDateObj } },
                        { absenceDate: targetDateObj },
                      ],
                    },
                  });

                  const candStylistObj = await tx.stylist.findUnique({
                    where: { id: candidateId },
                    select: { id: true, followsSalonSchedule: true },
                  });

                  let hasLeaveOverlap = false;
                  for (const abs of candidateAbsences) {
                    if (await this.isApptOverlappingAbsence(abs, startDt, endDt, dayOfWeek, salonWorkingHours, tx, candStylistObj)) {
                      hasLeaveOverlap = true;
                      break;
                    }
                  }

                  if (!hasLeaveOverlap) {
                    assignedStylistId = candidateId;
                    break;
                  }
                }
              }
            }

            if (!assignedStylistId) {
              throw new ConflictException(
                'All eligible specialists are currently occupied or being booked. Please choose another slot.',
              );
            }
          }

          // Re-verify assigned stylist status under lock
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

          // Re-verify stylist absence status under lock
          const activeAbsence = await tx.stylistAbsence.findFirst({
            where: {
              salonId,
              stylistId: assignedStylistId!,
              status: AbsenceStatus.ACTIVE,
              OR: [
                { startDate: { lte: new Date(`${dto.date}T00:00:00.000Z`) }, endDate: { gte: new Date(`${dto.date}T00:00:00.000Z`) } },
                { absenceDate: new Date(`${dto.date}T00:00:00.000Z`) },
              ],
            },
          });
          if (activeAbsence && (!activeAbsence.leavePortion || activeAbsence.leavePortion === 'FULL_DAY')) {
            throw new ConflictException('Selected specialist is marked absent on this date.');
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

          // Enforce Salon Operating Hours & Shift Window
          const currentSalonHours = await tx.salonWorkingHours.findUnique({
            where: { salonId_dayOfWeek: { salonId, dayOfWeek } },
          });

          const stylistHours = tx.stylistWorkingHours
            ? (await (tx.stylistWorkingHours.findUnique
              ? tx.stylistWorkingHours.findUnique({ where: { stylistId_dayOfWeek: { stylistId: assignedStylist.id, dayOfWeek } } })
              : tx.stylistWorkingHours.findFirst({ where: { stylistId: assignedStylist.id, dayOfWeek } })))
            : null;

          const shiftWindow = this.engine.getEffectiveShiftWindow(
            currentSalonHours,
            assignedStylist,
            stylistHours,
          );

          if (!shiftWindow.isWorking || shiftWindow.effectiveOpenMinutes === null || shiftWindow.effectiveCloseMinutes === null) {
            throw new ConflictException(shiftWindow.statusReason || `Salon is closed or specialist is unavailable on ${dayOfWeek}.`);
          }

          const apptStartMin = this.engine.parseTimeStringToMinutes(dto.startTime);
          const apptEndMin = apptStartMin + totalDuration;

          if (apptStartMin < shiftWindow.effectiveOpenMinutes) {
            const openTimeStr = this.engine.formatMinutesToTime(shiftWindow.effectiveOpenMinutes);
            throw new ConflictException(
              `Appointment start time ${dto.startTime} is earlier than working opening time ${openTimeStr}.`,
            );
          }
          if (apptEndMin > shiftWindow.effectiveCloseMinutes) {
            const closeTimeStr = this.engine.formatMinutesToTime(shiftWindow.effectiveCloseMinutes);
            throw new ConflictException(
              `Appointment end time ${this.engine.formatMinutesToTime(apptEndMin)} exceeds working closing time ${closeTimeStr}.`,
            );
          }
          for (const b of shiftWindow.effectiveBreaks) {
            if (apptStartMin < b.end && apptEndMin > b.start) {
              const bStartStr = this.engine.formatMinutesToTime(b.start);
              const bEndStr = this.engine.formatMinutesToTime(b.end);
              throw new ConflictException(
                `Appointment conflicts with break (${bStartStr}-${bEndStr}).`,
              );
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
              status: options?.initialStatus || AppointmentStatus.CONFIRMED,
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

      const formatted = formatAppointment(createdAppt);
      this.eventsService.emitSalonEvent(salonId, 'NEW_BOOKING', formatted);
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
}
