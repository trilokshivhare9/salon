import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { RedisService } from '../../../../database/redis.service';
import { AppointmentEventsService } from '../events/appointment-events.service';
import { AppointmentNextActionService } from '../next-action/appointment-next-action.service';
import { ModifyAppointmentDto } from './dto/appointment-modifier.dto';
import { AppointmentStatus } from '@prisma/client';
import { AppointmentActionType } from '../../../../common/constants/booking-policy.constants';
import {
  appointmentInclude,
  formatAppointment,
  VALID_STATUS_TRANSITIONS,
} from '../utils/appointment-helpers';

/**
 * AppointmentModifierService (The Sole Appointment Table Writer / Gateway)
 *
 * SOLE RESPONSIBILITY:
 * The ONLY service in the entire application authorized to modify/update
 * records in the `Appointment` table in PostgreSQL.
 *
 * Ensures:
 * 1. State machine transition integrity (VALID_STATUS_TRANSITIONS).
 * 2. Next-action calculation via AppointmentNextActionService.
 * 3. Atomic single-query database persistence.
 * 4. Automatic Redis alarm synchronization (set / clear).
 * 5. Real-time event broadcasting to the salon dashboard (STATUS_UPDATED).
 */
@Injectable()
export class AppointmentModifierService {
  private readonly logger = new Logger(AppointmentModifierService.name);

  constructor(
    private prisma: PrismaService,
    @Optional() private nextActionService?: AppointmentNextActionService,
    @Optional() private eventsService?: AppointmentEventsService,
    @Optional() private redisService?: RedisService,
  ) {
    if (!this.nextActionService) {
      this.nextActionService = new AppointmentNextActionService();
    }
  }

