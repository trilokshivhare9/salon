import { Injectable, Logger, OnModuleInit, OnModuleDestroy, forwardRef, Inject } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { DateTime } from 'luxon';
import { AppointmentStatus } from '@prisma/client';

@Injectable()
export class RemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RemindersService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => WhatsAppService))
    private readonly whatsAppService: WhatsAppService,
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
    this.logger.log('⏰ Multi-Stage WhatsApp Reminder & Late-Arrival Worker started (60s tick).');
  }

  async processReminders(): Promise<{ stage1: number; stage2: number; stage3: number }> {
    const salons = await this.prisma.salon.findMany({
      where: { status: 'ACTIVE' },
      include: { whatsappAccount: true },
    });

    let stage1Count = 0;
    let stage2Count = 0;
    let stage3Count = 0;

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

        const message = `⏰ *APPOINTMENT REMINDER*\n\nHello *${user.name || 'Customer'}*, your upcoming visit at *${salon.name}* is in ~2 hours:\n\n• *Service:* *${appt.serviceNameSnapshot || appt.service?.name}* (₹${appt.price})\n• *Stylist:* *${appt.stylist?.name || 'Stylist'}*\n• *Date:* *${dateStr}*\n• *Time:* *${timeStr}*\n\n📍 *${salon.name}*\n${salon.address || ''}\n\nWe look forward to seeing you!`;

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

        const message = `💺 *YOUR CHAIR IS GETTING READY!*\n\nHi *${user.name || 'Customer'}*, your stylist *${appt.stylist?.name || 'Stylist'}* is preparing your station for *${timeStr}*.\n\n📍 *${salon.name}*\n${salon.address || ''}\n\nSee you in 10 minutes!`;

        await this.whatsAppService.sendMetaMessage(
          user.phone,
          {
            bodyText: message,
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
    }

    return { stage1: stage1Count, stage2: stage2Count, stage3: stage3Count };
  }
}
