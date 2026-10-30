/**
 * HOME DASHBOARD VIEW ENGINE
 * 
 * Generates the comprehensive, front-desk-first executive operational interface:
 * 1. Today's Revenue & Operational Pulse Cockpit:
 *    - Today's Revenue Take + [Store QR] + [Share Link]
 *    - 4 Core Telemetry Metrics: TOTAL BOOKED, IN QUEUE, IN CHAIR, COMPLETED
 *    - Floor Readiness Pulse: Available Walk-In Chairs & WhatsApp Bot Status
 * 2. Pending Quick Bookings (1-Click Accept / Reject Action Bar)
 * 3. Upcoming Queue (Next 3 in Line with 1-Click [Check In])
 * 4. Stylist Floor Radar (Compact Available vs In-Chair Floor Grid)
 * 5. Reception Fast Action Launchpad (Fast Walk-In, QR Standee, Full Queue, Share Link)
 * 6. Meta WhatsApp Monthly Free Quota Tracker (1,000 Free Chats Progress Bar & Health)
 */

import { Icons } from '../../icons.js';

export class HomeView {
  /**
   * Main render entrypoint.
   */
  static render(state = {}) {
    const {
      salonProfile = {},
      summaryData = {},
      todayAppointments = [],
      recentAppointments = [],
      staffList = [],
      servicesList = [],
      categoriesList = [],
      todayClosure = null,
      labelPrefix = "TODAY'S",
    } = state;

    return `
      <div class="home-cockpit-layout" style="display: flex; flex-direction: column; gap: 18px; padding-bottom: 30px;">
        
        ${this.renderStoreAlerts(salonProfile, summaryData, todayClosure, staffList, servicesList)}
        
        <!-- SECTION 1: TODAY'S REVENUE & OPERATIONAL PULSE COCKPIT -->
        ${this.renderHeroPulse(summaryData, salonProfile, labelPrefix, todayAppointments, staffList, todayClosure)}

        <!-- CARD 2: QUICK BOOKING REQUESTS (DEDICATED FRONT-DESK ACTION CARD) -->
        ${this.renderQuickBookingCard(todayAppointments, summaryData?.quickRequests)}

        <!-- SECTION 3: UPCOMING BOOKINGS / OLD BOOKINGS -->
        ${this.renderUpcomingQueue(todayAppointments, recentAppointments, summaryData?.upcomingQueue, summaryData?.recentAppointments)}

        <!-- SECTION 4: STAFF SUMMARY (EXECUTIVE FLOOR OVERVIEW) -->
        ${this.renderStaffSummary(staffList, todayAppointments, todayClosure, state.selectedDate, summaryData?.staffSummary)}

        <!-- SECTION 5: SERVICES SUMMARY (MENU & CATALOG OVERVIEW) -->
        ${this.renderServicesSummary(servicesList, categoriesList, summaryData?.servicesSummary)}

      </div>
    `;
  }

  /**
   * Store Alerts (Store Closed or Inactive Warning)
   */
  static renderStoreAlerts(profile = {}, summary = {}, todayClosure = null, staffList = [], servicesList = []) {
    let html = '';

    const closure = summary?.storeAlert?.isClosedToday
      ? { closureType: summary.storeAlert.closureType || 'Store Holiday', reason: summary.storeAlert.closureReason || 'Scheduled Closure' }
      : todayClosure;

    if (closure) {
      html += `
        <div style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 14px; padding: 12px 18px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 10px; color: #f87171; font-size: 0.86rem; font-weight: 700;">
            <span style="font-size: 1.2rem;">🚨</span>
            <span>STORE CLOSED TODAY (${closure.closureType}): ${closure.reason || 'Holiday'}</span>
          </div>
          <button type="button" class="btn btn-secondary btn-sm btn-open-closures-modal" style="border-color: rgba(239, 68, 68, 0.4); color: #f87171; font-size: 0.76rem; padding: 4px 10px;">
            Manage Closures →
          </button>
        </div>
      `;
    }

    // ARCHITECTURAL RULE: Prevent duplicate alerts. If the salon has incomplete setup (0 staff or 0 services),
    // the global setup-required onboarding banner at the top of the shell is the single source of truth.
    const stylistCount = (Array.isArray(staffList) && staffList.length > 0)
      ? staffList.length
      : (profile?._count?.stylists ?? (summary?.pulse?.totalStylists ?? 0));

    const serviceCount = (Array.isArray(servicesList) && servicesList.length > 0)
      ? servicesList.length
      : (profile?._count?.services ?? (summary?.serviceCount ?? 0));

    const isInitialOnboarding = stylistCount === 0 || serviceCount === 0;

    const isInactive = profile.status === 'INACTIVE' || profile.status === 'DEACTIVATED' || summary.status === 'INACTIVE' || summary?.storeAlert?.salonStatus === 'INACTIVE';

    // Only render if operations were explicitly paused/deactivated AFTER initial setup was already completed
    if (isInactive && !isInitialOnboarding) {
      html += `
        <div style="background: rgba(239, 68, 68, 0.12); border: 1px solid #ef4444; border-radius: 14px; padding: 14px 18px; color: #fca5a5; display: flex; align-items: center; justify-content: space-between; gap: 14px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <span style="font-size: 1.4rem;">🛑</span>
            <div>
              <div style="font-weight: 700; font-size: 0.92rem; color: #fee2e2;">Salon Storefront Paused</div>
              <div style="font-size: 0.80rem; color: #fca5a5; line-height: 1.4;">Automated WhatsApp booking is currently paused for your store.</div>
            </div>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-goto-services-banner" style="font-size: 0.78rem; padding: 6px 14px;">Settings →</button>
        </div>
      `;
    }

    return html;
  }

