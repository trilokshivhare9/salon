import { ScheduleDayOffDialog } from '../../salon-settings/schedule-day-off-dialog.js';

/**
 * FestivalDialog
 * Dedicated Dialog for inspecting and acting on Recognized Gazetted Festivals (Chip: Festival).
 */
export class FestivalDialog {
  /**
   * Opens the Recognized Festivals Inspector Dialog.
   * @param {Object} options
   * @param {Object} options.app - Dashboard application context
   * @param {number} options.year - Active calendar year
   * @param {number} options.month - Active calendar month (0-11)
   * @param {Array} options.festivals - Recognized festivals list for month
   * @param {Array} options.closures - Active store closures list
   * @param {Function} options.onRefresh - Callback to refresh calendar
   */
  static open({ app, year, month, festivals = [], closures = [], onRefresh = () => {} }) {
    const modalContainer = document.getElementById('modal-container') || document.body;
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const currentMonthName = `${monthNames[month]} ${year}`;

    const monthFestivals = festivals || [];
    const monthClosures = closures || app?.closuresList || [];

    let bodyHtml = '';
    if (monthFestivals.length === 0) {
      bodyHtml = `
        <div style="text-align: center; padding: 28px 16px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.1); border-radius: 12px; margin-bottom: 16px;">
          <div style="font-size: 2rem; margin-bottom: 8px;">✨</div>
          <div style="font-size: 0.9rem; font-weight: 700; color: #fff; margin-bottom: 4px;">No Major Gazetted Festivals</div>
          <div style="font-size: 0.76rem; color: #94a3b8;">There are no major national or state festivals recorded in ${currentMonthName}.</div>
        </div>
      `;
    } else {
      bodyHtml = `
        <div style="display: flex; flex-direction: column; gap: 8px; max-height: 380px; overflow-y: auto; padding-right: 4px; margin-bottom: 16px;">
          ${monthFestivals.map((fest) => {
            const isClosed = monthClosures.some((c) => {
              const s = String(c.startDate).split('T')[0];
              const e = String(c.endDate).split('T')[0];
              return fest.date >= s && fest.date <= e;
            });
            const dateFormatted = new Date(fest.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', weekday: 'short' });

            return `
              <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                <div>
                  <div style="font-size: 0.84rem; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 6px;">
                    <span>${fest.icon || '🪔'}</span>
                    <span>${fest.name}</span>
                  </div>
                  <div style="font-size: 0.72rem; color: #34d399; margin-top: 2px;">
                    ${dateFormatted} · ${fest.type || 'Gazetted'}
                  </div>
                </div>
                <div>
                  ${isClosed ? `
                    <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35); font-size: 0.65rem; font-weight: 700;">
                      ✓ Salon Closed
                    </span>
                  ` : `
                    <button type="button" class="btn btn-secondary btn-sm btn-inspector-close-fest" data-date="${fest.date}" data-name="${fest.name.replace(/"/g, '&quot;')}" style="font-size: 0.68rem; padding: 3px 8px; color: #34d399; border-color: rgba(16, 185, 129, 0.4); white-space: nowrap;">
                      + Close Salon
                    </button>
                  `}
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content modal-content-sheet" style="max-width: 540px; padding: 22px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; background: #0f172a; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);">
          <div class="sheet-grab-handle"></div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                <span style="font-size: 1.15rem;">🪔</span>
                <h3 style="font-size: 1.05rem; font-weight: 800; color: #fff; margin: 0;">Gazetted Festivals & Observances</h3>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35); font-size: 0.72rem; font-weight: 700;">
                  ${monthFestivals.length} in ${currentMonthName}
                </span>
              </div>
            </div>
            <button class="close-btn" id="btn-close-fest-dialog" style="width: 28px; height: 28px; font-size: 1.1rem; background: rgba(255,255,255,0.06); border: none; border-radius: 50%; color: #94a3b8; cursor: pointer;">&times;</button>
          </div>
          ${bodyHtml}
        </div>
      </div>
    `;

    const closeModal = () => (modalContainer.innerHTML = '');
    document.getElementById('btn-close-fest-dialog')?.addEventListener('click', closeModal);
    modalContainer.querySelector('.modal-backdrop')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeModal();
    });

    modalContainer.querySelectorAll('.btn-inspector-close-fest').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const festDate = e.currentTarget.getAttribute('data-date');
        const festName = e.currentTarget.getAttribute('data-name');
        closeModal();
        ScheduleDayOffDialog.open({
          initialDate: festDate,
          festivalInfo: { name: festName },
          salonWorkingHours: app?.salonWorkingHours || [],
          existingClosures: monthClosures || [],
          staffList: app?.staffList || [],
          onSuccess: async () => {
            await onRefresh();
          },
        });
      });
    });
  }
}
