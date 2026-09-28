import { Injectable, Logger, OnModuleInit, OnModuleDestroy, forwardRef, Inject } from '@nestjs/common';
import { PrismaService } from '../../../../database/prisma.service';
import { WhatsAppService } from '../../../channels/whatsapp/whatsapp.service';
import { WhatsAppTemplateService } from '../../../channels/whatsapp/services/whatsapp-template.service';
import { AppointmentsService } from '../appointments.service';
import { DateTime } from 'luxon';
import { AppointmentStatus, ClientEtaStatus, ReassignmentOutcome, AbsenceStatus } from '@prisma/client';
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

  async processReminders(): Promise<{ stage1: number; stage2: number; stage4: number; stage5: number }> {
    if (this.isProcessing) {
      this.logger.debug('[Reminders Worker] Skipping tick - previous processReminders() execution still in progress.');
      return { stage1: 0, stage2: 0, stage4: 0, stage5: 0 };
    }

    this.isProcessing = true;
    try {
      const salons = await this.prisma.salon.findMany({
        where: { status: 'ACTIVE' },
        include: { whatsappAccount: true },
      });

      let stage1Count = 0;
      let stage2Count = 0;
      let stage4Count = 0;
      let stage5Count = 0;

      for (const salon of salons) {
        try {
          const tz = salon.timezone || 'Asia/Kolkata';
          const now = DateTime.now().setZone(tz);
          const phoneNumberId = salon.whatsappAccount?.phoneNumberId;

          // -----------------------------------------------------------------------
          // STAGE 1: Advance 2-Hour Reminder
          // -----------------------------------------------------------------------
          const stage1Min = now.plus({ minutes: 45 }).toJSDate();
          const stage1Max = now.plus({ hours: 2, minutes: 15 }).toJSDate();

          const stage1Appointments = await this.prisma.appointment.findMany({
            where: {
              salonId: salon.id,
              status: AppointmentStatus.CONFIRMED,
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
          });

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
          // STAGE 2: Imminent 15-Minute Arrival Alert & Warning
          // -----------------------------------------------------------------------
          const stage2Max = now.plus({ minutes: 20 }).toJSDate();

          const stage2Appointments = await this.prisma.appointment.findMany({
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
          });

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
          // STAGE 4: Auto-Cancellation & Penalty Strike Worker (+5m Grace Period)
          // -----------------------------------------------------------------------
          const todayStart = now.startOf('day').toJSDate();
          const gracePeriodCutoff = now.minus({ minutes: 5 }).toJSDate();

          const expiredAppointments = await this.prisma.appointment.findMany({
            where: {
              salonId: salon.id,
              status: AppointmentStatus.CONFIRMED,
              startAt: {
                gte: todayStart,
                lte: gracePeriodCutoff,
              },
              OR: [
                { clientEtaStatus: null },
                {
                  clientEtaStatus: {
                    notIn: [
                      ClientEtaStatus.ON_THE_WAY,
                      ClientEtaStatus.ARRIVED,
                      ClientEtaStatus.RUNNING_LATE_10M,
                      ClientEtaStatus.RUNNING_LATE_20M,
                    ],
                  },
                },
              ],
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
          });

          for (const appt of expiredAppointments) {
            // Check if appointment is unresolvable due to active stylist absence
            const hasUnresolvedAbsence = (appt.reassignments && appt.reassignments.length > 0);

            try {
              await this.appointmentsService.cancelBooking(salon.id, appt.id, {
                source: hasUnresolvedAbsence ? 'SYSTEM_STORE_CLOSURE' : 'SYSTEM_AUTO_NOSHOW',
                fault: hasUnresolvedAbsence ? 'SALON' : 'CLIENT',
                reasonCategory: hasUnresolvedAbsence ? 'SALON_EMERGENCY' : 'CLIENT_UNRESPONSIVE',
                reason: hasUnresolvedAbsence
                  ? 'Auto-cancelled: specialist absent and no replacement available'
                  : 'Auto-canceled by system due to no-response after 5-minute grace period.',
              });
            } catch (cancelErr: any) {
              this.logger.error(
                `[Reminders Worker] Failed to cancel expired appt #${appt.appointmentNumber}: ${cancelErr.message}`,
              );
            }

            stage4Count++;
          }

          // -----------------------------------------------------------------------
          // STAGE 5: Auto-Complete Elapsed Appointments (When service time has ended)
          // -----------------------------------------------------------------------
          try {
            const completedCount = await this.appointmentsService.autoCompleteElapsedAppointments(salon.id);
            stage5Count += completedCount;
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

      return { stage1: stage1Count, stage2: stage2Count, stage4: stage4Count, stage5: stage5Count };
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