  /**
   * Helper: fetches appointment by salon and ID with complete relations
   */
  async getAppointment(salonId: string, appointmentId: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, salonId },
      include: appointmentInclude,
    });
    if (!appointment) {
      throw new NotFoundException('Appointment not found.');
    }
    return appointment;
  }

  /**
   * SOLE METHOD TO MODIFY APPOINTMENT STATUS & METADATA
   *
   * Every service (CancellationService, RescheduleService, RemindersService,
   * Admin Dashboard) calls this method to update appointment state.
   */
  async modifyStatus(
    salonId: string,
    appointmentId: string,
    data: ModifyAppointmentDto,
  ) {
    const prismaClient = data.tx || this.prisma;
    const appointment = data.existingAppointment || (await prismaClient.appointment.findFirst({
      where: { id: appointmentId, salonId },
      include: appointmentInclude,
    }));

    if (!appointment) {
      throw new NotFoundException('Appointment not found.');
    }

    // Idempotency check: If already in target status without metadata updates, or both terminal
    const isTargetCancelled = ([AppointmentStatus.CANCELLED, AppointmentStatus.REJECTED] as string[]).includes(data.status);
    const isCurrentCancelled = ([AppointmentStatus.CANCELLED, AppointmentStatus.REJECTED] as string[]).includes(appointment.status);
    const hasMetadataUpdates =
      data.reminder2hSentAt !== undefined ||
      data.reminder10mSentAt !== undefined ||
      data.clientEtaStatus !== undefined ||
      data.notes !== undefined ||
      data.reason !== undefined ||
      data.proposedStartAt !== undefined ||
      data.proposedEndAt !== undefined ||
      data.proposedStylistId !== undefined ||
      data.expiresAt !== undefined ||
      data.startAt !== undefined ||
      data.endAt !== undefined ||
      data.stylistId !== undefined ||
      data.appointmentDate !== undefined;

    if ((appointment.status === data.status && !hasMetadataUpdates) || (isCurrentCancelled && isTargetCancelled)) {
      return formatAppointment(appointment);
    }

    // Transition validation
    if (!data.skipTransitionValidation) {
      const allowedTransitions = VALID_STATUS_TRANSITIONS[appointment.status as AppointmentStatus] || [];
      if (!allowedTransitions.includes(data.status)) {
        throw new BadRequestException(
          `Cannot transition appointment status from ${appointment.status} to ${data.status}.`,
        );
      }
    }

    // Determine effective timestamps for next action calculation
    const effectiveStartAt = data.startAt ?? appointment.startAt;
    const effectiveEndAt = data.endAt ?? appointment.endAt;
    const effectiveReminder2h = data.reminder2hSentAt !== undefined ? data.reminder2hSentAt : appointment.reminder2hSentAt;
    const effectiveReminder10m = data.reminder10mSentAt !== undefined ? data.reminder10mSentAt : appointment.reminder10mSentAt;
    const effectiveEtaStatus = data.clientEtaStatus !== undefined ? data.clientEtaStatus : appointment.clientEtaStatus;

    const effectiveProposedStartAt = data.proposedStartAt !== undefined ? data.proposedStartAt : appointment.proposedStartAt;
    const effectiveExpiresAt = data.expiresAt !== undefined ? data.expiresAt : appointment.expiresAt;

    // Calculate next lifecycle action using the pure engine
    const nextAction = this.nextActionService.calculateNextAction({
      status: data.status,
      startAt: effectiveStartAt,
      endAt: effectiveEndAt,
      reminder2hSentAt: effectiveReminder2h,
      reminder10mSentAt: effectiveReminder10m,
      clientEtaStatus: effectiveEtaStatus,
      proposedStartAt: effectiveProposedStartAt,
      expiresAt: effectiveExpiresAt,
    });

    // Build single atomic update payload
    const updateData: any = {
      status: data.status,
      nextActionAt: nextAction.nextActionAt,
      nextActionType: nextAction.nextActionType === AppointmentActionType.NONE ? null : nextAction.nextActionType,
    };

    if (data.notes !== undefined) {
      updateData.notes = data.notes;
    } else if (data.reason) {
      updateData.notes = `${appointment.notes || ''} [Note: ${data.reason}]`.trim();
    }

    if (data.cancellationReason !== undefined) updateData.cancellationReason = data.cancellationReason;
    if (data.cancelledAt !== undefined) updateData.cancelledAt = data.cancelledAt;
    if (data.cancelledBy !== undefined) updateData.cancelledBy = data.cancelledBy;
    if (data.penaltyApplied !== undefined) updateData.penaltyApplied = data.penaltyApplied;

    if (data.proposedStartAt !== undefined) updateData.proposedStartAt = data.proposedStartAt;
    if (data.proposedEndAt !== undefined) updateData.proposedEndAt = data.proposedEndAt;
    if (data.proposedStylistId !== undefined) updateData.proposedStylistId = data.proposedStylistId;
    if (data.proposedByAdminId !== undefined) updateData.proposedByAdminId = data.proposedByAdminId;
    if (data.expiresAt !== undefined) updateData.expiresAt = data.expiresAt;

    if (data.appointmentDate !== undefined) updateData.appointmentDate = data.appointmentDate;
    if (data.startAt !== undefined) updateData.startAt = data.startAt;
    if (data.endAt !== undefined) updateData.endAt = data.endAt;
    if (data.stylistId !== undefined) updateData.stylistId = data.stylistId;
    if (data.reminder2hSentAt !== undefined) updateData.reminder2hSentAt = data.reminder2hSentAt;
    if (data.reminder10mSentAt !== undefined) updateData.reminder10mSentAt = data.reminder10mSentAt;
    if (data.clientEtaStatus !== undefined) updateData.clientEtaStatus = data.clientEtaStatus;

    // Single atomic database write
    const updated = await prismaClient.appointment.update({
      where: { id: appointmentId },
      data: updateData,
      include: appointmentInclude,
    });

    // Synchronize Redis alarm
    if (this.redisService) {
      if (
        nextAction.nextActionAt &&
        nextAction.nextActionType &&
        nextAction.nextActionType !== AppointmentActionType.NONE
      ) {
        await this.redisService.setAlarm(appointmentId, nextAction.nextActionType, nextAction.nextActionAt.getTime());
      } else {
        await this.redisService.clearAlarm(appointmentId);
      }
    }

    const formatted = formatAppointment(updated);
    this.eventsService?.emitSalonEvent(salonId, 'STATUS_UPDATED', formatted);

    return formatted;
  }

  /**
   * Re-evaluates and synchronizes an appointment's alarm in PostgreSQL and Redis.
   * Useful when an appointment is first created or when alarms need resyncing.
   */
  async syncAlarm(appointmentId: string): Promise<{ nextActionAt: Date | null; nextActionType: AppointmentActionType }> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id: true,
        status: true,
        startAt: true,
        endAt: true,
        reminder2hSentAt: true,
        reminder10mSentAt: true,
        clientEtaStatus: true,
        proposedStartAt: true,
        expiresAt: true,
      },
    });

    if (!appointment) {
      if (this.redisService) {
        await this.redisService.clearAlarm(appointmentId);
      }
      return { nextActionAt: null, nextActionType: AppointmentActionType.NONE };
    }

    const nextAction = this.nextActionService.calculateNextAction(appointment);

    await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        nextActionAt: nextAction.nextActionAt,
        nextActionType: nextAction.nextActionType === AppointmentActionType.NONE ? null : nextAction.nextActionType,
      },
    });

    if (this.redisService) {
      if (
        nextAction.nextActionAt &&
        nextAction.nextActionType &&
        nextAction.nextActionType !== AppointmentActionType.NONE
      ) {
        await this.redisService.setAlarm(appointmentId, nextAction.nextActionType, nextAction.nextActionAt.getTime());
      } else {
        await this.redisService.clearAlarm(appointmentId);
      }
    }

    return nextAction;
  }
}
