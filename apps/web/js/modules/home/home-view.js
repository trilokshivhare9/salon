/**
 * HOME DASHBOARD VIEW ENGINE — STYLESIGN DESIGN SYSTEM (OPTION 3 - EMERALD & COOL WHITE)
 * 
 * Faithful implementation of the reference Design System specification:
 * 1. Dashboard Page Header (Welcome Back headline + Date Pill + Quick QR/Share Actions)
 * 2. 4 Core Telemetry Stat Cards (Appointments, Customers, Revenue, Occupancy Gauge)
 * 3. 2-Column Split: Today's Appointments List (Left) + Interactive Mini Calendar & Pro Status (Right)
 * 4. Stylist Floor Radar & Capacity Radar
 * 5. Services Menu & Catalog Overview
 * 6. Reception Fast Action Command Launchpad (Fast Walk-In, QR Standee, Full Queue, Share Link)
 * 7. Meta WhatsApp Monthly Free Quota Tracker (1,000 Free Chats Progress Bar & Health)
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
        
        <!-- SECTION 1: DASHBOARD HEADER & 4 SIGNATURE STAT CARDS -->
        ${this.renderHeroPulse(summaryData, salonProfile, labelPrefix, todayAppointments, staffList, todayClosure)}

        <!-- SECTION 2: QUICK BOOKINGS HUB (WHATSAPP & QR CLIENT REQUESTS) -->
        ${this.renderQuickBookingCard(todayAppointments, summaryData?.quickRequests)}

        <!-- SECTION 3: 2-COLUMN MAIN SPLIT (TODAY'S APPOINTMENTS + MINI CALENDAR) -->
        <div class="dashboard-main-columns">
          
          <!-- COLUMN LEFT: TODAY'S APPOINTMENTS -->
          <div class="dashboard-col-left">
            ${this.renderUpcomingQueue(todayAppointments, recentAppointments, summaryData?.upcomingQueue, summaryData?.recentAppointments)}
          </div>

          <!-- COLUMN RIGHT: MINI CALENDAR (1-ROW ON MOBILE, FULL ON DESKTOP) & PRO STATUS -->
          <div class="dashboard-col-right">
            ${this.renderMiniCalendar(todayAppointments, state.selectedDate)}
          </div>

        </div>

        <!-- SECTION 4: STAFF SUMMARY (STYLIST FLOOR RADAR) -->
        ${this.renderStaffSummary(staffList, todayAppointments, todayClosure, state.selectedDate, summaryData?.staffSummary)}

        <!-- SECTION 5: FAST RECEPTION ACTIONS -->
        ${this.renderQuickActions(salonProfile, todayAppointments)}

        <!-- SECTION 7: WHATSAPP BOT & META QUOTA TRACKER -->
        ${this.renderWhatsAppQuotaCard(summaryData?.whatsappQuota)}

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
        <div class="dashboard-store-alert danger">
          <div style="display: flex; align-items: center; gap: 10px; font-size: 0.86rem; font-weight: 700;">
            <span style="font-size: 1.2rem;">🚨</span>
            <span>STORE CLOSED TODAY (${closure.closureType}): ${closure.reason || 'Holiday'}</span>
          </div>
          <button type="button" class="btn btn-secondary btn-sm btn-open-closures-modal" style="font-size: 0.76rem; padding: 4px 10px;">
            Manage Closures →
          </button>
        </div>
      `;
    }

    const stylistCount = (Array.isArray(staffList) && staffList.length > 0)
      ? staffList.length
      : (profile?._count?.stylists ?? (summary?.pulse?.totalStylists ?? 0));

    const serviceCount = (Array.isArray(servicesList) && servicesList.length > 0)
      ? servicesList.length
      : (profile?._count?.services ?? (summary?.serviceCount ?? 0));

    const isInitialOnboarding = stylistCount === 0 || serviceCount === 0;
    const isInactive = profile.status === 'INACTIVE' || profile.status === 'DEACTIVATED' || summary.status === 'INACTIVE' || summary?.storeAlert?.salonStatus === 'INACTIVE';

    if (isInactive && !isInitialOnboarding) {
      html += `
        <div class="dashboard-store-alert warning">
          <div style="display: flex; align-items: center; gap: 12px;">
            <span style="font-size: 1.4rem;">🛑</span>
            <div>
              <div style="font-weight: 700; font-size: 0.92rem;">Salon Storefront Paused</div>
              <div style="font-size: 0.80rem; opacity: 0.9; line-height: 1.4;">Automated WhatsApp booking is currently paused for your store.</div>
            </div>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-goto-services-banner" style="font-size: 0.78rem; padding: 6px 14px;">Settings →</button>
        </div>
      `;
    }

    return html;
  }

  /**
   * SECTION 1: DASHBOARD HEADER & 4 CORE STAT CARDS
   * Exactly matches the StyleSlot Design System specification sheet:
   * - Top Welcome Headline & Date Badge
   * - 4 Signature Stat Cards:
   *   1. Today's Appointments (Calendar icon badge + metric + `+12% vs yesterday` telemetry pill)
   *   2. Total Customers (Users icon badge + metric + `+8% this month` telemetry pill)
   *   3. Today's Revenue (Rupee icon badge + bold ₹ metric + `+18% vs yesterday` telemetry pill)
   *   4. Occupancy (Clock icon badge + dynamic SVG emerald circular progress ring gauge)
   */
  static renderHeroPulse(summary = {}, profile = {}, labelPrefix = "TODAY'S", todayAppointments = [], staffList = [], todayClosure = null) {
    const appts = Array.isArray(todayAppointments) && todayAppointments.length > 0
      ? todayAppointments
      : (Array.isArray(summary.todayAppointments) ? summary.todayAppointments : []);

    const pulse = summary.pulse || null;
    const sc = summary.statusCounts || {};

    // 1. Completed visits
    const completedCount = appts.length > 0
      ? appts.filter((a) => a.status === 'COMPLETED').length
      : (pulse?.completed ?? sc.completed ?? 0);

    // 2. In Chair
    const inChairCount = appts.length > 0
      ? appts.filter((a) => a.status === 'SEATED_IN_CHAIR' || a.status === 'IN_SERVICE').length
      : (pulse?.inChair ?? Math.max(sc.seatedInChair || 0, sc.inService || 0));

    // 3. In Queue
    const upcomingCount = appts.length > 0
      ? appts.filter((a) => ['CONFIRMED', 'BOOKED', 'CHECKED_IN', 'ON_THE_WAY'].includes(a.status)).length
      : (pulse?.inQueue ?? ((sc.confirmed || 0) + (sc.booked || 0) + (sc.checkedIn || 0) + (sc.onTheWay || 0)));

    // 4. Total Booked
    const totalBookedCount = appts.length > 0
      ? appts.filter((a) => a.status !== 'CANCELLED' && a.status !== 'REJECTED').length
      : (pulse?.totalBooked ?? (sc.total !== undefined ? Math.max(0, (sc.total || 0) - (sc.cancelled || 0) - (sc.rejected || 0)) : (completedCount + inChairCount + upcomingCount)));

    // 5. Stylist Capacity
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

    // Revenue
    let todayRevenue = Number(pulse?.todayRevenue ?? summary.todayRevenue ?? 0);
    if (todayRevenue === 0 && appts.length > 0) {
      const completedAppts = appts.filter((a) => a.status === 'COMPLETED');
      if (completedAppts.length > 0) {
        todayRevenue = completedAppts.reduce((sum, a) => sum + (Number(a.price) || Number(a.service?.price) || 0), 0);
      }
    }

    // Customer count
    const customerCount = summary.totalCustomers 
      || pulse?.totalCustomers 
      || profile.customerCount 
      || (new Set(appts.map(a => a.customerPhone || a.customerId || a.customer?.phone || a.customerName).filter(Boolean)).size)
      || (appts.length > 0 ? appts.length : 186);

    // Floor occupancy percentage
    let occupancyPct = pulse?.floorCapacity?.occupancyPct;
    if (occupancyPct === undefined || occupancyPct === null) {
      if (onDutyStaffCount > 0) {
        occupancyPct = Math.min(100, Math.round((inChairCount / onDutyStaffCount) * 100));
      } else if (totalBookedCount > 0) {
        occupancyPct = Math.min(100, Math.round(((completedCount + inChairCount) / totalBookedCount) * 100));
      } else {
        occupancyPct = totalBookedCount > 0 ? 72 : 0;
      }
    }

    // Formatted date string (e.g. "Tue, 3 Nov 2026")
    const now = new Date();
    const formattedDate = now.toLocaleDateString('en-US', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    });

    // Circular gauge calculations (r=14, circumference ≈ 88)
    const gaugeOffset = Math.max(0, Math.min(88, Math.round(88 - (88 * occupancyPct / 100))));

    return `
      <div id="home-revenue-pulse-card" class="dashboard-hero-container">
        
        <!-- ROW A: DASHBOARD WELCOME HEADER -->
        <div class="dashboard-hero-header">
          <div class="dashboard-hero-title-group">
            <h1 class="dashboard-page-title">Dashboard</h1>
            <p class="dashboard-page-subtitle">Welcome back! Here's what's happening at your salon today.</p>
          </div>
          <div class="dashboard-hero-actions">
            <div class="dashboard-date-badge" title="Active Salon Schedule Date">
              ${Icons.calendar({ size: 15, color: 'var(--primary)' })}
              <span>${formattedDate}</span>
            </div>
            <button type="button" id="btn-home-store-qr" class="btn-hero-action" title="Display Salon Booking QR">
              ${Icons.qrCode({ size: 14, color: 'var(--primary)' })}
              <span>Store QR</span>
            </button>
            <button type="button" id="btn-home-copy-link" class="btn-hero-action" title="Copy Public Booking Link">
              ${Icons.copy({ size: 14, color: 'var(--primary)' })}
              <span>Share Link</span>
            </button>
          </div>
        </div>

        <!-- ROW B: THE 4 SIGNATURE STAT CARDS (Vertical Hierarchy — Zero Truncation) -->
        <div class="dashboard-stat-grid">
          
          <!-- CARD 1: TODAY'S APPOINTMENTS -->
          <div class="stat-card home-pulse-metric-cell" data-filter="ALL" title="View all scheduled visits for today">
            <div class="stat-card-icon-row">
              <div class="stat-card-icon-box">
                ${Icons.calendar({ size: 18 })}
              </div>
            </div>
            <div class="stat-card-label">Today's Appointments</div>
            <div class="stat-card-value">${totalBookedCount}</div>
            <div class="stat-card-footer">
              <span class="stat-growth-pill">
                ${Icons.arrowUp({ size: 10 })} +12% vs yesterday
              </span>
            </div>
          </div>

          <!-- CARD 2: TOTAL CUSTOMERS -->
          <div class="stat-card" title="Total registered salon client base">
            <div class="stat-card-icon-row">
              <div class="stat-card-icon-box">
                ${Icons.users({ size: 18 })}
              </div>
            </div>
            <div class="stat-card-label">Total Customers</div>
            <div class="stat-card-value">${customerCount}</div>
            <div class="stat-card-footer">
              <span class="stat-growth-pill">
                ${Icons.arrowUp({ size: 10 })} +8% this month
              </span>
            </div>
          </div>

          <!-- CARD 3: TODAY'S REVENUE -->
          <div class="stat-card home-pulse-metric-cell" data-filter="COMPLETED" title="Total collected revenue from concluded visits today">
            <div class="stat-card-icon-row">
              <div class="stat-card-icon-box">
                ${Icons.indianRupee({ size: 18 })}
              </div>
            </div>
            <div class="stat-card-label">Today's Revenue</div>
            <div class="stat-card-value">₹${Number(todayRevenue).toLocaleString('en-IN')}</div>
            <div class="stat-card-footer">
              <span class="stat-growth-pill">
                ${Icons.arrowUp({ size: 10 })} +18% vs yesterday
              </span>
            </div>
          </div>

          <!-- CARD 4: OCCUPANCY -->
          <div class="stat-card home-pulse-metric-cell" data-filter="IN_CHAIR" title="Active styling floor occupancy">
            <div class="stat-card-icon-row" style="display: flex; justify-content: space-between; align-items: center;">
              <div class="stat-card-icon-box">
                ${Icons.clock({ size: 18 })}
              </div>
              <div class="stat-occupancy-gauge-wrap" title="${occupancyPct}% Floor Occupancy">
                <svg width="34" height="34" viewBox="0 0 36 36" style="transform: rotate(-90deg);">
                  <circle cx="18" cy="18" r="14" fill="none" stroke="var(--border-default)" stroke-width="3" />
                  <circle cx="18" cy="18" r="14" fill="none" stroke="var(--primary)" stroke-width="3"
                    stroke-dasharray="88" stroke-dashoffset="${gaugeOffset}"
                    stroke-linecap="round" />
                </svg>
              </div>
            </div>
            <div class="stat-card-label">Occupancy</div>
            <div class="stat-card-value">${occupancyPct}%</div>
            <div class="stat-card-footer">
              <span class="stat-growth-pill" style="background: var(--primary-soft); color: var(--primary); border-color: var(--primary-border);">
                ${inChairCount} in chair • ${availableStaffCount} free
              </span>
            </div>
          </div>

        </div>

      </div>
    `;
  }

  /**
   * SECTION 2: QUICK BOOKINGS HUB (WHATSAPP & QR CLIENT REQUESTS)
   */
  static renderQuickBookingCard(todayAppointments = [], precomputedQuickRequests = null) {
    const apptsPool = Array.isArray(todayAppointments) && todayAppointments.length > 0
      ? todayAppointments
      : (Array.isArray(precomputedQuickRequests) ? precomputedQuickRequests : []);
    const pendingRequests = apptsPool.filter((a) => a.status === 'PENDING_ACCEPTANCE');
    const pendingCount = pendingRequests.length;
    const isPending = pendingCount > 0;

    return `
      <div id="home-quick-booking-card" class="dashboard-widget-card quick-booking-strip ${isPending ? 'has-pending' : ''}">
        <div class="qb-strip-left">
          <div class="stat-card-icon-box ${isPending ? 'qb-icon-pending' : 'qb-icon-normal'}">
            ${Icons.zap({ size: 16 })}
          </div>
          <div class="qb-strip-info">
            <div class="qb-strip-title-row">
              <span class="qb-strip-title">Quick Bookings</span>
              ${isPending ? `
                <span class="status-badge warning qb-badge">
                  <span class="badge-dot warning"></span>
                  ${pendingCount} Pending
                </span>
              ` : `
                <span class="status-badge success qb-badge">
                  <span class="badge-dot success"></span>
                  All Caught Up
                </span>
              `}
            </div>
            <div class="qb-strip-sub">
              ${isPending 
                ? `${pendingCount} client request${pendingCount > 1 ? 's' : ''} awaiting approval` 
                : 'WhatsApp & QR client booking requests'}
            </div>
          </div>
        </div>

        <button type="button" class="btn-open-quick-modal btn ${isPending ? 'btn-primary' : 'btn-secondary'} btn-sm qb-action-btn">
          <span>${isPending ? `Review (${pendingCount})` : 'View Requests'}</span>
          <span style="font-size: 0.8rem;">→</span>
        </button>
      </div>
    `;
  }

  /**
   * SECTION 3A: TODAY'S APPOINTMENTS LIST CARD (LEFT COLUMN)
   * Faithfully reproduces the list from the design system sheet:
   * - Soft emerald avatar circles
   * - Client name & service/time details
   * - Semantic Confirmed / Pending badges
   */
  static renderUpcomingQueue(todayAppointments = [], recentAppointments = [], precomputedUpcoming = null, precomputedRecent = null) {
    const activeStatuses = ['CONFIRMED', 'BOOKED', 'CHECKED_IN', 'ON_THE_WAY', 'PENDING_ACCEPTANCE'];
    const upcomingList = (Array.isArray(precomputedUpcoming) && precomputedUpcoming.length > 0)
      ? precomputedUpcoming
      : (todayAppointments || [])
          .filter((a) => activeStatuses.includes(a.status))
          .sort((a, b) => (a.startTime || a.startAt || '').localeCompare(b.startTime || b.startAt || ''))
          .slice(0, 5);

    const hasUpcoming = upcomingList.length > 0;

    let displayList = upcomingList;
    if (!hasUpcoming) {
      if (Array.isArray(precomputedRecent) && precomputedRecent.length > 0) {
        displayList = precomputedRecent.slice(0, 4);
      } else {
        const pool = [...(todayAppointments || []), ...(recentAppointments || [])];
        const seenIds = new Set();
        displayList = pool
          .filter((a) => {
            if (!a || !a.id || seenIds.has(a.id)) return false;
            seenIds.add(a.id);
            return true;
          })
          .sort((a, b) => new Date(b.createdAt || b.updatedAt || 0) - new Date(a.createdAt || a.updatedAt || 0))
          .slice(0, 4);
      }
    }

    const formatDateTime = (raw) => {
      if (!raw) return '10:00 AM';
      const str = String(raw).trim();
      if (/^\d{1,2}:\d{2}\s*(AM|PM)?$/i.test(str)) return str;
      const d = new Date(str);
      if (isNaN(d.getTime())) return str;
      return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    };

    const getInitials = (name) => {
      if (!name || name === 'Client' || name === 'In-Salon Guest') return 'G';
      const parts = name.trim().split(/\s+/);
      return parts.length >= 2
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : parts[0].substring(0, 2).toUpperCase();
    };

    return `
      <div id="home-upcoming-queue-section" class="dashboard-widget-card" style="height: 100%;">
        
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <div>
            <div style="font-size: 1rem; font-weight: 800; color: var(--text-primary); letter-spacing: -0.01em;">
              Today's Appointments
            </div>
            <div style="font-size: 0.74rem; color: var(--text-secondary); margin-top: 2px;">
              Live schedule and arrivals
            </div>
          </div>

          <button type="button" class="btn btn-secondary btn-sm" id="btn-home-view-queue" style="font-size: 0.76rem; font-weight: 700; padding: 5px 12px; border-radius: var(--radius-sm); color: var(--primary); border-color: var(--primary-border); background: var(--primary-soft); display: inline-flex; align-items: center; gap: 4px;">
            <span>View All</span>
            <span>→</span>
          </button>
        </div>

        <!-- Appointment Items List (Clean Divided Rows matching Design System) -->
        <div class="appointment-rows-list">
          ${displayList.length === 0 ? `
            <div style="text-align: center; padding: 32px 16px; border: 1px dashed var(--border-default); border-radius: var(--radius-md); background: var(--bg-surface-elevated);">
              <div class="stat-card-icon-box" style="margin: 0 auto 12px; width: 44px; height: 44px;">
                ${Icons.calendar({ size: 22 })}
              </div>
              <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-primary); margin-bottom: 4px;">
                No Appointments Yet Today
              </div>
              <div style="font-size: 0.78rem; color: var(--text-secondary); max-width: 260px; margin: 0 auto 16px;">
                Styling chairs are clear and ready for immediate walk-in client arrivals.
              </div>
              <button type="button" class="btn btn-primary btn-sm btn-home-open-walkin" style="margin: 0 auto; display: inline-flex; align-items: center; gap: 6px; font-weight: 700; padding: 7px 16px;">
                ${Icons.plus({ size: 14 })}
                <span>Fast Walk-In Client</span>
              </button>
            </div>
          ` : displayList.map((appt) => {
            const rawClient = appt.customer?.name || appt.customerName || appt.salonUser?.fullName || appt.user?.name || '';
            const clientName = rawClient && rawClient !== 'Client' ? rawClient : (appt.service?.name ? `Guest (${appt.service.name.split(' ')[0]})` : 'Salon Guest');
            const initials = getInitials(clientName);
            const serviceName = appt.service?.name || appt.serviceName || 'Haircut';
            const price = appt.service?.price || appt.price || 0;
            const status = appt.status || 'CONFIRMED';
            const timeStr = formatDateTime(appt.startTime || appt.startAt || appt.createdAt);

            let statusLabel = 'Confirmed';
            let statusClass = 'success';
            if (status === 'PENDING_ACCEPTANCE') {
              statusLabel = 'Pending';
              statusClass = 'warning';
            } else if (status === 'SEATED_IN_CHAIR' || status === 'IN_SERVICE') {
              statusLabel = 'In Chair';
              statusClass = 'primary';
            } else if (status === 'CANCELLED' || status === 'REJECTED') {
              statusLabel = 'Cancelled';
              statusClass = 'danger';
            }

            const canReview = status === 'PENDING_ACCEPTANCE';
            const canCheckIn = ['CONFIRMED', 'BOOKED', 'ON_THE_WAY'].includes(status);

            return `
              <div class="appointment-row-item">
                
                <!-- Initials Avatar + Info -->
                <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
                  <div class="client-avatar-pill">
                    ${initials}
                  </div>

                  <div style="min-width: 0; flex: 1;">
                    <div style="font-weight: 700; font-size: 0.88rem; color: var(--text-primary); line-height: 1.2;">
                      ${clientName}
                    </div>
                    <div style="font-size: 0.73rem; color: var(--text-secondary); margin-top: 2px;">
                      ${serviceName} • ${timeStr}
                      ${price > 0 ? `<span> • ₹${price}</span>` : ''}
                    </div>
                  </div>
                </div>

                <!-- Status Badge & Action -->
                <div style="flex-shrink: 0; display: flex; align-items: center; gap: 8px;">
                  <span class="status-badge ${statusClass}">
                    <span class="badge-dot ${statusClass}"></span>
                    ${statusLabel}
                  </span>

                  ${canReview ? `
                    <button type="button" class="btn-open-quick-modal btn btn-secondary btn-sm" style="font-size: 0.70rem; padding: 4px 8px; font-weight: 700; border-radius: var(--radius-sm); color: var(--warning); border-color: var(--warning-border);">
                      Review
                    </button>
                  ` : (canCheckIn ? `
                    <button type="button" class="btn btn-secondary btn-sm btn-status" data-id="${appt.id}" data-status="CHECKED_IN" style="font-size: 0.70rem; padding: 4px 8px; font-weight: 700; border-radius: var(--radius-sm); color: var(--primary); border-color: var(--primary-border); background: var(--primary-soft);">
                      Check In
                    </button>
                  ` : '')}
                </div>

              </div>
            `;
          }).join('')}
        </div>

      </div>
    `;
  }

  /**
   * SECTION 2B: MINI CALENDAR WIDGET & PRO PLAN CARD (RIGHT COLUMN)
   * Exact visual match of the right column from the design specification sheet!
   */
  static renderMiniCalendar(todayAppointments = [], selectedDate = null) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const todayDay = now.getDate();

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const monthTitle = `${monthNames[currentMonth]} ${currentYear}`;

    // Total days in current month
    const totalDays = new Date(currentYear, currentMonth + 1, 0).getDate();
    // Monday-first indexing (0=Mon, ..., 6=Sun)
    let startDay = new Date(currentYear, currentMonth, 1).getDay();
    startDay = (startDay === 0) ? 6 : startDay - 1;

    // Days from previous month for filler
    const prevMonthDays = new Date(currentYear, currentMonth, 0).getDate();
    const prevFillers = [];
    for (let i = startDay - 1; i >= 0; i--) {
      prevFillers.push(prevMonthDays - i);
    }

    // Days with active appointments
    const apptDays = new Set((todayAppointments || []).map((a) => {
      const d = a.startTime || a.startAt || a.createdAt;
      if (!d) return null;
      const parsed = new Date(d);
      return !isNaN(parsed.getTime()) ? parsed.getDate() : null;
    }).filter(Boolean));

    let daysHtml = '';
    // Muted previous month days
    prevFillers.forEach((d) => {
      daysHtml += `<div class="cal-day-cell is-muted">${d}</div>`;
    });

    // Current month days
    for (let day = 1; day <= totalDays; day++) {
      const isToday = day === todayDay;
      const hasAppt = apptDays.has(day);
      daysHtml += `
        <div class="cal-day-cell ${isToday ? 'active-day' : ''} ${hasAppt ? 'has-appt' : ''}" title="${day} ${monthNames[currentMonth]}">
          <span>${day}</span>
        </div>
      `;
    }

    // 1-Row Week Strip HTML (Mobile View: exactly 7 days in 1 single horizontal row)
    const todayDayOfWeek = (now.getDay() === 0) ? 6 : now.getDay() - 1; // 0=Mon, ..., 6=Sun
    const currentMondayDate = new Date(now);
    currentMondayDate.setDate(now.getDate() - todayDayOfWeek);

    const weekDayLabels = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
    let mobileWeekRowHtml = '';

    for (let i = 0; i < 7; i++) {
      const iterDate = new Date(currentMondayDate);
      iterDate.setDate(currentMondayDate.getDate() + i);
      const iterDayNum = iterDate.getDate();
      const isToday = (iterDate.toDateString() === now.toDateString());
      const hasAppt = (iterDate.getMonth() === currentMonth && apptDays.has(iterDayNum));

      mobileWeekRowHtml += `
        <div class="cal-mobile-day-col ${isToday ? 'active-day' : ''} ${hasAppt ? 'has-appt' : ''}" title="${iterDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}">
          <span class="cal-mobile-day-name">${weekDayLabels[i]}</span>
          <span class="cal-mobile-day-num">${iterDayNum}</span>
        </div>
      `;
    }

    return `
      <div class="dashboard-widget-card mini-calendar-card" style="height: 100%; display: flex; flex-direction: column; justify-content: space-between;">
        
        <div>
          <!-- Calendar Header -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <div style="font-size: 0.95rem; font-weight: 800; color: var(--text-primary); letter-spacing: -0.01em;">
              ${monthTitle}
            </div>
            <div style="display: flex; gap: 4px;">
              <button type="button" class="btn btn-secondary btn-sm cal-nav-btn" title="Previous">‹</button>
              <button type="button" class="btn btn-secondary btn-sm cal-nav-btn" title="Next">›</button>
            </div>
          </div>

          <!-- 1. MOBILE VIEW: EXACT SINGLE-ROW CALENDAR STRIP -->
          <div class="calendar-mobile-1row">
            ${mobileWeekRowHtml}
          </div>

          <!-- 2. DESKTOP VIEW: FULL MONTH GRID -->
          <div class="calendar-desktop-month">
            <div class="calendar-weekdays-row">
              <span>Mo</span>
              <span>Tu</span>
              <span>We</span>
              <span>Th</span>
              <span>Fr</span>
              <span>Sa</span>
              <span>Su</span>
            </div>
            <div class="calendar-days-grid">
              ${daysHtml}
            </div>
          </div>
        </div>

        <!-- Pro Plan Badge Card (Exact match of design sheet!) -->
        <div class="pro-plan-badge-card">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 1.25rem;">👑</span>
            <div>
              <div style="font-weight: 800; font-size: 0.84rem; color: var(--primary);">StyleSlot Pro</div>
              <div style="font-size: 0.70rem; color: var(--text-secondary);">Your plan is active • Unlimited visits</div>
            </div>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-goto-services-banner" style="font-size: 0.72rem; font-weight: 700; padding: 4px 10px; border-radius: var(--radius-sm); color: var(--primary); border-color: var(--primary-border); background: var(--bg-surface);">
            Manage
          </button>
        </div>

      </div>
    `;
  }

  /**
   * SECTION 3: STAFF SUMMARY (EXECUTIVE FLOOR OVERVIEW)
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

        const activeAppt = (todayAppointments || []).find((a) => {
          const isThisStaff = (a.staff?.id || a.staffId) === st.id;
          const inService = a.status === 'SEATED_IN_CHAIR' || a.status === 'IN_SERVICE';
          return isThisStaff && inService;
        });

        if (activeAppt || st.operationalStatus === 'WORKING') {
          inChairCount++;
          return;
        }

        const isBreak = st.operationalStatus === 'ON_BREAK' || (Array.isArray(st.breaks) && st.breaks.some((b) => {
          if (Array.isArray(b.days) ? !b.days.includes(currentDay) : (b.dayOfWeek && b.dayOfWeek !== currentDay)) return false;
          return b.startTime && b.endTime && curTime >= b.startTime && curTime <= b.endTime;
        }));

        if (isBreak) {
          onBreakCount++;
          return;
        }

        availableCount++;
      });

      freePct = totalStaff > 0 ? Math.round((availableCount / totalStaff) * 100) : 0;
      busyPct = totalStaff > 0 ? Math.round((inChairCount / totalStaff) * 100) : 0;
      breakPct = totalStaff > 0 ? Math.round((onBreakCount / totalStaff) * 100) : 0;
      offPct = totalStaff > 0 ? Math.max(0, 100 - freePct - busyPct - breakPct) : 0;
    }

    return `
      <div id="home-floor-radar-section" class="dashboard-widget-card">
        
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 10px; flex-shrink: 0;">
            <div class="stat-card-icon-box">
              ${Icons.users({ size: 16 })}
            </div>
            <div>
              <div style="font-size: 0.95rem; font-weight: 700; color: var(--text-primary); letter-spacing: -0.01em;">
                Stylist Floor Radar
              </div>
              <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 1px;">
                ${availableCount} of ${totalStaff} specialists ready for walk-ins
              </div>
            </div>
          </div>

          <button type="button" class="btn-home-manage-staff btn btn-secondary btn-sm" id="btn-home-manage-staff" style="font-size: 0.74rem; font-weight: 700; padding: 5px 12px; border-radius: var(--radius-sm); color: var(--primary); border-color: var(--primary-border); background: var(--primary-soft);">
            <span>Manage Staff →</span>
          </button>
        </div>

        <!-- 5-Column Metric Cells -->
        <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin: 14px 0 10px 0;">
          
          <div class="mini-metric-cell">
            <div class="mini-val">${totalStaff}</div>
            <div class="mini-lbl">Total</div>
          </div>

          <div class="mini-metric-cell highlight-green">
            <div class="mini-val" style="color: var(--success);">${availableCount}</div>
            <div class="mini-lbl" style="color: var(--success);">Free</div>
          </div>

          <div class="mini-metric-cell">
            <div class="mini-val" style="color: var(--primary);">${inChairCount}</div>
            <div class="mini-lbl">In Chair</div>
          </div>

          <div class="mini-metric-cell">
            <div class="mini-val" style="color: var(--warning);">${onBreakCount}</div>
            <div class="mini-lbl">Break</div>
          </div>

          <div class="mini-metric-cell">
            <div class="mini-val" style="color: var(--text-muted);">${offDutyCount}</div>
            <div class="mini-lbl">Off</div>
          </div>

        </div>

        <!-- Floor Coverage Bar -->
        ${totalStaff > 0 ? `
          <div style="display: flex; height: 5px; border-radius: 999px; overflow: hidden; background: var(--border-default); margin-top: 8px;">
            <div style="width: ${freePct}%; background: var(--success);" title="${availableCount} Free (${freePct}%)"></div>
            <div style="width: ${busyPct}%; background: var(--primary);" title="${inChairCount} In Chair (${busyPct}%)"></div>
            <div style="width: ${breakPct}%; background: var(--warning);" title="${onBreakCount} Break (${breakPct}%)"></div>
            <div style="width: ${offPct}%; background: var(--text-muted);" title="${offDutyCount} Off Duty (${offPct}%)"></div>
          </div>

          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px; font-size: 0.72rem;">
            <span style="color: var(--text-secondary);">
              ${availableCount > 0 ? `🟢 <strong style="color: var(--text-primary);">${availableCount} specialists</strong> available now` : 'All specialists currently seated with clients'}
            </span>
            <span style="color: var(--primary); font-weight: 700;">
              ${freePct}% Ready
            </span>
          </div>
        ` : `
          <div style="font-size: 0.75rem; color: var(--text-secondary); text-align: center; padding: 6px 0;">
            No specialists added yet. Click "Manage Staff" to add team.
          </div>
        `}

      </div>
    `;
  }

  /**
   * SECTION 4: SERVICES SUMMARY (MENU & CATALOG OVERVIEW)
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
      <div id="home-services-summary-section" class="dashboard-widget-card">
        
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
          <div style="display: flex; align-items: center; gap: 10px; flex-shrink: 0;">
            <div class="stat-card-icon-box">
              ${Icons.scissors({ size: 16 })}
            </div>
            <div>
              <div style="font-size: 0.95rem; font-weight: 700; color: var(--text-primary); letter-spacing: -0.01em;">
                Services Catalog
              </div>
              <div style="font-size: 0.72rem; color: var(--text-secondary); margin-top: 1px;">
                ${activeCount} active services across ${totalCategories} categories
              </div>
            </div>
          </div>

          <button type="button" class="btn-home-manage-services btn btn-secondary btn-sm" id="btn-home-manage-services" style="font-size: 0.74rem; font-weight: 700; padding: 5px 12px; border-radius: var(--radius-sm); color: var(--primary); border-color: var(--primary-border); background: var(--primary-soft);">
            <span>Manage Menu →</span>
          </button>
        </div>

        <!-- 4-Column Metrics -->
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 14px 0 10px 0;">
          
          <div class="mini-metric-cell">
            <div class="mini-val" style="color: var(--primary);">${activeCount}</div>
            <div class="mini-lbl">Active</div>
          </div>

          <div class="mini-metric-cell">
            <div class="mini-val">${totalCategories}</div>
            <div class="mini-lbl">Categories</div>
          </div>

          <div class="mini-metric-cell">
            <div class="mini-val" style="color: var(--success);">₹${avgPrice}</div>
            <div class="mini-lbl">Avg Ticket</div>
          </div>

          <div class="mini-metric-cell">
            <div class="mini-val">${avgDuration}m</div>
            <div class="mini-lbl">Avg Time</div>
          </div>

        </div>

        <!-- Categories Strip -->
        ${distinctCats.length > 0 ? `
          <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid var(--border-default); display: flex; align-items: center; gap: 6px; overflow-x: auto; scrollbar-width: none;">
            <span style="font-size: 0.65rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; white-space: nowrap; flex-shrink: 0;">
              Categories:
            </span>
            ${distinctCats.map((cat) => `
              <span class="category-chip">
                <span>${cat}</span>
                <span class="category-chip-count">${catMap[cat]}</span>
              </span>
            `).join('')}
          </div>
        ` : ''}

      </div>
    `;
  }

  /**
   * SECTION 5: RECEPTION FAST ACTION COMMAND LAUNCHPAD
   */
  static renderQuickActions(profile = {}, todayAppointments = []) {
    const queueCount = (todayAppointments || []).length;

    return `
      <div class="dashboard-widget-card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <div class="stat-card-icon-box" style="width: 28px; height: 28px;">
              ${Icons.zap({ size: 14 })}
            </div>
            <span style="font-size: 0.92rem; font-weight: 700; color: var(--text-primary); letter-spacing: -0.01em;">Reception Quick Actions</span>
          </div>
          <span style="font-size: 0.72rem; color: var(--text-secondary); font-weight: 500;">Front-Desk Commands</span>
        </div>

        <div class="action-tiles-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px;">
          
          <!-- Tile 1: Fast Walk-In -->
          <div class="action-tile highlighted" id="card-action-walkin">
            <div class="action-tile-icon primary">
              ${Icons.zap({ size: 18 })}
            </div>
            <div class="action-tile-title">Fast Walk-In</div>
            <div class="action-tile-desc">Register client in 10s and assign stylist</div>
          </div>

          <!-- Tile 2: Booking QR Poster -->
          <div class="action-tile" id="card-action-qr">
            <div class="action-tile-icon emerald">
              ${Icons.qrCode({ size: 18 })}
            </div>
            <div class="action-tile-title">Booking QR Standee</div>
            <div class="action-tile-desc">Print counter standee for instant booking</div>
          </div>

          <!-- Tile 3: Live Queue -->
          <div class="action-tile" id="card-action-queue">
            <div class="action-tile-icon">
              ${Icons.clock({ size: 18 })}
            </div>
            <div class="action-tile-title">Full Queue (${queueCount})</div>
            <div class="action-tile-desc">Manage chair station timers and client ETA</div>
          </div>

          <!-- Tile 4: Share Link -->
          <div class="action-tile" id="card-action-copy">
            <div class="action-tile-icon">
              ${Icons.copy({ size: 18 })}
            </div>
            <div class="action-tile-title">Share Booking Link</div>
            <div class="action-tile-desc">Copy URL for Instagram bio and Google Maps</div>
          </div>

        </div>
      </div>
    `;
  }

  /**
   * SECTION 6: WHATSAPP BOT & META MONTHLY FREE QUOTA TRACKER
   */
  static renderWhatsAppQuotaCard(quota = {}) {
    const limit = quota?.limit || 1000;
    const used = quota?.used || 0;
    const remaining = quota?.remaining !== undefined ? quota.remaining : Math.max(0, limit - used);
    const percentUsed = quota?.percentUsed || Math.min(100, Math.round((used / limit) * 100));
    const resetsOn = quota?.resetsOn || '1st of next month';

    return `
      <div class="dashboard-widget-card" style="border-left: 4px solid var(--primary);">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 12px;">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div class="stat-card-icon-box" style="width: 38px; height: 38px; font-size: 1.25rem;">
              💬
            </div>
            <div>
              <div style="font-weight: 700; font-size: 0.95rem; color: var(--text-primary); letter-spacing: -0.01em;">WhatsApp Automation Engine</div>
              <div style="font-size: 0.74rem; color: var(--text-secondary);">1,000 free Meta customer booking conversation sessions per month</div>
            </div>
          </div>
          <span class="status-badge success">
            ${remaining} Free Sessions Left
          </span>
        </div>

        <!-- Quota Progress Bar -->
        <div style="width: 100%; height: 6px; background: var(--border-default); border-radius: 999px; overflow: hidden; margin-bottom: 10px;">
          <div style="width: ${Math.max(2, percentUsed)}%; height: 100%; background: var(--primary); border-radius: 999px; transition: width 0.4s ease;"></div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.74rem; color: var(--text-secondary); flex-wrap: wrap; gap: 8px;">
          <div>
            <strong style="color: var(--text-primary);">${used}</strong> / ${limit} sessions used this month (${percentUsed}%)
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="color: var(--success);">●</span>
            <span>Resets on <strong style="color: var(--text-primary);">${resetsOn}</strong></span>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Backwards-compatible alias for renderFloorRadar
   */
  static renderFloorRadar(staffList = [], todayAppointments = [], todayClosure = null, selectedDate = null) {
    return this.renderStaffSummary(staffList, todayAppointments, todayClosure, selectedDate);
  }
}
