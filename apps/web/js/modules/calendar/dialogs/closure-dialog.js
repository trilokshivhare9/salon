import { ApiClient } from '../../../api.js';
import { ScheduleDayOffDialog } from '../../salon-settings/schedule-day-off-dialog.js';

/**
 * ClosureDialog
 * Dedicated Dialog for inspecting and managing Store Closures & Holidays (Chip: Closed).
 * Follows the modern, minimal, and informative .leave-history-card design language.
 */
export class ClosureDialog {
  /**
   * Opens the Store Closures & Holidays Inspector Dialog.
   * @param {Object} options
   * @param {Object} options.app - Dashboard application context
   * @param {number} options.year - Active calendar year
   * @param {number} options.month - Active calendar month (0-11)
   * @param {Array} options.closures - All closures list
   * @param {boolean} [options.isStaffMode=false] - View-only for staff
   * @param {Function} options.onRefresh - Callback to refresh calendar after changes
   */
  static open({ app, year, month, closures = [], isStaffMode = false, onRefresh = () => { } }) {
    const modalContainer = document.getElementById('modal-container') || document.body;
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const shortDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const currentMonthName = `${monthNames[month]} ${year}`;
    const mStr = String(month + 1).padStart(2, '0');
    const totalDays = new Date(year, month + 1, 0).getDate();
    const monthStart = `${year}-${mStr}-01`;
    const monthEnd = `${year}-${mStr}-${String(totalDays).padStart(2, '0')}`;
    const todayISO = new Date().toISOString().split('T')[0];

    const salonWorkingHours = app?.salonWorkingHours || window.salonDashboard?.salonWorkingHours || window.dashboardApp?.salonWorkingHours || [];

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

    // Helper: format applied timestamp ("19 Oct · 3:00 AM")
    const formatAppliedTimestamp = (isoStr) => {
      if (!isoStr) return 'Recently';
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return 'Recently';
      const mShort = monthsShort[d.getMonth()];
      const day = d.getDate();
      const yr = d.getFullYear();
      let h = d.getHours();
      const m = String(d.getMinutes()).padStart(2, '0');
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12;
      h = h ? h : 12;
      const currentYear = new Date().getFullYear();
      const yrPart = (yr !== currentYear && yr !== year) ? ` '${String(yr).slice(-2)}` : '';
      return `${day} ${mShort}${yrPart} · ${h}:${m} ${ampm}`;
    };

    // Helper: timezone-safe date parsing
    const parseDate = (dStr) => {
      if (!dStr) return null;
      const iso = String(dStr).split('T')[0];
      const parts = iso.split('-');
      if (parts.length !== 3) return null;
      const [y, m, d] = parts.map(Number);
      const dt = new Date(y, m - 1, d);
      return !isNaN(dt.getTime()) ? dt : null;
    };

    const monthClosures = (closures || []).filter((c) => {
      const s = String(c.startDate).split('T')[0];
      const e = String(c.endDate).split('T')[0];
      return s <= monthEnd && e >= monthStart;
    });

    let bodyHtml = '';
    if (monthClosures.length === 0) {
      bodyHtml = `
        <div style="text-align: center; padding: 36px 16px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.1); border-radius: 14px; margin-bottom: 16px;">
          <div style="font-size: 2.2rem; margin-bottom: 10px;">🌴</div>
          <div style="font-size: 0.95rem; font-weight: 700; color: #fff; margin-bottom: 4px;">No Store Closures in ${currentMonthName}</div>
          <div style="font-size: 0.76rem; color: #94a3b8; max-width: 340px; margin: 0 auto 16px auto; line-height: 1.4;">The salon is scheduled to operate normally every business day this month according to regular shifts.</div>
          ${!isStaffMode ? `
            <button type="button" class="btn btn-primary btn-sm" id="btn-inspector-schedule-closure" style="font-size: 0.78rem; font-weight: 700; padding: 7px 16px; border-radius: 8px;">
              + Schedule Holiday / Closure
            </button>
          ` : ''}
        </div>
      `;
    } else {
      bodyHtml = `
        <div style="display: flex; flex-direction: column; gap: 10px; max-height: 440px; overflow-y: auto; padding-right: 4px; margin-bottom: 16px;">
          ${monthClosures.map((c) => {
        const dtStart = parseDate(c.startDate);
        const dtEnd = parseDate(c.endDate);

        const isSingleDay = !dtEnd || (dtStart && dtStart.toDateString() === dtEnd.toDateString());

        let dateDisplay = '';
        let durationText = '1 Day';
        if (isSingleDay && dtStart) {
          const dayShort = shortDays[dtStart.getDay()];
          const mShort = monthsShort[dtStart.getMonth()];
          const d = dtStart.getDate();
          dateDisplay = `${dayShort}, ${d} ${mShort}`;
          durationText = '1 Day';
        } else if (dtStart && dtEnd) {
          const dayShort1 = shortDays[dtStart.getDay()];
          const mShort1 = monthsShort[dtStart.getMonth()];
          const d1 = dtStart.getDate();
          const dayShort2 = shortDays[dtEnd.getDay()];
          const mShort2 = monthsShort[dtEnd.getMonth()];
          const d2 = dtEnd.getDate();
          const diffDays = Math.round((dtEnd - dtStart) / (1000 * 60 * 60 * 24)) + 1;
          dateDisplay = `${dayShort1}, ${d1} ${mShort1} ➔ ${dayShort2}, ${d2} ${mShort2}`;
          durationText = `${diffDays} Days`;
        } else {
          dateDisplay = String(c.startDate).split('T')[0];
        }

        // Status resolution
        const sISO = String(c.startDate).split('T')[0];
        const eISO = String(c.endDate).split('T')[0];
        const isPast = eISO < todayISO;
        const isToday = sISO <= todayISO && todayISO <= eISO;

        let statusClass = 'lhc-status-onleave';
        let statusTitle = 'Closed Today';
        if (isPast) {
          statusClass = 'lhc-status-completed';
          statusTitle = 'Completed';
        } else if (!isToday) {
          statusClass = 'lhc-status-upcoming';
          statusTitle = 'Upcoming';
        }

        // Category & Type resolution
        let resolvedType = c.closureType;
        if (resolvedType === 'HOLIDAY' && c.reason && /diwali|eid|holi|christmas|festival|puja|pongal|navratri|new year/i.test(c.reason)) {
          resolvedType = 'FESTIVAL';
        }

        const isPartial = Boolean(c.isPartialDay || c.closureType === 'PARTIAL_DAY');

        let typeColor = '#f472b6'; // Vibrant pink/magenta
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

        // Shift resolution
        const start12 = formatTimeTo12Hour(c.startTime || '09:00');
        const end12 = formatTimeTo12Hour(c.endTime || '21:00');
        const shiftLabel = isPartial ? `Partial (${start12} - ${end12})` : 'Full Day';

        // Applied timestamp & Ref
        const appliedFormatted = formatAppliedTimestamp(c.createdAt);
        const refId = c.id ? `#${c.id.slice(0, 8)}` : '#N/A';

        // Note or custom reason text (if different from generic type)
        const noteText = c.notes || (c.reason && c.reason.toLowerCase() !== typeLabel.toLowerCase() ? c.reason : '');

        return `
              <div class="leave-history-card lhc-ring-closure">
                <!-- Top Header Row: Calendar Icon, Date, Duration Tag & Glowing Status Pill -->
                <div class="lhc-header-row">
                  <div class="lhc-header-left">
                    <span class="lhc-cal-icon">📅</span>
                    <strong class="lhc-date-title">${dateDisplay}</strong>
                    <span class="lhc-duration-tag">${durationText}</span>
                  </div>
                  <div class="lhc-status-pill ${statusClass}">
                    <span class="lhc-status-dot"></span>
                    <span>${statusTitle}</span>
                  </div>
                </div>

                <!-- Middle Info Panel: Type (Dedicated Row), Shift (Dedicated Row), Applied & Ref -->
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

                <!-- Schedule Impact Pill -->
                <div class="lhc-impact-pill lhc-impact-clean">
                  <div class="lhc-impact-left">
                    <span class="lhc-impact-check">✓</span>
                    <span class="lhc-impact-text">Staff Roster Blocked · Bookings protected</span>
                  </div>
                </div>

                <!-- Action Buttons: Details & Reopen -->
                <div class="lhc-actions-row">
                  <button type="button" class="lhc-btn lhc-btn-details btn-view-closure-detail" data-closure-id="${c.id}">
                    <span class="lhc-btn-icon">👁️</span>
                    <span>Details</span>
                  </button>
                  ${!isPast && !isStaffMode ? `
                    <button type="button" class="lhc-btn lhc-btn-cancel btn-delete-closure-from-inspector" data-id="${c.id}">
                      <span class="lhc-btn-icon">✕</span>
                      <span>Reopen Salon</span>
                    </button>
                  ` : `
                    <span class="lhc-past-badge">Past Record</span>
                  `}
                </div>
              </div>
            `;
      }).join('')}
        </div>
        ${!isStaffMode ? `
          <div style="display: flex; justify-content: flex-end;">
            <button type="button" class="btn btn-primary btn-sm" id="btn-inspector-schedule-closure" style="font-size: 0.78rem; font-weight: 700; padding: 7px 16px; border-radius: 8px;">
              + Schedule Another Holiday / Closure
            </button>
          </div>
        ` : ''}
      `;
    }

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content modal-content-sheet" style="max-width: 560px; padding: 20px 22px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; background: #0f172a; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.75);">
          <div class="sheet-grab-handle"></div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 3px;">
                <span style="font-size: 1.15rem;">🌴</span>
                <h3 style="font-size: 1.05rem; font-weight: 800; color: #fff; margin: 0;">Store Closures & Holidays</h3>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35); font-size: 0.7rem; font-weight: 700;">
                  ${monthClosures.length} scheduled in ${currentMonthName}
                </span>
              </div>
            </div>
            <button class="close-btn" id="btn-close-closure-dialog" style="width: 28px; height: 28px; font-size: 1.1rem; background: rgba(255,255,255,0.06); border: none; border-radius: 50%; color: #94a3b8; cursor: pointer;">&times;</button>
          </div>
          ${bodyHtml}
        </div>
      </div>
    `;

    const closeModal = () => (modalContainer.innerHTML = '');
    document.getElementById('btn-close-closure-dialog')?.addEventListener('click', closeModal);
    modalContainer.querySelector('.modal-backdrop')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeModal();
    });

    document.getElementById('btn-inspector-schedule-closure')?.addEventListener('click', () => {
      closeModal();
      ScheduleDayOffDialog.open({
        salonWorkingHours,
        existingClosures: closures || [],
        staffList: app?.staffList || window.salonDashboard?.staffList || window.dashboardApp?.staffList || [],
        onSuccess: async () => {
          await onRefresh();
        },
      });
    });

    // Details button click -> Show Detail Modal
    modalContainer.querySelectorAll('.btn-view-closure-detail').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-closure-id');
        const closure = closures.find((c) => c.id === id);
        if (closure) {
          ClosureDialog.showClosureDetailModal(closure, salonWorkingHours, async () => {
            closeModal();
            await onRefresh();
          });
        }
      });
    });

    // Reopen Salon button click
    modalContainer.querySelectorAll('.btn-delete-closure-from-inspector').forEach((btn) => {
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
  }

  /**
   * Enterprise-grade Detail Modal for a single Salon Closure
   */
  static showClosureDetailModal(closure, salonWorkingHours = [], onReopen = () => { }) {
    const detailContainer = document.createElement('div');
    detailContainer.className = 'modal-backdrop show';
    detailContainer.style.zIndex = '99999';

    const shortDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const todayISO = new Date().toISOString().split('T')[0];

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

    const parseDate = (dStr) => {
      if (!dStr) return null;
      const iso = String(dStr).split('T')[0];
      const parts = iso.split('-');
      if (parts.length !== 3) return null;
      const [y, m, d] = parts.map(Number);
      const dt = new Date(y, m - 1, d);
      return !isNaN(dt.getTime()) ? dt : null;
    };

    const dtStart = parseDate(closure.startDate);
    const dtEnd = parseDate(closure.endDate);
    const isSingleDay = !dtEnd || (dtStart && dtStart.toDateString() === dtEnd.toDateString());

    let dateDisplay = '';
    let durationText = '1 Day';
    if (isSingleDay && dtStart) {
      dateDisplay = `${shortDays[dtStart.getDay()]}, ${monthsShort[dtStart.getMonth()]} ${dtStart.getDate()}, ${dtStart.getFullYear()}`;
    } else if (dtStart && dtEnd) {
      const diffDays = Math.round((dtEnd - dtStart) / (1000 * 60 * 60 * 24)) + 1;
      dateDisplay = `${shortDays[dtStart.getDay()]}, ${monthsShort[dtStart.getMonth()]} ${dtStart.getDate()} ➔ ${shortDays[dtEnd.getDay()]}, ${monthsShort[dtEnd.getMonth()]} ${dtEnd.getDate()}, ${dtEnd.getFullYear()}`;
      durationText = `${diffDays} Days`;
    }

    const isPartial = Boolean(closure.isPartialDay || closure.closureType === 'PARTIAL_DAY');
    const start12 = formatTimeTo12Hour(closure.startTime || '09:00');
    const end12 = formatTimeTo12Hour(closure.endTime || '21:00');
    const shiftLabel = isPartial ? `Partial (${start12} - ${end12})` : 'Full Day Closure';

    const dayKey = dtStart ? ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][dtStart.getDay()] : 'MONDAY';
    const regWh = salonWorkingHours.find((h) => String(h.dayOfWeek).toUpperCase() === dayKey);
    const regularShiftText = regWh
      ? (regWh.isClosed ? 'Weekly Off' : `${formatTimeTo12Hour(regWh.startTime || '09:00')} - ${formatTimeTo12Hour(regWh.endTime || '21:00')}`)
      : '09:00 AM - 09:00 PM';

    let categoryLabel = 'Store Holiday';
    let categoryColor = '#60a5fa';
    if (closure.closureType === 'FESTIVAL' || (closure.reason && /diwali|eid|holi|christmas|festival/i.test(closure.reason))) {
      categoryLabel = 'Festival Holiday';
      categoryColor = '#f472b6';
    } else if (closure.closureType === 'EMERGENCY_CLOSURE') {
      categoryLabel = 'Emergency Closure';
      categoryColor = '#f87171';
    } else if (closure.closureType === 'OTHER') {
      categoryLabel = 'Special Closure';
      categoryColor = '#cbd5e1';
    }

    const appliedFormatted = closure.createdAt ? new Date(closure.createdAt).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }) : 'Recently';

    const sISO = String(closure.startDate).split('T')[0];
    const eISO = String(closure.endDate).split('T')[0];
    const isPast = eISO < todayISO;

    detailContainer.innerHTML = `
      <div class="modal-content leave-detail-dialog" style="max-width: 480px;">
        <!-- Header -->
        <div class="ld-header">
          <div class="ld-header-left">
            <div class="ld-avatar" style="background: linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%);">
              <span>🌴</span>
            </div>
            <div class="ld-title-group">
              <div class="ld-title-row">
                <h3>${closure.reason || 'Store Closure'}</h3>
              </div>
              <div class="ld-title-sub">
                <span class="ld-span-pill">Whole Salon</span>
                <span>•</span>
                <span>${durationText}</span>
              </div>
            </div>
          </div>
          <button type="button" class="ld-close-btn" id="btn-close-closure-detail">&times;</button>
        </div>

        <!-- 2x2 Matrix Grid -->
        <div class="ld-matrix-grid">
          <div class="ld-matrix-item">
            <div class="ld-matrix-label">
              <span class="ld-matrix-icon">📅</span>
              <span>Date Range</span>
            </div>
            <div class="ld-matrix-val" title="${dateDisplay}">${dateDisplay}</div>
          </div>

          <div class="ld-matrix-item">
            <div class="ld-matrix-label">
              <span class="ld-matrix-icon">🕒</span>
              <span>Closed Shift</span>
            </div>
            <div class="ld-matrix-val">${shiftLabel}</div>
          </div>

          <div class="ld-matrix-item">
            <div class="ld-matrix-label">
              <span class="ld-matrix-icon">🏷️</span>
              <span>Category</span>
            </div>
            <div class="ld-matrix-val" style="color: ${categoryColor};">${categoryLabel}</div>
          </div>

          <div class="ld-matrix-item">
            <div class="ld-matrix-label">
              <span class="ld-matrix-icon">🕒</span>
              <span>Applied On</span>
            </div>
            <div class="ld-matrix-val">${appliedFormatted}</div>
          </div>
        </div>

        <!-- Salon Operating Shift Reference -->
        <div style="background: rgba(255, 255, 255, 0.025); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 10px; padding: 8px 12px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; font-size: 0.74rem;">
          <span style="color: #94a3b8;">Normal Operating Shift:</span>
          <span style="color: #f1f5f9; font-weight: 700;">${regularShiftText}</span>
        </div>

        <!-- Notes Card (if present) -->
        ${closure.notes ? `
          <div class="ld-notes-card">
            <div class="ld-notes-label">
              <span>💬</span> <span>Note:</span>
            </div>
            <div class="ld-notes-text">${closure.notes}</div>
          </div>
        ` : ''}

        <!-- Automated Booking Protection Active Banner -->
        <div class="ld-impact-section" style="margin-bottom: 14px;">
          <div class="ld-clean-banner">
            <span class="ld-clean-icon">✨</span>
            <div class="ld-clean-body">
              <span class="ld-clean-title">Automated Roster Protection Active</span>
              <span class="ld-clean-sep">·</span>
              <span class="ld-clean-desc">Staff roster blocked. Overlapping bookings auto-rescheduled via WhatsApp with 0 penalty.</span>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="ld-footer" style="display: flex; justify-content: space-between; align-items: center;">
          <div class="ld-footer-ref" style="font-size: 0.72rem; color: #64748b;">
            Ref: #${closure.id.slice(0, 10)}
          </div>
          <div class="ld-footer-actions" style="display: flex; gap: 8px;">
            ${!isPast ? `
              <button type="button" class="btn-ld-action btn-ld-cancel" id="btn-detail-reopen" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.35); color: #fca5a5; border-radius: 7px; padding: 6px 12px; font-size: 0.76rem; cursor: pointer; font-weight: 600;">
                <span class="btn-ld-icon">✕</span>
                <span>Reopen Salon</span>
              </button>
            ` : ''}
            <button type="button" class="btn btn-secondary btn-sm" id="btn-detail-close-btn" style="border-radius: 7px; padding: 6px 14px; font-size: 0.76rem;">
              Close
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(detailContainer);

    const closeDetail = () => {
      detailContainer.remove();
    };

    detailContainer.querySelector('#btn-close-closure-detail')?.addEventListener('click', closeDetail);
    detailContainer.querySelector('#btn-detail-close-btn')?.addEventListener('click', closeDetail);
    detailContainer.addEventListener('click', (e) => {
      if (e.target === detailContainer) closeDetail();
    });

    detailContainer.querySelector('#btn-detail-reopen')?.addEventListener('click', async () => {
      if (confirm('Are you sure you want to cancel this closure and reopen the booking calendar for these dates?')) {
        try {
          await ApiClient.deleteSalonClosure(closure.id);
          closeDetail();
          await onReopen();
        } catch (err) {
          alert(err.message || 'Failed to reopen salon calendar.');
        }
      }
    });
  }
}