  /**
   * SECTION 1: TODAY'S REVENUE & OPERATIONAL PULSE COCKPIT
   * Displays the authentic salon operational pulse:
   * - Total Booked: All scheduled visits for today
   * - In Queue: Confirmed bookings in line awaiting styling
   * - In Chair: Clients actively in styling chairs right now
   * - Completed: Finished visits (generating collected revenue)
   * - Secondary Floor Readiness: Free chairs ready for walk-in & WhatsApp quota
   */
  static renderHeroPulse(summary = {}, profile = {}, labelPrefix = "TODAY'S", todayAppointments = [], staffList = [], todayClosure = null) {
    const appts = Array.isArray(todayAppointments) && todayAppointments.length > 0
      ? todayAppointments
      : (Array.isArray(summary.todayAppointments) ? summary.todayAppointments : []);

    const pulse = summary.pulse || null;
    const sc = summary.statusCounts || {};

    // 1. COMPLETED: Finished visits today
    const completedCount = pulse?.completed !== undefined
      ? pulse.completed
      : (appts.length > 0 ? appts.filter((a) => a.status === 'COMPLETED').length : (sc.completed || 0));

    // 2. IN CHAIR: Clients currently seated receiving styling/services
    const inChairCount = pulse?.inChair !== undefined
      ? pulse.inChair
      : (appts.length > 0
          ? appts.filter((a) => a.status === 'SEATED_IN_CHAIR' || a.status === 'IN_SERVICE').length
          : Math.max(sc.seatedInChair || 0, sc.inService || 0));

    // 3. IN QUEUE: Confirmed clients scheduled in line today
    const upcomingCount = pulse?.inQueue !== undefined
      ? pulse.inQueue
      : (appts.length > 0
          ? appts.filter((a) => ['CONFIRMED', 'BOOKED', 'CHECKED_IN', 'ON_THE_WAY'].includes(a.status)).length
          : ((sc.confirmed || 0) + (sc.booked || 0) + (sc.checkedIn || 0) + (sc.onTheWay || 0)));

    // 4. TOTAL BOOKED: All valid appointments booked for today
    const totalBookedCount = pulse?.totalBooked !== undefined
      ? pulse.totalBooked
      : (appts.length > 0
          ? appts.filter((a) => a.status !== 'CANCELLED' && a.status !== 'REJECTED').length
          : (sc.total !== undefined ? Math.max(0, (sc.total || 0) - (sc.cancelled || 0) - (sc.rejected || 0)) : (completedCount + inChairCount + upcomingCount)));

    // 5. PENDING REQUESTS: Incoming quick bookings awaiting acceptance
    const pendingCount = pulse?.pendingRequestsCount !== undefined
      ? pulse.pendingRequestsCount
      : (appts.length > 0
          ? appts.filter((a) => a.status === 'PENDING_ACCEPTANCE').length
          : (sc.pendingAcceptance || 0));

    // 6. Floor & Stylist Capacity Calculations
    let availableStaffCount = pulse?.floorCapacity?.availableStaff;
    let onDutyStaffCount = pulse?.floorCapacity?.onDutyStaff;

    if (availableStaffCount === undefined || onDutyStaffCount === undefined) {
      const todayDateIso = new Date().toISOString().split('T')[0];
      availableStaffCount = 0;
      onDutyStaffCount = 0;

      (staffList || []).forEach((st) => {
        const isAbsent = (st.absences || []).some((ab) => {
          if (ab.status !== 'ACTIVE') return false;
          const s = (ab.startDate || '').split('T')[0];
          const e = (ab.endDate || s).split('T')[0];
          return todayDateIso >= s && todayDateIso <= e;
        });
        if (isAbsent || todayClosure) return;
        onDutyStaffCount++;

        const isBusy = appts.some((a) => {
          const isThisStaff = (a.staff?.id || a.staffId) === st.id;
          const isInChair = a.status === 'SEATED_IN_CHAIR' || a.status === 'IN_SERVICE';
          return isThisStaff && isInChair;
        });

        if (!isBusy) availableStaffCount++;
      });
    }

    // Revenue calculation
    let todayRevenue = Number(pulse?.todayRevenue ?? summary.todayRevenue ?? 0);
    if (todayRevenue === 0 && appts.length > 0) {
      const completedAppts = appts.filter((a) => a.status === 'COMPLETED');
      if (completedAppts.length > 0) {
        todayRevenue = completedAppts.reduce((sum, a) => sum + (Number(a.price) || Number(a.service?.price) || 0), 0);
      }
    }

    let subtitle = 'No closed visits yet today';
    if (completedCount > 0) {
      subtitle = `Collected from ${completedCount} completed visit${completedCount === 1 ? '' : 's'}`;
      if (upcomingCount > 0) subtitle += ` • ${upcomingCount} in queue`;
      if (inChairCount > 0) subtitle += ` • ${inChairCount} in chair`;
    } else if (upcomingCount > 0 || inChairCount > 0) {
      subtitle = `${upcomingCount} in queue • ${inChairCount} in chair`;
    }

    const whatsappRemaining = summary.whatsappQuota?.remaining !== undefined ? summary.whatsappQuota.remaining : 1000;

    return `
      <div id="home-revenue-pulse-card" class="glass-panel" style="background: linear-gradient(145deg, #181324 0%, #0d0a14 100%); border: 1px solid rgba(245, 158, 11, 0.24); border-radius: 20px; padding: 20px 20px 18px 20px; position: relative; overflow: hidden; box-shadow: 0 12px 35px rgba(0,0,0,0.45);">
        
        <!-- Subtle Top Ambient Glow -->
        <div style="position: absolute; top: -40px; right: -40px; width: 160px; height: 160px; background: radial-gradient(circle, rgba(245, 158, 11, 0.15) 0%, transparent 70%); pointer-events: none;"></div>

        <!-- Top Header: Title & Quick Glass Action Buttons -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; flex-wrap: wrap; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 7px;">
            ${Icons.sparkles({ size: 14, color: '#fbbf24' })}
            <span style="font-size: 0.72rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #fbbf24;">
              ${labelPrefix} REVENUE TAKE
            </span>
          </div>

          <!-- Top Quick Actions (Store QR + Share Link) -->
          <div style="display: flex; align-items: center; gap: 6px;">
            <button type="button" id="btn-home-store-qr" style="background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.14); color: #f1f5f9; padding: 4px 10px; border-radius: 9999px; font-size: 0.70rem; font-weight: 600; display: inline-flex; align-items: center; gap: 5px; cursor: pointer; transition: all 0.2s ease;">
              ${Icons.qrCode({ size: 12, color: '#f1f5f9' })}
              <span>Store QR</span>
            </button>
            <button type="button" id="btn-home-copy-link" style="background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.14); color: #f1f5f9; padding: 4px 10px; border-radius: 9999px; font-size: 0.70rem; font-weight: 600; display: inline-flex; align-items: center; gap: 5px; cursor: pointer; transition: all 0.2s ease;">
              ${Icons.copy({ size: 12, color: '#f1f5f9' })}
              <span>Share Link</span>
            </button>
          </div>
        </div>

        <!-- Middle: Big Revenue & Subtitle in Clean Hierarchy -->
        <div style="margin-bottom: 16px;">
          <div style="font-size: 2.5rem; font-weight: 900; letter-spacing: -0.03em; color: #ffffff; line-height: 1.05; margin-bottom: 5px; font-family: var(--font-heading, sans-serif);">
            ₹${Number(todayRevenue).toLocaleString('en-IN')}
          </div>
          <div style="font-size: 0.78rem; color: #94a3b8; font-weight: 500;">
            ${subtitle}
          </div>
        </div>

        <!-- Primary 4-Cell Telemetry Grid (Guaranteed Full Operational Overview) -->
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; padding-top: 14px; border-top: 1px solid rgba(255, 255, 255, 0.08);">
          
          <!-- Cell 1: Total Booked -->
          <div class="home-pulse-metric-cell" data-filter="ALL" style="text-align: center; background: rgba(56, 189, 248, 0.04); border: 1px solid rgba(56, 189, 248, 0.16); border-radius: 10px; padding: 8px 2px; cursor: pointer; transition: all 0.2s ease;">
            <div style="font-size: 1.25rem; font-weight: 800; color: #38bdf8; line-height: 1.1; font-family: var(--font-heading, sans-serif);">${totalBookedCount}</div>
            <div style="font-size: 0.62rem; color: #94a3b8; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 3px;">Total Booked</div>
          </div>

          <!-- Cell 2: In Queue -->
          <div class="home-pulse-metric-cell" data-filter="WAITING" style="text-align: center; background: rgba(245, 158, 11, 0.04); border: 1px solid rgba(245, 158, 11, 0.16); border-radius: 10px; padding: 8px 2px; cursor: pointer; transition: all 0.2s ease;">
            <div style="font-size: 1.25rem; font-weight: 800; color: #fbbf24; line-height: 1.1; font-family: var(--font-heading, sans-serif);">${upcomingCount}</div>
            <div style="font-size: 0.62rem; color: #94a3b8; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 3px;">In Queue</div>
          </div>

          <!-- Cell 3: In Chair -->
          <div class="home-pulse-metric-cell" data-filter="IN_CHAIR" style="text-align: center; background: rgba(192, 132, 252, 0.04); border: 1px solid rgba(192, 132, 252, 0.16); border-radius: 10px; padding: 8px 2px; cursor: pointer; transition: all 0.2s ease;">
            <div style="font-size: 1.25rem; font-weight: 800; color: #c084fc; line-height: 1.1; font-family: var(--font-heading, sans-serif);">${inChairCount}</div>
            <div style="font-size: 0.62rem; color: #94a3b8; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 3px;">In Chair</div>
          </div>

          <!-- Cell 4: Completed -->
          <div class="home-pulse-metric-cell" data-filter="COMPLETED" style="text-align: center; background: rgba(52, 211, 153, 0.04); border: 1px solid rgba(52, 211, 153, 0.16); border-radius: 10px; padding: 8px 2px; cursor: pointer; transition: all 0.2s ease;">
            <div style="font-size: 1.25rem; font-weight: 800; color: #34d399; line-height: 1.1; font-family: var(--font-heading, sans-serif);">${completedCount}</div>
            <div style="font-size: 0.62rem; color: #94a3b8; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; margin-top: 3px;">Completed</div>
          </div>

        </div>

        <!-- Secondary Floor & Automation Readiness Pulse Bar -->
        <div style="margin-top: 12px; padding-top: 10px; border-top: 1px dashed rgba(255, 255, 255, 0.06); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; font-size: 0.72rem; color: #94a3b8;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="color: #34d399; font-size: 0.70rem;">●</span>
            <span>Floor: <strong style="color: #34d399;">${availableStaffCount}</strong> / ${onDutyStaffCount} Chairs Free for Walk-In</span>
          </div>

          <div style="display: flex; align-items: center; gap: 10px;">
            ${pendingCount > 0 ? `
              <span style="color: #fbbf24; font-weight: 700; background: rgba(245, 158, 11, 0.15); padding: 1px 7px; border-radius: 4px;">
                ⚡ ${pendingCount} Pending Action
              </span>
            ` : ''}
            <span style="color: #cbd5e1;">
              💬 WhatsApp: <strong style="color: #34d399;">Active</strong> (${whatsappRemaining} free)
            </span>
          </div>
        </div>

      </div>
    `;
  }

