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
   * 1. CREATE / MARK LEAVE FORM MODAL
   */
  showCreateLeaveModal(staffId, staffName, defaultDate = null) {
    const modalContainer = document.getElementById('modal-container');
    if (!modalContainer) return;

    const initialDate = defaultDate || this.app.selectedDate || new Date().toISOString().split('T')[0];
    const staffList = this.app.staffList || [];

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content" style="max-width: 580px; max-height: 90vh; overflow-y: auto; padding: 24px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
            <div>
              <h3 style="font-size: 1.2rem; font-weight: 800; color: #fff; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
                <span>🗓️ Record Specialist Leave</span>
              </h3>
              <p style="color: var(--text-secondary); font-size: 0.82rem; margin: 0;">Schedule leave or mark absence for a specialist.</p>
            </div>
            <button class="close-btn" id="btn-close-leave-modal" style="background: rgba(255,255,255,0.06); border: 1px solid var(--border-subtle); border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--text-secondary); font-size: 1.1rem;">&times;</button>
          </div>

          <form id="leave-management-form">
            <!-- Stylist Selection -->
            <div class="form-group" style="margin-bottom: 14px;">
              <label style="font-weight: 600; font-size: 0.82rem; color: #e2e8f0; display: block; margin-bottom: 4px;">Specialist *</label>
              <select class="form-control" id="leave-staff-id" ${staffId ? 'disabled' : 'required'}>
                ${staffList.map((st) => `
                  <option value="${st.id}" ${st.id === staffId ? 'selected' : ''}>
                    ${st.name || 'Specialist'} (${st.phone || 'No phone'})
                  </option>
                `).join('')}
              </select>
            </div>

            <!-- Date Range -->
            <div class="leave-form-row">
              <div class="form-group" style="margin: 0;">
                <label style="font-weight: 600; font-size: 0.82rem; color: #e2e8f0; display: block; margin-bottom: 4px;">Start Date *</label>
                <input type="date" class="form-control" id="leave-start-date" value="${initialDate}" required />
              </div>
              <div class="form-group" style="margin: 0;">
                <label style="font-weight: 600; font-size: 0.82rem; color: #e2e8f0; display: block; margin-bottom: 4px;">End Date *</label>
                <input type="date" class="form-control" id="leave-end-date" value="${initialDate}" required />
              </div>
            </div>

            <!-- Leave Type & Portion -->
            <div class="leave-form-row">
              <div class="form-group" style="margin: 0;">
                <label style="font-weight: 600; font-size: 0.82rem; color: #e2e8f0; display: block; margin-bottom: 4px;">Leave Type *</label>
                <select class="form-control" id="leave-type" required>
                  <option value="SICK_LEAVE">🤒 Sick Leave</option>
                  <option value="CASUAL_LEAVE">🌴 Casual Leave</option>
                  <option value="EMERGENCY_LEAVE">🚨 Emergency Leave</option>
                  <option value="UNPAID_LEAVE">📄 Unpaid Leave</option>
                  <option value="OTHER">📝 Other</option>
                </select>
              </div>
              <div class="form-group" style="margin: 0;">
                <label style="font-weight: 600; font-size: 0.82rem; color: #e2e8f0; display: block; margin-bottom: 4px;">Leave Portion *</label>
                <select class="form-control" id="leave-portion" required style="text-overflow: ellipsis;">
                  <option value="FULL_DAY">Full Day (Entire Shift)</option>
                  <option value="FIRST_HALF">First Half (Morning)</option>
                  <option value="SECOND_HALF">Second Half (Afternoon)</option>
                  <option value="CUSTOM_HOURS">Custom Hours</option>
                </select>
              </div>
            </div>

            <!-- Custom Hours Input (Conditional) -->
            <div id="leave-custom-hours-group" style="display: none; background: rgba(139, 61, 255,0.08); border: 1px solid rgba(139, 61, 255,0.2); border-radius: var(--radius-sm); padding: 12px; margin-bottom: 14px;">
              <div style="font-size: 0.8rem; font-weight: 600; color: #A855F7; margin-bottom: 8px;">⏰ Custom Hours Window:</div>
              <div class="leave-form-row" style="margin-bottom: 0;">
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 0.78rem;">Start Time</label>
                  <input type="time" class="form-control" id="leave-custom-start-time" value="09:00" />
                </div>
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 0.78rem;">End Time</label>
                  <input type="time" class="form-control" id="leave-custom-end-time" value="13:00" />
                </div>
              </div>
            </div>

            <!-- Reason & Notes -->
            <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px;">
              <div class="form-group" style="margin: 0;">
                <label style="font-size: 0.82rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">Reason (Optional)</label>
                <input type="text" class="form-control" id="leave-reason" placeholder="e.g. Medical checkup" />
              </div>
              <div class="form-group" style="margin: 0;">
                <label style="font-size: 0.82rem; color: var(--text-secondary); display: block; margin-bottom: 4px;">Internal Notes (Optional)</label>
                <input type="text" class="form-control" id="leave-notes" placeholder="e.g. Informed manager in advance" />
              </div>
            </div>

            <!-- Live Impact Preview Box -->
            <div id="leave-impact-preview-box" style="background: rgba(0,0,0,0.25); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 12px 14px; margin-bottom: 16px;">
              <div style="display: flex; align-items: center; gap: 8px; font-size: 0.82rem; color: var(--text-secondary);">
                <div class="spinner-small" style="display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.2); border-top-color: #A855F7; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
                <span>Fetching live impact preview from server...</span>
              </div>
            </div>

            <!-- Operational Warning Banner -->
            <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: var(--radius-sm); padding: 10px 14px; margin-bottom: 16px; font-size: 0.78rem; color: #fca5a5; line-height: 1.4;">
              ⚠️ <strong>Auto-Reassignment:</strong> Affected bookings will be reassigned to available qualified staff. Customers will receive interactive WhatsApp notifications.
            </div>

            <div style="display: flex; gap: 10px; justify-content: flex-end; align-items: center; border-top: 1px solid var(--border-subtle); padding-top: 14px;">
              <button type="button" class="btn btn-secondary btn-sm" id="btn-cancel-leave-modal" style="padding: 8px 16px;">Cancel</button>
              <button type="submit" class="btn btn-danger btn-sm" id="btn-submit-leave" style="gap: 6px; padding: 8px 20px; font-weight: 700;">
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
    const portionEl = document.getElementById('leave-portion');
    const customHoursGroup = document.getElementById('leave-custom-hours-group');
    const customStartEl = document.getElementById('leave-custom-start-time');
    const customEndEl = document.getElementById('leave-custom-end-time');
    const staffSelectEl = document.getElementById('leave-staff-id');

    // Auto-sync endDate = startDate if endDate < startDate
    startDateEl.addEventListener('change', () => {
      if (!endDateEl.value || endDateEl.value < startDateEl.value) {
        endDateEl.value = startDateEl.value;
      }
      triggerPreview();
    });
    endDateEl.addEventListener('change', () => {
      if (endDateEl.value < startDateEl.value) {
        startDateEl.value = endDateEl.value;
      }
      triggerPreview();
    });

    portionEl.addEventListener('change', () => {
      const isCustom = portionEl.value === 'CUSTOM_HOURS';
      customHoursGroup.style.display = isCustom ? 'block' : 'none';
      triggerPreview();
    });

    customStartEl.addEventListener('change', triggerPreview);
    customEndEl.addEventListener('change', triggerPreview);
    if (!staffId && staffSelectEl) {
      staffSelectEl.addEventListener('change', triggerPreview);
    }

    // Live Impact Preview Function
    async function triggerPreview() {
      const targetStaffId = staffId || staffSelectEl?.value;
      const previewBox = document.getElementById('leave-impact-preview-box');
      if (!targetStaffId || !previewBox) return;

      const sDate = startDateEl.value;
      const eDate = endDateEl.value;
      const portion = portionEl.value;
      const cStart = portion === 'CUSTOM_HOURS' ? customStartEl.value : undefined;
      const cEnd = portion === 'CUSTOM_HOURS' ? customEndEl.value : undefined;

      previewBox.innerHTML = `
        <div style="display: flex; align-items: center; gap: 8px; font-size: 0.82rem; color: var(--text-secondary);">
          <div class="spinner-small" style="display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.2); border-top-color: #A855F7; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
          <span>Calculating impact for ${formatDateFriendly(sDate)} ${sDate !== eDate ? `→ ${formatDateFriendly(eDate)}` : ''}...</span>
        </div>
      `;

      try {
        const queryParams = { startDate: sDate, endDate: eDate, leavePortion: portion };
        if (cStart) queryParams.customStartTime = cStart;
        if (cEnd) queryParams.customEndTime = cEnd;

        const preview = await ApiClient.previewStaffAbsence(targetStaffId, queryParams);

        if (!previewBox) return;
        const total = preview.affectedBookingsCount || 0;
        const reassignable = preview.canAutoReassignCount || 0;
        const unresolvable = preview.unresolvableCount || 0;

        if (total === 0) {
          previewBox.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px; color: #34d399; font-size: 0.82rem;">
              <span style="font-size: 1.1rem;">✅</span>
              <span>No booking conflicts found for this date/period.</span>
            </div>
          `;
        } else {
          previewBox.innerHTML = `
            <div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <div style="font-weight: 700; font-size: 0.85rem; color: #fb7185;">
                  ⚠️ Impact: ${total} Booking${total > 1 ? 's' : ''} Affected
                </div>
                <div style="display: flex; gap: 6px;">
                  <span class="badge" style="background: rgba(52, 211, 153, 0.15); color: #34d399; font-size: 0.65rem;">
                    ${reassignable} Auto-Reassignable
                  </span>
                  ${unresolvable > 0 ? `
                    <span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171; font-size: 0.65rem;">
                      ${unresolvable} No Replacement
                    </span>
                  ` : ''}
                </div>
              </div>
              <div style="max-height: 140px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; font-size: 0.78rem;">
                ${(preview.details || []).map((d) => `
                  <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: rgba(255,255,255,0.04); border-radius: 6px;">
                    <div>
                      <span style="font-weight: 600; color: #fff;">#${d.appointmentNumber || ''}</span>
                      <span style="color: var(--text-secondary);"> (${d.serviceName || 'Service'}) - ${d.customerName || 'Client'}</span>
                    </div>
                    <span style="font-weight: 600; color: ${d.willReassign ? '#34d399' : '#fb7185'};">
                      ${d.willReassign ? `→ ${d.potentialReplacement?.name || 'Available Staff'}` : '⚠️ No Replacement'}
                    </span>
                  </div>
                `).join('')}
              </div>
            </div>
          `;
        }
      } catch (err) {
        if (previewBox) {
          const rawMsg = Array.isArray(err.message) ? err.message.join(', ') : (err.message || 'Unable to fetch preview');
          previewBox.innerHTML = `
            <div style="font-size: 0.8rem; color: #fca5a5; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.25); padding: 8px 12px; border-radius: var(--radius-sm);">
              ⚠️ <strong>Impact Preview:</strong> ${rawMsg}
            </div>
          `;
        }
      }
    }

    // Run initial preview
    triggerPreview();

    // Submit handler
    document.getElementById('leave-management-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const targetStaffId = staffId || staffSelectEl?.value;
      const sDate = startDateEl.value;
      const eDate = endDateEl.value;
      const portion = portionEl.value;

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
        btnSubmit.innerHTML = '<span>⏳ Processing Leave...</span>';
      }

      try {
        const payload = {
          startDate: sDate,
          endDate: eDate,
          leaveType: document.getElementById('leave-type').value,
          leavePortion: portion,
          reason: document.getElementById('leave-reason').value || undefined,
          notes: document.getElementById('leave-notes').value || undefined,
        };

        if (portion === 'CUSTOM_HOURS') {
          payload.customStartTime = customStartEl.value;
          payload.customEndTime = customEndEl.value;
        }

        const targetStaff = staffList.find((s) => s.id === targetStaffId);
        const stName = targetStaff ? targetStaff.name : (staffName || 'Specialist');

        const result = await ApiClient.markStaffAbsent(targetStaffId, payload);
        closeModal();

        // Show result summary view
        this.showLeaveResultModal(stName, result);

        // Refresh dashboard state
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
   * LEAVE RESULT SUMMARY MODAL
   */
  showLeaveResultModal(staffName, result) {
    const modalContainer = document.getElementById('modal-container');
    if (!modalContainer) return;

    const summary = result?.reassignmentSummary || { total: 0, reassigned: 0, unresolvable: 0, details: [] };
    const absence = result?.absence || result || {};
    const statusInfo = getUnifiedLeaveStatus(absence);

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content" style="max-width: 540px;">
          <div class="modal-header">
            <h3 style="display: flex; align-items: center; gap: 8px;">
              <span>${statusInfo.icon}</span>
              <span>Leave Recorded — Operational Summary</span>
            </h3>
            <button class="close-btn" id="btn-close-result-modal">&times;</button>
          </div>
          <div style="margin-bottom: 14px;">
            <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 8px;">
              Leave configured for <strong>${staffName}</strong> from <strong>${formatDateFriendly(absence.startDate || absence.absenceDate)}</strong> to <strong>${formatDateFriendly(absence.endDate || absence.absenceDate)}</strong>.
            </p>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 0.78rem; color: var(--text-muted);">Leave Status:</span>
              <span class="badge" style="background: ${statusInfo.bg}; color: ${statusInfo.color}; border: 1px solid ${statusInfo.border}; font-weight: 700; font-size: 0.75rem;">
                ${statusInfo.title}
              </span>
            </div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 18px;">
            <div style="background: rgba(255,255,255,0.05); padding: 12px; border-radius: var(--radius-sm); text-align: center;">
              <div style="font-size: 1.3rem; font-weight: 700; color: #fff;">${summary.total || 0}</div>
              <div style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase;">Affected</div>
            </div>
            <div style="background: rgba(52, 211, 153, 0.1); border: 1px solid rgba(52, 211, 153, 0.2); padding: 12px; border-radius: var(--radius-sm); text-align: center;">
              <div style="font-size: 1.3rem; font-weight: 700; color: #34d399;">${summary.reassigned || 0}</div>
              <div style="font-size: 0.72rem; color: #34d399; text-transform: uppercase;">Reassigned</div>
            </div>
            <div style="background: rgba(251, 113, 133, 0.1); border: 1px solid rgba(251, 113, 133, 0.2); padding: 12px; border-radius: var(--radius-sm); text-align: center;">
              <div style="font-size: 1.3rem; font-weight: 700; color: #fb7185;">${summary.unresolvable || 0}</div>
              <div style="font-size: 0.72rem; color: #fb7185; text-transform: uppercase;">Unresolved</div>
            </div>
          </div>

          ${(summary.details && summary.details.length > 0) ? `
            <div style="margin-bottom: 18px;">
              <div style="font-size: 0.8rem; font-weight: 600; color: #fff; margin-bottom: 8px;">Reassignment Details:</div>
              <div style="max-height: 180px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; font-size: 0.8rem;">
                ${summary.details.map((d) => `
                  <div style="padding: 8px 12px; background: rgba(0,0,0,0.25); border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                      <div style="font-weight: 600; color: #fff;">#${d.appointmentNumber || ''} • ${d.customerName || 'Client'}</div>
                      <div style="font-size: 0.72rem; color: var(--text-secondary);">${d.customerPhone || 'Interactive WhatsApp notified'}</div>
                    </div>
                    <div>
                      ${d.outcome === 'AUTO_ASSIGNED' ? `
                        <span class="badge" style="background: rgba(52, 211, 153, 0.15); color: #34d399; font-size: 0.7rem;">Auto-Reassigned</span>
                      ` : `
                        <span class="badge" style="background: rgba(251, 113, 133, 0.15); color: #fb7185; font-size: 0.7rem;">⚠️ No Replacement</span>
                      `}
                    </div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}

          <div style="display: flex; justify-content: flex-end;">
            <button class="btn btn-primary" id="btn-close-result-done">Done</button>
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

            const affectedCount = ab.affectedBookingsCount || 0;
            const reassignedCount = ab.reassignedCount || 0;
            const unresolvedCount = ab.unresolvableCount || 0;

            let impactClass = 'lhc-impact-clean';
            let impactIcon = '✓';
            let impactMainText = `Clean Schedule — 0 client bookings affected`;
            let impactTag = '(Roster blocked)';

            if (affectedCount === 0) {
              impactClass = 'lhc-impact-clean';
              impactIcon = '✓';
              impactMainText = `Clean Schedule — 0 client bookings affected`;
              impactTag = '(Roster blocked)';
            } else if (unresolvedCount > 0) {
              impactClass = 'lhc-impact-conflict';
              impactIcon = '⚠️';
              impactMainText = `Schedule Conflict — ${affectedCount} booking${affectedCount > 1 ? 's' : ''} affected`;
              impactTag = `(${unresolvedCount} need action)`;
            } else {
              impactClass = 'lhc-impact-reassigned';
              impactIcon = '🔄';
              impactMainText = `${affectedCount} booking${affectedCount > 1 ? 's' : ''} auto-reassigned`;
              impactTag = '(Protected)';
            }

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

        const total = preview.affectedBookingsCount || 0;
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

    const reassignments = absence.reassignments || [];
    const affectedCount = absence.affectedBookingsCount || 0;
    const reassignedCount = absence.reassignedCount || 0;
    const unresolvedCount = absence.unresolvableCount || 0;

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="leave-detail-dialog">
          <!-- Header -->
          <div class="ld-header">
            <div class="ld-header-left">
              <div class="ld-avatar">${staffName ? staffName.charAt(0).toUpperCase() : 'S'}</div>
              <div class="ld-title-group">
                <h3>${staffName} · Leave Details</h3>
                <div class="ld-title-sub">${dateDisplay} (${durationText})</div>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 10px;">
              <span class="lhc-status-badge ${statusClass}">
                <span class="lhc-status-dot"></span>
                <span>${statusTitle}</span>
              </span>
              <button class="ld-close-btn" id="btn-close-detail-modal" title="Close dialog">&times;</button>
            </div>
          </div>

          <!-- 4-Card Overview Matrix -->
          <div class="ld-matrix-grid">
            <div class="ld-matrix-card">
              <div class="ld-matrix-card-header">
                <span>📅</span> <span>Leave Period</span>
              </div>
              <div class="ld-matrix-val">${formatDateFriendly(sDate)}${isMultiDay ? ` → ${formatDateFriendly(eDate)}` : ''}</div>
              <div class="ld-matrix-sub">${durationText} · ${isMultiDay ? 'Multi-day span' : formatDateWithWeekday(sDate)}</div>
            </div>

            <div class="ld-matrix-card">
              <div class="ld-matrix-card-header">
                <span>${portionInfo.icon}</span> <span>Shift & Timing</span>
              </div>
              <div class="ld-matrix-val">${portionInfo.label}</div>
              <div class="ld-matrix-sub">${portionInfo.fullLabel} (${portionInfo.shiftText})</div>
            </div>

            <div class="ld-matrix-card">
              <div class="ld-matrix-card-header">
                <span>${typeInfo.icon}</span> <span>Leave Category</span>
              </div>
              <div class="ld-matrix-val" style="color: ${typeInfo.color};">${typeInfo.label}</div>
              <div class="ld-matrix-sub">Type: ${absence.leaveType ? absence.leaveType.replace('_', ' ') : 'General'}</div>
            </div>

            <div class="ld-matrix-card">
              <div class="ld-matrix-card-header">
                <span>🕒</span> <span>Application Audit</span>
              </div>
              <div class="ld-matrix-val">${appliedFormatted}</div>
              <div class="ld-matrix-sub">Recorded via Salon Admin Portal</div>
            </div>
          </div>

          <!-- Notes & Reason Card (if present) -->
          ${(absence.notes || absence.reason) ? `
            <div class="ld-notes-card">
              <div class="ld-notes-label">
                <span>💬</span> <span>Reason & Justification</span>
              </div>
              <div class="ld-notes-text">
                ${absence.notes || absence.reason}
              </div>
            </div>
          ` : ''}

          <!-- Client Booking Impact Section -->
          <div class="ld-impact-section">
            <div class="ld-impact-header">
              <h4>Client Booking Impact</h4>
              ${affectedCount > 0 ? `
                <span style="font-size: 0.75rem; color: var(--text-secondary);">${affectedCount} client appointment${affectedCount > 1 ? 's' : ''} overlapped</span>
              ` : ''}
            </div>

            ${affectedCount === 0 ? `
              <div class="ld-clean-banner">
                <div class="ld-clean-icon">✨</div>
                <div>
                  <div class="ld-clean-title">Clean Schedule — Zero Customer Disruption</div>
                  <div class="ld-clean-desc">
                    No client appointments were booked with ${staffName} during this leave window. The salon calendar was cleanly blocked with zero customer friction.
                  </div>
                </div>
              </div>
            ` : `
              <!-- KPI Summary Counters -->
              <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 12px;">
                <div style="background: rgba(255,255,255,0.04); padding: 10px 12px; border-radius: 10px; text-align: center; border: 1px solid rgba(255,255,255,0.08);">
                  <div style="font-size: 1.25rem; font-weight: 700; color: #fff;">${affectedCount}</div>
                  <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Total Affected</div>
                </div>
                <div style="background: rgba(52, 211, 153, 0.08); padding: 10px 12px; border-radius: 10px; text-align: center; border: 1px solid rgba(52, 211, 153, 0.25);">
                  <div style="font-size: 1.25rem; font-weight: 700; color: #34d399;">${reassignedCount}</div>
                  <div style="font-size: 0.7rem; color: #34d399; text-transform: uppercase;">Auto-Reassigned</div>
                </div>
                <div style="background: ${unresolvedCount > 0 ? 'rgba(251, 113, 133, 0.12)' : 'rgba(255,255,255,0.04)'}; padding: 10px 12px; border-radius: 10px; text-align: center; border: 1px solid ${unresolvedCount > 0 ? 'rgba(251, 113, 133, 0.3)' : 'rgba(255,255,255,0.08)'};">
                  <div style="font-size: 1.25rem; font-weight: 700; color: ${unresolvedCount > 0 ? '#fb7185' : '#fff'};">${unresolvedCount}</div>
                  <div style="font-size: 0.7rem; color: ${unresolvedCount > 0 ? '#fb7185' : 'var(--text-muted)'}; text-transform: uppercase;">Action Needed</div>
                </div>
              </div>

              <!-- Reassignment List -->
              ${reassignments.length === 0 ? `
                <div style="font-size: 0.8rem; color: var(--text-muted); padding: 12px; background: rgba(0,0,0,0.2); border-radius: 10px; text-align: center;">
                  No individual appointment reassignment logs found.
                </div>
              ` : `
                <div style="max-height: 230px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;">
                  ${reassignments.map((r) => {
                    const appt = r.appointment || {};
                    const isAuto = r.outcome === 'AUTO_ASSIGNED' || r.outcome === 'CUSTOMER_ACCEPTED';
                    const serviceName = appt.service?.name || appt.serviceNameSnapshot || 'Hair Service';
                    const customerName = appt.salonUser?.user?.name || appt.customer?.name || 'Valued Client';
                    const customerPhone = appt.salonUser?.user?.phone || appt.customer?.phone || '';
                    const apptTime = appt.startAt ? new Date(appt.startAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : 'Scheduled Time';
                    return `
                      <div class="ld-appt-card">
                        <div class="ld-appt-client">
                          <div class="ld-appt-avatar">${customerName.charAt(0).toUpperCase()}</div>
                          <div class="ld-appt-info">
                            <div class="ld-appt-name">${customerName} <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: normal;">${customerPhone ? `(${customerPhone})` : ''}</span></div>
                            <div class="ld-appt-sub">${serviceName} · Appt #${appt.appointmentNumber || r.appointmentId?.slice(0, 8)}</div>
                            <div class="ld-appt-time">🕒 Slot: ${apptTime}</div>
                          </div>
                        </div>
                        <div>
                          <span class="badge" style="background: ${isAuto ? 'rgba(52, 211, 153, 0.15)' : 'rgba(251, 113, 133, 0.15)'}; color: ${isAuto ? '#34d399' : '#fb7185'}; border: 1px solid ${isAuto ? 'rgba(52,211,153,0.3)' : 'rgba(251,113,133,0.3)'}; font-size: 0.72rem; font-weight: 700; padding: 5px 10px; border-radius: 999px;">
                            ${isAuto ? '✓ Reassigned to Peer' : '⚠️ Action Needed'}
                          </span>
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              `}
            `}
          </div>

          <!-- Modal Footer Actions -->
          <div class="ld-footer">
            <div style="font-size: 0.72rem; color: var(--text-muted); font-family: monospace;">
              Record #${absence.id.slice(0, 12)}
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              ${canCancel && staffId ? `
                <button class="btn-leave-extend btn-detail-extend-action" id="btn-detail-extend">
                  <span>📅</span> <span>Extend Date</span>
                </button>
                <button class="btn-leave-cancel btn-detail-cancel-action" id="btn-detail-cancel">
                  <span>✕</span> <span>Cancel Leave</span>
                </button>
              ` : ''}
              <button class="btn btn-secondary btn-sm" id="btn-close-detail-done">Close</button>
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
