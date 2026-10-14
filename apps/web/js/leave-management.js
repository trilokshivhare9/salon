import { ApiClient } from './api.js';

/**
 * EMPLOYEE LEAVE & AVAILABILITY OVERRIDE FRONTEND MODULE
 * Production-ready modular architecture for Leave Management UI.
 */

// Helper to format date cleanly without timezone shifts (YYYY-MM-DD -> DD MMM YYYY)
export function formatDateFriendly(dateStr) {
  if (!dateStr) return '';
  const cleanStr = String(dateStr).split('T')[0];
  const parts = cleanStr.split('-');
  if (parts.length !== 3) return dateStr;
  const dateObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  return dateObj.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

// Map enum values to human labels
export const LEAVE_TYPE_LABELS = {
  SICK_LEAVE: '🤒 Sick Leave',
  CASUAL_LEAVE: '🌴 Casual Leave',
  EMERGENCY_LEAVE: '🚨 Emergency Leave',
  UNPAID_LEAVE: '📄 Unpaid Leave',
  OTHER: '📝 Other',
};

export const LEAVE_PORTION_LABELS = {
  FULL_DAY: 'Full Day',
  FIRST_HALF: 'First Half',
  SECOND_HALF: 'Second Half',
  CUSTOM_HOURS: 'Custom Hours',
};

// Helper to format date with weekday (e.g. "Fri, Oct 9, 2026")
export function formatDateWithWeekday(dateStr) {
  if (!dateStr) return '';
  const cleanStr = String(dateStr).split('T')[0];
  const parts = cleanStr.split('-');
  if (parts.length !== 3) return dateStr;
  const dateObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  return dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

// Helper to calculate duration in days
export function calculateDurationDays(sDate, eDate) {
  if (!sDate) return '1 Day';
  const start = new Date(String(sDate).split('T')[0]);
  const end = new Date(String(eDate || sDate).split('T')[0]);
  const diffTime = Math.abs(end.getTime() - start.getTime());
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24)) + 1;
  return diffDays <= 1 ? '1 Day' : `${diffDays} Days`;
}

