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
import { MarkAbsentDto, PreviewAbsenceQueryDto, GetAbsencesQueryDto, ExtendLeaveDto } from './dto/absence.dto';
import { LeaveValidationService } from './services/leave-validation.service';
import { LeaveIntervalEngine } from './engines/leave-interval.engine';
import { LeaveReassignmentEngine } from './engines/leave-reassignment.engine';
import { LeaveProcessingService } from './services/leave-processing.service';
import {
  AbsenceStatus,
  ReassignmentOutcome,
  DayOfWeek,
  AppointmentStatus,
  LeaveType,
  LeavePortion,
  LeaveProcessingStatus,
} from '@prisma/client';

@Injectable()
export class AbsenceService {
  private readonly logger = new Logger(AbsenceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly validationService: LeaveValidationService,
    private readonly intervalEngine: LeaveIntervalEngine,
    private readonly reassignmentEngine: LeaveReassignmentEngine,
    private readonly processingService: LeaveProcessingService,
    private readonly appointmentsService: AppointmentsService,
    @Inject(forwardRef(() => WhatsAppService))
    private readonly whatsappService: WhatsAppService,
  ) {}

  private hashToSignedInt32(input: string): number {
    return crypto.createHash('sha256').update(input).digest().readInt32BE(0);
  }

  private getDayOfWeekEnum(luxonDateTime: DateTime): DayOfWeek {
    const dayNumber = luxonDateTime.weekday;
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
   * Main orchestrator: Marks a stylist absent / creates leave and handles booking reassignments.
   */
  async markStylistAbsent(
    salonId: string,
    stylistId: string,
    dto: MarkAbsentDto,
    adminId?: string,
  ) {
    const { stylist, timezone } = await this.validationService.validateStylistAndSalon(salonId, stylistId);
    const normalizedDates = this.validationService.validateAndNormalizeDates(dto, timezone);
    this.validationService.validateLeavePortion(dto.leavePortion, dto.customStartTime, dto.customEndTime);

    const result = await this.processingService.processLeaveCreation(
      salonId,
      stylistId,
      stylist,
      dto,
      normalizedDates,
      timezone,
      adminId,
    );

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      staffId: stylistId,
      action: 'ABSENCE_MARKED',
      absenceId: result.absence.id,
    });
    this.appointmentsService.emitSalonEvent(salonId, 'APPOINTMENT_UPDATED', {
      action: 'ABSENCE_REASSIGNMENT',
      absenceId: result.absence.id,
    });

    for (const reassignmentId of result.reassignmentsToNotify) {
      this.sendAbsenceNotification(reassignmentId).catch((err) => {
        this.logger.error(
          `Failed to dispatch absence notification for reassignment ${reassignmentId}: ${err.message}`,
          err.stack,
        );
      });
    }

