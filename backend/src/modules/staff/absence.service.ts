import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  Inject,
  forwardRef,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { DateTime } from 'luxon';
import { PrismaService } from '../../database/prisma.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { MarkAbsentDto } from './dto/absence.dto';
import {
  AbsenceStatus,
  ReassignmentOutcome,
  DayOfWeek,
  AppointmentStatus,
  StylistStatus,
} from '@prisma/client';

@Injectable()
export class AbsenceService {
  private readonly logger = new Logger(AbsenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly appointmentsService: AppointmentsService,
    @Inject(forwardRef(() => WhatsAppService))
    private readonly whatsappService: WhatsAppService,
  ) {}

  private hashToSignedInt32(input: string): number {
    return crypto.createHash('sha256').update(input).digest().readInt32BE(0);
  }

  private parseTimeStringToMinutes(timeStr: string): number {
    const [hours, mins] = timeStr.split(':').map((v) => parseInt(v, 10));
    return hours * 60 + mins;
  }

  private getDayOfWeekEnum(luxonDateTime: DateTime): DayOfWeek {
    const dayNumber = luxonDateTime.weekday; // 1 = Monday ... 7 = Sunday
    const mapping: Record<number, DayOfWeek> = {
      1: DayOfWeek.MONDAY,
      2: DayOfWeek.TUESDAY,
      3: DayOfWeek.WEDNESDAY,
      4: DayOfWeek.THURSDAY,
      5: DayOfWeek.FRIDAY,
      6: DayOfWeek.SATURDAY,
      7: DayOfWeek.SUNDAY,
    };
    return mapping[dayNumber];
  }

