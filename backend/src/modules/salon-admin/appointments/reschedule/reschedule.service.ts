import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { AvailabilityService } from '../../availability/availability.service';
import { AvailabilityEngineService } from '../../availability/availability-engine.service';
import { AppointmentEventsService } from '../events/appointment-events.service';
import { WhatsAppService } from '../../../channels/whatsapp/whatsapp.service';
import { RescheduleAppointmentDto } from '../dto/create-appointment.dto';
import {
  AppointmentStatus,
  StylistStatus,
  ServiceStatus,
  AbsenceStatus,
  DayOfWeek,
  LeavePortion,
} from '@prisma/client';
import { DateTime } from 'luxon';
import {
  appointmentInclude,
  formatAppointment,
  hashToSignedInt32,
} from '../utils/appointment-helpers';

@Injectable()
export class RescheduleService {
  private readonly logger = new Logger(RescheduleService.name);

  constructor(
    private prisma: PrismaService,
    private availabilityService: AvailabilityService,
    private engine: AvailabilityEngineService,
    private eventsService: AppointmentEventsService,
    @Inject(forwardRef(() => WhatsAppService))
    private whatsappService: WhatsAppService,
  ) {}

  /**
   * Dedicated Domain Method: Validates whether an appointment is eligible for rescheduling under salon cutoff rules.
   */
  async validateRescheduleEligibility(
    salonId: string,
    appointmentId: string,
    adminId?: string,
  ): Promise<{
    allowed: boolean;
    hoursUntil: number;
    cancelWindowHours: number;
    appointment: any;
    reason?: string;
  }> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        salon: true,
        stylist: true,
        service: true,
      },
    });

    if (!appointment) {
      return {
        allowed: false,
        hoursUntil: 0,
        cancelWindowHours: 2,
        appointment: null,
        reason: 'Appointment not found.',
      };
    }

    if (appointment.status !== AppointmentStatus.CONFIRMED) {
      return {
        allowed: false,
        hoursUntil: 0,
        cancelWindowHours: 2,
        appointment: formatAppointment(appointment),
        reason: `Only CONFIRMED appointments can be rescheduled. Current status: ${appointment.status}.`,
      };
    }

    const cancelWindowHours = appointment.salon?.cancelWindowHours ?? 2;
    const nowMs = Date.now();
    const apptStartMs = new Date(appointment.startAt).getTime();
    const hoursUntil = (apptStartMs - nowMs) / (1000 * 60 * 60);

    if (!adminId && hoursUntil < cancelWindowHours && hoursUntil > -1) {
      return {
        allowed: false,
        hoursUntil,
        cancelWindowHours,
        appointment: formatAppointment(appointment),
        reason: `Appointments cannot be rescheduled within ${cancelWindowHours} hours of the start time.`,
      };
    }

    return {
      allowed: true,
      hoursUntil,
      cancelWindowHours,
      appointment: formatAppointment(appointment),
    };
  }

  /**
   * Reschedules an appointment to a new date, time, or specialist.
   */
  async rescheduleAppointment(
    salonId: string,
    appointmentId: string,
    dto: RescheduleAppointmentDto,
    adminId?: string,
    appointmentsService?: any,
  ) {
    const appointment = appointmentsService
      ? await appointmentsService.getAppointmentById(salonId, appointmentId)
      : await this.getAppointmentById(salonId, appointmentId);

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

    const newDateStr = dto.newDate.includes('T') ? dto.newDate.split('T')[0] : dto.newDate;

    // Lock hierarchy for rescheduling:
    // Level 1: Schedule lock on new day
    // Level 2: Customer lock on new date
    // Level 3: Stylist lock on new date
    const key1 = hashToSignedInt32(`salon:${salonId}`);
    const newScheduleKey2 = hashToSignedInt32(`schedule:${dayOfWeek}`);
    const customerKey2 = hashToSignedInt32(`cust:${appointment.salonUserId}:${newDateStr}`);
    const targetStylistKey2 = hashToSignedInt32(`stylist:${targetStylistId}:${newDateStr}`);

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

          // Check stylist overlap
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

          const targetDateObj = new Date(`${newDateStr}T00:00:00.000Z`);
          const activeAbsences = await tx.stylistAbsence.findMany({
            where: {
              salonId,
              stylistId: targetStylistId,
              status: AbsenceStatus.ACTIVE,
              OR: [
                { startDate: { lte: targetDateObj }, endDate: { gte: targetDateObj } },
                { absenceDate: targetDateObj },
              ],
            },
          });

          const salonWorkingHours = await tx.salonWorkingHours.findUnique({
            where: { salonId_dayOfWeek: { salonId, dayOfWeek } },
          });

          const targetStylistObj = await tx.stylist.findUnique({
            where: { id: targetStylistId },
            select: { id: true, followsSalonSchedule: true },
          });

          for (const abs of activeAbsences) {
            if (await this.isApptOverlappingAbsence(abs, startDt, endDt, dayOfWeek, salonWorkingHours, tx, targetStylistObj)) {
              throw new ConflictException(
                'Selected specialist is on leave during the requested rescheduled time.',
              );
            }
          }

          // Re-verify target stylist status
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

          // Re-verify stylist absence status
          const rescheduleAbsence = await tx.stylistAbsence.findFirst({
            where: {
              salonId,
              stylistId: targetStylistId,
              status: AbsenceStatus.ACTIVE,
              OR: [
                { startDate: { lte: new Date(`${dto.newDate}T00:00:00.000Z`) }, endDate: { gte: new Date(`${dto.newDate}T00:00:00.000Z`) } },
                { absenceDate: new Date(`${dto.newDate}T00:00:00.000Z`) },
              ],
            },
          });
          if (rescheduleAbsence && (!rescheduleAbsence.leavePortion || rescheduleAbsence.leavePortion === 'FULL_DAY')) {
            throw new ConflictException('Selected specialist is marked absent on the new date.');
          }

          // Re-verify service status
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

          // Re-verify stylist-service assignment
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

          const currentSalonHours = await tx.salonWorkingHours.findUnique({
            where: { salonId_dayOfWeek: { salonId, dayOfWeek } },
          });

          const stylistHours = tx.stylistWorkingHours
            ? (await (tx.stylistWorkingHours.findUnique
              ? tx.stylistWorkingHours.findUnique({ where: { stylistId_dayOfWeek: { stylistId: targetStylist.id, dayOfWeek } } })
              : tx.stylistWorkingHours.findFirst({ where: { stylistId: targetStylist.id, dayOfWeek } })))
            : null;

          const shiftWindow = this.engine.getEffectiveShiftWindow(
            currentSalonHours,
            targetStylist,
            stylistHours,
          );

          if (!shiftWindow.isWorking || shiftWindow.effectiveOpenMinutes === null || shiftWindow.effectiveCloseMinutes === null) {
            throw new ConflictException(shiftWindow.statusReason || `Salon is closed or specialist is unavailable on ${dayOfWeek}.`);
          }

          const apptStartMin = this.parseTimeStringToMinutes(dto.newStartTime);
          const apptEndMin = apptStartMin + (appointment.durationMinutes || (appointment as any).totalDurationMinutes || 30);

          if (apptStartMin < shiftWindow.effectiveOpenMinutes) {
            const openTimeStr = this.engine.formatMinutesToTime(shiftWindow.effectiveOpenMinutes);
            throw new ConflictException(
              `Rescheduled start time ${dto.newStartTime} is earlier than working opening time ${openTimeStr}.`,
            );
          }
          if (apptEndMin > shiftWindow.effectiveCloseMinutes) {
            const closeTimeStr = this.engine.formatMinutesToTime(shiftWindow.effectiveCloseMinutes);
            throw new ConflictException(
              `Rescheduled end time ${this.engine.formatMinutesToTime(apptEndMin)} exceeds working closing time ${closeTimeStr}.`,
            );
          }
          for (const b of shiftWindow.effectiveBreaks) {
            if (apptStartMin < b.end && apptEndMin > b.start) {
              const bStartStr = this.engine.formatMinutesToTime(b.start);
              const bEndStr = this.engine.formatMinutesToTime(b.end);
              throw new ConflictException(
                `Rescheduled appointment conflicts with break (${bStartStr}-${bEndStr}).`,
              );
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

      const formatted = formatAppointment(updated);
      this.eventsService.emitSalonEvent(salonId, 'RESCHEDULED', formatted);
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

  private parseTimeStringToMinutes(timeStr: string): number {
    const [hours, mins] = timeStr.split(':').map((v) => parseInt(v, 10));
    return hours * 60 + mins;
  }

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
      return true;
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

  async getAppointmentById(salonId: string, id: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id, salonId },
      include: appointmentInclude,
    });
    if (!appointment) {
      throw new NotFoundException('Appointment not found.');
    }
    return appointment;
  }
}