    return {
      absence: result.absence,
      reassignmentSummary: {
        total: result.absence.affectedBookingsCount,
        reassigned: result.absence.reassignedCount,
        unresolvable: result.absence.unresolvableCount,
        details: result.summaryDetails,
      },
    };
  }

  /**
   * Incremental Leave Extension: Extends endDate and evaluates reassignments strictly for newly added dates.
   */
  async extendStylistLeave(
    salonId: string,
    stylistId: string,
    absenceId: string,
    dto: ExtendLeaveDto,
    adminId?: string,
  ) {
    const existingAbsence = await this.prisma.stylistAbsence.findFirst({
      where: { id: absenceId, salonId, stylistId },
    });
    if (!existingAbsence) {
      throw new NotFoundException('Leave record not found.');
    }

    const { stylist, timezone } = await this.validationService.validateStylistAndSalon(salonId, stylistId);
    const extension = this.validationService.validateLeaveExtension(existingAbsence, dto, timezone);

    const { updatedAbsence, reassignmentsToNotify, summaryDetails } = await this.prisma.$transaction(
      async (tx) => {
        let curr = extension.incrementalStartParsed;
        const incrementalDates: DateTime[] = [];
        while (curr <= extension.newEndDateParsed) {
          incrementalDates.push(curr);
          curr = curr.plus({ days: 1 });
        }

        let newReassigned = 0;
        let newUnresolvable = 0;
        let newAffected = 0;
        const reassignmentsToNotify: string[] = [];
        const summaryDetails: any[] = [];
        const followsSalon = stylist.followsSalonSchedule ?? true;

        for (const dateDt of incrementalDates) {
          const dateStr = dateDt.toISODate()!;
          const dateObj = new Date(`${dateStr}T00:00:00.000Z`);
          const dayOfWeek = this.getDayOfWeekEnum(dateDt);

          const key1 = this.hashToSignedInt32(`salon:${salonId}`);
          const stylistLockKey = this.hashToSignedInt32(`stylist:${stylistId}:${dateStr}`);
          await tx.$executeRawUnsafe(
            'SELECT pg_advisory_xact_lock($1::integer, $2::integer)',
            key1,
            stylistLockKey,
          );

          const schedule = await this.processingService.resolveDaySchedule(
            tx,
            salonId,
            stylistId,
            followsSalon,
            dayOfWeek,
          );

          const blockedInterval = this.intervalEngine.getLeaveBlockedMinutes(
            existingAbsence.leavePortion,
            existingAbsence.customStartTime || undefined,
            existingAbsence.customEndTime || undefined,
            schedule,
          );

          if (!blockedInterval) continue;

          const apptsOnDate = await tx.appointment.findMany({
            where: {
              salonId,
              stylistId,
              appointmentDate: dateObj,
              status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN] },
            },
            include: {
              services: { select: { serviceId: true } },
              salonUser: { include: { user: true } },
            },
            orderBy: { startAt: 'asc' },
          });

          for (const appt of apptsOnDate) {
            const apptStartDt = DateTime.fromJSDate(appt.startAt).setZone(timezone);
            const apptEndDt = DateTime.fromJSDate(appt.endAt).setZone(timezone);
            const apptStartMin = apptStartDt.hour * 60 + apptStartDt.minute;
            const apptEndMin = apptEndDt.hour * 60 + apptEndDt.minute;

            if (this.intervalEngine.isAppointmentOverlappingLeave(apptStartMin, apptEndMin, blockedInterval)) {
              newAffected++;
              const serviceIds =
                appt.services && appt.services.length > 0
                  ? appt.services.map((s: any) => s.serviceId)
                  : [appt.serviceId];

              const replacementId = await this.reassignmentEngine.findReplacementStylistCandidate(
                tx,
                salonId,
                dateObj,
                serviceIds,
                appt.startAt,
                appt.endAt,
                stylistId,
                timezone,
              );

              if (replacementId) {
                await tx.appointment.update({
                  where: { id: appt.id },
                  data: {
                    stylistId: replacementId,
                    notes: `${appt.notes || ''} [Reassigned due to leave extension]`.trim(),
                  },
                });

                const reassignment = await tx.bookingReassignment.upsert({
                  where: {
                    appointmentId_absenceId: {
                      appointmentId: appt.id,
                      absenceId: existingAbsence.id,
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
                    absenceId: existingAbsence.id,
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

                newReassigned++;
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
                const reassignment = await tx.bookingReassignment.upsert({
                  where: {
                    appointmentId_absenceId: {
                      appointmentId: appt.id,
                      absenceId: existingAbsence.id,
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
                    absenceId: existingAbsence.id,
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

                newUnresolvable++;
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
          }
        }

        const updated = await tx.stylistAbsence.update({
          where: { id: absenceId },
          data: {
            endDate: extension.newEndDateObj,
            affectedBookingsCount: existingAbsence.affectedBookingsCount + newAffected,
            reassignedCount: existingAbsence.reassignedCount + newReassigned,
            unresolvableCount: existingAbsence.unresolvableCount + newUnresolvable,
            processingStatus: LeaveProcessingStatus.COMPLETED,
          },
          include: {
            stylist: { select: { id: true, name: true } },
          },
        });

        return {
          updatedAbsence: updated,
          reassignmentsToNotify,
          summaryDetails,
        };
      },
      { timeout: 30000 },
    );

    this.appointmentsService.emitSalonEvent(salonId, 'STAFF_UPDATED', {
      staffId: stylistId,
      action: 'ABSENCE_EXTENDED',
      absenceId,
    });

    for (const reassignmentId of reassignmentsToNotify) {
      this.sendAbsenceNotification(reassignmentId).catch((err) => {
        this.logger.error(
          `Failed to dispatch notification for extended reassignment ${reassignmentId}: ${err.message}`,
        );
      });
    }

    return {
      absence: updatedAbsence,
      reassignmentSummary: {
        totalAdded: reassignmentsToNotify.length,
        details: summaryDetails,
      },
    };
  }

  /**
   * Preview leave impact across date range.
   */
  async previewAbsenceImpact(salonId: string, stylistId: string, query: PreviewAbsenceQueryDto) {
    const { stylist, timezone } = await this.validationService.validateStylistAndSalon(salonId, stylistId);
    const normalizedDates = this.validationService.validateAndNormalizeDates(query, timezone, true);
    const leavePortion = query.leavePortion || LeavePortion.FULL_DAY;

    let curr = normalizedDates.startDateParsed;
    const datesList: DateTime[] = [];
    while (curr <= normalizedDates.endDateParsed) {
      datesList.push(curr);
      curr = curr.plus({ days: 1 });
    }

    const candidatePreview: any[] = [];
    const followsSalon = stylist.followsSalonSchedule ?? true;

    for (const dateDt of datesList) {
      const dateStr = dateDt.toISODate()!;
      const dateObj = new Date(`${dateStr}T00:00:00.000Z`);
      const dayOfWeek = this.getDayOfWeekEnum(dateDt);

      const schedule = await this.processingService.resolveDaySchedule(
        this.prisma,
        salonId,
        stylistId,
        followsSalon,
        dayOfWeek,
      );

      const blockedInterval = this.intervalEngine.getLeaveBlockedMinutes(
        leavePortion,
        query.customStartTime,
        query.customEndTime,
        schedule,
      );

      if (!blockedInterval) continue;

      const apptsOnDate = await this.prisma.appointment.findMany({
        where: {
          salonId,
          stylistId,
          appointmentDate: dateObj,
          status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN] },
        },
        include: {
          services: { select: { serviceId: true } },
          salonUser: { include: { user: true } },
        },
        orderBy: { startAt: 'asc' },
      });

      for (const appt of apptsOnDate) {
        const apptStartDt = DateTime.fromJSDate(appt.startAt).setZone(timezone);
        const apptEndDt = DateTime.fromJSDate(appt.endAt).setZone(timezone);
        const apptStartMin = apptStartDt.hour * 60 + apptStartDt.minute;
        const apptEndMin = apptEndDt.hour * 60 + apptEndDt.minute;

        if (this.intervalEngine.isAppointmentOverlappingLeave(apptStartMin, apptEndMin, blockedInterval)) {
          const serviceIds =
            appt.services && appt.services.length > 0
              ? appt.services.map((s: any) => s.serviceId)
              : [appt.serviceId];

          const replacementId = await this.reassignmentEngine.findReplacementStylistCandidate(
            this.prisma,
            salonId,
            dateObj,
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
      }
    }

    return {
      stylist,
      startDate: normalizedDates.startIso,
      endDate: normalizedDates.endIso,
      affectedBookingsCount: candidatePreview.length,
      canAutoReassignCount: candidatePreview.filter((c) => c.willReassign).length,
      unresolvableCount: candidatePreview.filter((c) => !c.willReassign).length,
      details: candidatePreview,
    };
  }

  /**
   * Retrieves absences/leaves for a stylist with reassignment history.
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
      const filterStart = parseFilterDate(filters.startDate);
      const filterEnd = parseFilterDate(filters.endDate);
      whereClause.OR = [
        {
          AND: [
            { startDate: { lte: filterEnd } },
            { endDate: { gte: filterStart } },
          ],
        },
        {
          absenceDate: { gte: filterStart, lte: filterEnd },
        },
      ];
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
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Cancels/reverses a leave. Preserves existing reassignments to prevent double-disruption.
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
      throw new NotFoundException('Leave record not found.');
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
        action: 'CANCEL_STYLIST_LEAVE',
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
        `Cannot send leave notification: Reassignment ${reassignmentId} not found or incomplete.`,
      );
      return;
    }

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
    const apptNum = reassignment.appointment.appointmentNumber;

    try {
      if (reassignment.outcome === ReassignmentOutcome.AUTO_ASSIGNED) {
        let newStylistName = 'a top stylist';
        if (reassignment.newStylistId) {
          const newStylist = await this.prisma.stylist.findUnique({
            where: { id: reassignment.newStylistId },
            select: { name: true },
          });
          if (newStylist) newStylistName = newStylist.name;
        }

        await this.whatsappService.sendMetaMessage(
          recipientPhone,
          { textBody: `Hello ${customerName}, your appointment #${apptNum} for ${serviceName} on ${apptDateStr} at ${apptTimeStr} has been updated. Specialist ${originalStylistName} is on leave, so your appointment is now assigned to ${newStylistName}. See you soon!` },
          phoneNumberId,
        );
      } else {
        await this.whatsappService.sendMetaMessage(
          recipientPhone,
          { textBody: `Hello ${customerName}, Specialist ${originalStylistName} is on leave for your appointment #${apptNum} on ${apptDateStr} at ${apptTimeStr}. Please contact us to reschedule at your convenience.` },
          phoneNumberId,
        );
      }

      await this.prisma.bookingReassignment.update({
        where: { id: reassignmentId },
        data: { notificationSentAt: new Date() },
      });
    } catch (err: any) {
      this.logger.error(`Failed to send WhatsApp leave notification: ${err.message}`);
      await this.prisma.bookingReassignment.update({
        where: { id: reassignmentId },
        data: { notificationFailed: true },
      });
    }
  }
}