  /**
   * CARD 2: DEDICATED QUICK BOOKING REQUESTS HUB
   * Pixel-perfect professional layout:
   * - Big font count (2.1rem) vertically centered with stacked label & status
   * - Compact vertical height (~84px when 0 pending, reduced padding 12px 16px)
   * - Flawless 2-row alignment with zero broken line wraps
   * - Prominent View Requests button in header
   */
  static renderQuickBookingCard(todayAppointments = [], precomputedQuickRequests = null) {
    const pendingRequests = Array.isArray(precomputedQuickRequests)
      ? precomputedQuickRequests.filter((a) => a.status === 'PENDING_ACCEPTANCE')
      : (todayAppointments || []).filter((a) => a.status === 'PENDING_ACCEPTANCE');
    const pendingCount = pendingRequests.length;
    const isPending = pendingCount > 0;

    return `
      <div id="home-quick-booking-card" class="glass-panel" style="background: linear-gradient(145deg, #181324 0%, #0d0a14 100%); border: 1px solid ${isPending ? 'rgba(245, 158, 11, 0.45)' : 'rgba(245, 158, 11, 0.22)'}; border-radius: 16px; padding: 14px 18px; position: relative; overflow: hidden; box-shadow: 0 8px 25px rgba(0,0,0,0.4); cursor: pointer; transition: all 0.25s ease;">
        
        <!-- Subtle Top Ambient Glow -->
        <div style="position: absolute; top: -30px; right: -30px; width: 100px; height: 100px; background: radial-gradient(circle, rgba(245, 158, 11, ${isPending ? '0.18' : '0.08'}) 0%, transparent 70%); pointer-events: none;"></div>

        <!-- Row 1: Header (Channel Info & View Requests Action) -->
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
            <div style="width: 28px; height: 28px; border-radius: 8px; background: rgba(245, 158, 11, 0.16); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              ${Icons.zap({ size: 15, color: '#fbbf24' })}
            </div>
            <div style="min-width: 0;">
              <div style="font-size: 0.72rem; font-weight: 800; letter-spacing: 0.07em; text-transform: uppercase; color: #fbbf24; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                QUICK BOOKINGS
              </div>
              <div style="font-size: 0.66rem; color: #94a3b8; line-height: 1.1; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                WhatsApp & QR Online Dispatch
              </div>
            </div>
          </div>

          <!-- View Requests Action Button -->
          <button type="button" class="btn-open-quick-modal" style="background: ${isPending ? 'rgba(245, 158, 11, 0.20)' : 'rgba(255, 255, 255, 0.06)'}; border: 1px solid ${isPending ? 'rgba(245, 158, 11, 0.5)' : 'rgba(255, 255, 255, 0.12)'}; color: ${isPending ? '#fbbf24' : '#cbd5e1'}; font-size: 0.72rem; font-weight: 700; padding: 5px 12px; border-radius: 8px; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; flex-shrink: 0; transition: all 0.2s ease;">
            <span>View Requests</span>
            <span style="font-size: 0.76rem;">→</span>
          </button>
        </div>

        <!-- Row 2: Metric & Live Status (Cleanly Aligned Horizontal Bar) -->
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-top: 12px;">
          <!-- Left: Big Number + Stacked Labels (Vertically Centered) -->
          <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
            <span style="font-size: 2.2rem; font-weight: 900; letter-spacing: -0.02em; color: ${isPending ? '#fbbf24' : '#ffffff'}; line-height: 1; font-family: var(--font-heading, sans-serif); flex-shrink: 0;">
              ${pendingCount}
            </span>
            <div style="display: flex; flex-direction: column; justify-content: center; gap: 2px; min-width: 0;">
              <span style="font-size: 0.68rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #fbbf24; line-height: 1.2; white-space: nowrap;">
                PENDING REQUESTS
              </span>
              <span style="font-size: 0.68rem; color: #94a3b8; line-height: 1.2; white-space: nowrap;">
                ${isPending 
                  ? `<strong style="color: #f87171;">${pendingCount} waiting for approval</strong>` 
                  : `✓ All requests processed`}
              </span>
            </div>
          </div>

          <!-- Right: Status Badge -->
          <div style="flex-shrink: 0;">
            ${isPending ? `
              <span style="background: rgba(239, 68, 68, 0.16); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35); font-size: 0.68rem; font-weight: 800; padding: 4px 10px; border-radius: 9999px; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap;">
                <span style="width: 6px; height: 6px; border-radius: 50%; background: #f87171; box-shadow: 0 0 6px #f87171;"></span>
                ${pendingRequests.length} Pending
              </span>
            ` : `
              <span style="background: rgba(16, 185, 129, 0.12); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.25); font-size: 0.68rem; font-weight: 700; padding: 4px 10px; border-radius: 9999px; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap;">
                <span style="width: 6px; height: 6px; border-radius: 50%; background: #34d399;"></span>
                All Caught Up
              </span>
            `}
          </div>
        </div>

      </div>
    `;
  }

