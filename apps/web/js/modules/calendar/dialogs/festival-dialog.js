import { ScheduleDayOffDialog } from '../../salon-settings/schedule-day-off-dialog.js';

/**
 * FestivalDialog
 * Dedicated Dialog for inspecting and acting on Recognized Gazetted Festivals (Chip: Festival).
 * Employs the exact .leave-history-card design pattern as Closure and Staff Leave dialogs,
 * highly optimized with compact typography, rich festival metadata, and space-saving layout.
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
   * @param {Array} options.weeklyHours - Salon weekly hours schedule
   * @param {Function} options.onRefresh - Callback to refresh calendar
   */
  static open({ app, year, month, festivals = [], closures = [], weeklyHours = [], onRefresh = () => {} }) {
    const modalContainer = document.getElementById('modal-container') || document.body;
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const shortDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const currentMonthName = `${monthNames[month]} ${year}`;
    const todayISO = new Date().toISOString().split('T')[0];

    const parseDate = (dStr) => {
      if (!dStr) return null;
      const iso = String(dStr).split('T')[0];
      const parts = iso.split('-');
      if (parts.length !== 3) return null;
      const [y, m, d] = parts.map(Number);
      const dt = new Date(y, m - 1, d);
      return !isNaN(dt.getTime()) ? dt : null;
    };

    const monthFestivals = festivals || [];
    const monthClosures = closures || app?.closuresList || [];
    const salonWorkingHours = weeklyHours?.length > 0 ? weeklyHours : (app?.salonWorkingHours || []);
    const DAY_NAMES = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

    let bodyHtml = '';
    if (monthFestivals.length === 0) {
      bodyHtml = `
        <div style="text-align: center; padding: 36px 16px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.1); border-radius: 14px; margin-bottom: 16px;">
          <div style="font-size: 2.2rem; margin-bottom: 10px;">🪔</div>
          <div style="font-size: 0.95rem; font-weight: 700; color: #fff; margin-bottom: 4px;">No Major Gazetted Festivals in ${currentMonthName}</div>
          <div style="font-size: 0.76rem; color: #94a3b8; max-width: 340px; margin: 0 auto; line-height: 1.4;">There are no major national or gazetted holiday observances scheduled for this month.</div>
        </div>
      `;
    } else {
      bodyHtml = `
        <div style="display: flex; flex-direction: column; gap: 7px; max-height: 440px; overflow-y: auto; padding-right: 4px; margin-bottom: 8px;">
          ${monthFestivals.map((fest) => {
            const dt = parseDate(fest.date);
            const isPast = fest.isPast !== undefined ? fest.isPast : (fest.date < todayISO);
            const isToday = fest.date === todayISO;
            const isClosed = fest.isClosed !== undefined
              ? fest.isClosed
              : monthClosures.some((c) => {
                  const s = String(c.startDate).split('T')[0];
                  const e = String(c.endDate).split('T')[0];
                  return fest.date >= s && fest.date <= e && !c.isPartialDay;
                });

            const festDow = dt ? DAY_NAMES[dt.getDay()] : 'MONDAY';
            const salonHour = salonWorkingHours.find((h) => h.dayOfWeek === festDow);
            const isSalonWeeklyOff = fest.isSalonWeeklyOff !== undefined
              ? fest.isSalonWeeklyOff
              : (salonHour ? Boolean(salonHour.isClosed || salonHour.isOff) : false);

            const dayShort = dt ? shortDays[dt.getDay()] : '';
            const mShort = dt ? monthsShort[dt.getMonth()] : '';
            const d = dt ? dt.getDate() : '';
            // Compact friendly date without redundant 4-digit year to prevent truncation
            const dateDisplay = dt ? `${dayShort}, ${d} ${mShort}` : fest.date;

            // Status resolution
            let statusClass = 'lhc-status-open';
            let statusTitle = isToday ? 'Open Today' : 'Open';
            let operationalText = 'Scheduled Open';
            let operationalColor = '#fbbf24';

            if (isClosed) {
              statusClass = 'lhc-status-onleave';
              statusTitle = 'Salon Closed';
              operationalText = 'Store Closed';
              operationalColor = '#34d399';
            } else if (isPast) {
              statusClass = 'lhc-status-completed';
              statusTitle = 'Passed';
              operationalText = 'Past Observance';
              operationalColor = '#94a3b8';
            } else if (isSalonWeeklyOff) {
              statusClass = 'lhc-status-upcoming';
              statusTitle = 'Weekly Off';
              operationalText = 'Routine Weekly Off';
              operationalColor = '#38bdf8';
            }

            // Category tag & color
            const rawType = String(fest.type || 'FESTIVAL').toUpperCase();
            let categoryTag = 'Festival';
            let categoryColor = '#f472b6';
            let categoryBg = 'rgba(244, 114, 182, 0.12)';
            let categoryBorder = 'rgba(244, 114, 182, 0.35)';

            if (rawType.includes('NATIONAL') || fest.religion === 'National') {
              categoryTag = 'National';
              categoryColor = '#f59e0b';
              categoryBg = 'rgba(245, 158, 11, 0.12)';
              categoryBorder = 'rgba(245, 158, 11, 0.35)';
            } else if (rawType.includes('HOLIDAY') || fest.isPublicHoliday) {
              categoryTag = 'Public Holiday';
              categoryColor = '#60a5fa';
              categoryBg = 'rgba(96, 165, 250, 0.12)';
              categoryBorder = 'rgba(96, 165, 250, 0.35)';
            }

            // Rich festival metadata / community information
            const religionStr = fest.religion && fest.religion !== 'General' ? `${fest.religion} Tradition` : 'Gazetted Observance';
            const holidayTypeStr = fest.isPublicHoliday ? 'Gazetted Public Holiday' : (fest.type === 'NATIONAL' ? 'National Holiday' : 'Festival Holiday');
            const subInfoText = fest.description
              ? (fest.description.length > 38 ? `${fest.description.slice(0, 35)}...` : fest.description)
              : `${holidayTypeStr} · ${religionStr}`;

            // Quick action on right
            let actionHtml = '';
            if (isClosed) {
              actionHtml = `<span style="font-size: 10.5px; color: #34d399; font-weight: 600; white-space: nowrap;">✓ Closed</span>`;
            } else if (isPast) {
              actionHtml = `<span class="lhc-past-badge" style="padding: 1.5px 6px; font-size: 9.5px; border-radius: 4px; white-space: nowrap;">Passed</span>`;
            } else if (isSalonWeeklyOff) {
              actionHtml = `<span style="font-size: 10.5px; color: #38bdf8; font-weight: 600; white-space: nowrap;">💤 Weekly Off</span>`;
            } else {
              actionHtml = `
                <button type="button" class="lhc-btn btn-inspector-close-fest" data-date="${fest.date}" data-name="${fest.name.replace(/"/g, '&quot;')}" data-type="${fest.type || 'FESTIVAL'}" data-icon="${fest.icon || '🪔'}" style="height: 22px; padding: 0 8px; font-size: 10.5px; background: rgba(245, 158, 11, 0.18) !important; border: 1px solid rgba(245, 158, 11, 0.45) !important; color: #fbbf24 !important; font-weight: 700; border-radius: 5px; cursor: pointer; display: inline-flex; align-items: center; gap: 3px; white-space: nowrap;">
                  <span style="font-size: 10px;">🌴</span>
                  <span>Close Salon</span>
                </button>
              `;
            }

            return `
              <div class="leave-history-card" style="padding: 8px 12px; gap: 4px;">
                <!-- Header Row: Date & Status Pill (Strict 1-Line, Compact Font) -->
                <div class="lhc-header-row" style="gap: 6px;">
                  <div class="lhc-header-left" style="gap: 5px;">
                    <span style="font-size: 0.85rem; line-height: 1;">📅</span>
                    <strong style="font-size: 11.5px; font-weight: 700; color: #ffffff; white-space: nowrap !important; letter-spacing: -0.01em;">${dateDisplay}</strong>
                    <span style="font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 4px; color: ${categoryColor}; border: 1px solid ${categoryBorder}; background: ${categoryBg}; text-transform: uppercase; white-space: nowrap !important;">${categoryTag}</span>
                  </div>
                  <div class="lhc-status-pill ${statusClass}" style="font-size: 10px; padding: 2px 7px; gap: 4px;">
                    <span class="lhc-status-dot" style="width: 5px; height: 5px;"></span>
                    <span>${statusTitle}</span>
                  </div>
                </div>

                <!-- Middle Meta Panel: Festival Name on Left, Close Action / Status on Right -->
                <div class="lhc-meta-panel" style="padding: 5px 8px; gap: 3px;">
                  <div class="lhc-meta-row">
                    <div class="lhc-meta-cell lhc-meta-left" style="gap: 5px;">
                      <span style="font-size: 0.95rem; line-height: 1; flex-shrink: 0;">${fest.icon || '🪔'}</span>
                      <strong style="color: #f8fafc; font-size: 11.5px; font-weight: 700; white-space: nowrap !important; overflow: hidden; text-overflow: ellipsis; max-width: 170px;" title="${fest.name}">${fest.name}</strong>
                    </div>
                    <div class="lhc-meta-cell lhc-meta-right">
                      ${actionHtml}
                    </div>
                  </div>

                  <!-- Sub-info: Community Tradition & Salon State -->
                  <div style="display: flex; align-items: center; justify-content: space-between; font-size: 10px; color: #94a3b8; padding-top: 3px; border-top: 1px dashed rgba(255,255,255,0.05); margin-top: 1px;">
                    <span style="display: inline-flex; align-items: center; gap: 4px; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 185px;">
                      <span>🏷️ ${subInfoText}</span>
                    </span>
                    <span style="color: ${operationalColor}; font-weight: 600; font-size: 9.5px; white-space: nowrap; margin-left: 6px;">${operationalText}</span>
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
        <div class="modal-content modal-content-sheet" style="max-width: 560px; padding: 18px 20px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; background: #0f172a; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.75);">
          <div class="sheet-grab-handle"></div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 3px;">
                <span style="font-size: 1.15rem;">🪔</span>
                <h3 style="font-size: 1.05rem; font-weight: 800; color: #fff; margin: 0;">Gazetted Festivals & Observances</h3>
              </div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35); font-size: 0.7rem; font-weight: 700;">
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
        const festType = e.currentTarget.getAttribute('data-type') || 'FESTIVAL';
        const festIcon = e.currentTarget.getAttribute('data-icon') || '🪔';
        closeModal();
        ScheduleDayOffDialog.open({
          initialDate: festDate,
          closureType: 'FESTIVAL',
          reason: festName,
          festivalInfo: { name: festName, type: festType, icon: festIcon, date: festDate },
          salonWorkingHours: salonWorkingHours,
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
