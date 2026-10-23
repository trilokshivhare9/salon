import { ApiClient } from '../../../api.js';
import { ScheduleDayOffDialog } from '../../salon-settings/schedule-day-off-dialog.js';
import { StaffApplyLeaveDialog } from '../../staff/staff-apply-leave-dialog.js';
import { ClosureDialog } from './closure-dialog.js';
import { StaffLeaveDialog } from './staff-leave-dialog.js';

/**
 * DateEventsDialog
 * Dedicated Dialog for inspecting and managing all events occurring on a specific date.
 * Triggered by clicking any day tile cell on the calendar grid.
 * Follows the modern, informative, enterprise .leave-history-card design language with custom color rings.
 */
export class DateEventsDialog {
  /**
   * Opens the Date Events Dialog.
   * @param {Object} options
   * @param {Object} options.app - Dashboard application context
   * @param {string} options.dateStr - YYYY-MM-DD
   * @param {string} options.mode - 'SALON' or 'STAFF'
   * @param {string} options.staffId - Specialist ID if in staff mode
   * @param {string} options.staffName - Specialist name if in staff mode
   * @param {Object} options.scheduleData - Raw schedule data from API
   * @param {Function} options.getFestivalForDate - Helper to resolve festival on date
   * @param {Function} options.onRefresh - Callback to refresh calendar
   */
  static open({ app, dateStr, mode = 'SALON', staffId = null, staffName = 'Specialist', scheduleData = null, getFestivalForDate = () => null, onRefresh = () => {} }) {
    const modalContainer = document.getElementById('modal-container') || document.body;
    if (!modalContainer || !dateStr) return;

    const shortDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const dayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

    const dateObj = new Date(dateStr + 'T00:00:00');
    const dayOfWeekName = dayNames[dateObj.getDay()];
    const friendlyDate = isNaN(dateObj.getTime())
      ? dateStr
      : dateObj.toLocaleDateString('en-IN', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    const todayISO = new Date().toISOString().split('T')[0];
    const isPast = dateStr < todayISO;
    const isToday = dateStr === todayISO;
    const isStaffMode = mode === 'STAFF';

    // Helper: format 24-hr string ("18:00") to 12-hr string ("06:00 PM")
    const formatTimeTo12Hour = (time24) => {
      if (!time24 || typeof time24 !== 'string') return '';
      const [hStr, mStr] = time24.split(':');
      let hours = parseInt(hStr, 10);
      const minutes = mStr ? mStr.padStart(2, '0') : '00';
      if (isNaN(hours)) return time24;
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      return `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
    };

    // Helper: format ISO timestamp to human readable ("21 Oct · 11:14 AM")
    const formatAppliedTimestamp = (isoStr) => {
      if (!isoStr) return 'Recently';
      try {
        const dt = new Date(isoStr);
        if (isNaN(dt.getTime())) return 'Recently';
        const d = dt.getDate();
        const m = monthsShort[dt.getMonth()];
        let hours = dt.getHours();
        const minutes = String(dt.getMinutes()).padStart(2, '0');
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12;
        return `${d} ${m} · ${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
      } catch (e) {
        return 'Recently';
      }
    };

    const cardsHtml = [];

    // 1. Salon Closures (YELLOW RING)
    const allClosures = scheduleData?.salonSchedule?.closures || app?.closuresList || [];
    const closuresOnDate = allClosures.filter((c) => {
      const s = String(c.startDate).split('T')[0];
      const e = String(c.endDate).split('T')[0];
      return dateStr >= s && dateStr <= e;
    });

    closuresOnDate.forEach((c) => {
      const sISO = String(c.startDate).split('T')[0];
      const eISO = String(c.endDate).split('T')[0];
      const isClosurePast = eISO < todayISO;
      const isClosureToday = sISO <= todayISO && todayISO <= eISO;

      let statusClass = 'lhc-status-onleave';
      let statusTitle = 'Closed Today';
      if (isClosurePast) {
        statusClass = 'lhc-status-completed';
        statusTitle = 'Completed';
      } else if (!isClosureToday) {
        statusClass = 'lhc-status-upcoming';
        statusTitle = 'Upcoming';
      }

      let resolvedType = c.closureType;
      if (resolvedType === 'HOLIDAY' && c.reason && /diwali|eid|holi|christmas|festival|puja|pongal|navratri|new year/i.test(c.reason)) {
        resolvedType = 'FESTIVAL';
      }

      const isPartial = Boolean(c.isPartialDay || c.closureType === 'PARTIAL_DAY');
      let typeColor = '#f59e0b'; // Amber yellow
      let typeLabel = 'Store Closure';
      if (resolvedType === 'FESTIVAL') {
        typeColor = '#f472b6';
        typeLabel = 'Festival Holiday';
      } else if (resolvedType === 'HOLIDAY') {
        typeColor = '#60a5fa';
        typeLabel = 'Public Holiday';
      } else if (resolvedType === 'EMERGENCY_CLOSURE') {
        typeColor = '#f87171';
        typeLabel = 'Emergency Closure';
      } else if (isPartial) {
        typeColor = '#38bdf8';
        typeLabel = 'Partial Day Closure';
      } else if (resolvedType === 'OTHER') {
        typeColor = '#cbd5e1';
        typeLabel = 'Store Closure';
      } else if (resolvedType) {
        typeColor = '#cbd5e1';
        typeLabel = resolvedType.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase());
      }

      const start12 = formatTimeTo12Hour(c.startTime || '09:00');
      const end12 = formatTimeTo12Hour(c.endTime || '21:00');
      const shiftLabel = isPartial ? `Partial (${start12} - ${end12})` : 'Full Day';
      const appliedFormatted = formatAppliedTimestamp(c.createdAt);
      const refId = c.id ? `#${c.id.slice(0, 8)}` : '#N/A';
      const noteText = c.notes || (c.reason && c.reason.toLowerCase() !== typeLabel.toLowerCase() ? c.reason : '');

      cardsHtml.push(`
        <div class="leave-history-card lhc-ring-closure">
          <div class="lhc-header-row">
            <div class="lhc-header-left">
              <span class="lhc-cal-icon">🌴</span>
              <strong class="lhc-date-title">${c.reason || typeLabel}</strong>
            </div>
            <div class="lhc-status-pill ${statusClass}">
              <span class="lhc-status-dot"></span>
              <span>${statusTitle}</span>
            </div>
          </div>

          <div class="lhc-meta-panel">
            <div class="lhc-meta-row">
              <div class="lhc-meta-cell lhc-meta-left" style="width: 100%;">
                <span class="lhc-type-dot" style="color: ${typeColor};">●</span>
                <span class="lhc-meta-label">Type:</span>
                <strong class="lhc-meta-type-val" style="color: ${typeColor}; max-width: 100%;">${typeLabel}</strong>
              </div>
            </div>
            <div class="lhc-meta-row">
              <div class="lhc-meta-cell lhc-meta-left" style="width: 100%;">
                <span class="lhc-meta-icon">🕒</span>
                <span class="lhc-meta-label">Shift:</span>
                <strong class="lhc-meta-shift-val" style="color: #f8fafc;">${shiftLabel}</strong>
              </div>
            </div>
            <div class="lhc-meta-row">
              <div class="lhc-meta-cell lhc-meta-left">
                <span class="lhc-meta-label">Applied:</span>
                <span class="lhc-meta-applied-val">${appliedFormatted}</span>
              </div>
              <div class="lhc-meta-cell lhc-meta-right">
                <span class="lhc-meta-label">Ref:</span>
                <span class="lhc-meta-ref-val">${refId}</span>
              </div>
            </div>
            ${noteText ? `
              <div class="lhc-meta-note-row">
                <span class="lhc-meta-label">Note:</span>
                <span class="lhc-meta-note-val">${noteText}</span>
              </div>
            ` : ''}
          </div>

          <div class="lhc-impact-pill lhc-impact-clean">
            <div class="lhc-impact-left">
              <span class="lhc-impact-check">✓</span>
              <span class="lhc-impact-text">Roster blocked · Bookings protected</span>
            </div>
          </div>

          <div class="lhc-actions-row">
            <button type="button" class="lhc-btn lhc-btn-details btn-view-closure-detail" data-closure-id="${c.id}">
              <span class="lhc-btn-icon">👁️</span>
              <span>Details</span>
            </button>
            ${!isClosurePast && !isStaffMode ? `
              <button type="button" class="lhc-btn lhc-btn-cancel btn-reopen-closure-date" data-id="${c.id}">
                <span class="lhc-btn-icon">✕</span>
                <span>Reopen Salon</span>
              </button>
            ` : `
              <span class="lhc-past-badge">Past Record</span>
            `}
          </div>
        </div>
      `);
    });

    // 2. Salon Weekly Routine Off (SKY BLUE RING)
    const salonWeeklyHours = scheduleData?.salonSchedule?.weeklyHours || app?.salonWorkingHours || [];
    const salonDayHour = salonWeeklyHours.find((h) => h.dayOfWeek === dayOfWeekName);
    const isSalonWeeklyOff = salonDayHour ? Boolean(salonDayHour.isClosed || salonDayHour.isOff) : false;

    if (isSalonWeeklyOff) {
      cardsHtml.push(`
        <div class="leave-history-card lhc-ring-salon-off">
          <div class="lhc-header-row">
            <div class="lhc-header-left">
              <span class="lhc-cal-icon">🏛️</span>
              <strong class="lhc-date-title">Salon Routine Weekly Off</strong>
            </div>
            <div class="lhc-status-pill lhc-status-open">
              <span class="lhc-status-dot"></span>
              <span>Routine Off</span>
            </div>
          </div>

          <div class="lhc-meta-panel">
            <div class="lhc-meta-row">
              <div class="lhc-meta-cell lhc-meta-left" style="width: 100%;">
                <span class="lhc-type-dot" style="color: #38bdf8;">●</span>
                <span class="lhc-meta-label">Type:</span>
                <strong class="lhc-meta-type-val" style="color: #38bdf8; max-width: 100%;">Weekly Store Off</strong>
              </div>
            </div>
            <div class="lhc-meta-row">
              <div class="lhc-meta-cell lhc-meta-left" style="width: 100%;">
                <span class="lhc-meta-icon">🕒</span>
                <span class="lhc-meta-label">Shift:</span>
                <strong class="lhc-meta-shift-val" style="color: #f8fafc;">Entire Day Closed</strong>
              </div>
            </div>
            <div class="lhc-meta-row">
              <div class="lhc-meta-cell lhc-meta-left">
                <span class="lhc-meta-label">Schedule:</span>
                <span class="lhc-meta-applied-val">Recurring Every ${dayOfWeekName.charAt(0) + dayOfWeekName.slice(1).toLowerCase()}</span>
              </div>
            </div>
          </div>

          <div class="lhc-impact-pill lhc-impact-clean">
            <div class="lhc-impact-left">
              <span class="lhc-impact-check">✓</span>
              <span class="lhc-impact-text">Store closed · Routine weekly schedule</span>
            </div>
          </div>
        </div>
      `);
    }

    // 3. Specialist Weekly Offs (PURPLE RING)
    if (!isSalonWeeklyOff && closuresOnDate.length === 0) {
      const stylists = scheduleData?.stylists || app?.staffList || [];
      const stylistsOnWeeklyOff = [];

      stylists.forEach((st) => {
        const hoursList = st.weeklyHours || st.workingHours || [];
        const stDay = hoursList.find((h) => h.dayOfWeek === dayOfWeekName);
        if (stDay && (stDay.isWorking === false || stDay.isOff === true || stDay.isClosed === true)) {
          stylistsOnWeeklyOff.push({
            id: st.stylistId || st.id,
            name: st.name,
          });
        }
      });

      if (isStaffMode && staffId) {
        const isOff = stylistsOnWeeklyOff.some((s) => s.id === staffId);
        if (isOff) {
          cardsHtml.push(`
            <div class="leave-history-card lhc-ring-staff-off">
              <div class="lhc-header-row">
                <div class="lhc-header-left">
                  <span class="lhc-cal-icon">👤</span>
                  <strong class="lhc-date-title">${staffName} (Off)</strong>
                </div>
                <div class="lhc-status-pill lhc-status-upcoming">
                  <span class="lhc-status-dot"></span>
                  <span>Weekly Off</span>
                </div>
              </div>

              <div class="lhc-meta-panel">
                <div class="lhc-meta-row">
                  <div class="lhc-meta-cell lhc-meta-left" style="width: 100%;">
                    <span class="lhc-type-dot" style="color: #a855f7;">●</span>
                    <span class="lhc-meta-label">Type:</span>
                    <strong class="lhc-meta-type-val" style="color: #a855f7; max-width: 100%;">Specialist Routine Off</strong>
                  </div>
                </div>
                <div class="lhc-meta-row">
                  <div class="lhc-meta-cell lhc-meta-left" style="width: 100%;">
                    <span class="lhc-meta-icon">🕒</span>
                    <span class="lhc-meta-label">Shift:</span>
                    <strong class="lhc-meta-shift-val" style="color: #f8fafc;">Full Day Routine Off</strong>
                  </div>
                </div>
                <div class="lhc-meta-row">
                  <div class="lhc-meta-cell lhc-meta-left">
                    <span class="lhc-meta-label">Schedule:</span>
                    <span class="lhc-meta-applied-val">Recurring Every ${dayOfWeekName.charAt(0) + dayOfWeekName.slice(1).toLowerCase()}</span>
                  </div>
                </div>
              </div>

              <div class="lhc-impact-pill lhc-impact-clean">
                <div class="lhc-impact-left">
                  <span class="lhc-impact-check">✓</span>
                  <span class="lhc-impact-text">Specialist off · Other team active</span>
                </div>
              </div>
            </div>
          `);
        }
      } else if (stylistsOnWeeklyOff.length > 0) {
        const namesList = stylistsOnWeeklyOff.map((s) => s.name).join(', ');
        const cardTitle = stylistsOnWeeklyOff.length === 1 ? `${stylistsOnWeeklyOff[0].name} (Off)` : `${stylistsOnWeeklyOff.length} Specialists Off`;
        cardsHtml.push(`
          <div class="leave-history-card lhc-ring-staff-off">
            <div class="lhc-header-row">
              <div class="lhc-header-left">
                <span class="lhc-cal-icon">👤</span>
                <strong class="lhc-date-title">${cardTitle}</strong>
              </div>
              <div class="lhc-status-pill lhc-status-upcoming">
                <span class="lhc-status-dot"></span>
                <span>Weekly Off</span>
              </div>
            </div>

            <div class="lhc-meta-panel">
              <div class="lhc-meta-row">
                <div class="lhc-meta-cell lhc-meta-left" style="width: 100%;">
                  <span class="lhc-type-dot" style="color: #a855f7;">●</span>
                  <span class="lhc-meta-label">Specialist:</span>
                  <strong class="lhc-meta-type-val" style="color: #a855f7; max-width: 100%;">${namesList}</strong>
                </div>
              </div>
              <div class="lhc-meta-row">
                <div class="lhc-meta-cell lhc-meta-left" style="width: 100%;">
                  <span class="lhc-meta-icon">🕒</span>
                  <span class="lhc-meta-label">Shift:</span>
                  <strong class="lhc-meta-shift-val" style="color: #f8fafc;">Full Day Routine Off</strong>
                </div>
              </div>
              <div class="lhc-meta-row">
                <div class="lhc-meta-cell lhc-meta-left">
                  <span class="lhc-meta-label">Status:</span>
                  <span class="lhc-meta-applied-val">Regular salon roster active</span>
                </div>
              </div>
            </div>

            <div class="lhc-impact-pill lhc-impact-clean">
              <div class="lhc-impact-left">
                <span class="lhc-impact-check">✓</span>
                <span class="lhc-impact-text">Specialist off · Other team active</span>
              </div>
            </div>
          </div>
        `);
      }
    }

    // 4. Staff Approved Leaves (RED RING)
    const rawLeaves = scheduleData?.leaves || [];
    const leavesOnDate = rawLeaves.filter((l) => {
      const s = String(l.startDate).split('T')[0];
      const e = String(l.endDate).split('T')[0];
      if (dateStr < s || dateStr > e) return false;
      if (isStaffMode && staffId && l.stylistId !== staffId) return false;
      return true;
    });

    leavesOnDate.forEach((l) => {
      const sISO = String(l.startDate).split('T')[0];
      const eISO = String(l.endDate).split('T')[0];
      const isLeavePast = eISO < todayISO;
      const isLeaveToday = sISO <= todayISO && todayISO <= eISO;
      const isCancelled = l.status === 'CANCELLED';

      let statusClass = 'lhc-status-onleave';
      let statusTitle = 'On Leave';
      if (isCancelled) {
        statusClass = 'lhc-status-cancelled';
        statusTitle = 'Cancelled';
      } else if (isLeavePast) {
        statusClass = 'lhc-status-completed';
        statusTitle = 'Completed';
      } else if (!isLeaveToday) {
        statusClass = 'lhc-status-upcoming';
        statusTitle = 'Upcoming';
      }

      const rawType = (l.leaveType || 'LEAVE').toUpperCase();
      const formattedLeaveType = (l.leaveType || 'Leave').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
      let typeColor = '#f43f5e'; // Vibrant red/crimson
      if (rawType.includes('SICK')) {
        typeColor = '#fb7185';
      } else if (rawType.includes('CASUAL')) {
        typeColor = '#60a5fa';
      } else if (rawType.includes('VACATION')) {
        typeColor = '#a78bfa';
      } else if (rawType.includes('EMERGENCY')) {
        typeColor = '#f87171';
      } else if (rawType.includes('UNPAID')) {
        typeColor = '#fbbf24';
      }

      const isPartial = Boolean(l.isPartialDay);
      let shiftLabel = 'Full Day Off';
      if (isPartial && l.startTime && l.endTime) {
        const start12 = formatTimeTo12Hour(l.startTime);
        const end12 = formatTimeTo12Hour(l.endTime);
        shiftLabel = `Partial (${start12} - ${end12})`;
      }

      const appliedFormatted = formatAppliedTimestamp(l.createdAt);
      const refId = l.id ? `#${String(l.id).slice(0, 8)}` : (l.absenceId ? `#${String(l.absenceId).slice(0, 8)}` : '#N/A');
      const stylistName = l.stylistName || staffName || 'Specialist';
      const noteText = l.notes || (l.reason && l.reason.toLowerCase() !== formattedLeaveType.toLowerCase() ? l.reason : '');

      cardsHtml.push(`
        <div class="leave-history-card lhc-ring-leave">
          <div class="lhc-header-row">
            <div class="lhc-header-left">
              <span class="lhc-cal-icon">🏖️</span>
              <strong class="lhc-date-title">${stylistName} (Leave)</strong>
            </div>
            <div class="lhc-status-pill ${statusClass}">
              <span class="lhc-status-dot"></span>
              <span>${statusTitle}</span>
            </div>
          </div>

          <div class="lhc-meta-panel">
            <div class="lhc-meta-row">
              <div class="lhc-meta-cell lhc-meta-left" style="width: 100%;">
                <span class="lhc-type-dot" style="color: ${typeColor};">●</span>
                <span class="lhc-meta-label">Type:</span>
                <strong class="lhc-meta-type-val" style="color: ${typeColor}; max-width: 100%;">${formattedLeaveType}</strong>
              </div>
            </div>
            <div class="lhc-meta-row">
              <div class="lhc-meta-cell lhc-meta-left" style="width: 100%;">
                <span class="lhc-meta-icon">🕒</span>
                <span class="lhc-meta-label">Shift:</span>
                <strong class="lhc-meta-shift-val" style="color: #f8fafc;">${shiftLabel}</strong>
              </div>
            </div>
            <div class="lhc-meta-row">
              <div class="lhc-meta-cell lhc-meta-left">
                <span class="lhc-meta-label">Applied:</span>
                <span class="lhc-meta-applied-val">${appliedFormatted}</span>
              </div>
              <div class="lhc-meta-cell lhc-meta-right">
                <span class="lhc-meta-label">Ref:</span>
                <span class="lhc-meta-ref-val">${refId}</span>
              </div>
            </div>
            ${noteText ? `
              <div class="lhc-meta-note-row">
                <span class="lhc-meta-label">Note:</span>
                <span class="lhc-meta-note-val">${noteText}</span>
              </div>
            ` : ''}
          </div>

          <div class="lhc-impact-pill lhc-impact-clean">
            <div class="lhc-impact-left">
              <span class="lhc-impact-check">✓</span>
              <span class="lhc-impact-text">Specialist off · Bookings protected</span>
            </div>
          </div>

          <div class="lhc-actions-row">
            <button type="button" class="lhc-btn lhc-btn-details btn-view-leave-detail" data-leave-id="${l.id || l.absenceId}">
              <span class="lhc-btn-icon">👁️</span>
              <span>Details</span>
            </button>
            ${!isLeavePast && !isCancelled ? `
              <button type="button" class="lhc-btn lhc-btn-cancel btn-cancel-leave-date" data-staff-id="${l.stylistId || staffId}" data-absence-id="${l.id || l.absenceId}" data-name="${stylistName.replace(/"/g, '&quot;')}">
                <span class="lhc-btn-icon">✕</span>
                <span>Cancel Leave</span>
              </button>
            ` : `
              <span class="lhc-past-badge">Past Record</span>
            `}
          </div>
        </div>
      `);
    });

    // 5. Gazetted Festivals (EMERALD GREEN RING)
    const festival = typeof getFestivalForDate === 'function' ? getFestivalForDate(dateStr) : null;
    if (festival) {
      const isStoreClosed = closuresOnDate.length > 0 || isSalonWeeklyOff;
      cardsHtml.push(`
        <div class="leave-history-card lhc-ring-festival">
          <div class="lhc-header-row">
            <div class="lhc-header-left">
              <span class="lhc-cal-icon">${festival.icon || '🪔'}</span>
              <strong class="lhc-date-title">${festival.name}</strong>
            </div>
            <div class="lhc-status-pill ${isStoreClosed ? 'lhc-status-onleave' : 'lhc-status-open'}">
              <span class="lhc-status-dot"></span>
              <span>${isStoreClosed ? 'Closed' : 'Operating'}</span>
            </div>
          </div>

          <div class="lhc-meta-panel">
            <div class="lhc-meta-row">
              <div class="lhc-meta-cell lhc-meta-left" style="width: 100%;">
                <span class="lhc-type-dot" style="color: #34d399;">●</span>
                <span class="lhc-meta-label">Type:</span>
                <strong class="lhc-meta-type-val" style="color: #34d399; max-width: 100%;">${festival.type || 'Gazetted Festival'}</strong>
              </div>
            </div>
            <div class="lhc-meta-row">
              <div class="lhc-meta-cell lhc-meta-left" style="width: 100%;">
                <span class="lhc-meta-icon">🕒</span>
                <span class="lhc-meta-label">Status:</span>
                <strong class="lhc-meta-shift-val" style="color: #f8fafc;">${isStoreClosed ? 'Closed for Festival' : 'Operating Normal'}</strong>
              </div>
            </div>
            <div class="lhc-meta-row">
              <div class="lhc-meta-cell lhc-meta-left">
                <span class="lhc-meta-label">Observance:</span>
                <span class="lhc-meta-applied-val">National Gazetted Holiday</span>
              </div>
            </div>
          </div>

          <div class="lhc-impact-pill lhc-impact-clean">
            <div class="lhc-impact-left">
              <span class="lhc-impact-check">${isStoreClosed ? '✓' : 'ℹ️'}</span>
              <span class="lhc-impact-text">${isStoreClosed ? 'Store closed for festival' : 'Salon open · Accepting appointments'}</span>
            </div>
          </div>

          ${!isStoreClosed && !isPast && !isStaffMode ? `
            <div class="lhc-actions-row">
              <button type="button" class="lhc-btn lhc-btn-cancel btn-close-salon-festival-date" data-date="${dateStr}" data-name="${(festival.name || '').replace(/"/g, '&quot;')}">
                <span class="lhc-btn-icon">🌴</span>
                <span>Close Salon for ${festival.name}</span>
              </button>
            </div>
          ` : ''}
        </div>
      `);
    }

    // 6. Normal Day State (If no events scheduled on this date - GREEN RING)
    const regularShiftText = salonDayHour
      ? (salonDayHour.isClosed ? 'Weekly Off' : `${formatTimeTo12Hour(salonDayHour.startTime || '09:00')} - ${formatTimeTo12Hour(salonDayHour.endTime || '21:00')}`)
      : '09:00 AM - 09:00 PM';

    if (cardsHtml.length === 0) {
      cardsHtml.push(`
        <div class="leave-history-card lhc-ring-open">
          <div class="lhc-header-row">
            <div class="lhc-header-left">
              <span class="lhc-cal-icon">🟢</span>
              <strong class="lhc-date-title">Standard Operating Day</strong>
            </div>
            <div class="lhc-status-pill lhc-status-onleave">
              <span class="lhc-status-dot"></span>
              <span>Open Live</span>
            </div>
          </div>

          <div class="lhc-meta-panel">
            <div class="lhc-meta-row">
              <div class="lhc-meta-cell lhc-meta-left" style="width: 100%;">
                <span class="lhc-type-dot" style="color: #34d399;">●</span>
                <span class="lhc-meta-label">Schedule:</span>
                <strong class="lhc-meta-type-val" style="color: #34d399; max-width: 100%;">Standard Salon Operations</strong>
              </div>
            </div>
            <div class="lhc-meta-row">
              <div class="lhc-meta-cell lhc-meta-left" style="width: 100%;">
                <span class="lhc-meta-icon">🕒</span>
                <span class="lhc-meta-label">Shift:</span>
                <strong class="lhc-meta-shift-val" style="color: #f8fafc;">${regularShiftText}</strong>
              </div>
            </div>
            <div class="lhc-meta-row">
              <div class="lhc-meta-cell lhc-meta-left">
                <span class="lhc-meta-label">Status:</span>
                <span class="lhc-meta-applied-val">Accepting Online Bookings & Walk-ins</span>
              </div>
            </div>
          </div>

          <div class="lhc-impact-pill lhc-impact-clean">
            <div class="lhc-impact-left">
              <span class="lhc-impact-check">✓</span>
              <span class="lhc-impact-text">Calendar open · Appointment slots available</span>
            </div>
          </div>

          ${!isPast && !isStaffMode ? `
            <div class="lhc-actions-row">
              <button type="button" class="lhc-btn lhc-btn-details btn-action-schedule-closure">
                <span class="lhc-btn-icon">🌴</span>
                <span>Schedule Closure</span>
              </button>
              <button type="button" class="lhc-btn lhc-btn-details btn-action-schedule-leave">
                <span class="lhc-btn-icon">🏖️</span>
                <span>Apply Specialist Leave</span>
              </button>
            </div>
          ` : ''}
        </div>
      `);
    }

    const totalEventsCount = cardsHtml.length;

    modalContainer.innerHTML = `
      <div class="modal-backdrop show" style="z-index: 99999;">
        <div class="modal-content modal-content-sheet" style="max-width: 560px; padding: 20px 22px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; background: #0f172a; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.75);">
          <div class="sheet-grab-handle"></div>
          
          <!-- Header -->
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                <span style="font-size: 1.15rem;">📅</span>
                <h3 style="font-size: 1.05rem; font-weight: 800; color: #fff; margin: 0;">${friendlyDate}</h3>
              </div>
              <div style="display: flex; align-items: center; gap: 6px;">
                <span class="badge" style="background: rgba(255, 255, 255, 0.08); color: #cbd5e1; border: 1px solid rgba(255, 255, 255, 0.12); font-size: 0.7rem; font-weight: 700;">
                  ${totalEventsCount} Event${totalEventsCount !== 1 ? 's' : ''} on this date
                </span>
                ${isToday ? `<span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35); font-size: 0.68rem; font-weight: 800;">TODAY</span>` : ''}
                ${isPast ? `<span class="badge" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.25); font-size: 0.68rem; font-weight: 700;">PAST DATE</span>` : ''}
                ${!isPast && !isToday ? `<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35); font-size: 0.68rem; font-weight: 700;">UPCOMING</span>` : ''}
              </div>
            </div>
            <button class="close-btn" id="btn-close-date-events-modal" style="width: 28px; height: 28px; font-size: 1.1rem; background: rgba(255,255,255,0.06); border: none; border-radius: 50%; color: #94a3b8; cursor: pointer; display: flex; align-items: center; justify-content: center;">&times;</button>
          </div>

          <!-- Event Cards List -->
          <div style="display: flex; flex-direction: column; gap: 10px; max-height: 440px; overflow-y: auto; padding-right: 4px; margin-bottom: 16px;">
            ${cardsHtml.join('')}
          </div>

          <!-- Footer -->
          <div style="display: flex; justify-content: flex-end; align-items: center; gap: 8px;">
            <button type="button" class="btn btn-secondary btn-sm" id="btn-done-date-events" style="font-size: 0.78rem; font-weight: 700; padding: 7px 18px; border-radius: 8px;">
              Close
            </button>
          </div>
        </div>
      </div>
    `;

    const closeModal = () => (modalContainer.innerHTML = '');
    document.getElementById('btn-close-date-events-modal')?.addEventListener('click', closeModal);
    document.getElementById('btn-done-date-events')?.addEventListener('click', closeModal);
    modalContainer.querySelector('.modal-backdrop')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeModal();
    });

    const openScheduleClosure = (festName = null) => {
      closeModal();
      ScheduleDayOffDialog.open({
        initialDate: dateStr,
        festivalInfo: festName ? { name: festName } : null,
        salonWorkingHours,
        existingClosures: allClosures,
        staffList: app?.staffList || window.salonDashboard?.staffList || window.dashboardApp?.staffList || [],
        onSuccess: async () => {
          await onRefresh();
        },
      });
    };

    const openScheduleLeave = () => {
      closeModal();
      StaffApplyLeaveDialog.open({
        initialDate: dateStr,
        staffList: app?.staffList || window.salonDashboard?.staffList || window.dashboardApp?.staffList || [],
        staffId: staffId || null,
        staffName: staffName || null,
        salonWorkingHours,
        onSuccess: async () => {
          await onRefresh();
        },
      });
    };

    modalContainer.querySelectorAll('.btn-action-schedule-closure').forEach((btn) => {
      btn.addEventListener('click', () => openScheduleClosure());
    });

    modalContainer.querySelectorAll('.btn-action-schedule-leave').forEach((btn) => {
      btn.addEventListener('click', () => openScheduleLeave());
    });

    modalContainer.querySelectorAll('.btn-close-salon-festival-date').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const fn = e.currentTarget.getAttribute('data-name');
        openScheduleClosure(fn);
      });
    });

    // Closure Details modal click
    modalContainer.querySelectorAll('.btn-view-closure-detail').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-closure-id');
        const c = allClosures.find((item) => item.id === id);
        if (c) {
          ClosureDialog.showClosureDetailModal(c, salonWorkingHours, async () => {
            closeModal();
            await onRefresh();
          });
        }
      });
    });

    // Reopen Closure button click
    modalContainer.querySelectorAll('.btn-reopen-closure-date').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        if (confirm('Are you sure you want to cancel this closure and reopen the booking calendar for these dates?')) {
          try {
            await ApiClient.deleteSalonClosure(id);
            if (app?.showToast || window.salonDashboard?.showToast || window.dashboardApp?.showToast) {
              (app?.showToast || window.salonDashboard?.showToast || window.dashboardApp?.showToast)('Closure cancelled and calendar reopened.', 'success');
            } else {
              alert('Closure cancelled and calendar reopened.');
            }
            closeModal();
            await onRefresh();
          } catch (err) {
            if (app?.showToast || window.salonDashboard?.showToast || window.dashboardApp?.showToast) {
              (app?.showToast || window.salonDashboard?.showToast || window.dashboardApp?.showToast)(err.message || 'Failed to cancel closure.', 'error');
            } else {
              alert(err.message || 'Failed to cancel closure.');
            }
          }
        }
      });
    });

    // Staff Leave Details modal click
    modalContainer.querySelectorAll('.btn-view-leave-detail').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-leave-id');
        const l = rawLeaves.find((item) => String(item.id || item.absenceId) === String(id));
        if (l) {
          StaffLeaveDialog.showLeaveDetailModal(l, async () => {
            closeModal();
            await onRefresh();
          });
        }
      });
    });

    // Cancel Staff Leave button click
    modalContainer.querySelectorAll('.btn-cancel-leave-date').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const sId = e.currentTarget.getAttribute('data-staff-id');
        const aId = e.currentTarget.getAttribute('data-absence-id');
        const sName = e.currentTarget.getAttribute('data-name');
        if (confirm(`Are you sure you want to cancel the scheduled leave for ${sName}?`)) {
          try {
            await ApiClient.cancelStaffAbsence(sId, aId);
            if (app?.showToast || window.salonDashboard?.showToast || window.dashboardApp?.showToast) {
              (app?.showToast || window.salonDashboard?.showToast || window.dashboardApp?.showToast)(`Leave cancelled for ${sName}.`, 'success');
            } else {
              alert(`Leave cancelled for ${sName}.`);
            }
            closeModal();
            await onRefresh();
          } catch (err) {
            if (app?.showToast || window.salonDashboard?.showToast || window.dashboardApp?.showToast) {
              (app?.showToast || window.salonDashboard?.showToast || window.dashboardApp?.showToast)(err.message || 'Failed to cancel leave.', 'error');
            } else {
              alert(err.message || 'Failed to cancel leave.');
            }
          }
        }
      });
    });
  }
}