  /**
   * SECTION 3: UPCOMING QUEUE (NEXT 3 IN LINE)
   * Senior UI/UX Styling:
   * - Responsive header with non-wrapping pills
   * - Clean empty state (unwanted walk-in button removed)
   */
  /**
   * SECTION 3: UPCOMING QUEUE & QUEUE SUMMARY HUB
   * - Shows live upcoming appointments if clients are in line
   * - When 0 in line, serves as an executive Queue Summary Cockpit:
   *   - Live queue status headline with dynamic intelligence
   *   - 3-Pill interactive telemetry (In Line, In Chair, Completed)
   *   - Floor availability telemetry and quick timeline link
   * - Unwanted walk-in button strictly excluded
   */
  /**
   * SECTION 3: UPCOMING BOOKINGS / OLD BOOKINGS
   * - Shows only top 3 upcoming user bookings when active
   * - When no upcoming bookings, cleanly displays up to 3 old/past bookings under "Old Bookings"
   * - "Full Queue →" button redirects directly to the queue section
   * - Simple, clean, and not confusing
   */
  static renderUpcomingQueue(todayAppointments = [], recentAppointments = [], precomputedUpcoming = null, precomputedRecent = null) {
    const activeStatuses = ['CONFIRMED', 'BOOKED', 'CHECKED_IN', 'ON_THE_WAY', 'PENDING_ACCEPTANCE'];
    const upcomingList = (Array.isArray(precomputedUpcoming) && precomputedUpcoming.length > 0)
      ? precomputedUpcoming
      : (todayAppointments || [])
          .filter((a) => activeStatuses.includes(a.status))
          .sort((a, b) => (a.startTime || a.startAt || '').localeCompare(b.startTime || b.startAt || ''))
          .slice(0, 3);

    const hasUpcoming = upcomingList.length > 0;

    // If no upcoming bookings, get up to 3 old / past bookings
    let oldBookings = [];
    if (!hasUpcoming) {
      if (Array.isArray(precomputedRecent) && precomputedRecent.length > 0) {
        oldBookings = precomputedRecent;
      } else {
        const pool = [...(todayAppointments || []), ...(recentAppointments || [])];
        const seenIds = new Set();
        oldBookings = pool
          .filter((a) => {
            if (!a || !a.id || seenIds.has(a.id)) return false;
            seenIds.add(a.id);
            return !activeStatuses.includes(a.status);
          })
          .sort((a, b) => new Date(b.createdAt || b.updatedAt || 0) - new Date(a.createdAt || a.updatedAt || 0))
          .slice(0, 3);
      }
    }

    const title = hasUpcoming ? 'Upcoming Bookings' : 'Old Bookings';
    const badgeText = hasUpcoming ? `Next ${upcomingList.length}` : 'Recent Visits';
    const displayList = hasUpcoming ? upcomingList : oldBookings;

    // Format clean date/time (e.g. "23 Oct, 1:05 PM" or "10:30 AM")
    const formatDateTime = (rawTimeOrDate) => {
      if (!rawTimeOrDate) return '';
      const str = String(rawTimeOrDate).trim();
      if (/^\d{1,2}:\d{2}\s*(AM|PM)?$/i.test(str)) {
        return str;
      }
      const d = new Date(str);
      if (isNaN(d.getTime())) return str;
      const now = new Date();
      const isToday = d.toDateString() === now.toDateString();
      const timePart = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
      if (isToday) {
        return timePart;
      }
      const datePart = d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
      return `${datePart}, ${timePart}`;
    };

    // Helper: 2-letter client initials
    const getInitials = (name) => {
      if (!name || name === 'Client' || name === 'In-Salon Guest') return 'G';
      const parts = name.trim().split(/\s+/);
      return parts.length >= 2
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : parts[0].substring(0, 2).toUpperCase();
    };

    // Helper: status pill with color-coded dot
    const getStatusPill = (status, isUpcoming, apptId) => {
      if (isUpcoming) {
        const isCheckedIn = status === 'CHECKED_IN';
        if (!isCheckedIn) {
          return `
            <button type="button" class="btn btn-secondary btn-sm btn-status" data-id="${apptId}" data-status="CHECKED_IN" style="background: rgba(16, 185, 129, 0.14); border: 1px solid rgba(16, 185, 129, 0.35); color: #34d399; font-size: 0.70rem; padding: 4px 10px; font-weight: 700; border-radius: 6px; white-space: nowrap; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; transition: all 0.2s ease;">
              <span>Check In</span>
            </button>
          `;
        }
        return `
          <span style="background: rgba(16, 185, 129, 0.14); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.28); font-size: 0.68rem; font-weight: 700; padding: 3px 8px; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;">
            <span style="width: 5px; height: 5px; border-radius: 50%; background: #34d399;"></span>
            Checked In
          </span>
        `;
      }

      switch (status) {
        case 'COMPLETED':
          return `
            <span style="background: rgba(16, 185, 129, 0.12); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.25); font-size: 0.68rem; font-weight: 700; padding: 3px 8px; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;">
              <span style="width: 5px; height: 5px; border-radius: 50%; background: #34d399;"></span>
              Completed
            </span>
          `;
        case 'CANCELLED':
        case 'REJECTED':
          return `
            <span style="background: rgba(239, 68, 68, 0.12); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.25); font-size: 0.68rem; font-weight: 700; padding: 3px 8px; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;">
              <span style="width: 5px; height: 5px; border-radius: 50%; background: #f87171;"></span>
              Cancelled
            </span>
          `;
        case 'IN_SERVICE':
        case 'SEATED_IN_CHAIR':
          return `
            <span style="background: rgba(192, 132, 252, 0.12); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.25); font-size: 0.68rem; font-weight: 700; padding: 3px 8px; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;">
              <span style="width: 5px; height: 5px; border-radius: 50%; background: #c084fc;"></span>
              In Chair
            </span>
          `;
        case 'NO_SHOW':
          return `
            <span style="background: rgba(245, 158, 11, 0.12); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.25); font-size: 0.68rem; font-weight: 700; padding: 3px 8px; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;">
              <span style="width: 5px; height: 5px; border-radius: 50%; background: #fbbf24;"></span>
              No Show
            </span>
          `;
        default:
          return `
            <span style="background: rgba(148, 163, 184, 0.12); color: #cbd5e1; border: 1px solid rgba(148, 163, 184, 0.25); font-size: 0.68rem; font-weight: 600; padding: 3px 8px; border-radius: 9999px; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;">
              ${status || 'Concluded'}
            </span>
          `;
      }
    };

    return `
      <div id="home-upcoming-queue-section" class="glass-panel" style="background: rgba(22, 17, 30, 0.85); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 16px; padding: 14px 16px;">
        
        <!-- Header: Clean & Simple Layout -->
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 9px; min-width: 0;">
            <div style="width: 28px; height: 28px; border-radius: 8px; background: rgba(168, 85, 247, 0.14); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              ${hasUpcoming ? Icons.clock({ size: 15, color: '#c084fc' }) : Icons.calendar({ size: 15, color: '#c084fc' })}
            </div>
            <div style="min-width: 0;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 0.84rem; font-weight: 800; color: #fff; letter-spacing: -0.01em; white-space: nowrap;">
                  ${title}
                </span>
                <span style="background: rgba(168, 85, 247, 0.15); color: #c084fc; font-size: 0.65rem; font-weight: 700; padding: 1px 6px; border-radius: 4px; white-space: nowrap;">
                  ${badgeText}
                </span>
              </div>
              <div style="font-size: 0.66rem; color: #94a3b8; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${hasUpcoming ? 'Next clients arriving for service' : 'Recent appointment history'}
              </div>
            </div>
          </div>

          <!-- View Queue Button (Redirects to Queue Section) -->
          <button type="button" class="btn btn-secondary btn-sm" id="btn-home-view-queue" style="font-size: 0.70rem; font-weight: 700; padding: 4px 10px; border-radius: 7px; color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3); background: rgba(168, 85, 247, 0.08); cursor: pointer; flex-shrink: 0; white-space: nowrap; transition: all 0.2s ease;">
            <span>Full Queue →</span>
          </button>
        </div>

        <!-- Bookings List (Max 3 Items) -->
        <div style="margin-top: 10px; display: flex; flex-direction: column; gap: 8px;">
          ${displayList.length === 0 ? `
            <div style="text-align: center; padding: 16px 10px; color: #94a3b8; font-size: 0.75rem;">
              No bookings recorded yet.
            </div>
          ` : displayList.map((appt) => {
            const rawClient = appt.customer?.name || appt.customerName || appt.salonUser?.fullName || appt.user?.name || '';
            const clientName = rawClient && rawClient !== 'Client' ? rawClient : (appt.service?.name ? `Guest (${appt.service.name.split(' ')[0]})` : 'Salon Guest');
            const initials = getInitials(clientName);
            const serviceName = appt.service?.name || appt.serviceName || 'Salon Service';
            const stylistName = appt.staff?.name || appt.stylist?.name || '';
            const price = appt.service?.price || appt.price || 0;
            const status = appt.status || 'BOOKED';

            const timeStr = formatDateTime(appt.startTime || appt.startAt || appt.createdAt);
            const statusBadge = getStatusPill(status, hasUpcoming, appt.id);

            return `
              <div class="booking-row-card" style="background: rgba(255, 255, 255, 0.025); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 12px; padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
                
                <!-- Left: Initials Avatar + Info Stack -->
                <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
                  <div style="width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%); display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.72rem; color: #fff; flex-shrink: 0;">
                    ${initials}
                  </div>

                  <div style="min-width: 0; flex: 1;">
                    <div style="display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;">
                      <span style="font-weight: 700; font-size: 0.84rem; color: #ffffff; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                        ${clientName}
                      </span>
                      ${timeStr ? `
                        <span style="color: #94a3b8; font-size: 0.68rem; line-height: 1.2; white-space: nowrap;">
                          • ${timeStr}
                        </span>
                      ` : ''}
                    </div>

                    <div style="font-size: 0.70rem; color: #94a3b8; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                      <span style="color: #c084fc; font-weight: 600;">${serviceName}</span>
                      ${stylistName ? `<span style="color: #64748b;"> • ${stylistName}</span>` : ''}
                      ${price > 0 ? `<span style="color: #fbbf24;"> • ₹${price}</span>` : ''}
                    </div>
                  </div>
                </div>

                <!-- Right: Status Badge / Action -->
                <div style="flex-shrink: 0;">
                  ${statusBadge}
                </div>

              </div>
            `;
          }).join('')}
        </div>

      </div>
    `;
  }


