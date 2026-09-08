import { Injectable, Logger, OnModuleInit, OnModuleDestroy, forwardRef, Inject } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { AppointmentsService } from './appointments.service';
import { DateTime } from 'luxon';
import { AppointmentStatus, ClientEtaStatus } from '@prisma/client';

@Injectable()
export class RemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RemindersService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => WhatsAppService))
    private readonly whatsAppService: WhatsAppService,
    @Inject(forwardRef(() => AppointmentsService))
    private readonly appointmentsService: AppointmentsService,
  ) {}

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
      } catch (err) {
        this.logger.error('Error in periodic appointment reminders job:', err);
      }
    }, 60000);
    this.logger.log('⏰ Multi-Stage WhatsApp Reminder & Auto No-Show Worker started (60s tick).');
  }

  async processReminders(): Promise<{ stage1: number; stage2: number; stage3: number; stage4: number }> {
    const salons = await this.prisma.salon.findMany({
      where: { status: 'ACTIVE' },
      include: { whatsappAccount: true },
    });

    let stage1Count = 0;
    let stage2Count = 0;
    let stage3Count = 0;
    let stage4Count = 0;

    for (const salon of salons) {
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
        const timeStr = DateTime.fromJSDate(appt.startAt, { zone: tz }).toFormat('hh:mm a');
        const dateStr = DateTime.fromJSDate(appt.startAt, { zone: tz }).toFormat('dd LLL, EEE');

        const message = `⏰ *APPOINTMENT REMINDER*\n\nHello *${user.name || 'Customer'}*, your upcoming visit at *${salon.name}* is in ~2 hours:\n\n• *Service:* *${appt.serviceNameSnapshot || appt.service?.name}* (₹${appt.price})\n• *Stylist:* *${appt.stylist?.name || 'Stylist'}*\n• *Date:* *${dateStr}*\n• *Time:* *${timeStr}*\n\n📍 *${salon.name}*\n${salon.address || ''}\n\nPlease confirm your arrival so we keep your chair ready!`;

        await this.whatsAppService.sendMetaMessage(
          user.phone,
          {
            bodyText: message,
            interactiveType: 'button',
            buttons: [
              { id: 'remind_confirm', title: "✅ I'll Be There" },
              { id: 'remind_reschedule', title: '🔄 Reschedule' },
              { id: 'remind_cancel', title: '❌ Cancel' },
            ],
          },
          phoneNumberId,
          salon.id,
        );

        await this.prisma.appointment.update({
          where: { id: appt.id },
          data: { reminder2hSentAt: new Date() },
        });

        stage1Count++;
      }

      // -----------------------------------------------------------------------
      // STAGE 2: Imminent 10-Minute Arrival Alert
      // -----------------------------------------------------------------------
      const stage2Min = now.minus({ minutes: 5 }).toJSDate();
      const stage2Max = now.plus({ minutes: 15 }).toJSDate();

      const stage2Appointments = await this.prisma.appointment.findMany({
        where: {
          salonId: salon.id,
          status: AppointmentStatus.CONFIRMED,
          reminder10mSentAt: null,
          startAt: {
            gte: stage2Min,
            lte: stage2Max,
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
        const timeStr = DateTime.fromJSDate(appt.startAt, { zone: tz }).toFormat('hh:mm a');

        const message = `💺 *YOUR CHAIR IS GETTING READY!*\n\nHi *${user.name || 'Customer'}*, your stylist *${appt.stylist?.name || 'Stylist'}* is preparing your station for *${timeStr}*.\n\n📍 *${salon.name}*\n${salon.address || ''}\n\nPlease confirm if you are on your way:`;

        await this.whatsAppService.sendMetaMessage(
          user.phone,
          {
            bodyText: message,
            interactiveType: 'button',
            buttons: [
              { id: 'remind_10m_on_way', title: '🚗 On the Way' },
              { id: 'remind_10m_cancel', title: '❌ Cancel' },
            ],
          },
          phoneNumberId,
          salon.id,
        );

        await this.prisma.appointment.update({
          where: { id: appt.id },
          data: { reminder10mSentAt: new Date() },
        });

        stage2Count++;
      }

      // -----------------------------------------------------------------------
      // STAGE 3: Late-Arrival Follow-Up
      // -----------------------------------------------------------------------
      const stage3Min = now.minus({ minutes: 30 }).toJSDate();
      const stage3Max = now.minus({ minutes: 10 }).toJSDate();

      const stage3Appointments = await this.prisma.appointment.findMany({
        where: {
          salonId: salon.id,
          status: AppointmentStatus.CONFIRMED,
          lateFollowUpSentAt: null,
          startAt: {
            gte: stage3Min,
            lte: stage3Max,
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

      for (const appt of stage3Appointments) {
        const user = appt.salonUser?.user;
        if (!user?.phone) continue;
        const timeStr = DateTime.fromJSDate(appt.startAt, { zone: tz }).toFormat('hh:mm a');

        const message = `👋 Hi *${user.name || 'Customer'}*, we noticed you haven't checked in for your *${timeStr}* appointment with *${appt.stylist?.name || 'Stylist'}* yet.\n\nAre you on your way or running a few minutes late?`;

        await this.whatsAppService.sendMetaMessage(
          user.phone,
          {
            bodyText: message,
            interactiveType: 'button',
            buttons: [
              { id: `late_on_way_${appt.id}`, title: '🚗 On My Way (10m)' },
              { id: 'remind_reschedule', title: '🔄 Reschedule' },
              { id: `late_cancel_${appt.id}`, title: '❌ Release Chair' },
            ],
          },
          phoneNumberId,
          salon.id,
        );

        await this.prisma.appointment.update({
          where: { id: appt.id },
          data: { lateFollowUpSentAt: new Date() },
        });

        stage3Count++;
      }

      // -----------------------------------------------------------------------
      // STAGE 4: Auto-Cancellation & Penalty Strike Worker (+15m Grace Period)
      // -----------------------------------------------------------------------
      const todayStart = now.startOf('day').toJSDate();
      const gracePeriodCutoff = now.minus({ minutes: 15 }).toJSDate();

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
            { clientEtaStatus: { not: ClientEtaStatus.ON_THE_WAY } },
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
        },
      });

      for (const appt of expiredAppointments) {
        const user = appt.salonUser?.user;
        const timeStr = DateTime.fromJSDate(appt.startAt, { zone: tz }).toFormat('hh:mm a');

        // Mark appointment as NO_SHOW and record auto-cancellation date
        await this.prisma.appointment.update({
          where: { id: appt.id },
          data: {
            status: AppointmentStatus.NO_SHOW,
            notes: 'Auto-canceled by system due to no-response after 15-minute grace period.',
          },
        });

        // Increment customer yearly no-show count & enforce penalty locking
        let remainingPenalties = 2;
        if (appt.salonUserId) {
          const salonUser = await this.prisma.salonUser.findUnique({
            where: { id: appt.salonUserId },
          });

          const currentCount = salonUser?.yearlyNoShowCount || 0;
          const newCount = currentCount + 1;
          remainingPenalties = Math.max(0, 3 - newCount);
          const isBlocked = newCount >= 3;

          await this.prisma.salonUser.update({
            where: { id: appt.salonUserId },
            data: {
              yearlyNoShowCount: newCount,
              lastNoShowDate: new Date(),
              isBookingBlocked: isBlocked,
            },
          });
        }

        // Send Penalty WhatsApp Notice to Customer
        if (user?.phone) {
          let message = '';
          if (remainingPenalties > 0) {
            message = `⚠️ *APPOINTMENT AUTO-CANCELED*\n\nHi *${user.name || 'Customer'}*, your appointment for *${timeStr}* with *${appt.stylist?.name || 'Stylist'}* was auto-canceled because we did not receive an arrival confirmation.\n\n⚠️ *Penalty Strike Recorded:* You have *1 penalty strike* recorded. You have *${remainingPenalties} penalty strike(s) remaining* this year before automatic slot booking is locked.`;
          } else {
            message = `⚠️ *ACCOUNT BOOKING LOCKED*\n\nHi *${user.name || 'Customer'}*, you have accumulated *3 penalty strikes* this year for missed appointments. Automatic slot booking is now locked for your account.\n\n📞 *Please contact the Salon Owner* directly to request access unblock.`;
          }

          await this.whatsAppService.sendMetaMessage(
            user.phone,
            {
              bodyText: message,
              interactiveType: 'button',
              buttons: [{ id: 'btn_start', title: '🏠 Main Menu' }],
            },
            phoneNumberId,
            salon.id,
          ).catch(() => {});
        }

        // Trigger Smart Express Move-Up Broadcast for the newly freed slot
        await this.appointmentsService.triggerSmartMoveUpBroadcast(appt);

        stage4Count++;
      }
    }

    return { stage1: stage1Count, stage2: stage2Count, stage3: stage3Count, stage4: stage4Count };
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
      let message = '';
      if (remainingPenalties > 0) {
        message = `⚠️ *LATE CANCELLATION / NO-SHOW PENALTY RECORDED*\n\nHi *${userName || 'Customer'}*, your appointment for *${timeStr}* with *${stylistName || 'Stylist'}* was canceled with less than 2 hours remaining.\n\n⚠️ *Penalty Strike Recorded:* You have *1 penalty strike* recorded. You have *${remainingPenalties} penalty strike(s) remaining* this year before automatic slot booking is locked.`;
      } else {
        message = `⚠️ *ACCOUNT BOOKING LOCKED*\n\nHi *${userName || 'Customer'}*, you have accumulated *3 penalty strikes* this year for missed or late-canceled appointments. Automatic slot booking is now locked for your account.\n\n📞 *Please contact the Salon Owner* directly to request access unblock.`;
      }

      await this.whatsAppService.sendMetaMessage(
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

    return { newCount, remainingPenalties };
  }
}

