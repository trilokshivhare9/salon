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

export const PROCESSING_STATUS_BADGES = {
  PENDING: { label: 'Pending', bg: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b', border: 'rgba(245, 158, 11, 0.3)', icon: '⏳' },
  PROCESSING: { label: 'Processing...', bg: 'rgba(59, 130, 246, 0.15)', color: '#60a5fa', border: 'rgba(59, 130, 246, 0.3)', icon: '🔄' },
  COMPLETED: { label: 'Completed', bg: 'rgba(52, 211, 153, 0.15)', color: '#34d399', border: 'rgba(52, 211, 153, 0.3)', icon: '✅' },
  FAILED: { label: 'Action Required', bg: 'rgba(239, 68, 68, 0.15)', color: '#f87171', border: 'rgba(239, 68, 68, 0.3)', icon: '⚠️' },
};

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
        <div class="modal-content" style="max-width: 620px; max-height: 90vh; overflow-y: auto;">
          <div class="modal-header">
            <h3 style="display: flex; align-items: center; gap: 8px;">
              <span>🗓️</span>
              <span>Leave Management — Record Leave</span>
            </h3>
            <button class="close-btn" id="btn-close-leave-modal">&times;</button>
          </div>
          <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 16px;">
            Schedule leave or mark absence for a specialist. The system will calculate availability overrides and process affected bookings.
          </p>

          <form id="leave-management-form">
            <!-- Stylist Selection -->
            <div class="form-group" style="margin-bottom: 14px;">
              <label style="font-weight: 600;">Specialist *</label>
              <select class="form-control" id="leave-staff-id" ${staffId ? 'disabled' : 'required'}>
                ${staffList.map((st) => `
                  <option value="${st.id}" ${st.id === staffId ? 'selected' : ''}>
                    ${st.name || 'Specialist'} (${st.phone || 'No phone'})
                  </option>
                `).join('')}
              </select>
            </div>

            <!-- Date Range -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px;">
              <div class="form-group" style="margin: 0;">
                <label style="font-weight: 600;">Start Date *</label>
                <input type="date" class="form-control" id="leave-start-date" value="${initialDate}" required />
              </div>
              <div class="form-group" style="margin: 0;">
                <label style="font-weight: 600;">End Date *</label>
                <input type="date" class="form-control" id="leave-end-date" value="${initialDate}" required />
              </div>
            </div>

            <!-- Leave Type & Portion -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px;">
              <div class="form-group" style="margin: 0;">
                <label style="font-weight: 600;">Leave Type *</label>
                <select class="form-control" id="leave-type" required>
                  <option value="SICK_LEAVE">🤒 Sick Leave</option>
                  <option value="CASUAL_LEAVE">🌴 Casual Leave</option>
                  <option value="EMERGENCY_LEAVE">🚨 Emergency Leave</option>
                  <option value="UNPAID_LEAVE">📄 Unpaid Leave</option>
                  <option value="OTHER">📝 Other</option>
                </select>
              </div>
              <div class="form-group" style="margin: 0;">
                <label style="font-weight: 600;">Leave Portion *</label>
                <select class="form-control" id="leave-portion" required>
                  <option value="FULL_DAY">Full Day (Entire Shift)</option>
                  <option value="FIRST_HALF">First Half (Shift Start → Mid-day)</option>
                  <option value="SECOND_HALF">Second Half (Mid-day → Shift End)</option>
                  <option value="CUSTOM_HOURS">Custom Hours</option>
                </select>
              </div>
            </div>

            <!-- Custom Hours Input (Conditional) -->
            <div id="leave-custom-hours-group" style="display: none; background: rgba(99,102,241,0.08); border: 1px solid rgba(99,102,241,0.2); border-radius: var(--radius-sm); padding: 12px; margin-bottom: 14px;">
              <div style="font-size: 0.8rem; font-weight: 600; color: #818cf8; margin-bottom: 8px;">⏰ Custom Hours Window:</div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
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
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 14px;">
              <div class="form-group" style="margin: 0;">
                <label style="font-size: 0.82rem;">Reason (Optional)</label>
                <input type="text" class="form-control" id="leave-reason" placeholder="e.g. Medical checkup" />
              </div>
              <div class="form-group" style="margin: 0;">
                <label style="font-size: 0.82rem;">Internal Notes (Optional)</label>
                <input type="text" class="form-control" id="leave-notes" placeholder="e.g. Informed manager" />
              </div>
            </div>

            <!-- Live Impact Preview Box -->
            <div id="leave-impact-preview-box" style="background: rgba(0,0,0,0.25); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 14px; margin-bottom: 16px;">
              <div style="display: flex; align-items: center; gap: 8px; font-size: 0.82rem; color: var(--text-secondary);">
                <div class="spinner-small" style="display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.2); border-top-color: #818cf8; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
                <span>Fetching live impact preview from server...</span>
              </div>
            </div>

            <!-- Operational Warning Banner -->
            <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: var(--radius-sm); padding: 10px 14px; margin-bottom: 16px; font-size: 0.78rem; color: #fca5a5;">
              ⚠️ <strong>Auto-Reassignment:</strong> Affected bookings will be reassigned to available qualified staff. Customers will receive interactive WhatsApp notifications.
            </div>

            <div style="display: flex; gap: 10px; justify-content: flex-end;">
              <button type="button" class="btn btn-secondary" id="btn-cancel-leave-modal">Cancel</button>
              <button type="submit" class="btn btn-danger" id="btn-submit-leave" style="gap: 6px;">
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
          <div class="spinner-small" style="display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.2); border-top-color: #818cf8; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
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
              <div>
                <div style="font-weight: 600;">No existing bookings affected</div>
                <div style="font-size: 0.75rem; color: var(--text-secondary);">Stylist availability will be blocked for ${sDate === eDate ? formatDateFriendly(sDate) : `${formatDateFriendly(sDate)} to ${formatDateFriendly(eDate)}`}.</div>
              </div>
            </div>
          `;
        } else {
          previewBox.innerHTML = `
            <div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="font-weight: 700; font-size: 0.85rem; color: #fff;">
                  ⚡ Live Operational Impact (${total} Booking${total > 1 ? 's' : ''}):
                </span>
                <div style="display: flex; gap: 6px;">
                  <span class="badge" style="background: rgba(52, 211, 153, 0.15); color: #34d399; border: 1px solid rgba(52,211,153,0.3); font-size: 0.7rem;">
                    ${reassignable} Auto-Reassignable
                  </span>
                  ${unresolvable > 0 ? `
                    <span class="badge" style="background: rgba(251, 113, 133, 0.15); color: #fb7185; border: 1px solid rgba(251,113,133,0.3); font-size: 0.7rem;">
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
          previewBox.innerHTML = `
            <div style="font-size: 0.8rem; color: #fca5a5;">
              ⚠️ Preview server response: ${err.message || 'Unable to fetch preview'}
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
    const procBadge = PROCESSING_STATUS_BADGES[absence.processingStatus] || PROCESSING_STATUS_BADGES.COMPLETED;

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content" style="max-width: 540px;">
          <div class="modal-header">
            <h3 style="display: flex; align-items: center; gap: 8px;">
              <span>${procBadge.icon}</span>
              <span>Leave Recorded — Operational Summary</span>
            </h3>
            <button class="close-btn" id="btn-close-result-modal">&times;</button>
          </div>
          <div style="margin-bottom: 14px;">
            <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 8px;">
              Leave configured for <strong>${staffName}</strong> from <strong>${formatDateFriendly(absence.startDate || absence.absenceDate)}</strong> to <strong>${formatDateFriendly(absence.endDate || absence.absenceDate)}</strong>.
            </p>
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 0.78rem; color: var(--text-muted);">Processing Status:</span>
              <span class="badge" style="background: ${procBadge.bg}; color: ${procBadge.color}; border: 1px solid ${procBadge.border}; font-weight: 700; font-size: 0.75rem;">
                ${procBadge.icon} ${procBadge.label}
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
          <div class="modal-header">
            <h3 style="display: flex; align-items: center; gap: 8px;">
              <span>🗓️</span>
              <span>Leave Records & History — ${staffName}</span>
            </h3>
            <button class="close-btn" id="btn-close-history-modal">&times;</button>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <p style="color: var(--text-secondary); font-size: 0.85rem; margin: 0;">
              Manage leave periods, extend dates, review processing outcomes, or cancel active leaves.
            </p>
            <button class="btn btn-primary btn-sm" id="btn-history-new-leave" style="gap: 6px;">
              <span>+ Record Leave</span>
            </button>
          </div>

          <div id="leave-history-content" style="min-height: 200px;">
            <div style="display: flex; align-items: center; justify-content: center; height: 160px; color: var(--text-secondary); gap: 10px;">
              <div class="spinner-small" style="width: 20px; height: 20px; border: 2px solid rgba(255,255,255,0.2); border-top-color: #818cf8; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
              <span>Loading leave records...</span>
            </div>
          </div>
        </div>
      </div>
    `;

    const closeHistory = () => { modalContainer.innerHTML = ''; };
    document.getElementById('btn-close-history-modal')?.addEventListener('click', closeHistory);
    document.getElementById('btn-history-new-leave')?.addEventListener('click', () => {
      closeHistory();
      this.showCreateLeaveModal(staffId, staffName);
    });

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
            const leaveTypeLabel = LEAVE_TYPE_LABELS[ab.leaveType] || ab.reason || 'Leave';
            const portionLabel = LEAVE_PORTION_LABELS[ab.leavePortion] || 'Full Day';
            const procBadge = PROCESSING_STATUS_BADGES[ab.processingStatus] || PROCESSING_STATUS_BADGES.COMPLETED;
            const isActive = ab.status === 'ACTIVE';

            return `
              <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 14px; display: flex; flex-direction: column; gap: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                  <div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                      <span style="font-weight: 700; font-size: 0.95rem; color: #fff;">
                        ${formatDateFriendly(sDate)} ${isMultiDay ? `→ ${formatDateFriendly(eDate)}` : ''}
                      </span>
                      <span class="badge" style="background: rgba(99,102,241,0.15); color: #818cf8; border: 1px solid rgba(99,102,241,0.3); font-size: 0.72rem;">
                        ${leaveTypeLabel}
                      </span>
                      <span class="badge" style="background: rgba(255,255,255,0.06); color: var(--text-secondary); font-size: 0.72rem;">
                        ${portionLabel} ${ab.leavePortion === 'CUSTOM_HOURS' ? `(${ab.customStartTime || ''}-${ab.customEndTime || ''})` : ''}
                      </span>
                    </div>
                    ${ab.notes ? `<div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 4px;">Notes: ${ab.notes}</div>` : ''}
                  </div>
                  <div style="display: flex; items-center; gap: 6px;">
                    <span class="badge ${isActive ? 'badge-completed' : 'badge-cancelled'}" style="font-size: 0.7rem; font-weight: 700;">
                      ${ab.status || 'ACTIVE'}
                    </span>
                    <span class="badge" style="background: ${procBadge.bg}; color: ${procBadge.color}; border: 1px solid ${procBadge.border}; font-size: 0.7rem; font-weight: 700;">
                      ${procBadge.icon} ${procBadge.label}
                    </span>
                  </div>
                </div>

                <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 10px; font-size: 0.8rem;">
                  <div style="display: flex; gap: 12px; color: var(--text-secondary);">
                    <span>Affected: <strong style="color:#fff;">${ab.affectedBookingsCount || 0}</strong></span>
                    <span>Reassigned: <strong style="color:#34d399;">${ab.reassignedCount || 0}</strong></span>
                    <span>Unresolved: <strong style="color:${(ab.unresolvableCount || 0) > 0 ? '#fb7185' : '#fff'};">${ab.unresolvableCount || 0}</strong></span>
                  </div>
                  <div style="display: flex; gap: 8px;">
                    <button class="btn btn-secondary btn-sm btn-view-leave-detail" data-absence-id="${ab.id}" style="font-size: 0.75rem; padding: 4px 10px;">
                      Details
                    </button>
                    ${isActive ? `
                      <button class="btn btn-secondary btn-sm btn-extend-leave" data-absence-id="${ab.id}" data-end-date="${eDate}" style="font-size: 0.75rem; padding: 4px 10px; color: #818cf8; border-color: rgba(99,102,241,0.3);">
                        Extend Date
                      </button>
                      <button class="btn btn-warning-outline btn-sm btn-cancel-leave-action" data-absence-id="${ab.id}" style="font-size: 0.75rem; padding: 4px 10px; color: #f59e0b; border-color: rgba(245,158,11,0.3);">
                        Cancel Leave
                      </button>
                    ` : ''}
                  </div>
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
          if (ab) this.showLeaveDetailModal(ab, staffName);
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
                <div class="spinner-small" style="display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.2); border-top-color: #818cf8; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
                <span>Calculating incremental impact...</span>
              </div>
            </div>

            <div style="background: rgba(99,102,241,0.08); border: 1px solid rgba(99,102,241,0.2); border-radius: var(--radius-sm); padding: 10px 14px; margin-bottom: 16px; font-size: 0.78rem; color: #a5b4fc;">
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
  showLeaveDetailModal(absence, staffName) {
    const modalContainer = document.getElementById('modal-container');
    if (!modalContainer) return;

    const sDate = absence.startDate || absence.absenceDate;
    const eDate = absence.endDate || absence.absenceDate;
    const isMultiDay = sDate && eDate && sDate !== eDate;
    const procBadge = PROCESSING_STATUS_BADGES[absence.processingStatus] || PROCESSING_STATUS_BADGES.COMPLETED;
    const reassignments = absence.reassignments || [];

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content" style="max-width: 650px; max-height: 90vh; overflow-y: auto;">
          <div class="modal-header">
            <h3 style="display: flex; align-items: center; gap: 8px;">
              <span>📋</span>
              <span>Leave Details & Booking Outcomes</span>
            </h3>
            <button class="close-btn" id="btn-close-detail-modal">&times;</button>
          </div>

          <!-- Metadata Summary -->
          <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 14px; margin-bottom: 16px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 0.83rem;">
              <div>
                <span style="color: var(--text-muted);">Specialist:</span> <strong style="color:#fff;">${staffName}</strong>
              </div>
              <div>
                <span style="color: var(--text-muted);">Leave Type:</span> <strong style="color:#fff;">${LEAVE_TYPE_LABELS[absence.leaveType] || absence.reason || 'Leave'}</strong>
              </div>
              <div>
                <span style="color: var(--text-muted);">Date Range:</span> <strong style="color:#fff;">${formatDateFriendly(sDate)} ${isMultiDay ? `→ ${formatDateFriendly(eDate)}` : ''}</strong>
              </div>
              <div>
                <span style="color: var(--text-muted);">Leave Portion:</span> <strong style="color:#fff;">${LEAVE_PORTION_LABELS[absence.leavePortion] || 'Full Day'}</strong> ${absence.leavePortion === 'CUSTOM_HOURS' ? `(${absence.customStartTime || ''}-${absence.customEndTime || ''})` : ''}
              </div>
              <div>
                <span style="color: var(--text-muted);">Business Status:</span> <span class="badge ${absence.status === 'ACTIVE' ? 'badge-completed' : 'badge-cancelled'}" style="font-size: 0.7rem;">${absence.status}</span>
              </div>
              <div>
                <span style="color: var(--text-muted);">Processing Status:</span>
                <span class="badge" style="background: ${procBadge.bg}; color: ${procBadge.color}; border: 1px solid ${procBadge.border}; font-size: 0.7rem;">
                  ${procBadge.icon} ${procBadge.label}
                </span>
              </div>
            </div>
            ${absence.notes ? `
              <div style="margin-top: 10px; font-size: 0.8rem; color: var(--text-secondary); border-top: 1px dashed rgba(255,255,255,0.1); padding-top: 8px;">
                <strong>Notes:</strong> ${absence.notes}
              </div>
            ` : ''}
          </div>

          <!-- Counters -->
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 16px;">
            <div style="background: rgba(255,255,255,0.04); padding: 10px; border-radius: var(--radius-sm); text-align: center;">
              <div style="font-size: 1.2rem; font-weight: 700; color: #fff;">${absence.affectedBookingsCount || 0}</div>
              <div style="font-size: 0.7rem; color: var(--text-muted);">Total Affected</div>
            </div>
            <div style="background: rgba(52, 211, 153, 0.1); border: 1px solid rgba(52, 211, 153, 0.2); padding: 10px; border-radius: var(--radius-sm); text-align: center;">
              <div style="font-size: 1.2rem; font-weight: 700; color: #34d399;">${absence.reassignedCount || 0}</div>
              <div style="font-size: 0.7rem; color: #34d399;">Reassigned</div>
            </div>
            <div style="background: rgba(251, 113, 133, 0.1); border: 1px solid rgba(251, 113, 133, 0.2); padding: 10px; border-radius: var(--radius-sm); text-align: center;">
              <div style="font-size: 1.2rem; font-weight: 700; color: #fb7185;">${absence.unresolvableCount || 0}</div>
              <div style="font-size: 0.7rem; color: #fb7185;">Unresolved</div>
            </div>
          </div>

          <!-- Affected Appointments Table -->
          <div style="margin-bottom: 16px;">
            <h4 style="font-size: 0.9rem; margin-bottom: 8px; color: #fff;">Affected Appointments & Reassignment Outcomes</h4>
            ${reassignments.length === 0 ? `
              <div style="font-size: 0.82rem; color: var(--text-muted); padding: 16px; background: rgba(0,0,0,0.2); border-radius: var(--radius-sm); text-align: center;">
                No individual appointment reassignment entries logged for this leave.
              </div>
            ` : `
              <div style="max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;">
                ${reassignments.map((r) => {
                  const appt = r.appointment || {};
                  const isAuto = r.outcome === 'AUTO_ASSIGNED' || r.outcome === 'CUSTOMER_ACCEPTED';
                  return `
                    <div style="background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.06); border-radius: 6px; padding: 10px; display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem;">
                      <div>
                        <div style="font-weight: 600; color: #fff;">
                          Appt #${appt.appointmentNumber || r.appointmentId?.slice(0, 8)}
                        </div>
                        <div style="color: var(--text-secondary); font-size: 0.75rem;">
                          ${appt.service?.name || 'Service'} • ${appt.customer?.name || 'Customer'} (${appt.customer?.phone || 'WhatsApp'})
                        </div>
                        <div style="font-size: 0.72rem; color: var(--text-muted);">
                          Scheduled: ${(appt.startAt || '').replace('T', ' ').slice(0, 16)}
                        </div>
                      </div>
                      <div style="text-align: right;">
                        <span class="badge" style="background: ${isAuto ? 'rgba(52, 211, 153, 0.15)' : 'rgba(251, 113, 133, 0.15)'}; color: ${isAuto ? '#34d399' : '#fb7185'}; border: 1px solid ${isAuto ? 'rgba(52,211,153,0.3)' : 'rgba(251,113,133,0.3)'}; font-size: 0.7rem; font-weight: 700;">
                          ${r.outcome === 'AUTO_ASSIGNED' ? 'Auto-Reassigned' : r.outcome === 'CUSTOMER_ACCEPTED' ? 'Accepted by Client' : '⚠️ No Replacement'}
                        </span>
                      </div>
                    </div>
                  `;
                }).join('')}
              </div>
            `}
          </div>

          <div style="display: flex; justify-content: flex-end;">
            <button class="btn btn-secondary" id="btn-close-detail-done">Close</button>
          </div>
        </div>
      </div>
    `;

    const close = () => { modalContainer.innerHTML = ''; };
    document.getElementById('btn-close-detail-modal')?.addEventListener('click', close);
    document.getElementById('btn-close-detail-done')?.addEventListener('click', close);
  }
}
