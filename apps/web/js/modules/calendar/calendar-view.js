import { ApiClient } from '../../api.js';
import * as IndianFestivals from '@aryanjsx/indian-festivals';
import { Icons } from '../../icons.js';
import { ClosureDialog } from './dialogs/closure-dialog.js';
import { SalonWeeklyOffDialog } from './dialogs/salon-weekly-off-dialog.js';
import { StaffWeeklyOffDialog } from './dialogs/staff-weekly-off-dialog.js';
import { StaffLeaveDialog } from './dialogs/staff-leave-dialog.js';
import { FestivalDialog } from './dialogs/festival-dialog.js';
import { DateEventsDialog } from './dialogs/date-events-dialog.js';
import { ScheduleDayOffDialog } from '../salon-settings/schedule-day-off-dialog.js';
import { StaffApplyLeaveDialog } from '../staff/staff-apply-leave-dialog.js';
export function getFestivalIcon(name = '', religion = '') {
  const lower = String(name || '').toLowerCase();
  if (lower.includes('diwali') || lower.includes('deepavali')) return '🪔';
  if (lower.includes('dhanteras')) return '🪙';
  if (lower.includes('dussehra') || lower.includes('vijayadashami')) return '🏹';
  if (lower.includes('durga puja') || lower.includes('navratri')) return '🌸';
  if (lower.includes('holi')) return '🎨';
  if (lower.includes('raksha bandhan')) return '🧵';
  if (lower.includes('janmashtami')) return '🪈';
  if (lower.includes('ganesh')) return '🐘';
  if (lower.includes('shivratri')) return '🔱';
  if (lower.includes('republic') || lower.includes('independence') || lower.includes('gandhi') || lower.includes('unity') || lower.includes('constitution')) return '🇮🇳';
  if (lower.includes('eid') || lower.includes('muharram') || lower.includes('ramadan') || lower.includes('bakrid')) return '🌙';
  if (lower.includes('christmas') || lower.includes('easter') || lower.includes('good friday') || lower.includes('saints')) return '🎄';
  if (lower.includes('guru') || lower.includes('baisakhi') || lower.includes('bandi') || lower.includes('lohri')) return '🪯';
  if (lower.includes('buddha') || lower.includes('dhammachakra')) return '☸️';
  if (lower.includes('mahavir') || lower.includes('jain')) return '🕊️';
  if (lower.includes('karwa chauth')) return '🌙';
  if (lower.includes('chhath')) return '☀️';
  if (lower.includes('bhai dooj')) return '✨';
  if (lower.includes('govardhan')) return '🏔️';
  if (lower.includes('onam') || lower.includes('pongal') || lower.includes('makar')) return '🌾';
  if (lower.includes('children')) return '🎈';
  if (religion === 'National') return '🇮🇳';
  if (religion === 'Hindu') return '🪔';
  return '🎉';
}

/**
 * CalendarView
 * Reusable, reactive calendar component for StyleSlot.
 * Powers both Salon Holidays/Days Off and Specialist Leaves views.
 * Handles fresh API fetching, accurate leave counting, and complete event interactivity.
 */
export class CalendarView {
  constructor(options = {}) {
    this.app = options.app || null;
    this.container = null;
    this.calendarFor = options.calendarFor || 'SALON';
    this.staffId = options.staffId || null;
    this.staffName = options.staffName || 'Specialist';

    const now = new Date();
    this.year = options.year || this.app?.calYear || now.getFullYear();
    this.month = options.month !== undefined ? options.month : (this.app?.calMonth !== undefined ? this.app.calMonth : now.getMonth());
    this.selectedDate = this._todayISO();
    this.activeOverviewTab = options.activeOverviewTab || (this.calendarFor === 'STAFF' ? 'LEAVES' : 'HOLIDAYS');
    this.scheduleData = null;
  }

