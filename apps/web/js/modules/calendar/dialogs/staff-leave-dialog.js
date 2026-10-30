import { ApiClient } from '../../../api.js';
import { StaffApplyLeaveDialog } from '../../staff/staff-apply-leave-dialog.js';
import { CalendarState } from '../calendar-state.js';

/**
 * StaffLeaveDialog
 * Dedicated Dialog for inspecting and managing Specialist Leaves (Chip: Staff Leave).
 * Mirrors the exact modern, minimal, and informative .leave-history-card design language of ClosureDialog.
 */
export class StaffLeaveDialog {
  /**
   * Opens the Staff Leaves Inspector Dialog.
   * @param {Object} options
   * @param {Object} options.app - Dashboard application context
   * @param {number} options.year - Active calendar year
   * @param {number} options.month - Active calendar month (0-11)
   * @param {Array} options.leaves - Monthly leaves array
   * @param {Array} options.staffList - Team specialists list
   * @param {boolean} options.isStaffMode - Whether viewed from specialist workspace
   * @param {string} options.staffId - Specialist ID if in staff mode
   * @param {string} options.staffName - Specialist name if in staff mode
   * @param {Function} options.onRefresh - Callback to refresh calendar
   */
  static open({ app, year, month, leaves = [], staffList = [], isStaffMode = false, staffId = null, staffName = 'Specialist', onRefresh = () => { } }) {
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

    const allLeaves = (leaves || app?.calendarSchedule?.leaves || []);
    const monthLeaves = allLeaves.filter((l) => {
      const s = String(l.startDate).split('T')[0];
      const e = String(l.endDate).split('T')[0];
      if (s > monthEnd || e < monthStart) return false;
      if (isStaffMode && staffId && l.stylistId !== staffId) return false;
      return true;
    });

    const titleText = isStaffMode ? `${staffName}'s Approved Leaves` : `Approved Specialist Leaves`;

    let bodyHtml = '';
    if (monthLeaves.length === 0) {
      bodyHtml = `
        <div style="text-align: center; padding: 36px 16px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.1); border-radius: 14px; margin-bottom: 16px;">
          <div style="font-size: 2.2rem; margin-bottom: 10px;">🏖️</div>
          <div style="font-size: 0.95rem; font-weight: 700; color: #fff; margin-bottom: 4px;">No Approved Leaves in ${currentMonthName}</div>
          <div style="font-size: 0.76rem; color: #94a3b8; max-width: 340px; margin: 0 auto 16px auto; line-height: 1.4;">All specialists are scheduled to operate normally according to regular shifts.</div>
          ${!isStaffMode ? `
            <button type="button" class="btn btn-primary btn-sm" id="btn-inspector-schedule-leave" style="font-size: 0.78rem; font-weight: 700; padding: 7px 16px; border-radius: 8px;">
              + Apply Specialist Leave
            </button>
          ` : ''}
        </div>
      `;
    } else {
      bodyHtml = `
        <div style="display: flex; flex-direction: column; gap: 10px; max-height: 440px; overflow-y: auto; padding-right: 4px; margin-bottom: 16px;">
          ${monthLeaves.map((l) => {
            const dtStart = parseDate(l.startDate);
            const dtEnd = parseDate(l.endDate);
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
              dateDisplay = String(l.startDate).split('T')[0];
            }

            if (l.durationDays) {
              durationText = `${l.durationDays} ${l.durationDays === 1 ? 'Day' : 'Days'}`;
            }

            // Status resolution (exact match with ClosureDialog)
            const sISO = String(l.startDate).split('T')[0];
            const eISO = String(l.endDate).split('T')[0];
            const isPast = eISO < todayISO;
            const isToday = sISO <= todayISO && todayISO <= eISO;
            const isCancelled = l.status === 'CANCELLED';

            let statusClass = 'lhc-status-onleave';
            let statusTitle = 'On Leave';
            if (isCancelled) {
              statusClass = 'lhc-status-cancelled';
              statusTitle = 'Cancelled';
            } else if (isPast) {
              statusClass = 'lhc-status-completed';
              statusTitle = 'Completed';
            } else if (!isToday) {
              statusClass = 'lhc-status-upcoming';
              statusTitle = 'Upcoming';
            }

            // Leave Type resolution & vibrant color
            const rawType = (l.leaveType || 'LEAVE').toUpperCase();
            const formattedLeaveType = (l.leaveType || 'Leave').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
            let typeColor = '#f472b6'; // Vibrant pink/magenta
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

            // Shift resolution
            const isPartial = Boolean(l.isPartialDay);
            let shiftLabel = 'Full Day Off';
            if (isPartial && l.startTime && l.endTime) {
              const start12 = formatTimeTo12Hour(l.startTime);
              const end12 = formatTimeTo12Hour(l.endTime);
              shiftLabel = `Partial (${start12} - ${end12})`;
            }

            // Applied timestamp & Ref
            const appliedFormatted = formatAppliedTimestamp(l.createdAt);
            const refId = l.id ? `#${String(l.id).slice(0, 8)}` : (l.absenceId ? `#${String(l.absenceId).slice(0, 8)}` : '#N/A');
            const stylistName = l.stylistName || staffName || 'Specialist';

            return `
              <div class="leave-history-card lhc-ring-leave">
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

                <!-- Middle Info Panel: Type (Dedicated Row), Shift (Dedicated Row), Specialist/Applied & Ref -->
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
                      ${isStaffMode ? `
                        <span class="lhc-meta-label">Applied:</span>
                        <span class="lhc-meta-applied-val">${appliedFormatted}</span>
                      ` : `
                        <span class="lhc-meta-icon">👤</span>
                        <span class="lhc-meta-label">Specialist:</span>
                        <strong class="lhc-meta-type-val" style="color: #f8fafc; font-weight: 700; max-width: 170px;">${stylistName}</strong>
                      `}
                    </div>
                    <div class="lhc-meta-cell lhc-meta-right">
                      <span class="lhc-meta-label">Ref:</span>
                      <span class="lhc-meta-ref-val">${refId}</span>
                    </div>
                  </div>
                  ${(l.reason || l.notes) ? `
                    <div class="lhc-meta-note-row">
                      <span class="lhc-meta-label">Note:</span>
                      <span class="lhc-meta-note-val">${l.reason || l.notes}</span>
                    </div>
                  ` : ''}
                </div>

                <!-- Schedule Impact Pill -->
                <div class="lhc-impact-pill lhc-impact-clean">
                  <div class="lhc-impact-left">
                    <span class="lhc-impact-check">✓</span>
                    <span class="lhc-impact-text">Specialist Roster Blocked · Bookings protected</span>
                  </div>
                </div>

                <!-- Action Buttons: Details & Cancel Leave -->
                <div class="lhc-actions-row">
                  <button type="button" class="lhc-btn lhc-btn-details btn-view-leave-detail" data-leave-id="${l.id || l.absenceId}">
                    <span class="lhc-btn-icon">👁️</span>
                    <span>Details</span>
                  </button>
                  ${!isPast ? `
                    <button type="button" class="lhc-btn lhc-btn-cancel btn-cancel-leave-from-dialog" data-staff-id="${l.stylistId || staffId}" data-absence-id="${l.id || l.absenceId}" data-name="${stylistName.replace(/"/g, '&quot;')}">
                      <span class="lhc-btn-icon">✕</span>
                      <span>Cancel Leave</span>
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
            <button type="button" class="btn btn-primary btn-sm" id="btn-inspector-schedule-leave" style="font-size: 0.78rem; font-weight: 700; padding: 7px 16px; border-radius: 8px;">
              + Apply Specialist Leave
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
                <span style="font-size: 1.15rem;">🏖️</span>
                <h3 style="font-size: 1.05rem; font-weight: 800; color: #fff; margin: 0;">${titleText}</h3>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="badge" style="background: rgba(244, 63, 94, 0.15); color: #fb7185; border: 1px solid rgba(244, 63, 94, 0.35); font-size: 0.7rem; font-weight: 700;">
                  ${monthLeaves.length} scheduled in ${currentMonthName}
                </span>
              </div>
            </div>
            <button class="close-btn" id="btn-close-staff-leave-dialog" style="width: 28px; height: 28px; font-size: 1.1rem; background: rgba(255,255,255,0.06); border: none; border-radius: 50%; color: #94a3b8; cursor: pointer;">&times;</button>
          </div>
          ${bodyHtml}
        </div>
      </div>
    `;

    const closeModal = () => (modalContainer.innerHTML = '');
    document.getElementById('btn-close-staff-leave-dialog')?.addEventListener('click', closeModal);
    modalContainer.querySelector('.modal-backdrop')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeModal();
    });

    document.getElementById('btn-inspector-schedule-leave')?.addEventListener('click', () => {
      closeModal();
      StaffApplyLeaveDialog.open({
        staffList: staffList || app?.staffList || window.salonDashboard?.staffList || window.dashboardApp?.staffList || [],
        staffId: staffId || null,
        staffName: staffName || null,
        salonWorkingHours: app?.salonWorkingHours || window.salonDashboard?.salonWorkingHours || window.dashboardApp?.salonWorkingHours || [],
        onSuccess: async () => {
          await onRefresh();
        },
      });
    });

    // Details button click -> Show Detail Modal
    modalContainer.querySelectorAll('.btn-view-leave-detail').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-leave-id');
        const leave = monthLeaves.find((l) => (l.id === id || l.absenceId === id));
        if (leave) {
          StaffLeaveDialog.showLeaveDetailModal(leave, async () => {
            closeModal();
            await onRefresh();
          });
        }
      });
    });

    // Cancel Leave action
    modalContainer.querySelectorAll('.btn-cancel-leave-from-dialog').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const sId = e.currentTarget.getAttribute('data-staff-id');
        const aId = e.currentTarget.getAttribute('data-absence-id');
        const sName = e.currentTarget.getAttribute('data-name');
        const confirmed = await CalendarState.confirm({
          title: 'Cancel Specialist Leave?',
          message: `Are you sure you want to cancel the scheduled leave for ${sName}? Specialist availability will be restored immediately.`,
          confirmText: 'Cancel Leave',
          cancelText: 'Keep Leave',
          type: 'danger',
          icon: '👤',
        });
        if (confirmed) {
          CalendarState.showLoading('Cancelling specialist leave...');
          try {
            await ApiClient.cancelStaffAbsence(sId, aId);
            closeModal();
            CalendarState.hideLoading(0);
            CalendarState.optimisticRemoveLeave(aId);
            CalendarState.notify(`Leave cancelled for ${sName}.`, 'success');
            await CalendarState.refreshAll();
            if (typeof onRefresh === 'function') {
              try { onRefresh(); } catch (e) { console.warn(e); }
            }
          } catch (err) {
            CalendarState.hideLoading(0);
            CalendarState.notify(err.message || 'Failed to cancel leave.', 'error');
          }
        }
      });
    });
  }

  /**
   * Enterprise-grade Detail Modal for a single Staff Leave (exact match with ClosureDialog)
   */
  static showLeaveDetailModal(leave, onCancelled = () => { }) {
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

    const dtStart = parseDate(leave.startDate);
    const dtEnd = parseDate(leave.endDate);
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

    if (leave.durationDays) {
      durationText = `${leave.durationDays} ${leave.durationDays === 1 ? 'Day' : 'Days'}`;
    }

    const isPartial = Boolean(leave.isPartialDay);
    const shiftLabel = isPartial && leave.startTime && leave.endTime
      ? `Partial (${formatTimeTo12Hour(leave.startTime)} - ${formatTimeTo12Hour(leave.endTime)})`
      : 'Full Day Off';

    const formattedLeaveType = (leave.leaveType || 'LEAVE').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
    const stylistName = leave.stylistName || 'Specialist';

    const appliedFormatted = leave.createdAt ? new Date(leave.createdAt).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }) : 'Recently';

    const sISO = String(leave.startDate).split('T')[0];
    const eISO = String(leave.endDate).split('T')[0];
    const isPast = eISO < todayISO;

    detailContainer.innerHTML = `
      <div class="modal-content leave-detail-dialog" style="max-width: 480px;">
        <!-- Header -->
        <div class="ld-header">
          <div class="ld-header-left">
            <div class="ld-avatar" style="background: linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%);">
              <span>🏖️</span>
            </div>
            <div class="ld-title-group">
              <div class="ld-title-row">
                <h3>${stylistName}</h3>
              </div>
              <div class="ld-title-sub">
                <span class="ld-span-pill">${formattedLeaveType}</span>
                <span>•</span>
                <span>${durationText}</span>
              </div>
            </div>
          </div>
          <button type="button" class="ld-close-btn" id="btn-close-leave-detail">&times;</button>
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
              <span>Shift Timing</span>
            </div>
            <div class="ld-matrix-val">${shiftLabel}</div>
          </div>