  /**
   * SECTION 4: STAFF SUMMARY (EXECUTIVE FLOOR OVERVIEW)
   * Executive front-desk staff summary:
   * - Total Staff
   * - Available / Free (Ready for walk-in)
   * - Busy / In Chair (Actively serving)
   * - On Break (Lunch / routine break)
   * - Off Duty / Leave (Absence or weekly off)
   * - Visual floor distribution progress bar
   * - Direct 1-click link to full Stylists roster tab
   */
  static renderStaffSummary(staffList = [], todayAppointments = [], todayClosure = null, selectedDate = null, precomputedStaffSummary = null) {
    let totalStaff = 0;
    let availableCount = 0;
    let inChairCount = 0;
    let onBreakCount = 0;
    let offDutyCount = 0;
    let freePct = 0;
    let busyPct = 0;
    let breakPct = 0;
    let offPct = 0;
    let statusHighlight = '';

    if (precomputedStaffSummary && typeof precomputedStaffSummary === 'object' && precomputedStaffSummary.total !== undefined) {
      totalStaff = precomputedStaffSummary.total;
      availableCount = precomputedStaffSummary.free;
      inChairCount = precomputedStaffSummary.inChair;
      onBreakCount = precomputedStaffSummary.onBreak;
      offDutyCount = precomputedStaffSummary.offDuty;
      freePct = precomputedStaffSummary.freePct;
      busyPct = precomputedStaffSummary.busyPct;
      breakPct = precomputedStaffSummary.breakPct;
      offPct = precomputedStaffSummary.offPct;
      statusHighlight = precomputedStaffSummary.highlight || '';
    } else {
      const todayDateIso = (selectedDate || new Date().toISOString().split('T')[0]);
      const now = new Date();
      const curHour = String(now.getHours()).padStart(2, '0');
      const curMin = String(now.getMinutes()).padStart(2, '0');
      const curTime = `${curHour}:${curMin}`;
      const dayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
      const currentDay = dayNames[now.getDay()];

      totalStaff = (staffList || []).length;

      (staffList || []).forEach((st) => {
        // 1. Off Duty / Leave / Closed
        const isAbsent = (st.absences || []).some((ab) => {
          if (ab.status !== 'ACTIVE') return false;
          const s = (ab.startDate || '').split('T')[0];
          const e = (ab.endDate || s).split('T')[0];
          return todayDateIso >= s && todayDateIso <= e;
        });

        const isOffDay = (st.workingHours || []).some((wh) => {
          return wh.dayOfWeek === currentDay && (wh.isClosed || wh.isOff || wh.isWorking === false);
        });

        if (
          todayClosure ||
          isAbsent ||
          st.status === 'INACTIVE' ||
          st.operationalStatus === 'ON_LEAVE' ||
          st.operationalStatus === 'WEEKLY_OFF' ||
          st.operationalStatus === 'SALON_OFF' ||
          isOffDay
        ) {
          offDutyCount++;
          return;
        }

        // 2. In Chair / Busy
        const activeAppt = (todayAppointments || []).find((a) => {
          const isThisStaff = (a.staff?.id || a.staffId) === st.id;
          const inService = a.status === 'SEATED_IN_CHAIR' || a.status === 'IN_SERVICE';
          return isThisStaff && inService;
        });

        if (activeAppt || st.operationalStatus === 'WORKING') {
          inChairCount++;
          return;
        }

        // 3. On Break
        const isBreak = st.operationalStatus === 'ON_BREAK' || (Array.isArray(st.breaks) && st.breaks.some((b) => {
          if (b.dayOfWeek && b.dayOfWeek !== currentDay) return false;
          return b.startTime && b.endTime && curTime >= b.startTime && curTime <= b.endTime;
        }));

        if (isBreak) {
          onBreakCount++;
          return;
        }

        // 4. Available (Free)
        availableCount++;
      });

      freePct = totalStaff > 0 ? Math.round((availableCount / totalStaff) * 100) : 0;
      busyPct = totalStaff > 0 ? Math.round((inChairCount / totalStaff) * 100) : 0;
      breakPct = totalStaff > 0 ? Math.round((onBreakCount / totalStaff) * 100) : 0;
      offPct = totalStaff > 0 ? Math.max(0, 100 - freePct - busyPct - breakPct) : 0;

      if (totalStaff === 0) {
        statusHighlight = 'No specialists registered yet. Click "Manage Staff" to add team members.';
      } else if (availableCount > 0) {
        statusHighlight = `<span style="color: #34d399; font-weight: 700;">🟢 ${availableCount} of ${totalStaff} specialists</span> are free and ready for walk-in clients right now.`;
      } else if (inChairCount > 0) {
        statusHighlight = `<span style="color: #c084fc; font-weight: 700;">🟣 All on-duty specialists</span> are currently seated with clients in chair.`;
      } else {
        statusHighlight = `<span style="color: #94a3b8; font-weight: 700;">⚪ No specialists on floor</span> at this moment (all off duty or on scheduled leave).`;
      }
    }

    return `
      <div id="home-floor-radar-section" class="glass-panel" style="background: rgba(22, 17, 30, 0.85); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 14px; padding: 12px 16px;">
        
        <!-- COMPACT HEADER -->
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
            ${Icons.users({ size: 16, color: '#38bdf8' })}
            <span style="font-size: 0.86rem; font-weight: 800; color: #fff; letter-spacing: -0.01em; white-space: nowrap;">Staff Summary</span>
            <span style="font-size: 0.66rem; font-weight: 700; color: #38bdf8; background: rgba(56, 189, 248, 0.12); border: 1px solid rgba(56, 189, 248, 0.25); padding: 1px 7px; border-radius: 6px; white-space: nowrap;">
              ${totalStaff}
            </span>
          </div>

          <button type="button" class="btn-home-manage-staff" id="btn-home-manage-staff" style="background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.12); color: #fff; font-size: 0.70rem; font-weight: 700; padding: 4px 10px; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; flex-shrink: 0; transition: all 0.15s ease;">
            <span>Manage Staff</span>
            <span style="font-size: 0.76rem;">→</span>
          </button>
        </div>

        <!-- 5-COLUMN COMPACT METRIC ROW -->
        <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; margin: 10px 0 8px 0;">
          
          <!-- 1. TOTAL -->
          <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 6px 2px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 48px;">
            <div style="font-size: 1.15rem; font-weight: 800; color: #fff; line-height: 1;">
              ${totalStaff}
            </div>
            <div style="font-size: 0.58rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-top: 4px; white-space: nowrap;">
              Total
            </div>
          </div>

          <!-- 2. AVAILABLE / FREE -->
          <div style="background: rgba(16, 185, 129, 0.06); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 8px; padding: 6px 2px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 48px;">
            <div style="font-size: 1.15rem; font-weight: 800; color: #34d399; line-height: 1;">
              ${availableCount}
            </div>
            <div style="font-size: 0.58rem; font-weight: 700; color: #34d399; text-transform: uppercase; margin-top: 4px; white-space: nowrap;">
              Free
            </div>
          </div>

          <!-- 3. BUSY / IN CHAIR -->
          <div style="background: rgba(168, 85, 247, 0.06); border: 1px solid rgba(168, 85, 247, 0.25); border-radius: 8px; padding: 6px 2px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 48px;">
            <div style="font-size: 1.15rem; font-weight: 800; color: #c084fc; line-height: 1;">
              ${inChairCount}
            </div>
            <div style="font-size: 0.58rem; font-weight: 700; color: #c084fc; text-transform: uppercase; margin-top: 4px; white-space: nowrap;">
              In Chair
            </div>
          </div>

          <!-- 4. ON BREAK -->
          <div style="background: rgba(245, 158, 11, 0.06); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 8px; padding: 6px 2px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 48px;">
            <div style="font-size: 1.15rem; font-weight: 800; color: #fbbf24; line-height: 1;">
              ${onBreakCount}
            </div>
            <div style="font-size: 0.58rem; font-weight: 700; color: #fbbf24; text-transform: uppercase; margin-top: 4px; white-space: nowrap;">
              Break
            </div>
          </div>

          <!-- 5. OFF DUTY -->
          <div style="background: rgba(148, 163, 184, 0.06); border: 1px solid rgba(148, 163, 184, 0.18); border-radius: 8px; padding: 6px 2px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 48px;">
            <div style="font-size: 1.15rem; font-weight: 800; color: #94a3b8; line-height: 1;">
              ${offDutyCount}
            </div>
            <div style="font-size: 0.58rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; margin-top: 4px; white-space: nowrap;">
              Off
            </div>
          </div>

        </div>

        <!-- SLIM FLOOR COVERAGE BAR & STATUS -->
        ${totalStaff > 0 ? `
          <div style="display: flex; height: 4px; border-radius: 999px; overflow: hidden; background: rgba(255,255,255,0.06); margin-top: 6px;">
            <div style="width: ${freePct}%; background: #10b981;" title="${availableCount} Free (${freePct}%)"></div>
            <div style="width: ${busyPct}%; background: #a855f7;" title="${inChairCount} In Chair (${busyPct}%)"></div>
            <div style="width: ${breakPct}%; background: #f59e0b;" title="${onBreakCount} Break (${breakPct}%)"></div>
            <div style="width: ${offPct}%; background: #64748b;" title="${offDutyCount} Off Duty (${offPct}%)"></div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 6px; font-size: 0.68rem; gap: 6px;">
            <span style="color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
              ${availableCount > 0 ? `🟢 <strong style="color:#fff;">${availableCount}</strong> available for walk-ins` : 'All specialists currently busy'}
            </span>
            <span style="color: #34d399; font-weight: 700; white-space: nowrap; flex-shrink: 0;">
              ${freePct}% Ready
            </span>
          </div>
        ` : `
          <div style="font-size: 0.70rem; color: #64748b; text-align: center; padding: 4px 0;">
            No specialists added yet. Tap "Manage Staff" to add team.
          </div>
        `}

      </div>
    `;
  }