  /**
   * Evaluates candidate replacement stylists for a specific appointment time window.
   */
  async findReplacementStylistCandidate(
    tx: any,
    salonId: string,
    absenceDate: Date,
    serviceIds: string[],
    startAt: Date,
    endAt: Date,
    excludeStylistId: string,
    timezone: string,
  ): Promise<string | null> {
    const luxonStart = DateTime.fromJSDate(startAt).setZone(timezone);
    const luxonEnd = DateTime.fromJSDate(endAt).setZone(timezone);
    const dayOfWeek = this.getDayOfWeekEnum(luxonStart);

    const apptStartMinutes = luxonStart.hour * 60 + luxonStart.minute;
    const apptEndMinutes = luxonEnd.hour * 60 + luxonEnd.minute;

    // Fetch salon working hours for this day of week
    const salonWorkingHours = await tx.salonWorkingHours.findFirst({
      where: { salonId, dayOfWeek },
    });

    // 1. Find all active stylists in this salon qualified for ALL required services
    // and having NO ACTIVE absence on this date
    const candidates = await tx.stylist.findMany({
      where: {
        salonId,
        id: { not: excludeStylistId },
        status: StylistStatus.ACTIVE,
        AND: serviceIds.map((sId) => ({
          services: { some: { serviceId: sId } },
        })),
        absences: {
          none: {
            absenceDate,
            status: AbsenceStatus.ACTIVE,
          },
        },
      },
      include: {
        workingHours: {
          where: { dayOfWeek },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    for (const candidate of candidates) {
      // 2a. Check working hours
      if (candidate.followsSalonSchedule) {
        if (!salonWorkingHours || salonWorkingHours.isClosed) {
          continue; // Salon is closed today
        }
        const salonOpen = this.parseTimeStringToMinutes(salonWorkingHours.startTime);
        const salonClose = this.parseTimeStringToMinutes(salonWorkingHours.endTime);
        if (apptStartMinutes < salonOpen || apptEndMinutes > salonClose) {
          continue; // Appointment falls outside salon hours
        }
        // Check break overlap
        if (salonWorkingHours.breakStartTime && salonWorkingHours.breakEndTime) {
          const bStart = this.parseTimeStringToMinutes(salonWorkingHours.breakStartTime);
          const bEnd = this.parseTimeStringToMinutes(salonWorkingHours.breakEndTime);
          if (apptStartMinutes < bEnd && apptEndMinutes > bStart) {
            continue; // Overlaps salon break
          }
        }
      } else {
        const staffHours = candidate.workingHours[0];
        if (!staffHours || !staffHours.isWorking) {
          continue; // Stylist not working today
        }
        const staffOpen = this.parseTimeStringToMinutes(staffHours.startTime);
        const staffClose = this.parseTimeStringToMinutes(staffHours.endTime);
        if (apptStartMinutes < staffOpen || apptEndMinutes > staffClose) {
          continue; // Appointment falls outside staff hours
        }
        // Check break overlap
        if (staffHours.breakStartTime && staffHours.breakEndTime) {
          const bStart = this.parseTimeStringToMinutes(staffHours.breakStartTime);
          const bEnd = this.parseTimeStringToMinutes(staffHours.breakEndTime);
          if (apptStartMinutes < bEnd && apptEndMinutes > bStart) {
            continue; // Overlaps staff break
          }
        }
      }

      // 2b. Check appointment conflict under advisory lock
      const key1 = this.hashToSignedInt32(`salon:${salonId}`);
      const dateIso = DateTime.fromJSDate(absenceDate, { zone: 'UTC' }).toISODate()!;
      const candLockKey = this.hashToSignedInt32(`stylist:${candidate.id}:${dateIso}`);
      await tx.$executeRawUnsafe(
        'SELECT pg_advisory_xact_lock($1, $2)',
        key1,
        candLockKey,
      );

      const conflictAppt = await tx.appointment.findFirst({
        where: {
          salonId,
          stylistId: candidate.id,
          status: {
            in: [
              AppointmentStatus.CONFIRMED,
              AppointmentStatus.CHECKED_IN,
              AppointmentStatus.IN_SERVICE,
            ],
          },
          startAt: { lt: endAt },
          endAt: { gt: startAt },
        },
      });

      if (!conflictAppt) {
        // Suitable candidate found!
        return candidate.id;
      }
    }

    return null;
  }

  /**
   * Main orchestrator: Marks a stylist absent and handles booking reassignments.
   */
  async markStylistAbsent(
    salonId: string,
    stylistId: string,
    dto: MarkAbsentDto,
    adminId?: string,
  ) {
    // 1. Verify stylist belongs to salon
    const stylist = await this.prisma.stylist.findFirst({
      where: { id: stylistId, salonId },
      select: { id: true, name: true, phone: true },
    });
    if (!stylist) {
      throw new NotFoundException('Stylist not found in this salon.');
    }

    // 2. Fetch salon details & timezone
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
    });
    if (!salon) {
      throw new NotFoundException('Salon not found.');
    }
    const timezone = salon.timezone || 'Asia/Kolkata';

    // Normalize date format (supports YYYY-MM-DD or full ISO strings) and ensure not in past
    const dateIso = dto.date.includes('T') ? dto.date.split('T')[0] : dto.date;
    const dateParsed = DateTime.fromISO(dateIso, { zone: timezone }).startOf('day');
    if (!dateParsed.isValid) {
      throw new BadRequestException('Invalid date. Format must be YYYY-MM-DD.');
    }

    const todayInSalon = DateTime.now().setZone(timezone).startOf('day');
    if (dateParsed < todayInSalon) {
      throw new BadRequestException('Cannot mark absence for a past date.');
    }

    const absenceDateObj = new Date(`${dateIso}T00:00:00.000Z`);

    // 3. Execute absence & reassignment in transaction
    const { absence, reassignmentsToNotify, summaryDetails } = await this.prisma.$transaction(
      async (tx) => {
        // Advisory locks to serialize absence marking for this stylist and date
        // Uses stylist:${stylistId}:${dateIso} to synchronize directly with appointment booking creation
        const key1 = this.hashToSignedInt32(`salon:${salonId}`);
        const stylistLockKey = this.hashToSignedInt32(`stylist:${stylistId}:${dateIso}`);
        await tx.$executeRawUnsafe(
          'SELECT pg_advisory_xact_lock($1, $2)',
          key1,
          stylistLockKey,
        );

        // Upsert StylistAbsence (Idempotency)
        const currentAbsence = await tx.stylistAbsence.upsert({
          where: {
            salonId_stylistId_absenceDate: {
              salonId,
              stylistId,
              absenceDate: absenceDateObj,
            },
          },
          update: {
            status: AbsenceStatus.ACTIVE,
            reason: dto.reason || null,
            notes: dto.notes || null,
            createdByAdminId: adminId || null,
          },
          create: {
            salonId,
            stylistId,
            absenceDate: absenceDateObj,
            reason: dto.reason || null,
            notes: dto.notes || null,
            status: AbsenceStatus.ACTIVE,
            createdByAdminId: adminId || null,
          },
        });

        // Find affected bookings (CONFIRMED or CHECKED_IN; skip IN_SERVICE)
        const affectedBookings = await tx.appointment.findMany({
          where: {
            salonId,
            stylistId,
            appointmentDate: absenceDateObj,
            status: {
              in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN],
            },
          },
          include: {
            services: { select: { serviceId: true } },
            salonUser: { include: { user: true } },
          },
          orderBy: { startAt: 'asc' },
        });

        let reassignedCount = 0;
        let unresolvableCount = 0;
        const reassignmentsToNotify: string[] = [];
        const summaryDetails: any[] = [];

        for (const appt of affectedBookings) {
          const serviceIds =
            appt.services && appt.services.length > 0
              ? appt.services.map((s) => s.serviceId)
              : [appt.serviceId];

          const replacementId = await this.findReplacementStylistCandidate(
            tx,
            salonId,
            absenceDateObj,
            serviceIds,
            appt.startAt,
            appt.endAt,
            stylistId,
            timezone,
          );

          if (replacementId) {
            // Update appointment stylist
            await tx.appointment.update({
              where: { id: appt.id },
              data: {
                stylistId: replacementId,
                notes: `${appt.notes || ''} [Reassigned from ${stylist.name} due to absence]`.trim(),
              },
            });

            // Record reassignment
            const reassignment = await tx.bookingReassignment.upsert({
              where: {
                appointmentId_absenceId: {
                  appointmentId: appt.id,
                  absenceId: currentAbsence.id,
                },
              },
              update: {
                originalStylistId: stylistId,
                newStylistId: replacementId,
                originalStartAt: appt.startAt,
                originalEndAt: appt.endAt,
                newStartAt: appt.startAt,
                newEndAt: appt.endAt,
                outcome: ReassignmentOutcome.AUTO_ASSIGNED,
                processedAt: new Date(),
              },
              create: {
                salonId,
                appointmentId: appt.id,
                absenceId: currentAbsence.id,
                originalStylistId: stylistId,
                newStylistId: replacementId,
                originalStartAt: appt.startAt,
                originalEndAt: appt.endAt,
                newStartAt: appt.startAt,
                newEndAt: appt.endAt,
                outcome: ReassignmentOutcome.AUTO_ASSIGNED,
                processedAt: new Date(),
              },
            });

            reassignedCount++;
            reassignmentsToNotify.push(reassignment.id);
            summaryDetails.push({
              appointmentId: appt.id,
              appointmentNumber: appt.appointmentNumber,
              startAt: appt.startAt,
              customerName: appt.salonUser?.user?.name || 'Customer',
              customerPhone: appt.salonUser?.user?.phone,
              outcome: ReassignmentOutcome.AUTO_ASSIGNED,
              newStylistId: replacementId,
            });
          } else {
            // No replacement found
            const reassignment = await tx.bookingReassignment.upsert({
              where: {
                appointmentId_absenceId: {
                  appointmentId: appt.id,
                  absenceId: currentAbsence.id,
                },
              },
              update: {
                originalStylistId: stylistId,
                newStylistId: null,
                originalStartAt: appt.startAt,
                originalEndAt: appt.endAt,
                newStartAt: null,
                newEndAt: null,
                outcome: ReassignmentOutcome.NO_REPLACEMENT,
                processedAt: new Date(),
              },
              create: {
                salonId,
                appointmentId: appt.id,
                absenceId: currentAbsence.id,
                originalStylistId: stylistId,
                newStylistId: null,
                originalStartAt: appt.startAt,
                originalEndAt: appt.endAt,
                newStartAt: null,
                newEndAt: null,
                outcome: ReassignmentOutcome.NO_REPLACEMENT,
                processedAt: new Date(),
              },
            });

            unresolvableCount++;
            reassignmentsToNotify.push(reassignment.id);
            summaryDetails.push({
              appointmentId: appt.id,
              appointmentNumber: appt.appointmentNumber,
              startAt: appt.startAt,
              customerName: appt.salonUser?.user?.name || 'Customer',
              customerPhone: appt.salonUser?.user?.phone,
              outcome: ReassignmentOutcome.NO_REPLACEMENT,
              newStylistId: null,
            });
          }
        }

        // Update StylistAbsence counters
        const finalAbsence = await tx.stylistAbsence.update({
          where: { id: currentAbsence.id },
          data: {
            affectedBookingsCount: affectedBookings.length,
            reassignedCount,
            unresolvableCount,
          },
          include: {
            stylist: { select: { id: true, name: true, phone: true } },
          },
        });

        // Create AuditLog entry
        await tx.auditLog.create({
          data: {
            salonId,
            adminId: adminId || null,
            action: 'MARK_STYLIST_ABSENT',
            entityType: 'StylistAbsence',
            entityId: finalAbsence.id,
            metadata: {
              stylistId,
              stylistName: stylist.name,
              date: dto.date,
              reason: dto.reason,
              affectedBookingsCount: affectedBookings.length,
              reassignedCount,
              unresolvableCount,
            },
          },
        }).catch((err) => {
          this.logger.warn(`AuditLog creation failed: ${err.message}`);
        });

        return {
          absence: finalAbsence,
          reassignmentsToNotify,
          summaryDetails,
        };
      },
      { timeout: 30000 },
    );

    // 4. Outside transaction: Emit Realtime events
    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      staffId: stylistId,
      action: 'ABSENCE_MARKED',
      absenceId: absence.id,
    });
    this.appointmentsService.emitSalonEvent(salonId, 'APPOINTMENT_UPDATED', {
      action: 'ABSENCE_REASSIGNMENT',
      absenceId: absence.id,
    });