          <div class="ld-matrix-item">
            <div class="ld-matrix-label">
              <span class="ld-matrix-icon">🏷️</span>
              <span>Leave Type</span>
            </div>
            <div class="ld-matrix-val" style="color: #fb7185;">${formattedLeaveType}</div>
          </div>

          <div class="ld-matrix-item">
            <div class="ld-matrix-label">
              <span class="ld-matrix-icon">🕒</span>
              <span>Applied On</span>
            </div>
            <div class="ld-matrix-val">${appliedFormatted}</div>
          </div>
        </div>

        <!-- Notes Card (if present) -->
        ${(leave.reason || leave.notes) ? `
          <div class="ld-notes-card">
            <div class="ld-notes-label">
              <span>💬</span> <span>Reason / Note:</span>
            </div>
            <div class="ld-notes-text">${leave.reason || leave.notes}</div>
          </div>
        ` : ''}

        <!-- Automated Booking Protection Active Banner -->
        <div class="ld-impact-section" style="margin-bottom: 14px;">
          <div class="ld-clean-banner">
            <span class="ld-clean-icon">✨</span>
            <div class="ld-clean-body">
              <span class="ld-clean-title">Automated Roster Protection Active</span>
              <span class="ld-clean-sep">·</span>
              <span class="ld-clean-desc">Specialist roster blocked. Overlapping bookings protected and isolated.</span>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="ld-footer" style="display: flex; justify-content: space-between; align-items: center;">
          <div class="ld-footer-ref" style="font-size: 0.72rem; color: #64748b;">
            Ref: #${String(leave.id || leave.absenceId || 'N/A').slice(0, 10)}
          </div>
          <div class="ld-footer-actions" style="display: flex; gap: 8px;">
            ${!isPast ? `
              <button type="button" class="btn-ld-action btn-ld-cancel" id="btn-detail-cancel-leave" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.35); color: #fca5a5; border-radius: 7px; padding: 6px 12px; font-size: 0.76rem; cursor: pointer; font-weight: 600;">
                <span class="btn-ld-icon">✕</span>
                <span>Cancel Leave</span>
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

    detailContainer.querySelector('#btn-close-leave-detail')?.addEventListener('click', closeDetail);
    detailContainer.querySelector('#btn-detail-close-btn')?.addEventListener('click', closeDetail);
    detailContainer.addEventListener('click', (e) => {
      if (e.target === detailContainer) closeDetail();
    });

    detailContainer.querySelector('#btn-detail-cancel-leave')?.addEventListener('click', async () => {
      const confirmed = await CalendarState.confirm({
        title: 'Cancel Specialist Leave?',
        message: `Are you sure you want to cancel the scheduled leave for ${stylistName}? Specialist availability will be restored immediately.`,
        confirmText: 'Cancel Leave',
        cancelText: 'Keep Leave',
        type: 'danger',
        icon: '👤',
      });
      if (confirmed) {
        CalendarState.showLoading('Cancelling specialist leave...');
        try {
          await ApiClient.cancelStaffAbsence(leave.stylistId, leave.id || leave.absenceId);
          closeDetail();
          CalendarState.hideLoading(0);
          CalendarState.optimisticRemoveLeave(leave.id || leave.absenceId);
          CalendarState.notify(`Leave cancelled for ${stylistName}.`, 'success');
          await CalendarState.refreshAll();
          if (typeof onCancelled === 'function') {
            try { onCancelled(); } catch (e) { console.warn(e); }
          }
        } catch (err) {
          CalendarState.hideLoading(0);
          CalendarState.notify(err.message || 'Failed to cancel leave.', 'error');
        }
      }
    });
  }
}