  /**
   * SECTION 5: SERVICES SUMMARY (MENU & CATALOG OVERVIEW)
   * Front-desk operational overview of salon services:
   * - Total Services Count
   * - Active Categories Count
   * - Price Range (Min - Max) & Average Price
   * - Average Session Duration
   * - Category badge breakdown
   * - 1-Click link to full Service Menu tab
   */
  static renderServicesSummary(servicesList = [], categoriesList = [], precomputedServicesSummary = null) {
    const services = Array.isArray(servicesList) ? servicesList : [];
    let totalServices = 0;
    let activeCount = 0;
    let totalCategories = 0;
    let minPrice = 0;
    let maxPrice = 0;
    let avgPrice = 0;
    let avgDuration = 30;
    const catMap = {};

    if (precomputedServicesSummary && typeof precomputedServicesSummary === 'object' && precomputedServicesSummary.activeCount !== undefined) {
      activeCount = precomputedServicesSummary.activeCount;
      totalServices = precomputedServicesSummary.activeCount;
      totalCategories = precomputedServicesSummary.totalCategories;
      avgPrice = precomputedServicesSummary.avgTicket;
      avgDuration = precomputedServicesSummary.avgDurationMinutes;
      minPrice = precomputedServicesSummary.minPrice || 0;
      maxPrice = precomputedServicesSummary.maxPrice || 0;
      (precomputedServicesSummary.categories || []).forEach((c) => {
        catMap[c.name] = c.count;
      });
    } else {
      const activeServices = services.filter((s) => s.status !== 'INACTIVE');
      totalServices = services.length;
      activeCount = activeServices.length;

      activeServices.forEach((s) => {
        const catName = (s.category || 'General').trim();
        catMap[catName] = (catMap[catName] || 0) + 1;
      });

      const distinctCatsFallback = Object.keys(catMap);
      totalCategories = Math.max(distinctCatsFallback.length, (categoriesList || []).length);

      const prices = activeServices.map((s) => Number(s.price || 0)).filter((p) => p > 0);
      minPrice = prices.length > 0 ? Math.min(...prices) : 0;
      maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
      avgPrice = prices.length > 0 ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length) : 0;

      const durations = activeServices.map((s) => Number(s.durationMinutes || s.duration || 0)).filter((d) => d > 0);
      avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 30;
    }