    // 5. Fire WhatsApp notifications asynchronously (fire-and-forget)
    for (const reassignmentId of reassignmentsToNotify) {
      this.sendAbsenceNotification(reassignmentId).catch((err) => {
        this.logger.error(
          `Failed to dispatch absence notification for reassignment ${reassignmentId}: ${err.message}`,
          err.stack,
        );
      });
    }

    return {
      absence,
      reassignmentSummary: {
        total: absence.affectedBookingsCount,
        reassigned: absence.reassignedCount,
        unresolvable: absence.unresolvableCount,
        details: summaryDetails,
      },
    };
  }

  /**
   * Read-only preview of what would happen if a stylist is marked absent on a given date.
   */
  async previewAbsenceImpact(salonId: string, stylistId: string, dateStr: string) {
    const stylist = await this.prisma.stylist.findFirst({
      where: { id: stylistId, salonId },
      select: { id: true, name: true, phone: true },
    });
    if (!stylist) {
      throw new NotFoundException('Stylist not found in this salon.');
    }

    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
    });
    if (!salon) {
      throw new NotFoundException('Salon not found.');
    }
    const timezone = salon.timezone || 'Asia/Kolkata';

    const dateIso = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
    const absenceDateObj = new Date(`${dateIso}T00:00:00.000Z`);

    const affectedBookings = await this.prisma.appointment.findMany({
      where: {
        salonId,
        stylistId,
        appointmentDate: absenceDateObj,
        status: {
          in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN],
        },
      },
      include: {
        services: { select: { serviceId: true } },
        salonUser: { include: { user: true } },
      },
      orderBy: { startAt: 'asc' },
    });

    const candidatePreview = [];

    for (const appt of affectedBookings) {
      const serviceIds =
        appt.services && appt.services.length > 0
          ? appt.services.map((s) => s.serviceId)
          : [appt.serviceId];

      const replacementId = await this.findReplacementStylistCandidate(
        this.prisma,
        salonId,
        absenceDateObj,
        serviceIds,
        appt.startAt,
        appt.endAt,
        stylistId,
        timezone,
      );

      let replacementStylist = null;
      if (replacementId) {
        replacementStylist = await this.prisma.stylist.findUnique({
          where: { id: replacementId },
          select: { id: true, name: true },
        });
      }

      candidatePreview.push({
        appointmentId: appt.id,
        appointmentNumber: appt.appointmentNumber,
        serviceName: appt.serviceNameSnapshot,
        startAt: appt.startAt,
        endAt: appt.endAt,
        customerName: appt.salonUser?.user?.name || 'Customer',
        customerPhone: appt.salonUser?.user?.phone,
        potentialReplacement: replacementStylist,
        willReassign: !!replacementStylist,
      });
    }

    return {
      stylist,
      date: dateStr,
      affectedBookingsCount: affectedBookings.length,
      canAutoReassignCount: candidatePreview.filter((c) => c.willReassign).length,
      unresolvableCount: candidatePreview.filter((c) => !c.willReassign).length,
      details: candidatePreview,
    };
  }

  /**
   * Retrieves absences for a stylist with reassignment history.
   */
  async getStylistAbsences(
    salonId: string,
    stylistId: string,
    filters?: { startDate?: string; endDate?: string },
  ) {
    const stylist = await this.prisma.stylist.findFirst({
      where: { id: stylistId, salonId },
    });
    if (!stylist) {
      throw new NotFoundException('Stylist not found in this salon.');
    }

    const whereClause: any = {
      salonId,
      stylistId,
    };

    const parseFilterDate = (d?: string) => {
      if (!d) return undefined;
      const iso = d.includes('T') ? d.split('T')[0] : d;
      return new Date(`${iso}T00:00:00.000Z`);
    };

    if (filters?.startDate && filters?.endDate) {
      whereClause.absenceDate = {
        gte: parseFilterDate(filters.startDate),
        lte: parseFilterDate(filters.endDate),
      };
    } else if (filters?.startDate) {
      whereClause.absenceDate = {
        gte: parseFilterDate(filters.startDate),
      };
    } else if (filters?.endDate) {
      whereClause.absenceDate = {
        lte: parseFilterDate(filters.endDate),
      };
    }

    return this.prisma.stylistAbsence.findMany({
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
      orderBy: { absenceDate: 'desc' },
    });
  }

  /**
   * Cancels/reverses an absence. Per confirmed Decision D3, existing reassignments
   * are left as-is so customers are not disrupted twice.
   */
  async cancelAbsence(
    salonId: string,
    stylistId: string,
    absenceId: string,
    adminId?: string,
  ) {
    const absence = await this.prisma.stylistAbsence.findFirst({
      where: { id: absenceId, salonId, stylistId },
    });
    if (!absence) {
      throw new NotFoundException('Absence record not found.');
    }

    const updated = await this.prisma.stylistAbsence.update({
      where: { id: absenceId },
      data: { status: AbsenceStatus.CANCELLED },
      include: { stylist: { select: { id: true, name: true } } },
    });

    await this.prisma.auditLog.create({
      data: {
        salonId,
        adminId: adminId || null,
        action: 'CANCEL_STYLIST_ABSENCE',
        entityType: 'StylistAbsence',
        entityId: absenceId,
        metadata: { stylistId, stylistName: updated.stylist?.name },
      },
    }).catch((err) => {
      this.logger.warn(`AuditLog creation failed: ${err.message}`);
    });

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      staffId: stylistId,
      action: 'ABSENCE_CANCELLED',
      absenceId,
    });

    return updated;
  }

  /**
   * Dispatches WhatsApp notification for an individual reassignment.
   */
  async sendAbsenceNotification(reassignmentId: string): Promise<void> {
    const reassignment = await this.prisma.bookingReassignment.findUnique({
      where: { id: reassignmentId },
      include: {
        appointment: {
          include: {
            salonUser: { include: { user: true } },
            stylist: true,
          },
        },
        absence: {
          include: {
            stylist: true,
            salon: { include: { whatsappAccount: true } },
          },
        },
      },
    });

    if (!reassignment || !reassignment.appointment || !reassignment.absence) {
      this.logger.warn(
        `Cannot send absence notification: Reassignment ${reassignmentId} not found or incomplete.`,
      );
      return;
    }

    // Prevent duplicate notification
    if (reassignment.notificationSentAt) {
      return;
    }

    const salon = reassignment.absence.salon;
    const phoneNumberId = salon.whatsappAccount?.phoneNumberId;
    const recipientPhone = reassignment.appointment.salonUser?.user?.phone;
    const customerName =
      reassignment.appointment.salonUser?.user?.name || 'Valued Customer';

    if (!phoneNumberId || !recipientPhone) {
      this.logger.warn(
        `Skipping WhatsApp notification: Missing phoneNumberId or recipientPhone for reassignment ${reassignmentId}`,
      );
      return;
    }

    const tz = salon.timezone || 'Asia/Kolkata';
    const apptDateStr = DateTime.fromJSDate(reassignment.appointment.startAt, {
      zone: tz,
    }).toFormat('dd LLL yyyy');
    const apptTimeStr = DateTime.fromJSDate(reassignment.appointment.startAt, {
      zone: tz,
    }).toFormat('hh:mm a');
    const originalStylistName = reassignment.absence.stylist.name;
    const serviceName = reassignment.appointment.serviceNameSnapshot || 'Salon Service';
    const price = reassignment.appointment.price || 0;
    const apptNum = reassignment.appointment.appointmentNumber;

    try {
      if (reassignment.outcome === ReassignmentOutcome.AUTO_ASSIGNED) {
        // Fetch new stylist name
        let newStylistName = 'a top stylist';
        if (reassignment.newStylistId) {
          const newStylist = await this.prisma.stylist.findUnique({
            where: { id: reassignment.newStylistId },
            select: { name: true },
          });
          if (newStylist) newStylistName = newStylist.name;
        }

        const bodyText =
          `📋 *APPOINTMENT UPDATE*\n\n` +
          `Hi *${customerName}*,\n\n` +
          `We wanted to let you know that your specialist *${originalStylistName}* is unavailable on *${apptDateStr}*.\n\n` +
          `Your appointment has been reassigned to *${newStylistName}* at the same time:\n\n` +
          `• ✂️ Service: *${serviceName}* (₹${price})\n` +
          `• 👤 New Specialist: *${newStylistName}*\n` +
          `• 📅 Date: *${apptDateStr}*\n` +
          `• ⏰ Time: *${apptTimeStr}*\n` +
          `• 📌 Ref: *#${apptNum}*\n\n` +
          `What would you like to do?`;

        await this.whatsappService.sendMetaMessage(
          recipientPhone,
          {
            bodyText,
            interactiveType: 'button',
            buttons: [
              {
                id: `absence_accept_${reassignment.id}`,
                title: '✅ Keep Appointment',
              },
              {
                id: `absence_reschedule_${reassignment.appointmentId}`,
                title: '🔄 Reschedule',
              },
              {
                id: `absence_cancel_${reassignment.appointmentId}`,
                title: '✕ Cancel',
              },
            ],
          },
          phoneNumberId,
          salon.id,
        );

        // Record in Notification model
        await this.prisma.notification.create({
          data: {
            salonId: salon.id,
            appointmentId: reassignment.appointmentId,
            userId: reassignment.appointment.salonUser?.userId,
            recipientPhone,
            channel: 'WHATSAPP',
            messageBody: bodyText,
            status: 'DELIVERED',
            sentAt: new Date(),
          },
        }).catch(() => {});

        // Mark reassignment notification sent
        await this.prisma.bookingReassignment.update({
          where: { id: reassignment.id },
          data: {
            notificationSentAt: new Date(),
            notificationFailed: false,
          },
        });
      } else if (reassignment.outcome === ReassignmentOutcome.NO_REPLACEMENT) {
        const bodyText =
          `⚠️ *APPOINTMENT NOTICE*\n\n` +
          `Hi *${customerName}*,\n\n` +
          `Unfortunately, your specialist *${originalStylistName}* is unavailable on *${apptDateStr}*, and we were unable to find another available specialist for your *${apptTimeStr}* appointment at *${salon.name}*.\n\n` +
          `• ✂️ Service: *${serviceName}*\n` +
          `• 📅 Date: *${apptDateStr}*\n` +
          `• ⏰ Time: *${apptTimeStr}*\n` +
          `• 📌 Ref: *#${apptNum}*\n\n` +
          `We'd like to help you find an alternative time or adjust your visit:`;

        await this.whatsappService.sendMetaMessage(
          recipientPhone,
          {
            bodyText,
            interactiveType: 'button',
            buttons: [
              {
                id: `absence_reschedule_${reassignment.appointmentId}`,
                title: '🔄 Choose New Time',
              },
              {
                id: `absence_cancel_nofault_${reassignment.appointmentId}`,
                title: '✕ Cancel Booking',
              },
            ],
          },
          phoneNumberId,
          salon.id,
        );

        // Record in Notification model
        await this.prisma.notification.create({
          data: {
            salonId: salon.id,
            appointmentId: reassignment.appointmentId,
            userId: reassignment.appointment.salonUser?.userId,
            recipientPhone,
            channel: 'WHATSAPP',
            messageBody: bodyText,
            status: 'DELIVERED',
            sentAt: new Date(),
          },
        }).catch(() => {});

        // Mark reassignment notification sent
        await this.prisma.bookingReassignment.update({
          where: { id: reassignment.id },
          data: {
            notificationSentAt: new Date(),
            notificationFailed: false,
          },
        });
      }
    } catch (err: any) {
      this.logger.error(
        `Failed to send absence notification to ${recipientPhone}: ${err.message}`,
      );
      await this.prisma.bookingReassignment.update({
        where: { id: reassignment.id },
        data: { notificationFailed: true },
      }).catch(() => {});
    }
  }
}
