import { Injectable, Logger, OnModuleInit, OnModuleDestroy, forwardRef, Inject } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { RedisService } from '../../../../database/redis.service';
import { WhatsAppService } from '../../../channels/whatsapp/whatsapp.service';
import { WhatsAppTemplateService } from '../../../channels/whatsapp/services/whatsapp-template.service';
import { AppointmentsService } from '../appointments.service';
import { AppointmentModifierService } from '../modifier/appointment-modifier.service';
import { AppointmentStatus, CancelledBy } from '@prisma/client';
import { AppointmentActionType } from '../../../../common/constants/booking-policy.constants';
import { TimeUtility } from '../../../../common/utils/time.utility';
import { resolveSalonDirectionsUrl } from '../../../../common/utils/location.utility';

@Injectable()
export class RemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RemindersService.name);
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    @Inject(forwardRef(() => AppointmentModifierService))
    private readonly modifierService: AppointmentModifierService,
    @Inject(forwardRef(() => WhatsAppService))
    private readonly whatsAppService: WhatsAppService,
    @Inject(forwardRef(() => AppointmentsService))
    private readonly appointmentsService: AppointmentsService,
    @Inject(forwardRef(() => WhatsAppTemplateService))
    private readonly whatsAppTemplateService: WhatsAppTemplateService,
  ) { }

  async onModuleInit() {
    await this.hydrateRedisSchedule();
    this.startReminderJob();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Boot-time Hydration: Loads all pending alarms from PostgreSQL into Redis ZSET.
   * Ensures zero lost alarms even if the backend server or Redis restarted.
   */
  async hydrateRedisSchedule(): Promise<number> {
    try {
      const activeAppts = await this.prisma.appointment.findMany({
        where: {
          nextActionAt: { not: null },
          status: {
            in: [
              AppointmentStatus.BOOKED,
              AppointmentStatus.CONFIRMED,
              AppointmentStatus.CHECKED_IN,
              AppointmentStatus.SEATED_IN_CHAIR,
              AppointmentStatus.ON_THE_WAY,
              AppointmentStatus.PENDING_RESCHEDULE,
              AppointmentStatus.PENDING_ACCEPTANCE,
            ],
          },
        },
        select: {
          id: true,
          nextActionAt: true,
          nextActionType: true,
        },
      });

      let count = 0;
      for (const appt of activeAppts) {
        if (appt.nextActionAt && appt.nextActionType) {
          await this.redisService.setAlarm(
            appt.id,
            appt.nextActionType,
            new Date(appt.nextActionAt).getTime(),
          );
          count++;
        }
      }

      this.logger.log(`⚡ [Redis Hydration] Seeded ${count} active appointment alarms into Redis.`);
      return count;
    } catch (err: any) {
      this.logger.error(`[Redis Hydration] Failed to hydrate Redis alarms: ${err.message}`, err.stack);
      return 0;
    }
  }

  private startReminderJob() {
    // Run every 15 seconds against Redis Sorted Set
    this.timer = setInterval(async () => {
      try {
        await this.processReminders();
      } catch (err: any) {
        this.logger.error(`Error in reminder Redis tick: ${err.message}`, err.stack);
      }
    }, 15000);
    this.logger.log('⏰ Redis-Powered Multi-Stage Reminder & Auto-Cutoff Worker started (15s tick).');
  }

  /**
   * Pops due alarms from Redis Sorted Set and executes them.
   * If no alarms are due, exits immediately with ZERO database queries.
   */
  async processReminders(): Promise<{
    stage1: number;
    stage1Cutoff: number;
    stage2: number;
    stage2Cutoff: number;
    stage4: number;
    stage5: number;
    stage3Elapsed: number;
  }> {
    if (this.isProcessing) {
      this.logger.debug('[Reminders Worker] Skipping tick - previous processReminders() execution still in progress.');
      return { stage1: 0, stage1Cutoff: 0, stage2: 0, stage2Cutoff: 0, stage4: 0, stage5: 0, stage3Elapsed: 0 };
    }

    this.isProcessing = true;
    try {
      const nowMs = Date.now();
      const dueAlarms = await this.redisService.popDueAlarms(nowMs, 50);

      let stage1Count = 0;
      let stage1CutoffCount = 0;
      let stage2Count = 0;
      let stage2CutoffCount = 0;
      let stage3ElapsedCount = 0;

      // Fast exit if no alarms are due: ZERO database queries!
      if (!dueAlarms || dueAlarms.length === 0) {
        return {
          stage1: 0,
          stage1Cutoff: 0,
          stage2: 0,
          stage2Cutoff: 0,
          stage4: 0,
          stage5: 0,
          stage3Elapsed: 0,
        };
      }

      for (const rawAlarm of dueAlarms) {
        try {
          const colonIdx = rawAlarm.indexOf(':');
          if (colonIdx === -1) continue;
          const appointmentId = rawAlarm.substring(0, colonIdx);
          const actionType = rawAlarm.substring(colonIdx + 1);

          const outcome = await this.executeAlarm(appointmentId, actionType);
          if (outcome === 'STAGE_1_REMINDER') stage1Count++;
          else if (outcome === 'STAGE_1_CUTOFF') stage1CutoffCount++;
          else if (outcome === 'STAGE_2_ARRIVAL') stage2Count++;
          else if (outcome === 'STAGE_2_CUTOFF') stage2CutoffCount++;
          else if (outcome === 'AUTO_COMPLETE') stage3ElapsedCount++;
        } catch (alarmErr: any) {
          this.logger.error(
            `[Reminders Worker] Error executing alarm ${rawAlarm}: ${alarmErr.message}`,
            alarmErr.stack,
          );
        }
      }

      return {
        stage1: stage1Count,
        stage1Cutoff: stage1CutoffCount,
        stage2: stage2Count,
        stage2Cutoff: stage2CutoffCount,
        stage4: stage2CutoffCount,
        stage5: stage3ElapsedCount,
        stage3Elapsed: stage3ElapsedCount,
      };
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Executes a specific due alarm popped from Redis.
   */
  async executeAlarm(appointmentId: string, actionType: string): Promise<string | null> {
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        salon: { include: { whatsappAccount: true } },
        salonUser: { include: { user: true } },
        stylist: true,
        service: true,
      },
    });

    if (!appointment || !appointment.salon) {
      await this.redisService.clearAlarm(appointmentId);
      return null;
    }

    const salon = appointment.salon;
    const tz = salon.timezone || 'Asia/Kolkata';
    const phoneNumberId = salon.whatsappAccount?.phoneNumberId;
    const user = appointment.salonUser?.user;

    switch (actionType) {
      case AppointmentActionType.REMINDER_2H: {
        // Stage 1: 2-Hour Confirmation Reminder
        if (appointment.status !== AppointmentStatus.BOOKED || appointment.reminder2hSentAt) {
          await this.modifierService.syncAlarm(appointmentId);
          return null;
        }

        if (user?.phone && phoneNumberId) {
          const timeStr = TimeUtility.formatTime12h(appointment.startAt, tz);
          const dateStr = TimeUtility.formatDateFriendly(appointment.startAt, tz);
          const displayName =
            user.name && user.name !== 'WhatsApp Customer' && user.name !== 'Customer' && user.name !== 'Valued Client'
              ? user.name
              : 'there';

          const directionsUrl = resolveSalonDirectionsUrl(salon);
          const payload = this.whatsAppTemplateService.build2HourReminderPrompt(
            salon.name,
            displayName,
            appointment.serviceNameSnapshot || appointment.service?.name || 'Service',
            Number(appointment.price) || 0,
            appointment.stylist?.name || 'Stylist',
            dateStr,
            timeStr,
            salon.address || '',
            directionsUrl,
          );

          await this.whatsAppService.sendMetaMessage(
            user.phone,
            payload,
            phoneNumberId,
            salon.id,
          );
        }

        await this.modifierService.modifyStatus(salon.id, appointmentId, {
          status: appointment.status,
          reminder2hSentAt: new Date(),
          skipTransitionValidation: true,
          existingAppointment: appointment,
        });
        return 'STAGE_1_REMINDER';
      }

      case AppointmentActionType.CUTOFF_60M: {
        // Stage 1.5: 60-Minute Ghost Cutoff, Reschedule Proposal Expiration, or Quick Booking Expiration
        if (appointment.status === AppointmentStatus.PENDING_RESCHEDULE) {
          await this.appointmentsService.cancelBooking(salon.id, appointment.id, {
            source: 'SYSTEM_AUTO_CUTOFF',
            fault: 'CLIENT',
            reasonCategory: 'CLIENT_UNRESPONSIVE',
            reason: 'UNRESPONSIVE_RESCHEDULE_PROPOSAL_EXPIRED',
          });
          return 'RESCHEDULE_PROPOSAL_EXPIRED';
        }

        if (appointment.status === AppointmentStatus.PENDING_ACCEPTANCE) {
          await this.appointmentsService.cancelBooking(salon.id, appointment.id, {
            source: 'SYSTEM_AUTO_EXPIRED',
            fault: 'SYSTEM',
            reason: 'Auto-declined: Appointment start time passed without salon check-in approval',
            skipMoveUp: true,
          });
          return 'QUICK_BOOKING_EXPIRED';
        }

        if (appointment.status !== AppointmentStatus.BOOKED) {
          await this.modifierService.syncAlarm(appointmentId);
          return null;
        }

        await this.appointmentsService.cancelBooking(salon.id, appointment.id, {
          source: 'SYSTEM_AUTO_CUTOFF',
          fault: 'CLIENT',
          reasonCategory: 'CLIENT_UNRESPONSIVE',
          reason: 'GHOSTED_2H_REMINDER',
        });
        return 'STAGE_1_CUTOFF';
      }

      case AppointmentActionType.CUTOFF_10M: {
        // Stage 4: 10-Minute Response Cutoff after 15m arrival alert
        // If customer never responded with ETA (clientEtaStatus is null) and is still CONFIRMED:
        if (appointment.status !== AppointmentStatus.CONFIRMED || appointment.clientEtaStatus) {
          await this.modifierService.syncAlarm(appointmentId);
          return null;
        }

        await this.appointmentsService.cancelBooking(salon.id, appointment.id, {
          source: 'SYSTEM_AUTO_CUTOFF',
          fault: 'CLIENT',
          reasonCategory: 'CLIENT_UNRESPONSIVE',
          reason: 'GHOSTED_15M_ALERT',
        });
        return 'STAGE_2_CUTOFF';
      }

      case AppointmentActionType.ARRIVAL_15M: {
        // Stage 2: 15-Minute Arrival Reminder
        if (appointment.status !== AppointmentStatus.CONFIRMED || appointment.reminder10mSentAt) {
          await this.modifierService.syncAlarm(appointmentId);
          return null;
        }

        if (user?.phone && phoneNumberId) {
          const timeStr = TimeUtility.formatTime12h(appointment.startAt, tz);
          const displayName =
            user.name && user.name !== 'WhatsApp Customer' && user.name !== 'Customer' && user.name !== 'Valued Client'
              ? user.name
              : 'there';

          const payload = this.whatsAppTemplateService.build15MinArrivalPrompt(
            salon.name,
            displayName,
            appointment.stylist?.name || 'Stylist',
            timeStr,
          );

          await this.whatsAppService.sendMetaMessage(
            user.phone,
            payload,
            phoneNumberId,
            salon.id,
          );
        }

        await this.modifierService.modifyStatus(salon.id, appointmentId, {
          status: appointment.status,
          reminder10mSentAt: new Date(),
          skipTransitionValidation: true,
          existingAppointment: appointment,
        });
        return 'STAGE_2_ARRIVAL';
      }

      case AppointmentActionType.AUTO_COMPLETE: {
        // Stage 3: Auto-Complete when service duration has ended
        const activeStatuses: AppointmentStatus[] = [
          AppointmentStatus.CONFIRMED,
          AppointmentStatus.CHECKED_IN,
          AppointmentStatus.SEATED_IN_CHAIR,
          AppointmentStatus.ON_THE_WAY,
        ];
        if (activeStatuses.includes(appointment.status)) {
          await this.modifierService.modifyStatus(salon.id, appointment.id, {
            status: AppointmentStatus.COMPLETED,
            reason: 'AUTO_COMPLETE_DURATION_ELAPSED',
            skipTransitionValidation: true,
            existingAppointment: appointment,
          });
          return 'AUTO_COMPLETE';
        } else {
          await this.modifierService.syncAlarm(appointmentId);
          return null;
        }
      }

      case AppointmentActionType.NONE: {
        await this.redisService.clearAlarm(appointmentId);
        return null;
      }

      default: {
        this.logger.warn(`[Reminders Worker] Unknown alarm action type "${actionType}" for appointment ${appointmentId}`);
        await this.modifierService.syncAlarm(appointmentId);
        return null;
      }
    }
  }

  async recordPenaltyStrike(
    salonUserId: string | null,
    salonId: string,
    timeStr: string,
    stylistName: string,
    userPhone?: string,
    userName?: string,
    phoneNumberId?: string,
  ) {
    let remainingPenalties = 2;
    let newCount = 1;
    if (salonUserId) {
      const salonUser = await this.prisma.salonUser.findUnique({
        where: { id: salonUserId },
      });

      const currentCount = salonUser?.yearlyNoShowCount || 0;
      newCount = currentCount + 1;
      remainingPenalties = Math.max(0, 3 - newCount);
      const isBlocked = newCount >= 3;

      await this.prisma.salonUser.update({
        where: { id: salonUserId },
        data: {
          yearlyNoShowCount: newCount,
          lastNoShowDate: new Date(),
          isBookingBlocked: isBlocked,
        },
      });
    }

    if (userPhone && phoneNumberId) {
      const payload = remainingPenalties > 0
        ? this.whatsAppTemplateService.buildPenaltyStrikePrompt(
            userName || 'Customer',
            timeStr,
            stylistName || 'Stylist',
            remainingPenalties,
          )
        : this.whatsAppTemplateService.buildAccountLockedPrompt(
            userName || 'Customer',
          );

      await this.whatsAppService.sendMetaMessage(
        userPhone,
        payload,
        phoneNumberId,
        salonId,
      ).catch(() => { });
    }

    return { newCount, remainingPenalties };
  }
}