    const distinctCats = Object.keys(catMap);

    return `
      <div id="home-services-summary-section" class="glass-panel" style="background: rgba(22, 17, 30, 0.85); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 14px; padding: 12px 16px;">
        
        <!-- COMPACT HEADER -->
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
            ${Icons.scissors({ size: 16, color: '#f43f5e' })}
            <span style="font-size: 0.86rem; font-weight: 800; color: #fff; letter-spacing: -0.01em; white-space: nowrap;">Services Summary</span>
            <span style="font-size: 0.66rem; font-weight: 700; color: #f43f5e; background: rgba(244, 63, 94, 0.12); border: 1px solid rgba(244, 63, 94, 0.25); padding: 1px 7px; border-radius: 6px; white-space: nowrap;">
              ${totalServices}
            </span>
          </div>

          <button type="button" class="btn-home-manage-services" id="btn-home-manage-services" style="background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.12); color: #fff; font-size: 0.70rem; font-weight: 700; padding: 4px 10px; border-radius: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; flex-shrink: 0; transition: all 0.15s ease;">
            <span>Manage Menu</span>
            <span style="font-size: 0.76rem;">→</span>
          </button>
        </div>

        <!-- 4-COLUMN COMPACT METRIC ROW -->
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 10px 0 8px 0;">
          
          <!-- 1. ACTIVE SERVICES -->
          <div style="background: rgba(244, 63, 94, 0.05); border: 1px solid rgba(244, 63, 94, 0.22); border-radius: 8px; padding: 6px 2px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 48px;">
            <div style="font-size: 1.15rem; font-weight: 800; color: #fb7185; line-height: 1;">
              ${activeCount}
            </div>
            <div style="font-size: 0.58rem; font-weight: 700; color: #fb7185; text-transform: uppercase; margin-top: 4px; white-space: nowrap;">
              Active
            </div>
          </div>

          <!-- 2. CATEGORIES -->
          <div style="background: rgba(129, 140, 248, 0.05); border: 1px solid rgba(129, 140, 248, 0.22); border-radius: 8px; padding: 6px 2px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 48px;">
            <div style="font-size: 1.15rem; font-weight: 800; color: #a5b4fc; line-height: 1;">
              ${totalCategories}
            </div>
            <div style="font-size: 0.55rem; font-weight: 700; color: #a5b4fc; text-transform: uppercase; margin-top: 4px; white-space: nowrap; letter-spacing: 0.01em;">
              Categories
            </div>
          </div>

          <!-- 3. PRICE RANGE -->
          <div style="background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.22); border-radius: 8px; padding: 6px 2px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 48px;" title="Range: ₹${minPrice} - ₹${maxPrice}">
            <div style="font-size: 1.10rem; font-weight: 800; color: #34d399; line-height: 1; white-space: nowrap;">
              ₹${avgPrice}
            </div>
            <div style="font-size: 0.58rem; font-weight: 700; color: #34d399; text-transform: uppercase; margin-top: 4px; white-space: nowrap;">
              Avg Ticket
            </div>
          </div>

          <!-- 4. AVG DURATION -->
          <div style="background: rgba(245, 158, 11, 0.05); border: 1px solid rgba(245, 158, 11, 0.22); border-radius: 8px; padding: 6px 2px; text-align: center; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 48px;">
            <div style="font-size: 1.15rem; font-weight: 800; color: #fbbf24; line-height: 1;">
              ${avgDuration}m
            </div>
            <div style="font-size: 0.58rem; font-weight: 700; color: #fbbf24; text-transform: uppercase; margin-top: 4px; white-space: nowrap;">
              Avg Time
            </div>
          </div>

        </div>

        <!-- CATEGORIES HORIZONTAL STRIP (NEVER WRAPS RAGGEDLY) -->
        ${distinctCats.length > 0 ? `
          <div style="margin-top: 8px; padding-top: 7px; border-top: 1px solid rgba(255, 255, 255, 0.06);">
            <div style="display: flex; align-items: center; gap: 6px; overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; padding: 1px 0;">
              <span style="font-size: 0.60rem; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap; flex-shrink: 0;">
                Categories:
              </span>
              ${distinctCats.map((cat) => `
                <span style="display: inline-flex; align-items: center; gap: 4px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 6px; padding: 2px 7px; font-size: 0.68rem; color: #cbd5e1; white-space: nowrap; flex-shrink: 0;">
                  <span>${cat}</span>
                  <span style="background: rgba(244, 63, 94, 0.16); color: #fb7185; font-weight: 700; padding: 0 4px; border-radius: 4px; font-size: 0.60rem;">${catMap[cat]}</span>
                </span>
              `).join('')}
            </div>
          </div>
        ` : `
          <div style="font-size: 0.70rem; color: #64748b; text-align: center; padding: 4px 0;">
            No service categories configured yet.
          </div>
        `}

      </div>
    `;
  }

  /**
   * Backwards-compatible alias for renderFloorRadar
   */
  static renderFloorRadar(staffList = [], todayAppointments = [], todayClosure = null, selectedDate = null) {
    return this.renderStaffSummary(staffList, todayAppointments, todayClosure, selectedDate);
  }

  /**
   * SECTION 5: RECEPTION FAST ACTION COMMAND LAUNCHPAD
   * 4 Bento tiles for instant floor actions:
   * - Fast Walk-In: Register client in 10s and assign chair
   * - Booking QR Poster: Printable acrylic counter standee
   * - Chair Queue: Real-time operational timeline
   * - Share Booking Link: Instant copy for Instagram bio & WhatsApp
   */
  static renderQuickActions(profile = {}, todayAppointments = []) {
    const queueCount = (todayAppointments || []).length;

    return `
      <div class="glass-panel" style="background: rgba(22, 17, 30, 0.85); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 16px; padding: 18px 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            ${Icons.zap({ size: 16, color: '#fbbf24' })}
            <span style="font-size: 0.86rem; font-weight: 800; color: #fff; letter-spacing: -0.01em;">Fast Reception Actions</span>
          </div>
          <span style="font-size: 0.70rem; color: #94a3b8; font-weight: 600;">Instant Store Operations</span>
        </div>

        <div class="action-tiles-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px;">
          
          <!-- Tile 1: Fast Walk-In -->
          <div class="action-tile" id="card-action-walkin" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 14px; cursor: pointer; transition: all 0.2s ease;">
            <div class="action-tile-icon" style="background: rgba(139, 61, 255, 0.15); border: 1px solid rgba(139, 61, 255, 0.3); width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; margin-bottom: 8px;">
              ${Icons.zap({ size: 18, color: '#a5b4fc' })}
            </div>
            <div class="action-tile-title" style="font-weight: 700; font-size: 0.88rem; color: #fff;">Fast Walk-In</div>
            <div class="action-tile-desc" style="font-size: 0.72rem; color: #94a3b8; margin-top: 2px;">Seat arrival in 10s and assign stylist</div>
          </div>

          <!-- Tile 2: Booking QR Poster -->
          <div class="action-tile" id="card-action-qr" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 14px; cursor: pointer; transition: all 0.2s ease;">
            <div class="action-tile-icon" style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; margin-bottom: 8px;">
              ${Icons.qrCode({ size: 18, color: '#34d399' })}
            </div>
            <div class="action-tile-title" style="font-weight: 700; font-size: 0.88rem; color: #fff;">Booking QR Standee</div>
            <div class="action-tile-desc" style="font-size: 0.72rem; color: #94a3b8; margin-top: 2px;">Print QR standee for salon counter</div>
          </div>

          <!-- Tile 3: Live Queue -->
          <div class="action-tile" id="card-action-queue" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 14px; cursor: pointer; transition: all 0.2s ease;">
            <div class="action-tile-icon" style="background: rgba(168, 85, 247, 0.15); border: 1px solid rgba(168, 85, 247, 0.3); width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; margin-bottom: 8px;">
              ${Icons.clock({ size: 18, color: '#c084fc' })}
            </div>
            <div class="action-tile-title" style="font-weight: 700; font-size: 0.88rem; color: #fff;">Full Queue (${queueCount})</div>
            <div class="action-tile-desc" style="font-size: 0.72rem; color: #94a3b8; margin-top: 2px;">Manage station timers & client ETA</div>
          </div>

          <!-- Tile 4: Share Link -->
          <div class="action-tile" id="card-action-copy" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 14px; padding: 14px; cursor: pointer; transition: all 0.2s ease;">
            <div class="action-tile-icon" style="background: rgba(14, 165, 233, 0.15); border: 1px solid rgba(14, 165, 233, 0.3); width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; margin-bottom: 8px;">
              ${Icons.copy({ size: 18, color: '#38bdf8' })}
            </div>
            <div class="action-tile-title" style="font-weight: 700; font-size: 0.88rem; color: #fff;">Share Booking Link</div>
            <div class="action-tile-desc" style="font-size: 0.72rem; color: #94a3b8; margin-top: 2px;">Copy URL for Instagram & Google Maps</div>
          </div>

        </div>
      </div>
    `;
  }

  /**
   * SECTION 6: WHATSAPP BOT & META MONTHLY FREE QUOTA TRACKER
   * Tracks the official Meta 1,000 free customer conversation sessions per month.
   */
  static renderWhatsAppQuotaCard(quota = {}) {
    const limit = quota?.limit || 1000;
    const used = quota?.used || 0;
    const remaining = quota?.remaining !== undefined ? quota.remaining : Math.max(0, limit - used);
    const percentUsed = quota?.percentUsed || Math.min(100, Math.round((used / limit) * 100));
    const resetsOn = quota?.resetsOn || '1st of next month';

    const barColor = percentUsed >= 90
      ? 'linear-gradient(90deg, #f43f5e, #fb7185)'
      : percentUsed >= 75
      ? 'linear-gradient(90deg, #f59e0b, #fbbf24)'
      : 'linear-gradient(90deg, #10b981, #34d399)';

    return `
      <div class="glass-panel" style="background: linear-gradient(135deg, rgba(37,211,102,0.06) 0%, rgba(18, 14, 25, 0.9) 100%); border: 1px solid rgba(37,211,102,0.22); border-radius: 16px; padding: 18px 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 12px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="width: 40px; height: 40px; border-radius: 10px; background: rgba(37,211,102,0.15); border: 1px solid rgba(37,211,102,0.3); display: flex; align-items: center; justify-content: center; font-size: 1.25rem;">
              💬
            </div>
            <div>
              <div style="font-weight: 800; font-size: 0.95rem; color: #fff; letter-spacing: -0.01em;">WhatsApp Automation Engine</div>
              <div style="font-size: 0.74rem; color: #94a3b8;">1,000 free customer booking sessions included every month by Meta</div>
            </div>
          </div>
          <span style="background: rgba(37,211,102,0.15); border: 1px solid rgba(37,211,102,0.3); color: #34d399; font-size: 0.72rem; font-weight: 700; padding: 4px 10px; border-radius: 9999px;">
            ${remaining} Free Sessions Left
          </span>
        </div>

        <!-- Quota Progress Bar -->
        <div style="width: 100%; height: 6px; background: rgba(255, 255, 255, 0.08); border-radius: 6px; overflow: hidden; margin-bottom: 10px;">
          <div style="width: ${Math.max(2, percentUsed)}%; height: 100%; background: ${barColor}; border-radius: 6px; transition: width 0.4s ease;"></div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.74rem; color: #94a3b8; flex-wrap: wrap; gap: 8px;">
          <div>
            <strong style="color: #fff;">${used}</strong> / ${limit} sessions used this month (${percentUsed}%)
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="color: #34d399;">●</span>
            <span>Resets on <strong style="color: #cbd5e1;">${resetsOn}</strong></span>
          </div>
        </div>
      </div>
    `;
  }
}
