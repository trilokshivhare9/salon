import { ApiClient } from '../../../api.js';
import { StaffApplyLeaveDialog } from '../../staff/staff-apply-leave-dialog.js';

/**
 * StaffLeaveDialog
 * Dedicated Dialog for inspecting and managing Specialist Leaves (Chip: Staff Leave).
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
  static open({ app, year, month, leaves = [], staffList = [], isStaffMode = false, staffId = null, staffName = 'Specialist', onRefresh = () => {} }) {
    const modalContainer = document.getElementById('modal-container') || document.body;
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const currentMonthName = `${monthNames[month]} ${year}`;
    const mStr = String(month + 1).padStart(2, '0');
    const totalDays = new Date(year, month + 1, 0).getDate();
    const monthStart = `${year}-${mStr}-01`;
    const monthEnd = `${year}-${mStr}-${String(totalDays).padStart(2, '0')}`;
    const todayISO = new Date().toISOString().split('T')[0];

    const allLeaves = (leaves || app?.calendarSchedule?.leaves || []);
    let monthLeaves = allLeaves.filter((l) => {
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
        <div style="text-align: center; padding: 28px 16px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.1); border-radius: 12px; margin-bottom: 16px;">
          <div style="font-size: 2rem; margin-bottom: 8px;">🏖️</div>
          <div style="font-size: 0.9rem; font-weight: 700; color: #fff; margin-bottom: 4px;">No Approved Leaves</div>
          <div style="font-size: 0.76rem; color: #94a3b8; max-width: 320px; margin: 0 auto;">No specialist leaves are scheduled for ${currentMonthName}.</div>
        </div>
      `;
    } else {
      bodyHtml = `
        <div style="display: flex; flex-direction: column; gap: 10px; max-height: 380px; overflow-y: auto; padding-right: 4px; margin-bottom: 16px;">
          ${monthLeaves.map((l) => {
            const sFormatted = new Date(l.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
            const eFormatted = new Date(l.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
            const dateDisplay = sFormatted === eFormatted ? sFormatted : `${sFormatted} → ${eFormatted}`;
            const isPast = String(l.endDate).split('T')[0] < todayISO;

            return `
              <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 12px 14px; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                <div>
                  <div style="font-size: 0.86rem; font-weight: 800; color: #fff;">${l.stylistName || staffName}</div>
                  <div style="font-size: 0.74rem; color: #f87171; font-weight: 700; margin-top: 2px;">📅 ${dateDisplay}</div>
                  <div style="font-size: 0.7rem; color: #94a3b8; margin-top: 2px;">${(l.leaveType || l.reason || 'Approved Leave').replace('_', ' ')}</div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35); font-size: 0.65rem; font-weight: 700;">
                    APPROVED
                  </span>
                  ${!isPast ? `
                    <button type="button" class="btn btn-secondary btn-sm btn-cancel-leave-from-dialog" data-staff-id="${l.stylistId || staffId}" data-absence-id="${l.id || l.absenceId}" data-name="${(l.stylistName || staffName).replace(/"/g, '&quot;')}" style="padding: 2px 8px; font-size: 0.68rem; color: #f87171; border-color: rgba(239,68,68,0.35);">
                      🗑️ Cancel
                    </button>
                  ` : ''}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    bodyHtml += `
      <div style="display: flex; justify-content: flex-end;">
        <button type="button" class="btn btn-secondary btn-sm" id="btn-inspector-leave-portal" style="font-size: 0.76rem; font-weight: 700; color: #f87171; border-color: rgba(248, 113, 113, 0.4);">
          🌴 Open Leave Management
        </button>
      </div>
    `;

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content modal-content-sheet" style="max-width: 540px; padding: 22px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; background: #0f172a; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);">
          <div class="sheet-grab-handle"></div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                <span style="font-size: 1.15rem;">🏖️</span>
                <h3 style="font-size: 1.05rem; font-weight: 800; color: #fff; margin: 0;">${titleText}</h3>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="badge" style="background: rgba(248, 113, 113, 0.15); color: #f87171; border: 1px solid rgba(248, 113, 113, 0.35); font-size: 0.72rem; font-weight: 700;">
                  ${monthLeaves.length} in ${currentMonthName}
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

    modalContainer.querySelectorAll('.btn-cancel-leave-from-dialog').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const sId = e.currentTarget.getAttribute('data-staff-id');
        const aId = e.currentTarget.getAttribute('data-absence-id');
        const sName = e.currentTarget.getAttribute('data-name');
        if (confirm(`Cancel leave for ${sName}?`)) {
          try {
            await ApiClient.cancelStaffAbsence(sId, aId);
            if (app?.showToast) app.showToast(`Leave cancelled for ${sName}.`, 'success');
            closeModal();
            await onRefresh();
          } catch (err) {
            if (app?.showToast) app.showToast(err.message || 'Failed to cancel leave.', 'error');
          }
        }
      });
    });

    document.getElementById('btn-inspector-leave-portal')?.addEventListener('click', () => {
      closeModal();
      StaffApplyLeaveDialog.open({
        staffId,
        staffName,
        initialDate: todayISO,
        showModeSwitch: !isStaffMode,
        staffList,
        onSuccess: onRefresh,
      });
    });
  }
}
