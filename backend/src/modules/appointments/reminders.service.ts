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
      // STAGE 1: Advance 2-Hour / 1-Hour Reminder
      // Window: startTime is between (now + 45 mins) and (now + 2 hours 15 mins)
      // -----------------------------------------------------------------------
      const stage1Min = now.plus({ minutes: 45 }).toJSDate();
      const stage1Max = now.plus({ hours: 2, minutes: 15 }).toJSDate();

      const stage1Appointments = await this.prisma.appointment.findMany({
        where: {
          salonId: salon.id,
          status: AppointmentStatus.CONFIRMED,
          reminder2hSentAt: null,
          startTime: {
            gte: stage1Min,
            lte: stage1Max,
          },
        },
        include: {
          customer: true,
          staff: true,
          service: true,
        },
      });

      for (const appt of stage1Appointments) {
        if (!appt.customer?.phone) continue;
        const timeStr = DateTime.fromJSDate(appt.startTime, { zone: tz }).toFormat('hh:mm a');
        const dateStr = DateTime.fromJSDate(appt.startTime, { zone: tz }).toFormat('dd LLL, EEE');

        const message = `⏰ *APPOINTMENT REMINDER*\n\nHello *${appt.customer.name}*, your upcoming visit at *${salon.name}* is in ~2 hours:\n\n• *Service:* *${appt.service?.name || 'Service'}* (₹${appt.service?.price || '0'})\n• *Specialist:* *${appt.staff?.name || 'Specialist'}*\n• *Date:* *${dateStr}*\n• *Time:* *${timeStr}*\n\n📍 *${salon.name}*\n${salon.address || ''}\n\nWe look forward to seeing you!`;

        await this.whatsAppService.sendMetaMessage(
          appt.customer.phone,
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
        this.logger.log(`Dispatched Stage 1 (2h) Reminder for ${appt.appointmentNumber} to ${appt.customer.phone}`);
      }

      // -----------------------------------------------------------------------
      // STAGE 2: Imminent 10-Minute Arrival Alert
      // Window: startTime is between (now - 5 mins) and (now + 15 mins)
      // -----------------------------------------------------------------------
      const stage2Min = now.minus({ minutes: 5 }).toJSDate();
      const stage2Max = now.plus({ minutes: 15 }).toJSDate();

      const stage2Appointments = await this.prisma.appointment.findMany({
        where: {
          salonId: salon.id,
          status: AppointmentStatus.CONFIRMED,
          reminder10mSentAt: null,
          startTime: {
            gte: stage2Min,
            lte: stage2Max,
          },
        },
        include: {
          customer: true,
          staff: true,
          service: true,
        },
      });

      for (const appt of stage2Appointments) {
        if (!appt.customer?.phone) continue;
        const timeStr = DateTime.fromJSDate(appt.startTime, { zone: tz }).toFormat('hh:mm a');

        const message = `💺 *YOUR CHAIR IS GETTING READY!*\n\nHi *${appt.customer.name}*, your specialist *${appt.staff?.name || 'Specialist'}* is preparing your station for *${timeStr}*.\n\n📍 *${salon.name}*\n${salon.address || ''}\n\nSee you in 10 minutes!`;

        await this.whatsAppService.sendMetaMessage(
          appt.customer.phone,
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
        this.logger.log(`Dispatched Stage 2 (10m) Imminent Alert for ${appt.appointmentNumber} to ${appt.customer.phone}`);
      }

      // -----------------------------------------------------------------------
      // STAGE 3: Late-Arrival Follow-Up
      // Window: startTime was (now - 10 mins) to (now - 30 mins) ago AND status is STILL CONFIRMED
      // (Client hasn't arrived or checked in yet)
      // -----------------------------------------------------------------------
      const stage3Min = now.minus({ minutes: 30 }).toJSDate();
      const stage3Max = now.minus({ minutes: 10 }).toJSDate();

      const stage3Appointments = await this.prisma.appointment.findMany({
        where: {
          salonId: salon.id,
          status: AppointmentStatus.CONFIRMED,
          lateFollowUpSentAt: null,
          startTime: {
            gte: stage3Min,
            lte: stage3Max,
          },
        },
        include: {
          customer: true,
          staff: true,
          service: true,
        },
      });

      for (const appt of stage3Appointments) {
        if (!appt.customer?.phone) continue;
        const timeStr = DateTime.fromJSDate(appt.startTime, { zone: tz }).toFormat('hh:mm a');

        const message = `👋 Hi *${appt.customer.name}*, we noticed you haven't checked in for your *${timeStr}* appointment with *${appt.staff?.name || 'Specialist'}* yet.\n\nAre you on your way or running a few minutes late?`;

        await this.whatsAppService.sendMetaMessage(
          appt.customer.phone,
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
        this.logger.log(`Dispatched Stage 3 Late-Arrival Follow-up for ${appt.appointmentNumber} to ${appt.customer.phone}`);
      }
    }

    return { stage1: stage1Count, stage2: stage2Count, stage3: stage3Count };
  }
}