  _todayISO(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  _toast(msg, type = 'info') {
    if (this.app?.showToast) this.app.showToast(msg, type);
  }

  static async mount(container, options = {}) {
    const view = new CalendarView(options);
    await view.mount(container);
    return view;
  }

  async mount(container, opts = {}) {
    if (!container) return;
    this.container = container;
    if (this.app) this.app.currentCalendarView = this;
    if (opts.calendarFor !== undefined) this.calendarFor = opts.calendarFor;
    if (opts.staffId !== undefined) this.staffId = opts.staffId;
    if (opts.staffName !== undefined) this.staffName = opts.staffName;

    await this.refresh();
  }

  async refresh() {
    this._showLoading();
    await this.fetchFreshSchedule();
    this.render();
    this.attachListeners();
  }

  _showLoading() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:360px;gap:14px;color:#a5b4fc;">
        <div style="width:38px;height:38px;border:3px solid rgba(165,180,252,0.2);border-top-color:#818cf8;border-radius:50%;animation:spin .8s linear infinite;"></div>
        <div style="font-size:0.88rem;font-weight:600;color:#cbd5e1;">Loading live calendar...</div>
      </div>`;
  }

  async fetchFreshSchedule() {
    const targetMonth = `${this.year}-${String(this.month + 1).padStart(2, '0')}`;
    const isStaff = this.calendarFor === 'STAFF' && !!this.staffId;
    try {
      const res = await ApiClient.getCalendarSchedule({
        month: targetMonth,
        calendarFor: isStaff ? 'STAFF' : 'SALON',
        ...(isStaff ? { staffId: this.staffId } : {}),
      }, true);

      const schedule = (res && res.data !== undefined) ? res.data : res;
      if (schedule) {
        this.scheduleData = schedule;
        if (this.app) {
          this.app.calendarSchedule = schedule;
          if (schedule.salonSchedule?.closures) this.app.closuresList = schedule.salonSchedule.closures;
          if (schedule.salonSchedule?.weeklyHours) this.app.salonWorkingHours = schedule.salonSchedule.weeklyHours;
        }
      }
    } catch (err) {
      console.warn('[CalendarView] fetchFreshSchedule error:', err);
    }
  }

  async changeMonth(delta) {
    this.month += delta;
    if (this.month < 0) {
      this.month = 11;
      this.year--;
    } else if (this.month > 11) {
      this.month = 0;
      this.year++;
    }
    if (this.app) {
      this.app.calYear = this.year;
      this.app.calMonth = this.month;
    }
    this._showLoading();
    await this.fetchFreshSchedule();
    this.render();
    this.attachListeners();
  }

  async goToToday() {
    const now = new Date();
    this.year = now.getFullYear();
    this.month = now.getMonth();
    this.selectedDate = this._todayISO(now);
    if (this.app) {
      this.app.calYear = this.year;
      this.app.calMonth = this.month;
    }
    this._showLoading();
    await this.fetchFreshSchedule();
    this.render();
    this.attachListeners();
  }

  getFestivalsList(y = this.year, m = this.month) {
    if (Array.isArray(this.scheduleData?.festivals) && this.scheduleData.festivals.length > 0) {
      const prefix = `${y}-${String(m + 1).padStart(2, '0')}`;
      const match = this.scheduleData.festivals.filter((f) => f.date && f.date.startsWith(prefix));
      if (match.length > 0) return match;
    }
    try {
      const data = IndianFestivals.getFestivalsByMonth(m + 1, y);
      return (data?.festivals || []).map((f) => ({
        date: f.date,
        name: f.name,
        festivalId: f.festivalId || null,
        icon: getFestivalIcon(f.name, f.religion),
        type: f.religion === 'National' ? 'NATIONAL' : 'FESTIVAL',
        religion: f.religion || 'General',
        isPublicHoliday: f.religion === 'National' || f.festivalId === 'diwali' || f.festivalId === 'holi',
        source: '@aryanjsx/indian-festivals',
      }));
    } catch {
      return [];
    }
  }

  getFestivalForDate(dateStr) {
    if (!dateStr) return null;
    const [yS, mS] = dateStr.split('-');
    return this.getFestivalsList(+yS, +mS - 1).find((f) => f.date === dateStr) || null;
  }

  _computeGrid() {
    const { year, month } = this;
    const isStaff = this.calendarFor === 'STAFF' && !!this.staffId;
    const staffId = this.staffId;
    const todayISO = this._todayISO();
    const mStr = String(month + 1).padStart(2, '0');
    const totalDays = new Date(year, month + 1, 0).getDate();
    const monthStart = `${year}-${mStr}-01`;
    const monthEnd = `${year}-${mStr}-${String(totalDays).padStart(2, '0')}`;
    const dayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

    let monthHolidayCount = 0;
    let monthFestivalCount = 0;
    let monthSalonOffCount = 0;
    let monthStaffOffCount = 0;

    // Accurate leaves list from schedule data
    const rawLeaves = this.scheduleData?.leaves || [];
    let allMonthLeaves = rawLeaves.filter((l) => {
      const s = String(l.startDate).split('T')[0];
      const e = String(l.endDate).split('T')[0];
      if (s > monthEnd || e < monthStart) return false;
      if (l.status === 'CANCELLED') return false;
      if (isStaff && staffId) return l.stylistId === staffId;
      return true;
    });

    // Fallback to app.staffList
    if (allMonthLeaves.length === 0 && this.app?.staffList) {
      const sourceList = isStaff ? this.app.staffList.filter((s) => s.id === staffId) : this.app.staffList;
      sourceList.forEach((st) => {
        (st.absences || []).forEach((ab) => {
          if (ab.status !== 'ACTIVE') return;
          const s = String(ab.startDate || '').split('T')[0];
          const e = String(ab.endDate || '').split('T')[0];
          if (s <= monthEnd && e >= monthStart) {
            allMonthLeaves.push({
              id: ab.id,
              stylistId: st.id,
              stylistName: st.name,
              startDate: s,
              endDate: e,
              leaveType: ab.leaveType,
              reason: ab.reason,
              status: 'ACTIVE',
            });
          }
        });
      });
    }

    const firstDayJs = new Date(year, month, 1).getDay();
    const startOffset = (firstDayJs + 6) % 7;
    const prevMonthDays = new Date(year, month, 0).getDate();
    const cells = [];

    // Leading padding
    for (let i = startOffset - 1; i >= 0; i--) {
      cells.push({ dayNum: prevMonthDays - i, isPadding: true, dateKey: '' });
    }

    // Month days
    for (let d = 1; d <= totalDays; d++) {
      const dStr = String(d).padStart(2, '0');
      const dateKey = `${year}-${mStr}-${dStr}`;
      const cellDate = new Date(year, month, d);
      const dow = dayNames[cellDate.getDay()];
      const isToday = dateKey === todayISO;
      const isPast = dateKey < todayISO;

      // Salon Weekly Off
      const salonHour = (this.scheduleData?.salonSchedule?.weeklyHours || this.app?.salonWorkingHours || []).find((h) => h.dayOfWeek === dow);
      const isSalonOff = salonHour ? Boolean(salonHour.isClosed || salonHour.isOff) : false;
      if (isSalonOff) monthSalonOffCount++;

      // Salon Scheduled Closure
      const closures = this.scheduleData?.salonSchedule?.closures || this.app?.closuresList || [];
      const closure = closures.find((c) => {
        const s = String(c.startDate).split('T')[0];
        const e = String(c.endDate).split('T')[0];
        return dateKey >= s && dateKey <= e;
      });
      if (closure) monthHolidayCount++;

      // Staff Weekly Offs
      const stOnOff = [];
      (this.scheduleData?.stylists || this.app?.staffList || []).forEach((st) => {
        const hrs = st.weeklyHours || st.workingHours || [];
        const stDay = hrs.find((h) => h.dayOfWeek === dow);
        if (stDay && (stDay.isWorking === false || stDay.isOff === true || stDay.isClosed === true)) {
          const sid = st.stylistId || st.id;
          if (!stOnOff.some((s) => s.stylistId === sid)) {
            stOnOff.push({ stylistId: sid, name: st.name, profileImageUrl: st.profileImageUrl });
          }
        }
      });

      const isCurrentStOff = isStaff && staffId ? stOnOff.some((s) => s.stylistId === staffId) : false;
      if (!isSalonOff && !closure) {
        if (isStaff) {
          if (isCurrentStOff) monthStaffOffCount++;
        } else {
          if (stOnOff.length > 0) monthStaffOffCount++;
        }
      }

      // Leaves on this day
      const leavesOnDate = allMonthLeaves.filter((l) => {
        const s = String(l.startDate).split('T')[0];
        const e = String(l.endDate).split('T')[0];
        return dateKey >= s && dateKey <= e;
      });
      const stylistLeave = isStaff ? (leavesOnDate[0] || null) : null;

      // Festival
      const festival = this.getFestivalForDate(dateKey);
      if (festival) monthFestivalCount++;

      cells.push({
        dayNum: d,
        isPadding: false,
        dateKey,
        isToday,
        isPast,
        closure,
        isSalonWeeklyOff: isSalonOff,
        stylistsOnWeeklyOff: stOnOff,
        isCurrentStylistWeeklyOff: isCurrentStOff,
        leaves: leavesOnDate,
        stylistLeave,
        festival,
      });
    }

    // Trailing padding
    const rem = (7 - (cells.length % 7)) % 7;
    for (let p = 1; p <= rem; p++) {
      cells.push({ dayNum: p, isPadding: true, dateKey: '' });
    }

    return {
      cells,
      allMonthLeaves,
      monthLeaveCount: allMonthLeaves.length, // Accurate count!
      monthHolidayCount,
      monthFestivalCount,
      monthSalonOffCount,
      monthStaffOffCount,
    };
  }

  _cellHtml(c, isStaff) {
    if (c.isPadding) {
      return `<div class="holiday-cal-day-cell is-padding-day"><span class="cal-day-number">${c.dayNum}</span></div>`;
    }

    const dots = [];
    if (c.closure) {
      dots.push({ type: 'closure', color: '#f59e0b', title: `Salon Closed: ${c.closure.reason || 'Closed'}` });
    }
    if (c.isSalonWeeklyOff) {
      dots.push({ type: 'salon-off', color: '#38bdf8', title: 'Salon Weekly Off' });
    }
    if (isStaff && c.stylistLeave) {
      dots.push({ type: 'staff-leave', color: '#f43f5e', title: `My Leave: ${(c.stylistLeave.leaveType || 'Leave').replace('_', ' ')}` });
    } else if (!isStaff && c.leaves && c.leaves.length > 0) {
      const label = c.leaves.length > 1 ? `${c.leaves.length} Staff on Leave` : `Leave: ${c.leaves[0].stylistName}`;
      dots.push({ type: 'staff-leave', color: '#f43f5e', title: label });
    }
    if (c.isCurrentStylistWeeklyOff && !c.isSalonWeeklyOff && !c.closure) {
      dots.push({ type: 'staff-off', color: '#a855f7', title: 'Specialist Weekly Off' });
    } else if (!isStaff && c.stylistsOnWeeklyOff?.length > 0 && !c.isSalonWeeklyOff && !c.closure) {
      dots.push({ type: 'staff-off', color: '#a855f7', title: `${c.stylistsOnWeeklyOff.length} Staff Weekly Off` });
    }
    if (c.festival) {
      dots.push({ type: 'festival', color: '#10b981', title: c.festival.name });
    }

    const classes = ['holiday-cal-day-cell'];
    if (dots.length > 0) classes.push('has-event-tile');
    if (c.isPast) classes.push('is-past');
    if (c.isToday) classes.push('is-today');

    const dotsHtml = dots.length > 0
      ? `<div class="cal-cell-dots-row">${dots.slice(0, 3).map((d) => `<span class="cal-event-dot dot-${d.type}" style="background-color: ${d.color};" title="${d.title}"></span>`).join('')}</div>`
      : '';
    const absId = c.stylistLeave ? (c.stylistLeave.id || '') : '';

    return `
      <div class="${classes.join(' ')}" data-date="${c.dateKey}" data-absence-id="${absId}" title="${c.dateKey}">
        <span class="cal-day-number">${c.dayNum}</span>
        ${dotsHtml}
      </div>`;
  }

  _legendHtml(counts, isStaff) {
    const items = [
      { cat: 'CLOSED', dot: 'dot-yellow', title: 'Closed', count: counts.monthHolidayCount },
      { cat: 'SALON_OFF', dot: 'dot-skyblue', title: 'Salon W-Off', count: counts.monthSalonOffCount },
      { cat: 'STAFF_OFF', dot: 'dot-violet', title: 'Staff W-Off', count: counts.monthStaffOffCount },
      { cat: 'STAFF_LEAVE', dot: 'dot-red', title: 'Staff Leave', count: counts.monthLeaveCount },
      { cat: 'FESTIVAL', dot: 'dot-green', title: 'Festival', count: counts.monthFestivalCount },
    ];
    const chipClass = isStaff ? 'dot-legend-item' : 'cal-legend-chip';

    return items.map((i) => `
      <div class="${chipClass} ${i.cat === 'CLOSED' ? 'chip-closed' : ''} legend-clickable" data-category="${i.cat}" role="button" tabindex="0" title="Inspect ${i.title}">
        <span class="legend-chip-content">
          <span class="${isStaff ? 'legend-dot' : 'legend-chip-dot'} ${i.dot}"></span>
          <span class="legend-chip-title">${i.title}</span>
        </span>
        <span class="legend-count-num">${i.count}</span>
      </div>
    `).join('') + `
      <div class="${chipClass} chip-today" title="Today">
        <span class="legend-chip-content">
          <span class="${isStaff ? 'legend-dot' : 'legend-chip-dot'} dot-today"></span>
          <span class="legend-chip-title">Today</span>
        </span>
      </div>`;
  }

  _sidePanelHtml(counts, allMonthLeaves, isStaff) {
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const mn = monthNames[this.month];
    const mStr = String(this.month + 1).padStart(2, '0');
    const todayISO = this._todayISO();

    const closures = this.scheduleData?.salonSchedule?.closures || this.app?.closuresList || [];
    const monthClosures = closures.filter((c) => {
      const s = String(c.startDate).split('T')[0];
      const e = String(c.endDate).split('T')[0];
      const [sy, sm] = s.split('-');
      const [ey, em] = e.split('-');
      return (sy == this.year && sm == mStr) || (ey == this.year && em == mStr) || (s <= `${this.year}-${mStr}-01` && e >= `${this.year}-${mStr}-28`);
    });

    const upcomingFestivals = (this.getFestivalsList() || []).filter((f) => f.date >= todayISO).slice(0, 4);

    return `
      <!-- Card 1: Closures or Leaves -->
      <div class="cal-side-card">
        <div class="cal-management-header">
          <div class="cal-management-title">
            <span>${isStaff ? '🏖️ Leave Records' : '🌴 Scheduled Closures'}</span>
            <span class="cal-management-pill-count">${isStaff ? `${allMonthLeaves.length} Scheduled` : `${monthClosures.length} in ${mn}`}</span>
          </div>
          ${!isStaff ? `
            <button type="button" class="btn btn-secondary btn-sm" id="btn-quick-add-holiday" style="font-size:0.68rem;padding:2px 7px;color:#fbbf24;border-color:rgba(245,158,11,0.35);">+ Add Holiday</button>
          ` : `
            <button type="button" class="btn btn-secondary btn-sm" id="btn-quick-add-staff-leave" data-staff-id="${this.staffId || ''}" data-staff-name="${(this.staffName || '').replace(/"/g, '&quot;')}" style="font-size:0.68rem;padding:3px 8px;color:#34d399;border-color:rgba(52,211,153,0.35);background:rgba(52,211,153,0.1);">➕ Add Leave</button>
          `}
        </div>

        ${isStaff ? `
          <div style="font-size:0.72rem;color:#94a3b8;margin-bottom:6px;">Leaves for ${this.staffName} in ${mn}.</div>
          ${allMonthLeaves.length === 0 ? `
            <div style="text-align:center;padding:18px 8px;font-size:0.76rem;color:#94a3b8;"><div style="font-size:1.5rem;margin-bottom:4px;">✨</div><strong>${this.staffName} has no leaves!</strong><br><span style="font-size:0.68rem;color:#64748b;">No leaves in ${mn}.</span></div>
          ` : `
            <div class="staff-leaves-list">
              ${allMonthLeaves.map((l) => {
                const sf = new Date((l.startDate || '') + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                const ef = new Date((l.endDate || '') + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                const dd = sf === ef ? sf : `${sf} → ${ef}`;
                const past = (l.endDate || '') < todayISO;
                const init = (l.stylistName || this.staffName || 'ST').split(' ').map((n) => n[0]).slice(0, 2).join('').toUpperCase();
                return `
                  <div class="staff-leave-card">
                    <div class="staff-leave-info">
                      <div class="staff-avatar-initials">${init}</div>
                      <div class="staff-leave-meta">
                        <div class="staff-leave-name-row">
                          <span>${l.stylistName || this.staffName}</span>
                          <span class="staff-leave-type-pill">${(l.leaveType || 'LEAVE').replace('_', ' ')}</span>
                        </div>
                        <div class="staff-leave-date-str">📅 ${dd}</div>
                        ${l.reason ? `<div class="staff-leave-reason-str">"${l.reason}"</div>` : ''}
                      </div>
                    </div>
                    <div>
                      ${past ? '<span style="font-size:0.65rem;color:#64748b;padding:2px 6px;">Passed</span>' : `
                        <button type="button" class="btn-cancel-leave" data-staff-id="${l.stylistId || this.staffId}" data-absence-id="${l.id || l.absenceId}" data-staff-name="${(l.stylistName || this.staffName).replace(/"/g, '&quot;')}">🗑️ Cancel</button>
                      `}
                    </div>
                  </div>`;
              }).join('')}
            </div>
          `}
        ` : `
          ${monthClosures.length === 0 ? `
            <div style="text-align:center;padding:16px 6px;font-size:0.74rem;color:#94a3b8;">🌴 No salon closures scheduled in ${mn}.</div>
          ` : `
            <div style="display:flex;flex-direction:column;gap:8px;max-height:240px;overflow-y:auto;padding-right:2px;">
              ${monthClosures.map((c) => {
                const sf = new Date(c.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                const ef = new Date(c.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                const dd = sf === ef ? sf : `${sf} → ${ef}`;
                const isEmergency = c.closureType === 'EMERGENCY_CLOSURE';
                const isPast = String(c.endDate).split('T')[0] < todayISO;
                return `
                  <div style="background:rgba(255,255,255,0.025);border:1px solid rgba(255,255,255,0.06);border-radius:8px;padding:8px 10px;display:flex;justify-content:space-between;align-items:center;gap:6px;">
                    <div style="min-width:0;">
                      <div style="font-size:0.76rem;font-weight:700;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                        ${isEmergency ? '🚨' : '🌴'} ${c.reason || 'Store Closure'}
                        <span class="badge ${isEmergency ? 'badge-cancelled' : 'badge-completed'}" style="font-size:0.58rem;margin-left:3px;">${isEmergency ? 'Emergency' : 'Holiday'}</span>
                      </div>
                      <div style="font-size:0.68rem;color:#94a3b8;">${dd}</div>
                    </div>
                    <div>
                      ${isPast ? '<span style="font-size:0.65rem;color:#64748b;padding:2px 6px;">Passed</span>' : `
                        <button type="button" class="btn btn-secondary btn-sm btn-delete-closure-direct" data-id="${c.id}" style="padding:2px 7px;font-size:0.68rem;border-color:rgba(239,68,68,0.35);color:#f87171;white-space:nowrap;">🗑️ Reopen</button>
                      `}
                    </div>
                  </div>`;
              }).join('')}
            </div>
          `}
        `}
      </div>

      <!-- Card 2: Upcoming Recognized Festivals -->
      <div class="cal-side-card">
        <div class="cal-side-header">
          <span style="color:#d8b4fe;">🪔 Upcoming Recognized Festivals</span>
          <span style="font-size:0.65rem;color:#a855f7;font-weight:700;">AUTO-DETECT</span>
        </div>
        <div class="festivals-list-container">
          ${upcomingFestivals.length === 0 ? `
            <div style="font-size:0.74rem;color:#94a3b8;text-align:center;padding:12px 0;">No upcoming festivals.</div>
          ` : upcomingFestivals.map((f) => {
            const isClosed = monthClosures.some((c) => {
              const s = String(c.startDate).split('T')[0];
              const e = String(c.endDate).split('T')[0];
              return f.date >= s && f.date <= e;
            });
            const festDow = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][new Date(f.date + 'T00:00:00').getDay()];
            const isWeeklyOff = f.isSalonWeeklyOff !== undefined
              ? f.isSalonWeeklyOff
              : (this.scheduleData?.salonSchedule?.weeklyHours || this.app?.salonWorkingHours || []).find((h) => h.dayOfWeek === festDow)?.isClosed ?? false;
            const df = new Date(f.date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
            return `
              <div class="festival-item-row">
                <div class="festival-item-info">
                  <span class="festival-item-name">${f.icon || '🪔'} ${f.name}</span>
                  <span class="festival-item-date">${df} · ${f.type}</span>
                </div>
                <div>
                  ${isClosed ? '<span class="btn-declare-festival is-already-closed">✓ Closed</span>' : (isWeeklyOff ? '<span class="btn-declare-festival is-already-closed" style="color:#38bdf8;border-color:rgba(56,189,248,0.35);background:rgba(56,189,248,0.1);">💤 Weekly Off</span>' : (!isStaff ? `
                    <button type="button" class="btn-declare-festival btn-quick-declare-festival" data-date="${f.date}" data-name="${f.name.replace(/"/g, '&quot;')}" data-type="${f.type || 'FESTIVAL'}" data-icon="${f.icon || '🪔'}">+ Close Salon</button>
                  ` : '<span style="font-size:0.68rem;color:#a855f7;">Festival</span>'))}
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  render() {
    if (!this.container) return;
    const isStaff = this.calendarFor === 'STAFF' && !!this.staffId;
    const { cells, allMonthLeaves, monthLeaveCount, monthHolidayCount, monthFestivalCount, monthSalonOffCount, monthStaffOffCount } = this._computeGrid();
    const counts = {
      monthLeaveCount: this.scheduleData?.summaryCounts?.staffLeavesCount ?? monthLeaveCount,
      monthHolidayCount: this.scheduleData?.summaryCounts?.closuresCount ?? monthHolidayCount,
      monthFestivalCount: this.scheduleData?.summaryCounts?.festivalsCount ?? monthFestivalCount,
      monthSalonOffCount: this.scheduleData?.summaryCounts?.salonWeeklyOffCount ?? monthSalonOffCount,
      monthStaffOffCount: this.scheduleData?.summaryCounts?.staffWeeklyOffCount ?? monthStaffOffCount,
    };

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const currentMonthTitle = `${monthNames[this.month]} ${this.year}`;
    const cellsHtml = cells.map((c) => this._cellHtml(c, isStaff)).join('');
    const weekdaysHtml = `
      <div class="holiday-cal-weekday-label">M</div>
      <div class="holiday-cal-weekday-label">T</div>
      <div class="holiday-cal-weekday-label">W</div>
      <div class="holiday-cal-weekday-label">T</div>
      <div class="holiday-cal-weekday-label">F</div>
      <div class="holiday-cal-weekday-label">S</div>
      <div class="holiday-cal-weekday-label">S</div>`;

    const navHtml = `
      <div class="cal-nav-header-row ${isStaff ? 'stylist-cal-top-row' : ''}">
        <div class="cal-nav-month-group">
          <svg class="cal-header-calendar-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#a5b4fc" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="16" y1="2" x2="16" y2="6"></line>
            <line x1="8" y1="2" x2="8" y2="6"></line>
            <line x1="3" y1="10" x2="21" y2="10"></line>
          </svg>
          <h4 class="holiday-cal-month-title ${isStaff ? 'stylist-cal-month-heading' : ''}">${currentMonthTitle}</h4>
        </div>
        <div class="cal-nav-actions-group ${isStaff ? 'stylist-cal-quick-actions' : ''}">
          <button type="button" class="cal-nav-today-btn" id="btn-cal-today">Today</button>
          ${isStaff ? `
            <button type="button" class="cal-history-pill-btn btn-view-leave-history" id="btn-view-leave-history" data-staff-id="${this.staffId}" data-staff-name="${(this.staffName || '').replace(/"/g, '&quot;')}" title="View leave history">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
              <span>History</span>
            </button>
          ` : ''}
          <button type="button" class="cal-nav-btn" id="btn-cal-prev" aria-label="Previous Month">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
          </button>
          <button type="button" class="cal-nav-btn" id="btn-cal-next" aria-label="Next Month">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
          </button>
        </div>
      </div>`;

    const legendHtml = this._legendHtml(counts, isStaff);
    const sidePanelHtml = this._sidePanelHtml(counts, allMonthLeaves, isStaff);

    if (isStaff) {
      // STAFF MODE LAYOUT
      this.container.innerHTML = `
        <div class="staff-cal-container" data-cal-mode="STAFF" data-staff-id="${this.staffId || ''}">
          <div class="stylist-cal-card">
            ${navHtml}
            <button type="button" class="btn-cal-full-apply btn-action-apply-leave" id="btn-apply-staff-leave" data-staff-id="${this.staffId}" data-staff-name="${(this.staffName || '').replace(/"/g, '&quot;')}">
              <span class="btn-plus-sym">＋</span>
              <span>Apply Leave</span>
            </button>
            <div class="stylist-cal-context-bar">
              <div class="stylist-cal-dot-legend">${legendHtml}</div>
            </div>
            <div class="holiday-cal-weekdays stylist-cal-weekdays">${weekdaysHtml}</div>
            <div class="holiday-cal-grid stylist-cal-grid">${cellsHtml}</div>
          </div>
          <div class="holiday-cal-side" id="holiday-management-section">
            ${sidePanelHtml}
          </div>
        </div>`;
    } else {
      // SALON MODE LAYOUT
      this.container.innerHTML = `
        <div class="settings-panel-card holiday-panel-card" data-cal-mode="SALON">
          <div class="settings-panel-header holiday-header-compact">
            <div class="settings-header-left">
              <div class="settings-header-icon" style="background:rgba(245,158,11,0.15);color:#fbbf24;width:34px;height:34px;border-radius:8px;">
                ${Icons.calendar ? Icons.calendar({ size: 18 }) : '🌴'}
              </div>
              <div>
                <h3 class="settings-panel-title" style="font-size:1.02rem;margin:0;">Holidays & Days Off</h3>
                <p class="settings-panel-subtitle holiday-subtitle-desktop" style="margin:0;font-size:0.72rem;color:#94a3b8;">Festivals, planned off-days & specialist leaves</p>
              </div>
            </div>
            <button type="button" class="btn btn-primary btn-sm btn-schedule-top" id="btn-add-holiday-closure">➕ Schedule Day Off</button>
          </div>

          <div class="settings-panel-body" style="gap:8px;">
            <div class="holiday-cal-layout">
              <div class="holiday-cal-main">
                <div class="holiday-cal-grid-wrapper">
                  <div class="holiday-cal-header-card">
                    ${navHtml}
                    <div class="cal-legend-strip">${legendHtml}</div>
                  </div>
                  <div class="holiday-cal-weekdays">${weekdaysHtml}</div>
                  <div class="holiday-cal-grid">${cellsHtml}</div>
                </div>
              </div>
              <div class="holiday-cal-side" id="holiday-management-section">
                ${sidePanelHtml}
              </div>
            </div>
          </div>
        </div>`;
    }
  }

  _openScheduleDayOff(targetDate = null) {
    ScheduleDayOffDialog.open({
      initialDate: targetDate || this.selectedDate || this._todayISO(),
      salonWorkingHours: this.scheduleData?.salonSchedule?.weeklyHours || this.app?.salonWorkingHours || [],
      existingClosures: this.scheduleData?.salonSchedule?.closures || this.app?.closuresList || [],
      staffList: this.app?.staffList || [],
      onSuccess: async () => {
        this._toast('Day off scheduled!', 'success');
        this._showLoading();
        await this.fetchFreshSchedule();
        this.render();
        this.attachListeners();
      },
    });
  }

  _openApplyLeave(targetDate = null) {
    StaffApplyLeaveDialog.open({
      staffId: this.staffId || null,
      staffName: this.staffName || 'Specialist',
      initialDate: targetDate || this.selectedDate || this._todayISO(),
      showModeSwitch: !this.staffId,
      salonWorkingHours: this.scheduleData?.salonSchedule?.weeklyHours || this.app?.salonWorkingHours || [],
      staffList: this.app?.staffList || [],
      onSuccess: async () => {
        this._toast('Specialist leave recorded!', 'success');
        this._showLoading();
        await this.fetchFreshSchedule();
        this.render();
        this.attachListeners();
      },
    });
  }

  attachListeners() {
    if (!this.container) return;
    const $ = (sel) => this.container.querySelector(sel);
    const $$ = (sel) => this.container.querySelectorAll(sel);

    $('#btn-cal-prev')?.addEventListener('click', () => this.changeMonth(-1));
    $('#btn-cal-next')?.addEventListener('click', () => this.changeMonth(1));
    $('#btn-cal-today')?.addEventListener('click', () => this.goToToday());

    $('#btn-add-holiday-closure')?.addEventListener('click', () => this._openScheduleDayOff());
    $('#btn-quick-add-holiday')?.addEventListener('click', () => this._openScheduleDayOff());

    $('#btn-apply-staff-leave')?.addEventListener('click', () => this._openApplyLeave());
    $('#btn-quick-add-staff-leave')?.addEventListener('click', () => this._openApplyLeave());

    $$('.btn-view-leave-history').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sid = btn.getAttribute('data-staff-id') || this.staffId;
        const sname = btn.getAttribute('data-staff-name') || this.staffName;
        this.app?.leaveUI?.showLeaveHistoryModal?.(sid, sname);
      });
    });

    $$('.legend-clickable[data-category]').forEach((chip) => {
      const handler = (e) => {
        e.stopPropagation();
        const cat = chip.getAttribute('data-category');
        const DIALOGS = {
          CLOSED: ClosureDialog,
          SALON_OFF: SalonWeeklyOffDialog,
          STAFF_OFF: StaffWeeklyOffDialog,
          STAFF_LEAVE: StaffLeaveDialog,
          FESTIVAL: FestivalDialog,
        };
        const DialogClass = DIALOGS[cat];
        if (DialogClass) {
          DialogClass.open({
            app: this.app,
            year: this.year,
            month: this.month,
            closures: this.scheduleData?.salonSchedule?.closures || this.app?.closuresList || [],
            weeklyHours: this.scheduleData?.salonSchedule?.weeklyHours || this.app?.salonWorkingHours || [],
            staffList: this.scheduleData?.stylists || this.app?.staffList || [],
            staffWeeklyOffs: this.scheduleData?.staffWeeklyOffs || null,
            summaryCounts: this.scheduleData?.summaryCounts || null,
            leaves: this.scheduleData?.leaves || [],
            festivals: this.scheduleData?.festivals || this.getFestivalsList(this.year, this.month),
            isStaffMode: this.calendarFor === 'STAFF',
            staffId: this.staffId,
            staffName: this.staffName,
            onRefresh: async () => {
              this._showLoading();
              await this.fetchFreshSchedule();
              this.render();
              this.attachListeners();
            },
          });
        }
      };
      chip.addEventListener('click', handler);
      chip.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handler(e);
        }
      });
    });

    $$('.holiday-cal-day-cell:not(.is-padding-day)').forEach((cell) => {
      cell.addEventListener('click', () => {
        const d = cell.getAttribute('data-date');
        if (d) {
          this.selectedDate = d;
          DateEventsDialog.open({
            app: this.app,
            dateStr: d,
            mode: this.calendarFor,
            staffId: this.staffId,
            staffName: this.staffName,
            scheduleData: this.scheduleData,
            getFestivalForDate: (dt) => this.getFestivalForDate(dt),
            onRefresh: async () => {
              this._showLoading();
              await this.fetchFreshSchedule();
              this.render();
              this.attachListeners();
            },
          });
        }
      });
    });

    $$('.btn-quick-declare-festival').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const fd = e.currentTarget.getAttribute('data-date');
        const fn = e.currentTarget.getAttribute('data-name');
        const ft = e.currentTarget.getAttribute('data-type') || 'FESTIVAL';
        const fi = e.currentTarget.getAttribute('data-icon') || '🪔';
        ScheduleDayOffDialog.open({
          initialDate: fd,
          closureType: 'FESTIVAL',
          reason: fn,
          festivalInfo: { name: fn, type: ft, icon: fi, date: fd },
          salonWorkingHours: this.scheduleData?.salonSchedule?.weeklyHours || this.app?.salonWorkingHours || [],
          existingClosures: this.scheduleData?.salonSchedule?.closures || this.app?.closuresList || [],
          staffList: this.app?.staffList || [],
          onSuccess: async () => {
            this._toast(`Salon closed for ${fn}!`, 'success');
            this._showLoading();
            await this.fetchFreshSchedule();
            this.render();
            this.attachListeners();
          },
        });
      });
    });

    $$('.btn-delete-closure-direct').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        if (confirm('Reopen salon for these dates?')) {
          try {
            await ApiClient.deleteSalonClosure(id);
            this._toast('Salon reopened!', 'success');
            this._showLoading();
            await this.fetchFreshSchedule();
            this.render();
            this.attachListeners();
          } catch (err) {
            this._toast(err.message, 'error');
          }
        }
      });
    });

    $$('.btn-cancel-leave').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const sid = e.currentTarget.getAttribute('data-staff-id');
        const aid = e.currentTarget.getAttribute('data-absence-id');
        const sname = e.currentTarget.getAttribute('data-staff-name') || 'Specialist';
        if (confirm(`Cancel leave for ${sname}?`)) {
          try {
            await ApiClient.cancelStaffAbsence(sid, aid);
            this._toast(`Leave cancelled for ${sname}.`, 'success');
            this._showLoading();
            await this.fetchFreshSchedule();
            this.render();
            this.attachListeners();
          } catch (err) {
            this._toast(err.message, 'error');
          }
        }
      });
    });
  }
}
