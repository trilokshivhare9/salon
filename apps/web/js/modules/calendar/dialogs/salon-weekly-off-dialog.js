/**
 * SalonWeeklyOffDialog
 * Dedicated Dialog for inspecting Salon Routine Weekly Offs (Chip: Salon W-Off).
 */
export class SalonWeeklyOffDialog {
  /**
   * Opens the Salon Weekly Off Inspector Dialog.
   * @param {Object} options
   * @param {Object} options.app - Dashboard application context
   * @param {number} options.year - Active calendar year
   * @param {number} options.month - Active calendar month (0-11)
   * @param {Array} options.weeklyHours - Salon weekly hours schedule
   * @param {Function} options.onRefresh - Callback to refresh calendar
   */
  static open({ app, year, month, weeklyHours = [], onRefresh = () => {} }) {
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

    const salonWeeklyHours = weeklyHours.length > 0 ? weeklyHours : (app?.salonWorkingHours || []);
    const salonOffDays = salonWeeklyHours
      .filter((h) => h.isClosed || h.isOff)
      .map((h) => h.dayOfWeek);

    const salonOffDates = [];
    for (let d = 1; d <= totalDays; d++) {
      const dKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dow = DAY_MAP[new Date(year, month, d).getDay()];
      if (salonOffDays.includes(dow)) {
        salonOffDates.push({ dateStr: dKey, dayOfWeek: dow });
      }
    }

    let bodyHtml = '';
    if (salonOffDays.length === 0) {
      bodyHtml = `
        <div style="text-align: center; padding: 28px 16px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.1); border-radius: 12px; margin-bottom: 16px;">
          <div style="font-size: 2rem; margin-bottom: 8px;">✨</div>
          <div style="font-size: 0.9rem; font-weight: 700; color: #fff; margin-bottom: 4px;">Open 7 Days a Week</div>
          <div style="font-size: 0.76rem; color: #94a3b8; max-width: 320px; margin: 0 auto;">The salon has no fixed weekly routine off-days configured. Operating shifts are active every day.</div>
        </div>
      `;
    } else {
      const offDaysFormatted = salonOffDays.map((d) => d.charAt(0) + d.slice(1).toLowerCase()).join(', ');
      bodyHtml = `
        <div style="margin-bottom: 14px; background: rgba(56, 189, 248, 0.08); border: 1px solid rgba(56, 189, 248, 0.2); border-radius: 10px; padding: 12px 14px;">
          <div style="font-size: 0.82rem; font-weight: 700; color: #e0f2fe; margin-bottom: 4px;">
            Configured Routine: <span style="color: #38bdf8;">Every ${offDaysFormatted}</span>
          </div>
          <div style="font-size: 0.72rem; color: #94a3b8;">
            The salon automatically blocks customer bookings and displays diagonal hatching on these days.
          </div>
        </div>

        <div style="font-size: 0.74rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #94a3b8; margin-bottom: 8px;">
          Exact Off Dates in ${currentMonthName}:
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: 8px; margin-bottom: 16px;">
          ${salonOffDates.map((item) => {
            const dObj = new Date(item.dateStr + 'T00:00:00');
            const formattedDate = dObj.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', weekday: 'short' });
            const isPast = item.dateStr < todayISO;
            return `
              <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 8px 10px; text-align: center; ${isPast ? 'opacity: 0.6;' : ''}">
                <div style="font-size: 0.84rem; font-weight: 800; color: #38bdf8;">${formattedDate}</div>
                <div style="font-size: 0.64rem; color: #94a3b8; margin-top: 2px;">Weekly Routine Off</div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    bodyHtml += `
      <div style="display: flex; justify-content: flex-end;">
        <button type="button" class="btn btn-secondary btn-sm" id="btn-inspector-edit-hours" style="font-size: 0.76rem; font-weight: 700; color: #38bdf8; border-color: rgba(56, 189, 248, 0.4);">
          ⚙️ Edit Salon Hours & Weekly Offs
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
                <span style="font-size: 1.15rem;">🏢</span>
                <h3 style="font-size: 1.05rem; font-weight: 800; color: #fff; margin: 0;">Salon Routine Weekly Offs</h3>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35); font-size: 0.72rem; font-weight: 700;">
                  ${salonOffDates.length} Days in ${currentMonthName}
                </span>
              </div>
            </div>
            <button class="close-btn" id="btn-close-salon-off-dialog" style="width: 28px; height: 28px; font-size: 1.1rem; background: rgba(255,255,255,0.06); border: none; border-radius: 50%; color: #94a3b8; cursor: pointer;">&times;</button>
          </div>
          ${bodyHtml}
        </div>
      </div>
    `;

    const closeModal = () => (modalContainer.innerHTML = '');
    document.getElementById('btn-close-salon-off-dialog')?.addEventListener('click', closeModal);
    modalContainer.querySelector('.modal-backdrop')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeModal();
    });

    document.getElementById('btn-inspector-edit-hours')?.addEventListener('click', () => {
      closeModal();
      if (app) {
        app.activeTab = 'settings';
        app.activeSubtab = 'hours';
        app.render();
      }
    });
  }
}
