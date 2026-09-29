import { Injectable, Logger, OnModuleInit, OnModuleDestroy, forwardRef, Inject } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { WhatsAppService } from '../../../channels/whatsapp/whatsapp.service';
import { WhatsAppTemplateService } from '../../../channels/whatsapp/services/whatsapp-template.service';
import { AppointmentsService } from '../appointments.service';
import { DateTime } from 'luxon';
import { AppointmentStatus, ClientEtaStatus, ReassignmentOutcome, AbsenceStatus, CancelledBy } from '@prisma/client';
import { TimeUtility } from '../../../../common/utils/time.utility';

@Injectable()
export class RemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RemindersService.name);
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => WhatsAppService))
    private readonly whatsAppService: WhatsAppService,
    @Inject(forwardRef(() => AppointmentsService))
    private readonly appointmentsService: AppointmentsService,
    @Inject(forwardRef(() => WhatsAppTemplateService))
    private readonly whatsAppTemplateService: WhatsAppTemplateService,
  ) { }

  onModuleInit() {
    this.startReminderJob();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private startReminderJob() {
    // Run every 60 seconds
    this.timer = setInterval(async () => {
      try {
        await this.processReminders();
      } catch (err: any) {
        this.logger.error(`Error in reminder cron tick: ${err.message}`, err.stack);
      }
    }, 60000);
    this.logger.log('⏰ Multi-Stage WhatsApp Reminder & Auto No-Show Worker started (60s tick).');
  }

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
      const salons = await this.prisma.salon.findMany({
        where: { status: 'ACTIVE' },
        include: { whatsappAccount: true },
      });

      let stage1Count = 0;
      let stage1CutoffCount = 0;
      let stage2Count = 0;
      let stage2CutoffCount = 0;
      let stage3ElapsedCount = 0;

      for (const salon of salons) {
        try {
          const tz = salon.timezone || 'Asia/Kolkata';
          const now = DateTime.now().setZone(tz);
          const phoneNumberId = salon.whatsappAccount?.phoneNumberId;
          const todayStart = now.startOf('day').toJSDate();

          // -----------------------------------------------------------------------
          // STAGE 1: Advance 2-Hour Confirmation Reminder
          // Lead time > 120m starts as BOOKED. Send reminder prompt.
          // -----------------------------------------------------------------------
          const stage1Min = now.plus({ minutes: 60 }).toJSDate();
          const stage1Max = now.plus({ hours: 2, minutes: 15 }).toJSDate();

          const stage1Appointments = (await this.prisma.appointment.findMany({
            where: {
              salonId: salon.id,
              status: AppointmentStatus.BOOKED,
              reminder2hSentAt: null,
              startAt: {
                gte: stage1Min,
                lte: stage1Max,
              },
              reassignments: {
                none: {
                  outcome: ReassignmentOutcome.NO_REPLACEMENT,
                  absence: { status: AbsenceStatus.ACTIVE },
                },
              },
            },
            include: {
              salonUser: {
                include: {
                  user: true,
                },
              },
              stylist: true,
              service: true,
            },
          })) || [];

          for (const appt of stage1Appointments) {
            const user = appt.salonUser?.user;
            if (!user?.phone) continue;
            const timeStr = TimeUtility.formatTime12h(appt.startAt, tz);
            const dateStr = TimeUtility.formatDateFriendly(appt.startAt, tz);

            const payload = this.whatsAppTemplateService.build2HourReminderPrompt(
              salon.name,
              user.name || 'Customer',
              appt.serviceNameSnapshot || appt.service?.name || 'Service',
              Number(appt.price) || 0,
              appt.stylist?.name || 'Stylist',
              dateStr,
              timeStr,
              salon.address || '',
            );

            const sent = await this.whatsAppService.sendMetaMessage(
              user.phone,
              payload,
              phoneNumberId,
              salon.id,
            );

            if (sent) {
              await this.prisma.appointment.update({
                where: { id: appt.id },
                data: { reminder2hSentAt: new Date() },
              });
              stage1Count++;
            }
          }

          // -----------------------------------------------------------------------
          // STAGE 1.5: T - 60 Minutes Ghost Cutoff Auto-Cancellation
          // If status is still BOOKED and startAt <= now + 60 mins:
          // Customer never confirmed -> Auto-cancel with +1 penalty strike (lead time <= 60m < 90m)
          // -----------------------------------------------------------------------
          const cutoff60m = now.plus({ minutes: 60 }).toJSDate();
          const unconfirmedGhostAppointments = (await this.prisma.appointment.findMany({
            where: {
              salonId: salon.id,
              status: AppointmentStatus.BOOKED,
              startAt: {
                gte: todayStart,
                lte: cutoff60m,
              },
            },
            include: {
              salonUser: { include: { user: true } },
              stylist: true,
              service: true,
            },
          })) || [];

          for (const appt of unconfirmedGhostAppointments) {
            try {
              await this.appointmentsService.cancelBooking(salon.id, appt.id, {
                source: 'SYSTEM_AUTO_CUTOFF',
                fault: 'CLIENT',
                reasonCategory: 'CLIENT_UNRESPONSIVE',
                reason: 'GHOSTED_2H_REMINDER',
              });
              stage1CutoffCount++;
            } catch (err: any) {
              this.logger.error(
                `[Reminders Worker] Failed to auto-cancel unconfirmed 60m appt #${appt.appointmentNumber}: ${err.message}`,
              );
            }
          }

          // -----------------------------------------------------------------------
          // STAGE 1.8: T - 60 Minutes Unresponsive Reschedule Proposal Cutoff
          // If status is PENDING_RESCHEDULE and proposedStartAt <= now + 60 mins:
          // Customer never responded to salon proposal -> Auto-cancel with 0 penalty (salon fault)
          // -----------------------------------------------------------------------
          const rescheduleCutoff60m = now.plus({ minutes: 60 }).toJSDate();
          const expiredRescheduleAppointments = (await this.prisma.appointment.findMany({
            where: {
              salonId: salon.id,
              status: AppointmentStatus.PENDING_RESCHEDULE,
              proposedStartAt: {
                lte: rescheduleCutoff60m,
              },
            },
            include: {
              salonUser: { include: { user: true } },
              stylist: true,
              service: true,
            },
          })) || [];

          for (const appt of expiredRescheduleAppointments) {
            try {
              await this.appointmentsService.cancelBooking(salon.id, appt.id, {
                source: 'SYSTEM_AUTO_CUTOFF',
                fault: 'SALON',
                noPenalty: true,
                reason: 'UNRESPONSIVE_RESCHEDULE_PROPOSAL_EXPIRED_60M',
                cancelledBy: CancelledBy.SYSTEM,
              });
              stage1CutoffCount++;
            } catch (err: any) {
              this.logger.error(
                `[Reminders Worker] Failed to auto-cancel expired proposal appt #${appt.appointmentNumber}: ${err.message}`,
              );
            }
          }

          // -----------------------------------------------------------------------
          // STAGE 2: Imminent 15-Minute Arrival Alert & Warning
          // Only for CONFIRMED appointments. Send [🚗 On My Way] and [❌ Cancel Visit].
          // -----------------------------------------------------------------------
          const stage2Max = now.plus({ minutes: 20 }).toJSDate();

          const stage2Appointments = (await this.prisma.appointment.findMany({
            where: {
              salonId: salon.id,
              status: AppointmentStatus.CONFIRMED,
              reminder10mSentAt: null,
              startAt: {
                gte: now.toJSDate(),
                lte: stage2Max,
              },
              reassignments: {
                none: {
                  outcome: ReassignmentOutcome.NO_REPLACEMENT,
                  absence: { status: AbsenceStatus.ACTIVE },
                },
              },
            },
            include: {
              salonUser: {
                include: {
                  user: true,
                },
              },
              stylist: true,
              service: true,
            },
          })) || [];

          for (const appt of stage2Appointments) {
            const user = appt.salonUser?.user;
            if (!user?.phone) continue;
            const timeStr = TimeUtility.formatTime12h(appt.startAt, tz);

            const payload = this.whatsAppTemplateService.build15MinArrivalPrompt(
              salon.name,
              user.name || 'Customer',
              appt.stylist?.name || 'Stylist',
              timeStr,
            );

            const sent = await this.whatsAppService.sendMetaMessage(
              user.phone,
              payload,
              phoneNumberId,
              salon.id,
            );

            if (sent) {
              await this.prisma.appointment.update({
                where: { id: appt.id },
                data: { reminder10mSentAt: new Date() },
              });
              stage2Count++;
            }
          }

          // -----------------------------------------------------------------------
          // STAGE 2.5: T - 5 Minutes Grace Period Auto-Cancellation
          // Customer was sent 15m alert and did NOT tap [🚗 On My Way] (status still CONFIRMED).
          // Start time has 5m or less remaining -> Auto-cancel with +1 penalty strike!
          // (Note: If customer clicked [🚗 On My Way], status transitioned to ON_THE_WAY,
          // so they are NOT in status CONFIRMED and never auto-cancelled!).
          // -----------------------------------------------------------------------
          const cutoff5m = now.plus({ minutes: 5 }).toJSDate();
          const ghost15mAppointments = (await this.prisma.appointment.findMany({
            where: {
              salonId: salon.id,
              status: AppointmentStatus.CONFIRMED,
              startAt: {
                gte: todayStart,
                lte: cutoff5m,
              },
            },
            include: {
              salonUser: {
                include: {
                  user: true,
                },
              },
              stylist: true,
              service: true,
              reassignments: {
                where: {
                  outcome: ReassignmentOutcome.NO_REPLACEMENT,
                  absence: { status: AbsenceStatus.ACTIVE },
                },
              },
            },
          })) || [];

          for (const appt of ghost15mAppointments) {
            const hasUnresolvedAbsence = (appt.reassignments && appt.reassignments.length > 0);

            try {
              await this.appointmentsService.cancelBooking(salon.id, appt.id, {
                source: hasUnresolvedAbsence ? 'SYSTEM_STORE_CLOSURE' : 'SYSTEM_AUTO_NOSHOW',
                fault: hasUnresolvedAbsence ? 'SALON' : 'CLIENT',
                reasonCategory: hasUnresolvedAbsence ? 'SALON_EMERGENCY' : 'CLIENT_UNRESPONSIVE',
                reason: hasUnresolvedAbsence
                  ? 'Auto-cancelled: specialist absent and no replacement available'
                  : 'GHOSTED_15M_ALERT',
              });
              stage2CutoffCount++;
            } catch (cancelErr: any) {
              this.logger.error(
                `[Reminders Worker] Failed to cancel expired appt #${appt.appointmentNumber}: ${cancelErr.message}`,
              );
            }
          }

          // -----------------------------------------------------------------------
          // STAGE 3: Auto-Complete Elapsed Appointments (When service time has ended)
          // -----------------------------------------------------------------------
          try {
            const completedCount = await this.appointmentsService.autoCompleteElapsedAppointments(salon.id);
            stage3ElapsedCount += completedCount;
          } catch (autoCompleteErr: any) {
            this.logger.error(
              `[Reminders Worker] Failed to auto-complete elapsed appointments for salon "${salon.name}": ${autoCompleteErr.message}`,
            );
          }

        } catch (salonErr: any) {
          this.logger.error(
            `[Reminders Worker] Error processing reminders for salon "${salon.name}" (${salon.id}):`,
            salonErr?.stack || salonErr,
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

