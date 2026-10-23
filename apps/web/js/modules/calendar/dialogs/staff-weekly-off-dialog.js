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
  static open({
    app,
    year,
    month,
    staffList = [],
    staffWeeklyOffs = null,
    weeklyHours = [],
    isStaffMode = false,
    staffId = null,
    staffName = 'Specialist',
    onRefresh = () => {},
  }) {
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

    let staffOffInfo = [];

    // 1. ARCHITECTURAL PREFERENCE: Consume backend-validated staffWeeklyOffs if available
    if (Array.isArray(staffWeeklyOffs)) {
      const filtered = isStaffMode && staffId
        ? staffWeeklyOffs.filter((s) => (s.stylistId || s.id) === staffId)
        : staffWeeklyOffs;

      staffOffInfo = filtered.map((s) => ({
        stylistId: s.stylistId || s.id,
        stylistName: s.stylistName || s.name,
        offDays: s.offDays || [],
        formattedDays: s.formattedDays || (s.offDays || []).map((d) => d.charAt(0) + d.slice(1).toLowerCase()).join(', '),
        dates: (s.dates || []).map((d) => (typeof d === 'string' ? { dateStr: d } : d)),
      }));
    } else {
      // 2. FALLBACK: Calculate with exact architectural validation (only off on OPEN days)
      const salonWeeklyHours = weeklyHours?.length > 0 ? weeklyHours : (app?.salonWorkingHours || []);
      const salonClosedDays = salonWeeklyHours.filter((h) => h.isClosed || h.isOff).map((h) => h.dayOfWeek);

      const targetStaff = isStaffMode && staffId
        ? (staffList || app?.staffList || []).filter((s) => (s.id || s.stylistId) === staffId)
        : (staffList || app?.staffList || []);

      targetStaff.forEach((st) => {
        const whList = st.workingHours || st.weeklyHours || [];
        // ARCHITECTURAL RULE: Only days where staff is off AND salon is OPEN count as staff weekly offs
        const offDays = whList
          .filter((h) => (h.isClosed || h.isOff || h.isWorking === false) && !salonClosedDays.includes(h.dayOfWeek))
          .map((h) => h.dayOfWeek);

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
            stylistId: st.id || st.stylistId,
            stylistName: st.name || st.stylistName,
            offDays,
            formattedDays: offDays.map((d) => d.charAt(0) + d.slice(1).toLowerCase()).join(', '),
            dates,
          });
        }
      });
    }

    const totalStaffOffCount = staffOffInfo.reduce((acc, curr) => acc + curr.dates.length, 0);
    const titleText = isStaffMode ? `${staffName}'s Weekly Offs` : `Specialists Routine Weekly Offs`;

    let bodyHtml = '';
    if (staffOffInfo.length === 0) {
      bodyHtml = `
        <div style="text-align: center; padding: 28px 16px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.1); border-radius: 12px; margin-bottom: 8px;">
          <div style="font-size: 2rem; margin-bottom: 8px;">👤</div>
          <div style="font-size: 0.9rem; font-weight: 700; color: #fff; margin-bottom: 4px;">No Staff Weekly Offs</div>
          <div style="font-size: 0.76rem; color: #94a3b8;">All specialists follow open salon operating hours without individual routine days off.</div>
        </div>
      `;
    } else {
      bodyHtml = `
        <div style="display: flex; flex-direction: column; gap: 10px; max-height: 420px; overflow-y: auto; padding-right: 4px; margin-bottom: 6px;">
          ${staffOffInfo.map((info) => {
            const formattedDays = info.offDays.map((d) => d.charAt(0) + d.slice(1).toLowerCase()).join(', ');
            return `
              <div class="leave-history-card" style="--card-accent: #c084fc;">
                <!-- Top Header Row: Date & Status -->
                <div class="lhc-header-row">
                  <div class="lhc-header-left">
                    <span class="lhc-cal-icon">👤</span>
                    <strong class="lhc-date-title">${info.stylistName}</strong>
                    <span class="lhc-duration-tag">${info.dates.length} Days</span>
                  </div>
                  <div class="lhc-status-pill lhc-status-upcoming" style="background: rgba(168, 85, 247, 0.14); border-color: rgba(168, 85, 247, 0.4); color: #c084fc;">
                    <span class="lhc-status-dot" style="background: #c084fc; box-shadow: 0 0 5px #c084fc;"></span>
                    <span>Every ${formattedDays}</span>
                  </div>
                </div>

                <!-- Middle Info Panel -->
                <div class="lhc-meta-panel">
                  <div class="lhc-meta-row">
                    <div class="lhc-meta-cell lhc-meta-left">
                      <span class="lhc-type-dot" style="color: #c084fc;">●</span>
                      <span class="lhc-meta-label">Type:</span>
                      <strong class="lhc-meta-type-val" style="color: #c084fc;">Weekly Routine Off</strong>
                    </div>
                    <div class="lhc-meta-cell lhc-meta-right">
                      <span class="lhc-meta-icon">🕒</span>
                      <span class="lhc-meta-label">Shift:</span>
                      <strong class="lhc-meta-shift-val">Full Day Off</strong>
                    </div>
                  </div>
                  <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 5px; margin-bottom: 3px;">Exact Off Dates in ${currentMonthName}:</div>
                  <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                    ${info.dates.map((d) => {
                      const dObj = new Date(d.dateStr + 'T00:00:00');
                      const fDate = dObj.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', weekday: 'short' });
                      const isPast = d.dateStr < todayISO;
                      return `
                        <span style="font-size: 0.7rem; font-weight: 700; padding: 2.5px 8px; border-radius: 6px; background: rgba(168, 85, 247, 0.1); border: 1px solid rgba(168, 85, 247, 0.25); color: #c084fc; ${isPast ? 'opacity: 0.55;' : ''}">
                          ${fDate}
                        </span>
                      `;
                    }).join('')}
                  </div>
                </div>

                <!-- Schedule Impact Pill -->
                <div class="lhc-impact-pill lhc-impact-clean">
                  <div class="lhc-impact-left">
                    <span class="lhc-impact-check">✓</span>
                    <span class="lhc-impact-text">Specialist Roster Blocked · Bookings protected</span>
                  </div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content modal-content-sheet" style="max-width: 560px; padding: 20px 22px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; background: #0f172a; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);">
          <div class="sheet-grab-handle"></div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px;">
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
  }
}
