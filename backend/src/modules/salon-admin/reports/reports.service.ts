import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { DateTime } from 'luxon';
import { TimeUtility } from '../../../common/utils/time.utility';
import { AppointmentStatus } from '@prisma/client';
import { StylistStatusEngine, StylistOperationalStatus } from '../staff/engines/stylist-status.engine';
import { appointmentInclude } from '../appointments/utils/appointment-helpers';
import { mapToQueueItem } from '../appointments/queue/mappers/queue-appointment.mapper';

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

  constructor(
    private prisma: PrismaService,
    private stylistStatusEngine: StylistStatusEngine,
  ) {}

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

    const tz = await TimeUtility.getSalonTimezone(this.prisma, salonId);
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
        // Fallback silently
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

    // 1. Parallel Batch Execution
    const [
      allDayAppointments,
      salonMetrics,
      whatsappQuota,
      salonInfo,
      todayClosure,
      serviceStatsRaw,
      serviceCategoriesRaw,
      staffStatusesMap,
    ] = await Promise.all([
      // A. Appointments for the target day with rich relation models for UI mapping
      this.prisma.appointment.findMany({
        where: {
          salonId,
          OR: [
            { startAt: { gte: dayStart, lte: dayEnd } },
            { proposedStartAt: { gte: dayStart, lte: dayEnd } },
          ],
        },
        include: appointmentInclude,
        orderBy: { startAt: 'asc' },
      }),

      // B. Overall Counts
      this.prisma.$queryRaw<[{ customer_count: bigint; staff_count: bigint; service_count: bigint }]>`
        SELECT
          (SELECT COUNT(*) FROM salon_users WHERE salon_id = ${salonId}) as customer_count,
          (SELECT COUNT(*) FROM stylists WHERE salon_id = ${salonId} AND status = 'ACTIVE') as staff_count,
          (SELECT COUNT(*) FROM services WHERE salon_id = ${salonId} AND status = 'ACTIVE') as service_count
      `,

      // C. WhatsApp monthly conversation quota
      this.getWhatsAppQuota(salonId, timezone, targetDate),

      // D. Salon profile info
      this.prisma.salon.findUnique({
        where: { id: salonId },
        select: { id: true, name: true, slug: true, phone: true, status: true },
      }),

      // E. Facility Closures for target day
      this.prisma.salonClosure.findFirst({
        where: {
          salonId,
          startDate: { lte: dayEnd },
          endDate: { gte: dayStart },
        },
      }),

      // F. Fast Services aggregations
      this.prisma.$queryRaw<[{ active_count: bigint; avg_price: number; avg_duration: number; min_price: number; max_price: number }]>`
        SELECT 
          COUNT(*) as active_count,
          COALESCE(ROUND(AVG(price)), 0) as avg_price,
          COALESCE(ROUND(AVG(duration_minutes)), 30) as avg_duration,
          COALESCE(ROUND(MIN(price)), 0) as min_price,
          COALESCE(ROUND(MAX(price)), 0) as max_price
        FROM services 
        WHERE salon_id = ${salonId} AND status = 'ACTIVE'
      `,

      // G. Service Category counts
      this.prisma.service.groupBy({
        by: ['category'],
        where: { salonId, status: 'ACTIVE' },
        _count: { id: true },
        orderBy: { category: 'asc' },
      }),

      // H. Dynamic Stylist Floor Statuses (Available, Working, On Break, Off)
      this.stylistStatusEngine
        .resolveSalonStaffStatuses(salonId, {
          targetDate: targetDateIso,
          timezone,
        })
        .catch((err) => {
          this.logger.warn(`Failed resolving staff statuses: ${err.message}`);
          return new Map();
        }),
    ]);

    // 2. Map and Categorize Appointments
    const todayQueueItems = allDayAppointments.map((appt) => mapToQueueItem(appt));

    const statusCounts = {
      total: allDayAppointments.length,
      booked: 0,
      confirmed: 0,
      onTheWay: 0,
      checkedIn: 0,
      seatedInChair: 0,
      inService: 0,
      completed: 0,
      cancelled: 0,
      rejected: 0,
      pendingAcceptance: 0,
      pendingReschedule: 0,
    };

    let todayRevenue = 0;
    const sourceBreakdown: Record<string, number> = {};

    for (const appt of allDayAppointments) {
      switch (appt.status) {
        case AppointmentStatus.BOOKED: statusCounts.booked++; break;
        case AppointmentStatus.CONFIRMED: statusCounts.confirmed++; break;
        case AppointmentStatus.ON_THE_WAY: statusCounts.onTheWay++; break;
        case AppointmentStatus.CHECKED_IN: statusCounts.checkedIn++; break;
        case AppointmentStatus.SEATED_IN_CHAIR:
          statusCounts.seatedInChair++;
          statusCounts.inService++;
          break;
        case AppointmentStatus.PENDING_ACCEPTANCE: statusCounts.pendingAcceptance++; break;
        case AppointmentStatus.PENDING_RESCHEDULE: statusCounts.pendingReschedule++; break;
        case AppointmentStatus.COMPLETED:
          statusCounts.completed++;
          todayRevenue += Number(appt.price || 0);
          break;
        case AppointmentStatus.CANCELLED: statusCounts.cancelled++; break;
        case AppointmentStatus.REJECTED: statusCounts.rejected++; break;
      }
      sourceBreakdown[appt.source] = (sourceBreakdown[appt.source] || 0) + 1;
    }

    // 3. Quick Booking Requests (Pending approval from WhatsApp, Online, or Store QR)
    // Filter all appointments in PENDING_ACCEPTANCE and bundle them by stylist
    const pendingQuickRequests = todayQueueItems
      .filter((a) => a.status === AppointmentStatus.PENDING_ACCEPTANCE)
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());

    const stylistRequestsMap = new Map<string, { stylist: any; requests: any[] }>();

    for (const req of pendingQuickRequests) {
      const sId = req.stylist?.id || 'unassigned';
      if (!stylistRequestsMap.has(sId)) {
        stylistRequestsMap.set(sId, {
          stylist: req.stylist?.id
            ? req.stylist
            : { id: 'unassigned', name: 'Any Specialist', colorCode: '#94a3b8' },
          requests: [],
        });
      }
      stylistRequestsMap.get(sId)!.requests.push(req);
    }

    const quickRequestsByStylist = Array.from(stylistRequestsMap.values());
    const quickRequests = quickRequestsByStylist.flatMap((g) => g.requests);

    // 4. Upcoming Queue (Top 3 active clients in line)
    const activeStatuses = ['CONFIRMED', 'BOOKED', 'CHECKED_IN', 'ON_THE_WAY', 'PENDING_ACCEPTANCE'];
    const upcomingQueue = todayQueueItems
      .filter((a) => activeStatuses.includes(a.status))
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
      .slice(0, 3);

    // 5. Fallback Recent Appointments (If upcoming queue has 0 items)
    let recentAppointments: any[] = [];
    if (upcomingQueue.length === 0) {
      const recentRaw = await this.prisma.appointment.findMany({
        where: {
          salonId,
          status: { in: [AppointmentStatus.COMPLETED, AppointmentStatus.CANCELLED, AppointmentStatus.REJECTED] },
        },
        include: appointmentInclude,
        orderBy: { updatedAt: 'desc' },
        take: 3,
      });
      recentAppointments = recentRaw.map((a) => mapToQueueItem(a));
    }

    // 6. Floor & Staff Capacity Breakdown
    let freeStaff = 0;
    let inChairStaff = 0;
    let onBreakStaff = 0;
    let offDutyStaff = 0;

    for (const statusRes of staffStatusesMap.values()) {
      switch (statusRes.status) {
        case StylistOperationalStatus.AVAILABLE:
          freeStaff++;
          break;
        case StylistOperationalStatus.WORKING:
          inChairStaff++;
          break;
        case StylistOperationalStatus.ON_BREAK:
          onBreakStaff++;
          break;
        default:
          offDutyStaff++;
          break;
      }
    }

    const totalStaff = staffStatusesMap.size;
    const freePct = totalStaff > 0 ? Math.round((freeStaff / totalStaff) * 100) : 0;
    const busyPct = totalStaff > 0 ? Math.round((inChairStaff / totalStaff) * 100) : 0;
    const breakPct = totalStaff > 0 ? Math.round((onBreakStaff / totalStaff) * 100) : 0;
    const offPct = totalStaff > 0 ? Math.max(0, 100 - freePct - busyPct - breakPct) : 0;

    let staffHighlight = '';
    if (totalStaff === 0) {
      staffHighlight = 'No specialists registered yet. Click "Manage Staff" to add team members.';
    } else if (freeStaff > 0) {
      staffHighlight = `🟢 ${freeStaff} of ${totalStaff} specialists are free and ready for walk-in clients right now.`;
    } else if (inChairStaff > 0) {
      staffHighlight = `🟣 All on-duty specialists are currently seated with clients in chair.`;
    } else {
      staffHighlight = `⚪ No specialists on floor at this moment (all off duty or on scheduled leave).`;
    }

    const staffSummary = {
      total: totalStaff,
      free: freeStaff,
      inChair: inChairStaff,
      onBreak: onBreakStaff,
      offDuty: offDutyStaff,
      freePct,
      busyPct,
      breakPct,
      offPct,
      highlight: staffHighlight,
    };

    // 7. Services Summary Aggregations
    const svcStats = serviceStatsRaw[0] || {
      active_count: 0n,
      avg_price: 0,
      avg_duration: 30,
      min_price: 0,
      max_price: 0,
    };

    const servicesSummary = {
      activeCount: Number(svcStats.active_count || 0),
      totalCategories: serviceCategoriesRaw.length,
      avgTicket: Number(svcStats.avg_price || 0),
      avgDurationMinutes: Number(svcStats.avg_duration || 30),
      minPrice: Number(svcStats.min_price || 0),
      maxPrice: Number(svcStats.max_price || 0),
      categories: serviceCategoriesRaw.map((c) => ({
        name: (c.category || 'General').trim(),
        count: c._count.id,
      })),
    };

    // 8. Store Alert
    const storeAlert = {
      isClosedToday: !!todayClosure,
      closureType: todayClosure?.closureType || null,
      closureReason: todayClosure?.reason || null,
      salonStatus: salonInfo?.status || 'ACTIVE',
    };

    // 9. Operational Pulse
    const onDutyCount = freeStaff + inChairStaff + onBreakStaff;
    const pulse = {
      todayRevenue,
      totalBooked: Math.max(0, statusCounts.total - statusCounts.cancelled - statusCounts.rejected),
      inQueue:
        (statusCounts.confirmed || 0) +
        (statusCounts.booked || 0) +
        (statusCounts.checkedIn || 0) +
        (statusCounts.onTheWay || 0),
      inChair: Math.max(statusCounts.seatedInChair || 0, statusCounts.inService || 0),
      completed: statusCounts.completed,
      cancelled: statusCounts.cancelled,
      pendingRequestsCount: statusCounts.pendingAcceptance,
      floorCapacity: {
        onDutyStaff: onDutyCount,
        availableStaff: freeStaff,
      },
      whatsappQuota,
    };

    const metrics = salonMetrics[0];

    return {
      date: targetDate.toISODate(),
      timezone,
      storeAlert,
      pulse,
      statusCounts,
      todayRevenue,
      sourceBreakdown,
      salonMetrics: {
        totalCustomers: Number(metrics?.customer_count || 0),
        totalActiveStaff: totalStaff,
        totalActiveServices: servicesSummary.activeCount,
      },
      whatsappQuota,
      salon: salonInfo,
      quickRequests,
      quickRequestsByStylist,
      upcomingQueue,
      recentAppointments,
      staffSummary,
      servicesSummary,
      todayAppointments: todayQueueItems,
    };
  }
}
