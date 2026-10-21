import { ApiClient } from '../../../api.js';
import { ScheduleDayOffDialog } from '../../salon-settings/schedule-day-off-dialog.js';

/**
 * DateEventsDialog
 * Dedicated Dialog for inspecting and managing all events occurring on a specific date.
 * Triggered by clicking any day tile cell on the calendar grid.
 */
export class DateEventsDialog {
  /**
   * Opens the Date Events Dialog.
   * @param {Object} options
   * @param {Object} options.app - Dashboard application context
   * @param {string} options.dateStr - YYYY-MM-DD
   * @param {string} options.mode - 'SALON' or 'STAFF'
   * @param {string} options.staffId - Specialist ID if in staff mode
   * @param {string} options.staffName - Specialist name if in staff mode
   * @param {Object} options.scheduleData - Raw schedule data from API
   * @param {Function} options.getFestivalForDate - Helper to resolve festival on date
   * @param {Function} options.onRefresh - Callback to refresh calendar
   */
  static open({ app, dateStr, mode = 'SALON', staffId = null, staffName = 'Specialist', scheduleData = null, getFestivalForDate = () => null, onRefresh = () => {} }) {
    const modalContainer = document.getElementById('modal-container') || document.body;
    if (!modalContainer || !dateStr) return;

    const dateObj = new Date(dateStr + 'T00:00:00');
    const dayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const dayOfWeekName = dayNames[dateObj.getDay()];
    const friendlyDate = isNaN(dateObj.getTime())
      ? dateStr
      : dateObj.toLocaleDateString('en-IN', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    const todayISO = new Date().toISOString().split('T')[0];
    const isPast = dateStr < todayISO;
    const isToday = dateStr === todayISO;
    const isStaffMode = mode === 'STAFF';

    const events = [];

    // 1. Salon Closure
    const allClosures = scheduleData?.salonSchedule?.closures || app?.closuresList || [];
    const closure = allClosures.find((c) => {
      const s = String(c.startDate).split('T')[0];
      const e = String(c.endDate).split('T')[0];
      return dateStr >= s && dateStr <= e;
    });

    if (closure) {
      const isEmergency = closure.closureType === 'EMERGENCY_CLOSURE';
      const isPartial = closure.isPartialDay || closure.closureType === 'PARTIAL_DAY';
      let typeLabel = 'Planned Store Holiday';
      let badgeColor = '#f59e0b';
      let badgeBg = 'rgba(245, 158, 11, 0.15)';
      let badgeBorder = 'rgba(245, 158, 11, 0.35)';

      if (isEmergency) {
        typeLabel = 'Emergency Closure';
        badgeColor = '#f87171';
        badgeBg = 'rgba(239, 68, 68, 0.2)';
        badgeBorder = 'rgba(239, 68, 68, 0.4)';
      } else if (isPartial) {
        typeLabel = `Partial Hours (${closure.startTime || '00:00'} - ${closure.endTime || '23:59'})`;
      }

      events.push({
        type: 'closure',
        dotColor: '#f59e0b',
        icon: '🔒',
        title: `Salon Closed: ${closure.reason || 'Store Holiday'}`,
        subtitle: `${typeLabel} · Online bookings and walk-ins are blocked`,
        badgeText: isEmergency ? 'EMERGENCY' : 'CLOSED',
        badgeColor,
        badgeBg,
        badgeBorder,
        closureId: closure.id,
      });
    }

    // 2. Salon Weekly Off
    const salonWeeklyHours = scheduleData?.salonSchedule?.weeklyHours || app?.salonWorkingHours || [];
    const salonDayHour = salonWeeklyHours.find((h) => h.dayOfWeek === dayOfWeekName);
    const isSalonWeeklyOff = salonDayHour ? Boolean(salonDayHour.isClosed || salonDayHour.isOff) : false;

    if (isSalonWeeklyOff) {
      events.push({
        type: 'salon-off',
        dotColor: '#38bdf8',
        icon: '🏛️',
        title: 'Salon Weekly Off',
        subtitle: `Store is routinely closed every ${dayOfWeekName.charAt(0) + dayOfWeekName.slice(1).toLowerCase()}`,
        badgeText: 'ROUTINE OFF',
        badgeColor: '#38bdf8',
        badgeBg: 'rgba(56, 189, 248, 0.15)',
        badgeBorder: 'rgba(56, 189, 248, 0.35)',
      });
    }

    // 3. Specialist Weekly Offs
    if (!isSalonWeeklyOff && !closure) {
      const stylists = scheduleData?.stylists || app?.staffList || [];
      const stylistsOnWeeklyOff = [];

      stylists.forEach((st) => {
        const hoursList = st.weeklyHours || st.workingHours || [];
        const stDay = hoursList.find((h) => h.dayOfWeek === dayOfWeekName);
        if (stDay && (stDay.isWorking === false || stDay.isOff === true || stDay.isClosed === true)) {
          stylistsOnWeeklyOff.push({
            id: st.stylistId || st.id,
            name: st.name,
          });
        }
      });

      if (isStaffMode && staffId) {
        const isOff = stylistsOnWeeklyOff.some((s) => s.id === staffId);
        if (isOff) {
          events.push({
            type: 'staff-off',
            dotColor: '#a855f7',
            icon: '👤',
            title: `${staffName}'s Weekly Routine Off`,
            subtitle: `Specialist takes routine day off every ${dayOfWeekName.charAt(0) + dayOfWeekName.slice(1).toLowerCase()}`,
            badgeText: 'SPECIALIST OFF',
            badgeColor: '#c084fc',
            badgeBg: 'rgba(168, 85, 247, 0.15)',
            badgeBorder: 'rgba(168, 85, 247, 0.35)',
          });
        }
      } else if (stylistsOnWeeklyOff.length > 0) {
        const namesList = stylistsOnWeeklyOff.map((s) => s.name).join(', ');
        events.push({
          type: 'staff-off',
          dotColor: '#a855f7',
          icon: '👤',
          title: `Staff Weekly Off (${stylistsOnWeeklyOff.length} Specialist${stylistsOnWeeklyOff.length > 1 ? 's' : ''})`,
          subtitle: `Specialists off today: ${namesList}`,
          badgeText: `${stylistsOnWeeklyOff.length} OFF`,
          badgeColor: '#c084fc',
          badgeBg: 'rgba(168, 85, 247, 0.15)',
          badgeBorder: 'rgba(168, 85, 247, 0.35)',
        });
      }
    }

    // 4. Staff Approved Leaves
    const rawLeaves = scheduleData?.leaves || [];
    const leavesOnDate = rawLeaves.filter((l) => {
      const s = String(l.startDate).split('T')[0];
      const e = String(l.endDate).split('T')[0];
      if (dateStr < s || dateStr > e) return false;
      if (isStaffMode && staffId && l.stylistId !== staffId) return false;
      return true;
    });

    leavesOnDate.forEach((l) => {
      const typeStr = (l.leaveType || l.reason || 'Leave').replace('_', ' ');
      events.push({
        type: 'staff-leave',
        dotColor: '#f43f5e',
        icon: '🏖️',
        title: `${l.stylistName || staffName} on Approved Leave`,
        subtitle: `${typeStr}${l.reason ? ' — ' + l.reason : ''}`,
        badgeText: 'ON LEAVE',
        badgeColor: '#f87171',
        badgeBg: 'rgba(248, 113, 113, 0.15)',
        badgeBorder: 'rgba(248, 113, 113, 0.35)',
      });
    });

    // 5. Gazetted Festivals
    const festival = typeof getFestivalForDate === 'function' ? getFestivalForDate(dateStr) : null;
    if (festival) {
      events.push({
        type: 'festival',
        dotColor: '#10b981',
        icon: festival.icon || '🪔',
        title: `${festival.name}`,
        subtitle: `${festival.type || 'Gazetted Festival'}${isSalonWeeklyOff || closure ? ' · Salon is closed' : ' · Salon is operating'}`,
        badgeText: 'FESTIVAL',
        badgeColor: '#34d399',
        badgeBg: 'rgba(16, 185, 129, 0.15)',
        badgeBorder: 'rgba(16, 185, 129, 0.35)',
        festivalData: festival,
        canCloseSalon: !closure && !isSalonWeeklyOff && !isPast,
      });
    }

    if (events.length === 0) return;

    modalContainer.innerHTML = `
      <div class="modal-backdrop" style="display: flex; align-items: center; justify-content: center; z-index: 99999; padding: 16px; background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(8px);">
        <div class="modal-content modal-content-sheet" style="max-width: 490px; width: 100%; padding: 22px; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; background: #0f172a; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.75);">
          <div class="sheet-grab-handle"></div>
          
          <!-- Header -->
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 12px;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                <span style="font-size: 1.15rem;">📅</span>
                <h3 style="font-size: 1.05rem; font-weight: 800; color: #fff; margin: 0;">${friendlyDate}</h3>
              </div>
              <div style="display: flex; align-items: center; gap: 6px;">
                <span class="badge" style="background: rgba(255, 255, 255, 0.08); color: #cbd5e1; border: 1px solid rgba(255, 255, 255, 0.12); font-size: 0.68rem; font-weight: 700;">
                  ${events.length} Event${events.length > 1 ? 's' : ''} on this date
                </span>
                ${isToday ? `<span class="badge" style="background: rgba(255, 255, 255, 0.15); color: #fff; font-size: 0.65rem; font-weight: 800;">TODAY</span>` : ''}
                ${isPast ? `<span class="badge" style="background: rgba(148, 163, 184, 0.15); color: #94a3b8; font-size: 0.65rem; font-weight: 700;">PAST DATE</span>` : ''}
              </div>
            </div>
            <button class="close-btn" id="btn-close-date-events-modal" style="width: 28px; height: 28px; font-size: 1.1rem; background: rgba(255,255,255,0.06); border: none; border-radius: 50%; color: #94a3b8; cursor: pointer; display: flex; align-items: center; justify-content: center;">&times;</button>
          </div>

          <!-- Event Cards List -->
          <div style="display: flex; flex-direction: column; gap: 10px; max-height: 400px; overflow-y: auto; padding-right: 4px; margin-bottom: 18px;">
            ${events.map((ev) => `
              <div style="background: rgba(255, 255, 255, 0.035); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 12px 14px; display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;">
                <div style="display: flex; gap: 10px; min-width: 0; flex: 1;">
                  <div style="width: 34px; height: 34px; border-radius: 8px; background: ${ev.badgeBg}; border: 1px solid ${ev.badgeBorder}; display: flex; align-items: center; justify-content: center; font-size: 1.1rem; flex-shrink: 0;">
                    ${ev.icon}
                  </div>
                  <div style="min-width: 0; flex: 1;">
                    <div style="font-size: 0.86rem; font-weight: 800; color: #fff; line-height: 1.3;">
                      ${ev.title}
                    </div>
                    <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 3px; line-height: 1.35;">
                      ${ev.subtitle}
                    </div>
                  </div>
                </div>
                <div style="flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 6px;">
                  <span class="badge" style="background: ${ev.badgeBg}; color: ${ev.badgeColor}; border: 1px solid ${ev.badgeBorder}; font-size: 0.65rem; font-weight: 800; text-transform: uppercase;">
                    ${ev.badgeText}
                  </span>
                  ${ev.closureId && !isStaffMode ? `
                    <button type="button" class="btn btn-secondary btn-sm btn-reopen-closure-date" data-id="${ev.closureId}" style="font-size: 0.68rem; padding: 3px 8px; color: #f87171; border-color: rgba(248, 113, 113, 0.4); white-space: nowrap;">
                      🗑️ Reopen
                    </button>
                  ` : ''}
                  ${ev.canCloseSalon && !isStaffMode ? `
                    <button type="button" class="btn btn-secondary btn-sm btn-close-salon-festival-date" data-date="${dateStr}" data-name="${(ev.festivalData?.name || '').replace(/"/g, '&quot;')}" style="font-size: 0.68rem; padding: 3px 8px; color: #34d399; border-color: rgba(16, 185, 129, 0.4); white-space: nowrap;">
                      + Close Salon
                    </button>
                  ` : ''}
                </div>
              </div>
            `).join('')}
          </div>

          <!-- Footer -->
          <div style="display: flex; justify-content: flex-end; gap: 8px;">
            <button type="button" class="btn btn-secondary btn-sm" id="btn-done-date-events" style="font-size: 0.78rem; font-weight: 700; padding: 6px 14px;">
              Close
            </button>
          </div>
        </div>
      </div>
    `;

    const closeModal = () => (modalContainer.innerHTML = '');
    document.getElementById('btn-close-date-events-modal')?.addEventListener('click', closeModal);
    document.getElementById('btn-done-date-events')?.addEventListener('click', closeModal);
    modalContainer.querySelector('.modal-backdrop')?.addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeModal();
    });

    modalContainer.querySelectorAll('.btn-reopen-closure-date').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        if (confirm('Are you sure you want to cancel this closure and reopen the booking calendar for these dates?')) {
          try {
            await ApiClient.deleteSalonClosure(id);
            if (app?.showToast) app.showToast('Closure cancelled and calendar reopened.', 'success');
            closeModal();
            await onRefresh();
          } catch (err) {
            if (app?.showToast) app.showToast(err.message || 'Failed to cancel closure.', 'error');
          }
        }
      });
    });

    modalContainer.querySelectorAll('.btn-close-salon-festival-date').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const festDate = e.currentTarget.getAttribute('data-date');
        const festName = e.currentTarget.getAttribute('data-name');
        closeModal();
        ScheduleDayOffDialog.open({
          initialDate: festDate,
          festivalInfo: { name: festName },
          salonWorkingHours: app?.salonWorkingHours || [],
          existingClosures: allClosures || [],
          staffList: app?.staffList || [],
          onSuccess: async () => {
            await onRefresh();
          },
        });
      });
    });
  }
}
