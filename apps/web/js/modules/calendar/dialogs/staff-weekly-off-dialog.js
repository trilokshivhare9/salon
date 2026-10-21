/**
 * StaffWeeklyOffDialog
 * Dedicated Dialog for inspecting Specialist Routine Weekly Offs (Chip: Staff W-Off).
 */
export class StaffWeeklyOffDialog {
  /**
   * Opens the Staff Weekly Off Inspector Dialog.
   * @param {Object} options
   * @param {Object} options.app - Dashboard application context
   * @param {number} options.year - Active calendar year
   * @param {number} options.month - Active calendar month (0-11)
   * @param {Array} options.staffList - Team specialists list
   * @param {boolean} options.isStaffMode - Whether viewed from specialist workspace
   * @param {string} options.staffId - Specialist ID if in staff mode
   * @param {string} options.staffName - Specialist name if in staff mode
   * @param {Function} options.onRefresh - Callback to refresh calendar
   */
  static open({ app, year, month, staffList = [], isStaffMode = false, staffId = null, staffName = 'Specialist', onRefresh = () => {} }) {
    const modalContainer = document.getElementById('modal-container') || document.body;
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const currentMonthName = `${monthNames[month]} ${year}`;
    const totalDays = new Date(year, month + 1, 0).getDate();
    const todayISO = new Date().toISOString().split('T')[0];

    const DAY_MAP = {
      0: 'SUNDAY',
      1: 'MONDAY',
      2: 'TUESDAY',
      3: 'WEDNESDAY',
      4: 'THURSDAY',
      5: 'FRIDAY',
      6: 'SATURDAY',
    };

    const targetStaff = isStaffMode && staffId
      ? (staffList || app?.staffList || []).filter((s) => s.id === staffId)
      : (staffList || app?.staffList || []);

    const staffOffInfo = [];
    targetStaff.forEach((st) => {
      const whList = st.workingHours || st.weeklyHours || [];
      const offDays = whList.filter((h) => h.isClosed || h.isOff || h.isWorking === false).map((h) => h.dayOfWeek);
      if (offDays.length > 0) {
        const dates = [];
        for (let d = 1; d <= totalDays; d++) {
          const dKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const dow = DAY_MAP[new Date(year, month, d).getDay()];
          if (offDays.includes(dow)) {
            dates.push({ dateStr: dKey, dayOfWeek: dow });
          }
        }
        staffOffInfo.push({
          stylistId: st.id,
          stylistName: st.name,
          offDays,
          dates,
        });
      }
    });

    const totalStaffOffCount = staffOffInfo.reduce((acc, curr) => acc + curr.dates.length, 0);
    const titleText = isStaffMode ? `${staffName}'s Weekly Offs` : `Specialists Routine Weekly Offs`;

    let bodyHtml = '';
    if (staffOffInfo.length === 0) {
      bodyHtml = `
        <div style="text-align: center; padding: 28px 16px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.1); border-radius: 12px; margin-bottom: 16px;">
          <div style="font-size: 2rem; margin-bottom: 8px;">👤</div>
          <div style="font-size: 0.9rem; font-weight: 700; color: #fff; margin-bottom: 4px;">No Staff Weekly Offs</div>
          <div style="font-size: 0.76rem; color: #94a3b8;">All specialists follow open salon operating hours without individual routine days off.</div>
        </div>
      `;
    } else {
      bodyHtml = `
        <div style="display: flex; flex-direction: column; gap: 10px; max-height: 380px; overflow-y: auto; padding-right: 4px; margin-bottom: 16px;">
          ${staffOffInfo.map((info) => {
            const formattedDays = info.offDays.map((d) => d.charAt(0) + d.slice(1).toLowerCase()).join(', ');
            return `
              <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 12px 14px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                  <div style="font-size: 0.86rem; font-weight: 800; color: #fff;">${info.stylistName}</div>
                  <span class="badge" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.3); font-size: 0.65rem; font-weight: 700;">Every ${formattedDays}</span>
                </div>
                <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px;">
                  ${info.dates.map((d) => {
                    const dObj = new Date(d.dateStr + 'T00:00:00');
                    const fDate = dObj.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                    const isPast = d.dateStr < todayISO;
                    return `
                      <span style="font-size: 0.68rem; font-weight: 700; padding: 2px 7px; border-radius: 6px; background: rgba(168, 85, 247, 0.08); border: 1px solid rgba(168, 85, 247, 0.2); color: #c084fc; ${isPast ? 'opacity: 0.6;' : ''}">
                        ${fDate}
                      </span>
                    `;
                  }).join('')}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    bodyHtml += `
      <div style="display: flex; justify-content: flex-end;">
        <button type="button" class="btn btn-secondary btn-sm" id="btn-inspector-manage-staff" style="font-size: 0.76rem; font-weight: 700; color: #c084fc; border-color: rgba(168, 85, 247, 0.4);">
          👥 Manage Staff Shifts & Roster
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
                <span style="font-size: 1.15rem;">👤</span>
                <h3 style="font-size: 1.05rem; font-weight: 800; color: #fff; margin: 0;">${titleText}</h3>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="badge" style="background: rgba(168, 85, 247, 0.15); color: #c084fc; border: 1px solid rgba(168, 85, 247, 0.35); font-size: 0.72rem; font-weight: 700;">
                  ${totalStaffOffCount} Offs in ${currentMonthName}
                </span>
              </div>
            </div>
            <button class="close-btn" id="btn-close-staff-off-dialog" style="width: 28px; height: 28px; font-size: 1.1rem; background: rgba(255,255,255,0.06); border: none; border-radius: 50%; color: #94a3b8; cursor: pointer;">&times;</button>
          </div>
          ${bodyHtml}
        </div>
      </div>
    `;

    const closeModal = () => (modalContainer.innerHTML = '');
    document.getElementById('btn-close-staff-off-dialog')?.addEventListener('click', closeModal);
    modalContainer.querySelector('.modal-backdrop')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeModal();
    });

    document.getElementById('btn-inspector-manage-staff')?.addEventListener('click', () => {
      closeModal();
      if (app) {
        app.activeTab = 'staff';
        app.render();
      }
    });
  }
}
