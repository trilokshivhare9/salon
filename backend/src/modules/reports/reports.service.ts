import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DateTime } from 'luxon';
import { AppointmentStatus } from '@prisma/client';

interface CachedQuota {
  metaLiveCount: number;
  localConversationCount: number;
  source: string;
  fetchedAt: number;
}

@Injectable()
export class ReportsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReportsService.name);

  // In-memory caches (avoid repeated external API calls)
  private quotaCache = new Map<string, CachedQuota>();
  private salonTimezoneCache = new Map<string, string>();
  private quotaRefreshTimer: NodeJS.Timeout | null = null;

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    // Refresh Meta quota cache every 10 minutes in background
    this.quotaRefreshTimer = setInterval(() => {
      this.refreshAllQuotaCaches().catch((err) =>
        this.logger.warn(`Background quota refresh failed: ${err.message}`),
      );
    }, 600000); // 10 minutes
  }

  onModuleDestroy() {
    if (this.quotaRefreshTimer) {
      clearInterval(this.quotaRefreshTimer);
    }
  }

  private async getSalonTimezone(salonId: string): Promise<string> {
    const cached = this.salonTimezoneCache.get(salonId);
    if (cached) return cached;

    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: { timezone: true },
    });
    const tz = salon?.timezone || 'Asia/Kolkata';
    this.salonTimezoneCache.set(salonId, tz);
    return tz;
  }

  private async getWhatsAppQuota(salonId: string, timezone: string, targetDate: DateTime): Promise<{
    limit: number;
    used: number;
    remaining: number;
    percentUsed: number;
    resetsOn: string;
    source: string;
  }> {
    const startOfMonth = targetDate.startOf('month');
    const nextResetDate = startOfMonth.plus({ months: 1 }).toFormat('dd LLL');

    // Check in-memory cache first (valid for 10 minutes)
    const cached = this.quotaCache.get(salonId);
    const isFresh = cached && Date.now() - cached.fetchedAt < 600000;

    let usedConversations: number;
    let liveSource: string;

    if (isFresh) {
      usedConversations = Math.max(cached.metaLiveCount, cached.localConversationCount);
      liveSource = cached.source;
    } else {
      // Fetch in real-time and cache the result
      const quota = await this.fetchAndCacheQuota(salonId, timezone, targetDate);
      usedConversations = Math.max(quota.metaLiveCount, quota.localConversationCount);
      liveSource = quota.source;
    }

    const quotaLimit = 1000;
    return {
      limit: quotaLimit,
      used: usedConversations,
      remaining: Math.max(0, quotaLimit - usedConversations),
      percentUsed: Math.min(100, Math.round((usedConversations / quotaLimit) * 100)),
      resetsOn: nextResetDate,
      source: liveSource,
    };
  }

  private async fetchAndCacheQuota(salonId: string, timezone: string, targetDate: DateTime): Promise<CachedQuota> {
    const startOfMonth = targetDate.startOf('month');
    const startUnix = Math.floor(startOfMonth.toSeconds());
    const endUnix = Math.floor(DateTime.now().setZone(timezone).toSeconds());

    // Local count (fast DB query)
    const distinctWhatsAppUsers = await this.prisma.whatsAppLog.findMany({
      where: {
        createdAt: { gte: startOfMonth.toJSDate() },
        OR: [{ salonId }, { salonId: null }],
      },
      distinct: ['phone'],
      select: { phone: true },
    });

    const localConversationCount = distinctWhatsAppUsers.length;
    let metaLiveCount = 0;
    let liveSource = 'REAL_TIME_TRACKING';

    // Meta Graph API call (expensive — cached for 10 minutes)
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      include: { whatsappAccount: true },
    });

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
      } catch {
        // Fallback to real-time session tracking silently
      }
    }

    const cachedData: CachedQuota = {
      metaLiveCount,
      localConversationCount,
      source: liveSource,
      fetchedAt: Date.now(),
    };

    this.quotaCache.set(salonId, cachedData);
    return cachedData;
  }

  private async refreshAllQuotaCaches(): Promise<void> {
    const salons = await this.prisma.salon.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, timezone: true },
    });

    for (const salon of salons) {
      const tz = salon.timezone || 'Asia/Kolkata';
      const now = DateTime.now().setZone(tz);
      await this.fetchAndCacheQuota(salon.id, tz, now).catch(() => {});
    }
  }

  async getDashboardSummary(salonId: string, dateStr?: string) {
    const timezone = await this.getSalonTimezone(salonId);

    const targetDate = dateStr
      ? DateTime.fromISO(dateStr, { zone: timezone })
      : DateTime.now().setZone(timezone);

    const targetDateIso = targetDate.toISODate()!;
    const dayStart = targetDate.startOf('day').toJSDate();
    const dayEnd = targetDate.endOf('day').toJSDate();
    const dateUtcMidnight = new Date(`${targetDateIso}T00:00:00.000Z`);

    // OPTIMIZED: Run appointments query + aggregated counts + quota in parallel
    const [todayAppointments, salonMetrics, whatsappQuota, salonInfo] = await Promise.all([
      // 1. Appointments for the day (single query with includes)
      this.prisma.appointment.findMany({
        where: {
          salonId,
          OR: [
            { startTime: { gte: dayStart, lte: dayEnd } },
            { date: dateUtcMidnight },
            { date: dayStart },
          ],
        },
        include: {
          customer: true,
          staff: true,
          service: true,
        },
        orderBy: { startTime: 'asc' },
      }),

      // 2. OPTIMIZED: Single raw SQL for all 3 counts (1 round-trip instead of 3)
      this.prisma.$queryRaw<[{ customer_count: bigint; staff_count: bigint; service_count: bigint }]>`
        SELECT
          (SELECT COUNT(*) FROM customers WHERE salon_id = ${salonId}) as customer_count,
          (SELECT COUNT(*) FROM staff WHERE salon_id = ${salonId} AND status = 'ACTIVE') as staff_count,
          (SELECT COUNT(*) FROM services WHERE salon_id = ${salonId} AND status = 'ACTIVE') as service_count
      `,

      // 3. WhatsApp quota (reads from 10-min background cache when available)
      this.getWhatsAppQuota(salonId, timezone, targetDate),

      // 4. Salon basic info (lightweight)
      this.prisma.salon.findUnique({
        where: { id: salonId },
        select: { id: true, name: true, slug: true, phone: true },
      }),
    ]);

    // Compute status counts in-memory (zero extra DB queries)
    const statusCounts = {
      total: todayAppointments.length,
      confirmed: 0,
      checkedIn: 0,
      inService: 0,
      completed: 0,
      cancelled: 0,
      noShow: 0,
    };

    let todayRevenue = 0;
    const sourceBreakdown: Record<string, number> = {};

    for (const appt of todayAppointments) {
      switch (appt.status) {
        case AppointmentStatus.CONFIRMED: statusCounts.confirmed++; break;
        case AppointmentStatus.CHECKED_IN: statusCounts.checkedIn++; break;
        case AppointmentStatus.IN_SERVICE: statusCounts.inService++; break;
        case AppointmentStatus.COMPLETED:
          statusCounts.completed++;
          todayRevenue += Number(appt.price);
          break;
        case AppointmentStatus.CANCELLED: statusCounts.cancelled++; break;
        case AppointmentStatus.NO_SHOW: statusCounts.noShow++; break;
      }
      sourceBreakdown[appt.source] = (sourceBreakdown[appt.source] || 0) + 1;
    }

    const metrics = salonMetrics[0];

    return {
      date: targetDate.toISODate(),
      timezone,
      statusCounts,
      todayRevenue,
      sourceBreakdown,
      salonMetrics: {
        totalCustomers: Number(metrics?.customer_count || 0),
        totalActiveStaff: Number(metrics?.staff_count || 0),
        totalActiveServices: Number(metrics?.service_count || 0),
      },
      whatsappQuota,
      salon: salonInfo,
      todayAppointments,
    };
  }
}
