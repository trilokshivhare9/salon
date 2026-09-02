import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DateTime } from 'luxon';
import { AppointmentStatus } from '@prisma/client';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async getDashboardSummary(salonId: string, dateStr?: string) {
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      include: { whatsappAccount: true },
    });
    const timezone = salon?.timezone || 'Asia/Kolkata';

    const targetDate = dateStr
      ? DateTime.fromISO(dateStr, { zone: timezone })
      : DateTime.now().setZone(timezone);

    const targetDateIso = targetDate.toISODate()!;
    const dayStart = targetDate.startOf('day').toJSDate();
    const dayEnd = targetDate.endOf('day').toJSDate();
    const dateUtcMidnight = new Date(`${targetDateIso}T00:00:00.000Z`);

    // 1. Appointments on target date (matches by startTime range OR date field)
    const todayAppointments = await this.prisma.appointment.findMany({
      where: {
        salonId,
        OR: [
          {
            startTime: {
              gte: dayStart,
              lte: dayEnd,
            },
          },
          {
            date: dateUtcMidnight,
          },
          {
            date: dayStart,
          },
        ],
      },
      include: {
        customer: true,
        staff: true,
        service: true,
      },
      orderBy: { startTime: 'asc' },
    });

    const statusCounts = {
      total: todayAppointments.length,
      confirmed: todayAppointments.filter((a) => a.status === AppointmentStatus.CONFIRMED).length,
      checkedIn: todayAppointments.filter((a) => a.status === AppointmentStatus.CHECKED_IN).length,
      inService: todayAppointments.filter((a) => a.status === AppointmentStatus.IN_SERVICE).length,
      completed: todayAppointments.filter((a) => a.status === AppointmentStatus.COMPLETED).length,
      cancelled: todayAppointments.filter((a) => a.status === AppointmentStatus.CANCELLED).length,
      noShow: todayAppointments.filter((a) => a.status === AppointmentStatus.NO_SHOW).length,
    };

    // Revenue calculation
    const todayRevenue = todayAppointments
      .filter((a) => a.status === AppointmentStatus.COMPLETED)
      .reduce((sum, a) => sum + Number(a.price), 0);

    // Source breakdown
    const sourceBreakdown = todayAppointments.reduce((acc, appt) => {
      acc[appt.source] = (acc[appt.source] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Monthly WhatsApp Quota Tracking (Live Meta Cloud API + Local Session Tracking)
    const startOfMonth = targetDate.startOf('month');
    const startUnix = Math.floor(startOfMonth.toSeconds());
    const endUnix = Math.floor(DateTime.now().setZone(timezone).toSeconds());
    const nextResetDate = startOfMonth.plus({ months: 1 }).toFormat('dd LLL');

    const [totalCustomers, totalStaff, totalServices, distinctWhatsAppUsers] = await Promise.all([
      this.prisma.customer.count({ where: { salonId } }),
      this.prisma.staff.count({ where: { salonId, status: 'ACTIVE' } }),
      this.prisma.service.count({ where: { salonId, status: 'ACTIVE' } }),
      this.prisma.whatsAppLog.findMany({
        where: {
          createdAt: { gte: startOfMonth.toJSDate() },
          OR: [
            { salonId },
            { salonId: null },
          ],
        },
        distinct: ['phone'],
        select: { phone: true },
      }),
    ]);

    const localConversationCount = distinctWhatsAppUsers.length;
    let metaLiveCount = 0;
    let liveSource = 'REAL_TIME_TRACKING';

    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const wabaId = salon?.whatsappAccount?.wabaId || process.env.WHATSAPP_WABA_ID;

    if (wabaId && accessToken) {
      try {
        const metaUrl = `https://graph.facebook.com/v20.0/${wabaId}?fields=conversation_analytics.start(${startUnix}).end(${endUnix}).granularity(MONTHLY).metric_types(FREE_TIER,REGULAR,FREE_ENTRY_POINT)&access_token=${accessToken}`;
        const metaRes = await fetch(metaUrl);
        if (metaRes.ok) {
          const metaJson: any = await metaRes.json();
          const dataPoints = metaJson.conversation_analytics?.data?.[0]?.data_points || [];
          if (dataPoints.length > 0) {
            metaLiveCount = dataPoints.reduce((sum: number, pt: any) => sum + (pt.conversation || 0), 0);
            liveSource = 'META_GRAPH_API';
          }
        }
      } catch (err) {
        // Fallback to real-time session tracking
      }
    }

    const usedConversations = Math.max(metaLiveCount, localConversationCount);
    const quotaLimit = 1000;
    const quotaRemaining = Math.max(0, quotaLimit - usedConversations);
    const quotaPercent = Math.min(100, Math.round((usedConversations / quotaLimit) * 100));

    return {
      date: targetDate.toISODate(),
      timezone,
      statusCounts,
      todayRevenue,
      sourceBreakdown,
      salonMetrics: {
        totalCustomers,
        totalActiveStaff: totalStaff,
        totalActiveServices: totalServices,
      },
      whatsappQuota: {
        limit: quotaLimit,
        used: usedConversations,
        remaining: quotaRemaining,
        percentUsed: quotaPercent,
        resetsOn: nextResetDate,
        source: liveSource,
      },
      salon: {
        id: salon?.id,
        name: salon?.name,
        slug: salon?.slug,
        phone: salon?.phone,
      },
      todayAppointments,
    };
  }
}