// Helper to format application timestamp "Applied Oct 9, 2026 · 6:12 PM"
export function formatAppliedTimestamp(isoString) {
  if (!isoString) return 'Earlier';
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return 'Earlier';
    const dateFormatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const timeFormatted = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${dateFormatted} · ${timeFormatted}`;
  } catch {
    return 'Earlier';
  }
}

// Helper to get styled leave type details
export function getLeaveTypeDetails(type, reason) {
  switch (type) {
    case 'SICK_LEAVE':
      return { icon: '🤒', label: 'Sick Leave', color: '#f472b6', bg: 'rgba(244, 114, 182, 0.12)', border: 'rgba(244, 114, 182, 0.28)' };
    case 'CASUAL_LEAVE':
      return { icon: '🌴', label: 'Casual Leave', color: '#2dd4bf', bg: 'rgba(45, 212, 191, 0.12)', border: 'rgba(45, 212, 191, 0.28)' };
    case 'EMERGENCY_LEAVE':
      return { icon: '🚨', label: 'Emergency Leave', color: '#fb7185', bg: 'rgba(251, 113, 133, 0.12)', border: 'rgba(251, 113, 133, 0.28)' };
    case 'UNPAID_LEAVE':
      return { icon: '📄', label: 'Unpaid Leave', color: '#c084fc', bg: 'rgba(192, 132, 252, 0.12)', border: 'rgba(192, 132, 252, 0.28)' };
    default:
      return { icon: '📝', label: reason || 'Other Leave', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.12)', border: 'rgba(148, 163, 184, 0.25)' };
  }
}

// Helper to get leave portion & shift window details
export function getPortionDetails(portion, customStart, customEnd) {
  switch (portion) {
    case 'FIRST_HALF':
      return { icon: '🌅', label: 'First Half', shiftText: 'Morning Shift', fullLabel: 'First Half (Morning Shift)' };
    case 'SECOND_HALF':
      return { icon: '🌇', label: 'Second Half', shiftText: 'Afternoon Shift', fullLabel: 'Second Half (Afternoon Shift)' };
    case 'CUSTOM_HOURS':
      return { icon: '⏱️', label: 'Custom Hours', shiftText: `${customStart || '00:00'} – ${customEnd || '00:00'}`, fullLabel: `Custom (${customStart || ''} – ${customEnd || ''})` };
    case 'FULL_DAY':
    default:
      return { icon: '⏰', label: 'Full Day', shiftText: 'All Working Shifts', fullLabel: 'Full Working Shift' };
  }
}

export const PROCESSING_STATUS_BADGES = {
  PENDING: { label: 'Pending', bg: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', border: 'rgba(245, 158, 11, 0.3)', icon: '⏳' },
  PROCESSING: { label: 'Processing...', bg: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', border: 'rgba(59, 130, 246, 0.3)', icon: '🔄' },
  COMPLETED: { label: 'Completed', bg: 'rgba(52, 211, 153, 0.15)', color: '#34d399', border: 'rgba(52, 211, 153, 0.3)', icon: '✅' },
  FAILED: { label: 'Action Required', bg: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: 'rgba(239, 68, 68, 0.3)', icon: '⚠️' },
};

export const LEAVE_STATUS_MAP = {
  ON_LEAVE: {
    key: 'ON_LEAVE',
    label: 'On Leave',
    title: '🟢 On Leave',
    icon: '🟢',
    bg: 'rgba(52, 211, 153, 0.15)',
    color: '#34d399',
    border: 'rgba(52, 211, 153, 0.3)',
    summaryText: 'Specialist is on leave and calendar availability is blocked for this period.',
  },
  CANCELLED: {
    key: 'CANCELLED',
    label: 'Cancelled',
    title: '❌ Cancelled',
    icon: '❌',
    bg: 'rgba(239, 68, 68, 0.15)',
    color: '#f87171',
    border: 'rgba(239, 68, 68, 0.3)',
    summaryText: 'Leave was cancelled. Specialist availability has been restored to the normal salon schedule.',
  },
};

/**
 * Resolves a single, human-friendly unified status for leaves:
 * Only two valid business states: "🟢 On Leave" or "❌ Cancelled".
 */
export function getUnifiedLeaveStatus(absence) {
  const isCancelled = absence.status === 'CANCELLED' || absence.statusKey === 'CANCELLED';
  return isCancelled ? LEAVE_STATUS_MAP.CANCELLED : LEAVE_STATUS_MAP.ON_LEAVE;
}

export class LeaveManagementUI {
  constructor(dashboardApp) {
    this.app = dashboardApp;
  }

  // Show Toast wrapper
  toast(msg, type = 'info') {
    if (typeof this.app.showToast === 'function') {
      this.app.showToast(msg, type);
    } else {
      alert(msg);
    }
  }

  /**
   * 1. CREATE / MARK LEAVE FORM MODAL (COMPACT & EXECUTIVE)
   */
  showCreateLeaveModal(staffId, staffName, defaultDate = null) {
    const modalContainer = document.getElementById('modal-container');
    if (!modalContainer) return;

    const initialDate = defaultDate || this.app.selectedCalDate || this.app.selectedDate || new Date().toISOString().split('T')[0];
    const staffList = this.app.staffList || [];
    const targetStaff = staffList.find((s) => s.id === staffId);
    const initialStaffName = staffName || targetStaff?.name || 'Specialist';

    const formatPresentationDate = (dateStr) => {
      if (!dateStr) return 'Select date';
      const parts = dateStr.split('-');
      if (parts.length !== 3) return dateStr;
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10) - 1;
      const d = parseInt(parts[2], 10);
      const dt = new Date(y, m, d);
      if (isNaN(dt.getTime())) return dateStr;
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      return `${days[dt.getDay()]}, ${d} ${months[dt.getMonth()]} ${y}`;
    };

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="apply-leave-dialog">
          <!-- Compact Header -->
          <div class="ald-header">
            <div class="ald-header-left">
              <div class="ald-icon-badge">🗓️</div>
              <div class="ald-title-wrap">
                <h3 class="ald-title">Record Specialist Leave</h3>
                ${staffId ? `<span class="ald-staff-chip">${initialStaffName}</span>` : ''}
              </div>
            </div>
            <button class="ald-close-btn" id="btn-close-leave-modal" title="Close modal">&times;</button>
          </div>

          <form id="leave-management-form">
            <!-- Specialist Select (Only if not pre-set) -->
            ${staffId ? `
              <input type="hidden" id="leave-staff-id" value="${staffId}" />
            ` : `
              <div class="ald-row-1">
                <label class="ald-label">Specialist *</label>
                <select class="ald-input" id="leave-staff-id" required>
                  <option value="" disabled selected>-- Select Specialist --</option>
                  ${staffList.map((st) => `<option value="${st.id}">${st.name} (${st.phone || 'No phone'})</option>`).join('')}
                </select>
              </div>
            `}

            <!-- Row 1: Start Date & End Date -->
            <div class="ald-row-2">
              <div class="ald-col">
                <label class="ald-label" for="leave-start-date">Start Date *</label>
                <div class="ald-date-box" id="leave-start-date-box" tabindex="0">
                  <div class="ald-date-display">
                    <span class="ald-date-icon">🗓️</span>
                    <span class="ald-date-value" id="leave-start-date-text">${formatPresentationDate(initialDate)}</span>
                  </div>
                  <span class="ald-date-arrow">▾</span>
                  <input type="date" class="ald-date-native" id="leave-start-date" value="${initialDate}" required />
                </div>
              </div>

              <div class="ald-col">
                <div class="ald-label-row">
                  <label class="ald-label" for="leave-end-date">End Date *</label>
                  <span class="ald-pill-badge" id="leave-duration-badge">✨ 1 Day</span>
                </div>
                <div class="ald-date-box" id="leave-end-date-box" tabindex="0">
                  <div class="ald-date-display">
                    <span class="ald-date-icon">🗓️</span>
                    <span class="ald-date-value" id="leave-end-date-text">${formatPresentationDate(initialDate)}</span>
                  </div>
                  <span class="ald-date-arrow">▾</span>
                  <input type="date" class="ald-date-native" id="leave-end-date" value="${initialDate}" required />
                </div>
              </div>
            </div>

            <!-- Row 2: Leave Type & Shift Coverage -->
            <div class="ald-row-2">
              <!-- Leave Type Custom Dropdown -->
              <div class="ald-col">
                <label class="ald-label">Leave Type *</label>
                <input type="hidden" id="leave-type" value="SICK_LEAVE" />
                <div class="cselect-wrap" id="cselect-leave-type">
                  <div class="cselect-trigger" tabindex="0">
                    <span class="cselect-label">🤒 Sick Leave</span>
                    <span class="cselect-arrow">▼</span>
                  </div>
                  <div class="cselect-menu">
                    <div class="cselect-option is-selected" data-value="SICK_LEAVE">🤒 Sick Leave</div>
                    <div class="cselect-option" data-value="CASUAL_LEAVE">🌴 Casual Leave</div>
                    <div class="cselect-option" data-value="EMERGENCY_LEAVE">🚨 Emergency Leave</div>
                    <div class="cselect-option" data-value="UNPAID_LEAVE">📄 Unpaid Leave</div>
                    <div class="cselect-option" data-value="OTHER">📝 Other</div>
                  </div>
                </div>
              </div>

              <!-- Shift Coverage Custom Dropdown -->
              <div class="ald-col">
                <label class="ald-label">Shift Coverage *</label>
                <input type="hidden" id="leave-portion" value="FULL_DAY" />
                <div class="cselect-wrap" id="cselect-leave-portion">
                  <div class="cselect-trigger" tabindex="0">
                    <span class="cselect-label">☀️ Full Day</span>
                    <span class="cselect-arrow">▼</span>
                  </div>
                  <div class="cselect-menu">
                    <div class="cselect-option is-selected" data-value="FULL_DAY">☀️ Full Day</div>
                    <div class="cselect-option" data-value="FIRST_HALF">🌅 First Half (Morning)</div>
                    <div class="cselect-option" data-value="SECOND_HALF">🌇 Second Half (Afternoon)</div>
                    <div class="cselect-option" data-value="CUSTOM_HOURS">⏱️ Custom Hours</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Row 3: Custom Hours Window (Conditional) -->
            <div id="leave-custom-hours-group" class="ald-custom-hours" style="display: none;">
              <div style="font-size: 0.72rem; font-weight: 600; color: #c084fc; display: flex; align-items: center; gap: 5px;">
                <span>⏱️ Window:</span>
                <span id="leave-custom-hours-calc" style="background: rgba(168,85,247,0.2); padding: 1px 5px; border-radius: 4px; font-size: 0.65rem;">4.0 hrs</span>
              </div>
              <div class="ald-custom-hours-inputs">
                <input type="time" id="leave-custom-start-time" value="09:00" />
                <span style="font-size: 0.7rem; color: #94a3b8;">to</span>
                <input type="time" id="leave-custom-end-time" value="13:00" />
              </div>
            </div>

            <!-- Row 4: Reason (Full Width) -->
            <div class="ald-row-1">
              <label class="ald-label">Reason (Optional)</label>
              <input type="text" class="ald-input" id="leave-reason" placeholder="e.g. Medical checkup, personal leave" />
            </div>

            <!-- Row 5: Internal Notes (Full Width) -->
            <div class="ald-row-1">
              <label class="ald-label">Internal Notes (Optional)</label>
              <input type="text" class="ald-input" id="leave-notes" placeholder="e.g. Informed manager in advance" />
            </div>

            <!-- Row 6: Unified Operational Banner -->
            <div class="ald-compact-notice is-clean" style="border: 1px solid rgba(168, 85, 247, 0.25); background: rgba(168, 85, 247, 0.05); padding: 12px 14px; border-radius: 10px; margin-bottom: 16px;">
              <div class="ald-notice-main" style="display: flex; align-items: flex-start; gap: 10px;">
                <span style="font-size: 1.1rem; line-height: 1;">⚡</span>
                <div>
                  <div style="font-weight: 700; color: #fff; font-size: 0.84rem; margin-bottom: 2px;">Automated Booking Protection</div>
                  <div style="font-size: 0.78rem; color: #94a3b8; line-height: 1.35;">Staff roster will be blocked immediately. Any overlapping client bookings will automatically receive an interactive WhatsApp reschedule proposal for the next available slot.</div>
                </div>
              </div>
            </div>

            <!-- Row 7: Footer Actions -->
            <div class="ald-footer">
              <button type="button" class="ald-btn-cancel" id="btn-cancel-leave-modal">Cancel</button>
              <button type="submit" class="ald-btn-submit" id="btn-submit-leave">
                <span>🚫 Confirm & Process Leave</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    `;

    const closeModal = () => { modalContainer.innerHTML = ''; };
    document.getElementById('btn-close-leave-modal')?.addEventListener('click', closeModal);
    document.getElementById('btn-cancel-leave-modal')?.addEventListener('click', closeModal);

    const startDateEl = document.getElementById('leave-start-date');
    const endDateEl = document.getElementById('leave-end-date');
    const leaveTypeInput = document.getElementById('leave-type');
    const portionInput = document.getElementById('leave-portion');
    const customHoursGroup = document.getElementById('leave-custom-hours-group');
    const customStartEl = document.getElementById('leave-custom-start-time');
    const customEndEl = document.getElementById('leave-custom-end-time');
    const staffSelectEl = document.getElementById('leave-staff-id');
    const durationBadge = document.getElementById('leave-duration-badge');

    // Helper: Update Duration Badge
    const updateDurationBadge = () => {
      if (!durationBadge || !startDateEl || !endDateEl) return;
      const s = startDateEl.value;
      const e = endDateEl.value;
      if (!s || !e) {
        durationBadge.textContent = '✨ 1 Day';
        return;
      }
      const dur = calculateDurationDays(s, e);
      durationBadge.textContent = `✨ ${dur}`;
    };

    // Helper: Calculate Custom Hours Window
    const updateCustomHoursCalc = () => {
      const calcEl = document.getElementById('leave-custom-hours-calc');
      if (!calcEl || !customStartEl || !customEndEl) return;
      const s = customStartEl.value || '09:00';
      const e = customEndEl.value || '13:00';
      const [sh, sm] = s.split(':').map(Number);
      const [eh, em] = e.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;
      if (endMin <= startMin) {
        calcEl.textContent = '⚠️ Invalid';
        calcEl.style.background = 'rgba(239, 68, 68, 0.25)';
        calcEl.style.color = '#fca5a5';
      } else {
        const diffHours = ((endMin - startMin) / 60).toFixed(1);
        calcEl.textContent = `${diffHours.endsWith('.0') ? parseInt(diffHours, 10) : diffHours} hrs`;
        calcEl.style.background = 'rgba(168, 85, 247, 0.2)';
        calcEl.style.color = '#d8b4fe';
      }
    };

    // Quick Date Presets calculation
    const getPresetDates = (preset) => {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const formatYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

      if (preset === 'today') {
        const dStr = formatYMD(now);
        return { start: dStr, end: dStr };
      }
      if (preset === 'tomorrow') {
        const tm = new Date(now);
        tm.setDate(tm.getDate() + 1);
        const dStr = formatYMD(tm);
        return { start: dStr, end: dStr };
      }
      if (preset === '3days') {
        const s = formatYMD(now);
        const e = new Date(now);
        e.setDate(e.getDate() + 2);
        return { start: s, end: formatYMD(e) };
      }
      if (preset === 'this_week') {
        const day = now.getDay();
        const distToSun = day === 0 ? 0 : 7 - day;
        const sun = new Date(now);
        sun.setDate(sun.getDate() + distToSun);
        return { start: formatYMD(now), end: formatYMD(sun) };
      }
      const todayStr = formatYMD(now);
      return { start: todayStr, end: todayStr };
    };

    // Quick Preset link click
    modalContainer.querySelectorAll('.ald-quick-link').forEach((link) => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const presetKey = e.currentTarget.getAttribute('data-preset');
        const { start, end } = getPresetDates(presetKey);
        startDateEl.value = start;
        endDateEl.value = end;
        updateDateDisplays();
        updateDurationBadge();
        debouncedPreview();
      });
    });

    const startDateTextEl = document.getElementById('leave-start-date-text');
    const endDateTextEl = document.getElementById('leave-end-date-text');

    const updateDateDisplays = () => {
      if (startDateTextEl && startDateEl) {
        startDateTextEl.textContent = formatPresentationDate(startDateEl.value);
      }
      if (endDateTextEl && endDateEl) {
        endDateTextEl.textContent = formatPresentationDate(endDateEl.value);
      }
    };

    // Date change listeners
    startDateEl.addEventListener('change', () => {
      if (!endDateEl.value || endDateEl.value < startDateEl.value) {
        endDateEl.value = startDateEl.value;
      }
      updateDateDisplays();
      updateDurationBadge();
      debouncedPreview();
    });
    startDateEl.addEventListener('input', () => {
      updateDateDisplays();
    });

    endDateEl.addEventListener('change', () => {
      if (endDateEl.value < startDateEl.value) {
        startDateEl.value = endDateEl.value;
      }
      updateDateDisplays();
      updateDurationBadge();
      debouncedPreview();
    });
    endDateEl.addEventListener('input', () => {
      updateDateDisplays();
    });

    // Box click helper to open picker smoothly
    const startBox = document.getElementById('leave-start-date-box');
    const endBox = document.getElementById('leave-end-date-box');
    startBox?.addEventListener('click', (e) => {
      if (e.target !== startDateEl) {
        try { startDateEl.showPicker(); } catch (_) { startDateEl.focus(); }
      }
    });
    endBox?.addEventListener('click', (e) => {
      if (e.target !== endDateEl) {
        try { endDateEl.showPicker(); } catch (_) { endDateEl.focus(); }
      }
    });

    // Setup Custom Selects
    const initCustomSelect = (wrapId, hiddenInputId, onSelect) => {
      const wrap = modalContainer.querySelector(`#${wrapId}`);
      const input = modalContainer.querySelector(`#${hiddenInputId}`);
      if (!wrap || !input) return;

      const trigger = wrap.querySelector('.cselect-trigger');
      const menu = wrap.querySelector('.cselect-menu');
      const label = wrap.querySelector('.cselect-label');

      trigger.onclick = (e) => {
        e.stopPropagation();
        const wasOpen = menu.classList.contains('is-open');
        modalContainer.querySelectorAll('.cselect-menu.is-open').forEach((m) => m.classList.remove('is-open'));
        modalContainer.querySelectorAll('.cselect-trigger.is-active').forEach((t) => t.classList.remove('is-active'));
        if (!wasOpen) {
          menu.classList.add('is-open');
          trigger.classList.add('is-active');
        }
      };

      menu.querySelectorAll('.cselect-option').forEach((opt) => {
        opt.onclick = (e) => {
          e.stopPropagation();
          const val = opt.getAttribute('data-value');
          const primaryText = opt.querySelector('span:first-child')?.textContent || opt.textContent;
          input.value = val;
          label.textContent = primaryText;
          menu.querySelectorAll('.cselect-option').forEach((o) => o.classList.remove('is-selected'));
          opt.classList.add('is-selected');
          menu.classList.remove('is-open');
          trigger.classList.remove('is-active');
          if (typeof onSelect === 'function') onSelect(val);
        };
      });
    };

    // Close custom dropdowns on modal backdrop click
    modalContainer.addEventListener('click', () => {
      modalContainer.querySelectorAll('.cselect-menu.is-open').forEach((m) => m.classList.remove('is-open'));
      modalContainer.querySelectorAll('.cselect-trigger.is-active').forEach((t) => t.classList.remove('is-active'));
    });

    // Initialize Leave Type dropdown
    initCustomSelect('cselect-leave-type', 'leave-type', () => {});

    // Initialize Shift Coverage dropdown
    initCustomSelect('cselect-leave-portion', 'leave-portion', (val) => {
      const isCustom = val === 'CUSTOM_HOURS';
      if (customHoursGroup) {
        customHoursGroup.style.display = isCustom ? 'flex' : 'none';
      }
      if (isCustom) updateCustomHoursCalc();
      debouncedPreview();
    });

    // Custom Hours listeners
    customStartEl.addEventListener('input', () => {
      updateCustomHoursCalc();
      debouncedPreview();
    });
    customEndEl.addEventListener('input', () => {
      updateCustomHoursCalc();
    });

    // Initialize Duration Badge
    updateDurationBadge();

    // Submit handler
    document.getElementById('leave-management-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const targetStaffId = staffId || staffSelectEl?.value;
      const sDate = startDateEl.value;
      const eDate = endDateEl.value;
      const portion = portionInput.value || 'FULL_DAY';
      const leaveTypeVal = leaveTypeInput.value || 'SICK_LEAVE';

      if (!targetStaffId) {
        this.toast('Please select a specialist', 'error');
        return;
      }

      if (sDate > eDate) {
        this.toast('Start date cannot be after end date', 'error');
        return;
      }

      if (portion === 'CUSTOM_HOURS') {
        if (!customStartEl.value || !customEndEl.value) {
          this.toast('Please specify both Custom Start Time and Custom End Time', 'error');
          return;
        }
        if (customStartEl.value >= customEndEl.value) {
          this.toast('Custom start time must be before custom end time', 'error');
          return;
        }
      }

      const btnSubmit = document.getElementById('btn-submit-leave');
      if (btnSubmit) {
        btnSubmit.disabled = true;
        btnSubmit.innerHTML = `
          <div class="spinner-small" style="display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
          <span>Processing...</span>
        `;
      }

      try {
        const payload = {
          startDate: sDate,
          endDate: eDate,
          leaveType: leaveTypeVal,
          leavePortion: portion,
          reason: document.getElementById('leave-reason')?.value || undefined,
          notes: document.getElementById('leave-notes')?.value || undefined,
        };

        if (portion === 'CUSTOM_HOURS') {
          payload.customStartTime = customStartEl.value;
          payload.customEndTime = customEndEl.value;
        }

        const foundStaff = staffList.find((s) => s.id === targetStaffId);
        const stName = foundStaff ? foundStaff.name : (staffName || 'Specialist');

        const result = await ApiClient.markStaffAbsent(targetStaffId, payload);
        closeModal();

        // Immediate in-memory synchronization
        const foundSt = (this.app?.staffList || []).find((s) => s.id === targetStaffId);
        if (foundSt && result?.absence) {
          foundSt.absences = Array.isArray(foundSt.absences) ? foundSt.absences : [];
          foundSt.absences = foundSt.absences.filter((a) => a.id !== result.absence.id);
          foundSt.absences.unshift(result.absence);
          foundSt.operationalStatus = 'ON_LEAVE';
          foundSt.operationalStatusLabel = 'On Leave';
          foundSt.operationalStatusReason = result.absence.reason || 'Approved leave';
        }

        // Show result summary view
        this.showLeaveResultModal(stName, result);

        // Refresh dashboard and staff workspaces
        if (typeof this.app.loadData === 'function') {
          await this.app.loadData(true);
        } else if (typeof this.app.loadStaff === 'function') {
          await this.app.loadStaff();
        }
        if (typeof this.app.render === 'function') {
          this.app.render();
        }
      } catch (err) {
        this.toast(err.message || 'Failed to record leave', 'error');
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.innerHTML = '<span>🚫 Confirm & Process Leave</span>';
        }
      }
    });
  }

  /**
   * LEAVE RESULT SUMMARY MODAL (MATCHING LUXURY PALETTE)
   */
  showLeaveResultModal(staffName, result) {
    const modalContainer = document.getElementById('modal-container');
    if (!modalContainer) return;

    const rescheduledBookings = result?.rescheduledBookings || result?.details || [];
    const count = rescheduledBookings.length;
    const absence = result?.absence || result || {};
    const statusInfo = getUnifiedLeaveStatus(absence);

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="apply-leave-dialog" style="max-width: 540px;">
          <!-- Header -->
          <div class="ald-header">
            <div class="ald-header-left">
              <div class="ald-icon-badge" style="background: linear-gradient(135deg, rgba(52, 211, 153, 0.25) 0%, rgba(16, 185, 129, 0.15) 100%); border-color: rgba(52, 211, 153, 0.4);">
                <span>${statusInfo.icon}</span>
              </div>
              <div class="ald-title-wrap">
                <h3 class="ald-title">Leave Recorded & Confirmed</h3>
                <p class="ald-subtitle">Staff leave confirmed</p>
              </div>
            </div>
            <button class="ald-close-btn" id="btn-close-result-modal">&times;</button>
          </div>

          <div style="margin-bottom: 16px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 12px 14px;">
            <p style="color: #cbd5e1; font-size: 0.86rem; margin: 0 0 8px 0; line-height: 1.4;">
              Leave recorded for <strong>${staffName}</strong> from <strong>${formatDateFriendly(absence.startDate || absence.absenceDate)}</strong> to <strong>${formatDateFriendly(absence.endDate || absence.absenceDate)}</strong>.
            </p>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 0.76rem; color: #94a3b8;">Calendar Status:</span>
              <span class="badge" style="background: ${statusInfo.bg}; color: ${statusInfo.color}; border: 1px solid ${statusInfo.border}; font-weight: 700; font-size: 0.74rem;">
                ${statusInfo.title}
              </span>
            </div>
          </div>

          <!-- Reschedule Indicator -->
          ${count > 0 ? `
            <div style="background: rgba(52, 211, 153, 0.1); border: 1px solid rgba(52, 211, 153, 0.25); padding: 12px; border-radius: 12px; text-align: center; margin-bottom: 18px;">
              <div style="font-size: 1.35rem; font-weight: 800; color: #34d399;">${count}</div>
              <div style="font-size: 0.72rem; color: #34d399; text-transform: uppercase; font-weight: 600; margin-top: 2px;">Bookings Sent for Reschedule via WhatsApp</div>
            </div>

            <div style="margin-bottom: 18px;">
              <div style="font-size: 0.8rem; font-weight: 700; color: #fff; margin-bottom: 8px;">Rescheduled Appointments:</div>
              <div style="max-height: 160px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px;">
                ${rescheduledBookings.map((d) => `
                  <div style="padding: 8px 12px; background: rgba(0,0,0,0.3); border-radius: 8px; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                      <div style="font-weight: 700; color: #fff; font-size: 0.82rem;">#${d.appointmentNumber || ''} • ${d.customerName || 'Client'}</div>
                      <div style="font-size: 0.72rem; color: #94a3b8;">${d.customerPhone || 'Interactive WhatsApp notified'}</div>
                    </div>
                    <div>
                      <span class="badge" style="background: rgba(52, 211, 153, 0.15); color: #34d399; font-size: 0.72rem; font-weight: 700;">✓ WhatsApp Proposed</span>
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : `
            <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); padding: 12px; border-radius: 12px; text-align: center; margin-bottom: 18px;">
              <div style="font-size: 0.86rem; color: #94a3b8;">✅ No existing bookings were impacted.</div>
            </div>
          `}

          <div class="ald-footer">
            <button class="ald-btn-submit" id="btn-close-result-done" style="background: linear-gradient(135deg, #9333ea 0%, #c026d3 100%); border-color: rgba(168, 85, 247, 0.4);">Done</button>
          </div>
        </div>
      </div>
    `;

    const close = () => { modalContainer.innerHTML = ''; };
    document.getElementById('btn-close-result-modal')?.addEventListener('click', close);
    document.getElementById('btn-close-result-done')?.addEventListener('click', close);
  }

  /**
   * 2. LEAVE HISTORY & MANAGEMENT MODAL
   */
  async showLeaveHistoryModal(staffId, staffName) {
    const modalContainer = document.getElementById('modal-container');
    if (!modalContainer) return;

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content" style="max-width: 800px; max-height: 90vh; overflow-y: auto;">
          <div class="modal-header" style="margin-bottom: 16px;">
            <h3 style="display: flex; align-items: center; gap: 8px;">
              <span>🗓️</span>
              <span>Leave Records & History — ${staffName}</span>
            </h3>
            <button class="close-btn" id="btn-close-history-modal">&times;</button>
          </div>

          <div id="leave-history-content" style="min-height: 200px;">
            <div style="display: flex; align-items: center; justify-content: center; height: 160px; color: var(--text-secondary); gap: 10px;">
              <div class="spinner-small" style="width: 20px; height: 20px; border: 2px solid rgba(255,255,255,0.2); border-top-color: #A855F7; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
              <span>Loading leave records...</span>
            </div>
          </div>
        </div>
      </div>
    `;

    const closeHistory = () => { modalContainer.innerHTML = ''; };
    document.getElementById('btn-close-history-modal')?.addEventListener('click', closeHistory);

    try {
      const absences = await ApiClient.getStaffAbsences(staffId);
      const container = document.getElementById('leave-history-content');
      if (!container) return;

      if (!absences || absences.length === 0) {
        container.innerHTML = `
          <div style="text-align: center; padding: 40px 20px; background: rgba(255,255,255,0.02); border-radius: var(--radius-sm); border: 1px dashed var(--border-subtle);">
            <div style="font-size: 2.5rem; margin-bottom: 10px;">🌴</div>
            <div style="font-weight: 600; color: #fff; font-size: 1rem;">No leave records found</div>
            <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 4px;">This specialist has no recorded leave or absence entries.</div>
          </div>
        `;
        return;
      }

      container.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 12px;">
          ${absences.map((ab) => {
            const sDate = ab.startDate || ab.absenceDate;
            const eDate = ab.endDate || ab.absenceDate;
            const isMultiDay = sDate && eDate && sDate !== eDate;
            const dateDisplay = isMultiDay
              ? `${formatDateFriendly(sDate)} → ${formatDateFriendly(eDate)}`
              : formatDateWithWeekday(sDate);
            const durationText = calculateDurationDays(sDate, eDate);

            const statusInfo = getUnifiedLeaveStatus(ab);
            const isCancelled = ab.status === 'CANCELLED' || statusInfo.key === 'CANCELLED';
            const isPast = ab.isPast !== undefined ? ab.isPast : (() => {
              const today = new Date().toISOString().split('T')[0];
              const endIso = eDate ? (typeof eDate === 'string' ? eDate.split('T')[0] : new Date(eDate).toISOString().split('T')[0]) : '';
              return endIso < today;
            })();
            const isActive = !isCancelled;
            const canCancel = ab.canCancel !== undefined ? ab.canCancel : (isActive && !isPast);

            let statusClass = 'lhc-status-onleave';
            let statusTitle = 'On Leave';
            if (isCancelled) {
              statusClass = 'lhc-status-cancelled';
              statusTitle = 'Cancelled';
            } else if (isPast) {
              statusClass = 'lhc-status-completed';
              statusTitle = 'Completed';
            }

            const typeInfo = getLeaveTypeDetails(ab.leaveType, ab.reason);
            const portionInfo = getPortionDetails(ab.leavePortion, ab.customStartTime, ab.customEndTime);
            const appliedFormatted = formatAppliedTimestamp(ab.createdAt);

            const impactClass = 'lhc-impact-clean';
            const impactIcon = '✓';
            const impactMainText = `Staff Roster Blocked`;
            const impactTag = '(Protected)';

            const noteOrReason = ab.notes || ab.reason;

            return `
              <div class="leave-history-card">
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

                <!-- Middle Info Panel: Type, Shift, Applied Timestamp & Ref ID -->
                <div class="lhc-meta-panel">
                  <div class="lhc-meta-row">
                    <div class="lhc-meta-cell lhc-meta-left">
                      <span class="lhc-type-dot" style="color: ${typeInfo.color};">●</span>
                      <span class="lhc-meta-label">Type:</span>
                      <strong class="lhc-meta-type-val" style="color: ${typeInfo.color};">${typeInfo.label}</strong>
                    </div>
                    <div class="lhc-meta-cell lhc-meta-right">
                      <span class="lhc-meta-icon">🕒</span>
                      <span class="lhc-meta-label">Shift:</span>
                      <strong class="lhc-meta-shift-val">${portionInfo.label}</strong>
                    </div>
                  </div>
                  <div class="lhc-meta-row">
                    <div class="lhc-meta-cell lhc-meta-left">
                      <span class="lhc-meta-label">Applied:</span>
                      <span class="lhc-meta-applied-val">${appliedFormatted}</span>
                    </div>
                    <div class="lhc-meta-cell lhc-meta-right">
                      <span class="lhc-meta-label">Ref:</span>
                      <span class="lhc-meta-ref-val">#${ab.id.slice(0, 8)}</span>
                    </div>
                  </div>
                  ${noteOrReason ? `
                    <div class="lhc-meta-note-row">
                      <span class="lhc-meta-label">Note:</span>
                      <span class="lhc-meta-note-val">${noteOrReason}</span>
                    </div>
                  ` : ''}
                </div>

                <!-- Schedule Impact Pill -->
                <div class="lhc-impact-pill ${impactClass}">
                  <div class="lhc-impact-left">
                    <span class="lhc-impact-check">${impactIcon}</span>
                    <span class="lhc-impact-text">${impactMainText}</span>
                  </div>
                  <span class="lhc-impact-tag">${impactTag}</span>
                </div>

                <!-- Action Buttons: Details, Extend, Cancel Leave -->
                <div class="lhc-actions-row">
                  <button type="button" class="lhc-btn lhc-btn-details btn-view-leave-detail" data-absence-id="${ab.id}">
                    <span class="lhc-btn-icon">👁️</span>
                    <span>Details</span>
                  </button>
                  ${canCancel ? `
                    <button type="button" class="lhc-btn lhc-btn-extend btn-extend-leave" data-absence-id="${ab.id}" data-end-date="${eDate}">
                      <span class="lhc-btn-icon">📅</span>
                      <span>Extend</span>
                    </button>
                    <button type="button" class="lhc-btn lhc-btn-cancel btn-cancel-leave-action" data-absence-id="${ab.id}">
                      <span class="lhc-btn-icon">✕</span>
                      <span>Cancel Leave</span>
                    </button>
                  ` : (isActive && isPast ? `
                    <span class="lhc-past-badge">Past Record</span>
                  ` : '')}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;

      // Event Listeners for History items
      container.querySelectorAll('.btn-view-leave-detail').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const abId = e.currentTarget.getAttribute('data-absence-id');
          const ab = absences.find((a) => a.id === abId);
          if (ab) this.showLeaveDetailModal(ab, staffName, staffId);
        });
      });

      container.querySelectorAll('.btn-extend-leave').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const abId = e.currentTarget.getAttribute('data-absence-id');
          const ab = absences.find((a) => a.id === abId);
          if (ab) {
            closeHistory();
            this.showExtendLeaveModal(staffId, staffName, ab);
          }
        });
      });

      container.querySelectorAll('.btn-cancel-leave-action').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          const abId = e.currentTarget.getAttribute('data-absence-id');
          if (confirm(`Cancel leave for ${staffName}? Specialist availability will be restored for unblocked intervals. Existing reassigned appointments will not automatically revert.`)) {
            try {
              await ApiClient.cancelStaffAbsence(staffId, abId);
              this.toast(`Leave cancelled for ${staffName}`, 'success');
              closeHistory();
              if (typeof this.app.loadData === 'function') await this.app.loadData(true);
              if (typeof this.app.render === 'function') this.app.render();
            } catch (err) {
              this.toast(err.message || 'Failed to cancel leave', 'error');
            }
          }
        });
      });

    } catch (err) {
      const container = document.getElementById('leave-history-content');
      if (container) {
        container.innerHTML = `
          <div style="color: #fca5a5; padding: 20px; text-align: center;">
            ⚠️ Failed to load leave records: ${err.message}
          </div>
        `;
      }
    }
  }

  /**
   * 3. EXTEND LEAVE MODAL
   */
  showExtendLeaveModal(staffId, staffName, absence) {
    const modalContainer = document.getElementById('modal-container');
    if (!modalContainer) return;

    const currentEndDate = absence.endDate || absence.absenceDate;
    const currentEndObj = new Date(currentEndDate);
    currentEndObj.setDate(currentEndObj.getDate() + 1);
    const defaultNewEnd = currentEndObj.toISOString().split('T')[0];

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content" style="max-width: 520px;">
          <div class="modal-header">
            <h3 style="display: flex; align-items: center; gap: 8px;">
              <span>⏩</span>
              <span>Extend Leave — ${staffName}</span>
            </h3>
            <button class="close-btn" id="btn-close-extend-modal">&times;</button>
          </div>
          <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 14px;">
            Current Leave Period: <strong>${formatDateFriendly(absence.startDate || absence.absenceDate)}</strong> to <strong>${formatDateFriendly(currentEndDate)}</strong>.
          </p>

          <form id="extend-leave-form">
            <div class="form-group" style="margin-bottom: 14px;">
              <label style="font-weight: 600;">New End Date *</label>
              <input type="date" class="form-control" id="extend-new-end-date" value="${defaultNewEnd}" min="${defaultNewEnd}" required />
            </div>

            <!-- Live Incremental Impact Preview Box -->
            <div id="extend-impact-preview-box" style="background: rgba(0,0,0,0.25); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 12px; margin-bottom: 16px;">
              <div style="display: flex; align-items: center; gap: 8px; font-size: 0.82rem; color: var(--text-secondary);">
                <div class="spinner-small" style="display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.2); border-top-color: #A855F7; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
                <span>Calculating incremental impact...</span>
              </div>
            </div>

            <div style="background: rgba(139, 61, 255,0.08); border: 1px solid rgba(139, 61, 255,0.2); border-radius: var(--radius-sm); padding: 10px 14px; margin-bottom: 16px; font-size: 0.78rem; color: #a5b4fc;">
              ℹ️ Incremental date processing: Only newly added dates will be processed for availability overrides & reassignments. Existing leave dates remain untouched.
            </div>

            <div style="display: flex; gap: 10px; justify-content: flex-end;">
              <button type="button" class="btn btn-secondary" id="btn-cancel-extend">Cancel</button>
              <button type="submit" class="btn btn-primary" id="btn-submit-extend" style="gap: 6px;">
                <span>⏩ Confirm Extension</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    `;

    const close = () => { modalContainer.innerHTML = ''; };
    document.getElementById('btn-close-extend-modal')?.addEventListener('click', close);
    document.getElementById('btn-cancel-extend')?.addEventListener('click', close);

    const newEndInput = document.getElementById('extend-new-end-date');

    // Incremental Preview loader
    const loadExtendPreview = async (newEndDateVal) => {
      const previewBox = document.getElementById('extend-impact-preview-box');
      if (!previewBox) return;

      // Start date for incremental calculation is day after current end date
      const queryParams = {
        startDate: defaultNewEnd,
        endDate: newEndDateVal,
        leavePortion: absence.leavePortion || 'FULL_DAY',
      };

      try {
        const preview = await ApiClient.previewStaffAbsence(staffId, queryParams);
        if (!previewBox) return;

        const total = preview.conflicts ? preview.conflicts.length : (preview.affectedBookingsCount || 0);
        previewBox.innerHTML = `
          <div style="font-size: 0.82rem; color: #fff;">
            <div>Incremental Dates: <strong>${formatDateFriendly(defaultNewEnd)}</strong> ${defaultNewEnd !== newEndDateVal ? `→ <strong>${formatDateFriendly(newEndDateVal)}</strong>` : ''}</div>
            <div style="color: ${total > 0 ? '#fb7185' : '#34d399'}; margin-top: 4px;">
              ${total > 0 ? `⚡ ${total} booking(s) affected on newly added dates` : '✅ 0 bookings affected on newly added dates'}
            </div>
          </div>
        `;
      } catch (err) {
        if (previewBox) {
          previewBox.innerHTML = `<div style="font-size: 0.8rem; color: #fca5a5;">⚠️ Could not fetch incremental preview: ${err.message}</div>`;
        }
      }
    };

    loadExtendPreview(defaultNewEnd);
    newEndInput.addEventListener('change', (e) => loadExtendPreview(e.target.value));

    // Submit Extend Leave Form
    document.getElementById('extend-leave-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const newEndDate = newEndInput.value;

      if (newEndDate <= currentEndDate) {
        this.toast('New end date must be after current end date', 'error');
        return;
      }

      const btn = document.getElementById('btn-submit-extend');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>⏳ Extending Leave...</span>';
      }

      try {
        const result = await ApiClient.extendStaffAbsence(staffId, absence.id, { newEndDate });
        close();
        this.toast(`Leave extended to ${formatDateFriendly(newEndDate)} for ${staffName}`, 'success');
        this.showLeaveResultModal(staffName, result);

        if (typeof this.app.loadData === 'function') await this.app.loadData(true);
        if (typeof this.app.render === 'function') this.app.render();
      } catch (err) {
        this.toast(err.message || 'Failed to extend leave', 'error');
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<span>⏩ Confirm Extension</span>';
        }
      }
    });
  }

  /**
   * 4. LEAVE DETAIL VIEW MODAL
   */
  showLeaveDetailModal(absence, staffName, staffId) {
    const modalContainer = document.getElementById('modal-container');
    if (!modalContainer) return;

    const sDate = absence.startDate || absence.absenceDate;
    const eDate = absence.endDate || absence.absenceDate;
    const isMultiDay = sDate && eDate && sDate !== eDate;
    const dateDisplay = isMultiDay
      ? `${formatDateFriendly(sDate)} → ${formatDateFriendly(eDate)}`
      : formatDateWithWeekday(sDate);
    const durationText = calculateDurationDays(sDate, eDate);

    const statusInfo = getUnifiedLeaveStatus(absence);
    const isCancelled = absence.status === 'CANCELLED' || statusInfo.key === 'CANCELLED';
    const isPast = absence.isPast !== undefined ? absence.isPast : (() => {
      const today = new Date().toISOString().split('T')[0];
      const endIso = eDate ? (typeof eDate === 'string' ? eDate.split('T')[0] : new Date(eDate).toISOString().split('T')[0]) : '';
      return endIso < today;
    })();
    const isActive = !isCancelled;
    const canCancel = absence.canCancel !== undefined ? absence.canCancel : (isActive && !isPast);

    let statusClass = 'lhc-status-active';
    let statusTitle = '🟢 On Leave';
    if (isCancelled) {
      statusClass = 'lhc-status-cancelled';
      statusTitle = '❌ Cancelled';
    } else if (isPast) {
      statusClass = 'lhc-status-completed';
      statusTitle = '⚪ Completed';
    }

    const typeInfo = getLeaveTypeDetails(absence.leaveType, absence.reason);
    const portionInfo = getPortionDetails(absence.leavePortion, absence.customStartTime, absence.customEndTime);
    const appliedFormatted = formatAppliedTimestamp(absence.createdAt);

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="leave-detail-dialog">
          <!-- Header -->
          <div class="ld-header">
            <div class="ld-header-left">
              <div class="ld-avatar">${staffName ? staffName.charAt(0).toUpperCase() : 'S'}</div>
              <div class="ld-title-group">
                <div class="ld-title-row">
                  <h3>${staffName}</h3>
                  <span class="lhc-status-badge ${statusClass}">
                    <span class="lhc-status-dot"></span>
                    <span>${statusTitle}</span>
                  </span>
                </div>
                <div class="ld-title-sub">${dateDisplay} · <span class="ld-span-pill">${durationText}</span></div>
              </div>
            </div>
            <button class="ld-close-btn" id="btn-close-detail-modal" title="Close dialog">&times;</button>
          </div>

          <!-- Compact 2x2 Metadata Grid -->
          <div class="ld-matrix-grid">
            <div class="ld-matrix-item">
              <div class="ld-matrix-label">
                <span class="ld-matrix-icon">📅</span>
                <span>Date Period</span>
              </div>
              <div class="ld-matrix-val" title="${formatDateFriendly(sDate)}${isMultiDay ? ` → ${formatDateFriendly(eDate)}` : ''}">
                ${formatDateFriendly(sDate)}${isMultiDay ? ` → ${formatDateFriendly(eDate)}` : ''}
              </div>
            </div>

            <div class="ld-matrix-item">
              <div class="ld-matrix-label">
                <span class="ld-matrix-icon">${portionInfo.icon}</span>
                <span>Shift Timing</span>
              </div>
              <div class="ld-matrix-val">${portionInfo.label}</div>
            </div>

            <div class="ld-matrix-item">
              <div class="ld-matrix-label">
                <span class="ld-matrix-icon">${typeInfo.icon}</span>
                <span>Leave Category</span>
              </div>
              <div class="ld-matrix-val" style="color: ${typeInfo.color || '#fff'};">
                ${typeInfo.label}
              </div>
            </div>

            <div class="ld-matrix-item">
              <div class="ld-matrix-label">
                <span class="ld-matrix-icon">🕒</span>
                <span>Applied On</span>
              </div>
              <div class="ld-matrix-val">${appliedFormatted}</div>
            </div>
          </div>

          <!-- Notes & Reason Card (if present) -->
          ${(absence.notes || absence.reason) ? `
            <div class="ld-notes-card">
              <div class="ld-notes-label">
                <span>💬</span> <span>Reason:</span>
              </div>
              <div class="ld-notes-text">
                ${absence.notes || absence.reason}
              </div>
            </div>
          ` : ''}

          <!-- Client Booking Impact Section (Compact) -->
          <div class="ld-impact-section">
            <div class="ld-clean-banner">
              <span class="ld-clean-icon">✨</span>
              <div class="ld-clean-body">
                <span class="ld-clean-title">Automated Booking Protection Active</span>
                <span class="ld-clean-sep">·</span>
                <span class="ld-clean-desc">Staff roster blocked. Overlapping bookings are automatically offered reschedule proposals via WhatsApp.</span>
              </div>
            </div>
          </div>

          <!-- Modal Footer Actions -->
          <div class="ld-footer">
            <div class="ld-footer-ref">
              Ref: #${absence.id.slice(0, 10)}
            </div>
            <div class="ld-footer-actions">
              ${canCancel && staffId ? `
                <button type="button" class="btn-ld-action btn-ld-extend" id="btn-detail-extend">
                  <span class="btn-ld-icon">📅</span>
                  <span>Extend Date</span>
                </button>
                <button type="button" class="btn-ld-action btn-ld-cancel" id="btn-detail-cancel">
                  <span class="btn-ld-icon">✕</span>
                  <span>Cancel Leave</span>
                </button>
              ` : ''}
              <button type="button" class="btn-ld-action btn-ld-close" id="btn-close-detail-done">Close</button>
            </div>
          </div>
        </div>
      </div>
    `;

    const close = () => { modalContainer.innerHTML = ''; };
    document.getElementById('btn-close-detail-modal')?.addEventListener('click', close);
    document.getElementById('btn-close-detail-done')?.addEventListener('click', close);

    if (canCancel && staffId) {
      document.getElementById('btn-detail-extend')?.addEventListener('click', () => {
        close();
        this.showExtendLeaveModal(staffId, staffName, absence);
      });

      document.getElementById('btn-detail-cancel')?.addEventListener('click', async () => {
        if (confirm(`Cancel leave for ${staffName}? Specialist availability will be restored for unblocked intervals.`)) {
          try {
            await ApiClient.cancelStaffAbsence(staffId, absence.id);
            this.toast(`Leave cancelled for ${staffName}`, 'success');
            close();
            if (typeof this.app.loadData === 'function') await this.app.loadData(true);
            if (typeof this.app.render === 'function') this.app.render();
          } catch (err) {
            this.toast(err.message || 'Failed to cancel leave', 'error');
          }
        }
      });
    }
  }
}
