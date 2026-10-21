import { ApiClient, formatTime12h } from './api.js';
import * as IndianFestivals from '@aryanjsx/indian-festivals';
import { RealtimeNotifier } from './realtime.js';
import { SoundManager } from './sound.js';
import { Icons } from './icons.js';
import { LeaveManagementUI } from './leave-management.js';
import { LocationPicker } from './location-picker.js';
import { StaffManager } from './modules/staff/staff-manager.js';
import {
  CalendarView,
  ClosureDialog,
  SalonWeeklyOffDialog,
  StaffWeeklyOffDialog,
  StaffLeaveDialog,
  FestivalDialog,
  DateEventsDialog,
} from './modules/calendar/index.js';
import { ScheduleDayOffDialog, SalonClosuresModal } from './modules/salon-settings/schedule-day-off-dialog.js';
import { StaffApplyLeaveDialog } from './modules/staff/index.js';
import { SalonDayOffView } from './modules/salon-settings/salon-day-off-view.js';
import {
  SERVICE_DURATION_OPTIONS,
  renderServiceDurationOptions,
} from './constants.js';
import { AppointmentStatus, StatusPredicates } from './constants/appointment-status.js';

export {
  SERVICE_DURATION_OPTIONS,
  renderServiceDurationOptions,
};

function showNotification(msg, type = 'info') {
  const toast = document.createElement('div');
  const bg = (type === 'error' || type === 'danger')
    ? '#ef4444'
    : type === 'warning'
      ? '#f59e0b'
      : '#10b981';

  let cleanMsg = typeof msg === 'object' ? (msg.message || JSON.stringify(msg)) : String(msg || '');
  if (cleanMsg.length > 200) {
    cleanMsg = cleanMsg.slice(0, 200) + '...';
  }

  toast.style.cssText = `position:fixed; bottom:24px; right:24px; z-index:999999; max-width:380px; word-break:break-word; padding:12px 18px; background:${bg}; color:#fff; font-weight:600; font-size:0.88rem; line-height:1.4; border-radius:10px; box-shadow:0 10px 25px rgba(0,0,0,0.5); font-family:sans-serif;`;
  toast.textContent = cleanMsg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

export function getApptServices(appt) {
  if (!appt) return [];

  // 1) If appt.services is a non-empty array
  if (Array.isArray(appt.services) && appt.services.length > 0) {
    return appt.services.map((s, idx) => {
      const name = s.serviceNameSnapshot || s.service?.name || s.name || 'Service';
      const durationMinutes = s.durationMinutes || s.service?.durationMinutes || 0;
      const isAddon = idx > 0 || Boolean(s.service?.isAddon || s.isAddon);
      return { name, durationMinutes, isAddon, raw: s };
    });
  }

  // 2) If serviceNameSnapshot contains comma-separated values (e.g. "Face, Hair Cut")
  if (appt.serviceNameSnapshot && typeof appt.serviceNameSnapshot === 'string' && appt.serviceNameSnapshot.includes(',')) {
    const names = appt.serviceNameSnapshot.split(',').map((n) => n.trim()).filter(Boolean);
    const totalDur = appt.durationMinutes || 0;
    const primaryDur = appt.service?.durationMinutes || 0;
    return names.map((name, idx) => {
      const isAddon = idx > 0;
      let durationMinutes = 0;
      if (idx === 0) {
        durationMinutes = primaryDur || (names.length === 1 ? totalDur : 0);
      } else if (idx === names.length - 1 && primaryDur > 0 && totalDur > primaryDur) {
        durationMinutes = totalDur - primaryDur;
      } else if (totalDur > primaryDur && primaryDur > 0) {
        durationMinutes = Math.round((totalDur - primaryDur) / (names.length - 1));
      }
      return { name, durationMinutes, isAddon };
    });
  }

  // 3) If appt.service is object
  if (appt.service && appt.service.name) {
    const mainName = appt.service.name;
    const mainDur = appt.service.durationMinutes || appt.durationMinutes || 0;

    // Check if appt.serviceNameSnapshot has add-on names not equal to mainName
    if (appt.serviceNameSnapshot && typeof appt.serviceNameSnapshot === 'string' && appt.serviceNameSnapshot !== mainName) {
      const parts = appt.serviceNameSnapshot.split(',').map((n) => n.trim()).filter(Boolean);
      const addonParts = parts.filter((p) => p !== mainName);
      if (addonParts.length > 0) {
        const totalDur = appt.durationMinutes || 0;
        const primaryDur = appt.service.durationMinutes || 0;
        const remainingDur = Math.max(0, totalDur - primaryDur);
        const addonDur = Math.round(remainingDur / addonParts.length);

        const list = [{ name: mainName, durationMinutes: primaryDur || mainDur, isAddon: false }];
        addonParts.forEach((aName) => {
          list.push({ name: aName, durationMinutes: addonDur, isAddon: true });
        });
        return list;
      }
    }

    return [{ name: mainName, durationMinutes: mainDur, isAddon: false }];
  }

  // 4) If serviceNameSnapshot is a single string
  if (appt.serviceNameSnapshot && typeof appt.serviceNameSnapshot === 'string') {
    return [{ name: appt.serviceNameSnapshot.trim(), durationMinutes: appt.durationMinutes || 0, isAddon: false }];
  }

  return [];
}
if (typeof window !== 'undefined') {
  window.getApptServices = getApptServices;
}

// Dynamic Icon resolver for Indian festivals
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

export class SalonDashboard {

  constructor(containerId, currentUser = null) {
    window.salonDashboard = this;
    window.dashboardApp = this;
    this.container = document.getElementById(containerId);
    this.currentUser = currentUser;
    this.activeTab = 'dashboard';
    this.previousTab = 'queue';
    this.selectedDate = this.getLocalDateString();
    this.leaveUI = new LeaveManagementUI(this);
    this.queueFilter = 'ALL';
    this.summaryData = {
      statusCounts: { total: 0, confirmed: 0, checkedIn: 0, inService: 0, completed: 0, cancelled: 0, noShow: 0 },
      todayAppointments: [],
      todayRevenue: 0,
      timezone: 'Asia/Kolkata',
      whatsappQuota: { limit: 1000, used: 0, remaining: 1000, percentUsed: 0, resetsOn: '1st of next month' },
    };
    this.staffList = [];
    this.servicesList = [];
    this.categoriesList = [];
    this.salonProfile = {};
    this.searchQuery = '';
    this.activeProfileSubtab = 'account';
    this.calYear = new Date().getFullYear();
    this.calMonth = new Date().getMonth(); // 0-indexed (0=Jan, 9=Oct, 11=Dec)
    this.selectedStaffId = null;
    this.staffSearchQuery = '';
    this.staffStatusFilter = 'ALL';
    this.activeStaffSubtab = 'leaves';
    this.calendarSchedule = null;
    this.staffManager = new StaffManager(this);
  }

  /**
   * Retrieves authentic Indian festivals from official @aryanjsx/indian-festivals dependency
   * Falls back gracefully if backend has custom loaded festivals
   */
  getFestivalsList(targetYear = this.calYear, targetMonth = this.calMonth) {
    const y = targetYear !== undefined ? targetYear : this.calYear;
    const m = targetMonth !== undefined ? targetMonth : this.calMonth;

    // 1. If backend returned festivals for this exact month, use them
    if (Array.isArray(this.calendarSchedule?.festivals) && this.calendarSchedule.festivals.length > 0) {
      const monthPrefix = `${y}-${String(m + 1).padStart(2, '0')}`;
      const matching = this.calendarSchedule.festivals.filter((f) => f.date && f.date.startsWith(monthPrefix));
      if (matching.length > 0) {
        return matching;
      }
    }

    // 2. Query official @aryanjsx/indian-festivals dependency directly
    try {
      const monthNum = m + 1; // 1-indexed (1=Jan, 10=Oct)
      const data = IndianFestivals.getFestivalsByMonth(monthNum, y);
      const list = data?.festivals || [];
      return list.map((f) => ({
        date: f.date,
        name: f.name,
        festivalId: f.festivalId || null,
        icon: getFestivalIcon(f.name, f.religion),
        type: f.religion === 'National' ? 'NATIONAL' : 'FESTIVAL',
        religion: f.religion || 'General',
        isPublicHoliday: f.religion === 'National' || f.festivalId === 'diwali' || f.festivalId === 'holi',
        source: '@aryanjsx/indian-festivals',
      }));
    } catch (err) {
      console.warn('[Dashboard] Error querying @aryanjsx/indian-festivals:', err);
      return [];
    }
  }

  getFestivalForDate(dateStr) {
    if (!dateStr) return null;
    const [yStr, mStr] = dateStr.split('-');
    const y = parseInt(yStr, 10);
    const m = parseInt(mStr, 10) - 1; // 0-indexed
    const list = this.getFestivalsList(y, m);
    return list.find((f) => f.date === dateStr) || null;
  }

  showToast(msg, type = 'info') {
    showNotification(msg, type);
  }

  openQuickRequestsModal() {
    const todayAppts = this.summaryData?.todayAppointments || [];
    const pendingRequests = todayAppts.filter(
      (a) => a.status === 'PENDING_ACCEPTANCE' || (a.source === 'QUICK_BOOK' && a.status === 'PENDING_ACCEPTANCE')
    );

    let modal = document.getElementById('modal-quick-requests');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'modal-quick-requests';
    modal.className = 'modal-backdrop';
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
      background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(8px);
      z-index: 99999; display: flex; align-items: center; justify-content: center; padding: 16px;
    `;

    const listHtml = pendingRequests.length === 0
      ? `
        <div style="text-align: center; padding: 40px 20px; color: #94a3b8;">
          <div style="font-size: 2.5rem; margin-bottom: 12px;">⚡</div>
          <h4 style="color: #f8fafc; margin-bottom: 6px; font-weight: 700;">No Pending Requests</h4>
          <p style="font-size: 0.88rem; margin: 0;">There are no active quick booking check-in requests waiting for approval.</p>
        </div>
      `
      : pendingRequests.map((req) => {
        const clientName = req.customer?.name || req.customerPhone || 'In-Salon Client';
        const clientPhone = req.customer?.phone || req.customerPhone || '';
        const reqServices = getApptServices(req);
        const serviceName = reqServices.length > 0
          ? reqServices.map((s) => `${s.name}${s.isAddon ? ' (Add-on)' : ''}`).join(' + ')
          : (req.serviceNameSnapshot || req.service?.name || 'Quick Service');
        const timeStr = req.startTime ? formatTime12h(req.startTime) : 'Today';
        const specialist = req.staff?.name || req.stylist?.name || 'Any Specialist';
        const price = req.price ? `₹${req.price}` : '';

        return `
          <div class="quick-req-card" style="background: rgba(30, 41, 59, 0.85); border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 12px; padding: 16px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
              <div>
                <div style="font-weight: 700; color: #f8fafc; font-size: 1rem; display: flex; align-items: center; gap: 8px;">
                  <span>${clientName}</span>
                  <span style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; font-size: 0.72rem; padding: 2px 8px; border-radius: 6px; font-weight: 800;">⚡ QUICK BOOK</span>
                </div>
                <div style="color: #94a3b8; font-size: 0.82rem; margin-top: 2px;">📞 ${clientPhone}</div>
              </div>
              <div style="text-align: right;">
                <div style="font-weight: 700; color: #34d399; font-size: 1rem;">${price}</div>
                <div style="color: #cbd5e1; font-size: 0.82rem; font-weight: 600;">🕒 ${timeStr}</div>
              </div>
            </div>
            <div style="font-size: 0.85rem; color: #e2e8f0; background: rgba(15, 23, 42, 0.6); padding: 8px 12px; border-radius: 8px; display: flex; justify-content: space-between;">
              <span><strong>Service:</strong> ${serviceName}</span>
              <span><strong>Specialist:</strong> ${specialist}</span>
            </div>
            <div style="display: flex; gap: 10px; margin-top: 4px;">
              <button class="btn btn-success btn-sm btn-accept-quick-req" data-id="${req.id}" style="flex: 1; padding: 10px; font-weight: 700; gap: 6px; display: flex; align-items: center; justify-content: center; background: #10b981; border: none; border-radius: 8px; color: #fff; cursor: pointer;">
                ✅ Accept & Check In
              </button>
              <button class="btn btn-danger btn-sm btn-decline-quick-req" data-id="${req.id}" style="flex: 1; padding: 10px; font-weight: 700; gap: 6px; display: flex; align-items: center; justify-content: center; background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); border-radius: 8px; color: #f87171; cursor: pointer;">
                ❌ Decline
              </button>
            </div>
          </div>
        `;
      }).join('');

    modal.innerHTML = `
      <div class="modal-card" style="background: #0f172a; border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 16px; max-width: 520px; width: 100%; max-height: 85vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
        <div style="padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; align-items: center; background: rgba(245, 158, 11, 0.08);">
          <div style="display: flex; align-items: center; gap: 10px;">
            <span style="font-size: 1.4rem;">⚡</span>
            <div>
              <h3 style="margin: 0; color: #f8fafc; font-size: 1.1rem; font-weight: 700;">Quick Booking Requests</h3>
              <span style="font-size: 0.78rem; color: #fbbf24;">Pending Salon Check-in Approval</span>
            </div>
          </div>
          <button id="btn-close-quick-requests-modal" style="background: none; border: none; color: #94a3b8; font-size: 1.4rem; cursor: pointer; padding: 4px;">✕</button>
        </div>
        <div style="padding: 16px 20px; overflow-y: auto; flex: 1;">
          ${listHtml}
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('btn-close-quick-requests-modal')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });

    modal.querySelectorAll('.btn-accept-quick-req').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        if (!id) return;
        btn.disabled = true;
        btn.innerText = 'Accepting...';
        try {
          await ApiClient.updateAppointmentStatus(id, 'CHECKED_IN');
          this.showToast('Quick booking accepted & customer checked in!', 'success');
          modal.remove();
          await this.loadData(true);
          this.render();
        } catch (err) {
          this.showToast(`Error accepting booking: ${err.message}`, 'danger');
          btn.disabled = false;
          btn.innerText = '✅ Accept & Check In';
        }
      });
    });

    modal.querySelectorAll('.btn-decline-quick-req').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        if (!id) return;
        btn.disabled = true;
        btn.innerText = 'Declining...';
        try {
          await ApiClient.updateAppointmentStatus(id, 'CANCELLED');
          this.showToast('Quick booking declined.', 'warning');
          modal.remove();
          await this.loadData(true);
          this.render();
        } catch (err) {
          this.showToast(`Error declining booking: ${err.message}`, 'danger');
          btn.disabled = false;
          btn.innerText = '❌ Decline';
        }
      });
    });
  }

  // Safe local date formatting (YYYY-MM-DD) avoiding UTC shifts
  getLocalDateString(dateObj = new Date()) {
    const year = dateObj.getFullYear();
    const month = String(dateObj.getMonth() + 1).padStart(2, '0');
    const day = String(dateObj.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  addDaysToDateString(dateStr, days) {
    const [y, m, d] = (dateStr || this.getLocalDateString()).split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + days);
    return this.getLocalDateString(dt);
  }

  getModalContainer() {
    let modalContainer = document.getElementById('modal-container');
    if (!modalContainer) {
      modalContainer = document.createElement('div');
      modalContainer.id = 'modal-container';
      document.body.appendChild(modalContainer);
    }
    return modalContainer;
  }

  flushPendingScheduleSave() {
    if (this._autoSaveScheduleTimer && typeof this._pendingScheduleSaveFn === 'function') {
      clearTimeout(this._autoSaveScheduleTimer);
      this._autoSaveScheduleTimer = null;
      this._pendingScheduleSaveFn();
    }
  }

  async init() {
    this.renderLoading();
    try {
      try {
        const savedTab = sessionStorage.getItem('active_dashboard_tab');
        if (savedTab && ['dashboard', 'staff', 'queue', 'services', 'profile', 'customers', 'whatsapp-logs'].includes(savedTab)) {
          this.activeTab = savedTab;
        }
      } catch (_) { }

      await this.loadData();

      try {
        const savedStaffJson = sessionStorage.getItem('active_staff_workspace');
        if (savedStaffJson) {
          const { staffId, view } = JSON.parse(savedStaffJson);
          if (staffId && (this.staffList || []).some((s) => s.id === staffId)) {
            this.selectedStaffId = staffId;
            this.staffManager.setStaff(staffId, view || 'schedule');
          }
        }
      } catch (_) { }

      this.render();

      window.salonDashboard = this;
      window.dashboardApp = this;

      window.addEventListener('beforeunload', () => {
        this.flushPendingScheduleSave();
      });
      window.addEventListener('pagehide', () => {
        this.flushPendingScheduleSave();
      });

      // Connect to Real-time Event Stream for live sync & audio chimes
      if (this.salonProfile?.id) {
        if (this.realtime) {
          this.realtime.destroy();
        }
        this.realtime = new RealtimeNotifier(this.salonProfile.id, async (payload) => {
          if (payload?.type === 'PING') return;
          // Live sync from SSE stream (appointments, staff, services)
          await this.loadData(true);
          this.updateQuickRequestsBadge();
          const isStaffOrService = payload?.type === 'STAFF_UPDATED' || payload?.type === 'SERVICE_UPDATED';
          if (isStaffOrService || this.activeTab === 'staff' || this.activeTab === 'services') {
            this.render();
          } else {
            this.refreshActiveTab();
          }
        });
      }
    } catch (err) {
      console.error(err);
      this.container.innerHTML = `
        <div style="min-height: 80vh; display: flex; align-items: center; justify-content: center; padding: 24px;">
          <div class="glass-panel text-center" style="max-width: 440px; text-align: center; padding: 40px;">
            <div style="font-size: 2.5rem; margin-bottom: 12px;">🔒</div>
            <h3 style="color: #fff; margin-bottom: 8px;">Salon Not Found</h3>
            <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 20px;">
              ${err.message || 'Unable to load store profile.'}
            </p>
            <button class="btn btn-primary" onclick="window.location.reload()">Reload Application</button>
          </div>
        </div>
      `;
      document.getElementById('btn-goto-login')?.addEventListener('click', async () => {
        await ApiClient.logout();
        window.location.hash = '#login';
        window.location.reload();
      });
    }
  }

  /** Live-update the Quick Requests header badge count without full DOM rebuild */
  updateQuickRequestsBadge() {
    const pendingQuickCount = (this.summaryData?.todayAppointments || [])
      .filter((a) => a.status === 'PENDING_ACCEPTANCE').length;

    const badge = document.getElementById('header-quick-requests-val');
    const btn = document.getElementById('btn-header-quick-requests');

    if (badge) {
      badge.textContent = pendingQuickCount;
      badge.style.background = pendingQuickCount > 0 ? '#f59e0b' : 'rgba(255,255,255,0.15)';
      badge.style.color = pendingQuickCount > 0 ? '#000' : '#fff';
    }

    if (btn) {
      btn.style.background = pendingQuickCount > 0
        ? 'rgba(245,158,11,0.25)' : 'rgba(139, 61, 255,0.12)';
      btn.style.borderColor = pendingQuickCount > 0
        ? 'rgba(245,158,11,0.5)' : 'rgba(139, 61, 255,0.3)';
      btn.style.color = pendingQuickCount > 0 ? '#fbbf24' : '#A855F7';
    }
  }

  /**
   * PERFORMANCE: Only re-render the active tab content + header badges.
   * Avoids destroying the entire DOM tree (header, nav, modals, event listeners).
   */
  refreshActiveTab() {
    const tabContent = document.getElementById('tab-content');
    if (tabContent && this.summaryData) {
      tabContent.innerHTML = this.getTabHtml();
      // Re-attach only tab-specific event listeners (not header/nav)
      this.attachTabEventListeners();

      // Update header badge count (queue badge in bottom nav)
      const queueBadge = this.container.querySelector('.bottom-nav-badge');
      if (queueBadge && this.summaryData?.statusCounts) {
        queueBadge.textContent = this.summaryData.statusCounts.total;
      }

      // Live update desktop tab labels with current counts
      const staffTabSpan = this.container.querySelector('.nav-tab[data-tab="staff"] span');
      if (staffTabSpan && this.staffList) {
        const _tabDateIso = (this.selectedDate || new Date().toISOString().split('T')[0]);
        const _tabAvailCount = this.staffList.filter(s => s.status === 'ACTIVE' && !(s.absences || []).some(ab => {
          const s = (ab.startDate || '').split('T')[0];
          const e = (ab.endDate || s).split('T')[0];
          return s <= _tabDateIso && e >= _tabDateIso && ab.status === 'ACTIVE';
        })).length;
        staffTabSpan.textContent = `Stylists (${this.staffList.length}) \u2022 ${_tabAvailCount} Available`;
      }
      const servicesTabSpan = this.container.querySelector('.nav-tab[data-tab="services"] span');
      if (servicesTabSpan && this.servicesList) {
        servicesTabSpan.textContent = `Service Menu (${this.servicesList.length})`;
      }
    } else {
      // Fallback to full re-render if tab-content not found
      this.render();
    }
  }

  /**
   * PERFORMANCE: Flicker-free instant tab switching.
   * Swaps only #tab-content and updates nav active state without destroying the DOM tree.
   */
  /**
   * PERFORMANCE: Flicker-free instant tab switching.
   * Swaps only #tab-content and updates nav active state without destroying the DOM tree.
   */
  switchTab(targetTab) {
    if (!targetTab) return;
    if (this.activeTab && this.activeTab !== targetTab) {
      this.previousTab = this.activeTab;
    }
    if (targetTab !== 'staff') {
      this.selectedStaffId = null;
    }
    if (targetTab === 'profile') {
      this.mobileSettingsDrilled = false;
    }
    this.activeTab = targetTab;
    try {
      sessionStorage.setItem('active_dashboard_tab', targetTab);
    } catch (_) { }

    // Update active state on desktop tab buttons
    this.container.querySelectorAll('.nav-tab').forEach((el) => {
      el.classList.toggle('active', el.getAttribute('data-tab') === targetTab);
    });

    // Update active state on mobile bottom nav buttons
    this.container.querySelectorAll('.bottom-nav-item').forEach((el) => {
      el.classList.toggle('active', el.getAttribute('data-tab') === targetTab);
    });

    const tabContent = document.getElementById('tab-content');
    if (tabContent) {
      try {
        tabContent.innerHTML = this.getTabHtml();
        this.attachTabEventListeners();
        if (targetTab === 'customers') this.loadCustomersTable();
        if (targetTab === 'whatsapp-logs') this.loadWhatsAppLogs();
      } catch (err) {
        console.error('[Dashboard] Error rendering tab:', targetTab, err);
      }
    } else {
      this.render();
    }
  }

  async loadData(fullReload = true) {
    const fallbackSummary = {
      statusCounts: { total: 0, confirmed: 0, checkedIn: 0, inService: 0, completed: 0, cancelled: 0, noShow: 0 },
      todayAppointments: [],
      todayRevenue: 0,
      timezone: 'Asia/Kolkata',
      whatsappQuota: { limit: 1000, used: 0, remaining: 1000, percentUsed: 0, resetsOn: '1st of next month' },
    };

    if (fullReload) {
      try {
        const [summary, staff, services, profile, categories, calendarScheduleRes, workingHours, salonBreaks] = await Promise.all([
          ApiClient.getDashboardSummary(this.selectedDate, true).catch((err) => {
            console.warn('[Dashboard] Summary fetch error:', err);
            return fallbackSummary;
          }),
          ApiClient.getStaff(true).catch((err) => {
            console.warn('[Dashboard] Staff fetch error:', err);
            return this.staffList || [];
          }),
          ApiClient.getServices(true).catch((err) => {
            console.warn('[Dashboard] Services fetch error:', err);
            return this.servicesList || [];
          }),
          ApiClient.getSalonProfile(true).catch((err) => {
            console.warn('[Dashboard] Profile fetch error:', err);
            return this.salonProfile || {};
          }),
          ApiClient.getServiceCategories(true).catch((err) => {
            console.warn('[Dashboard] Categories fetch error:', err);
            return this.categoriesList || [];
          }),
          ApiClient.getCalendarSchedule({
            month: `${this.calYear}-${String(this.calMonth + 1).padStart(2, '0')}`,
          }, true).catch((err) => {
            console.warn('[Dashboard] Calendar schedule fetch error:', err);
            return null;
          }),
          ApiClient.getSalonWorkingHours(true).catch((err) => {
            console.warn('[Dashboard] Working hours fetch error:', err);
            return this.salonWorkingHours || [];
          }),
          ApiClient.getSalonBreaks(true).catch((err) => {
            console.warn('[Dashboard] Salon breaks fetch error:', err);
            return this.salonBreaks || [];
          }),
        ]);

        this.summaryData = summary || fallbackSummary;
        this.staffList = Array.isArray(staff) ? staff : [];
        this.servicesList = Array.isArray(services) ? services : [];
        this.categoriesList = Array.isArray(categories) ? categories : [];
        this.salonProfile = profile || {};
        const calData = calendarScheduleRes?.data || calendarScheduleRes;
        this.calendarSchedule = calData || null;
        this.closuresList = this.calendarSchedule?.salonSchedule?.closures || [];
        this.salonWorkingHours = this.calendarSchedule?.salonSchedule?.weeklyHours || (Array.isArray(workingHours) ? workingHours : (profile?.workingHours || []));
        if (salonBreaks && typeof salonBreaks === 'object') {
          if (Array.isArray(salonBreaks)) {
            this.salonBreaks = salonBreaks;
            this.salonRoutineBreaks = [];
            this.salonBreaksByDay = {};
          } else {
            this.salonRoutineBreaks = Array.isArray(salonBreaks.routineBreaks) ? salonBreaks.routineBreaks : [];
            this.salonBreaksByDay = salonBreaks.byDay || {};
            this.salonBreaks = Object.entries(this.salonBreaksByDay).flatMap(([day, bList]) =>
              (bList || []).map((b) => ({ ...b, dayOfWeek: day }))
            );
          }
        } else {
          this.salonBreaks = [];
          this.salonRoutineBreaks = [];
          this.salonBreaksByDay = {};
        }


      } catch (err) {
        console.warn('[Dashboard] loadData batch error:', err);
      }
    } else {
      try {
        const summary = await ApiClient.getDashboardSummary(this.selectedDate, true);
        this.summaryData = summary || fallbackSummary;
      } catch (err) {
        console.warn('[Dashboard] date switch error:', err);
      }
    }
  }


  renderLoading() {
    this.container.innerHTML = `
      <!-- Skeleton Header -->
      <header class="portal-header">
        <div class="portal-header-content">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div class="skeleton-pulse" style="width: 42px; height: 42px; border-radius: 12px;"></div>
            <div>
              <div class="skeleton-pulse" style="width: 160px; height: 16px; border-radius: 6px; margin-bottom: 6px;"></div>
              <div class="skeleton-pulse" style="width: 100px; height: 10px; border-radius: 4px;"></div>
            </div>
          </div>
        </div>
      </header>
      <main style="max-width: 1300px; margin: 0 auto; padding: 24px 16px;">
        <!-- Skeleton Tab Bar -->
        <div style="display: flex; gap: 8px; margin-bottom: 24px; overflow-x: auto;">
          ${[120, 100, 130, 110, 105].map(w => `<div class="skeleton-pulse" style="width: ${w}px; height: 36px; border-radius: 20px; flex-shrink: 0;"></div>`).join('')}
        </div>
        <!-- Skeleton KPI Grid -->
        <div class="stats-grid">
          ${[1, 2, 3, 4].map(() => `
            <div class="stat-card">
              <div class="skeleton-pulse" style="width: 80%; height: 12px; border-radius: 4px; margin-bottom: 12px;"></div>
              <div class="skeleton-pulse" style="width: 50%; height: 28px; border-radius: 6px; margin-bottom: 8px;"></div>
              <div class="skeleton-pulse" style="width: 70%; height: 10px; border-radius: 4px;"></div>
            </div>
          `).join('')}
        </div>
        <!-- Skeleton Action Cards -->
        <div class="glass-panel" style="margin-bottom: 24px;">
          <div class="skeleton-pulse" style="width: 180px; height: 18px; border-radius: 6px; margin-bottom: 16px;"></div>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px;">
            ${[1, 2, 3, 4].map(() => `
              <div class="staff-card" style="padding: 18px;">
                <div class="skeleton-pulse" style="width: 40px; height: 40px; border-radius: 10px; margin-bottom: 10px;"></div>
                <div class="skeleton-pulse" style="width: 75%; height: 14px; border-radius: 4px; margin-bottom: 8px;"></div>
                <div class="skeleton-pulse" style="width: 90%; height: 10px; border-radius: 4px;"></div>
              </div>
            `).join('')}
          </div>
        </div>
        <!-- Skeleton Staff Grid -->
        <div class="glass-panel">
          <div class="skeleton-pulse" style="width: 220px; height: 18px; border-radius: 6px; margin-bottom: 16px;"></div>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px;">
            ${[1, 2, 3].map(() => `
              <div class="staff-card" style="display: flex; align-items: center; gap: 14px; padding: 14px;">
                <div class="skeleton-pulse" style="width: 44px; height: 44px; border-radius: 50%;"></div>
                <div style="flex: 1;">
                  <div class="skeleton-pulse" style="width: 70%; height: 14px; border-radius: 4px; margin-bottom: 8px;"></div>
                  <div class="skeleton-pulse" style="width: 50%; height: 10px; border-radius: 4px;"></div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </main>
    `;
  }


  getTodayClosure() {
    if (!this.closuresList || !Array.isArray(this.closuresList) || this.closuresList.length === 0) {
      return null;
    }
    const todayStr = (this.selectedDate || this.getLocalDateString());
    return this.closuresList.find((c) => {
      const startDateStr = new Date(c.startDate).toISOString().split('T')[0];
      const endDateStr = new Date(c.endDate).toISOString().split('T')[0];
      return todayStr >= startDateStr && todayStr <= endDateStr;
    }) || null;
  }

  render() {
    const salonName = this.salonProfile?.name || 'Salon Operations';
    const salonSlug = this.salonProfile?.slug || 'salon';
    const webBookingUrl = `${window.location.origin}/#book/${salonSlug}`;
    const isDeactivated = this.salonProfile?.status === 'DEACTIVATED' || this.staffList.length === 0 || this.servicesList.length === 0;
    const todayClosure = this.getTodayClosure();
    const isClosedToday = !!todayClosure;

    const pendingQuickCount = (this.summaryData?.todayAppointments || []).filter((a) => a.status === 'PENDING_ACCEPTANCE').length;

    this.container.innerHTML = `
      <!-- Dedicated Modern Luxury Header Bar -->
      <header class="portal-header">
        <div class="portal-header-content">
          <div class="header-brand-group">
            <div class="brand-icon-box">
              ${Icons.scissors({ size: 20, color: '#c7d2fe' })}
              <span class="brand-live-indicator ${isClosedToday ? 'offline' : isDeactivated ? 'offline' : 'live'}" title="${isClosedToday ? 'Store Closed Today' : isDeactivated ? 'Offline' : 'Real-Time Connected'}"></span>
            </div>
            <div class="header-title-block">
              <div class="header-title-row">
                <span class="header-salon-name">${salonName}</span>
                <span class="q-live-pill desktop-only-badge" style="padding: 2px 8px; background: ${isClosedToday ? 'rgba(239, 68, 68, 0.2)' : isDeactivated ? 'rgba(100,116,139,0.2)' : 'rgba(16,185,129,0.2)'}; border: 1px solid ${isClosedToday ? 'rgba(239, 68, 68, 0.4)' : isDeactivated ? 'rgba(100,116,139,0.4)' : 'rgba(16,185,129,0.4)'};">
                  <span class="q-live-dot" style="background: ${isClosedToday ? '#f87171' : isDeactivated ? '#94a3b8' : '#34d399'};"></span>
                  <span class="q-live-label" style="font-size: 0.64rem; font-weight: 800; color: ${isClosedToday ? '#f87171' : isDeactivated ? '#94a3b8' : '#34d399'};">${isClosedToday ? (todayClosure.closureType === 'HOLIDAY' ? '🌴 HOLIDAY' : '🚨 STORE CLOSED') : isDeactivated ? 'OFFLINE' : 'LIVE'}</span>
                </span>
              </div>
              <div class="header-meta-row">
                <span>${this.salonProfile?.city || 'India'}</span>
                <span>•</span>
                <span>${this.summaryData.timezone}</span>
              </div>
            </div>
          </div>
          <div class="header-actions-group" style="display: flex; gap: 8px; align-items: center;">
            <button class="btn btn-secondary btn-sm" id="btn-header-quick-requests" title="View Pending Quick Booking Requests" style="background: ${pendingQuickCount > 0 ? 'rgba(245,158,11,0.25)' : 'rgba(139, 61, 255,0.12)'}; border: 1px solid ${pendingQuickCount > 0 ? 'rgba(245,158,11,0.5)' : 'rgba(139, 61, 255,0.3)'}; color: ${pendingQuickCount > 0 ? '#fbbf24' : '#A855F7'}; font-weight: 700; gap: 6px; display: flex; align-items: center;">
              ${Icons.sparkles({ size: 14, color: pendingQuickCount > 0 ? '#fbbf24' : '#A855F7' })}
              <span><span class="desktop-only-inline">Quick Requests </span><strong id="header-quick-requests-val" style="background: ${pendingQuickCount > 0 ? '#f59e0b' : 'rgba(255,255,255,0.15)'}; color: ${pendingQuickCount > 0 ? '#000' : '#fff'}; padding: 1px 7px; border-radius: 10px; font-weight: 800; margin-left: 4px; font-size: 0.8rem;">${pendingQuickCount}</strong></span>
            </button>
            <button class="btn btn-secondary btn-sm" id="btn-toggle-sound" title="${SoundManager.isMuted() ? 'Unmute Floor Audio' : 'Mute Floor Audio'}">
              <span id="sound-icon">${SoundManager.isMuted() ? Icons.volumeX({ size: 16, color: '#94a3b8' }) : Icons.volume2({ size: 16, color: '#34d399' })}</span>
              <span id="sound-text" class="desktop-sound-text">${SoundManager.isMuted() ? 'Muted' : 'Floor Audio ON'}</span>
            </button>
          </div>
        </div>
      </header>

      <!-- Main Workspace -->
      <main id="main-content" style="max-width: 1300px; margin: 0 auto; padding: 10px 14px 80px 14px;">

        <!-- Universal Pull-to-Refresh Indicator (Always available on all screens) -->
        <div class="ptr-wrapper" id="ptr-wrapper">
          <div class="ptr-capsule" id="ptr-capsule">
            <span class="ptr-icon" id="ptr-icon">${Icons.arrowDown({ size: 14, color: '#A855F7' })}</span>
            <span id="ptr-text">Pull to refresh</span>
          </div>
        </div>

        <!-- Setup Required Onboarding Banner -->
        ${isDeactivated ? `
          <div style="background: linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(139, 61, 255,0.08) 100%); border: 1px solid rgba(245,158,11,0.3); border-radius: var(--radius-md); padding: 16px 20px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px;">
            <div style="display: flex; align-items: center; gap: 14px;">
              <div style="width: 44px; height: 44px; border-radius: 12px; background: rgba(245,158,11,0.15); display: flex; align-items: center; justify-content: center; color: #fbbf24;">
                ${Icons.sparkles({ size: 22, color: '#fbbf24' })}
              </div>
              <div>
                <div style="font-weight: 800; font-size: 1.05rem; color: #fff;">Initial Store Setup Required</div>
                <div style="font-size: 0.82rem; color: var(--text-secondary); margin-top: 2px;">
                  Add at least <strong>1 Stylist</strong> (${this.staffList.length}/1) and <strong>1 Service</strong> (${this.servicesList.length}/1) to automatically activate your store for live online bookings.
                </div>
              </div>
            </div>
            <div style="display: flex; gap: 10px;">
              <button class="btn btn-primary btn-sm" id="btn-quick-add-staff" style="gap: 6px;">
                ${Icons.plus({ size: 14 })}
                <span>Add Stylist</span>
              </button>
              <button class="btn btn-secondary btn-sm" id="btn-quick-add-service" style="gap: 6px;">
                ${Icons.plus({ size: 14 })}
                <span>Add Service</span>
              </button>
            </div>
          </div>
        ` : ''}
        
        <!-- Modern Segmented Tab Switcher (Desktop) -->
        <div class="tab-switcher">
          <button class="nav-tab ${this.activeTab === 'dashboard' ? 'active' : ''}" data-tab="dashboard">
            ${Icons.home({ size: 16 })}
            <span>Dashboard</span>
          </button>
          <button class="nav-tab ${this.activeTab === 'staff' ? 'active' : ''}" data-tab="staff">
            ${Icons.users({ size: 16 })}
            <span>Stylists (${this.staffList.length}) \u2022 ${((sl, d) => sl.filter(s => s.status === 'ACTIVE' && !(s.absences || []).some(ab => {
              const s = (ab.startDate || '').split('T')[0];
              const e = (ab.endDate || s).split('T')[0];
              return s <= d && e >= d && ab.status === 'ACTIVE';
            })).length)(this.staffList, this.selectedDate || new Date().toISOString().split('T')[0])} Available</span>
          </button>
          <button class="nav-tab ${this.activeTab === 'queue' ? 'active' : ''}" data-tab="queue">
            ${Icons.queue({ size: 16 })}
            <span>Live Queue</span>
          </button>
          <button class="nav-tab ${this.activeTab === 'services' ? 'active' : ''}" data-tab="services">
            ${Icons.scissors({ size: 16 })}
            <span>Service Menu (${this.servicesList.length})</span>
          </button>
          <button class="nav-tab ${this.activeTab === 'profile' ? 'active' : ''}" data-tab="profile">
            ${Icons.settings({ size: 16 })}
            <span>Profile & Hub</span>
          </button>
        </div>

        <!-- Dynamic Tab Body -->
        <div id="tab-content">
          ${this.getTabHtml()}
        </div>
      </main>

      <!-- Floating Island Mobile Bottom Navigation Dock -->
      <nav class="mobile-bottom-nav">
        <!-- 1. Left: Dashboard -->
        <button class="bottom-nav-item ${this.activeTab === 'dashboard' ? 'active' : ''}" data-tab="dashboard">
          ${Icons.home({ size: 20 })}
          <span>Home</span>
        </button>

        <!-- 2. Stylists -->
        <button class="bottom-nav-item ${this.activeTab === 'staff' ? 'active' : ''}" data-tab="staff">
          ${Icons.users({ size: 20 })}
          <span>Stylists</span>
        </button>

        <!-- 3. CENTER HERO: Queue -->
        <button class="bottom-nav-item center-hero ${this.activeTab === 'queue' ? 'active' : ''}" data-tab="queue">
          <div class="hero-icon-wrapper">
            ${Icons.zap({ size: 24, color: '#fff' })}
            ${this.summaryData?.statusCounts?.total > 0 ? `<span class="bottom-nav-badge">${this.summaryData.statusCounts.total}</span>` : ''}
          </div>
          <span>Queue</span>
        </button>

        <!-- 4. Services -->
        <button class="bottom-nav-item ${this.activeTab === 'services' ? 'active' : ''}" data-tab="services">
          ${Icons.scissors({ size: 20 })}
          <span>Services</span>
        </button>

        <!-- 5. Right: Profile & Features Hub -->
        <button class="bottom-nav-item ${this.activeTab === 'profile' ? 'active' : ''}" data-tab="profile">
          ${Icons.settings({ size: 20 })}
          <span>Profile</span>
        </button>
      </nav>

      <!-- Modals Container -->
      <div id="modal-container"></div>
    `;


    this.attachEventListeners();
  }

  getTabHtml() {
    switch (this.activeTab) {
      case 'dashboard':
        return this.renderDashboardTab();
      case 'staff':
        return this.renderStaffTab();
      case 'queue':
        return this.renderQueueTab();
      case 'services':
        return this.renderServicesTab();
      case 'profile':
        return this.renderProfileTab();
      case 'customers':
        return this.renderCustomersTab();
      case 'whatsapp-logs':
        return this.renderWhatsAppLogsTab();
      default:
        return this.renderDashboardTab();
    }
  }

  // =========================================================================
  // TAB 1: EXECUTIVE DASHBOARD OVERVIEW
  // =========================================================================
  renderDashboardTab() {
    const summary = this.summaryData || {};
    const statusCounts = summary.statusCounts || { total: 0, booked: 0, confirmed: 0, checkedIn: 0, onTheWay: 0, inService: 0, seatedInChair: 0, completed: 0, cancelled: 0, noShow: 0, rejected: 0 };
    const waitingDisplayCount = (statusCounts.checkedIn || 0) + (statusCounts.onTheWay || 0);
    const inChairDisplayCount = (statusCounts.inService || 0) + (statusCounts.seatedInChair || 0);
    const bookedConfirmedCount = (statusCounts.confirmed || 0) + (statusCounts.booked || 0);
    const todayRevenue = summary.todayRevenue || 0;
    const todayAppointments = summary.todayAppointments || [];
    const profile = this.salonProfile || {};
    const todayClosure = this.getTodayClosure();

    const todayISO = this.getLocalDateString();
    const [sy, sm, sd] = (this.selectedDate || todayISO).split('-').map(Number);
    const selDate = new Date(sy, sm - 1, sd);
    const [ty, tm, td] = todayISO.split('-').map(Number);
    const todayDate = new Date(ty, tm - 1, td);
    const diffDays = Math.round((selDate - todayDate) / (1000 * 60 * 60 * 24));

    let labelPrefix = "TODAY'S";
    if (diffDays === 1) labelPrefix = "TOMORROW'S";
    else if (diffDays === -1) labelPrefix = "YESTERDAY'S";
    else if (diffDays !== 0) {
      const formatted = selDate.toLocaleDateString('en-US', { day: '2-digit', month: 'short' }).toUpperCase();
      labelPrefix = `${formatted}`;
    }

    return `
      ${todayClosure ? `
        <div style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: var(--radius-md); padding: 14px 18px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; box-shadow: 0 8px 24px rgba(239, 68, 68, 0.15);">
          <div style="display: flex; align-items: center; gap: 10px; color: #f87171; font-size: 0.88rem; font-weight: 700;">
            <span style="font-size: 1.2rem;">🚨</span>
            <span>STORE CLOSED TODAY (${todayClosure.closureType}): ${todayClosure.reason}</span>
          </div>
          <button class="btn btn-secondary btn-sm btn-open-closures-modal" style="border-color: rgba(239, 68, 68, 0.4); color: #f87171; font-size: 0.78rem;">
            Manage Closures & Holidays →
          </button>
        </div>
      ` : ''}

      ${(profile.status === 'INACTIVE' || summary.status === 'INACTIVE') ? `
        <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; border-radius: 14px; padding: 16px 20px; margin-bottom: 24px; color: #fca5a5; display: flex; align-items: center; justify-content: space-between; gap: 16px; box-shadow: 0 10px 25px rgba(239, 68, 68, 0.15);">
          <div style="display: flex; align-items: center; gap: 14px;">
            <span style="font-size: 1.6rem;">⚠️</span>
            <div>
              <div style="font-weight: 700; font-size: 1rem; color: #fee2e2; margin-bottom: 2px;">Salon Account is INACTIVE</div>
              <div style="font-size: 0.85rem; color: #fca5a5; line-height: 1.4;">
                Automated WhatsApp booking response is paused. To activate your account, ensure your salon catalog has at least <strong>1 Active Stylist</strong> and <strong>1 Active Service</strong>.
              </div>
            </div>
          </div>
          <button type="button" class="btn btn-primary btn-sm" id="btn-goto-services-banner" style="white-space: nowrap; font-size: 0.85rem; padding: 8px 16px;">Set Up Catalog →</button>
        </div>
      ` : ''}

      <!-- Reception Desk Walk-In Quick Bar -->
      <div class="reception-quick-bar">
        <div class="reception-quick-left">
          <span class="reception-quick-badge">
            <span class="reception-pulse-dot"></span> RECEPTION DESK
          </span>
          <span style="font-size: 0.8rem; font-weight: 600; color: #cbd5e1;">Walk-in client waiting? Scan QR to join active queue:</span>
          <span class="reception-quick-url" style="font-family: monospace; font-size: 0.76rem; color: #a5b4fc; background: rgba(0,0,0,0.3); padding: 2px 8px; border-radius: 4px;">/#book/${profile.slug || 'glamour-studio'}</span>
        </div>
        <div class="reception-quick-actions" style="display: flex; align-items: center; gap: 8px;">
          <button type="button" class="btn btn-secondary btn-sm" id="btn-quick-copy" style="height: 30px; padding: 0 10px; font-size: 0.72rem; border-radius: 6px;">
            ${Icons.copy({ size: 12 })} <span>Copy Link</span>
          </button>
          <button type="button" class="btn btn-primary btn-sm" id="btn-quick-standee" style="height: 30px; padding: 0 12px; font-size: 0.72rem; border-radius: 6px; font-weight: 700; background: linear-gradient(135deg, #8B3DFF 0%, #9D5CFF 100%);">
            ${Icons.qrCode ? Icons.qrCode({ size: 12 }) : '🖨️'} <span>Print Acrylic Standee</span>
          </button>
        </div>
      </div>

      <!-- Grand Executive Cockpit Hero Banner -->
      <div class="dashboard-hero-banner">
        <div class="hero-main-row">
          <div class="hero-revenue-col">
            <div class="hero-label">
              ${Icons.sparkles({ size: 14, color: '#fbbf24' })}
              <span>${labelPrefix} REVENUE TAKE</span>
            </div>
            <div class="hero-revenue-val">₹${todayRevenue.toLocaleString()}</div>
            <div class="hero-revenue-sub">
              Collected from <strong>${statusCounts.completed}</strong> completed visits • <strong>${statusCounts.inService}</strong> currently in chair
            </div>
          </div>

          <!-- Floor Telemetry Chips -->
          <div class="hero-telemetry-chips">
            <div class="telemetry-chip">
              <span class="telemetry-chip-val" style="color: #c7d2fe;">${statusCounts.total}</span>
              <span class="telemetry-chip-lbl">Bookings</span>
            </div>
            <div class="telemetry-chip">
              <span class="telemetry-chip-val" style="color: #fbbf24;">${waitingDisplayCount}</span>
              <span class="telemetry-chip-lbl">Waiting</span>
            </div>
            <div class="telemetry-chip">
              <span class="telemetry-chip-val" style="color: #c084fc;">${inChairDisplayCount}</span>
              <span class="telemetry-chip-lbl">In Chair</span>
            </div>
            <div class="telemetry-chip">
              <span class="telemetry-chip-val" style="color: #34d399;">${statusCounts.completed}</span>
              <span class="telemetry-chip-lbl">Done</span>
            </div>
          </div>
        </div>

        <!-- Live Station Occupancy Strip -->
        <div class="stations-strip-panel">
          <div class="stations-strip-header">
            <span>Live Station Occupancy</span>
            <span style="color: #34d399; font-size: 0.72rem; display: flex; align-items: center; gap: 4px;">
              <span class="q-live-dot"></span> Real-Time Floor Radar
            </span>
          </div>
          <div class="stations-cards-grid">
            ${(this.staffList && this.staffList.length > 0)
        ? this.staffList.map((st, idx) => {
          const todayAppts = (todayAppointments || []).filter((a) => (a.staff?.id || a.staffId) === st.id);
          const inService = todayAppts.find((a) => a.status === 'SEATED_IN_CHAIR' || a.status === 'IN_SERVICE');
          const isOccupied = !!inService;
          const _stDateIso = (this.selectedDate || new Date().toISOString().split('T')[0]);
          const _stAbsent = (st.absences || []).some((ab) => {
            if (ab.status !== 'ACTIVE') return false;
            const sDate = (ab.startDate || '').split('T')[0];
            const eDate = (ab.endDate || sDate).split('T')[0];
            return _stDateIso >= sDate && _stDateIso <= eDate;
          });
          const _stStatusColor = todayClosure ? '#f87171' : _stAbsent ? '#fb7185' : isOccupied ? '#c084fc' : '#34d399';
          const _stStatusLabel = todayClosure ? '🚨 Store Closed Today' : _stAbsent ? '🚫 Absent Today' : isOccupied ? `In Chair: ${inService.customer?.name || inService.customerName || inService.user?.name || 'Client'}` : '🟢 Ready for Walk-In';
          return `
                    <div class="station-card ${_stAbsent || todayClosure ? 'absent' : isOccupied ? 'occupied' : 'ready'}" style="${_stAbsent || todayClosure ? 'opacity: 0.7;' : ''}">
                      <div class="station-num-badge">#${idx + 1}</div>
                      <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: 700; font-size: 0.85rem; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                          ${st.name}
                        </div>
                        <div style="font-size: 0.72rem; color: ${_stStatusColor}; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                          ${_stStatusLabel}
                        </div>
                      </div>
                    </div>
                  `;
        }).join('')
        : `
                <div style="color: var(--text-muted); font-size: 0.82rem; padding: 6px 0;">
                  No stylists registered yet. Add staff to activate live floor stations.
                </div>
              `
      }
          </div>
        </div>
      </div>

      <!-- Bento KPI Metrics Grid -->
      <div class="stats-grid">

        <!-- 1. Revenue Hero Card (Champagne Gold) -->
        <div class="stat-card stat-card-revenue">
          <div class="stat-card-header">
            <span class="stat-label">${labelPrefix} REVENUE</span>
            <div class="stat-icon-wrapper" style="background: rgba(245,158,11,0.15); border-color: rgba(245,158,11,0.3);">
              ${Icons.trendingUp({ size: 18, color: '#fbbf24' })}
            </div>
          </div>
          <div class="stat-value">₹${todayRevenue.toLocaleString()}</div>
          <div class="stat-sub">
            <span>Collected from completed appointments</span>
          </div>
        </div>

        <!-- 2. Today's Bookings Card -->
        <div class="stat-card">
          <div class="stat-card-header">
            <span class="stat-label">${labelPrefix} BOOKINGS</span>
            <div class="stat-icon-wrapper" style="background: rgba(139, 61, 255,0.12); border-color: rgba(139, 61, 255,0.25);">
              ${Icons.calendar({ size: 18, color: '#A855F7' })}
            </div>
          </div>
          <div class="stat-value" style="color: #c7d2fe;">${statusCounts.total}</div>
          <div class="stat-sub">
            <span>Confirmed: <strong style="color: #fff;">${bookedConfirmedCount}</strong></span>
            <span>•</span>
            <span>Waiting: <strong style="color: #fbbf24;">${waitingDisplayCount}</strong></span>
          </div>
        </div>

        <!-- 3. In Chair Active Stations -->
        <div class="stat-card">
          <div class="stat-card-header">
            <span class="stat-label">ACTIVE CHAIRS</span>
            <div class="stat-icon-wrapper" style="background: rgba(139,92,246,0.12); border-color: rgba(139,92,246,0.25);">
              ${Icons.armchair({ size: 18, color: '#c084fc' })}
            </div>
          </div>
          <div class="stat-value" style="color: #c084fc;">${inChairDisplayCount}</div>
          <div class="stat-sub">
            <span class="q-live-dot" style="width: 6px; height: 6px; display: inline-block;"></span>
            <span>Active stations currently occupied</span>
          </div>
        </div>

        <!-- 4. Completed Visits -->
        <div class="stat-card">
          <div class="stat-card-header">
            <span class="stat-label">COMPLETED VISITS</span>
            <div class="stat-icon-wrapper" style="background: rgba(16,185,129,0.12); border-color: rgba(16,185,129,0.25);">
              ${Icons.checkCircle2({ size: 18, color: '#34d399' })}
            </div>
          </div>
          <div class="stat-value" style="color: #34d399;">${statusCounts.completed}</div>
          <div class="stat-sub">
            <span>Freed up station capacity</span>
          </div>
        </div>
      </div>

      <!-- WhatsApp Monthly Free Quota Tracker -->
      <div class="glass-panel" style="margin-bottom: 24px; padding: 20px 24px; border: 1px solid rgba(37,211,102,0.2); background: linear-gradient(135deg, rgba(37,211,102,0.04) 0%, rgba(22, 14, 28,0.85) 60%);">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; gap: 14px;">
            <div style="width: 44px; height: 44px; border-radius: 12px; background: rgba(37,211,102,0.12); border: 1px solid rgba(37,211,102,0.25); display: flex; align-items: center; justify-content: center;">
              ${Icons.messageCircle({ size: 24, color: '#25D366' })}
            </div>
            <div>
              <div style="font-weight: 800; font-size: 1.05rem; color: #fff; letter-spacing: -0.01em;">WhatsApp Booking Quota</div>
              <div style="font-size: 0.78rem; color: var(--text-muted);">1,000 free customer booking sessions included every month by Meta</div>
            </div>
          </div>
          <span class="badge ${this.summaryData.whatsappQuota?.percentUsed >= 90 ? 'badge-cancelled' : this.summaryData.whatsappQuota?.percentUsed >= 75 ? 'badge-in_service' : 'badge-completed'}" style="font-size: 0.78rem; padding: 6px 14px;">
            ${(this.summaryData.whatsappQuota?.remaining !== undefined ? this.summaryData.whatsappQuota.remaining : 1000)} Free Chats Left
          </span>
        </div>

        <!-- Progress Bar -->
        <div style="width: 100%; height: 7px; background: rgba(255, 255, 255, 0.08); border-radius: 8px; overflow: hidden; margin-bottom: 10px;">
          <div style="width: ${Math.max(2, this.summaryData.whatsappQuota?.percentUsed || 0)}%; height: 100%; background: ${this.summaryData.whatsappQuota?.percentUsed >= 90 ? 'linear-gradient(90deg, #f43f5e, #fb7185)' : this.summaryData.whatsappQuota?.percentUsed >= 75 ? 'linear-gradient(90deg, #f59e0b, #fbbf24)' : 'linear-gradient(90deg, #10b981, #34d399)'}; border-radius: 8px; transition: width 0.4s ease;"></div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem; color: var(--text-secondary); flex-wrap: wrap; gap: 8px;">
          <div><strong style="color: #fff;">${this.summaryData.whatsappQuota?.used || 0}</strong> / ${this.summaryData.whatsappQuota?.limit || 1000} chats used this month (${this.summaryData.whatsappQuota?.percentUsed || 0}%)</div>
          <div style="display: flex; align-items: center; gap: 5px;">
            ${Icons.refreshCw({ size: 13, color: '#A855F7' })}
            <span>Free quota resets on: <strong style="color: #a5b4fc;">${this.summaryData.whatsappQuota?.resetsOn || '1st of next month'}</strong></span>
          </div>
        </div>
      </div>

      <!-- Fast Action Command Launchpad -->
      <div class="glass-panel" style="margin-bottom: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px;">
          <h3 style="font-size: 1.15rem; display: flex; align-items: center; gap: 8px;">
            ${Icons.zap({ size: 18, color: '#fbbf24' })}
            <span>Fast Store Actions</span>
          </h3>
          <span style="font-size: 0.78rem; color: var(--text-muted);">Instant floor operations</span>
        </div>

        <div class="action-tiles-grid">
          <!-- Action 1: Walk-In -->
          <div class="action-tile" id="card-action-walkin">
            <div class="action-tile-icon" style="background: rgba(139, 61, 255,0.15); border: 1px solid rgba(139, 61, 255,0.3);">
              ${Icons.zap({ size: 22, color: '#a5b4fc' })}
            </div>
            <div class="action-tile-title">Fast Walk-In</div>
            <div class="action-tile-desc">Register client in 10s and assign an available stylist chair</div>
          </div>

          <!-- Action 2: WhatsApp Booking QR -->
          <div class="action-tile" id="card-action-qr">
            <div class="action-tile-icon" style="background: rgba(16,185,129,0.15); border: 1px solid rgba(16,185,129,0.3);">
              ${Icons.qrCode({ size: 22, color: '#34d399' })}
            </div>
            <div class="action-tile-title">Booking QR Poster</div>
            <div class="action-tile-desc">Display printable WhatsApp booking QR code for store walk-ins</div>
          </div>

          <!-- Action 3: Live Queue -->
          <div class="action-tile" id="card-action-queue">
            <div class="action-tile-icon" style="background: rgba(139,92,246,0.15); border: 1px solid rgba(139,92,246,0.3);">
              ${Icons.queue({ size: 22, color: '#c084fc' })}
            </div>
            <div class="action-tile-title">Chair Queue (${todayAppointments.length})</div>
            <div class="action-tile-desc">Manage check-ins, occupied chairs, and real-time station timers</div>
          </div>

          <!-- Action 4: Share Store Link -->
          <div class="action-tile" id="card-action-copy">
            <div class="action-tile-icon" style="background: rgba(14,165,233,0.15); border: 1px solid rgba(14,165,233,0.3);">
              ${Icons.copy({ size: 22, color: '#38bdf8' })}
            </div>
            <div class="action-tile-title">Share Booking Link</div>
            <div class="action-tile-desc">Copy direct booking URL for Instagram bio, Google Maps, or WhatsApp</div>
          </div>


        </div>
      </div>


      <!-- Stylists & Live Station Overview -->
      <div class="glass-panel">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 10px;">
          <div>
            <h3 style="font-size: 1.15rem; display: flex; align-items: center; gap: 8px;">
              ${Icons.users({ size: 18, color: '#A855F7' })}
              <span>Stylist Floor Status (${((sl, d) => sl.filter(s => s.status === 'ACTIVE' && !(s.absences || []).some(ab => {
                const s = (ab.startDate || '').split('T')[0];
                const e = (ab.endDate || s).split('T')[0];
                return s <= d && e >= d && ab.status === 'ACTIVE';
              })).length)(this.staffList, this.selectedDate || new Date().toISOString().split('T')[0])} Available Today)</span>
            </h3>
            <p style="font-size: 0.82rem; color: var(--text-secondary);">Current station occupancy and working specialists.</p>
          </div>
          <button class="btn btn-secondary btn-sm" id="btn-goto-staff" style="gap: 6px;">
            <span>Manage Specialists</span>
            ${Icons.arrowRight({ size: 14 })}
          </button>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px;">
          ${this.staffList.map((st) => {
        const activeBookings = todayAppointments.filter((a) => a.staffId === st.id && (a.status === 'IN_PROGRESS' || a.status === 'CHECKED_IN'));
        const isBusy = activeBookings.length > 0;
        const _fsDateIso = (this.selectedDate || new Date().toISOString().split('T')[0]);
        const _fsAbsent = (st.absences || []).some((ab) => {
          if (ab.status !== 'ACTIVE') return false;
          const sDate = (ab.startDate || '').split('T')[0];
          const eDate = (ab.endDate || sDate).split('T')[0];
          return _fsDateIso >= sDate && _fsDateIso <= eDate;
        });
        const _fsBorderColor = _fsAbsent ? '#fb7185' : isBusy ? '#8b5cf6' : '#10b981';
        const _fsStatusColor = _fsAbsent ? '#fb7185' : isBusy ? '#c084fc' : '#34d399';
        const _fsStatusLabel = _fsAbsent ? '🚫 Absent Today' : isBusy ? 'Serving in Chair' : 'Ready for Walk-in';
        return `
              <div class="staff-card" style="display: flex; align-items: center; gap: 14px; padding: 16px; ${_fsAbsent ? 'opacity: 0.55;' : ''}">
                <div class="staff-avatar" style="width: 44px; height: 44px; font-size: 1.1rem; border-radius: 12px; border: 2px solid ${_fsBorderColor}; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.05); font-weight: 800; color: #fff;">
                  ${st.profileImageUrl ? `<img src="${st.profileImageUrl}" alt="${st.name}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 10px;" />` : st.name.charAt(0).toUpperCase()}
                </div>
                <div style="flex: 1;">
                  <div style="font-weight: 700; color: #fff; font-size: 0.95rem;">${st.name}</div>
                  <div style="font-size: 0.78rem; display: flex; align-items: center; gap: 6px; margin-top: 2px; color: ${_fsStatusColor}; font-weight: 600;">
                    <span class="q-live-dot" style="width: 5px; height: 5px; background: ${_fsBorderColor}; box-shadow: 0 0 8px ${_fsBorderColor};"></span>
                    <span>${_fsStatusLabel}</span>
                  </div>
                </div>
              </div>
            `;
      }).join('')}
        </div>
      </div>

    `;
  }

  // =========================================================================
  // TAB 3: PURPOSE-DRIVEN OPERATOR CHAIR QUEUE (COMPACT & SORTED)
  // =========================================================================
  renderQueueTab() {
    try {
      const summary = this.summaryData || {};
      const statusCounts = summary.statusCounts || {
        total: 0,
        booked: 0,
        confirmed: 0,
        checkedIn: 0,
        onTheWay: 0,
        inService: 0,
        seatedInChair: 0,
        completed: 0,
        cancelled: 0,
        noShow: 0,
        rejected: 0,
        pendingAcceptance: 0,
        pendingReschedule: 0,
      };
      const todayAppointments = Array.isArray(summary.todayAppointments)
        ? summary.todayAppointments
        : [];

      // Architecture-Level Tiered Queue Prioritization Engine:
      // Tier 0: PENDING_ACCEPTANCE (Quick booking requests needing immediate operator action)
      // Tier 1: IN_SERVICE / SEATED_IN_CHAIR (Occupying chair right now)
      // Tier 2: CHECKED_IN / ARRIVED (Physically present in salon, awaiting chair)
      // Tier 3: ON_THE_WAY / En-Route (Client traveling to salon)
      // Tier 4: BOOKED / CONFIRMED (Upcoming today: chronological earliest slot first)
      // Tier 5: BOOKED / CONFIRMED Overdue (startAt has passed > 15m without check-in)
      // Tier 6: PENDING_RESCHEDULE (Awaiting customer action)
      // Tier 7: COMPLETED (Finished visits, sunk to bottom)
      // Tier 8: CANCELLED / NO_SHOW / REJECTED (Freed chair capacity, sunk to bottom)
      const nowMs = Date.now();

      const evaluateQueueItem = (appt) => {
        const status = appt.status || 'BOOKED';
        const startMs = new Date(appt.startTime || appt.startAt || 0).getTime() || 0;
        const isEnRoute = appt.clientEtaStatus === 'ON_THE_WAY' || status === 'ON_THE_WAY';
        const isLobby = status === 'CHECKED_IN' || appt.clientEtaStatus === 'ARRIVED';
        const isInChair = status === 'IN_SERVICE' || status === 'SEATED_IN_CHAIR';

        if (status === 'PENDING_ACCEPTANCE') return { tier: 0, isUpcoming: true, isOverdue: false };
        if (isInChair) return { tier: 1, isUpcoming: false, isOverdue: false, isInChair: true };
        if (isLobby) return { tier: 2, isUpcoming: false, isOverdue: false, isLobby: true };
        if (isEnRoute) return { tier: 3, isUpcoming: true, isOverdue: false, isEnRoute: true };
        if (status === 'CONFIRMED' || status === 'BOOKED') {
          // If start time was more than 15 minutes ago, classify as Overdue/Late
          const isOverdue = startMs > 0 && startMs < (nowMs - 15 * 60 * 1000);
          if (isOverdue) {
            return { tier: 5, isUpcoming: false, isOverdue: true };
          }
          return { tier: 4, isUpcoming: true, isOverdue: false };
        }
        if (status === 'PENDING_RESCHEDULE') return { tier: 6, isUpcoming: true, isOverdue: false };
        if (status === 'COMPLETED') return { tier: 7, isUpcoming: false, isOverdue: false };
        if (status === 'CANCELLED' || status === 'REJECTED') {
          return { tier: 8, isUpcoming: false, isOverdue: false };
        }
        return { tier: 9, isUpcoming: false, isOverdue: false };
      };

      const sortedAppointments = [...todayAppointments].sort((a, b) => {
        const itemA = evaluateQueueItem(a);
        const itemB = evaluateQueueItem(b);

        // Tier separation: Lower tier numbers ALWAYS precede higher tiers
        if (itemA.tier !== itemB.tier) {
          return itemA.tier - itemB.tier;
        }

        // Secondary sorting within same tier:
        // For active/upcoming tiers (0-6): Earliest scheduled start time first
        if (itemA.tier <= 6) {
          const timeA = new Date(a.startTime || a.startAt || 0).getTime() || 0;
          const timeB = new Date(b.startTime || b.startAt || 0).getTime() || 0;
          return timeA - timeB;
        }

        // For terminal tiers (7-8: Completed, Cancelled, No-Show):
        // Reverse-chronological: Most recently updated/concluded first
        const timeA = new Date(a.updatedAt || a.startTime || a.startAt || 0).getTime() || 0;
        const timeB = new Date(b.updatedAt || b.startTime || b.startAt || 0).getTime() || 0;
        return timeB - timeA;
      });

      // Filter appointments based on operator selection
      let filteredAppointments = sortedAppointments;
      if (this.queueFilter === 'WAITING') {
        filteredAppointments = sortedAppointments.filter((a) =>
          ['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'ON_THE_WAY', 'PENDING_ACCEPTANCE', 'PENDING_RESCHEDULE'].includes(a.status)
        );
      } else if (this.queueFilter === 'IN_CHAIR') {
        filteredAppointments = sortedAppointments.filter((a) => a.status === 'IN_SERVICE' || a.status === 'SEATED_IN_CHAIR');
      } else if (this.queueFilter === 'COMPLETED') {
        filteredAppointments = sortedAppointments.filter((a) => a.status === 'COMPLETED');
      } else if (this.queueFilter === 'CANCELLED') {
        filteredAppointments = sortedAppointments.filter((a) => ['CANCELLED', 'REJECTED'].includes(a.status));
      }

      const waitingCount =
        (statusCounts.booked || 0) +
        (statusCounts.confirmed || 0) +
        (statusCounts.checkedIn || 0) +
        (statusCounts.onTheWay || 0) +
        (statusCounts.pendingAcceptance || 0) +
        (statusCounts.pendingReschedule || 0);
      const inChairCount = (statusCounts.inService || 0) + (statusCounts.seatedInChair || 0);
      const completedCount = statusCounts.completed || 0;
      const cancelledCount = (statusCounts.cancelled || 0) + (statusCounts.noShow || 0) + (statusCounts.rejected || 0);

      const todayISO = this.getLocalDateString();
      const [sy, sm, sd] = (this.selectedDate || todayISO).split('-').map(Number);
      const selDate = new Date(sy, sm - 1, sd);
      const [ty, tm, td] = todayISO.split('-').map(Number);
      const todayDate = new Date(ty, tm - 1, td);
      const diffDays = Math.round((selDate - todayDate) / (1000 * 60 * 60 * 24));

      let datePrefix = '';
      if (diffDays === 0) datePrefix = 'Today, ';
      else if (diffDays === 1) datePrefix = 'Tom, ';
      else if (diffDays === -1) datePrefix = 'Yest, ';

      const formattedDateLabel = datePrefix + selDate.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });

      // Avatar color rotation
      const avatarColors = ['blue', 'purple', 'teal', 'amber', 'rose'];
      const getAvatarColor = (name) => {
        const idx = (name || '').charCodeAt(0) % avatarColors.length;
        return avatarColors[idx];
      };
      const getInitials = (name) => {
        if (!name) return '?';
        const parts = name.trim().split(/\s+/);
        return parts.length >= 2
          ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
          : parts[0].substring(0, 2).toUpperCase();
      };

      // Format phone for display
      const formatPhone = (phone) => {
        if (!phone) return 'No Phone';
        const clean = phone.replace(/[^0-9+]/g, '');
        if (clean.startsWith('+91') && clean.length >= 12) {
          return `+91 ${clean.slice(3, 8)} ${clean.slice(8)}`;
        }
        return clean;
      };

      // Format Booking Creation Time & Source Channel
      const formatBookingOrigin = (appt) => {
        const createdDt = appt.createdAt ? new Date(appt.createdAt) : null;
        let timeLabel = '';
        if (createdDt && !isNaN(createdDt.getTime())) {
          const diffMins = Math.floor((Date.now() - createdDt.getTime()) / 60000);
          if (diffMins < 1) {
            timeLabel = 'Just now';
          } else if (diffMins < 60) {
            timeLabel = `${diffMins}m ago`;
          } else if (diffMins < 1440) {
            const hours = Math.floor(diffMins / 60);
            timeLabel = `${hours}h ago`;
          } else {
            timeLabel = createdDt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          }
        }

        const source = (appt.source || 'WEB').toUpperCase();
        if (source === 'WHATSAPP') {
          return `
            <span class="qc__meta-source qc__meta-source--wa" title="Booked via WhatsApp Assistant">
              ${Icons.whatsapp({ size: 12, color: '#25D366' })}
              <span>${timeLabel ? `Booked ${timeLabel} · WhatsApp` : 'WhatsApp Booking'}</span>
            </span>
          `;
        } else if (source === 'WALK_IN') {
          return `
            <span class="qc__meta-source qc__meta-source--walkin" title="Direct Walk-In Client">
              ${Icons.zap({ size: 12, color: '#f59e0b' })}
              <span>${timeLabel ? `Walk-In ${timeLabel}` : 'Direct Walk-In'}</span>
            </span>
          `;
        } else {
          return `
            <span class="qc__meta-source qc__meta-source--web" title="Booked via Online Web Portal">
              ${Icons.globe({ size: 12, color: '#A855F7' })}
              <span>${timeLabel ? `Booked ${timeLabel} · Online` : 'Online Booking'}</span>
            </span>
          `;
        }
      };

      // Format Scheduled Service Time Range Window (12-Hour AM/PM)
      const formatServiceTimeRange = (appt) => {
        const rawStart = appt.startTime || appt.startAt;
        const startDt = rawStart ? new Date(rawStart) : new Date();
        const startTimeStr = formatTime12h(startDt) || '--:--';

        const servicesList = getApptServices(appt);

        let totalDurationMins = appt.durationMinutes || 0;
        if (!totalDurationMins && servicesList.length > 0) {
          totalDurationMins = servicesList.reduce((sum, s) => sum + (s.durationMinutes || 0), 0);
        }
        if (!totalDurationMins) totalDurationMins = 30;

        let durationDisplayStr = `${totalDurationMins}m`;

        if (servicesList.length > 1) {
          const individualDurations = servicesList
            .map((s) => s.durationMinutes || 0)
            .filter((d) => d > 0);
          if (individualDurations.length === servicesList.length) {
            durationDisplayStr = `${individualDurations.join(' + ')} min`;
          }
        }

        const rawEnd = appt.endTime || appt.endAt;
        const endDt = rawEnd ? new Date(rawEnd) : new Date(startDt.getTime() + totalDurationMins * 60000);
        const endTimeStr = formatTime12h(endDt) || '--:--';
        return { startTimeStr, endTimeStr, timeRangeStr: `${startTimeStr} – ${endTimeStr}`, durationMins: totalDurationMins, durationDisplayStr };
      };

      // Format Cancellation Details and Timestamp (12-Hour AM/PM)
      const formatCancellationDetails = (appt) => {
        const historyList = Array.isArray(appt.statusHistory) ? appt.statusHistory : [];
        const cancelEntry = historyList.find((h) => h.newStatus === 'CANCELLED') || historyList[0];
        const cancelledDt = cancelEntry?.createdAt
          ? new Date(cancelEntry.createdAt)
          : (appt.updatedAt ? new Date(appt.updatedAt) : null);

        let timeStr = '';
        let relativeAgo = '';
        if (cancelledDt && !isNaN(cancelledDt.getTime())) {
          timeStr = formatTime12h(cancelledDt);
          const diffMins = Math.floor((Date.now() - cancelledDt.getTime()) / 60000);
          if (diffMins < 1) relativeAgo = 'just now';
          else if (diffMins < 60) relativeAgo = `${diffMins}m ago`;
          else if (diffMins < 1440) relativeAgo = `${Math.floor(diffMins / 60)}h ago`;
          else relativeAgo = cancelledDt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }

        const reason = cancelEntry?.reason || appt.cancellationReason || 'Cancelled by customer or operator';
        return { timeStr, relativeAgo, reason };
      };

      return `
        <!-- Date Bar -->
        <div class="q-date-bar">
          <div class="q-date-nav">
            <button class="q-date-arrow" id="btn-date-prev" title="Previous Day">
              ${Icons.chevronLeft({ size: 16 })}
            </button>
            <div class="q-date-badge" title="Tap to select date">
              <span class="q-date-icon">${Icons.calendar({ size: 15, color: '#a5b4fc' })}</span>
              <span class="q-date-text" id="date-label-display">${formattedDateLabel}</span>
              <input type="date" class="q-date-hidden" id="dashboard-date-picker" value="${this.selectedDate}" />
            </div>
            <button class="q-date-arrow" id="btn-date-next" title="Next Day">
              ${Icons.chevronRight({ size: 16 })}
            </button>
            ${diffDays !== 0 ? `<button class="q-today-btn" id="btn-date-today">Today</button>` : ''}
          </div>

          <div class="q-live-sync">
            <div class="q-live-pill">
              <span class="q-live-dot"></span>
              <span class="q-live-label">Live</span>
            </div>
            <button class="q-sync-btn" id="btn-refresh-queue" title="Sync Queue">
              ${Icons.refreshCw({ size: 14 })}
            </button>
          </div>
        </div>

        <!-- Filter Chips -->
        <div class="q-filters">
          <button class="q-chip ${this.queueFilter === 'ALL' ? 'active' : ''}" data-filter="ALL">
            All <span class="q-chip-count">${todayAppointments.length}</span>
          </button>
          <button class="q-chip ${this.queueFilter === 'WAITING' ? 'active' : ''}" data-filter="WAITING">
            Waiting <span class="q-chip-count">${waitingCount}</span>
          </button>
          <button class="q-chip ${this.queueFilter === 'IN_CHAIR' ? 'active' : ''}" data-filter="IN_CHAIR">
            In Chair <span class="q-chip-count">${inChairCount}</span>
          </button>
          <button class="q-chip ${this.queueFilter === 'COMPLETED' ? 'active' : ''}" data-filter="COMPLETED">
            Done <span class="q-chip-count">${completedCount}</span>
          </button>
          <button class="q-chip ${this.queueFilter === 'CANCELLED' ? 'active' : ''}" data-filter="CANCELLED">
            Cancelled <span class="q-chip-count">${cancelledCount}</span>
          </button>
        </div>

        <!-- Queue Cards Stream -->
        <div class="q-stream">
          ${filteredAppointments.length === 0 ? `
            <div class="q-empty">
              <div class="q-empty-orb">
                ${Icons.armchair({ size: 30, color: '#A855F7' })}
              </div>
              <div class="q-empty-title">Queue is Clear & Ready</div>
              <div class="q-empty-sub">
                No ${this.queueFilter === 'ALL' ? '' : this.queueFilter.toLowerCase() + ' '}appointments currently waiting. Walk-in arrivals or WhatsApp bookings appear here in real-time.
              </div>
              <div class="q-empty-actions">
                <button class="btn btn-primary btn-sm btn-fast-walkin" id="btn-fast-walkin" style="gap: 6px; padding: 9px 18px; font-weight: 700; border-radius: 10px;">
                  ${Icons.zap({ size: 14, color: '#fff' })}
                  <span>Fast Walk-In Client</span>
                </button>
                <button class="btn btn-secondary btn-sm" id="btn-empty-sync" style="gap: 6px; padding: 9px 16px; border-radius: 10px;">
                  ${Icons.refreshCw({ size: 13, color: '#A855F7' })}
                  <span>Sync Queue</span>
                </button>
              </div>
            </div>
          ` : filteredAppointments.map((appt) => {
        const customer = appt.customer || appt.user || {};
        const staff = appt.staff || appt.stylist || {};
        const service = appt.service || {};
        const customerName = customer.name || 'Walk-In Client';
        const staffName = staff.name || 'Any Stylist';
        const staffId = staff.id || appt.stylistId || appt.staffId || '';
        const serviceId = service.id || appt.serviceId || '';
        const apptSvcs = getApptServices(appt);
        const serviceName = apptSvcs.map((s) => s.name).join(' + ') || appt.serviceNameSnapshot || service.name || 'Service';
        const price = appt.price ?? service.price ?? 0;

        const timeRange = formatServiceTimeRange(appt);
        const cancelDetails = formatCancellationDetails(appt);
        const cleanPhone = (customer.phone || '').replace(/[^0-9+]/g, '');
        const rawPhoneForWa = cleanPhone.replace('+', '');
        const initials = getInitials(customerName);
        const avatarCls = getAvatarColor(customerName);
        const isDone = appt.status === 'COMPLETED';
        const isCancelled = ['CANCELLED', 'REJECTED'].includes(appt.status);
        const statusKey = (appt.status || 'CONFIRMED').toLowerCase();
        const queueItemEval = evaluateQueueItem(appt);
        const isOverdue = queueItemEval.isOverdue;

        const rawStart = appt.startTime || appt.startAt;
        const startDt = rawStart ? new Date(rawStart) : new Date();
        const elapsedMins = Math.max(0, Math.floor((Date.now() - startDt.getTime()) / 60000));
        const remainingMins = Math.max(0, (service.durationMinutes || appt.durationMinutes || 30) - elapsedMins);

        return `
              <div class="qc ${isDone ? 'qc--done' : ''} ${isCancelled ? 'qc--cancelled' : ''}">
                <div class="qc__accent qc__accent--${statusKey}" style="background: ${this.getStatusColor(appt.status)};"></div>

                <div class="qc__body">
                  <!-- Row 1: Time Window, Origin Telemetry, Status & Price -->
                  <div class="qc__row1">
                    <div class="qc__time-block">
                      <div class="qc__time-primary">
                        <span class="qc__time">${timeRange.timeRangeStr}</span>
                        <span class="qc__duration-pill">${timeRange.durationDisplayStr}</span>
                      </div>
                      <div class="qc__booking-meta">
                        ${formatBookingOrigin(appt)}
                      </div>
                    </div>
                    <div class="qc__status-wrap">
                      <span class="qc__status qc__status--${statusKey}">${(appt.status || 'CONFIRMED').replace('_', ' ')}</span>
                      <span class="qc__price">₹${price}</span>
                    </div>
                  </div>

                  <!-- If Cancelled: Luxury High-Visibility Cancellation Alert Box -->
                  ${isCancelled ? `
                    <div class="qc__cancellation-card">
                      <div class="qc__cancellation-header">
                        <span class="qc__cancellation-icon">${Icons.xCircle({ size: 14, color: '#fb7185' })}</span>
                        <span class="qc__cancellation-time">Cancelled at ${cancelDetails.timeStr}${cancelDetails.relativeAgo ? ` (${cancelDetails.relativeAgo})` : ''}</span>
                        <span class="qc__cancellation-badge">CHAIR FREED</span>
                      </div>
                      <div class="qc__cancellation-reason">
                        <strong>Reason:</strong> ${cancelDetails.reason}
                      </div>
                    </div>
                  ` : ''}

                  <!-- Row 2: Client Name, Phone, Assigned Barber + Quick Contact -->
                  <div class="qc__row2">
                    <div class="qc__client-info">
                      <div class="qc__avatar qc__avatar--${avatarCls}">
                        ${initials}
                      </div>
                      <div class="qc__client-text">
                        <div class="qc__name">${customerName}</div>
                        <div class="qc__phone">${formatPhone(cleanPhone)}</div>
                        <div class="qc__barber">Specialist: <strong>${staffName}</strong></div>
                      </div>
                    </div>
                    <div class="qc__contacts">
                      ${cleanPhone ? `
                        <a href="tel:${cleanPhone}" class="qc__contact-btn qc__contact-btn--call" title="Direct Call">
                          ${Icons.phone({ size: 16 })}
                        </a>
                        <a href="https://wa.me/${rawPhoneForWa}" target="_blank" class="qc__contact-btn qc__contact-btn--wa" title="WhatsApp Message">
                          ${Icons.whatsapp({ size: 16 })}
                        </a>
                      ` : ''}
                    </div>
                  </div>

                  <!-- Row 3: Service Tag + Live Status Badges + Live 10m Countdown -->
                  <div class="qc__row3" style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
                    ${(() => {
            const servicesList = getApptServices(appt);
            if (servicesList.length === 0) {
              return `
                          <span class="qc__tag qc__tag--service">
                            ${Icons.scissors({ size: 13, color: '#94a3b8' })}
                            <span>Service</span>
                          </span>
                        `;
            }
            return servicesList.map((s) => {
              const isAddon = s.isAddon;
              return `
                          <span class="qc__tag qc__tag--service ${isAddon ? 'qc__tag--addon' : ''}" style="${isAddon ? 'background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35); font-weight: 700;' : ''}">
                            ${Icons.scissors({ size: 13, color: isAddon ? '#fbbf24' : '#94a3b8' })}
                            <span>${s.name}${isAddon ? ' (Add-on)' : ''}</span>
                          </span>
                        `;
            }).join('');
          })()}
                    ${appt.status === 'IN_SERVICE' || appt.status === 'SEATED_IN_CHAIR' ? `
                      <span class="qc__tag qc__tag--inchair">
                        <span class="qc__pulse-dot"></span>
                        <span>In Chair · ~${remainingMins}m left</span>
                      </span>
                    ` : ''}

                    ${isOverdue && !isDone && !isCancelled ? `
                      <span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35); font-size: 0.72rem; padding: 4px 8px; border-radius: 6px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
                        ⚠️ Scheduled Slot Passed
                      </span>
                    ` : ''}

                    <!-- Customer WhatsApp Action Badges -->
                    ${appt.status === 'BOOKED' ? `
                      <span class="badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.35); font-size: 0.72rem; padding: 4px 8px; border-radius: 6px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
                        ${Icons.calendar({ size: 13, color: '#60a5fa' })}
                        <span>📅 Booked</span>
                      </span>
                    ` : ''}

                    ${appt.status === 'PENDING_RESCHEDULE' ? `
                      <span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35); font-size: 0.72rem; padding: 4px 8px; border-radius: 6px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
                        ${Icons.calendar({ size: 13, color: '#fbbf24' })}
                        <span>📅 Pending Reschedule Approval</span>
                      </span>
                    ` : ''}

                    ${appt.clientEtaStatus === 'ON_THE_WAY' ? `
                      <span class="badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35); font-size: 0.72rem; padding: 4px 8px; border-radius: 6px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
                        🚗 Client On the Way
                      </span>
                    ` : ''}

                    ${appt.clientEtaStatus === 'RUNNING_LATE_10M' || appt.clientEtaStatus === 'RUNNING_LATE_20M' ? `
                      <span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35); font-size: 0.72rem; padding: 4px 8px; border-radius: 6px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
                        ⏰ Client Running Late${appt.clientEtaStatus === 'RUNNING_LATE_20M' ? ' (20m)' : ' (10m)'}
                      </span>
                    ` : ''}

                    ${appt.customerActionStatus === 'WAITING_RESPONSE' || (appt.reminder10mSentAt && !appt.customerActionStatus && appt.status === 'CONFIRMED') ? `
                      <span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35); font-size: 0.72rem; padding: 4px 8px; border-radius: 6px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
                        ${Icons.clock({ size: 13, color: '#fbbf24' })}
                        <span>⏳ Waiting Response</span>
                      </span>
                    ` : ''}

                    ${appt.customerActionStatus === 'CANCELLED' ? `
                      <span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35); font-size: 0.72rem; padding: 4px 8px; border-radius: 6px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
                        ${Icons.xCircle({ size: 13, color: '#f87171' })}
                        <span>❌ Canceled via WhatsApp</span>
                      </span>
                    ` : ''}

                    <!-- 10-Minute Arrival Ticking Countdown Timer -->
                    ${appt.reminder10mSentAt ? (() => {
            const elapsedMs = Date.now() - new Date(appt.reminder10mSentAt).getTime();
            const remainingMs = (10 * 60 * 1000) - elapsedMs;
            if (remainingMs > 0) {
              const m = Math.floor(remainingMs / 60000);
              const s = Math.floor((remainingMs % 60000) / 1000);
              return `
                          <span class="badge qc__timer-badge" data-reminder-sent="${appt.reminder10mSentAt}" style="background: rgba(139, 61, 255, 0.15); color: #A855F7; border: 1px solid rgba(139, 61, 255, 0.35); font-size: 0.72rem; padding: 4px 8px; border-radius: 6px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
                            ${Icons.clock({ size: 13, color: '#A855F7' })}
                            <span>Arrival Window: <strong class="qc__timer-countdown">${m}:${s.toString().padStart(2, '0')}</strong> left</span>
                          </span>
                        `;
            } else {
              const graceMins = Math.floor(Math.abs(remainingMs) / 60000);
              return `
                          <span class="badge qc__timer-badge" data-reminder-sent="${appt.reminder10mSentAt}" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35); font-size: 0.72rem; padding: 4px 8px; border-radius: 6px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
                            ${Icons.alertTriangle ? Icons.alertTriangle({ size: 13, color: '#f87171' }) : '⚠️'}
                            <span>⚠️ Grace Period (+<strong class="qc__grace-countdown">${graceMins}m</strong>)</span>
                          </span>
                        `;
            }
          })() : ''}
                  </div>

                  <!-- Row 4: Action Bar -->
                  <div class="qc__row4">
                    ${appt.status === 'PENDING_ACCEPTANCE' ? `
                      <div class="qc__cta-wrap" style="display: flex; gap: 8px; width: 100%;">
                        <button class="qc__cta btn-status" data-id="${appt.id}" data-status="CHECKED_IN" style="background: #10b981; color: #fff; flex: 1;">
                          ${Icons.check({ size: 16, color: '#fff' })}
                          <span>Accept & Check In</span>
                        </button>
                        <button class="qc__cta btn-status" data-id="${appt.id}" data-status="CANCELLED" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); flex: 1;">
                          ${Icons.x({ size: 16, color: '#f87171' })}
                          <span>Decline</span>
                        </button>
                      </div>
                    ` : ''}

                    ${appt.status === 'CONFIRMED' || appt.status === 'BOOKED' ? `
                      <div class="qc__cta-wrap">
                        <button class="qc__cta qc__cta--checkin btn-status" data-id="${appt.id}" data-status="CHECKED_IN">
                          ${Icons.checkCircle2({ size: 16, color: '#c7d2fe' })}
                          <span>📍 Check In Client</span>
                        </button>
                      </div>
                      <div class="qc__sec-actions">
                        <button class="qc__sec-btn btn-open-reschedule" data-id="${appt.id}" data-service="${serviceId}" data-staff="${staffId}" data-name="${customerName}" title="Reschedule">
                          ${Icons.calendar({ size: 15 })}
                        </button>
                        <button class="qc__sec-btn qc__sec-btn--danger btn-open-cancel" data-id="${appt.id}" data-name="${customerName}" title="Cancel">
                          ${Icons.x({ size: 15 })}
                        </button>
                      </div>
                    ` : ''}

                    ${appt.status === 'CHECKED_IN' ? `
                      <div class="qc__cta-wrap">
                        <button class="qc__cta qc__cta--seat btn-status" data-id="${appt.id}" data-status="SEATED_IN_CHAIR">
                          ${Icons.armchair({ size: 16, color: '#fff' })}
                          <span>💺 Seat in Chair</span>
                        </button>
                      </div>
                      <div class="qc__sec-actions">
                        <button class="qc__sec-btn btn-open-reschedule" data-id="${appt.id}" data-service="${serviceId}" data-staff="${staffId}" data-name="${customerName}" title="Reschedule">
                          ${Icons.calendar({ size: 15 })}
                        </button>
                        <button class="qc__sec-btn qc__sec-btn--danger btn-open-cancel" data-id="${appt.id}" data-name="${customerName}" title="Cancel">
                          ${Icons.x({ size: 15 })}
                        </button>
                      </div>
                    ` : ''}

                    ${appt.status === 'IN_SERVICE' || appt.status === 'SEATED_IN_CHAIR' ? `
                      <div class="qc__cta-wrap">
                        <button class="qc__cta qc__cta--finish btn-status" data-id="${appt.id}" data-status="COMPLETED">
                          ${Icons.check({ size: 16, color: '#fff' })}
                          <span>✅ Complete & Free Chair</span>
                        </button>
                      </div>
                    ` : ''}

                    ${appt.status === 'PENDING_RESCHEDULE' ? `
                      <div class="qc__cta-wrap">
                        <button class="qc__cta" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35); cursor: default; width: 100%;" disabled>
                          ${Icons.clock({ size: 16, color: '#fbbf24' })}
                          <span>Waiting Customer WhatsApp Approval</span>
                        </button>
                      </div>
                    ` : ''}

                    ${isDone ? `<div class="qc__terminal qc__terminal--done" style="display: flex; align-items: center; justify-content: center; gap: 6px;">${Icons.checkCircle2({ size: 14, color: '#34d399' })} Service Completed</div>` : ''}
                    ${isCancelled ? `<div class="qc__terminal qc__terminal--cancel" style="display: flex; align-items: center; justify-content: center; gap: 6px;">${Icons.x({ size: 14, color: '#fb7185' })} Booking Cancelled · Chair Released</div>` : ''}
                  </div>
                </div>
              </div>
            `;
      }).join('')}

        </div>

      `;
    } catch (err) {
      console.error('[Dashboard] renderQueueTab error:', err);
      return `
        <div class="glass-panel" style="padding: 40px; text-align: center;">
          <div style="font-size: 1.1rem; font-weight: 700; color: #f43f5e; margin-bottom: 8px;">
            Unable to display live queue
          </div>
          <div style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 16px;">
            ${err?.message || 'An error occurred while rendering the chair queue.'}
          </div>
          <button class="btn btn-primary btn-sm" onclick="window.salonDashboard?.loadData(true).then(() => window.salonDashboard?.render())">
            Reload Queue
          </button>
        </div>
      `;
    }
  }

  getStatusColor(status) {
    switch (status) {
      case 'PENDING_ACCEPTANCE': return '#f59e0b';
      case 'BOOKED': return '#3b82f6';
      case 'CONFIRMED': return '#0ea5e9';
      case 'ON_THE_WAY': return '#10b981';
      case 'CHECKED_IN': return '#f59e0b';
      case 'IN_SERVICE': return '#a855f7';
      case 'SEATED_IN_CHAIR': return '#a855f7';
      case 'PENDING_RESCHEDULE': return '#f59e0b';
      case 'COMPLETED': return '#10b981';
      case 'CANCELLED': return '#f43f5e';
      case 'REJECTED': return '#f43f5e';
      default: return '#8B3DFF';
    }
  }

  // =========================================================================
  // TAB 2: STYLISTS & CAPACITY (MASTER-DETAIL WORKSPACE)
  // =========================================================================
  renderStaffTab() {
    try {
      if (this.selectedStaffId) {
        return this.staffManager.render();
      }
      return this.renderStaffListView();
    } catch (err) {
      console.error('[Dashboard] renderStaffTab error:', err);
      return `
        <div class="glass-panel text-center" style="padding: 40px; color: var(--danger);">
          <i class="fas fa-exclamation-triangle" style="font-size: 2rem; margin-bottom: 12px;"></i>
          <h5>Failed to load Stylist Dashboard</h5>
          <p style="font-size: 0.85rem;">${err?.message || 'An unexpected error occurred.'}</p>
          <button class="btn btn-primary btn-sm" onclick="window.salonDashboard?.loadData(true).then(() => window.salonDashboard?.render())">
            Retry Loading
          </button>
        </div>
      `;
    }
  }

  renderStaffListView() {
    const staff = Array.isArray(this.staffList) ? this.staffList : [];

    const enrichedStaff = staff.map((st) => {
      const statusCode = st.operationalStatus || (st.status === 'ACTIVE' ? 'AVAILABLE' : 'INACTIVE');
      const statusLabel = st.statusLabel || (statusCode === 'AVAILABLE' ? 'Available' : 'Inactive');
      const statusDotClass = st.statusDotClass || (statusCode === 'AVAILABLE' ? 'status-available' : 'status-inactive');
      const statusBadgeClass = st.statusBadgeClass || (statusCode === 'AVAILABLE' ? 'badge-available' : 'badge-inactive');
      const statusReason = st.statusReason || statusLabel;

      return {
        ...st,
        statusCode,
        statusLabel,
        statusDotClass,
        statusBadgeClass,
        statusReason,
      };
    });

    const totalCount = enrichedStaff.length;
    const availCount = enrichedStaff.filter((s) => s.statusCode === 'AVAILABLE').length;
    const workingCount = enrichedStaff.filter((s) => s.statusCode === 'WORKING').length;
    const breakCount = enrichedStaff.filter((s) => s.statusCode === 'ON_BREAK').length;
    const leaveCount = enrichedStaff.filter((s) => s.statusCode === 'ON_LEAVE').length;
    const offCount = enrichedStaff.filter((s) => s.statusCode === 'SALON_OFF').length;
    const inactiveCount = enrichedStaff.filter((s) => s.statusCode === 'INACTIVE').length;

    const query = (this.staffSearchQuery || '').trim().toLowerCase();
    const filter = this.staffStatusFilter || 'ALL';

    const filteredStaff = enrichedStaff.filter((s) => {
      if (filter !== 'ALL' && s.statusCode !== filter) {
        return false;
      }
      if (query) {
        const nameMatch = (s.name || '').toLowerCase().includes(query);
        const roleMatch = (s.role || '').toLowerCase().includes(query);
        const phoneMatch = (s.phone || '').toLowerCase().includes(query);
        return nameMatch || roleMatch || phoneMatch;
      }
      return true;
    });

    let currentFilterLabel = `All (${totalCount})`;
    let currentFilterDot = '';
    if (filter === 'AVAILABLE') {
      currentFilterLabel = `Available (${availCount})`;
      currentFilterDot = '<span class="trigger-status-dot dot-available"></span>';
    } else if (filter === 'WORKING') {
      currentFilterLabel = `In Chair (${workingCount})`;
      currentFilterDot = '<span class="trigger-status-dot dot-working"></span>';
    } else if (filter === 'ON_BREAK') {
      currentFilterLabel = `On Break (${breakCount})`;
      currentFilterDot = '<span class="trigger-status-dot dot-break"></span>';
    } else if (filter === 'ON_LEAVE') {
      currentFilterLabel = `On Leave (${leaveCount})`;
      currentFilterDot = '<span class="trigger-status-dot dot-leave"></span>';
    } else if (filter === 'SALON_OFF') {
      currentFilterLabel = `Salon Off (${offCount})`;
      currentFilterDot = '<span class="trigger-status-dot dot-off"></span>';
    } else if (filter === 'INACTIVE') {
      currentFilterLabel = `Inactive (${inactiveCount})`;
      currentFilterDot = '<span class="trigger-status-dot dot-inactive"></span>';
    }

    return `
      <div class="glass-panel stylist-screen-shell">
        <!-- Compact Space-Saving Header Bar -->
        <div class="stylist-list-header">
          <div class="stylist-title-row">
            <h3 class="stylist-list-title">Specialists & Stylists</h3>
            <span class="stylist-count-badge">${totalCount}</span>
          </div>
          <button type="button" class="btn-add-stylist" id="btn-add-staff">
            <span class="btn-add-plus">+</span>
            <span>Add Stylist</span>
          </button>
        </div>

        <!-- Integrated 1-Row Search & Custom Popover Filter (Max Space Efficiency) -->
        <div class="stylist-controls-bar">
          <div class="stylist-search-wrap">
            <span class="stylist-search-icon">🔍</span>
            <input type="text" class="stylist-search-input" id="input-search-stylists" placeholder="Search by name, role or phone..." value="${this.staffSearchQuery || ''}" />
            ${this.staffSearchQuery ? `<button type="button" class="stylist-search-clear" id="btn-clear-search-x" title="Clear query">✕</button>` : ''}
          </div>

          <div class="stylist-filter-container">
            <button type="button" class="stylist-filter-trigger ${filter !== 'ALL' ? 'is-filtered' : ''}" id="btn-staff-filter-trigger" aria-label="Filter stylists by status">
              ${currentFilterDot}
              <span class="filter-trigger-text">${currentFilterLabel}</span>
              <span class="filter-trigger-arrow">▾</span>
            </button>

            <!-- Custom Dark Luxury Popover Menu (Zero Native OS Select) -->
            <div class="stylist-filter-popover" id="staff-filter-popover">
              <div class="popover-title-row">
                <span class="popover-title">Filter by Status</span>
                ${filter !== 'ALL' ? `<button type="button" class="popover-clear-btn" data-filter="ALL">Clear</button>` : ''}
              </div>
              <div class="popover-items-list">
                <button type="button" class="popover-item ${filter === 'ALL' ? 'active' : ''}" data-filter="ALL">
                  <span class="popover-check">${filter === 'ALL' ? '✓' : ''}</span>
                  <span class="popover-item-label">All Stylists</span>
                  <span class="popover-item-count">${totalCount}</span>
                </button>
                <button type="button" class="popover-item ${filter === 'AVAILABLE' ? 'active' : ''}" data-filter="AVAILABLE">
                  <span class="popover-check">${filter === 'AVAILABLE' ? '✓' : ''}</span>
                  <span class="popover-dot dot-available"></span>
                  <span class="popover-item-label">Available</span>
                  <span class="popover-item-count">${availCount}</span>
                </button>
                <button type="button" class="popover-item ${filter === 'WORKING' ? 'active' : ''}" data-filter="WORKING">
                  <span class="popover-check">${filter === 'WORKING' ? '✓' : ''}</span>
                  <span class="popover-dot dot-working"></span>
                  <span class="popover-item-label">In Chair</span>
                  <span class="popover-item-count">${workingCount}</span>
                </button>
                <button type="button" class="popover-item ${filter === 'ON_BREAK' ? 'active' : ''}" data-filter="ON_BREAK">
                  <span class="popover-check">${filter === 'ON_BREAK' ? '✓' : ''}</span>
                  <span class="popover-dot dot-break"></span>
                  <span class="popover-item-label">On Break</span>
                  <span class="popover-item-count">${breakCount}</span>
                </button>
                <button type="button" class="popover-item ${filter === 'ON_LEAVE' ? 'active' : ''}" data-filter="ON_LEAVE">
                  <span class="popover-check">${filter === 'ON_LEAVE' ? '✓' : ''}</span>
                  <span class="popover-dot dot-leave"></span>
                  <span class="popover-item-label">On Leave</span>
                  <span class="popover-item-count">${leaveCount}</span>
                </button>
                <button type="button" class="popover-item ${filter === 'SALON_OFF' ? 'active' : ''}" data-filter="SALON_OFF">
                  <span class="popover-check">${filter === 'SALON_OFF' ? '✓' : ''}</span>
                  <span class="popover-dot dot-off"></span>
                  <span class="popover-item-label">Salon Off</span>
                  <span class="popover-item-count">${offCount}</span>
                </button>
                <button type="button" class="popover-item ${filter === 'INACTIVE' ? 'active' : ''}" data-filter="INACTIVE">
                  <span class="popover-check">${filter === 'INACTIVE' ? '✓' : ''}</span>
                  <span class="popover-dot dot-inactive"></span>
                  <span class="popover-item-label">Inactive</span>
                  <span class="popover-item-count">${inactiveCount}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Stylist Cards Grid -->
        ${filteredStaff.length === 0 ? `
          <div style="text-align: center; padding: 48px 16px; background: rgba(0,0,0,0.15); border-radius: 12px; border: 1px dashed rgba(255,255,255,0.1);">
            <div style="font-size: 2.2rem; margin-bottom: 8px;">👥</div>
            <h4 style="color: #fff; font-weight: 700; margin-bottom: 4px;">No stylists found</h4>
            <p style="color: #94a3b8; font-size: 0.8rem; margin-bottom: 12px;">Try adjusting your search query or status filter.</p>
            <button type="button" class="btn btn-secondary btn-sm" id="btn-clear-staff-search">Clear Search Filters</button>
          </div>
        ` : `
          <div class="stylist-cards-grid">
            ${filteredStaff.map((st) => {
      const initials = st.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
      const avatarHtml = st.profileImageUrl
        ? `<img src="${st.profileImageUrl}" class="stylist-card-avatar-img" alt="${st.name}" />`
        : `<div class="stylist-card-avatar-initials">${initials}</div>`;

      return `
                <div class="stylist-card" data-staff-id="${st.id}" role="button" tabindex="0" title="${st.statusReason || ('Tap to manage ' + st.name)}">
                  <div class="stylist-card-left">
                    <div class="stylist-card-avatar-wrap">
                      ${avatarHtml}
                      <span class="stylist-status-dot ${st.statusDotClass}"></span>
                    </div>
                    <div class="stylist-card-info">
                      <div class="stylist-card-name">${st.name}</div>
                      <div class="stylist-card-role">${st.role || 'Hair & Beard Specialist'}</div>
                      <div class="stylist-card-badges">
                        <span class="stylist-badge ${st.statusBadgeClass}" title="${st.statusReason}">${st.statusLabel}</span>
                        <span class="stylist-badge badge-services">✂️ ${(st.services || []).length} Services</span>
                      </div>
                      ${st.phone ? `
                        <div class="stylist-card-phone">
                          <span class="phone-icon">📞</span>
                          <span>${st.phone}</span>
                        </div>
                      ` : ''}
                    </div>
                  </div>
                  <div class="stylist-card-right">
                    <span class="stylist-card-arrow">&gt;</span>
                  </div>
                </div>
              `;
    }).join('')}
          </div>
        `}
      </div>
    `;
  }

  renderStaffLeavesSubtab(st) {
    setTimeout(() => {
      const calRoot = document.querySelector('.stylist-detail-subtab-body') || document.getElementById('staff-leaves-calendar-root');
      if (calRoot) {
        CalendarView.mount(calRoot, {
          app: this,
          calendarFor: 'STAFF',
          staffId: st.id,
          staffName: st.name,
        });
      }
    }, 0);
    return `<div id="staff-leaves-calendar-root" style="display:flex;align-items:center;justify-content:center;min-height:360px;color:#a5b4fc;"><div style="font-size:0.88rem;font-weight:600;">Loading specialist leaves...</div></div>`;
  }

  renderStaffHoursSubtab(st) {
    const daysArr = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
    const followsSalon = st.followsSalonSchedule === true;

    // Detect salon-wide operating window from database
    const salonProfile = this.salonProfile || {};
    const defaultSalonStart = salonProfile.defaultStartTime || null;
    const defaultSalonEnd = salonProfile.defaultEndTime || null;

    const activeSalonDays = (this.salonWorkingHours || []).filter((h) => !h.isClosed);
    const salonMinStart = activeSalonDays.length > 0
      ? activeSalonDays.reduce((min, h) => (h.startTime && h.startTime < min ? h.startTime : min), activeSalonDays[0].startTime)
      : defaultSalonStart;
    const salonMaxEnd = activeSalonDays.length > 0
      ? activeSalonDays.reduce((max, h) => (h.endTime && h.endTime > max ? h.endTime : max), activeSalonDays[0].endTime)
      : defaultSalonEnd;

    // Build normalized 7-day schedule map & detect routine breaks
    const daysObj = {};
    const allBreaksFound = [];

    daysArr.forEach((day) => {
      const customWh = Array.isArray(st.workingHours) ? st.workingHours.find((h) => h.dayOfWeek === day) : null;
      const salonHoursList = (this.salonWorkingHours && this.salonWorkingHours.length > 0)
        ? this.salonWorkingHours
        : (this.salonProfile?.workingHours || []);
      const salonWh = salonHoursList.find((h) => h.dayOfWeek === day);

      const isSalonStatusClosed = this.salonProfile?.status === 'INACTIVE' || this.salonProfile?.status === 'DEACTIVATED';
      const isSalonClosed = isSalonStatusClosed || (salonWh ? (Boolean(salonWh.isClosed) || Boolean(salonWh.is_closed)) : false);
      const salonStart = salonWh?.startTime || salonMinStart || defaultSalonStart;
      const salonEnd = salonWh?.endTime || salonMaxEnd || defaultSalonEnd;

      // Explicit isCustomized check per day:
      // True if specifically customized for this stylist or if explicitly marked off while salon is open
      const isCustomized = Boolean(customWh?.isCustomized) || (customWh && customWh.isWorking === false && !isSalonClosed);

      let isWorking = true;
      let startTime = salonStart;
      let endTime = salonEnd;
      let breaks = [];

      if (Array.isArray(st.breaks) && st.breaks.length > 0) {
        const dayBreaks = st.breaks.filter((b) => b.dayOfWeek === day);
        breaks = dayBreaks.map((b) => ({
          id: b.id,
          salonBreakId: b.salonBreakId || null,
          title: (b.title || 'Break').trim(),
          startTime: b.startTime,
          endTime: b.endTime,
          isCustomized: b.isCustomized === true,
        }));
      } else if (customWh && Array.isArray(customWh.breaks)) {
        breaks = customWh.breaks.map((b) => ({
          id: b.id,
          salonBreakId: b.salonBreakId || null,
          title: (b.title || 'Break').trim(),
          startTime: b.startTime,
          endTime: b.endTime,
          isCustomized: b.isCustomized === true,
        }));
      } else if (customWh && customWh.breakStartTime && customWh.breakEndTime) {
        breaks = [{ id: null, salonBreakId: null, title: 'Lunch Break', startTime: customWh.breakStartTime, endTime: customWh.breakEndTime, isCustomized: true }];
      } else if (salonWh && Array.isArray(salonWh.breaks)) {
        breaks = salonWh.breaks.map((b) => ({
          id: b.id,
          salonBreakId: b.id,
          title: (b.title || 'Break').trim(),
          startTime: b.startTime,
          endTime: b.endTime,
          isCustomized: false,
        }));
      }

      // Schedule evaluation:
      if (isCustomized || (customWh && (customWh.isWorking === false || customWh.isOff === true))) {
        isWorking = customWh.isWorking !== undefined ? Boolean(customWh.isWorking) : !customWh.isOff;
        startTime = customWh.startTime || salonStart;
        endTime = customWh.endTime || salonEnd;
      } else {
        // Uncustomized day: directly mirrors salon facility operating status!
        isWorking = !isSalonClosed;
        startTime = salonStart;
        endTime = salonEnd;
      }

      // Facility Boundary Check: If salon status is closed for this day, stylist cannot work
      if (isSalonClosed) {
        isWorking = false;
      }

      breaks.forEach((b) => {
        allBreaksFound.push({ ...b, day });
      });

      daysObj[day] = {
        day,
        friendlyDay: day.charAt(0) + day.slice(1).toLowerCase(),
        dayShort: day.slice(0, 3),
        isWorking: isSalonClosed ? false : isWorking,
        isCustomized,
        isSalonClosed,
        startTime,
        endTime,
        salonStart,
        salonEnd,
        breaks,
      };
    });

    // Dominant shift detection: find most frequent shift across active days
    const shiftFreq = {};
    daysArr.forEach((day) => {
      const d = daysObj[day];
      if (d && d.isWorking && d.startTime && d.endTime) {
        const key = `${d.startTime}_${d.endTime}`;
        shiftFreq[key] = (shiftFreq[key] || 0) + 1;
      }
    });

    let detectedMasterStart = salonMinStart || defaultSalonStart;
    let detectedMasterEnd = salonMaxEnd || defaultSalonEnd;
    let maxFreq = 0;
    for (const [shiftKey, count] of Object.entries(shiftFreq)) {
      if (count > maxFreq) {
        maxFreq = count;
        const [s, e] = shiftKey.split('_');
        detectedMasterStart = s;
        detectedMasterEnd = e;
      }
    }

    // Hard Facility Boundary clamp: Stylist master shift cannot exceed salon facility hours
    if (salonMinStart && detectedMasterStart < salonMinStart) detectedMasterStart = salonMinStart;
    if (salonMaxEnd && detectedMasterEnd > salonMaxEnd) detectedMasterEnd = salonMaxEnd;

    // Group breaks into Routine Breaks with isCustomized tracking
    let detectedRoutineBreaks = [];
    if (allBreaksFound.length > 0) {
      const grouped = {};
      allBreaksFound.forEach((b) => {
        const key = `${b.title || 'Break'}_${b.startTime}_${b.endTime}_${Boolean(b.isCustomized)}`;
        if (!grouped[key]) {
          grouped[key] = {
            id: b.id || `rb-${Math.random().toString(36).substr(2, 6)}`,
            salonBreakId: b.salonBreakId || null,
            title: b.title || 'Break',
            startTime: b.startTime,
            endTime: b.endTime,
            isCustomized: Boolean(b.isCustomized),
            days: [],
            breakIds: {},
          };
        }
        if (!grouped[key].days.includes(b.day)) {
          grouped[key].days.push(b.day);
        }
        if (b.id) {
          grouped[key].breakIds[b.day] = b.id;
        }
      });
      detectedRoutineBreaks = Object.values(grouped);
    } else {
      detectedRoutineBreaks = [];
    }

    // Detect inheritable master salon facility breaks for this specialist
    const inheritableSalonBreaks = [];
    const salonRoutines = Array.isArray(this.salonRoutineBreaks) ? this.salonRoutineBreaks : [];

    salonRoutines.forEach((mb) => {
      const mbSalonBreakId = mb.salonBreakId || (mb.breakIds && Object.values(mb.breakIds)[0]) || null;
      const existingRoutine = detectedRoutineBreaks.find(
        (r) => (mbSalonBreakId && r.salonBreakId === mbSalonBreakId) ||
          (r.title === mb.title && r.startTime === mb.startTime && r.endTime === mb.endTime && !r.isCustomized)
      );

      const missingDays = existingRoutine
        ? (mb.days || []).filter((d) => !existingRoutine.days.includes(d))
        : [...(mb.days || [])];

      if (missingDays.length === 0) return; // Already fully inherited across all master days

      const mbIdSet = new Set(Object.values(mb.breakIds || {}));
      const conflicts = allBreaksFound.filter(
        (b) => missingDays.includes(b.day) &&
          b.startTime < mb.endTime &&
          b.endTime > mb.startTime &&
          !mbIdSet.has(b.salonBreakId)
      );

      const hasConflict = conflicts.length > 0;
      const conflictReason = hasConflict
        ? `Overlaps on ${[...new Set(conflicts.map((c) => c.day.slice(0, 3)))].join(', ')} with "${conflicts[0].title || 'Break'}" (${conflicts[0].startTime}–${conflicts[0].endTime})`
        : null;

      inheritableSalonBreaks.push({
        salonBreakId: mbSalonBreakId,
        title: mb.title,
        startTime: mb.startTime,
        endTime: mb.endTime,
        days: missingDays,
        isAlreadyInherited: Boolean(existingRoutine),
        conflictReason,
        conflictingBreakIds: conflicts.map((c) => c.id).filter(Boolean),
      });
    });

    const currentTab = this.currentStaffHoursState?.activeSubTab || 'shifts';

    this.currentStaffHoursState = {
      staffId: st.id,
      staffName: st.name,
      followsSalon: st.followsSalonSchedule === true,
      activeSubTab: currentTab,
      masterShift: {
        startTime: detectedMasterStart,
        endTime: detectedMasterEnd,
      },
      routineBreaks: detectedRoutineBreaks,
      inheritableSalonBreaks,
      days: daysObj,
    };

    // Ensure breaks are mapped to active working days
    this.syncRoutineBreaksToDays();

    const masterStart = this.currentStaffHoursState.masterShift.startTime;
    const masterEnd = this.currentStaffHoursState.masterShift.endTime;
    const activeWorkingDaysCount = daysArr.filter((d) => this.currentStaffHoursState.days[d]?.isWorking).length;

    return `
      <div class="stylist-routine-card">
        <!-- Top Navigation: [ Segmented Tabs ] -->
        <div class="stylist-schedule-top-row">
          <div class="stylist-schedule-segmented-tabs" id="stylist-schedule-tabs">
            <button type="button" class="schedule-tab-btn ${currentTab === 'shifts' ? 'active' : ''}" data-tab="shifts" id="tab-btn-shifts">
              <span>⏰ Shift Hours</span>
            </button>
            <button type="button" class="schedule-tab-btn ${currentTab === 'breaks' ? 'active' : ''}" data-tab="breaks" id="tab-btn-breaks">
              <span>☕ Daily Breaks</span>
              <span class="breaks-count-chip" id="schedule-tab-breaks-count">${this.currentStaffHoursState.routineBreaks.length}</span>
            </button>
          </div>
        </div>

        <!-- TAB 1: SHIFT HOURS VIEW -->
        <div id="tab-content-shifts" style="display: ${currentTab === 'shifts' ? 'block' : 'none'};">
          <div style="display: flex; flex-direction: column; gap: 10px;">
            <!-- Bulk Shift Setter Card (Realtime Auto-apply, No Manual Button Needed) -->
            <div class="stylist-bulk-setter-card" id="stylist-bulk-setter-container">
              <div class="bulk-setter-row">
                <div class="bulk-setter-info">
                  <span class="bulk-setter-title">
                    ${Icons.zap ? Icons.zap({ size: 13, color: '#fbbf24' }) : '⚡'}
                    <span>All-Day Default Shift</span>
                  </span>
                  <span class="bulk-setter-sub">Changes auto-apply live · Store hours: ${formatTime12h(salonMinStart)} – ${formatTime12h(salonMaxEnd)}</span>
                </div>
                <div class="bulk-time-inputs">
                  <div class="bulk-time-group">
                    <span class="bulk-time-label">Shift Start</span>
                    <div class="bulk-time-inp-wrap">
                      <input type="time" class="form-control bulk-time-inp" id="master-bulk-start" value="${masterStart}" min="${salonMinStart}" max="${salonMaxEnd}" />
                      <span class="bulk-time-preview" id="master-bulk-start-preview">${formatTime12h(masterStart)}</span>
                    </div>
                  </div>
                  <span class="bulk-time-sep">to</span>
                  <div class="bulk-time-group">
                    <span class="bulk-time-label">Shift End</span>
                    <div class="bulk-time-inp-wrap">
                      <input type="time" class="form-control bulk-time-inp" id="master-bulk-end" value="${masterEnd}" min="${salonMinStart}" max="${salonMaxEnd}" />
                      <span class="bulk-time-preview" id="master-bulk-end-preview">${formatTime12h(masterEnd)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Individual Day Roster (Pure Shifts View) -->
            <div class="stylist-roster-card">
              <div class="stylist-roster-header">
                <div class="stylist-roster-header-left">
                  ${Icons.calendar ? Icons.calendar({ size: 14, color: '#a78bfa' }) : '📅'}
                  <span class="stylist-roster-title">Weekly Schedule</span>
                </div>
                <span class="stylist-roster-count" id="roster-active-days-count">${activeWorkingDaysCount} of 7 Active Days</span>
              </div>

              <!-- Dedicated Quick-Sync Banner Directly Above Monday -->
              <div class="roster-sync-banner" id="roster-sync-banner-row" role="button" tabindex="0">
                <div class="roster-sync-banner-left">
                  <span class="roster-sync-banner-icon">🏬</span>
                  <div class="roster-sync-banner-info">
                    <span class="roster-sync-banner-title">Sync with Salon Hours</span>
                    <span class="roster-sync-banner-sub">Store: ${formatTime12h(salonMinStart)} – ${formatTime12h(salonMaxEnd)}</span>
                  </div>
                </div>
                <button type="button" class="btn-banner-reset-sync" id="btn-open-sync-all-salon-sheet" title="Reset all days to match salon hours">
                  <span>Reset ↺</span>
                </button>
              </div>

              <div id="stylist-roster-rows-container">
                ${this.renderStaffRosterRowsHtml()}
              </div>
            </div>
          </div>
        </div>

        <!-- TAB 2: ROUTINE BREAKS VIEW -->
        <div id="tab-content-breaks" style="display: ${currentTab === 'breaks' ? 'block' : 'none'};">
          <div class="stylist-breaks-container">
            <div class="stylist-breaks-header-row">
              <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                <h4 style="font-size: 0.88rem; font-weight: 800; color: #fff; margin: 0; display: flex; align-items: center; gap: 6px; white-space: nowrap;">
                  ${Icons.coffee ? Icons.coffee({ size: 15, color: '#fbbf24' }) : '☕'}
                  <span>Routine Daily Breaks</span>
                </h4>
                <span class="breaks-count-chip" id="breaks-header-count">${this.currentStaffHoursState.routineBreaks.length}</span>
              </div>
              <button type="button" class="btn-compact-add-break" id="btn-add-routine-break">
                ${Icons.plus ? Icons.plus({ size: 13, color: '#fff' }) : '➕'}
                <span>Add Break</span>
              </button>
            </div>

            <div id="stylist-routine-breaks-list" style="display: flex; flex-direction: column; gap: 8px;">
              ${this.renderRoutineBreaksHtml()}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  autoSaveStaffSchedule(staffId, immediate = false) {
    if (!this.currentStaffHoursState || this.currentStaffHoursState.staffId !== staffId) return;

    const statusBadge = document.getElementById('stylist-schedule-autosave-status') || document.querySelector('.workspace-live-status');
    if (statusBadge) {
      statusBadge.innerHTML = `<span class="autosave-dot saving"></span><span class="autosave-text">Saving...</span>`;
    }

    if (this._autoSaveScheduleTimer) {
      clearTimeout(this._autoSaveScheduleTimer);
      this._autoSaveScheduleTimer = null;
    }

    const doSave = async () => {
      this._pendingScheduleSaveFn = null;
      try {
        this.syncRoutineBreaksToDays();

        const daysArr = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
        const hoursPayload = [];

        for (const day of daysArr) {
          const d = this.currentStaffHoursState?.days ? this.currentStaffHoursState.days[day] : null;
          const isSalonClosed = d ? Boolean(d.isSalonClosed) : false;
          const isWorking = !isSalonClosed && (d ? Boolean(d.isWorking) : false);
          const start = d?.startTime || d?.salonStart || this.salonProfile?.defaultStartTime;
          const end = d?.endTime || d?.salonEnd || this.salonProfile?.defaultEndTime;

          const breaks = (d?.breaks || [])
            .map((b) => ({
              title: (b.title || 'Break').trim(),
              startTime: b.startTime,
              endTime: b.endTime,
            }))
            .filter((b) => b.startTime && b.endTime && b.startTime < b.endTime);

          let effStart = start;
          let effEnd = end;
          breaks.forEach((b) => {
            if (!effStart || b.startTime < effStart) effStart = b.startTime;
            if (!effEnd || b.endTime > effEnd) effEnd = b.endTime;
          });

          const salonStart = d?.salonStart || this.salonProfile?.defaultStartTime;
          const salonEnd = d?.salonEnd || this.salonProfile?.defaultEndTime;
          const isIdenticalToSalon = !isSalonClosed && isWorking && effStart === salonStart && effEnd === salonEnd;
          const effectiveIsCustomized = !isIdenticalToSalon;

          if (d) {
            d.startTime = effStart;
            d.endTime = effEnd;
            d.isCustomized = effectiveIsCustomized;
          }

          if (isWorking && effStart < effEnd) {
            hoursPayload.push({
              dayOfWeek: day,
              isWorking,
              isCustomized: effectiveIsCustomized,
              startTime: effStart,
              endTime: effEnd,
              breaks,
              breakStartTime: null,
              breakEndTime: null,
              hasBreakOverride: true,
            });
          } else {
            hoursPayload.push({
              dayOfWeek: day,
              isWorking: false,
              isCustomized: effectiveIsCustomized,
              startTime: effStart,
              endTime: effEnd,
              breaks,
              breakStartTime: null,
              breakEndTime: null,
              hasBreakOverride: true,
            });
          }
        }

        const anyCustom = hoursPayload.some((h) => h.isCustomized);
        const followsSalon = !anyCustom;
        const updated = await ApiClient.updateStaffWorkingHours(staffId, hoursPayload, followsSalon);
        const st = (this.staffList || []).find((s) => s.id === staffId);
        if (st) {
          st.workingHours = (updated && Array.isArray(updated.hours)) ? updated.hours : (Array.isArray(updated) && updated.length > 0 ? updated : hoursPayload);
          st.followsSalonSchedule = followsSalon;
        }
        if (this.currentStaffHoursState && this.currentStaffHoursState.staffId === staffId) {
          this.currentStaffHoursState.followsSalon = followsSalon;
        }
        // Immediately sync in-memory calendar schedule so calendar reflects the change live
        if (this.calendarSchedule && Array.isArray(this.calendarSchedule.stylists)) {
          const calSt = this.calendarSchedule.stylists.find((s) => (s.stylistId || s.id) === staffId);
          if (calSt) {
            calSt.weeklyHours = hoursPayload.map((h) => ({
              dayOfWeek: h.dayOfWeek,
              isWorking: Boolean(h.isWorking),
              startTime: h.isWorking ? h.startTime : null,
              endTime: h.isWorking ? h.endTime : null,
            }));
            calSt.followsSalonSchedule = followsSalon;
          }
        }
        if (statusBadge) {
          statusBadge.innerHTML = `<span class="autosave-dot"></span><span class="autosave-text">✓ Auto-saved</span>`;
        }
        if (updated?.affectedBookingsCount > 0) {
          this.showToast?.(updated.message || `${updated.affectedBookingsCount} booking(s) automatically sent reschedule request via WhatsApp.`, 'info');
        }
        ApiClient.getSalonWorkingHours(true).then((freshWh) => {
          if (Array.isArray(freshWh) && freshWh.length > 0) {
            this.salonWorkingHours = freshWh;
            const subEl = document.querySelector('.bulk-setter-sub');
            if (subEl) {
              const activeDays = freshWh.filter((h) => !h.isClosed);
              if (activeDays.length > 0) {
                const minS = activeDays.reduce((min, h) => (h.startTime && h.startTime < min ? h.startTime : min), activeDays[0].startTime);
                const maxE = activeDays.reduce((max, h) => (h.endTime && h.endTime > max ? h.endTime : max), activeDays[0].endTime);
                subEl.textContent = `Changes auto-apply live · Store hours: ${formatTime12h(minS)} – ${formatTime12h(maxE)}`;
              }
            }
          }
        }).catch(() => { });
        ApiClient.getSalonProfile(true).then((prof) => {
          if (prof) this.salonProfile = prof;
        }).catch(() => { });
      } catch (err) {
        console.error('Failed to auto-save schedule:', err);
        if (statusBadge) {
          statusBadge.innerHTML = `<span class="autosave-dot error"></span><span class="autosave-text" title="${err.message || 'Error'}">⚠️ Save error</span>`;
        }
        this.showToast?.(`Schedule save warning: ${err.message || 'Validation error'}`, 'warning');
      }
    };

    this._pendingScheduleSaveFn = doSave;

    if (immediate) {
      return doSave();
    } else {
      this._autoSaveScheduleTimer = setTimeout(doSave, 350);
    }
  }

  syncRoutineBreaksToDays() {
    if (!this.currentStaffHoursState?.days) return;
    const daysArr = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
    const routineBreaks = this.currentStaffHoursState.routineBreaks || [];

    daysArr.forEach((dayKey) => {
      const d = this.currentStaffHoursState.days[dayKey];
      if (d) {
        const matchingBreaks = routineBreaks
          .filter((rb) => Array.isArray(rb.days) && rb.days.includes(dayKey))
          .map((rb) => ({
            title: (rb.title || 'Break').trim(),
            startTime: rb.startTime,
            endTime: rb.endTime,
          }));
        d.breaks = matchingBreaks;

        // Auto-harmonize day's shift with breaks
        matchingBreaks.forEach((b) => {
          if (b.startTime && b.endTime) {
            if (!d.startTime || b.startTime < d.startTime) {
              d.startTime = b.startTime;
            }
            if (!d.endTime || b.endTime > d.endTime) {
              d.endTime = b.endTime;
            }
          }
        });
      }
    });
  }

  renderStaffRosterRowsHtml() {
    if (!this.currentStaffHoursState?.days) return '';
    const daysArr = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

    return daysArr.map((day) => {
      const d = this.currentStaffHoursState.days[day];
      if (!d) return '';
      const isSalonClosed = Boolean(d.isSalonClosed);
      const isCustomized = Boolean(d.isCustomized);
      const isWorking = !isSalonClosed && Boolean(d.isWorking);

      let statusText = 'Weekly Off';
      let statusStyle = '';
      let statusIcon = Icons.clock ? Icons.clock({ size: 12, color: '#64748b' }) : '';
      let chipHtml = '';

      if (isSalonClosed) {
        statusText = 'Salon Closed';
        statusStyle = 'color: #f87171; font-weight: 600; font-style: normal;';
        statusIcon = Icons.lock ? Icons.lock({ size: 12, color: '#f87171' }) : '🔒';
      } else if (isWorking) {
        statusText = `${formatTime12h(d.startTime)} – ${formatTime12h(d.endTime)}`;
        statusIcon = Icons.clock ? Icons.clock({ size: 12, color: '#a78bfa' }) : '';
        if (isCustomized) {
          chipHtml = `<span class="stylist-custom-chip btn-revert-custom-sheet" data-day="${day}" title="Customized shift · Click to revert to salon hours">Custom ↺</span>`;
        }
      } else if (isCustomized) {
        chipHtml = `<span class="stylist-custom-chip personal-off btn-revert-custom-sheet" data-day="${day}" title="Personal weekly off · Click to revert to salon hours">Personal Off ↺</span>`;
      }

      const badgeStyle = isSalonClosed
        ? 'background: rgba(239, 68, 68, 0.16); border-color: rgba(239, 68, 68, 0.35); color: #f87171;'
        : '';

      const switchWrapStyle = isSalonClosed
        ? 'opacity: 0.35; cursor: not-allowed; pointer-events: none;'
        : '';

      return `
        <div class="stylist-roster-row ${!isWorking ? 'is-off' : ''} ${isSalonClosed ? 'salon-closed' : ''}" data-day="${day}" title="${isSalonClosed ? `Salon is closed on ${d.friendlyDay}` : `Tap to customize ${d.friendlyDay} hours`}">
          <div class="stylist-roster-left">
            <span class="stylist-day-badge ${isWorking ? 'working' : 'off'}" style="${badgeStyle}">${d.dayShort}</span>
            <div class="stylist-roster-timing-wrap">
              <span class="stylist-roster-time ${!isWorking ? 'is-off' : ''}" style="${statusStyle}">
                ${statusText}
              </span>
            </div>
          </div>
          <div class="stylist-roster-right">
            ${chipHtml}
            <label class="roster-day-switch" style="${switchWrapStyle}" title="${isSalonClosed ? `Cannot enable: Salon is closed on ${d.friendlyDay}` : `Turn ${d.friendlyDay} ${isWorking ? 'Off' : 'On'}`}">
              <input type="checkbox" class="roster-switch-input" data-day="${day}" ${isWorking && !isSalonClosed ? 'checked' : ''} ${isSalonClosed ? 'disabled' : ''} />
              <span class="roster-switch-slider"></span>
            </label>
            <button type="button" class="stylist-roster-action-btn btn-open-roster-modal" data-day="${day}" title="${isSalonClosed ? `Salon is closed on ${d.friendlyDay} (Facility Off)` : `Customize ${d.friendlyDay} Hours`}">
              ${isSalonClosed ? (Icons.lock ? Icons.lock({ size: 12, color: '#f87171' }) : '🔒') : (Icons.edit ? Icons.edit({ size: 12, color: '#cbd5e1' }) : '✏️')}
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  formatRoutineDaysSummary(days = []) {
    if (!Array.isArray(days) || days.length === 0) return 'No days';
    if (days.length === 7) return 'Everyday (Mon–Sun)';
    const weekdays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
    const weekMonSat = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    if (days.length === 5 && weekdays.every((d) => days.includes(d))) return 'Mon–Fri';
    if (days.length === 6 && weekMonSat.every((d) => days.includes(d))) return 'Mon–Sat';
    if (days.length === 2 && days.includes('SATURDAY') && days.includes('SUNDAY')) return 'Weekends';
    return days.map((d) => d.slice(0, 3)).join(', ');
  }

  renderRoutineBreaksHtml() {
    const routineBreaks = this.currentStaffHoursState?.routineBreaks || [];
    const inheritableCount = (this.currentStaffHoursState?.inheritableSalonBreaks || []).length;

    if (routineBreaks.length === 0) {
      return `
        <div class="empty-routine-breaks">
          <div class="empty-breaks-icon">
            ${Icons.coffee ? Icons.coffee({ size: 24, color: '#fbbf24' }) : '☕'}
          </div>
          <div class="empty-breaks-text">
            <strong style="color: #fff; font-size: 0.95rem;">No Routine Breaks Configured</strong>
            <span style="color: #94a3b8; font-size: 0.78rem;">Stylist is available continuously throughout working shifts</span>
          </div>

          ${inheritableCount > 0 ? `
            <div class="salon-standard-quick-card" id="btn-show-inheritable-breaks" role="button" tabindex="0">
              <div class="quick-card-header">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="font-size: 1.15rem;">🏢</span>
                  <div>
                    <div style="font-size: 0.85rem; font-weight: 700; color: #fff;">Apply Salon Standard Breaks (${inheritableCount})</div>
                    <div style="font-size: 0.72rem; color: #93c5fd;">Official breaks configured for the salon</div>
                  </div>
                </div>
                <span class="badge-quick-apply">Quick Apply</span>
              </div>
              <p style="margin: 6px 0 10px 0; font-size: 0.73rem; color: #cbd5e1; line-height: 1.4;">
                Instantly apply your salon's standard break routine (e.g. Lunch 1:00–2:00 PM) to this specialist.
              </p>
              <button type="button" class="btn-apply-standard-pill">
                <span>⚡ View & Apply Standard Breaks</span>
              </button>
            </div>

            <div class="empty-breaks-divider">
              <span>or</span>
            </div>
          ` : ''}

          <button type="button" class="btn btn-sm btn-primary btn-trigger-add-break" style="font-size: 0.74rem; padding: 6px 18px; font-weight: 700;">
            + Add First Break
          </button>
        </div>
      `;
    }

    const daysKeys = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
    const daysLetters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

    const bannerHtml = inheritableCount > 0 ? `
      <div class="salon-breaks-available-banner" id="btn-show-inheritable-breaks" role="button" tabindex="0">
        <div class="available-banner-left">
          <div class="available-banner-icon-wrap">🏢</div>
          <div class="available-banner-info">
            <div class="available-banner-title">${inheritableCount} Salon Standard ${inheritableCount === 1 ? 'Break' : 'Breaks'} Available</div>
            <div class="available-banner-sub">Tap to apply salon standard timing to this specialist</div>
          </div>
        </div>
        <button type="button" class="btn-available-banner-cta">View & Apply →</button>
      </div>
    ` : '';

    const cardsHtml = routineBreaks.map((b, idx) => {
      const activeDays = Array.isArray(b.days) ? b.days : [];
      const isCustomized = Boolean(b.isCustomized);
      const canReset = isCustomized && Boolean(b.salonBreakId);

      return `
        <div class="routine-break-row-card" data-idx="${idx}" title="Tap to edit ${b.title || 'Break'}">
          <div class="routine-break-card-top">
            <div class="routine-break-title-wrap">
              <div class="routine-break-icon-wrap">
                ${Icons.coffee ? Icons.coffee({ size: 13, color: '#fbbf24' }) : '☕'}
              </div>
              <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <span class="routine-break-row-title">${b.title || 'Routine Break'}</span>
                ${isCustomized
          ? `<span class="break-badge-custom" style="font-size: 0.65rem; padding: 2px 7px; border-radius: 999px; background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); font-weight: 600;">Customized</span>`
          : `<span class="break-badge-salon" style="font-size: 0.65rem; padding: 2px 7px; border-radius: 999px; background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); font-weight: 600;">Given by Salon</span>`
        }
              </div>
            </div>
            <div class="routine-break-row-actions">
              ${canReset ? `
                <button type="button" class="btn-reset-routine-break" data-idx="${idx}" title="Reset to Salon Timing" style="background: rgba(148, 163, 184, 0.12); border: 1px solid rgba(148, 163, 184, 0.25); color: #cbd5e1; border-radius: 6px; padding: 3px 8px; font-size: 0.68rem; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                  ↺ Reset
                </button>
              ` : ''}
              <button type="button" class="btn-edit-routine-break" data-idx="${idx}" title="Edit Break">
                ${Icons.edit ? Icons.edit({ size: 12, color: '#cbd5e1' }) : '✏️'}
              </button>
              <button type="button" class="btn-del-routine-break-direct" data-idx="${idx}" title="Delete Break">
                ${Icons.trash ? Icons.trash({ size: 12, color: '#f87171' }) : '✕'}
              </button>
            </div>
          </div>
          <div class="routine-break-card-bottom">
            <div class="routine-break-time-badge">
              ${Icons.clock ? Icons.clock({ size: 10, color: '#a78bfa' }) : ''}
              <span class="break-time-text">${formatTime12h(b.startTime)}&nbsp;–&nbsp;${formatTime12h(b.endTime)}</span>
            </div>
            <div class="routine-break-days-matrix" title="Active on: ${activeDays.map((d) => d.slice(0, 3)).join(', ')}">
              ${daysLetters.map((letter, dayIdx) => {
          const dayKey = daysKeys[dayIdx];
          const isActive = activeDays.includes(dayKey);
          return `<span class="break-matrix-day ${isActive ? 'active' : ''}">${letter}</span>`;
        }).join('')}
            </div>
          </div>
        </div>
      `;
    }).join('');

    return bannerHtml + cardsHtml;
  }

  updateStaffHoursTableUI() {
    const rowsContainer = document.getElementById('stylist-roster-rows-container');
    if (rowsContainer) {
      rowsContainer.innerHTML = this.renderStaffRosterRowsHtml();
    }
    const countBadge = document.getElementById('roster-active-days-count');
    if (countBadge) {
      const daysArr = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
      const activeCount = daysArr.filter((d) => this.currentStaffHoursState?.days[d]?.isWorking).length;
      countBadge.textContent = `${activeCount} of 7 Active Days`;
    }
    const breaksList = document.getElementById('stylist-routine-breaks-list');
    if (breaksList) {
      breaksList.innerHTML = this.renderRoutineBreaksHtml();
    }
    const breaksTabCount = document.getElementById('schedule-tab-breaks-count');
    if (breaksTabCount) {
      breaksTabCount.textContent = (this.currentStaffHoursState?.routineBreaks || []).length;
    }
    const breaksHeaderCount = document.getElementById('breaks-header-count');
    if (breaksHeaderCount) {
      breaksHeaderCount.textContent = (this.currentStaffHoursState?.routineBreaks || []).length;
    }
    this.attachStaffRosterListeners();
    this.attachRoutineBreaksListeners();
  }

  attachStaffRosterListeners() {
    const rowsContainer = document.getElementById('stylist-roster-rows-container');
    if (!rowsContainer) return;

    // Attach Quick-Sync Banner and Reset Button
    const bannerSync = document.getElementById('roster-sync-banner-row');
    const btnSyncAll = document.getElementById('btn-open-sync-all-salon-sheet');
    [bannerSync, btnSyncAll].forEach((el) => {
      if (el) {
        el.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.openResetAllToSalonHoursBottomSheet();
        };
      }
    });

    // 1. Instant Working/Off Toggle Switch (1-click, auto-saves)
    rowsContainer.querySelectorAll('.roster-switch-input').forEach((toggle) => {
      toggle.onclick = (e) => {
        e.stopPropagation();
      };
      toggle.onchange = (e) => {
        e.stopPropagation();
        const day = toggle.getAttribute('data-day');
        const dayData = this.currentStaffHoursState?.days?.[day];
        if (!dayData) return;

        if (dayData.isSalonClosed) {
          e.preventDefault();
          toggle.checked = false;
          dayData.isWorking = false;
          this.showToast?.(`Cannot enable ${dayData.friendlyDay}: Salon is closed on this day.`, 'warning');
          this.updateStaffHoursTableUI();
          return;
        }

        const isWorking = toggle.checked;
        dayData.isWorking = isWorking;

        if (isWorking && (!this.currentStaffHoursState.days[day].startTime || !this.currentStaffHoursState.days[day].endTime)) {
          this.currentStaffHoursState.days[day].startTime = dayData.salonStart || this.currentStaffHoursState.masterShift?.startTime || '09:00';
          this.currentStaffHoursState.days[day].endTime = dayData.salonEnd || this.currentStaffHoursState.masterShift?.endTime || '19:00';
        }

        const swhStart = dayData.salonStart || this.salonProfile?.defaultStartTime || '09:00';
        const swhEnd = dayData.salonEnd || this.salonProfile?.defaultEndTime || '19:00';
        const isSalonClosed = Boolean(dayData.isSalonClosed);
        const curStart = this.currentStaffHoursState.days[day].startTime;
        const curEnd = this.currentStaffHoursState.days[day].endTime;

        const isIdenticalToSalon = !isSalonClosed && isWorking && curStart === swhStart && curEnd === swhEnd;
        dayData.isCustomized = !isIdenticalToSalon;

        this.syncRoutineBreaksToDays();
        this.updateStaffHoursTableUI();
        this.autoSaveStaffSchedule(this.currentStaffHoursState.staffId, true);
      };
    });

    // 1.5 Click Custom Chip to open Revert Bottom Sheet
    rowsContainer.querySelectorAll('.btn-revert-custom-sheet').forEach((chip) => {
      chip.onclick = (e) => {
        e.stopPropagation();
        const day = chip.getAttribute('data-day');
        this.openRevertCustomShiftBottomSheet(day);
      };
    });

    // 2. Click row to open customize modal (ignores clicks on the switch toggle or revert chip)
    rowsContainer.querySelectorAll('.stylist-roster-row').forEach((row) => {
      row.onclick = (e) => {
        if (e.target.closest('.roster-day-switch') || e.target.closest('.btn-revert-custom-sheet')) return;
        const day = row.getAttribute('data-day');
        this.openStaffDayRosterModal(day);
      };
    });

    // 3. Edit button opens customize modal
    rowsContainer.querySelectorAll('.btn-open-roster-modal').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const day = btn.getAttribute('data-day');
        this.openStaffDayRosterModal(day);
      };
    });
  }

  attachRoutineBreaksListeners() {
    const container = document.getElementById('tab-content-breaks');
    if (!container) return;

    // 0. Reset to Salon Timing Trigger
    container.querySelectorAll('.btn-reset-routine-break').forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        e.preventDefault();
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        const b = this.currentStaffHoursState?.routineBreaks?.[idx];
        const staffId = this.currentStaffHoursState?.staffId;
        if (!b || !staffId) return;

        try {
          btn.disabled = true;
          btn.textContent = 'Resetting...';
          const breakIds = Object.values(b.breakIds || {}).filter(Boolean);
          if (breakIds.length > 0) {
            for (const bId of breakIds) {
              await ApiClient.resetStaffBreak(staffId, bId);
            }
          }
          this.showToast(`Reset "${b.title || 'Break'}" to salon timing!`, 'success');
          const freshStaff = await ApiClient.getStaff(true);
          this.staffList = freshStaff;
          this.staffManager.navigateTo('schedule');
        } catch (err) {
          console.error('Failed to reset break:', err);
          this.showToast(err.message || 'Failed to reset break', 'warning');
          btn.disabled = false;
          btn.textContent = '↺ Reset';
        }
      };
    });

    // 0. Salon Standard Breaks trigger (banner or quick-apply card)
    container.querySelectorAll('#btn-show-inheritable-breaks, .salon-breaks-available-banner, .salon-standard-quick-card').forEach((el) => {
      el.onclick = (e) => {
        e.preventDefault();
        const staffId = this.currentStaffHoursState?.staffId;
        if (staffId) {
          this.openInheritSalonBreaksBottomSheet(staffId);
        }
      };
    });

    // 1. Add break header trigger
    const addBtn = container.querySelector('#btn-add-routine-break');
    if (addBtn) {
      addBtn.onclick = (e) => {
        e.preventDefault();
        this.openRoutineBreakBottomSheet(-1);
      };
    }

    // 2. Empty state trigger
    const emptyAddBtn = container.querySelector('.btn-trigger-add-break');
    if (emptyAddBtn) {
      emptyAddBtn.onclick = (e) => {
        e.preventDefault();
        this.openRoutineBreakBottomSheet(-1);
      };
    }

    // 3. Click break row or Edit button to open Bottom Sheet
    container.querySelectorAll('.routine-break-row-card').forEach((card) => {
      card.onclick = (e) => {
        if (e.target.closest('.btn-del-routine-break-direct')) return;
        const idx = parseInt(card.getAttribute('data-idx'), 10);
        this.openRoutineBreakBottomSheet(idx);
      };
    });

    container.querySelectorAll('.btn-edit-routine-break').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        this.openRoutineBreakBottomSheet(idx);
      };
    });

    // 4. Quick Delete Button
    container.querySelectorAll('.btn-del-routine-break-direct').forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        e.preventDefault();
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        if (this.currentStaffHoursState?.routineBreaks && this.currentStaffHoursState.routineBreaks[idx]) {
          const targetBreak = this.currentStaffHoursState.routineBreaks[idx];
          const staffId = this.currentStaffHoursState.staffId;
          if (!confirm(`Delete routine break "${targetBreak.title}" for this stylist?`)) return;

          try {
            await ApiClient.deleteStaffRoutineBreak(staffId, {
              title: targetBreak.title,
              startTime: targetBreak.startTime,
              endTime: targetBreak.endTime,
              days: targetBreak.days,
            });

            this.currentStaffHoursState.routineBreaks.splice(idx, 1);
            this.syncRoutineBreaksToDays();
            this.updateStaffHoursTableUI();
            this.showToast(`Removed routine break "${targetBreak.title || 'Break'}".`, 'info');
          } catch (err) {
            console.error('Failed to delete staff routine break:', err);
            this.showToast(err.message || 'Failed to delete break', 'error');
          }
        }
      };
    });
  }

  openRoutineBreakBottomSheet(editIndex = -1) {
    if (!this.currentStaffHoursState) return;
    const isEditing = editIndex >= 0 && Array.isArray(this.currentStaffHoursState.routineBreaks) && Boolean(this.currentStaffHoursState.routineBreaks[editIndex]);
    const breakData = isEditing ? this.currentStaffHoursState.routineBreaks[editIndex] : null;

    const daysArr = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

    let currentTitle = breakData ? (breakData.title || 'Lunch Break') : (this.currentStaffHoursState.routineBreaks?.length === 0 ? 'Lunch Break' : 'Evening Tea Break');
    let currentStart = breakData ? (breakData.startTime || '13:00') : (this.currentStaffHoursState.routineBreaks?.length === 0 ? '13:00' : '16:30');
    let currentEnd = breakData ? (breakData.endTime || '14:00') : (this.currentStaffHoursState.routineBreaks?.length === 0 ? '14:00' : '17:00');
    let selectedDays = breakData && Array.isArray(breakData.days) ? [...breakData.days] : ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];

    let sheetContainer = document.getElementById('routine-break-sheet-modal');
    if (!sheetContainer) {
      sheetContainer = document.createElement('div');
      sheetContainer.id = 'routine-break-sheet-modal';
      document.body.appendChild(sheetContainer);
    }

    sheetContainer.innerHTML = `
      <div class="routine-break-sheet-backdrop" id="routine-break-sheet-backdrop">
        <div class="routine-break-sheet-container" id="routine-break-sheet-container">
          <div class="sheet-drag-handle"></div>

          <div class="sheet-header">
            <div class="sheet-title-group">
              <div class="sheet-icon-badge">
                ${Icons.coffee ? Icons.coffee({ size: 16, color: '#fbbf24' }) : '☕'}
              </div>
              <div>
                <h3 class="sheet-title">${isEditing ? 'Edit Routine Break' : 'Add Routine Break'}</h3>
                <p class="sheet-subtitle">Repeats automatically across working shifts</p>
              </div>
            </div>
            <button type="button" class="sheet-close-btn" id="btn-close-break-sheet">&times;</button>
          </div>

          <div class="sheet-body">
            <!-- 1. Break Name & Quick Presets -->
            <div class="sheet-form-group">
              <label class="sheet-label">Break Name</label>
              <input type="text" class="form-control sheet-inp" id="sheet-break-title" value="${currentTitle}" placeholder="e.g. Lunch Break" />
              
              <div class="sheet-presets-row">
                <button type="button" class="sheet-preset-chip" data-title="Lunch Break" data-start="13:00" data-end="14:00">🍱 Lunch (1-2 PM)</button>
                <button type="button" class="sheet-preset-chip" data-title="Evening Tea Break" data-start="16:30" data-end="17:00">☕ Tea (4:30-5 PM)</button>
                <button type="button" class="sheet-preset-chip" data-title="Prayer & Rest" data-start="14:00" data-end="14:30">🧘 Prayer (2-2:30 PM)</button>
                <button type="button" class="sheet-preset-chip" data-title="Snack Break" data-start="11:30" data-end="12:00">🥪 Snack</button>
              </div>
            </div>

            <!-- 2. Time Window -->
            <div class="sheet-form-group">
              <label class="sheet-label">Break Time Window</label>
              <div class="sheet-time-grid">
                <div class="sheet-time-box">
                  <span class="sheet-time-box-label">Starts At</span>
                  <input type="time" class="form-control bulk-time-inp sheet-time-inp" id="sheet-break-start" value="${currentStart}" />
                  <span class="sheet-time-preview" id="sheet-break-start-preview">${formatTime12h(currentStart)}</span>
                </div>
                <span class="sheet-time-arrow">→</span>
                <div class="sheet-time-box">
                  <span class="sheet-time-box-label">Ends At</span>
                  <input type="time" class="form-control bulk-time-inp sheet-time-inp" id="sheet-break-end" value="${currentEnd}" />
                  <span class="sheet-time-preview" id="sheet-break-end-preview">${formatTime12h(currentEnd)}</span>
                </div>
              </div>
            </div>

            <!-- 3. Active Days Selector -->
            <div class="sheet-form-group">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <label class="sheet-label" style="margin: 0;">Repeat On Days</label>
                <div class="sheet-quick-days">
                  <button type="button" class="sheet-quick-day-btn" id="btn-days-all">All Days</button>
                  <button type="button" class="sheet-quick-day-btn" id="btn-days-weekdays">Mon–Fri</button>
                  <button type="button" class="sheet-quick-day-btn" id="btn-days-sat">Mon–Sat</button>
                </div>
              </div>
              <div class="sheet-days-chips-grid">
                ${daysArr.map((dKey) => {
      const dShort = dKey.slice(0, 3);
      const isSelected = selectedDays.includes(dKey);
      return `
                    <button type="button" class="sheet-day-pill ${isSelected ? 'active' : ''}" data-day="${dKey}">
                      ${dShort}
                    </button>
                  `;
    }).join('')}
              </div>
            </div>
          </div>

          <div class="sheet-footer">
            ${isEditing ? `
              <button type="button" class="btn btn-outline-danger sheet-btn-delete" id="btn-sheet-delete-break">
                ${Icons.trash ? Icons.trash({ size: 13, color: '#f87171' }) : '🗑️'}
                <span>Delete</span>
              </button>
            ` : `
              <button type="button" class="btn btn-secondary sheet-btn-cancel" id="btn-sheet-cancel">Cancel</button>
            `}
            <div style="display: flex; gap: 8px; margin-left: auto;">
              ${isEditing ? `<button type="button" class="btn btn-secondary sheet-btn-cancel" id="btn-sheet-cancel-edit">Cancel</button>` : ''}
              <button type="button" class="btn btn-primary sheet-btn-save" id="btn-sheet-save-break">
                ${isEditing ? '✓ Save Changes' : '+ Add Break'}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    const closeSheet = () => {
      const backdrop = sheetContainer.querySelector('#routine-break-sheet-backdrop');
      const container = sheetContainer.querySelector('#routine-break-sheet-container');
      if (backdrop && container) {
        backdrop.classList.add('closing');
        container.classList.add('closing');
        setTimeout(() => {
          sheetContainer.innerHTML = '';
        }, 200);
      } else {
        sheetContainer.innerHTML = '';
      }
    };

    // Close buttons & backdrop click
    sheetContainer.querySelector('#btn-close-break-sheet')?.addEventListener('click', closeSheet);
    sheetContainer.querySelector('#btn-sheet-cancel')?.addEventListener('click', closeSheet);
    sheetContainer.querySelector('#btn-sheet-cancel-edit')?.addEventListener('click', closeSheet);
    sheetContainer.querySelector('#routine-break-sheet-backdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'routine-break-sheet-backdrop') closeSheet();
    });

    // Time input live previews
    const startInp = sheetContainer.querySelector('#sheet-break-start');
    const endInp = sheetContainer.querySelector('#sheet-break-end');
    const startPrev = sheetContainer.querySelector('#sheet-break-start-preview');
    const endPrev = sheetContainer.querySelector('#sheet-break-end-preview');
    const titleInp = sheetContainer.querySelector('#sheet-break-title');

    startInp?.addEventListener('input', () => {
      if (startPrev) startPrev.textContent = formatTime12h(startInp.value);
    });
    endInp?.addEventListener('input', () => {
      if (endPrev) endPrev.textContent = formatTime12h(endInp.value);
    });

    // Preset chips
    sheetContainer.querySelectorAll('.sheet-preset-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const pTitle = chip.getAttribute('data-title');
        const pStart = chip.getAttribute('data-start');
        const pEnd = chip.getAttribute('data-end');
        if (pTitle && titleInp) titleInp.value = pTitle;
        if (pStart && startInp) {
          startInp.value = pStart;
          if (startPrev) startPrev.textContent = formatTime12h(pStart);
        }
        if (pEnd && endInp) {
          endInp.value = pEnd;
          if (endPrev) endPrev.textContent = formatTime12h(pEnd);
        }
      });
    });

    // Quick days selectors
    const dayPills = sheetContainer.querySelectorAll('.sheet-day-pill');
    const syncDayPillsUI = () => {
      dayPills.forEach((p) => {
        const dKey = p.getAttribute('data-day');
        if (selectedDays.includes(dKey)) {
          p.classList.add('active');
        } else {
          p.classList.remove('active');
        }
      });
    };

    sheetContainer.querySelector('#btn-days-all')?.addEventListener('click', () => {
      selectedDays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
      syncDayPillsUI();
    });
    sheetContainer.querySelector('#btn-days-weekdays')?.addEventListener('click', () => {
      selectedDays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
      syncDayPillsUI();
    });
    sheetContainer.querySelector('#btn-days-sat')?.addEventListener('click', () => {
      selectedDays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
      syncDayPillsUI();
    });

    // Day pill toggle
    dayPills.forEach((p) => {
      p.addEventListener('click', () => {
        const dKey = p.getAttribute('data-day');
        if (selectedDays.includes(dKey)) {
          selectedDays = selectedDays.filter((d) => d !== dKey);
        } else {
          selectedDays.push(dKey);
        }
        syncDayPillsUI();
      });
    });

    // Save Break Button
    sheetContainer.querySelector('#btn-sheet-save-break')?.addEventListener('click', async () => {
      const finalTitle = titleInp ? titleInp.value.trim() || 'Break' : 'Break';
      const sVal = startInp ? startInp.value : '13:00';
      const eVal = endInp ? endInp.value : '14:00';

      if (!sVal || !eVal || sVal >= eVal) {
        alert('Break start time must be earlier than break end time.');
        return;
      }
      if (selectedDays.length === 0) {
        alert('Please select at least one day for this routine break.');
        return;
      }

      if (!Array.isArray(this.currentStaffHoursState.routineBreaks)) {
        this.currentStaffHoursState.routineBreaks = [];
      }

      // Overlap Prevention: Check for collision against other routine breaks active on any selected day
      const hasConflict = this.currentStaffHoursState.routineBreaks.some((otherB, oIdx) => {
        if (isEditing && oIdx === editIndex) return false;
        const sharesDay = (otherB.days || []).some((d) => selectedDays.includes(d));
        if (!sharesDay) return false;
        return sVal < otherB.endTime && eVal > otherB.startTime;
      });

      if (hasConflict) {
        alert('This break time overlaps with an existing routine break on one of the selected days. Please adjust your break window.');
        return;
      }

      const saveBtn = sheetContainer.querySelector('#btn-sheet-save-break');
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
      }

      const staffId = this.currentStaffHoursState.staffId;

      try {
        if (isEditing) {
          await ApiClient.updateStaffRoutineBreak(staffId, {
            title: finalTitle,
            startTime: sVal,
            endTime: eVal,
            days: selectedDays,
            autoReschedule: true,
            breakIds: breakData?.breakIds || {},
            originalStartTime: breakData?.startTime,
            originalEndTime: breakData?.endTime,
            salonBreakId: breakData?.salonBreakId || null,
          });
        } else {
          await ApiClient.createStaffBreak(staffId, {
            title: finalTitle,
            startTime: sVal,
            endTime: eVal,
            days: selectedDays,
            autoReschedule: true,
          });
        }

        // Fetch fresh break state from server to guarantee 100% sync
        try {
          const freshData = await ApiClient.getStaffBreaks(staffId, true);
          const freshRoutines = freshData?.data?.routineBreaks || freshData?.routineBreaks;
          if (Array.isArray(freshRoutines)) {
            this.currentStaffHoursState.routineBreaks = freshRoutines;
          } else if (isEditing) {
            this.currentStaffHoursState.routineBreaks[editIndex] = {
              ...breakData,
              title: finalTitle,
              startTime: sVal,
              endTime: eVal,
              days: selectedDays,
              isCustomized: true,
              salonBreakId: breakData?.salonBreakId || null,
            };
          } else {
            this.currentStaffHoursState.routineBreaks.push({
              id: `rb-${Date.now()}`,
              salonBreakId: null,
              title: finalTitle,
              startTime: sVal,
              endTime: eVal,
              days: selectedDays,
              isCustomized: true,
              breakIds: {},
            });
          }
        } catch (_fetchErr) {
          if (isEditing) {
            this.currentStaffHoursState.routineBreaks[editIndex] = {
              ...breakData,
              title: finalTitle,
              startTime: sVal,
              endTime: eVal,
              days: selectedDays,
              isCustomized: true,
              salonBreakId: breakData?.salonBreakId || null,
            };
          } else {
            this.currentStaffHoursState.routineBreaks.push({
              id: `rb-${Date.now()}`,
              salonBreakId: null,
              title: finalTitle,
              startTime: sVal,
              endTime: eVal,
              days: selectedDays,
              isCustomized: true,
              breakIds: {},
            });
          }
        }

        this.syncRoutineBreaksToDays();
        this.updateStaffHoursTableUI();
        closeSheet();
        this.showToast(`Routine break "${finalTitle}" saved!`, 'success');
      } catch (err) {
        console.error('Failed to save staff routine break:', err);
        alert(err.message || 'Failed to save break');
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = isEditing ? '✓ Save Changes' : '+ Add Break';
        }
      }
    });

    // Delete Break Button (in edit mode)
    sheetContainer.querySelector('#btn-sheet-delete-break')?.addEventListener('click', async () => {
      if (isEditing) {
        const deletedTitle = breakData.title || 'Break';
        const staffId = this.currentStaffHoursState.staffId;
        try {
          await ApiClient.deleteStaffRoutineBreak(staffId, {
            title: breakData.title,
            startTime: breakData.startTime,
            endTime: breakData.endTime,
            days: breakData.days,
          });

          this.currentStaffHoursState.routineBreaks.splice(editIndex, 1);
          this.syncRoutineBreaksToDays();
          this.updateStaffHoursTableUI();
          closeSheet();
          this.showToast(`Removed routine break "${deletedTitle}".`, 'info');
        } catch (err) {
          console.error('Failed to delete staff routine break:', err);
          alert(err.message || 'Failed to delete break');
        }
      }
    });
  }

  async openInheritSalonBreaksBottomSheet(staffId) {
    if (!staffId && this.currentStaffHoursState) {
      staffId = this.currentStaffHoursState.staffId;
    }
    if (!staffId) return;

    let sheetContainer = document.getElementById('inherit-salon-break-modal');
    if (!sheetContainer) {
      sheetContainer = document.createElement('div');
      sheetContainer.id = 'inherit-salon-break-modal';
      document.body.appendChild(sheetContainer);
    }

    const closeSheet = () => {
      const backdrop = sheetContainer.querySelector('#inherit-break-backdrop');
      const container = sheetContainer.querySelector('#inherit-break-container');
      if (backdrop && container) {
        backdrop.classList.add('closing');
        container.classList.add('closing');
        setTimeout(() => {
          sheetContainer.innerHTML = '';
        }, 200);
      } else {
        sheetContainer.innerHTML = '';
      }
    };

    // Render loading frame first
    sheetContainer.innerHTML = `
      <div class="routine-break-sheet-backdrop" id="inherit-break-backdrop">
        <div class="routine-break-sheet-container" id="inherit-break-container" style="max-width: 540px;">
          <div class="sheet-drag-handle"></div>
          <div class="sheet-header">
            <div class="sheet-title-group">
              <div class="sheet-icon-badge" style="background: rgba(56, 189, 248, 0.15); border-color: rgba(56, 189, 248, 0.3);">
                <span>🏢</span>
              </div>
              <div>
                <h3 class="sheet-title">Apply Salon Standard Breaks</h3>
                <p class="sheet-subtitle">Add official salon break timings to this specialist</p>
              </div>
            </div>
            <button type="button" class="sheet-close-btn" id="btn-close-inherit-sheet">&times;</button>
          </div>
          <div class="sheet-body" id="inherit-break-modal-body" style="padding: 16px 0; display: flex; flex-direction: column; gap: 12px;">
            <div style="text-align: center; padding: 30px 16px; color: #94a3b8; font-size: 0.85rem;">
              <span class="spinner-border spinner-border-sm" role="status" style="margin-right: 8px;"></span> Checking salon standard breaks...
            </div>
          </div>
        </div>
      </div>
    `;

    sheetContainer.querySelector('#btn-close-inherit-sheet')?.addEventListener('click', closeSheet);
    sheetContainer.querySelector('#inherit-break-backdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'inherit-break-backdrop') closeSheet();
    });

    let inheritableBreaks = [];
    try {
      const freshBreaks = await ApiClient.getStaffBreaks(staffId, true);
      inheritableBreaks = freshBreaks.inheritableSalonBreaks || [];
      if (this.currentStaffHoursState && this.currentStaffHoursState.staffId === staffId) {
        this.currentStaffHoursState.inheritableSalonBreaks = inheritableBreaks;
        if (Array.isArray(freshBreaks.routineBreaks)) {
          this.currentStaffHoursState.routineBreaks = freshBreaks.routineBreaks;
          this.syncRoutineBreaksToDays();
        }
      }
    } catch (err) {
      console.warn('Failed to fetch standard breaks from server, falling back to local state:', err);
      inheritableBreaks = this.currentStaffHoursState?.inheritableSalonBreaks || [];
    }

    const bodyEl = sheetContainer.querySelector('#inherit-break-modal-body');
    if (!bodyEl) return;

    if (inheritableBreaks.length === 0) {
      bodyEl.innerHTML = `
        <div style="text-align: center; padding: 32px 16px;">
          <div style="font-size: 2.2rem; margin-bottom: 8px;">🎉</div>
          <h4 style="color: #fff; font-weight: 700; margin-bottom: 4px; font-size: 0.95rem;">All Salon Breaks Applied</h4>
          <p style="color: #94a3b8; font-size: 0.78rem; margin: 0 0 16px 0;">This specialist already has all of your salon's standard break timings on their schedule.</p>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-inherit-close-done" style="font-size: 0.75rem; padding: 6px 16px;">Done</button>
        </div>
      `;
      bodyEl.querySelector('#btn-inherit-close-done')?.addEventListener('click', closeSheet);
      return;
    }

    const daysKeys = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
    const daysLetters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

    bodyEl.innerHTML = `
      <div style="font-size: 0.76rem; color: #cbd5e1; margin-bottom: 4px; line-height: 1.4;">
        Below are official standard breaks configured for your salon. Tap to apply any of them to this specialist's schedule with 1-click.
      </div>
      <div style="display: flex; flex-direction: column; gap: 10px;">
        ${inheritableBreaks.map((b, idx) => {
      const activeDays = Array.isArray(b.days) ? b.days : [];
      const hasConflict = Boolean(b.conflictReason);

      return `
            <div class="inheritable-break-card ${hasConflict ? 'has-conflict' : ''}">
              <div style="display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <div class="routine-break-icon-wrap" style="background: rgba(59, 130, 246, 0.12); color: #60a5fa;">
                    ${Icons.coffee ? Icons.coffee({ size: 13, color: '#60a5fa' }) : '☕'}
                  </div>
                  <div>
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                      <span style="font-size: 0.88rem; font-weight: 700; color: #fff;">${b.title || 'Salon Break'}</span>
                      <span style="font-size: 0.65rem; padding: 2px 7px; border-radius: 999px; background: rgba(59, 130, 246, 0.15); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3); font-weight: 600;">🏢 Salon Standard</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px; margin-top: 3px; font-size: 0.74rem; color: #94a3b8;">
                      <span>⏰ ${formatTime12h(b.startTime)} – ${formatTime12h(b.endTime)}</span>
                    </div>
                  </div>
                </div>

                <button type="button" 
                  class="btn-inherit-break-action" 
                  data-idx="${idx}" 
                  data-salon-break-id="${b.salonBreakId}" 
                  data-has-conflict="${hasConflict}"
                  style="
                    display: inline-flex;
                    align-items: center;
                    gap: 5px;
                    padding: 6px 12px;
                    font-size: 0.72rem;
                    font-weight: 700;
                    border-radius: 8px;
                    cursor: pointer;
                    white-space: nowrap;
                    border: none;
                    ${hasConflict
          ? 'background: linear-gradient(135deg, #d97706, #b45309); color: #fff; box-shadow: 0 2px 6px rgba(217, 119, 6, 0.3);'
          : 'background: linear-gradient(135deg, #2563eb, #3b82f6); color: #fff; box-shadow: 0 2px 6px rgba(37, 99, 235, 0.3);'}
                  "
                >
                  <span>${hasConflict ? '⚠️ Replace with Salon Timing' : '+ Apply to Stylist'}</span>
                </button>
              </div>

              <!-- Days Matrix Display -->
              <div style="display: flex; align-items: center; justify-content: space-between; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 8px;">
                <span style="font-size: 0.7rem; color: #94a3b8;">Days:</span>
                <div class="routine-break-days-matrix" title="Days: ${activeDays.map((d) => d.slice(0, 3)).join(', ')}">
                  ${daysLetters.map((letter, dayIdx) => {
            const dKey = daysKeys[dayIdx];
            const isActive = activeDays.includes(dKey);
            return `<span class="break-matrix-day ${isActive ? 'active' : ''}">${letter}</span>`;
          }).join('')}
                </div>
              </div>

              ${hasConflict ? `
                <div class="conflict-warning-box">
                  <span style="font-size: 1rem; line-height: 1;">⚠️</span>
                  <div>
                    <span style="font-weight: 700;">Timing Conflict Detected:</span>
                    <div>This specialist already has a custom break (${b.conflictReason}).</div>
                    <div style="font-size: 0.68rem; color: #fef08a; margin-top: 2px;">
                      Tapping "Replace with Salon Timing" will update this day to match the salon's standard break timing.
                    </div>
                  </div>
                </div>
              ` : ''}
            </div>
          `;
    }).join('')}
      </div>
    `;

    // Attach click listeners to apply buttons
    bodyEl.querySelectorAll('.btn-inherit-break-action').forEach((btn) => {
      btn.onclick = async (e) => {
        e.preventDefault();
        const idx = parseInt(btn.getAttribute('data-idx'), 10);
        const targetBreak = inheritableBreaks[idx];
        if (!targetBreak) return;

        const hasConflict = btn.getAttribute('data-has-conflict') === 'true';
        if (hasConflict) {
          const ok = confirm(`Timing Conflict Detected!\n\n${targetBreak.conflictReason}\n\nDo you want to replace this specialist's custom break with "${targetBreak.title}" (${targetBreak.startTime}–${targetBreak.endTime}) from the salon standard timing?`);
          if (!ok) return;
        }

        btn.disabled = true;
        btn.innerHTML = `<span class="spinner-border spinner-border-sm" role="status" style="width: 10px; height: 10px; margin-right: 4px;"></span> Applying...`;

        try {
          await ApiClient.inheritSalonBreak(staffId, {
            salonBreakId: targetBreak.salonBreakId,
            replaceConflicts: hasConflict,
            days: targetBreak.days,
          });

          // Fetch fresh staff and breaks
          const [freshStaff, freshBreaks] = await Promise.all([
            ApiClient.getStaff(true),
            ApiClient.getStaffBreaks(staffId, true),
          ]);

          this.staffList = freshStaff;
          if (this.currentStaffHoursState && this.currentStaffHoursState.staffId === staffId) {
            if (Array.isArray(freshBreaks.routineBreaks)) {
              this.currentStaffHoursState.routineBreaks = freshBreaks.routineBreaks;
            }
            this.currentStaffHoursState.inheritableSalonBreaks = freshBreaks.inheritableSalonBreaks || [];
            this.syncRoutineBreaksToDays();
            this.updateStaffHoursTableUI();
          }

          closeSheet();
          this.showToast(`Applied "${targetBreak.title}" to specialist's schedule!`, 'success');
        } catch (err) {
          console.error('Failed to apply salon break:', err);
          this.showToast(err.message || 'Failed to apply break', 'error');
          btn.disabled = false;
          btn.innerHTML = `<span>${hasConflict ? '⚠️ Replace with Salon Timing' : '+ Apply to Stylist'}</span>`;
        }
      };
    });
  }

  openStaffDayRosterModal(dayKey) {
    if (!this.currentStaffHoursState?.days) return;
    const dayData = this.currentStaffHoursState.days[dayKey];
    if (!dayData) return;

    const modalContainer = document.getElementById('modal-container') || document.body;
    const isSalonClosed = Boolean(dayData.isSalonClosed);
    let isWorking = !isSalonClosed && (dayData.isWorking !== false);

    modalContainer.innerHTML = `
      <div class="modal-backdrop show" id="staff-day-roster-modal-backdrop">
        <div class="modal-content wh-edit-modal">
          <div class="modal-header" style="border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 12px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span class="wh-modal-day-badge" style="${isSalonClosed ? 'background: rgba(239, 68, 68, 0.2); border-color: rgba(239, 68, 68, 0.4); color: #f87171;' : ''}">${dayData.dayShort}</span>
              <div>
                <h3 style="margin: 0; font-size: 0.92rem; font-weight: 700; color: #fff;">${dayData.friendlyDay} Shift</h3>
                <p style="margin: 2px 0 0 0; font-size: 0.68rem; color: #94a3b8;">Set working hours for ${this.currentStaffHoursState.staffName}</p>
              </div>
            </div>
            <button class="close-btn" id="btn-close-roster-modal">&times;</button>
          </div>

          <div class="modal-body" style="padding: 16px 0; display: flex; flex-direction: column; gap: 14px;">
            ${isSalonClosed ? `
              <!-- Salon Closed Warning Banner -->
              <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 10px; padding: 10px 14px; display: flex; align-items: flex-start; gap: 10px;">
                <span style="font-size: 1.15rem; line-height: 1;">🏢</span>
                <div style="font-size: 0.74rem; color: #fca5a5; line-height: 1.45;">
                  <strong style="display: block; font-size: 0.8rem; margin-bottom: 2px; color: #f87171;">Salon Facility is Closed on ${dayData.friendlyDay}</strong>
                  The salon is marked closed in Salon Working Hours. Stylists cannot be scheduled to work when the salon is closed. To schedule shifts on this day, please open ${dayData.friendlyDay} in <strong>Salon Working Hours</strong> first.
                </div>
              </div>
            ` : ''}

            <!-- Working / Weekly Off / Closed Toggle -->
            <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 10px 14px; ${isSalonClosed ? 'opacity: 0.6;' : ''}">
              <div>
                <strong style="color: #fff; font-size: 0.86rem; display: block;">Working Day</strong>
                <span style="font-size: 0.7rem; color: ${isSalonClosed ? '#f87171' : '#94a3b8'};" id="modal-roster-status-hint">
                  ${isSalonClosed ? 'Salon is closed on this day (locked)' : (isWorking ? 'Stylist is available for appointments' : 'Marked as Weekly Off')}
                </span>
              </div>
              <label class="switch-toggle" style="margin: 0; ${isSalonClosed ? 'opacity: 0.35; cursor: not-allowed; pointer-events: none;' : ''}" title="${isSalonClosed ? `Cannot enable: Salon is closed on ${dayData.friendlyDay}` : ''}">
                <input type="checkbox" id="modal-chk-roster-working" ${isWorking ? 'checked' : ''} ${isSalonClosed ? 'disabled' : ''} />
                <span class="switch-slider"></span>
              </label>
            </div>

            <!-- Working Shift Hours Section -->
            <div id="modal-roster-shift-wrap" style="display: ${isWorking ? 'block' : 'none'};">
              <label style="display: flex; align-items: center; gap: 6px; font-size: 0.76rem; font-weight: 700; color: #cbd5e1; margin-bottom: 8px;">
                ${Icons.clock ? Icons.clock({ size: 14, color: '#a78bfa' }) : '⏰'}
                <span>Shift Working Hours</span>
              </label>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 0.7rem; color: #94a3b8; margin-bottom: 4px; display: block;">Start Time</label>
                  <input type="time" class="form-control bulk-time-inp" id="modal-roster-start" value="${dayData.startTime}" min="${dayData.salonStart}" max="${dayData.salonEnd}" />
                  <div id="modal-roster-start-preview" style="font-size: 0.7rem; color: #a5b4fc; margin-top: 3px; text-align: center; font-weight: 600;">
                    ${formatTime12h(dayData.startTime)}
                  </div>
                </div>
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 0.7rem; color: #94a3b8; margin-bottom: 4px; display: block;">End Time</label>
                  <input type="time" class="form-control bulk-time-inp" id="modal-roster-end" value="${dayData.endTime}" min="${dayData.salonStart}" max="${dayData.salonEnd}" />
                  <div id="modal-roster-end-preview" style="font-size: 0.7rem; color: #a5b4fc; margin-top: 3px; text-align: center; font-weight: 600;">
                    ${formatTime12h(dayData.endTime)}
                  </div>
                </div>
              </div>
              <div style="font-size: 0.68rem; color: #a78bfa; margin-top: 6px; text-align: center;">
                🏢 Allowed store operating window: <strong>${formatTime12h(dayData.salonStart)} – ${formatTime12h(dayData.salonEnd)}</strong>
              </div>

              <!-- Routine Breaks Indicator -->
              ${(() => {
        const routineBreaks = (this.currentStaffHoursState?.routineBreaks || []).filter((rb) => Array.isArray(rb.days) && rb.days.includes(dayKey));
        if (routineBreaks.length > 0) {
          return `
                    <div style="font-size: 0.72rem; color: #c4b5fd; background: rgba(139, 61, 255, 0.08); border: 1px solid rgba(139, 61, 255, 0.2); border-radius: 8px; padding: 8px 12px; margin-top: 10px;">
                      <div style="font-weight: 700; margin-bottom: 4px;">☕ Routine Breaks for ${dayData.friendlyDay}:</div>
                      <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                        ${routineBreaks.map((b) => `<span style="background: rgba(139, 61, 255, 0.2); border: 1px solid rgba(139, 61, 255, 0.4); border-radius: 4px; padding: 2px 7px; font-weight: 700; color: #fff; font-size: 0.68rem;">${b.title || 'Break'} (${formatTime12h(b.startTime)} - ${formatTime12h(b.endTime)})</span>`).join('')}
                      </div>
                    </div>
                  `;
        }
        return `
                  <div style="font-size: 0.7rem; color: #94a3b8; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; padding: 8px 12px; margin-top: 10px;">
                    ☕ No routine breaks assigned for ${dayData.friendlyDay}. (Configure in Daily Breaks tab)
                  </div>
                `;
      })()}
            </div>
          </div>

          <div class="modal-footer" style="border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 12px; display: flex; justify-content: space-between; align-items: center; gap: 8px;">
            <div style="display: flex; gap: 8px; align-items: center;">
              <button type="button" class="btn btn-secondary" id="modal-btn-roster-cancel" style="height: 36px; padding: 0 16px; font-size: 0.78rem; font-weight: 500; border-radius: 8px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); color: #94a3b8; cursor: pointer; transition: all 0.15s ease;">Cancel</button>
              ${dayData.isCustomized ? `
                <button type="button" class="btn btn-secondary btn-sm" id="modal-btn-roster-reset-salon" style="height: 36px; padding: 0 12px; font-size: 0.72rem; font-weight: 600; border-radius: 8px; background: rgba(139, 92, 246, 0.12); border: 1px solid rgba(139, 92, 246, 0.28); color: #c4b5fd; cursor: pointer; display: inline-flex; align-items: center; gap: 5px; transition: all 0.15s ease;" title="Reset to standard salon facility hours">
                  ↺ Reset to Salon Hours
                </button>
              ` : ''}
            </div>
            <button type="button" class="btn btn-primary" id="modal-btn-roster-save" style="height: 36px; padding: 0 20px; font-size: 0.78rem; font-weight: 600; border-radius: 8px; background: linear-gradient(135deg, #7c3aed, #6366f1); border: none; color: #ffffff; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 2px 10px rgba(124, 58, 237, 0.3); transition: all 0.15s ease;">
              <span>Update Shift</span>
            </button>
          </div>
        </div>
      </div>
    `;

    const modalBackdrop = modalContainer.querySelector('#staff-day-roster-modal-backdrop');
    const closeModal = () => (modalContainer.innerHTML = '');

    modalContainer.querySelector('#btn-close-roster-modal')?.addEventListener('click', closeModal);
    modalContainer.querySelector('#modal-btn-roster-cancel')?.addEventListener('click', closeModal);
    modalBackdrop?.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) closeModal();
    });

    const chkWorking = modalContainer.querySelector('#modal-chk-roster-working');
    const shiftWrap = modalContainer.querySelector('#modal-roster-shift-wrap');
    const hint = modalContainer.querySelector('#modal-roster-status-hint');

    chkWorking?.addEventListener('change', () => {
      isWorking = chkWorking.checked;
      if (shiftWrap) shiftWrap.style.display = isWorking ? 'block' : 'none';
      if (hint) hint.textContent = isWorking ? 'Stylist is available for appointments' : 'Marked as Weekly Off';
    });

    const startInp = modalContainer.querySelector('#modal-roster-start');
    const endInp = modalContainer.querySelector('#modal-roster-end');
    const startPrev = modalContainer.querySelector('#modal-roster-start-preview');
    const endPrev = modalContainer.querySelector('#modal-roster-end-preview');

    startInp?.addEventListener('input', () => {
      if (startPrev) startPrev.textContent = formatTime12h(startInp.value);
    });
    startInp?.addEventListener('change', () => {
      if (startPrev) startPrev.textContent = formatTime12h(startInp.value);
    });
    endInp?.addEventListener('input', () => {
      if (endPrev) endPrev.textContent = formatTime12h(endInp.value);
    });
    endInp?.addEventListener('change', () => {
      if (endPrev) endPrev.textContent = formatTime12h(endInp.value);
    });

    modalContainer.querySelector('#modal-btn-roster-save')?.addEventListener('click', (e) => {
      e.preventDefault();
      const sVal = startInp?.value || dayData.startTime || '';
      const eVal = endInp?.value || dayData.endTime || '';
      if (isWorking && isSalonClosed) {
        this.showToast?.(`Cannot enable shift: Salon is closed on ${dayData.friendlyDay}.`, 'warning');
        return;
      }
      if (isWorking) {
        if (!sVal || !eVal || sVal >= eVal) {
          alert(`Shift start (${formatTime12h(sVal)}) must be earlier than shift end (${formatTime12h(eVal)}).`);
          return;
        }
        const swhStart = dayData.salonStart || this.salonProfile?.defaultStartTime || '09:00';
        const swhEnd = dayData.salonEnd || this.salonProfile?.defaultEndTime || '19:00';
        if (sVal < swhStart || eVal > swhEnd) {
          alert(`Facility Boundary Error: Shift (${formatTime12h(sVal)} – ${formatTime12h(eVal)}) cannot extend outside salon facility operating hours (${formatTime12h(swhStart)} – ${formatTime12h(swhEnd)}). Stylists must work under salon hours.`);
          return;
        }
      }

      const swhStart = dayData.salonStart || this.salonProfile?.defaultStartTime || '09:00';
      const swhEnd = dayData.salonEnd || this.salonProfile?.defaultEndTime || '19:00';
      const finalIsWorking = isSalonClosed ? false : isWorking;
      const isIdenticalToSalon = !isSalonClosed && finalIsWorking && sVal === swhStart && eVal === swhEnd;

      this.currentStaffHoursState.days[dayKey].isWorking = finalIsWorking;
      this.currentStaffHoursState.days[dayKey].startTime = sVal;
      this.currentStaffHoursState.days[dayKey].endTime = eVal;
      this.currentStaffHoursState.days[dayKey].isCustomized = !isIdenticalToSalon;

      closeModal();
      this.updateStaffHoursTableUI();
      this.autoSaveStaffSchedule(this.currentStaffHoursState?.staffId, true);
      this.showToast(`${dayData.friendlyDay} shift updated (auto-saved)`, 'success');
    });

    modalContainer.querySelector('#modal-btn-roster-reset-salon')?.addEventListener('click', (e) => {
      e.preventDefault();
      const swh = dayData.salonStart || this.salonProfile?.defaultStartTime || '09:00';
      const ewh = dayData.salonEnd || this.salonProfile?.defaultEndTime || '21:00';
      this.currentStaffHoursState.days[dayKey].startTime = swh;
      this.currentStaffHoursState.days[dayKey].endTime = ewh;
      this.currentStaffHoursState.days[dayKey].isWorking = !isSalonClosed;
      this.currentStaffHoursState.days[dayKey].isCustomized = false;

      closeModal();
      this.updateStaffHoursTableUI();
      this.autoSaveStaffSchedule(this.currentStaffHoursState?.staffId, true);
      this.showToast(`Reset ${dayData.friendlyDay} to salon standard hours (auto-saved)`, 'success');
    });
  }

  openRevertCustomShiftBottomSheet(dayKey) {
    if (!this.currentStaffHoursState?.days) return;
    const dayData = this.currentStaffHoursState.days[dayKey];
    if (!dayData) return;

    const modalContainer = document.getElementById('modal-container') || document.body;
    const staffName = this.currentStaffHoursState.staffName || 'Specialist';
    const isSalonClosed = Boolean(dayData.isSalonClosed);
    const swhStart = dayData.salonStart || this.salonProfile?.defaultStartTime || '09:00';
    const swhEnd = dayData.salonEnd || this.salonProfile?.defaultEndTime || '19:00';

    modalContainer.innerHTML = `
      <div class="modal-backdrop show" id="revert-custom-sheet-backdrop" style="background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(6px); z-index: 1050; display: flex; align-items: flex-end; justify-content: center;">
        <div class="bottom-sheet-content" style="background: #0f131f; border-top: 1px solid rgba(255, 255, 255, 0.1); border-radius: 18px 18px 0 0; width: 100%; max-width: 420px; padding: 14px 18px 18px 18px; box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.7); animation: slideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1);">
          <div style="width: 32px; height: 3px; background: rgba(255, 255, 255, 0.2); border-radius: 999px; margin: 0 auto 12px auto;"></div>
          
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); padding-bottom: 10px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="background: rgba(139, 92, 246, 0.14); color: #c4b5fd; border: 1px solid rgba(139, 92, 246, 0.28); border-radius: 5px; width: 32px; height: 20px; font-weight: 800; font-size: 0.62rem; display: inline-flex; align-items: center; justify-content: center; text-transform: uppercase; letter-spacing: 0.4px;">${dayData.dayShort}</span>
              <div>
                <h3 style="margin: 0; font-size: 0.86rem; font-weight: 700; color: #f8fafc; letter-spacing: -0.15px;">Custom Schedule Active</h3>
                <p style="margin: 1px 0 0 0; font-size: 0.68rem; color: #94a3b8;">${dayData.friendlyDay} schedule for ${staffName}</p>
              </div>
            </div>
            <button type="button" class="close-btn" id="btn-close-revert-sheet" style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.08); width: 24px; height: 24px; border-radius: 50%; font-size: 13px; color: #94a3b8; cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1; transition: all 0.15s ease;">&times;</button>
          </div>

          <!-- Unified Modern Comparison Card -->
          <div style="background: rgba(255, 255, 255, 0.025); border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 10px; overflow: hidden; margin-bottom: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 9px 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
              <div style="display: flex; align-items: center; gap: 7px;">
                <span style="font-size: 0.68rem; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.3px;">Current Shift</span>
                <span class="stylist-custom-chip" style="font-size: 0.5rem; padding: 1px 5px;">CUSTOM</span>
              </div>
              <span style="font-size: 0.8rem; font-weight: 600; color: #f8fafc; font-feature-settings: 'tnum';">
                ${!dayData.isWorking ? '<span style="color: #94a3b8; font-style: italic; font-weight: 500;">Personal Weekly Off</span>' : `${formatTime12h(dayData.startTime)} – ${formatTime12h(dayData.endTime)}`}
              </span>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; padding: 9px 12px; background: rgba(139, 92, 246, 0.025);">
              <div style="display: flex; align-items: center; gap: 7px;">
                <span style="font-size: 0.68rem; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.3px;">Salon Hours</span>
                <span style="font-size: 0.5rem; font-weight: 700; color: #a78bfa; background: rgba(139, 92, 246, 0.12); border: 1px solid rgba(139, 92, 246, 0.25); border-radius: 4px; padding: 1px 5px; text-transform: uppercase; letter-spacing: 0.3px;">Store</span>
              </div>
              <span style="font-size: 0.8rem; font-weight: 600; color: ${isSalonClosed ? '#f87171' : '#38bdf8'}; font-feature-settings: 'tnum';">
                ${isSalonClosed ? '🔒 Salon Closed' : `${formatTime12h(swhStart)} – ${formatTime12h(swhEnd)}`}
              </span>
            </div>
          </div>

          <p style="margin: 0 0 12px 0; font-size: 0.7rem; color: #64748b; line-height: 1.4;">
            Reverts <strong>${dayData.friendlyDay}</strong> back to standard salon facility operating hours.
          </p>

          <div style="display: flex; flex-direction: column; gap: 6px;">
            <button type="button" class="btn btn-primary" id="btn-confirm-revert-salon" style="width: 100%; height: 36px; font-weight: 600; font-size: 0.78rem; background: linear-gradient(135deg, #7c3aed, #6366f1); border: none; border-radius: 8px; color: #ffffff; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 2px 10px rgba(124, 58, 237, 0.3); white-space: nowrap; transition: all 0.15s ease;">
              <span style="font-size: 0.86rem; line-height: 1;">↺</span>
              <span>Revert to Salon Hours</span>
            </button>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 1px;">
              <button type="button" class="btn btn-secondary" id="btn-edit-from-sheet" style="font-size: 0.72rem; font-weight: 500; height: 32px; border-radius: 7px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); color: #cbd5e1; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 5px; transition: all 0.15s ease;">
                <span>✏️</span>
                <span>Edit Hours</span>
              </button>
              <button type="button" class="btn btn-secondary" id="btn-cancel-revert-sheet" style="font-size: 0.72rem; font-weight: 500; height: 32px; border-radius: 7px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); color: #94a3b8; cursor: pointer; transition: all 0.15s ease;">
                Keep Custom
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    const closeSheet = () => (modalContainer.innerHTML = '');
    modalContainer.querySelector('#btn-close-revert-sheet')?.addEventListener('click', closeSheet);
    modalContainer.querySelector('#btn-cancel-revert-sheet')?.addEventListener('click', closeSheet);
    modalContainer.querySelector('#revert-custom-sheet-backdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'revert-custom-sheet-backdrop') closeSheet();
    });

    modalContainer.querySelector('#btn-edit-from-sheet')?.addEventListener('click', () => {
      closeSheet();
      this.openStaffDayRosterModal(dayKey);
    });

    modalContainer.querySelector('#btn-confirm-revert-salon')?.addEventListener('click', () => {
      this.currentStaffHoursState.days[dayKey].startTime = swhStart;
      this.currentStaffHoursState.days[dayKey].endTime = swhEnd;
      this.currentStaffHoursState.days[dayKey].isWorking = !isSalonClosed;
      this.currentStaffHoursState.days[dayKey].isCustomized = false;

      closeSheet();
      this.updateStaffHoursTableUI();
      this.autoSaveStaffSchedule(this.currentStaffHoursState?.staffId, true);
      this.showToast(`${dayData.friendlyDay} restored to original salon hours (${formatTime12h(swhStart)} – ${formatTime12h(swhEnd)})`, 'success');
    });
  }

  openResetAllToSalonHoursBottomSheet() {
    if (!this.currentStaffHoursState?.days) return;
    const modalContainer = document.getElementById('modal-container') || document.body;
    const staffId = this.currentStaffHoursState.staffId;
    const staffName = this.currentStaffHoursState.staffName || 'Specialist';

    const daysArr = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
    const customizedDays = daysArr.filter((d) => this.currentStaffHoursState.days[d]?.isCustomized);
    const customCount = customizedDays.length;

    const activeSalonDays = (this.salonWorkingHours || []).filter((h) => !h.isClosed);
    const salonStart = activeSalonDays.length > 0 ? activeSalonDays[0].startTime : (this.salonProfile?.defaultStartTime || '09:00');
    const salonEnd = activeSalonDays.length > 0 ? activeSalonDays[0].endTime : (this.salonProfile?.defaultEndTime || '19:00');
    const closedSalonDays = (this.salonWorkingHours || []).filter((h) => h.isClosed);

    modalContainer.innerHTML = `
      <div class="modal-backdrop show" id="reset-all-salon-sheet-backdrop" style="background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(6px); z-index: 1050; display: flex; align-items: flex-end; justify-content: center;">
        <div class="bottom-sheet-content" style="background: #0f131f; border-top: 1px solid rgba(255, 255, 255, 0.1); border-radius: 18px 18px 0 0; width: 100%; max-width: 440px; padding: 14px 18px 18px 18px; box-shadow: 0 -12px 40px rgba(0, 0, 0, 0.7); animation: slideUp 0.22s cubic-bezier(0.16, 1, 0.3, 1);">
          <div style="width: 32px; height: 3px; background: rgba(255, 255, 255, 0.2); border-radius: 999px; margin: 0 auto 12px auto;"></div>

          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); padding-bottom: 10px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="background: rgba(139, 92, 246, 0.14); color: #c4b5fd; border: 1px solid rgba(139, 92, 246, 0.28); border-radius: 6px; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; font-size: 0.95rem;">🔄</span>
              <div>
                <h3 style="margin: 0; font-size: 0.86rem; font-weight: 700; color: #f8fafc; letter-spacing: -0.15px;">Reset Schedule to Salon Hours</h3>
                <p style="margin: 1px 0 0 0; font-size: 0.68rem; color: #94a3b8;">Sync all 7 weekly shifts for ${staffName}</p>
              </div>
            </div>
            <button class="close-btn" id="btn-close-reset-all-sheet" style="background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.08); width: 24px; height: 24px; border-radius: 50%; font-size: 13px; color: #94a3b8; cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1; transition: all 0.15s ease;">&times;</button>
          </div>

          <!-- Comparison Surface: Store Hours & Custom Days Breakdown -->
          <div style="background: rgba(255, 255, 255, 0.025); border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 10px; overflow: hidden; margin-bottom: 10px;">
            <!-- Store Hours Benchmark Row -->
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 9px 12px; background: rgba(139, 92, 246, 0.04); border-bottom: 1px solid rgba(255, 255, 255, 0.06);">
              <div style="display: flex; align-items: center; gap: 7px;">
                <span style="font-size: 0.68rem; font-weight: 600; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.3px;">Store Operating Hours</span>
                <span style="font-size: 0.5rem; font-weight: 700; color: #a78bfa; background: rgba(139, 92, 246, 0.14); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: 4px; padding: 1px 5px; text-transform: uppercase; letter-spacing: 0.3px;">STORE</span>
              </div>
              <span style="font-size: 0.8rem; font-weight: 600; color: #38bdf8; font-feature-settings: 'tnum'; white-space: nowrap;">
                ${formatTime12h(salonStart)} – ${formatTime12h(salonEnd)}
              </span>
            </div>

            <!-- Customized Shifts Breakdown Header -->
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 7px 12px; background: rgba(255, 255, 255, 0.02); border-bottom: 1px solid rgba(255, 255, 255, 0.04);">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 0.64rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.3px;">Customized Shifts</span>
                <span class="stylist-custom-chip" style="font-size: 0.5rem; padding: 1px 5px;">${customCount > 0 ? `${customCount} CUSTOM` : '0 CUSTOM'}</span>
              </div>
              <span style="font-size: 0.64rem; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.3px;">Will Reset To Store</span>
            </div>

            <!-- Customized Days List -->
            <div style="max-height: 140px; overflow-y: auto;">
              ${customCount === 0 ? `
                <div style="padding: 10px 12px; font-size: 0.74rem; color: #34d399; font-weight: 600; text-align: center;">
                  ✓ All 7 days already match store hours
                </div>
              ` : customizedDays.map((dKey) => {
      const dayData = this.currentStaffHoursState.days[dKey];
      const salonDay = (this.salonWorkingHours || []).find((h) => h.dayOfWeek === dKey);
      const isClosed = salonDay ? Boolean(salonDay.isClosed) : false;
      const sStart = salonDay?.startTime || this.salonProfile?.defaultStartTime || '09:00';
      const sEnd = salonDay?.endTime || this.salonProfile?.defaultEndTime || '19:00';

      const customTime = !dayData.isWorking
        ? '<span style="color: #fca5a5; font-style: italic; font-weight: 500;">Personal Off</span>'
        : `${formatTime12h(dayData.startTime)} – ${formatTime12h(dayData.endTime)}`;

      const storeTime = isClosed
        ? '<span style="color: #f87171; font-weight: 600;">🔒 Store Closed</span>'
        : `${formatTime12h(sStart)} – ${formatTime12h(sEnd)}`;

      return `
                  <div style="display: flex; align-items: center; justify-content: space-between; padding: 7px 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.035); background: rgba(0, 0, 0, 0.12);">
                    <div style="display: flex; align-items: center; gap: 7px; min-width: 0;">
                      <span style="background: rgba(139, 92, 246, 0.14); color: #c4b5fd; border: 1px solid rgba(139, 92, 246, 0.28); border-radius: 4px; padding: 1px 5px; font-weight: 800; font-size: 0.6rem; text-transform: uppercase; flex-shrink: 0;">${dayData.dayShort || dKey.slice(0, 3)}</span>
                      <span style="font-size: 0.74rem; font-weight: 600; color: #fbbf24; font-feature-settings: 'tnum'; white-space: nowrap;">${customTime}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0; margin-left: 8px;">
                      <span style="font-size: 0.68rem; color: #64748b;">➔</span>
                      <span style="font-size: 0.74rem; font-weight: 600; color: #38bdf8; font-feature-settings: 'tnum'; white-space: nowrap;">${storeTime}</span>
                    </div>
                  </div>
                `;
    }).join('')}
            </div>

            ${closedSalonDays.length > 0 ? `
              <div style="padding: 5px 12px; background: rgba(239, 68, 68, 0.06); border-top: 1px solid rgba(255, 255, 255, 0.04); font-size: 0.66rem; color: #fca5a5;">
                Closed Days: ${closedSalonDays.map((c) => c.dayOfWeek.slice(0, 3)).join(', ')}
              </div>
            ` : ''}
          </div>

          <p style="margin: 0 0 12px 0; font-size: 0.7rem; color: #64748b; line-height: 1.4;">
            Resets all 7 days for <strong>${staffName}</strong> to match the salon facility hours. All custom day overrides will be cleared.
          </p>

          <div style="display: flex; flex-direction: column; gap: 6px;">
            <button type="button" class="btn btn-primary" id="btn-confirm-reset-all-salon" style="width: 100%; height: 36px; font-weight: 600; font-size: 0.78rem; background: linear-gradient(135deg, #7c3aed, #6366f1); border: none; border-radius: 8px; color: #ffffff; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 2px 10px rgba(124, 58, 237, 0.3); white-space: nowrap; transition: all 0.15s ease;">
              <span style="font-size: 0.86rem; line-height: 1;">↺</span>
              <span>Reset All to Salon Hours</span>
            </button>
            <button type="button" class="btn btn-secondary" id="btn-cancel-reset-all-sheet" style="font-size: 0.72rem; font-weight: 500; height: 32px; border-radius: 7px; background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); color: #94a3b8; cursor: pointer; transition: all 0.15s ease;">
              Keep Current Schedule
            </button>
          </div>
        </div>
      </div>
    `;

    const closeSheet = () => (modalContainer.innerHTML = '');
    modalContainer.querySelector('#btn-close-reset-all-sheet')?.addEventListener('click', closeSheet);
    modalContainer.querySelector('#btn-cancel-reset-all-sheet')?.addEventListener('click', closeSheet);
    modalContainer.querySelector('#reset-all-salon-sheet-backdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'reset-all-salon-sheet-backdrop') closeSheet();
    });

    modalContainer.querySelector('#btn-confirm-reset-all-salon')?.addEventListener('click', () => {
      daysArr.forEach((dKey) => {
        const salonDay = (this.salonWorkingHours || []).find((h) => h.dayOfWeek === dKey);
        const isClosed = salonDay ? Boolean(salonDay.isClosed) : false;
        const sStart = salonDay?.startTime || this.salonProfile?.defaultStartTime || '09:00';
        const sEnd = salonDay?.endTime || this.salonProfile?.defaultEndTime || '19:00';

        if (this.currentStaffHoursState?.days[dKey]) {
          this.currentStaffHoursState.days[dKey].isWorking = !isClosed;
          this.currentStaffHoursState.days[dKey].isSalonClosed = isClosed;
          this.currentStaffHoursState.days[dKey].startTime = sStart;
          this.currentStaffHoursState.days[dKey].endTime = sEnd;
          this.currentStaffHoursState.days[dKey].isCustomized = false;
        }
      });

      if (this.currentStaffHoursState) {
        this.currentStaffHoursState.masterShift = { startTime: salonStart, endTime: salonEnd };
        this.currentStaffHoursState.followsSalon = true;
      }

      const bulkS = document.getElementById('master-bulk-start');
      const bulkE = document.getElementById('master-bulk-end');
      const bulkSPrev = document.getElementById('master-bulk-start-preview');
      const bulkEPrev = document.getElementById('master-bulk-end-preview');
      if (bulkS) bulkS.value = salonStart;
      if (bulkE) bulkE.value = salonEnd;
      if (bulkSPrev) bulkSPrev.textContent = formatTime12h(salonStart);
      if (bulkEPrev) bulkEPrev.textContent = formatTime12h(salonEnd);

      closeSheet();
      this.updateStaffHoursTableUI();
      this.autoSaveStaffSchedule(staffId, true);
      this.showToast(`✨ All days for ${staffName} reset to match salon facility operating hours!`, 'success');
    });
  }

  // =========================================================================
  // SALON FACILITY OPERATING HOURS & FACILITY BREAKS (MODERN ROUTINE HUB)
  // =========================================================================

  renderSalonHoursSection() {
    try {
      const daysArr = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
      const rawHours = this.salonWorkingHours || this.salonProfile?.workingHours || [];
      const existingHours = Array.isArray(rawHours) ? rawHours : Object.values(rawHours || {});
      const salonProfile = this.salonProfile || {};
      const defaultSalonStart = salonProfile.defaultStartTime || '09:00';
      const defaultSalonEnd = salonProfile.defaultEndTime || '21:00';

      // Build normalized 7-day schedule map & detect facility routine breaks
      const daysObj = {};
      const allBreaksFound = [];

      daysArr.forEach((day) => {
        const found = existingHours.find((h) => h.dayOfWeek === day);
        const isClosed = found ? Boolean(found.isClosed) : false;
        const startTime = found?.startTime || defaultSalonStart;
        const endTime = found?.endTime || defaultSalonEnd;
        const salonBreaksList = Array.isArray(this.salonBreaks) ? this.salonBreaks : [];
        const salonBreaksForDay = salonBreaksList.filter((b) => b.dayOfWeek === day);
        let breaks = [];
        if (salonBreaksForDay.length > 0) {
          breaks = salonBreaksForDay.map((b) => ({
            id: b.id || `sbrk-${day}-${b.startTime}`,
            title: (b.title || 'Lunch Break').trim(),
            startTime: b.startTime,
            endTime: b.endTime,
          }));
        } else if (Array.isArray(found?.breaks) && found.breaks.length > 0) {
          breaks = found.breaks.map((b) => ({
            id: b.id || `sbrk-${day}-${b.startTime}`,
            title: (b.title || 'Lunch Break').trim(),
            startTime: b.startTime,
            endTime: b.endTime,
          }));
        }

        breaks.forEach((b) => {
          allBreaksFound.push({ ...b, day });
        });

        daysObj[day] = {
          day,
          friendlyDay: day.charAt(0) + day.slice(1).toLowerCase(),
          dayShort: day.slice(0, 3),
          isOpen: !isClosed,
          startTime,
          endTime,
          breaks,
        };
      });

      // Detect most frequent operating hours across open days
      const shiftFreq = {};
      daysArr.forEach((day) => {
        const d = daysObj[day];
        if (d && d.isOpen && d.startTime && d.endTime) {
          const key = `${d.startTime}_${d.endTime}`;
          shiftFreq[key] = (shiftFreq[key] || 0) + 1;
        }
      });

      let detectedMasterStart = defaultSalonStart;
      let detectedMasterEnd = defaultSalonEnd;
      let maxFreq = 0;
      for (const [shiftKey, count] of Object.entries(shiftFreq)) {
        if (count > maxFreq) {
          maxFreq = count;
          const [s, e] = shiftKey.split('_');
          detectedMasterStart = s;
          detectedMasterEnd = e;
        }
      }

      // Group facility breaks into Routine Breaks
      let detectedRoutineBreaks = [];
      if (Array.isArray(this.salonRoutineBreaks) && this.salonRoutineBreaks.length > 0) {
        detectedRoutineBreaks = this.salonRoutineBreaks.map((rb) => ({
          id: rb.breakIds?.[rb.days?.[0]] || `srb-${Math.random().toString(36).substr(2, 6)}`,
          title: rb.title || 'Lunch Break',
          startTime: rb.startTime,
          endTime: rb.endTime,
          days: rb.days || [],
          breakIds: rb.breakIds || {},
        }));
      } else if (allBreaksFound.length > 0) {
        const grouped = {};
        allBreaksFound.forEach((b) => {
          const key = `${b.title || 'Break'}_${b.startTime}_${b.endTime}`;
          if (!grouped[key]) {
            grouped[key] = {
              id: `srb-${Math.random().toString(36).substr(2, 6)}`,
              title: b.title || 'Lunch Break',
              startTime: b.startTime,
              endTime: b.endTime,
              days: [],
            };
          }
          if (!grouped[key].days.includes(b.day)) {
            grouped[key].days.push(b.day);
          }
        });
        detectedRoutineBreaks = Object.values(grouped);
      }

      const currentTab = this.currentSalonHoursState?.activeSubTab || 'shifts';

      this.currentSalonHoursState = {
        activeSubTab: currentTab,
        masterHours: {
          startTime: detectedMasterStart,
          endTime: detectedMasterEnd,
        },
        routineBreaks: detectedRoutineBreaks,
        days: daysObj,
      };

      this.syncSalonRoutineBreaksToDays();

      const masterStart = this.currentSalonHoursState?.masterHours?.startTime || defaultSalonStart;
      const masterEnd = this.currentSalonHoursState?.masterHours?.endTime || defaultSalonEnd;
      const openDaysCount = daysArr.filter((d) => this.currentSalonHoursState?.days?.[d]?.isOpen).length;

      const todayJsDay = new Date().getDay();
      const dayOrder = [
        { key: 'MONDAY', label: 'Monday', jsDay: 1 },
        { key: 'TUESDAY', label: 'Tuesday', jsDay: 2 },
        { key: 'WEDNESDAY', label: 'Wednesday', jsDay: 3 },
        { key: 'THURSDAY', label: 'Thursday', jsDay: 4 },
        { key: 'FRIDAY', label: 'Friday', jsDay: 5 },
        { key: 'SATURDAY', label: 'Saturday', jsDay: 6 },
        { key: 'SUNDAY', label: 'Sunday', jsDay: 0 },
      ];
      const todayKey = dayOrder.find((d) => d.jsDay === todayJsDay)?.key || 'MONDAY';
      const isClosedToday = !daysObj[todayKey]?.isOpen;
      const staffCount = (this.staffList || []).length;
      const servicesCount = (this.servicesList || []).length;

      return `
        <div class="stylist-routine-card" id="salon-routine-card-container">
          <!-- Top Navigation Row: [ Segmented Tabs ] -->
          <div class="stylist-schedule-top-row" style="margin-bottom: 12px; justify-content: flex-start;">
            <div class="stylist-schedule-segmented-tabs" id="salon-schedule-tabs" style="max-width: 380px; width: 100%;">
              <button type="button" class="schedule-tab-btn ${currentTab === 'shifts' ? 'active' : ''}" data-tab="shifts" id="salon-tab-btn-shifts">
                <span>⏰ Operating Hours</span>
              </button>
              <button type="button" class="schedule-tab-btn ${currentTab === 'breaks' ? 'active' : ''}" data-tab="breaks" id="salon-tab-btn-breaks">
                <span>☕ Facility Breaks</span>
                <span class="breaks-count-chip" id="salon-breaks-count">${this.currentSalonHoursState.routineBreaks.length}</span>
              </button>
            </div>
          </div>

          <!-- TAB 1: OPERATING HOURS VIEW -->
          <div id="salon-tab-content-shifts" style="display: ${currentTab === 'shifts' ? 'block' : 'none'};">
            <div style="display: flex; flex-direction: column; gap: 10px;">
              <!-- Bulk Hours Setter Card (Realtime Auto-apply across open days) -->
              <div class="stylist-bulk-setter-card" id="salon-bulk-setter-container">
                <div class="bulk-setter-row">
                  <div class="bulk-setter-info">
                    <span class="bulk-setter-title">
                      ${Icons.zap ? Icons.zap({ size: 13, color: '#fbbf24' }) : '⚡'}
                      <span>All-Day Default Hours</span>
                    </span>
                    <span class="bulk-setter-sub">Changes auto-apply live · Stylists inherit these hours by default</span>
                  </div>
                  <div class="bulk-time-inputs">
                    <div class="bulk-time-group">
                      <span class="bulk-time-label">Opening Time</span>
                      <div class="bulk-time-inp-wrap">
                        <input type="time" class="form-control bulk-time-inp" id="salon-bulk-start" value="${masterStart}" />
                        <span class="bulk-time-preview" id="salon-bulk-start-preview">${formatTime12h(masterStart)}</span>
                      </div>
                    </div>
                    <span class="bulk-time-sep">to</span>
                    <div class="bulk-time-group">
                      <span class="bulk-time-label">Closing Time</span>
                      <div class="bulk-time-inp-wrap">
                        <input type="time" class="form-control bulk-time-inp" id="salon-bulk-end" value="${masterEnd}" />
                        <span class="bulk-time-preview" id="salon-bulk-end-preview">${formatTime12h(masterEnd)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Individual Day Roster (Facility Operating Schedule) -->
              <div class="stylist-roster-card">
                <div class="stylist-roster-header">
                  <div class="stylist-roster-header-left">
                    ${Icons.calendar ? Icons.calendar({ size: 14, color: '#34d399' }) : '📅'}
                    <span class="stylist-roster-title">Weekly Schedule</span>
                  </div>
                  <span class="stylist-roster-count" id="salon-roster-active-days-count">${openDaysCount} of 7 Open Days</span>
                </div>
                <div id="salon-roster-rows-container">
                  ${this.renderSalonRosterRowsHtml()}
                </div>
              </div>
            </div>
          </div>

          <!-- TAB 2: FACILITY ROUTINE BREAKS VIEW -->
          <div id="salon-tab-content-breaks" style="display: ${currentTab === 'breaks' ? 'block' : 'none'};">
            <div class="stylist-breaks-container">
              <div class="stylist-breaks-header-row">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <h4 style="font-size: 0.88rem; font-weight: 800; color: #fff; margin: 0; display: flex; align-items: center; gap: 6px;">
                    ${Icons.coffee ? Icons.coffee({ size: 15, color: '#fbbf24' }) : '☕'}
                    <span>Routine Daily Breaks</span>
                  </h4>
                  <span class="breaks-count-chip" id="salon-breaks-header-count">${this.currentSalonHoursState.routineBreaks.length}</span>
                </div>
                <button type="button" class="btn-compact-add-break" id="btn-add-salon-routine-break">
                  ${Icons.plus ? Icons.plus({ size: 13, color: '#fff' }) : '➕'}
                  <span>Add Break</span>
                </button>
              </div>

              <div id="salon-routine-breaks-list" style="display: flex; flex-direction: column; gap: 8px;">
                ${this.renderSalonRoutineBreaksHtml()}
              </div>
            </div>
          </div>

          <!-- Operations Telemetry Metric Strip -->
          <div class="ops-telemetry-grid" style="margin-top: 10px;">
            <div class="ops-telemetry-item">
              <span class="ops-telemetry-label">Store Status</span>
              <span class="ops-telemetry-val" style="color: ${isClosedToday ? '#f87171' : '#34d399'};">
                ${isClosedToday ? '🔴 Closed Today' : '🟢 Live & Open'}
              </span>
            </div>
            <div class="ops-telemetry-item">
              <span class="ops-telemetry-label">Timezone</span>
              <span class="ops-telemetry-val">${this.summaryData?.timezone || 'Asia/Kolkata'}</span>
            </div>
            <div class="ops-telemetry-item">
              <span class="ops-telemetry-label">Stylists</span>
              <span class="ops-telemetry-val">${staffCount} Active Specialists</span>
            </div>
            <div class="ops-telemetry-item">
              <span class="ops-telemetry-label">Services</span>
              <span class="ops-telemetry-val">${servicesCount} Active Offerings</span>
            </div>
          </div>
        </div>
      `;
    } catch (err) {
      console.error('[Dashboard] Error in renderSalonHoursSection:', err);
      return `
        <div style="padding: 24px; color: #f87171; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 12px; margin: 16px;">
          <h4 style="margin: 0 0 8px 0; font-weight: 700;">Could not load Salon Opening Hours</h4>
          <p style="margin: 0 0 12px 0; font-size: 0.85rem; color: #cbd5e1;">${err.message}</p>
          <button type="button" class="btn btn-sm btn-primary" onclick="window.salonDashboard?.switchProfileSubtab('hours')">Retry</button>
        </div>
      `;
    }
  }

  renderSalonRosterRowsHtml() {
    if (!this.currentSalonHoursState?.days) return '';
    const daysArr = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
    const jsDay = new Date().getDay();
    const todayMap = { 1: 'MONDAY', 2: 'TUESDAY', 3: 'WEDNESDAY', 4: 'THURSDAY', 5: 'FRIDAY', 6: 'SATURDAY', 0: 'SUNDAY' };
    const todayKey = todayMap[jsDay];

    return daysArr.map((day) => {
      const d = this.currentSalonHoursState.days[day];
      if (!d) return '';
      const isOpen = Boolean(d.isOpen);
      const isToday = day === todayKey;

      return `
        <div class="stylist-roster-row ${!isOpen ? 'is-off' : ''}" data-day="${day}" title="Tap to customize ${d.friendlyDay} salon hours">
          <div class="stylist-roster-left">
            <span class="stylist-day-badge ${isOpen ? 'working' : 'off'}">${d.dayShort}</span>
            <div class="stylist-roster-timing-wrap">
              <span class="stylist-roster-clock-icon ${!isOpen ? 'is-off' : ''}">
                ${Icons.clock ? Icons.clock({ size: 12, color: isOpen ? '#34d399' : '#64748b' }) : ''}
              </span>
              <span class="stylist-roster-time ${!isOpen ? 'is-off' : ''}">
                ${isOpen ? `${formatTime12h(d.startTime)} – ${formatTime12h(d.endTime)}` : 'Store Closed all day'}
              </span>
              ${isToday ? `<span class="badge ${isOpen ? 'badge-completed' : 'badge-cancelled'}" style="font-size: 0.60rem; padding: 1px 6px; margin-left: 6px;">Today</span>` : ''}
            </div>
          </div>
          <div class="stylist-roster-right">
            <label class="roster-day-switch" title="Set ${d.friendlyDay} ${isOpen ? 'Closed' : 'Open'}">
              <input type="checkbox" class="salon-roster-switch-input" data-day="${day}" ${isOpen ? 'checked' : ''} />
              <span class="roster-switch-slider"></span>
            </label>
            <button type="button" class="stylist-roster-action-btn btn-open-salon-day-modal" data-day="${day}" title="Customize ${d.friendlyDay} Hours">
              ${Icons.edit ? Icons.edit({ size: 12, color: '#cbd5e1' }) : '✏️'}
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  renderSalonRoutineBreaksHtml() {
    const routineBreaks = this.currentSalonHoursState?.routineBreaks || [];
    if (routineBreaks.length === 0) {
      return `
        <div class="empty-routine-breaks">
          <div class="empty-breaks-icon">
            ${Icons.coffee ? Icons.coffee({ size: 20, color: '#fbbf24' }) : '☕'}
          </div>
          <div class="empty-breaks-text">
            <strong>No Routine Breaks Configured</strong>
            <span>All stylists observe normal operating hours without facility-wide pauses</span>
          </div>
          <button type="button" class="btn-compact-add-break" id="btn-empty-add-salon-break" style="margin-top: 6px;">
            + Add First Break
          </button>
        </div>
      `;
    }

    const daysKeys = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
    const daysLetters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

    return routineBreaks.map((b, idx) => {
      const activeDays = Array.isArray(b.days) ? b.days : [];

      return `
        <div class="routine-break-row-card" data-idx="${idx}" title="Tap to edit ${b.title || 'Facility Break'}">
          <div class="routine-break-card-top">
            <div class="routine-break-title-wrap">
              <div class="routine-break-icon-wrap">
                ${Icons.coffee ? Icons.coffee({ size: 13, color: '#fbbf24' }) : '☕'}
              </div>
              <span class="routine-break-row-title">${b.title || 'Facility Break'}</span>
            </div>
            <div class="routine-break-row-actions">
              <button type="button" class="btn-edit-routine-break btn-edit-salon-break" data-index="${idx}" title="Edit Break">
                ${Icons.edit ? Icons.edit({ size: 12, color: '#cbd5e1' }) : '✏️'}
              </button>
              <button type="button" class="btn-del-routine-break-direct btn-delete-salon-break" data-index="${idx}" title="Delete Break">
                ${Icons.trash ? Icons.trash({ size: 12, color: '#f87171' }) : '✕'}
              </button>
            </div>
          </div>
          <div class="routine-break-card-bottom">
            <div class="routine-break-time-badge">
              ${Icons.clock ? Icons.clock({ size: 10, color: '#a78bfa' }) : ''}
              <span class="break-time-text">${formatTime12h(b.startTime)}&nbsp;–&nbsp;${formatTime12h(b.endTime)}</span>
            </div>
            <div class="routine-break-days-matrix" title="Active on: ${activeDays.map((d) => d.slice(0, 3)).join(', ')}">
              ${daysLetters.map((letter, dayIdx) => {
        const dayKey = daysKeys[dayIdx];
        const isActive = activeDays.includes(dayKey);
        return `<span class="break-matrix-day ${isActive ? 'active' : ''}">${letter}</span>`;
      }).join('')}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  syncSalonRoutineBreaksToDays() {
    if (!this.currentSalonHoursState?.days) return;
    const daysArr = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
    const routineBreaks = this.currentSalonHoursState.routineBreaks || [];

    daysArr.forEach((dayKey) => {
      const d = this.currentSalonHoursState.days[dayKey];
      if (d) {
        const matchingBreaks = routineBreaks
          .filter((rb) => Array.isArray(rb.days) && rb.days.includes(dayKey))
          .map((rb) => ({
            id: rb.id,
            title: (rb.title || 'Facility Break').trim(),
            startTime: rb.startTime,
            endTime: rb.endTime,
          }));
        d.breaks = matchingBreaks;

        // Auto-harmonize day's operating hours with all active breaks
        matchingBreaks.forEach((b) => {
          if (b.startTime && b.endTime) {
            if (!d.startTime || b.startTime < d.startTime) {
              d.startTime = b.startTime;
            }
            if (!d.endTime || b.endTime > d.endTime) {
              d.endTime = b.endTime;
            }
          }
        });
      }
    });
  }

  autoSaveSalonSchedule(immediate = false) {
    if (!this.currentSalonHoursState) return;

    const statusBadge = document.getElementById('salon-schedule-autosave-status');
    if (statusBadge) {
      statusBadge.innerHTML = `<span class="autosave-dot saving"></span><span class="autosave-text">Saving...</span>`;
    }

    if (this._autoSaveSalonTimer) {
      clearTimeout(this._autoSaveSalonTimer);
      this._autoSaveSalonTimer = null;
    }

    const doSave = async () => {
      this.syncSalonRoutineBreaksToDays();
      const daysArr = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
      const hoursPayload = [];

      for (const day of daysArr) {
        const d = this.currentSalonHoursState?.days ? this.currentSalonHoursState.days[day] : null;
        const isOpen = d ? Boolean(d.isOpen) : true;
        let start = d?.startTime || '09:00';
        let end = d?.endTime || '21:00';

        const breaks = (d?.breaks || [])
          .map((b) => ({
            id: b.id,
            title: (b.title || 'Facility Break').trim(),
            startTime: b.startTime,
            endTime: b.endTime,
          }))
          .filter((b) => b.startTime && b.endTime && b.startTime < b.endTime);

        // Harmonize operating window with breaks so breaks are never dropped
        breaks.forEach((b) => {
          if (b.startTime < start) start = b.startTime;
          if (b.endTime > end) end = b.endTime;
        });

        if (d) {
          d.startTime = start;
          d.endTime = end;
        }

        hoursPayload.push({
          dayOfWeek: day,
          isClosed: !isOpen,
          startTime: start,
          endTime: end,
          breaks,
        });
      }

      try {
        const updated = await ApiClient.updateSalonWorkingHours(hoursPayload);
        if (Array.isArray(updated)) {
          this.salonWorkingHours = updated;
          this.salonBreaks = updated.flatMap((h) =>
            (h.breaks || []).map((b) => ({ ...b, dayOfWeek: h.dayOfWeek })),
          );
        }

        if (statusBadge) {
          statusBadge.innerHTML = `<span class="autosave-dot"></span><span class="autosave-text">Auto-saved</span>`;
        }
        if (updated?.affectedBookingsCount > 0) {
          this.showToast?.(updated.message || `${updated.affectedBookingsCount} booking(s) automatically sent reschedule request via WhatsApp.`, 'info');
        }
      } catch (err) {
        console.error('Failed to auto-save salon schedule:', err);
        if (statusBadge) {
          statusBadge.innerHTML = `<span class="autosave-dot error"></span><span class="autosave-text" title="${err.message || 'Error'}">⚠️ Save error</span>`;
        }
        this.showToast?.(`Salon schedule save error: ${err.message || 'Validation error'}`, 'warning');
      }
    };

    if (immediate) {
      return doSave();
    } else {
      this._autoSaveSalonTimer = setTimeout(doSave, 350);
    }
  }

  attachSalonHoursSubtabListeners() {
    const container = document.getElementById('salon-routine-card-container') || document;

    // 1. Tab Switching between Operating Hours & Facility Breaks
    const tabBtnShifts = container.querySelector('#salon-tab-btn-shifts');
    const tabBtnBreaks = container.querySelector('#salon-tab-btn-breaks');
    const tabContentShifts = container.querySelector('#salon-tab-content-shifts');
    const tabContentBreaks = container.querySelector('#salon-tab-content-breaks');

    if (tabBtnShifts && tabBtnBreaks) {
      tabBtnShifts.onclick = (e) => {
        e.preventDefault();
        if (this.currentSalonHoursState) this.currentSalonHoursState.activeSubTab = 'shifts';
        tabBtnShifts.classList.add('active');
        tabBtnBreaks.classList.remove('active');
        if (tabContentShifts) tabContentShifts.style.display = 'block';
        if (tabContentBreaks) tabContentBreaks.style.display = 'none';
      };

      tabBtnBreaks.onclick = (e) => {
        e.preventDefault();
        if (this.currentSalonHoursState) this.currentSalonHoursState.activeSubTab = 'breaks';
        tabBtnBreaks.classList.add('active');
        tabBtnShifts.classList.remove('active');
        if (tabContentShifts) tabContentShifts.style.display = 'none';
        if (tabContentBreaks) tabContentBreaks.style.display = 'block';
      };
    }

    // 2. Master Bulk Setter Live Auto-Apply across open days
    const bulkStartInp = container.querySelector('#salon-bulk-start');
    const bulkEndInp = container.querySelector('#salon-bulk-end');
    const bulkStartPrev = container.querySelector('#salon-bulk-start-preview');
    const bulkEndPrev = container.querySelector('#salon-bulk-end-preview');

    const handleBulkLiveChange = (immediate = false) => {
      const sVal = bulkStartInp?.value || '';
      const eVal = bulkEndInp?.value || '';

      if (!sVal || !eVal) return;
      if (bulkStartPrev) bulkStartPrev.textContent = formatTime12h(sVal);
      if (bulkEndPrev) bulkEndPrev.textContent = formatTime12h(eVal);

      if (sVal >= eVal) {
        if (immediate) {
          this.showToast?.(`Opening time (${formatTime12h(sVal)}) must be earlier than closing time (${formatTime12h(eVal)}).`, 'warning');
        }
        return;
      }

      const daysArr = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
      daysArr.forEach((dKey) => {
        if (this.currentSalonHoursState?.days[dKey] && this.currentSalonHoursState.days[dKey].isOpen) {
          this.currentSalonHoursState.days[dKey].startTime = sVal;
          this.currentSalonHoursState.days[dKey].endTime = eVal;
        }
      });

      if (this.currentSalonHoursState) {
        this.currentSalonHoursState.masterHours = { startTime: sVal, endTime: eVal };
      }

      this.syncSalonRoutineBreaksToDays();
      const rowsContainer = document.getElementById('salon-roster-rows-container');
      if (rowsContainer) {
        rowsContainer.innerHTML = this.renderSalonRosterRowsHtml();
        this.attachSalonRosterListeners();
      }
      this.autoSaveSalonSchedule(immediate);
    };

    bulkStartInp?.addEventListener('input', () => handleBulkLiveChange(false));
    bulkStartInp?.addEventListener('change', () => handleBulkLiveChange(true));
    bulkStartInp?.addEventListener('blur', () => handleBulkLiveChange(true));
    bulkEndInp?.addEventListener('input', () => handleBulkLiveChange(false));
    bulkEndInp?.addEventListener('change', () => handleBulkLiveChange(true));
    bulkEndInp?.addEventListener('blur', () => handleBulkLiveChange(true));

    // 3. Attach Roster Rows & Breaks Listeners
    this.attachSalonRosterListeners();
    this.attachSalonRoutineBreaksListeners();
  }

  attachSalonRosterListeners() {
    const rowsContainer = document.getElementById('salon-roster-rows-container');
    if (!rowsContainer) return;

    // 1. Instant Open/Closed Toggle Switch
    rowsContainer.querySelectorAll('.salon-roster-switch-input').forEach((toggle) => {
      toggle.onclick = (e) => {
        e.stopPropagation();
      };
      toggle.onchange = (e) => {
        e.stopPropagation();
        const day = toggle.getAttribute('data-day');
        if (!this.currentSalonHoursState?.days[day]) return;

        const isOpen = toggle.checked;
        this.currentSalonHoursState.days[day].isOpen = isOpen;

        if (isOpen && (!this.currentSalonHoursState.days[day].startTime || !this.currentSalonHoursState.days[day].endTime)) {
          this.currentSalonHoursState.days[day].startTime = this.currentSalonHoursState.masterHours?.startTime || '09:00';
          this.currentSalonHoursState.days[day].endTime = this.currentSalonHoursState.masterHours?.endTime || '21:00';
        }

        const daysArr = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
        const openDaysCount = daysArr.filter((d) => this.currentSalonHoursState.days[d]?.isOpen).length;
        const countBadge = document.getElementById('salon-roster-active-days-count');
        if (countBadge) countBadge.textContent = `${openDaysCount} of 7 Open Days`;

        rowsContainer.innerHTML = this.renderSalonRosterRowsHtml();
        this.attachSalonRosterListeners();
        this.autoSaveSalonSchedule(true);
      };
    });

    // 2. Click row to open customize modal
    rowsContainer.querySelectorAll('.stylist-roster-row').forEach((row) => {
      row.onclick = (e) => {
        if (e.target.closest('.roster-day-switch')) return;
        const day = row.getAttribute('data-day');
        this.openSalonDayModal(day);
      };
    });

    // 3. Edit button opens customize modal
    rowsContainer.querySelectorAll('.btn-open-salon-day-modal').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const day = btn.getAttribute('data-day');
        this.openSalonDayModal(day);
      };
    });
  }

  attachSalonRoutineBreaksListeners() {
    const container = document.getElementById('salon-tab-content-breaks');
    if (!container) return;

    // 1. Add break header trigger
    const addBtn = container.querySelector('#btn-add-salon-routine-break');
    if (addBtn) {
      addBtn.onclick = (e) => {
        e.preventDefault();
        this.openSalonFacilityBreakBottomSheet(-1);
      };
    }

    // 2. Empty state trigger
    const emptyAddBtn = container.querySelector('#btn-empty-add-salon-break');
    if (emptyAddBtn) {
      emptyAddBtn.onclick = (e) => {
        e.preventDefault();
        this.openSalonFacilityBreakBottomSheet(-1);
      };
    }

    // 3. Edit facility break (button or card click)
    container.querySelectorAll('.routine-break-row-card').forEach((card) => {
      card.onclick = (e) => {
        if (e.target.closest('.btn-delete-salon-break, .btn-del-routine-break-direct')) return;
        const idx = parseInt(card.getAttribute('data-idx'), 10);
        this.openSalonFacilityBreakBottomSheet(idx);
      };
    });

    container.querySelectorAll('.btn-edit-salon-break, .btn-edit-routine-break').forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-index') || btn.closest('.routine-break-row-card')?.getAttribute('data-idx'), 10);
        this.openSalonFacilityBreakBottomSheet(idx);
      };
    });

    // 4. Delete facility break
    container.querySelectorAll('.btn-delete-salon-break, .btn-del-routine-break-direct').forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute('data-index') || btn.closest('.routine-break-row-card')?.getAttribute('data-idx'), 10);
        if (this.currentSalonHoursState?.routineBreaks && this.currentSalonHoursState.routineBreaks[idx]) {
          const targetBreak = this.currentSalonHoursState.routineBreaks[idx];
          if (!confirm(`Delete facility break "${targetBreak.title}" across its active days?`)) return;

          try {
            await ApiClient.deleteSalonRoutineBreak({
              title: targetBreak.title,
              startTime: targetBreak.startTime,
              endTime: targetBreak.endTime,
              days: targetBreak.days,
            });

            this.currentSalonHoursState.routineBreaks.splice(idx, 1);
            this.syncSalonRoutineBreaksToDays();

            const rawBreaks = await ApiClient.getSalonBreaks(true);
            if (rawBreaks && typeof rawBreaks === 'object') {
              this.salonRoutineBreaks = Array.isArray(rawBreaks.routineBreaks) ? rawBreaks.routineBreaks : [];
              this.salonBreaksByDay = rawBreaks.byDay || {};
              this.salonBreaks = Object.entries(this.salonBreaksByDay).flatMap(([day, bList]) =>
                (bList || []).map((b) => ({ ...b, dayOfWeek: day }))
              );
              this.currentSalonHoursState.routineBreaks = this.salonRoutineBreaks.map((rb) => ({
                id: rb.breakIds?.[rb.days?.[0]] || `srb-${Math.random().toString(36).substr(2, 6)}`,
                title: rb.title || 'Lunch Break',
                startTime: rb.startTime,
                endTime: rb.endTime,
                days: rb.days || [],
                breakIds: rb.breakIds || {},
              }));
            }

            const listContainer = document.getElementById('salon-routine-breaks-list');
            if (listContainer) listContainer.innerHTML = this.renderSalonRoutineBreaksHtml();
            const chip = document.getElementById('salon-breaks-count');
            if (chip) chip.textContent = this.currentSalonHoursState.routineBreaks.length;
            const headerChip = document.getElementById('salon-breaks-header-count');
            if (headerChip) headerChip.textContent = this.currentSalonHoursState.routineBreaks.length;
            this.attachSalonRoutineBreaksListeners();
            this.showToast(`Deleted facility break "${targetBreak?.title || 'Break'}"`, 'success');
          } catch (err) {
            console.error('Failed to delete facility break:', err);
            this.showToast(err.message || 'Failed to delete facility break', 'error');
          }
        }
      };
    });
  }

  openSalonDayModal(dayKey) {
    if (!this.currentSalonHoursState?.days) return;
    const dayData = this.currentSalonHoursState.days[dayKey];
    if (!dayData) return;

    const modalContainer = document.getElementById('modal-container') || document.body;
    let isOpen = dayData.isOpen !== false;

    modalContainer.innerHTML = `
      <div class="modal-backdrop show" id="salon-day-modal-backdrop">
        <div class="modal-content wh-edit-modal">
          <div class="modal-header" style="border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 12px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <span class="wh-modal-day-badge" style="background: ${isOpen ? 'rgba(52, 211, 153, 0.2)' : 'rgba(239, 68, 68, 0.2)'}; color: ${isOpen ? '#34d399' : '#f87171'}; border-color: ${isOpen ? 'rgba(52, 211, 153, 0.4)' : 'rgba(239, 68, 68, 0.4)'};">${dayData.dayShort}</span>
              <div>
                <h3 style="margin: 0; font-size: 1.05rem; font-weight: 800; color: #fff;">${dayData.friendlyDay} Salon Hours</h3>
                <p style="margin: 2px 0 0 0; font-size: 0.72rem; color: #94a3b8;">Set master operating boundaries for the entire salon facility</p>
              </div>
            </div>
            <button class="close-btn" id="btn-close-salon-day-modal">&times;</button>
          </div>

          <div class="modal-body" style="padding: 16px 0; display: flex; flex-direction: column; gap: 14px;">
            <!-- Open / Closed Toggle -->
            <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 10px 14px;">
              <div>
                <strong style="color: #fff; font-size: 0.86rem; display: block;">Store Status</strong>
                <span style="font-size: 0.7rem; color: #94a3b8;" id="modal-salon-status-hint">${isOpen ? 'Salon is open for client appointments & bookings' : 'Store is closed all day'}</span>
              </div>
              <label class="switch-toggle" style="margin: 0;">
                <input type="checkbox" id="modal-chk-salon-open" ${isOpen ? 'checked' : ''} />
                <span class="switch-slider"></span>
              </label>
            </div>

            <!-- Operating Hours Time Inputs -->
            <div id="modal-salon-hours-wrap" style="display: ${isOpen ? 'block' : 'none'};">
              <label style="display: flex; align-items: center; gap: 6px; font-size: 0.76rem; font-weight: 700; color: #cbd5e1; margin-bottom: 8px;">
                ${Icons.clock ? Icons.clock({ size: 14, color: '#34d399' }) : '⏰'}
                <span>Operating Window</span>
              </label>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 0.7rem; color: #94a3b8; margin-bottom: 4px; display: block;">Opening Time</label>
                  <input type="time" class="form-control bulk-time-inp" id="modal-salon-start" value="${dayData.startTime}" />
                  <div id="modal-salon-start-preview" style="font-size: 0.7rem; color: #6ee7b7; margin-top: 3px; text-align: center; font-weight: 600;">
                    ${formatTime12h(dayData.startTime)}
                  </div>
                </div>
                <div class="form-group" style="margin: 0;">
                  <label style="font-size: 0.7rem; color: #94a3b8; margin-bottom: 4px; display: block;">Closing Time</label>
                  <input type="time" class="form-control bulk-time-inp" id="modal-salon-end" value="${dayData.endTime}" />
                  <div id="modal-salon-end-preview" style="font-size: 0.7rem; color: #6ee7b7; margin-top: 3px; text-align: center; font-weight: 600;">
                    ${formatTime12h(dayData.endTime)}
                  </div>
                </div>
              </div>

              <!-- Facility Breaks for this Day -->
              ${(() => {
        const routineBreaks = (this.currentSalonHoursState?.routineBreaks || []).filter((rb) => Array.isArray(rb.days) && rb.days.includes(dayKey));
        if (routineBreaks.length > 0) {
          return `
                    <div style="font-size: 0.72rem; color: #6ee7b7; background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.2); border-radius: 8px; padding: 8px 12px; margin-top: 10px;">
                      <div style="font-weight: 700; margin-bottom: 4px;">☕ Active Facility Breaks on ${dayData.friendlyDay}:</div>
                      <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                        ${routineBreaks.map((b) => `<span style="background: rgba(16, 185, 129, 0.2); border: 1px solid rgba(16, 185, 129, 0.4); border-radius: 4px; padding: 2px 7px; font-weight: 700; color: #fff; font-size: 0.68rem;">${b.title || 'Break'} (${formatTime12h(b.startTime)} - ${formatTime12h(b.endTime)})</span>`).join('')}
                      </div>
                    </div>
                  `;
        }
        return `
                  <div style="font-size: 0.7rem; color: #94a3b8; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 8px; padding: 8px 12px; margin-top: 10px;">
                    ☕ No facility breaks assigned for ${dayData.friendlyDay}. (Configure in Facility Breaks tab)
                  </div>
                `;
      })()}
            </div>

            <!-- Quick Option: Copy to All 7 Days -->
            <div style="background: rgba(16, 185, 129, 0.07); border: 1px dashed rgba(16, 185, 129, 0.3); border-radius: 8px; padding: 8px 12px; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
              <span style="font-size: 0.72rem; color: #a7f3d0;">Apply this operating window to all 7 days?</span>
              <button type="button" class="btn btn-secondary btn-sm" id="modal-btn-copy-salon-all" style="font-size: 0.68rem; height: 26px; padding: 0 10px; white-space: nowrap; font-weight: 700;">
                ⚡ Copy to All 7 Days
              </button>
            </div>
          </div>

          <div class="modal-footer" style="border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 12px; display: flex; justify-content: space-between;">
            <button type="button" class="btn btn-secondary" id="modal-btn-salon-cancel" style="font-size: 0.78rem;">Cancel</button>
            <button type="button" class="btn btn-primary" id="modal-btn-salon-save" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); font-size: 0.78rem; font-weight: 700; padding: 0 18px; border: none;">
              ✓ Update Salon Hours
            </button>
          </div>
        </div>
      </div>
    `;

    const modalBackdrop = modalContainer.querySelector('#salon-day-modal-backdrop');
    const closeModal = () => (modalContainer.innerHTML = '');

    modalContainer.querySelector('#btn-close-salon-day-modal')?.addEventListener('click', closeModal);
    modalContainer.querySelector('#modal-btn-salon-cancel')?.addEventListener('click', closeModal);
    modalBackdrop?.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) closeModal();
    });

    const chkOpen = modalContainer.querySelector('#modal-chk-salon-open');
    const hoursWrap = modalContainer.querySelector('#modal-salon-hours-wrap');
    const hint = modalContainer.querySelector('#modal-salon-status-hint');

    chkOpen?.addEventListener('change', () => {
      isOpen = chkOpen.checked;
      if (hoursWrap) hoursWrap.style.display = isOpen ? 'block' : 'none';
      if (hint) hint.textContent = isOpen ? 'Salon is open for client appointments & bookings' : 'Store is closed all day';
    });

    const startInp = modalContainer.querySelector('#modal-salon-start');
    const endInp = modalContainer.querySelector('#modal-salon-end');
    const startPrev = modalContainer.querySelector('#modal-salon-start-preview');
    const endPrev = modalContainer.querySelector('#modal-salon-end-preview');

    startInp?.addEventListener('input', () => {
      if (startPrev) startPrev.textContent = formatTime12h(startInp.value);
    });
    startInp?.addEventListener('change', () => {
      if (startPrev) startPrev.textContent = formatTime12h(startInp.value);
    });
    endInp?.addEventListener('input', () => {
      if (endPrev) endPrev.textContent = formatTime12h(endInp.value);
    });
    endInp?.addEventListener('change', () => {
      if (endPrev) endPrev.textContent = formatTime12h(endInp.value);
    });

    modalContainer.querySelector('#modal-btn-copy-salon-all')?.addEventListener('click', (e) => {
      e.preventDefault();
      const sVal = startInp?.value || dayData.startTime || '';
      const eVal = endInp?.value || dayData.endTime || '';
      if (isOpen && (!sVal || !eVal || sVal >= eVal)) {
        alert(`Opening time (${formatTime12h(sVal)}) must be earlier than closing time (${formatTime12h(eVal)}).`);
        return;
      }
      const daysArr = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
      daysArr.forEach((dKey) => {
        if (this.currentSalonHoursState.days[dKey]) {
          this.currentSalonHoursState.days[dKey].isOpen = isOpen;
          this.currentSalonHoursState.days[dKey].startTime = sVal;
          this.currentSalonHoursState.days[dKey].endTime = eVal;
        }
      });
      if (isOpen) {
        this.currentSalonHoursState.masterHours = { startTime: sVal, endTime: eVal };
      }
      closeModal();
      const rowsContainer = document.getElementById('salon-roster-rows-container');
      if (rowsContainer) {
        rowsContainer.innerHTML = this.renderSalonRosterRowsHtml();
        this.attachSalonRosterListeners();
      }
      this.autoSaveSalonSchedule(true);
      this.showToast(`Applied ${dayData.friendlyDay} hours to all 7 days (auto-saved)`, 'success');
    });

    modalContainer.querySelector('#modal-btn-salon-save')?.addEventListener('click', (e) => {
      e.preventDefault();
      const sVal = startInp?.value || dayData.startTime || '';
      const eVal = endInp?.value || dayData.endTime || '';
      if (isOpen) {
        if (!sVal || !eVal || sVal >= eVal) {
          alert(`Opening time (${formatTime12h(sVal)}) must be earlier than closing time (${formatTime12h(eVal)}).`);
          return;
        }
      }
      this.currentSalonHoursState.days[dayKey].isOpen = isOpen;
      this.currentSalonHoursState.days[dayKey].startTime = sVal;
      this.currentSalonHoursState.days[dayKey].endTime = eVal;

      closeModal();
      const rowsContainer = document.getElementById('salon-roster-rows-container');
      if (rowsContainer) {
        rowsContainer.innerHTML = this.renderSalonRosterRowsHtml();
        this.attachSalonRosterListeners();
      }
      this.autoSaveSalonSchedule(true);
      this.showToast(`${dayData.friendlyDay} salon hours updated (auto-saved)`, 'success');
    });
  }

  openSalonFacilityBreakBottomSheet(editIndex = -1) {
    if (!this.currentSalonHoursState) return;
    const isEditing = editIndex >= 0 && Array.isArray(this.currentSalonHoursState.routineBreaks) && Boolean(this.currentSalonHoursState.routineBreaks[editIndex]);
    const breakData = isEditing ? this.currentSalonHoursState.routineBreaks[editIndex] : null;

    const daysArr = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

    let currentTitle = breakData ? (breakData.title || 'Salon Lunch Break') : 'Salon Lunch Break';
    let currentStart = breakData ? (breakData.startTime || '13:00') : '13:00';
    let currentEnd = breakData ? (breakData.endTime || '14:00') : '14:00';
    let selectedDays = breakData && Array.isArray(breakData.days) ? [...breakData.days] : ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

    let sheetContainer = document.getElementById('salon-facility-break-sheet-modal');
    if (!sheetContainer) {
      sheetContainer = document.createElement('div');
      sheetContainer.id = 'salon-facility-break-sheet-modal';
      document.body.appendChild(sheetContainer);
    }

    sheetContainer.innerHTML = `
      <div class="routine-break-sheet-backdrop" id="salon-break-sheet-backdrop">
        <div class="routine-break-sheet-container" id="salon-break-sheet-container">
          <div class="sheet-drag-handle"></div>

          <div class="sheet-header">
            <div class="sheet-title-group">
              <div class="sheet-icon-badge" style="background: rgba(16, 185, 129, 0.15); color: #34d399;">
                ${Icons.coffee ? Icons.coffee({ size: 16, color: '#34d399' }) : '☕'}
              </div>
              <div>
                <h3 class="sheet-title">${isEditing ? 'Edit Facility Routine Break' : 'Add Salon Facility Break'}</h3>
                <p class="sheet-subtitle">All stylists automatically observe facility breaks</p>
              </div>
            </div>
            <button type="button" class="sheet-close-btn" id="btn-close-salon-break-sheet">&times;</button>
          </div>

          <div class="sheet-body">
            <!-- 1. Break Name & Quick Presets -->
            <div class="sheet-form-group">
              <label class="sheet-label">Facility Break Name</label>
              <input type="text" class="form-control sheet-inp" id="sheet-salon-break-title" value="${currentTitle}" placeholder="e.g. Salon Lunch Break" />
              
              <div class="sheet-presets-row">
                <button type="button" class="sheet-preset-chip" data-title="Salon Lunch Break" data-start="13:00" data-end="14:00">🍱 Lunch (1-2 PM)</button>
                <button type="button" class="sheet-preset-chip" data-title="Afternoon Tea Break" data-start="16:30" data-end="17:00">☕ Tea (4:30-5 PM)</button>
                <button type="button" class="sheet-preset-chip" data-title="Facility Rest & Sanitization" data-start="14:00" data-end="14:30">🧹 Sanitization (2-2:30 PM)</button>
                <button type="button" class="sheet-preset-chip" data-title="Morning Setup Break" data-start="11:30" data-end="12:00">🥐 Setup Break</button>
              </div>
            </div>

            <!-- 2. Time Window -->
            <div class="sheet-form-group">
              <label class="sheet-label">Break Time Window</label>
              <div class="sheet-time-grid">
                <div class="sheet-time-box">
                  <span class="sheet-time-box-label">Starts At</span>
                  <input type="time" class="form-control bulk-time-inp sheet-time-inp" id="sheet-salon-break-start" value="${currentStart}" />
                  <span class="sheet-time-preview" id="sheet-salon-break-start-preview">${formatTime12h(currentStart)}</span>
                </div>
                <span class="sheet-time-arrow">→</span>
                <div class="sheet-time-box">
                  <span class="sheet-time-box-label">Ends At</span>
                  <input type="time" class="form-control bulk-time-inp sheet-time-inp" id="sheet-salon-break-end" value="${currentEnd}" />
                  <span class="sheet-time-preview" id="sheet-salon-break-end-preview">${formatTime12h(currentEnd)}</span>
                </div>
              </div>
            </div>

            <!-- 3. Active Days Selector -->
            <div class="sheet-form-group">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <label class="sheet-label" style="margin: 0;">Repeat On Days</label>
                <div class="sheet-quick-days">
                  <button type="button" class="sheet-quick-day-btn" id="btn-salon-days-all">All Days</button>
                  <button type="button" class="sheet-quick-day-btn" id="btn-salon-days-weekdays">Mon–Fri</button>
                  <button type="button" class="sheet-quick-day-btn" id="btn-salon-days-sat">Mon–Sat</button>
                </div>
              </div>
              <div class="sheet-days-chips-grid">
                ${daysArr.map((dKey) => {
      const dShort = dKey.slice(0, 3);
      const isSelected = selectedDays.includes(dKey);
      return `
                    <button type="button" class="sheet-day-pill ${isSelected ? 'active' : ''}" data-day="${dKey}">
                      ${dShort}
                    </button>
                  `;
    }).join('')}
              </div>
            </div>
          </div>

          <div class="sheet-footer">
            ${isEditing ? `
              <button type="button" class="btn btn-secondary btn-delete-routine-break" id="btn-delete-this-salon-break" style="color: #f87171; border-color: rgba(248, 113, 113, 0.3);">
                ${Icons.trash ? Icons.trash({ size: 13, color: '#f87171' }) : '🗑️'}
                <span>Delete</span>
              </button>
            ` : '<div></div>'}
            <div style="display: flex; gap: 8px;">
              <button type="button" class="btn btn-secondary" id="btn-cancel-salon-break-sheet">Cancel</button>
              <button type="button" class="btn btn-primary" id="btn-save-salon-break-sheet" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); font-weight: 700; border: none;">
                ${isEditing ? 'Save Changes' : 'Add Facility Break'}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    const backdrop = sheetContainer.querySelector('#salon-break-sheet-backdrop');
    const closeSheet = () => {
      sheetContainer.innerHTML = '';
    };

    sheetContainer.querySelector('#btn-close-salon-break-sheet')?.addEventListener('click', closeSheet);
    sheetContainer.querySelector('#btn-cancel-salon-break-sheet')?.addEventListener('click', closeSheet);
    backdrop?.addEventListener('click', (e) => {
      if (e.target === backdrop) closeSheet();
    });

    const startInp = sheetContainer.querySelector('#sheet-salon-break-start');
    const endInp = sheetContainer.querySelector('#sheet-salon-break-end');
    const startPrev = sheetContainer.querySelector('#sheet-salon-break-start-preview');
    const endPrev = sheetContainer.querySelector('#sheet-salon-break-end-preview');
    const titleInp = sheetContainer.querySelector('#sheet-salon-break-title');

    startInp?.addEventListener('input', () => {
      if (startPrev) startPrev.textContent = formatTime12h(startInp.value);
    });
    endInp?.addEventListener('input', () => {
      if (endPrev) endPrev.textContent = formatTime12h(endInp.value);
    });

    // Preset buttons
    sheetContainer.querySelectorAll('.sheet-preset-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const pTitle = chip.getAttribute('data-title');
        const pStart = chip.getAttribute('data-start');
        const pEnd = chip.getAttribute('data-end');
        if (titleInp && pTitle) titleInp.value = pTitle;
        if (startInp && pStart) {
          startInp.value = pStart;
          if (startPrev) startPrev.textContent = formatTime12h(pStart);
        }
        if (endInp && pEnd) {
          endInp.value = pEnd;
          if (endPrev) endPrev.textContent = formatTime12h(pEnd);
        }
      });
    });

    // Quick Day Preset buttons
    const dayPills = sheetContainer.querySelectorAll('.sheet-day-pill');
    const updateActivePills = () => {
      dayPills.forEach((p) => {
        const d = p.getAttribute('data-day');
        p.classList.toggle('active', selectedDays.includes(d));
      });
    };

    sheetContainer.querySelector('#btn-salon-days-all')?.addEventListener('click', () => {
      selectedDays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
      updateActivePills();
    });
    sheetContainer.querySelector('#btn-salon-days-weekdays')?.addEventListener('click', () => {
      selectedDays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'];
      updateActivePills();
    });
    sheetContainer.querySelector('#btn-salon-days-sat')?.addEventListener('click', () => {
      selectedDays = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
      updateActivePills();
    });

    dayPills.forEach((pill) => {
      pill.addEventListener('click', () => {
        const d = pill.getAttribute('data-day');
        if (selectedDays.includes(d)) {
          selectedDays = selectedDays.filter((x) => x !== d);
        } else {
          selectedDays.push(d);
        }
        updateActivePills();
      });
    });

    // Delete existing facility break
    sheetContainer.querySelector('#btn-delete-this-salon-break')?.addEventListener('click', async () => {
      if (isEditing) {
        try {
          await ApiClient.deleteSalonRoutineBreak({
            title: breakData.title,
            startTime: breakData.startTime,
            endTime: breakData.endTime,
            days: breakData.days,
          });

          this.currentSalonHoursState.routineBreaks.splice(editIndex, 1);
          this.syncSalonRoutineBreaksToDays();

          const rawBreaks = await ApiClient.getSalonBreaks(true);
          if (rawBreaks && typeof rawBreaks === 'object') {
            this.salonRoutineBreaks = Array.isArray(rawBreaks.routineBreaks) ? rawBreaks.routineBreaks : [];
            this.salonBreaksByDay = rawBreaks.byDay || {};
            this.salonBreaks = Object.entries(this.salonBreaksByDay).flatMap(([day, bList]) =>
              (bList || []).map((b) => ({ ...b, dayOfWeek: day }))
            );
            this.currentSalonHoursState.routineBreaks = this.salonRoutineBreaks.map((rb) => ({
              id: rb.breakIds?.[rb.days?.[0]] || `srb-${Math.random().toString(36).substr(2, 6)}`,
              title: rb.title || 'Lunch Break',
              startTime: rb.startTime,
              endTime: rb.endTime,
              days: rb.days || [],
              breakIds: rb.breakIds || {},
            }));
          }

          const listContainer = document.getElementById('salon-routine-breaks-list');
          if (listContainer) listContainer.innerHTML = this.renderSalonRoutineBreaksHtml();
          const chip = document.getElementById('salon-breaks-count');
          if (chip) chip.textContent = this.currentSalonHoursState.routineBreaks.length;
          const headerChip = document.getElementById('salon-breaks-header-count');
          if (headerChip) headerChip.textContent = this.currentSalonHoursState.routineBreaks.length;
          this.attachSalonRoutineBreaksListeners();
          closeSheet();
          this.showToast('Facility break deleted', 'success');
        } catch (err) {
          console.error('Failed to delete facility break:', err);
          alert(err.message || 'Failed to delete facility break');
        }
      }
    });

    // Save facility break
    sheetContainer.querySelector('#btn-save-salon-break-sheet')?.addEventListener('click', async () => {
      const title = (titleInp?.value || 'Salon Lunch Break').trim();
      const sVal = startInp?.value || '';
      const eVal = endInp?.value || '';

      if (!sVal || !eVal) {
        alert('Please specify both break start and end times.');
        return;
      }
      if (sVal >= eVal) {
        alert(`Break start time (${formatTime12h(sVal)}) must be earlier than end time (${formatTime12h(eVal)}).`);
        return;
      }
      if (selectedDays.length === 0) {
        alert('Please select at least one day for this facility break.');
        return;
      }

      // Overlap Prevention: Check for collision against other routine facility breaks on any selected day
      const hasConflict = (this.currentSalonHoursState.routineBreaks || []).some((otherB, oIdx) => {
        if (isEditing && oIdx === editIndex) return false;
        const sharesDay = (otherB.days || []).some((d) => selectedDays.includes(d));
        if (!sharesDay) return false;
        return sVal < otherB.endTime && eVal > otherB.startTime;
      });

      if (hasConflict) {
        alert('This break time overlaps with an existing facility break on one of the selected days. Please adjust your break window.');
        return;
      }

      const saveBtn = sheetContainer.querySelector('#btn-save-salon-break-sheet');
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
      }

      try {
        if (isEditing) {
          await ApiClient.updateSalonRoutineBreak({
            title,
            startTime: sVal,
            endTime: eVal,
            days: selectedDays,
          });
        } else {
          await ApiClient.createSalonBreak({
            title,
            startTime: sVal,
            endTime: eVal,
            days: selectedDays,
          });
        }

        const rawBreaks = await ApiClient.getSalonBreaks(true);
        if (rawBreaks && typeof rawBreaks === 'object') {
          this.salonRoutineBreaks = Array.isArray(rawBreaks.routineBreaks) ? rawBreaks.routineBreaks : [];
          this.salonBreaksByDay = rawBreaks.byDay || {};
          this.salonBreaks = Object.entries(this.salonBreaksByDay).flatMap(([day, bList]) =>
            (bList || []).map((b) => ({ ...b, dayOfWeek: day }))
          );
          this.currentSalonHoursState.routineBreaks = this.salonRoutineBreaks.map((rb) => ({
            id: rb.breakIds?.[rb.days?.[0]] || `srb-${Math.random().toString(36).substr(2, 6)}`,
            title: rb.title || 'Lunch Break',
            startTime: rb.startTime,
            endTime: rb.endTime,
            days: rb.days || [],
            breakIds: rb.breakIds || {},
          }));
        }

        // Harmonize selected days with this facility break
        selectedDays.forEach((dKey) => {
          if (this.currentSalonHoursState?.days?.[dKey]) {
            const d = this.currentSalonHoursState.days[dKey];
            if (!d.isOpen) d.isOpen = true;
            if (sVal && (!d.startTime || sVal < d.startTime)) d.startTime = sVal;
            if (eVal && (!d.endTime || eVal > d.endTime)) d.endTime = eVal;
          }
        });

        this.syncSalonRoutineBreaksToDays();
        const listContainer = document.getElementById('salon-routine-breaks-list');
        if (listContainer) listContainer.innerHTML = this.renderSalonRoutineBreaksHtml();
        const chip = document.getElementById('salon-breaks-count');
        if (chip) chip.textContent = this.currentSalonHoursState.routineBreaks.length;
        const headerChip = document.getElementById('salon-breaks-header-count');
        if (headerChip) headerChip.textContent = this.currentSalonHoursState.routineBreaks.length;
        this.attachSalonRoutineBreaksListeners();
        closeSheet();
        this.showToast(`Facility break '${title}' ${isEditing ? 'updated' : 'added'} successfully`, 'success');
      } catch (err) {
        console.error('Failed to save facility break:', err);
        alert(err.message || 'Failed to save facility break');
        if (saveBtn) {
          saveBtn.disabled = false;
          saveBtn.textContent = isEditing ? 'Save Changes' : 'Add Facility Break';
        }
      }
    });
  }

  renderServicesTab() {
    try {
      const services = Array.isArray(this.servicesList) ? this.servicesList : [];

      return `
        <div class="glass-panel">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px;">
            <div>
              <h3 style="font-size: 1.25rem; display: flex; align-items: center; gap: 8px;">
                ${Icons.scissors({ size: 20, color: '#A855F7' })}
                <span>Service Menu & Pricing</span>
              </h3>
              <p style="color: var(--text-secondary); font-size: 0.85rem;">Manage prices, duration intervals, and client booking offerings.</p>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-secondary btn-sm" id="btn-manage-categories" style="gap: 6px;">
                <span>📂 Manage Categories</span>
              </button>
              <button class="btn btn-primary btn-sm" id="btn-add-service" style="gap: 6px;">
                ${Icons.plus({ size: 14 })}
                <span>Add New Service</span>
              </button>
            </div>
          </div>

          ${services.length === 0 ? `
            <div style="text-align: center; padding: 48px 20px; background: rgba(0,0,0,0.2); border-radius: var(--radius-md); border: 1px dashed var(--border-subtle);">
              <div style="margin-bottom: 14px;">
                ${Icons.scissors({ size: 44, color: '#64748b' })}
              </div>
              <h4 style="color: #fff; margin-bottom: 6px; font-weight: 700;">No Services Added Yet</h4>
              <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 16px;">Create your service offerings (e.g. Haircut, Shave, Facial) with prices and durations.</p>
              <button class="btn btn-primary btn-sm" id="btn-empty-add-service" style="gap: 6px;">
                ${Icons.plus({ size: 14 })}
                <span>Add First Service</span>
              </button>
            </div>
          ` : `
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 16px;">
              ${services.map((s) => {
        const count = (s.stylists && s.stylists.length) || s._count?.stylists || 0;
        const g = s.targetGender || 'UNISEX';
        const labelMap = { MALE: 'Men', FEMALE: 'Women', UNISEX: 'Unisex', KIDS: 'Kids' };
        const genderLabel = labelMap[g] || 'Unisex';

        return `
                  <div class="staff-card" style="display: flex; flex-direction: column; justify-content: space-between; padding: 18px;">
                    <div>
                      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
                        <div style="font-weight: 700; font-size: 1.1rem; color: #fff; line-height: 1.2;">${s.name || 'Service'}</div>
                        <div style="font-weight: 800; color: #fbbf24; font-size: 1.25rem; font-family: var(--font-heading);">₹${s.price || 0}</div>
                      </div>
                      <p style="font-size: 0.84rem; color: var(--text-secondary); margin-bottom: 12px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 36px;">
                        ${s.description || 'Standard salon treatment service.'}
                      </p>
                      
                      <!-- Subtle Metadata Bullet Row (Replaces Loud Pills) -->
                      <div class="meta-bullet-row" style="margin-bottom: 12px;">
                        <span>⏱ <strong>${s.durationMinutes || 30}</strong> mins</span>
                        <span class="meta-bullet-dot">•</span>
                        <span>${s.category || 'General'}</span>
                        <span class="meta-bullet-dot">•</span>
                        <span>${genderLabel}</span>
                      </div>

                      <div style="margin-bottom: 14px;">
                        ${count > 0
            ? `<span style="font-size: 0.78rem; font-weight: 600; color: #34d399; display: flex; align-items: center; gap: 6px;"><span class="status-dot status-dot-free" style="width: 7px; height: 7px;"></span>${count} Stylist${count > 1 ? 's' : ''} Assigned</span>`
            : `<span style="font-size: 0.78rem; font-weight: 600; color: #f87171; display: flex; align-items: center; gap: 6px;"><span class="status-dot status-dot-busy" style="width: 7px; height: 7px;"></span>⚠️ 0 Staff (Unbookable)</span>`}
                      </div>
                    </div>

                    <div style="display: flex; gap: 8px; border-top: 1px solid var(--border-subtle); padding-top: 12px; align-items: center;">
                      <button class="btn btn-secondary btn-sm btn-edit-service" data-id="${s.id}" data-name="${s.name || ''}" data-price="${s.price || 0}" data-duration="${s.durationMinutes || 30}" data-category="${s.category || ''}" data-desc="${s.description || ''}" style="flex: 1; gap: 6px; justify-content: center;">
                        ${Icons.edit({ size: 13 })}
                        <span>Edit</span>
                      </button>
                      <button class="btn btn-danger-outline btn-sm btn-delete-service" data-id="${s.id}" data-name="${s.name || ''}" style="padding: 6px 12px;" title="Delete Service">
                        ${Icons.trash({ size: 13 })}
                      </button>
                    </div>
                  </div>
                `;
      }).join('')}
            </div>
          `}
        </div>
      `;
    } catch (err) {
      return `
        <div class="glass-panel text-center" style="padding: 40px; color: var(--danger);">
          <h4>Error loading service menu</h4>
          <p style="color: var(--text-secondary); font-size: 0.85rem; margin-top: 8px;">${err.message}</p>
        </div>
      `;
    }
  }



  // =========================================================================
  // TAB 4: CUSTOMER MANAGEMENT & STRIKE HUB
  // =========================================================================
  renderCustomersTab() {
    const activeFilter = this.activeCustomerFilter || 'ALL';
    return `
      <div class="glass-panel" style="padding: 16px;">
        <div class="cust-panel-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
            <button class="btn-back-nav" id="btn-cust-back" title="Back to Live Queue Overview">
              ← Back
            </button>
            <div>
              <h3 style="font-size: 1.15rem; font-family: var(--font-heading); font-weight: 800; margin: 0 0 2px 0;">Customer CRM & Strike Hub</h3>
              <p class="settings-panel-subtitle" style="color: var(--text-secondary); font-size: 0.8rem; margin: 0;">Manage customer directory, penalty strikes (0–3), and visit history.</p>
            </div>
          </div>
          <div class="cust-search-wrap">
            <input type="text" class="form-control" id="customer-search-input" placeholder="Search customer by name or phone..." value="${this.searchQuery || ''}" />
          </div>
        </div>

        <!-- Strike Status Filter Segmented Control -->
        <div id="customer-strike-filters">
          <button class="cust-filter-btn ${activeFilter === 'ALL' ? 'active' : ''}" data-filter="ALL">
            <span class="cust-filter-text">All</span>
            <span class="cust-filter-count">0</span>
          </button>
          <button class="cust-filter-btn ${activeFilter === 'BLOCKED' ? 'active' : ''}" data-filter="BLOCKED">
            <span class="cust-filter-text">Blocked</span>
            <span class="cust-filter-count">0</span>
          </button>
          <button class="cust-filter-btn ${activeFilter === 'WARNING' ? 'active' : ''}" data-filter="WARNING">
            <span class="cust-filter-text">Warn</span>
            <span class="cust-filter-count">0</span>
          </button>
          <button class="cust-filter-btn ${activeFilter === 'CLEAN' ? 'active' : ''}" data-filter="CLEAN">
            <span class="cust-filter-text">Clean</span>
            <span class="cust-filter-count">0</span>
          </button>
        </div>

        <div id="customers-table-container">
          <div style="text-align: center; padding: 30px; color: var(--text-muted);">Loading customer records...</div>
        </div>
      </div>
    `;
  }

  renderStrikeBadge(c) {
    const strikes = c.yearlyNoShowCount || 0;
    if (c.isBookingBlocked || strikes >= 3) {
      return `<span class="strike-badge strike-blocked" title="Customer is blocked from booking new slots via WhatsApp due to 3 penalty no-shows">🔴 3/3 Blocked</span>`;
    }
    if (strikes === 2) {
      return `<span class="strike-badge strike-2" title="2 Penalty strikes incurred. 1 more no-show will block customer.">⚠️ 2/3 Strikes</span>`;
    }
    if (strikes === 1) {
      return `<span class="strike-badge strike-1" title="1 Penalty strike incurred.">⚡ 1/3 Strike</span>`;
    }
    return `<span class="strike-badge strike-0" title="Clean record. 0 Penalty strikes.">✓ 0/3 Clean</span>`;
  }

  async loadCustomersTable(searchTerm = this.searchQuery || '', filterCategory = this.activeCustomerFilter || 'ALL') {
    const tableContainer = document.getElementById('customers-table-container');
    if (!tableContainer) return;

    try {
      const res = await ApiClient.getCustomers(searchTerm);
      const allCustomers = Array.isArray(res) ? res : res.data || [];

      // Dynamically update actual user count badges on filter buttons
      const filterContainer = document.getElementById('customer-strike-filters');
      if (filterContainer) {
        const totalCount = allCustomers.length;
        const blockedCount = allCustomers.filter((c) => c.isBookingBlocked || (c.yearlyNoShowCount || 0) >= 3).length;
        const warningCount = allCustomers.filter((c) => !c.isBookingBlocked && (c.yearlyNoShowCount || 0) > 0 && (c.yearlyNoShowCount || 0) < 3).length;
        const cleanCount = allCustomers.filter((c) => !c.isBookingBlocked && (c.yearlyNoShowCount || 0) === 0).length;

        const countAll = filterContainer.querySelector('[data-filter="ALL"] .cust-filter-count');
        const countBlocked = filterContainer.querySelector('[data-filter="BLOCKED"] .cust-filter-count');
        const countWarning = filterContainer.querySelector('[data-filter="WARNING"] .cust-filter-count');
        const countClean = filterContainer.querySelector('[data-filter="CLEAN"] .cust-filter-count');

        if (countAll) countAll.textContent = totalCount;
        if (countBlocked) countBlocked.textContent = blockedCount;
        if (countWarning) countWarning.textContent = warningCount;
        if (countClean) countClean.textContent = cleanCount;
      }

      let customers = [...allCustomers];

      // Sort by Penalty Strike Priority:
      // 1. Blocked (3/3 strikes or isBookingBlocked = true) -> TOP
      // 2. 2 Strikes (2/3)
      // 3. 1 Strike (1/3)
      // 4. 0 Strikes (0/3 Clean)
      customers.sort((a, b) => {
        const scoreA = (a.isBookingBlocked || (a.yearlyNoShowCount || 0) >= 3) ? 99 : (a.yearlyNoShowCount || 0);
        const scoreB = (b.isBookingBlocked || (b.yearlyNoShowCount || 0) >= 3) ? 99 : (b.yearlyNoShowCount || 0);
        if (scoreB !== scoreA) {
          return scoreB - scoreA;
        }
        return (a.name || '').localeCompare(b.name || '');
      });

      // Filter by selected category chip
      if (filterCategory === 'BLOCKED') {
        customers = customers.filter((c) => c.isBookingBlocked || (c.yearlyNoShowCount || 0) >= 3);
      } else if (filterCategory === 'WARNING') {
        customers = customers.filter((c) => !c.isBookingBlocked && (c.yearlyNoShowCount || 0) > 0 && (c.yearlyNoShowCount || 0) < 3);
      } else if (filterCategory === 'CLEAN') {
        customers = customers.filter((c) => !c.isBookingBlocked && (c.yearlyNoShowCount || 0) === 0);
      }

      if (customers.length === 0) {
        tableContainer.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-muted);">No customer records found matching filter.</div>`;
        return;
      }

      tableContainer.innerHTML = `
        <!-- Desktop Compact Table Layout (Screens ≥ 768px) -->
        <div class="desktop-only" style="overflow-x: auto; width: 100%;">
          <table class="cust-table">
            <thead>
              <tr>
                <th style="min-width: 170px;">Customer & Contact</th>
                <th style="min-width: 95px;">Strikes</th>
                <th style="min-width: 70px;">Visits</th>
                <th style="min-width: 70px;">Spend</th>
                <th style="min-width: 85px;">Last Visit</th>
                <th style="text-align: right; min-width: 130px;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${customers.map((c) => {
        const isBlocked = c.isBookingBlocked || (c.yearlyNoShowCount || 0) >= 3;
        const hasStrikes = (c.yearlyNoShowCount || 0) > 0 || isBlocked;
        return `
                <tr class="clickable-customer-row" data-id="${c.id}" data-name="${c.name}">
                  <td>
                    <div style="display: flex; align-items: center; gap: 8px;">
                      <div class="customer-avatar">${(c.name || 'C').charAt(0).toUpperCase()}</div>
                      <div style="min-width: 0;">
                        <div style="font-weight: 700; color: #f8fafc; font-size: 0.84rem; line-height: 1.25; white-space: nowrap;">${c.name || 'Customer'}</div>
                        <div style="font-size: 0.72rem; color: #94a3b8; font-family: var(--font-mono, monospace); line-height: 1.2; white-space: nowrap;">${c.phone || 'No phone'}${c.email ? ` · ${c.email}` : ''}</div>
                      </div>
                    </div>
                  </td>
                  <td>${this.renderStrikeBadge(c)}</td>
                  <td><span class="cust-visit-pill">${c.totalVisits || 0} visits</span></td>
                  <td style="font-weight: 700; color: #34d399; font-size: 0.84rem;">₹${Number(c.totalSpend || 0).toLocaleString()}</td>
                  <td style="color: #94a3b8; font-size: 0.76rem;">${c.lastVisitAt ? new Date(c.lastVisitAt).toLocaleDateString() : 'New Client'}</td>
                  <td style="text-align: right;">
                    <div style="display: flex; gap: 5px; justify-content: flex-end; align-items: center; white-space: nowrap;">
                      <button class="btn btn-secondary btn-xs btn-view-customer-history" data-id="${c.id}" data-name="${c.name}" title="View client visit history">
                        ${Icons.history({ size: 12 })}
                        <span>History</span>
                      </button>
                      ${hasStrikes ? `
                        <button class="btn btn-success btn-xs btn-adjust-strikes" data-id="${c.id}" data-name="${c.name}" title="Adjust or reset penalty strikes">
                          ${Icons.sliders({ size: 12 })}
                          <span>Adjust</span>
                        </button>
                      ` : `
                        <button class="btn btn-outline-danger btn-xs btn-block-customer" data-id="${c.id}" data-name="${c.name}" title="Manually block customer from booking">
                          ${Icons.lock({ size: 12 })}
                          <span>Block</span>
                        </button>
                      `}
                    </div>
                  </td>
                </tr>
              `;
      }).join('')}
            </tbody>
          </table>
        </div>

        <!-- Mobile Ultra-Compact Card Grid Layout (Screens < 768px) -->
        <div class="mobile-only customer-cards-grid">
          ${customers.map((c) => {
        const isBlocked = c.isBookingBlocked || (c.yearlyNoShowCount || 0) >= 3;
        const hasStrikes = (c.yearlyNoShowCount || 0) > 0 || isBlocked;
        return `
              <div class="customer-card clickable-customer-card" data-id="${c.id}" data-name="${c.name}">
                <!-- Row 1: Identity & Strike Badge -->
                <div class="customer-card-row-top">
                  <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
                    <div class="customer-avatar">${(c.name || 'C').charAt(0).toUpperCase()}</div>
                    <div style="min-width: 0; flex: 1;">
                      <div style="font-weight: 700; color: #f8fafc; font-size: 0.86rem; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${c.name || 'Customer'}</div>
                      <div style="font-size: 0.73rem; color: #94a3b8; font-family: var(--font-mono, monospace); line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1px;">${c.phone || 'No phone'}</div>
                    </div>
                  </div>
                  <div style="flex-shrink: 0;">${this.renderStrikeBadge(c)}</div>
                </div>

                <!-- Row 2: Metrics Strip & Micro Actions -->
                <div class="customer-card-row-bottom">
                  <div class="customer-card-meta">
                    <span class="card-meta-pill">${c.totalVisits || 0} visits</span>
                    <span class="card-meta-dot">·</span>
                    <span class="card-meta-spend">₹${Number(c.totalSpend || 0).toLocaleString()}</span>
                    <span class="card-meta-dot">·</span>
                    <span class="card-meta-sub">${c.lastVisitAt ? new Date(c.lastVisitAt).toLocaleDateString() : 'New'}</span>
                  </div>

                  <div style="display: flex; gap: 6px; flex-shrink: 0;">
                    <button class="btn btn-secondary btn-micro btn-view-customer-history" data-id="${c.id}" data-name="${c.name}" title="View client visit history">
                      ${Icons.history({ size: 12 })}
                      <span>History</span>
                    </button>
                    ${hasStrikes ? `
                      <button class="btn btn-success btn-micro btn-adjust-strikes" data-id="${c.id}" data-name="${c.name}" title="Adjust penalty strikes">
                        ${Icons.sliders({ size: 12 })}
                        <span>Adjust</span>
                      </button>
                    ` : `
                      <button class="btn btn-outline-danger btn-micro btn-block-customer" data-id="${c.id}" data-name="${c.name}" title="Block customer">
                        ${Icons.lock({ size: 12 })}
                        <span>Block</span>
                      </button>
                    `}
                  </div>
                </div>
              </div>
            `;
      }).join('')}
        </div>
      `;

      this.currentCustomerList = customers;

      // Re-attach customer action button handlers
      this.attachCustomerTableListeners();
    } catch (err) {
      tableContainer.innerHTML = `<div style="color: var(--danger); padding: 20px;">${err.message}</div>`;
    }
  }

  attachCustomerTableListeners() {
    const container = document.getElementById('customers-table-container');
    if (!container) return;

    // Clickable Row / Card handler to open Customer Details modal
    container.querySelectorAll('.clickable-customer-row, .clickable-customer-card').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const id = el.getAttribute('data-id');
        const name = el.getAttribute('data-name');
        if (id) {
          this.showCustomerHistoryModal(id, name);
        }
      });
    });

    // View History Buttons
    container.querySelectorAll('.btn-view-customer-history').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const name = e.currentTarget.getAttribute('data-name');
        this.showCustomerHistoryModal(id, name);
      });
    });

    // Adjust / Reset Strikes Modal Opener
    container.querySelectorAll('.btn-adjust-strikes').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const customer = (this.currentCustomerList || []).find((c) => c.id === id) || { id, name: e.currentTarget.getAttribute('data-name') };
        this.showAdjustStrikesModal(customer);
      });
    });

    // Block Buttons
    container.querySelectorAll('.btn-block-customer').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const name = e.currentTarget.getAttribute('data-name');
        if (confirm(`Are you sure you want to block ${name} from booking new appointment slots?`)) {
          try {
            await ApiClient.updateCustomerStrikes(id, 3, true);
            alert(`🔒 ${name} has been blocked from booking.`);
            this.loadCustomersTable(this.searchQuery);
          } catch (err) {
            alert(`Error blocking customer: ${err.message}`);
          }
        }
      });
    });
  }


  // =========================================================================
  // =========================================================================
  // TAB 5: PROFILE & SETTINGS (SAAS MASTER-DETAIL ARCHITECTURE)
  // =========================================================================
  renderProfileTab() {
    const profile = this.salonProfile || {};
    const adminUser = this.currentUser || SalonAuth.getUser() || {};
    const adminName = adminUser.name || profile.name || 'Salon Owner';
    const salonName = profile.name || 'Salon Operations';
    const city = profile.city || (profile.address ? profile.address.split(',')[0].trim() : 'Indore');
    const initials = adminName.split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'SO';
    const todayClosure = this.getTodayClosure();
    const isClosedToday = !!todayClosure;
    const activeSub = this.activeProfileSubtab || 'account';
    const isDrilled = !!this.mobileSettingsDrilled;

    return `
      <div class="settings-container ${isDrilled ? 'settings-drilled-active' : ''}">
        <!-- Page Title Header -->
        <div class="settings-page-header ${isDrilled ? 'settings-page-header-drilled' : ''}">
          <h2 class="settings-page-title">Account & Salon Settings</h2>
          <p class="settings-page-subtitle">Manage personal login credentials, salon storefront, weekly hours, and security preferences.</p>
        </div>

        <div class="settings-layout ${isDrilled ? 'settings-drilled' : ''}" id="settings-layout-root">
          <!-- Left Navigation Sidebar -->
          <div class="settings-sidebar">
            <!-- Compact Profile Identity Badge -->
            <div class="settings-identity-card">
              <div class="settings-avatar-circle">${initials}</div>
              <div class="settings-identity-meta">
                <div class="settings-identity-top-row">
                  <h3 class="settings-identity-name">${adminName}</h3>
                  <span class="badge ${isClosedToday ? 'badge-cancelled' : 'badge-completed'} settings-identity-badge">
                    ${isClosedToday ? (todayClosure.closureType === 'HOLIDAY' ? '🌴 HOLIDAY' : '🚨 CLOSED') : (profile.status || 'ACTIVE')}
                  </span>
                </div>
                <div class="settings-identity-sub">${salonName} · ${city}</div>
              </div>
            </div>

            <!-- Group 1: ACCOUNT -->
            <div class="settings-nav-group">
              <div class="settings-nav-label">Account</div>
              <div class="settings-nav-list">
                <button type="button" class="settings-nav-row ${activeSub === 'account' ? 'active' : ''}" data-subtab="account">
                  <div class="settings-row-icon" style="background: rgba(139, 61, 255, 0.15); color: #A855F7;">
                    ${Icons.user({ size: 16 })}
                  </div>
                  <div class="settings-row-content">
                    <span class="settings-row-title">Personal Profile</span>
                    <span class="settings-row-desc">Owner credentials, salon name & address</span>
                  </div>
                  <span class="settings-row-chevron">${Icons.chevronRight({ size: 14 })}</span>
                </button>

                <button type="button" class="settings-nav-row ${activeSub === 'security' ? 'active' : ''}" data-subtab="security">
                  <div class="settings-row-icon" style="background: rgba(244, 63, 94, 0.15); color: #fb7185;">
                    ${Icons.lock({ size: 16 })}
                  </div>
                  <div class="settings-row-content">
                    <span class="settings-row-title">Password & Security</span>
                    <span class="settings-row-desc">Update password & active sessions</span>
                  </div>
                  <span class="settings-row-chevron">${Icons.chevronRight({ size: 14 })}</span>
                </button>
              </div>
            </div>

            <!-- Group 2: SALON TIMINGS & SCHEDULE -->
            <div class="settings-nav-group">
              <div class="settings-nav-label">Salon Timings & Schedule</div>
              <div class="settings-nav-list">
                <button type="button" class="settings-nav-row ${activeSub === 'hours' ? 'active' : ''}" data-subtab="hours">
                  <div class="settings-row-icon" style="background: rgba(16, 185, 129, 0.15); color: #34d399;">
                    ${Icons.calendar ? Icons.calendar({ size: 16 }) : '⏰'}
                  </div>
                  <div class="settings-row-content">
                    <span class="settings-row-title">Opening Hours & Breaks</span>
                    <span class="settings-row-desc">Direct daily opening & lunch timings</span>
                  </div>
                  <span class="settings-row-chevron">${Icons.chevronRight({ size: 14 })}</span>
                </button>

                <button type="button" class="settings-nav-row ${activeSub === 'closures' ? 'active' : ''}" data-subtab="closures">
                  <div class="settings-row-icon" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24;">
                    ${Icons.alertTriangle ? Icons.alertTriangle({ size: 16, color: '#fbbf24' }) : '🌴'}
                  </div>
                  <div class="settings-row-content">
                    <span class="settings-row-title">Holidays & Days Off</span>
                    <span class="settings-row-desc">Festivals, planned off-days & emergency closures</span>
                  </div>
                  <span class="settings-row-chevron">${Icons.chevronRight({ size: 14 })}</span>
                </button>
              </div>
            </div>

            <!-- Group 3: CLIENT BOOKING & SHARING -->
            <div class="settings-nav-group">
              <div class="settings-nav-label">Client Booking & Sharing</div>
              <div class="settings-nav-list">
                <button type="button" class="settings-nav-row ${activeSub === 'booking-qr' || activeSub === 'storefront' ? 'active' : ''}" data-subtab="booking-qr">
                  <div class="settings-row-icon" style="background: rgba(139, 61, 255, 0.15); color: #A855F7;">
                    ${Icons.qrCode ? Icons.qrCode({ size: 16 }) : Icons.link({ size: 16 })}
                  </div>
                  <div class="settings-row-content">
                    <span class="settings-row-title">Online Booking & QR</span>
                    <span class="settings-row-desc">Minimal inline QR badge + WhatsApp sharing + link</span>
                  </div>
                  <span class="settings-row-chevron">${Icons.chevronRight({ size: 14 })}</span>
                </button>
              </div>
            </div>

            <!-- Group 3: STORE USERS & CRM -->
            <div class="settings-nav-group">
              <div class="settings-nav-label">Store Users & CRM</div>
              <div class="settings-nav-list">
                <button type="button" class="settings-nav-row ${activeSub === 'customers' ? 'active' : ''}" data-subtab="customers">
                  <div class="settings-row-icon" style="background: rgba(139, 61, 255, 0.15); color: #A855F7;">
                    ${Icons.users({ size: 16 })}
                  </div>
                  <div class="settings-row-content">
                    <span class="settings-row-title">Store Users & Clients</span>
                    <span class="settings-row-desc">Customer CRM, penalty strikes (0–3) & blocking</span>
                  </div>
                  <span class="settings-row-chevron">${Icons.chevronRight({ size: 14 })}</span>
                </button>
              </div>
            </div>

            <!-- Group 4: CHANNELS & GROWTH -->
            <div class="settings-nav-group">
              <div class="settings-nav-label">Channels & Growth</div>
              <div class="settings-nav-list">
                <button type="button" class="settings-nav-row ${activeSub === 'whatsapp' ? 'active' : ''}" data-subtab="whatsapp">
                  <div class="settings-row-icon" style="background: rgba(37, 211, 102, 0.15); color: #25D366;">
                    ${Icons.whatsapp({ size: 16 })}
                  </div>
                  <div class="settings-row-content">
                    <span class="settings-row-title">WhatsApp & Growth</span>
                    <span class="settings-row-desc">Meta quota, audit logs & QR posters</span>
                  </div>
                  <span class="settings-row-chevron">${Icons.chevronRight({ size: 14 })}</span>
                </button>
              </div>
            </div>

            <!-- Group 5: SESSION & SIGN OUT -->
            <div class="settings-nav-group">
              <div class="settings-nav-list">
                <button type="button" class="settings-nav-row settings-nav-row--danger" id="card-feature-logout">
                  <div class="settings-row-icon" style="background: rgba(239, 68, 68, 0.15); color: #f87171;">
                    ${Icons.logOut ? Icons.logOut({ size: 16 }) : Icons.lock({ size: 16 })}
                  </div>
                  <div class="settings-row-content">
                    <span class="settings-row-title">Sign Out Store Session</span>
                    <span class="settings-row-desc">End your active authenticated session</span>
                  </div>
                  <span class="settings-row-chevron">${Icons.chevronRight({ size: 14 })}</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Right Content Canvas (Active Section Detail Panel) -->
          <div class="settings-main" id="settings-main-container">
            <!-- Mobile Back Button (Visible when drilled down on small screens) -->
            <div class="settings-mobile-header">
              <button type="button" class="settings-mobile-back-btn" id="btn-settings-mobile-back">
                ${Icons.chevronLeft({ size: 14 })}
                <span>Back to Settings</span>
              </button>
            </div>

            <!-- Subtab Content Render Target -->
            <div id="profile-subtab-container">
              ${this.renderProfileSubtabContent()}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderProfileSubtabContent() {
    const subtab = this.activeProfileSubtab || 'account';
    const profile = this.salonProfile || {};
    const adminUser = this.currentUser || SalonAuth.getUser() || {};
    const slug = profile.slug || 'the-grand-royal-barber-1';
    const bookingUrl = `${window.location.origin}/#book/${slug}`;
    const staffCount = (this.staffList || []).length;
    const servicesCount = (this.servicesList || []).length;
    const freeChatsLeft = this.summaryData?.whatsappQuota?.remaining !== undefined ? this.summaryData.whatsappQuota.remaining : 1000;
    const quotaReset = this.summaryData?.whatsappQuota?.resetsOn || '1st of next month';
    const todayClosure = this.getTodayClosure();
    const isClosedToday = !!todayClosure;

    // SECTION 1: PERSONAL ACCOUNT, SALON PROFILE & ADDRESS
    if (subtab === 'account') {
      const adminName = adminUser.name || profile.name || '';
      const adminEmail = adminUser.email || profile.email || '';
      const adminPhone = adminUser.phone || profile.phone || '';
      const currentSalonName = profile.name || 'Salon Operations';
      const currentCity = profile.city || (profile.address ? profile.address.split(',')[0].trim() : 'Indore');

      return `
        <div class="settings-panel-card">
          <div class="settings-panel-header" style="margin-bottom: 14px; padding-bottom: 12px;">
            <div class="settings-header-left">
              <div class="settings-header-icon" style="background: rgba(139, 61, 255, 0.15); color: #A855F7;">
                ${Icons.user({ size: 20 })}
              </div>
              <div>
                <h3 class="settings-panel-title">Personal Profile & Salon Identity</h3>
                <p class="settings-panel-subtitle">Manage login credentials, brand identity, and verified GPS store address.</p>
              </div>
            </div>
            <span class="badge badge-in_service" style="font-size: 0.68rem; padding: 3px 8px; border-radius: 6px;">
              👑 ${adminUser.role === 'SALON_OWNER' ? 'Salon Owner' : 'Salon Admin'}
            </span>
          </div>

          <div id="prof-profile-alert"></div>

          <form id="form-update-owner-profile" class="settings-panel-body" onsubmit="return false;" style="gap: 12px;">
            
            <!-- Section A: Salon Owner Account -->
            <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 12px; padding: 12px 14px;">
              <div style="font-size: 0.72rem; font-weight: 800; color: #a5b4fc; text-transform: uppercase; letter-spacing: 0.06em; display: flex; align-items: center; gap: 6px; margin-bottom: 10px;">
                ${Icons.user({ size: 13, color: '#A855F7' })}
                <span>Salon Owner Credentials</span>
              </div>

              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; margin-bottom: 10px;">
                <div class="form-group" style="margin-bottom: 0;">
                  <label class="form-label" for="prof-manager-name">Owner Full Name *</label>
                  <input type="text" class="form-control" id="prof-manager-name" value="${adminName.replace(/"/g, '&quot;')}" placeholder="e.g. Trilok Shivhare" required style="height: 38px;" />
                </div>

                <div class="form-group" style="margin-bottom: 0;">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <label class="form-label" for="prof-manager-phone" style="margin-bottom: 0;">Registered Phone</label>
                    <span style="font-size: 0.62rem; color: #34d399; font-weight: 700; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.25); padding: 1px 6px; border-radius: 4px;">
                      ✓ Verified Login
                    </span>
                  </div>
                  <input type="tel" class="form-control" id="prof-manager-phone" value="${adminPhone.replace(/"/g, '&quot;')}" readonly disabled style="cursor: not-allowed; opacity: 0.85; background: rgba(15, 23, 42, 0.5); border: 1px solid rgba(255, 255, 255, 0.08); color: #cbd5e1; height: 38px;" />
                </div>
              </div>

              <div class="form-group" style="margin-bottom: 0;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                  <label class="form-label" for="prof-manager-email" style="margin-bottom: 0;">Recovery Email *</label>
                  <span style="font-size: 0.64rem; color: #A855F7; font-weight: 600;">Used for password reset</span>
                </div>
                <input type="email" class="form-control" id="prof-manager-email" value="${adminEmail.replace(/"/g, '&quot;')}" placeholder="owner@gmail.com" required style="height: 38px;" />
              </div>
            </div>

            <!-- Section B: Salon Brand & Physical Store Location -->
            <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 12px; padding: 12px 14px;">
              <div style="font-size: 0.72rem; font-weight: 800; color: #34d399; text-transform: uppercase; letter-spacing: 0.06em; display: flex; align-items: center; gap: 6px; margin-bottom: 10px;">
                ${Icons.scissors({ size: 13, color: '#34d399' })}
                <span>Salon Brand & Store Location</span>
              </div>

              <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 10px; margin-bottom: 10px;">
                <div class="form-group" style="margin-bottom: 0;">
                  <label class="form-label" for="prof-salon-name">Salon Brand Name *</label>
                  <input type="text" class="form-control" id="prof-salon-name" value="${currentSalonName.replace(/"/g, '&quot;')}" placeholder="e.g. Developer Bazaar" required style="height: 38px;" />
                </div>

                <div class="form-group" style="margin-bottom: 0;">
                  <label class="form-label" for="prof-salon-city">City *</label>
                  <input type="text" class="form-control" id="prof-salon-city" value="${currentCity.replace(/"/g, '&quot;')}" placeholder="e.g. Indore" required style="height: 38px;" />
                </div>
              </div>

              <!-- Location & GPS Navigation Component Container -->
              <div class="form-group" style="margin-bottom: 0;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                  <label class="form-label" style="margin-bottom: 0; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.03em; color: #cbd5e1;">
                    GPS Navigation & Address Capture
                  </label>
                  <span style="font-size: 0.64rem; color: #34d399; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">
                    <span>✓</span> Client Turn-by-Turn
                  </span>
                </div>
                <div id="prof-location-picker-container"></div>
              </div>
            </div>

            <!-- Save Action Button -->
            <div style="margin-top: 4px;">
              <button type="submit" class="btn btn-primary" id="btn-save-profile" style="width: 100%; min-height: 42px; height: 42px; padding: 0 20px; font-weight: 700; font-size: 0.86rem; border-radius: 9px; background: linear-gradient(135deg, #8B3DFF 0%, #9D5CFF 100%); box-shadow: 0 4px 14px rgba(139, 61, 255, 0.35); display: flex; align-items: center; justify-content: center; gap: 8px;">
                ${Icons.check({ size: 16 })}
                <span>Save Profile & Salon Changes</span>
              </button>
            </div>
          </form>

          <!-- Minimal Security Footer (No Developer Jargon) -->
          <div style="margin-top: 12px; padding: 8px 12px; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 8px; display: flex; align-items: center; justify-content: space-between; font-size: 0.72rem; color: #94a3b8;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="color: #34d399;">🔒</span>
              <span>Authenticated Store Session</span>
            </div>
            <span style="color: #34d399; font-weight: 600;">✓ Verified Store Credentials</span>
          </div>
        </div>
      `;
    }

    // SECTION 2: CLIENT BOOKING & RECEPTION QR
    if (subtab === 'booking-qr' || subtab === 'storefront') {
      const cleanLocation = (() => {
        const raw = profile.address || profile.city || 'Indore, India';
        const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
        return [...new Set(parts)].join(', ');
      })();

      const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(bookingUrl)}`;
      const whatsappShareUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(`Book your appointment with ${profile.name || 'our salon'} online: ${bookingUrl}`)}`;

      return `
        <div class="settings-panel-card">
          <div class="settings-panel-header" style="margin-bottom: 12px; padding-bottom: 10px;">
            <div class="settings-header-left">
              <div class="settings-header-icon" style="background: rgba(139, 61, 255, 0.15); color: #A855F7;">
                ${Icons.qrCode ? Icons.qrCode({ size: 20 }) : Icons.link({ size: 20 })}
              </div>
              <div>
                <h3 class="settings-panel-title">Online Booking & Reception QR</h3>
                <p class="settings-panel-subtitle">Instant counter walk-in QR badge, direct booking link, and printable acrylic standee.</p>
              </div>
            </div>
            <span class="badge ${isClosedToday ? 'badge-cancelled' : 'badge-completed'}" style="font-size: 0.68rem; padding: 3px 8px; border-radius: 6px;">
              ${isClosedToday ? `🔴 Closed (${todayClosure.closureType})` : '🟢 Live & Accepting Appointments'}
            </span>
          </div>

          <div class="settings-panel-body" style="gap: 14px;">
            <!-- Reception Counter Walk-In QR Card -->
            <div class="settings-qr-counter-card">
              <div class="settings-qr-counter-header">
                <div class="settings-qr-counter-kicker">
                  ${Icons.qrCode ? Icons.qrCode({ size: 14, color: '#A855F7' }) : '📱'}
                  <span>Reception Counter Walk-In QR Badge</span>
                </div>
                <span class="settings-qr-counter-hint">⚡ 30-Second Fast Queue Entry</span>
              </div>

              <div class="settings-qr-counter-body">
                <div class="settings-qr-box">
                  <img class="settings-qr-img" src="${qrImgUrl}" alt="Customer Booking QR" />
                  <span class="settings-qr-scan-badge">SCAN TO BOOK</span>
                </div>

                <div class="settings-qr-details">
                  <div class="settings-qr-label">Direct Customer Booking Link</div>
                  <div class="settings-qr-url-row">
                    ${Icons.link({ size: 14, color: '#A855F7' })}
                    <span class="settings-qr-url-text">${bookingUrl}</span>
                    <button type="button" class="btn btn-secondary btn-sm" id="btn-copy-booking-qr" style="height: 32px; padding: 0 10px; font-size: 0.76rem; border-radius: 6px; flex-shrink: 0;">
                      ${Icons.copy({ size: 12 })}
                      <span>Copy</span>
                    </button>
                  </div>

                  <div class="settings-qr-actions-row">
                    <a href="${bookingUrl}" target="_blank" class="btn btn-secondary btn-sm" style="text-decoration: none; padding: 0 12px; font-size: 0.76rem; height: 36px; border-radius: 8px; background: rgba(139, 61, 255, 0.15); border-color: rgba(139, 61, 255, 0.35); color: #c7d2fe;">
                      ${Icons.externalLink({ size: 13 })}
                      <span>Open Page</span>
                    </a>
                    <a href="${whatsappShareUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="text-decoration: none; padding: 0 12px; font-size: 0.76rem; height: 36px; border-radius: 8px; color: #25D366; background: rgba(37, 211, 102, 0.1); border-color: rgba(37, 211, 102, 0.3);">
                      ${Icons.whatsapp ? Icons.whatsapp({ size: 13 }) : '💬'}
                      <span>WhatsApp Share</span>
                    </a>
                    <button type="button" class="btn btn-primary btn-sm" id="btn-download-standee" style="padding: 0 14px; font-size: 0.76rem; height: 36px; border-radius: 8px; font-weight: 700; background: linear-gradient(135deg, #8B3DFF 0%, #9D5CFF 100%);">
                      ${Icons.qrCode ? Icons.qrCode({ size: 13 }) : '🖨️'}
                      <span>Print Acrylic Standee</span>
                    </button>
                  </div>

                  <p class="settings-qr-footer-note">
                    💡 <strong>Reception Tip:</strong> Place your acrylic standee at the front counter or styling mirror so walk-in clients can scan and join the live chair queue in 30 seconds.
                  </p>
                </div>
              </div>
            </div>

            <!-- Live Storefront Details Card -->
            <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 12px; padding: 12px 14px;">
              <div style="font-size: 0.72rem; font-weight: 800; color: #34d399; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                <span>Verified Store Identity</span>
                <span style="font-size: 0.65rem; color: #94a3b8; font-weight: 500;">Public Profile</span>
              </div>

              <div class="settings-info-card" style="background: transparent; border: none; padding: 0;">
                <div class="settings-info-row" style="padding: 8px 0;">
                  <span class="settings-info-label">Salon Brand</span>
                  <span class="settings-info-value" style="color: #f8fafc; font-weight: 700;">${profile.name || 'Salon Command'}</span>
                </div>
                <div class="settings-info-row" style="padding: 8px 0;">
                  <span class="settings-info-label">Store Handle</span>
                  <span class="settings-info-value" style="font-family: monospace; color: #a5b4fc; font-weight: 600;">@${slug}</span>
                </div>
                <div class="settings-info-row" style="padding: 8px 0;">
                  <span class="settings-info-label">Store Location</span>
                  <span class="settings-info-value" style="color: #cbd5e1; max-width: 60%; text-align: right;">${cleanLocation}</span>
                </div>
                <div class="settings-info-row" style="padding: 8px 0;">
                  <span class="settings-info-label">Contact / WhatsApp</span>
                  <span class="settings-info-value" style="color: #cbd5e1;">${profile.phone || '+91'}</span>
                </div>
                <div class="settings-info-row" style="padding: 8px 0;">
                  <span class="settings-info-label">Storefront Status</span>
                  <span class="settings-info-value" style="color: ${isClosedToday ? '#f87171' : '#34d399'}; font-weight: 600;">
                    ${isClosedToday ? `🔴 Closed (${todayClosure.closureType})` : '🟢 Live & Accepting Appointments'}
                  </span>
                </div>
              </div>

              <!-- Quick Highlights -->
              <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255, 255, 255, 0.05); text-align: center;">
                <div style="background: rgba(255, 255, 255, 0.03); padding: 6px 4px; border-radius: 8px;">
                  <div style="font-size: 0.85rem; font-weight: 800; color: #fff;">${servicesCount}</div>
                  <div style="font-size: 0.62rem; color: #94a3b8; text-transform: uppercase;">Services</div>
                </div>
                <div style="background: rgba(255, 255, 255, 0.03); padding: 6px 4px; border-radius: 8px;">
                  <div style="font-size: 0.85rem; font-weight: 800; color: #fff;">${staffCount}</div>
                  <div style="font-size: 0.62rem; color: #94a3b8; text-transform: uppercase;">Stylists</div>
                </div>
                <div style="background: rgba(255, 255, 255, 0.03); padding: 6px 4px; border-radius: 8px;">
                  <div style="font-size: 0.85rem; font-weight: 800; color: #34d399;">30s</div>
                  <div style="font-size: 0.62rem; color: #94a3b8; text-transform: uppercase;">Fast Queue</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // SECTION 3: PASSWORD & SECURITY
    if (subtab === 'security') {
      return `
        <div class="settings-panel-card">
          <div class="settings-panel-header" style="margin-bottom: 12px; padding-bottom: 10px;">
            <div class="settings-header-left">
              <div class="settings-header-icon" style="background: rgba(244, 63, 94, 0.15); color: #fb7185;">
                ${Icons.lock({ size: 20 })}
              </div>
              <div>
                <h3 class="settings-panel-title">Password & Security</h3>
                <p class="settings-panel-subtitle">Update login credentials and manage active authenticated sessions.</p>
              </div>
            </div>
            <span class="badge badge-completed" style="font-size: 0.68rem; padding: 3px 8px; border-radius: 6px;">
              🛡️ Encrypted & Protected
            </span>
          </div>

          <div id="prof-pwd-alert"></div>

          <form id="form-change-password" class="settings-panel-body" onsubmit="return false;" style="gap: 12px;">
            <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 12px; padding: 12px 14px;">
              <div style="font-size: 0.72rem; font-weight: 800; color: #a5b4fc; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 6px; margin-bottom: 10px;">
                ${Icons.key ? Icons.key({ size: 13, color: '#A855F7' }) : Icons.lock({ size: 13, color: '#A855F7' })}
                <span>Change Account Password</span>
              </div>

              <div class="form-group" style="margin-bottom: 10px;">
                <label class="form-label" for="prof-current-password">Current Password *</label>
                <div class="pwd-field-wrap">
                  <input type="password" class="form-control" id="prof-current-password" placeholder="Enter existing password" required autocomplete="current-password" style="height: 38px;" />
                  <button type="button" class="pwd-toggle-btn" data-target="prof-current-password" title="Toggle visibility">
                    ${Icons.eye({ size: 15 })}
                  </button>
                </div>
              </div>

              <div class="form-group" style="margin-bottom: 10px;">
                <label class="form-label" for="prof-new-password">New Password *</label>
                <div class="pwd-field-wrap">
                  <input type="password" class="form-control" id="prof-new-password" placeholder="Create strong new password" required autocomplete="new-password" style="height: 38px;" />
                  <button type="button" class="pwd-toggle-btn" data-target="prof-new-password" title="Toggle visibility">
                    ${Icons.eye({ size: 15 })}
                  </button>
                </div>

                <div class="pwd-strength-container" style="margin-top: 6px;">
                  <div class="pwd-strength-bar">
                    <div class="pwd-strength-fill" id="prof-strength-fill"></div>
                  </div>
                  <div class="pwd-strength-text" style="font-size: 0.7rem; display: flex; justify-content: space-between; margin-top: 3px;">
                    <span id="prof-strength-label">Password strength: Empty</span>
                    <span style="color: #94a3b8;">Min 8 characters</span>
                  </div>
                  <!-- 3-Column Compact Password Requirements Checklist -->
                  <div class="pwd-req-list" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 6px; margin-top: 6px; font-size: 0.7rem;">
                    <div class="pwd-req-item" id="req-length"><span class="pwd-req-dot"></span> 8+ Chars</div>
                    <div class="pwd-req-item" id="req-mixed"><span class="pwd-req-dot"></span> Upper & Lower</div>
                    <div class="pwd-req-item" id="req-digit"><span class="pwd-req-dot"></span> Num / Symbol</div>
                  </div>
                </div>
              </div>

              <div class="form-group" style="margin-bottom: 4px;">
                <label class="form-label" for="prof-confirm-password">Confirm New Password *</label>
                <div class="pwd-field-wrap">
                  <input type="password" class="form-control" id="prof-confirm-password" placeholder="Re-type new password" required autocomplete="new-password" style="height: 38px;" />
                  <button type="button" class="pwd-toggle-btn" data-target="prof-confirm-password" title="Toggle visibility">
                    ${Icons.eye({ size: 15 })}
                  </button>
                </div>
              </div>
            </div>

            <!-- Full-Width Tactile Update Password Button -->
            <div style="margin-top: 2px;">
              <button type="submit" class="btn btn-primary" id="btn-submit-change-password" style="width: 100%; min-height: 42px; height: 42px; padding: 0 20px; font-weight: 700; font-size: 0.86rem; border-radius: 9px; background: linear-gradient(135deg, #8B3DFF 0%, #9D5CFF 100%); box-shadow: 0 4px 14px rgba(139, 61, 255, 0.35); display: flex; align-items: center; justify-content: center; gap: 8px;">
                ${Icons.shield({ size: 16 })}
                <span>Update Account Password</span>
              </button>
            </div>
          </form>

          <!-- Active Session & Device Controls (ZERO Developer Jargon!) -->
          <div style="background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 12px; padding: 12px 14px; margin-top: 12px;">
            <div style="font-size: 0.72rem; font-weight: 800; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.05em; display: flex; align-items: center; gap: 6px; margin-bottom: 8px;">
              ${Icons.shield({ size: 14, color: '#38bdf8' })}
              <span>Session & Device Security</span>
            </div>

            <div class="settings-info-card" style="background: transparent; border: none; padding: 0;">
              <div class="settings-info-row" style="padding: 7px 0;">
                <span class="settings-info-label">Active Browser Session</span>
                <span class="settings-info-value"><span class="badge badge-completed">🟢 Active & Encrypted</span></span>
              </div>
              <div class="settings-info-row" style="padding: 7px 0;">
                <span class="settings-info-label">Encryption Standard</span>
                <span class="settings-info-value" style="color: #cbd5e1;">TLS 1.3 / 256-Bit SSL</span>
              </div>
              <div class="settings-info-row" style="padding: 7px 0;">
                <span class="settings-info-label">Recovery Verification</span>
                <span class="settings-info-value" style="color: #cbd5e1;">Verified Email OTP</span>
              </div>
              <div class="settings-info-row" style="padding: 7px 0;">
                <span class="settings-info-label">Auto-Lock Protection</span>
                <span class="settings-info-value" style="color: #34d399;">✓ Protected & Monitored</span>
              </div>
            </div>

            <!-- Sign-Out Controls -->
            <div style="margin-top: 10px; padding: 12px; background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.2); border-radius: 10px; display: flex; flex-direction: column; gap: 8px;">
              <div>
                <h4 style="font-size: 0.8rem; font-weight: 700; color: #f87171; margin: 0 0 2px 0;">Sign-Out Controls</h4>
                <p style="font-size: 0.72rem; color: #94a3b8; margin: 0;">Logged in on a public or shared computer? Revoke access immediately across all other devices.</p>
              </div>

              <button type="button" class="btn btn-secondary btn-sm" id="btn-prof-logout-all" style="width: 100%; border-color: rgba(239, 68, 68, 0.35); background: rgba(239, 68, 68, 0.1); color: #fca5a5; min-height: 36px; height: 36px; font-size: 0.76rem; font-weight: 700; justify-content: center; border-radius: 8px;">
                ${Icons.refreshCw({ size: 13 })}
                <span>Log Out All Other Devices</span>
              </button>
            </div>
          </div>
        </div>
      `;
    }

    // SECTION 4A: SALON OPENING HOURS & BREAKS
    if (subtab === 'hours' || subtab === 'operations') {
      return this.renderSalonHoursSection();
    }

    // SECTION 4B: SALON HOLIDAYS & DAYS OFF (MODULAR VIEW)
    if (subtab === 'closures') {
      setTimeout(() => {
        const container = document.getElementById('profile-subtab-container');
        if (container && this.activeProfileSubtab === 'closures') {
          SalonDayOffView.mount(container, this);
        }
      }, 0);
      return `<div id="profile-subtab-container-loading" style="display:flex;align-items:center;justify-content:center;min-height:360px;color:#a5b4fc;"><div style="font-size:0.88rem;font-weight:600;">Loading live salon calendar...</div></div>`;
    }

    // SECTION 5: STORE USERS & CUSTOMER CRM
    if (subtab === 'customers') {
      const activeFilter = this.activeCustomerFilter || 'ALL';
      return `
        <div class="settings-panel-card">
          <div class="settings-panel-header cust-panel-header">
            <div class="settings-header-left">
              <div class="settings-header-icon" style="background: rgba(139, 61, 255, 0.15); color: #A855F7;">
                ${Icons.users({ size: 20 })}
              </div>
              <div>
                <h3 class="settings-panel-title">Store Users & Customer CRM</h3>
                <p class="settings-panel-subtitle">Manage customer directory, track penalty strikes (0–3), restrict no-show abusers, and review visit history.</p>
              </div>
            </div>
            <div class="cust-search-wrap">
              <input type="text" class="form-control" id="customer-search-input" placeholder="Search customer by name or phone..." value="${this.searchQuery || ''}" />
            </div>
          </div>

          <div class="settings-panel-body" style="gap: 8px;">
            <!-- Strike Status Filter Segmented Control (100% Fit, Zero-Scroll on Mobile) -->
            <div id="customer-strike-filters">
              <button class="cust-filter-btn ${activeFilter === 'ALL' ? 'active' : ''}" data-filter="ALL">
                <span class="cust-filter-text">All</span>
                <span class="cust-filter-count">0</span>
              </button>
              <button class="cust-filter-btn ${activeFilter === 'BLOCKED' ? 'active' : ''}" data-filter="BLOCKED">
                <span class="cust-filter-text">Blocked</span>
                <span class="cust-filter-count">0</span>
              </button>
              <button class="cust-filter-btn ${activeFilter === 'WARNING' ? 'active' : ''}" data-filter="WARNING">
                <span class="cust-filter-text">Warn</span>
                <span class="cust-filter-count">0</span>
              </button>
              <button class="cust-filter-btn ${activeFilter === 'CLEAN' ? 'active' : ''}" data-filter="CLEAN">
                <span class="cust-filter-text">Clean</span>
                <span class="cust-filter-count">0</span>
              </button>
            </div>

            <div id="customers-table-container">
              <div style="text-align: center; padding: 20px; color: var(--text-muted);">Loading customer records...</div>
            </div>
          </div>
        </div>
      `;
    }

    // SECTION 5: WHATSAPP & GROWTH
    if (subtab === 'whatsapp') {
      return `
        <div class="settings-panel-card">
          <div class="settings-panel-header">
            <div class="settings-header-left">
              <div class="settings-header-icon" style="background: rgba(37, 211, 102, 0.15); color: #25D366;">
                ${Icons.whatsapp({ size: 20 })}
              </div>
              <div>
                <h3 class="settings-panel-title">WhatsApp Cloud API & Growth Tools</h3>
                <p class="settings-panel-subtitle">Meta Cloud API service quota and customer conversation audit logs.</p>
              </div>
            </div>
          </div>

          <div class="settings-panel-body" style="gap: 10px;">
            <!-- Meta Quota Meter -->
            <div style="padding: 12px 14px; background: rgba(30, 41, 59, 0.45); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px;">
              <div>
                <div style="font-size: 0.72rem; color: #94a3b8; font-weight: 700; text-transform: uppercase;">Meta Free Service Quota</div>
                <div style="font-size: 1.25rem; font-weight: 800; color: #34d399; margin-top: 2px;">${freeChatsLeft} <span style="font-size: 0.76rem; color: #94a3b8;">/ 1000 left</span></div>
                <div style="font-size: 0.72rem; color: #64748b; margin-top: 1px;">Resets on ${quotaReset}</div>
              </div>
              <div>
                <div style="font-size: 0.72rem; color: #94a3b8; font-weight: 700; text-transform: uppercase;">Webhook Channel Status</div>
                <div style="font-size: 1rem; font-weight: 700; color: #38bdf8; margin-top: 3px;">🟢 Live & Connected</div>
                <div style="font-size: 0.72rem; color: #64748b; margin-top: 1px;">Meta Cloud API v21.0</div>
              </div>
            </div>

            <!-- Growth Tools Grid -->
            <div class="settings-tools-grid" style="margin-top: 6px;">
              <div class="settings-tool-tile" id="card-feature-whatsapp">
                <div class="settings-tile-icon" style="background: rgba(37, 211, 102, 0.12); color: #25D366; border: 1px solid rgba(37, 211, 102, 0.25);">
                  ${Icons.whatsapp({ size: 20 })}
                </div>
                <div class="settings-tile-content">
                  <div class="settings-tile-title">WhatsApp Bot & Audit Logs</div>
                  <div class="settings-tile-desc">Real-time PostgreSQL audit trail of incoming & outgoing customer conversations.</div>
                </div>
                <div class="settings-tile-arrow">${Icons.chevronRight({ size: 16 })}</div>
              </div>

              <div class="settings-tool-tile" id="card-feature-qr">
                <div class="settings-tile-icon" style="background: rgba(245, 158, 11, 0.12); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.25);">
                  ${Icons.qrCode({ size: 20 })}
                </div>
                <div class="settings-tile-content">
                  <div class="settings-tile-title">Mirror & Desk QR Posters</div>
                  <div class="settings-tile-desc">Print high-resolution QR poster templates for salon counter and mirrors.</div>
                </div>
                <div class="settings-tile-arrow">${Icons.chevronRight({ size: 16 })}</div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    return '';
  }

  /**
   * Centralized resolution of whether a given day of the week is a Weekly Off.
   * - In SALON mode or if staff is null: checks if the salon is closed on this weekday.
   * - In STAFF mode:
   *   1. If the salon is closed on this day, the staff is ALWAYS off (facility is closed).
   *   2. If staff follows salon schedule (default), the staff is open if the salon is open.
   *   3. If staff has a custom schedule, checks the staff's custom isWorking flag.
   */
  isDayWeeklyOff(dayOfWeekName, mode = 'SALON', staff = null) {
    const swh = (this.salonWorkingHours || []).find((h) => h.dayOfWeek?.toUpperCase() === dayOfWeekName?.toUpperCase());
    const salonIsClosed = swh ? Boolean(swh.isClosed || swh.isOff) : false;

    if (mode === 'SALON' || !staff) {
      return salonIsClosed;
    }

    // Facility invariant: if the salon is closed, it is closed for all specialists
    if (salonIsClosed) {
      return true;
    }

    // Specialist inherits salon open schedule
    if (staff.followsSalonSchedule !== false) {
      return false;
    }

    // Specialist has custom working hours
    if (Array.isArray(staff.workingHours) && staff.workingHours.length > 0) {
      const wh = staff.workingHours.find((h) => h.dayOfWeek?.toUpperCase() === dayOfWeekName?.toUpperCase());
      if (wh) {
        return wh.isClosed || wh.isOff || !wh.isWorking;
      }
    }

    return false;
  }

  renderHolidayCalendar() {
    this.selectedStaffId = null;
    setTimeout(() => {
      const container = document.getElementById('profile-subtab-container');
      if (container) {
        SalonDayOffView.mount(container, this);
      }
    }, 0);
    return `<div id="profile-subtab-container" style="display:flex;align-items:center;justify-content:center;min-height:360px;color:#a5b4fc;"><div style="font-size:0.88rem;font-weight:600;">Loading live salon calendar...</div></div>`;
  }

  async toggleStaffWeeklyOffDay(staffId, dayOfWeek) {
    const staff = (this.staffList || []).find((s) => s.id === staffId);
    if (!staff) {
      alert('Specialist not found. Please refresh and try again.');
      return;
    }

    const currentHours = Array.isArray(staff.workingHours) && staff.workingHours.length > 0
      ? staff.workingHours
      : (this.salonWorkingHours || []).map((h) => ({
        dayOfWeek: h.dayOfWeek,
        isWorking: !h.isClosed,
        startTime: h.startTime || '09:00',
        endTime: h.endTime || '20:00',
        breaks: h.breaks || [],
      }));

    const daysArr = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
    const friendlyName = dayOfWeek.charAt(0) + dayOfWeek.slice(1).toLowerCase();

    const salonWh = (this.salonWorkingHours || []).find((h) => h.dayOfWeek === dayOfWeek);
    const isSalonClosed = salonWh ? Boolean(salonWh.isClosed) : false;

    const currentMatch = currentHours.find((h) => h.dayOfWeek === dayOfWeek);
    const wasWorking = currentMatch ? (currentMatch.isWorking !== undefined ? currentMatch.isWorking : !currentMatch.isOff) : true;
    const targetWorking = !wasWorking;

    if (targetWorking && isSalonClosed) {
      this.showToast(`Cannot schedule shift on ${friendlyName}: Salon is closed on this day.`, 'warning');
      return;
    }

    const updatedHours = daysArr.map((day) => {
      const match = currentHours.find((h) => h.dayOfWeek === day);
      const wasW = match ? (match.isWorking !== undefined ? match.isWorking : !match.isOff) : true;
      const isNowWorking = day === dayOfWeek ? targetWorking : wasW;
      return {
        dayOfWeek: day,
        isWorking: isNowWorking,
        startTime: match?.startTime || '09:00',
        endTime: match?.endTime || '20:00',
        breaks: isNowWorking ? (match?.breaks || []) : [],
      };
    });

    const willBeWorking = updatedHours.find((h) => h.dayOfWeek === dayOfWeek)?.isWorking;

    try {
      this.showToast(`Updating routine for ${staff.name} on ${friendlyName}...`, 'info');
      await ApiClient.updateStaffWorkingHours(staffId, updatedHours, false);
      this.showToast(
        willBeWorking
          ? `${staff.name} is now working on ${friendlyName}.`
          : `${friendlyName} set as Weekly Off for ${staff.name}.`,
        'success'
      );
      await this.loadData(true);
      this.render();

    } catch (err) {
      alert(err.message || 'Failed to update specialist routine.');
    }
  }

  async toggleWeeklyOffDay(dayOfWeek) {
    if (!this.salonWorkingHours || !Array.isArray(this.salonWorkingHours)) {
      alert('Operating schedule not loaded. Please try again.');
      return;
    }

    const currentWh = this.salonWorkingHours.find((h) => h.dayOfWeek === dayOfWeek);
    const newIsClosed = currentWh ? !currentWh.isClosed : true;
    const friendlyName = dayOfWeek.charAt(0) + dayOfWeek.slice(1).toLowerCase();

    const updatedPayload = this.salonWorkingHours.map((h) => {
      if (h.dayOfWeek === dayOfWeek) {
        return {
          dayOfWeek: h.dayOfWeek,
          isClosed: newIsClosed,
          startTime: h.startTime || '09:00',
          endTime: h.endTime || '20:00',
          breaks: newIsClosed ? [] : (h.breaks || []).map((b) => ({
            id: b.id,
            startTime: b.startTime,
            endTime: b.endTime,
            title: b.title || 'Break',
          })),
        };
      }
      return {
        dayOfWeek: h.dayOfWeek,
        isClosed: Boolean(h.isClosed),
        startTime: h.startTime || '09:00',
        endTime: h.endTime || '20:00',
        breaks: h.isClosed ? [] : (h.breaks || []).map((b) => ({
          id: b.id,
          startTime: b.startTime,
          endTime: b.endTime,
          title: b.title || 'Break',
        })),
      };
    });

    try {
      this.showToast(`Updating routine for ${friendlyName}...`, 'info');
      await ApiClient.updateSalonWorkingHours(updatedPayload);
      this.showToast(
        newIsClosed
          ? `Salon closed every ${friendlyName} (Weekly Off set).`
          : `Salon now open every ${friendlyName}.`,
        'success'
      );
      await this.loadData(true);
      const container = document.getElementById('profile-subtab-container');
      if (container) {
        SalonDayOffView.mount(container, this);
      }
    } catch (err) {
      alert(err.message || 'Failed to update weekly routine.');
    }
  }

  async cancelSpecialistLeave(staffId, absenceId, staffName) {
    const displayName = staffName || 'this specialist';
    if (!confirm(`Cancel scheduled leave for ${displayName}?\n\nThey will be marked active and available for customer bookings immediately.`)) {
      return;
    }

    try {
      this.showToast(`Cancelling leave for ${displayName}...`, 'info');
      await ApiClient.cancelStaffAbsence(staffId, absenceId);
      this.showToast(`Leave cancelled. ${displayName} is now active!`, 'success');
      await this.loadData(true);
      this.render();

    } catch (err) {
      alert(err.message || 'Failed to cancel specialist leave.');
    }
  }

  showCalendarCategoryInspector(category, mode = 'SALON', staffId = null, staffName = 'Specialist') {
    const DIALOGS = {
      CLOSED: ClosureDialog,
      SALON_OFF: SalonWeeklyOffDialog,
      STAFF_OFF: StaffWeeklyOffDialog,
      STAFF_LEAVE: StaffLeaveDialog,
      FESTIVAL: FestivalDialog,
    };
    const DialogClass = DIALOGS[category];
    if (DialogClass) {
      const cal = new CalendarView({ app: this, calendarFor: mode, staffId, staffName });
      DialogClass.open({
        app: this,
        year: this.calYear,
        month: this.calMonth,
        closures: this.calendarSchedule?.salonSchedule?.closures || this.closuresList || [],
        weeklyHours: this.calendarSchedule?.salonSchedule?.weeklyHours || this.salonWorkingHours || [],
        staffList: this.calendarSchedule?.stylists || this.staffList || [],
        leaves: this.calendarSchedule?.leaves || [],
        festivals: cal.getFestivalsList(this.calYear, this.calMonth),
        isStaffMode: mode === 'STAFF',
        staffId,
        staffName,
        onRefresh: async () => {
          await this.loadData(true);
          this.render();
        },
      });
    }
  }

  showDateEventsModal(dateStr, mode = 'SALON', staffId = null, staffName = 'Specialist') {
    const cal = new CalendarView({ app: this, calendarFor: mode, staffId, staffName });
    DateEventsDialog.open({
      app: this,
      dateStr,
      mode,
      staffId,
      staffName,
      scheduleData: this.calendarSchedule,
      getFestivalForDate: (dt) => cal.getFestivalForDate(dt),
      onRefresh: async () => {
        await this.loadData(true);
        this.render();
      },
    });
  }

  updateCalInspector(dateStr, mode = 'SALON', staffId = null, staffName = '') {
    this.showDateEventsModal(dateStr, mode, staffId, staffName);
  }

  showDateScheduleDrawer(dateStr, existingClosure, existingAbsences = [], festivalInfo = null) {
    if (existingClosure) {
      this.confirmModal({
        title: 'Edit Salon Closure',
        message: `A closure is currently recorded for ${existingClosure.reason || 'Store Holiday'}. Would you like to remove this closure to reopen the salon?`,
        confirmText: 'Remove & Reopen',
        confirmClass: 'btn-danger',
        onConfirm: async () => {
          try {
            await ApiClient.deleteSalonClosure(existingClosure.id);
            this.showToast('Salon reopened successfully.', 'success');
            await this.loadData(true);
            this.render();
          } catch (e) {
            alert(e.message || 'Failed to remove closure.');
          }
        },
      });
      return;
    }

    ScheduleDayOffDialog.open({
      initialDate: dateStr,
      festivalInfo,
      salonWorkingHours: this.salonWorkingHours || [],
      existingClosures: this.closuresList || [],
      staffList: this.staffList || [],
      onSuccess: async () => {
        await this.loadData(true);
        const container = document.getElementById('profile-subtab-container');
        if (container) {
          if (this.activeProfileSubtab === 'closures') {
            SalonDayOffView.mount(container, this);
          } else {
            container.innerHTML = this.renderProfileSubtabContent();
            this.attachProfileSubtabListeners();
          }
        }
      },
    });
  }

  switchProfileSubtab(subtab) {
    this.activeProfileSubtab = subtab;
    this.mobileSettingsDrilled = true;

    // Update active row in navigation
    document.querySelectorAll('.settings-nav-row').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-subtab') === subtab);
    });

    const layoutRoot = document.getElementById('settings-layout-root');
    if (layoutRoot) {
      layoutRoot.classList.add('settings-drilled');
    }
    document.querySelector('.settings-container')?.classList.add('settings-drilled-active');
    document.querySelector('.settings-page-header')?.classList.add('settings-page-header-drilled');

    const container = document.getElementById('profile-subtab-container');
    if (container) {
      try {
        container.innerHTML = this.renderProfileSubtabContent();
      } catch (err) {
        console.error('[Dashboard] Error rendering profile subtab content:', err);
        container.innerHTML = `
          <div style="padding: 24px; color: #f87171; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: 12px; margin: 16px;">
            <h4 style="margin: 0 0 8px 0; font-weight: 700;">Error Loading Section</h4>
            <p style="margin: 0 0 12px 0; font-size: 0.85rem; color: #cbd5e1;">${err.message}</p>
            <button type="button" class="btn btn-sm btn-primary" onclick="window.salonDashboard?.switchProfileSubtab('${subtab}')">Retry</button>
          </div>
        `;
      }

      try {
        this.attachProfileSubtabListeners();
      } catch (err) {
        console.error('[Dashboard] Error attaching profile subtab listeners:', err);
      }

      // If switching to closures calendar, mount isolated SalonDayOffView
      if (subtab === 'closures') {
        const c = document.getElementById('profile-subtab-container');
        if (c) {
          SalonDayOffView.mount(c, this);
        }
      }
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  attachProfileSubtabListeners() {
    // 1. Navigation switcher (direct handler on every button)
    document.querySelectorAll('.settings-nav-row[data-subtab]').forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const sub = btn.getAttribute('data-subtab');
        if (sub) this.switchProfileSubtab(sub);
      };
    });

    // 2. Mobile Back button
    const backBtn = document.getElementById('btn-settings-mobile-back');
    if (backBtn) {
      backBtn.onclick = (e) => {
        e.preventDefault();
        this.mobileSettingsDrilled = false;
        const layoutRoot = document.getElementById('settings-layout-root');
        if (layoutRoot) {
          layoutRoot.classList.remove('settings-drilled');
        }
        document.querySelector('.settings-container')?.classList.remove('settings-drilled-active');
        document.querySelector('.settings-page-header')?.classList.remove('settings-page-header-drilled');
        window.scrollTo({ top: 0, behavior: 'smooth' });
      };
    }

    // 3. Subtab: Account Profile Form
    // Mount LocationPicker for Profile tab
    if (document.getElementById('prof-location-picker-container')) {
      const profile = this.salonProfile || {};
      this.profileLocationPicker = new LocationPicker('prof-location-picker-container', {
        hideHeader: true,
        hideCityInput: true,
        syncCityInputId: 'prof-salon-city',
        initialData: {
          address: profile.address || '',
          city: profile.city || '',
          state: profile.state || '',
          latitude: profile.latitude !== undefined ? profile.latitude : null,
          longitude: profile.longitude !== undefined ? profile.longitude : null,
          googleMapsUrl: profile.googleMapsUrl || '',
          locationType: profile.locationType || 'MANUAL',
        },
        getCity: () => document.getElementById('prof-salon-city')?.value?.trim() || profile.city || '',
        onChange: (locData) => {
          const cityEl = document.getElementById('prof-salon-city');
          if (cityEl && locData.city) {
            cityEl.value = locData.city;
          }
        },
      });

      // Synchronize city input with location search scope
      document.getElementById('prof-salon-city')?.addEventListener('input', () => {
        if (this.profileLocationPicker && this.profileLocationPicker.activeMode === 'search') {
          this.profileLocationPicker.render();
        }
      });
    }

    // 3. Subtab: Account Profile & Salon Form
    const formProfile = document.getElementById('form-update-owner-profile');
    if (formProfile) {
      formProfile.onsubmit = async (e) => {
        e.preventDefault();
        const ownerName = document.getElementById('prof-manager-name')?.value.trim();
        const ownerEmail = document.getElementById('prof-manager-email')?.value.trim();
        const salonName = document.getElementById('prof-salon-name')?.value.trim();
        const salonCity = document.getElementById('prof-salon-city')?.value.trim();
        const btnSave = document.getElementById('btn-save-profile');
        const alertBox = document.getElementById('prof-profile-alert');

        if (!ownerName || !ownerEmail) {
          if (alertBox) alertBox.innerHTML = `<div class="toast-error" style="padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; font-size: 0.85rem;">Owner Name and Recovery Email cannot be empty.</div>`;
          return;
        }

        if (!salonName) {
          if (alertBox) alertBox.innerHTML = `<div class="toast-error" style="padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; font-size: 0.85rem;">Salon Name cannot be empty.</div>`;
          return;
        }

        const locData = this.profileLocationPicker ? this.profileLocationPicker.getValue() : {};

        const originalBtnHtml = btnSave ? btnSave.innerHTML : '';
        if (btnSave) {
          btnSave.disabled = true;
          btnSave.innerHTML = `<span>Saving...</span>`;
        }

        try {
          // 1. Update personal owner profile (owner name, recovery email)
          const profileRes = await ApiClient.updateProfile({ name: ownerName, email: ownerEmail });
          if (profileRes?.admin) {
            this.currentUser = { ...this.currentUser, ...profileRes.admin };
          }

          // 2. Update salon details (name, address, city, state, coordinates, maps URL)
          const salonPayload = {
            name: salonName,
            address: locData.address || this.salonProfile?.address || '',
            city: salonCity || locData.city || this.salonProfile?.city || '',
            state: locData.state || this.salonProfile?.state || '',
            googleMapsUrl: locData.googleMapsUrl || this.salonProfile?.googleMapsUrl || undefined,
            locationType: locData.locationType || this.salonProfile?.locationType || 'MANUAL',
          };
          if (typeof locData.latitude === 'number' && !isNaN(locData.latitude)) {
            salonPayload.latitude = locData.latitude;
          }
          if (typeof locData.longitude === 'number' && !isNaN(locData.longitude)) {
            salonPayload.longitude = locData.longitude;
          }

          const updatedSalon = await ApiClient.updateSalonProfile(salonPayload);
          if (updatedSalon) {
            this.salonProfile = { ...this.salonProfile, ...salonPayload };
          }

          // 3. Update UI elements across header and identity card
          document.querySelectorAll('.header-salon-name').forEach((el) => {
            el.textContent = salonName;
          });
          document.querySelectorAll('.settings-identity-name').forEach((el) => {
            el.textContent = ownerName;
          });
          document.querySelectorAll('.settings-identity-sub').forEach((el) => {
            el.textContent = `${salonName} · ${salonPayload.city || 'Indore'}`;
          });

          if (alertBox) {
            alertBox.innerHTML = `<div style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); color: #34d399; padding: 12px 16px; border-radius: 8px; margin-bottom: 14px; font-size: 0.88rem; display: flex; align-items: center; gap: 8px;"><span>✓</span><span>Owner profile, salon brand name, and verified location updated successfully!</span></div>`;
          }
          this.showToast('Profile and salon changes saved successfully!', 'success');
        } catch (err) {
          if (alertBox) {
            alertBox.innerHTML = `<div style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; padding: 12px 16px; border-radius: 8px; margin-bottom: 14px; font-size: 0.88rem;">${err.message || 'Failed to update profile.'}</div>`;
          }
        } finally {
          if (btnSave) {
            btnSave.disabled = false;
            btnSave.innerHTML = originalBtnHtml;
          }
        }
      };
    }

    // 4. Subtab: Client Booking & QR Link
    const copyLinkHandler = () => {
      const slug = this.salonProfile?.slug || 'the-grand-royal-barber-1';
      const url = `${window.location.origin}/#book/${slug}`;
      navigator.clipboard.writeText(url);
      this.showToast('Booking link copied to clipboard!', 'success');
    };
    document.getElementById('btn-copy-invite')?.addEventListener('click', copyLinkHandler);
    document.getElementById('btn-copy-invite-subtab')?.addEventListener('click', copyLinkHandler);
    document.getElementById('btn-copy-booking-qr')?.addEventListener('click', copyLinkHandler);
    document.getElementById('btn-download-standee')?.addEventListener('click', () => {
      this.showStandeePrintModal();
    });
    document.getElementById('btn-open-qr')?.addEventListener('click', () => {
      this.showQRCodeModal();
    });

    // 4b. Subtab: Hours & Closures listeners
    if (this.activeProfileSubtab === 'hours' || this.activeProfileSubtab === 'operations') {
      this.attachSalonHoursSubtabListeners();
    }
    document.getElementById('btn-edit-hours-schedule')?.addEventListener('click', () => {
      this.showSalonScheduleModal();
    });



    // 5. Subtab: Security Form (Password change & Live strength meter)
    const formPwd = document.getElementById('form-change-password');
    if (formPwd) {
      // Toggle eye buttons
      formPwd.querySelectorAll('.pwd-toggle-btn').forEach((btn) => {
        btn.onclick = () => {
          const targetId = btn.getAttribute('data-target');
          const input = document.getElementById(targetId);
          if (input) {
            const isPassword = input.type === 'password';
            input.type = isPassword ? 'text' : 'password';
            btn.innerHTML = isPassword ? Icons.eyeOff({ size: 16 }) : Icons.eye({ size: 16 });
          }
        };
      });

      // Password strength live evaluator
      const newPwdInput = document.getElementById('prof-new-password');
      const fillBar = document.getElementById('prof-strength-fill');
      const label = document.getElementById('prof-strength-label');
      const reqLen = document.getElementById('req-length');
      const reqMix = document.getElementById('req-mixed');
      const reqDigit = document.getElementById('req-digit');

      newPwdInput?.addEventListener('input', () => {
        const val = newPwdInput.value;
        const hasLen = val.length >= 8;
        const hasMix = /[a-z]/.test(val) && /[A-Z]/.test(val);
        const hasDigit = /[0-9]/.test(val) || /[^a-zA-Z0-9]/.test(val);

        reqLen?.classList.toggle('met', hasLen);
        reqMix?.classList.toggle('met', hasMix);
        reqDigit?.classList.toggle('met', hasDigit);

        let score = 0;
        if (hasLen) score += 35;
        if (hasMix) score += 35;
        if (hasDigit) score += 30;

        if (fillBar) fillBar.style.width = `${val ? Math.max(score, 10) : 0}%`;

        if (!val) {
          if (label) label.textContent = 'Password strength: Empty';
          if (fillBar) fillBar.style.backgroundColor = 'transparent';
        } else if (score < 40) {
          if (label) label.textContent = 'Password strength: Weak';
          if (fillBar) fillBar.style.backgroundColor = '#fb7185';
        } else if (score < 80) {
          if (label) label.textContent = 'Password strength: Moderate';
          if (fillBar) fillBar.style.backgroundColor = '#fbbf24';
        } else {
          if (label) label.textContent = 'Password strength: Strong';
          if (fillBar) fillBar.style.backgroundColor = '#34d399';
        }
      });

      // Submit password change
      formPwd.onsubmit = async (e) => {
        e.preventDefault();
        const currentPassword = document.getElementById('prof-current-password')?.value;
        const newPassword = document.getElementById('prof-new-password')?.value;
        const confirmPassword = document.getElementById('prof-confirm-password')?.value;
        const alertBox = document.getElementById('prof-pwd-alert');
        const submitBtn = document.getElementById('btn-submit-change-password');

        if (!currentPassword || !newPassword) {
          if (alertBox) alertBox.innerHTML = `<div style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; font-size: 0.85rem;">Please fill in all password fields.</div>`;
          return;
        }

        if (newPassword.length < 8) {
          if (alertBox) alertBox.innerHTML = `<div style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; font-size: 0.85rem;">New password must be at least 8 characters long.</div>`;
          return;
        }

        if (newPassword !== confirmPassword) {
          if (alertBox) alertBox.innerHTML = `<div style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; font-size: 0.85rem;">New passwords do not match. Please verify.</div>`;
          return;
        }

        const originalBtnHtml = submitBtn ? submitBtn.innerHTML : '';
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = `<span>Updating Password...</span>`;
        }

        try {
          const res = await ApiClient.changePassword(currentPassword, newPassword);
          if (alertBox) {
            alertBox.innerHTML = `<div style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); color: #34d399; padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; font-size: 0.85rem;">${res.message || 'Password changed successfully!'}</div>`;
          }
          this.showToast('Password updated successfully!', 'success');
          formPwd.reset();
          if (fillBar) fillBar.style.width = '0%';
          if (label) label.textContent = 'Password strength: Empty';
          reqLen?.classList.remove('met');
          reqMix?.classList.remove('met');
          reqDigit?.classList.remove('met');
        } catch (err) {
          if (alertBox) {
            alertBox.innerHTML = `<div style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; font-size: 0.85rem;">${err.message || 'Failed to update password.'}</div>`;
          }
        } finally {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnHtml;
          }
        }
      };

      // Logout All Devices listener
      document.getElementById('btn-prof-logout-all')?.addEventListener('click', async () => {
        if (!confirm('Are you sure you want to log out from all other devices?')) return;
        try {
          await ApiClient.logoutAllDevices();
          this.showToast('Logged out from other devices.', 'info');
          window.location.hash = '#login';
          window.location.reload();
        } catch (err) {
          this.showToast(err.message || 'Logout failed.', 'error');
        }
      });
    }

    // 6. Common / Shared Tool Card listeners
    document.getElementById('card-feature-salon-schedule')?.addEventListener('click', () => {
      this.showSalonScheduleModal();
    });
    document.getElementById('card-feature-closures')?.addEventListener('click', () => {
      this.switchProfileSubtab('closures');
    });
    document.getElementById('card-feature-shifts')?.addEventListener('click', () => {
      this.switchTab('staff');
    });
    document.getElementById('card-feature-crm')?.addEventListener('click', () => {
      this.switchProfileSubtab('customers');
    });
    document.getElementById('card-feature-whatsapp')?.addEventListener('click', () => {
      this.switchTab('whatsapp-logs');
    });
    document.getElementById('card-feature-qr')?.addEventListener('click', () => {
      this.showQRCodeModal();
    });
    document.getElementById('card-feature-logout')?.addEventListener('click', async () => {
      await ApiClient.logout();
      window.location.hash = '#login';
      window.location.reload();
    });

    // 7. Subtab: Store Users & Customer CRM Table Initialization
    if (this.activeProfileSubtab === 'customers') {
      this.loadCustomersTable(this.searchQuery || '', this.activeCustomerFilter || 'ALL');

      const searchInput = document.getElementById('customer-search-input');
      if (searchInput) {
        searchInput.oninput = (e) => {
          clearTimeout(this.customerSearchDebounce);
          const val = e.target.value.trim();
          this.searchQuery = val;
          this.customerSearchDebounce = setTimeout(() => {
            this.loadCustomersTable(val, this.activeCustomerFilter || 'ALL');
          }, 300);
        };
      }

      document.querySelectorAll('#customer-strike-filters .cust-filter-btn').forEach((btn) => {
        btn.onclick = () => {
          const filter = btn.getAttribute('data-filter') || 'ALL';
          this.activeCustomerFilter = filter;
          document.querySelectorAll('#customer-strike-filters .cust-filter-btn').forEach((b) => b.classList.remove('active'));
          btn.classList.add('active');
          this.loadCustomersTable(this.searchQuery || '', filter);
        };
      });
    }
  }

  // =========================================================================
  // TAB 5: WHATSAPP DATABASE LOGS
  // =========================================================================
  renderWhatsAppLogsTab() {
    return `
      <div class="glass-panel">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px;">
          <div>
            <h3 style="font-size: 1.25rem;">Live WhatsApp Database Logs</h3>
            <p style="color: var(--text-secondary); font-size: 0.85rem;">Direct audit trail from PostgreSQL <code>whatsapp_logs</code> table.</p>
          </div>
          <div style="display: flex; gap: 10px;">
            <input type="text" class="form-control" id="whatsapp-log-phone-filter" placeholder="Filter by phone (e.g. 98XXXXXX00)..." style="max-width: 260px;" />
            <button class="btn btn-secondary btn-sm" id="btn-fetch-wa-logs">🔄 Query DB</button>
          </div>
        </div>

        <div id="whatsapp-logs-container">
          <div style="text-align: center; padding: 30px; color: var(--text-muted);">Fetching WhatsApp logs from PostgreSQL...</div>
        </div>
      </div>
    `;
  }

  async loadWhatsAppLogs(phone = '') {
    const container = document.getElementById('whatsapp-logs-container');
    if (!container) return;

    try {
      const res = await ApiClient.getWhatsAppLogs({ phone, limit: '50' });
      const logs = res.logs || [];

      if (logs.length === 0) {
        container.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-muted);">No WhatsApp logs found for this filter.</div>`;
        return;
      }

      container.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 8px;">
          ${logs.map((l) => {
        const isInbound = l.direction === 'INBOUND';
        const timeStr = formatTime12h(l.createdAt);
        const dateStr = new Date(l.createdAt).toLocaleDateString();

        return `
              <div class="log-stream-card">
                <div style="display: flex; align-items: center; gap: 12px; flex: 1;">
                  <span class="${isInbound ? 'log-direction-in' : 'log-direction-out'}">
                    ${isInbound ? '📥 INBOUND' : '📤 OUTBOUND'}
                  </span>
                  <div>
                    <div style="font-weight: 700; color: #fff;">📞 ${l.phone}</div>
                    <div style="color: var(--text-secondary); font-size: 0.82rem; margin-top: 2px;">
                      ${l.messageText || (l.rawPayload ? JSON.stringify(l.rawPayload).slice(0, 80) : 'No text content')}
                    </div>
                  </div>
                </div>

                <div style="text-align: right;">
                  <span class="badge ${l.status === 'SENT' || l.status === 'RECEIVED' ? 'badge-completed' : 'badge-cancelled'}" style="font-size: 0.7rem;">
                    ${l.status}
                  </span>
                  ${l.errorCode ? `<div style="font-size: 0.7rem; color: var(--danger); margin-top: 2px;">Error ${l.errorCode}: ${l.errorMessage}</div>` : ''}
                  <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px;">${dateStr} ${timeStr}</div>
                </div>
              </div>
            `;
      }).join('')}
        </div>
      `;
    } catch (err) {
      container.innerHTML = `<div style="color: var(--danger); padding: 20px;">${err.message}</div>`;
    }
  }

  // =========================================================================
  // ATTACH EVENT LISTENERS
  // =========================================================================

  async loadCalendarSchedule(monthStr = null, bypassCache = false, options = {}) {
    const year = this.calYear;
    const month = this.calMonth;
    const targetMonth = monthStr || `${year}-${String(month + 1).padStart(2, '0')}`;
    const calendarFor = options.calendarFor || (options.staffId ? 'STAFF' : 'SALON');
    const staffId = options.staffId || null;

    try {
      const res = await ApiClient.getCalendarSchedule({
        month: targetMonth,
        calendarFor,
        ...(staffId ? { staffId } : {}),
      }, bypassCache);
      const schedule = (res && res.data !== undefined) ? res.data : res;
      if (schedule) {
        this.calendarSchedule = schedule;
        if (schedule.salonSchedule?.closures) {
          this.closuresList = schedule.salonSchedule.closures;
        }
        if (schedule.salonSchedule?.weeklyHours) {
          this.salonWorkingHours = schedule.salonSchedule.weeklyHours;
        }
      }
    } catch (err) {
      console.warn('[Dashboard] loadCalendarSchedule error:', err);
    }
  }

  attachStaffSubtabSpecificListeners(root, st, subtab) {
    const container = root || this.container || document;

    if (subtab === 'leaves' || !subtab) {
      // CalendarView lifecycle manages all staff leave interactions autonomously
      return;
    } else if (subtab === 'hours') {
      // 1. Attach roster and routine breaks listeners
      this.attachStaffRosterListeners();
      this.attachRoutineBreaksListeners();

      // 2. Segmented Tabs Switcher: [ ⏰ Shift Hours | ☕ Daily Breaks ]
      const tabBtnShifts = container.querySelector('#tab-btn-shifts');
      const tabBtnBreaks = container.querySelector('#tab-btn-breaks');
      const tabContentShifts = container.querySelector('#tab-content-shifts');
      const tabContentBreaks = container.querySelector('#tab-content-breaks');

      if (tabBtnShifts && tabBtnBreaks) {
        tabBtnShifts.onclick = (e) => {
          e.preventDefault();
          if (this.currentStaffHoursState) this.currentStaffHoursState.activeSubTab = 'shifts';
          tabBtnShifts.classList.add('active');
          tabBtnBreaks.classList.remove('active');
          if (tabContentShifts) tabContentShifts.style.display = 'block';
          if (tabContentBreaks) tabContentBreaks.style.display = 'none';
        };

        tabBtnBreaks.onclick = (e) => {
          e.preventDefault();
          if (this.currentStaffHoursState) this.currentStaffHoursState.activeSubTab = 'breaks';
          tabBtnBreaks.classList.add('active');
          tabBtnShifts.classList.remove('active');
          if (tabContentShifts) tabContentShifts.style.display = 'none';
          if (tabContentBreaks) tabContentBreaks.style.display = 'block';
        };
      }

      // 3. Bulk Shift Live Auto-Apply across active roster days
      const bulkStartInp = container.querySelector('#master-bulk-start');
      const bulkEndInp = container.querySelector('#master-bulk-end');
      const bulkStartPrev = container.querySelector('#master-bulk-start-preview');
      const bulkEndPrev = container.querySelector('#master-bulk-end-preview');

      const handleBulkShiftLiveChange = (immediate = false) => {
        const sVal = bulkStartInp?.value || '';
        const eVal = bulkEndInp?.value || '';

        if (!sVal || !eVal) return;

        if (bulkStartPrev) bulkStartPrev.textContent = formatTime12h(sVal);
        if (bulkEndPrev) bulkEndPrev.textContent = formatTime12h(eVal);

        if (sVal >= eVal) {
          if (immediate) {
            this.showToast?.(`Shift start (${formatTime12h(sVal)}) must be earlier than shift end (${formatTime12h(eVal)}).`, 'warning');
          }
          return;
        }

        const activeDays = (this.salonWorkingHours || []).filter((h) => !h.isClosed);
        const salonMinS = activeDays.length > 0 ? activeDays.reduce((min, h) => (h.startTime && h.startTime < min ? h.startTime : min), activeDays[0].startTime) : '09:00';
        const salonMaxE = activeDays.length > 0 ? activeDays.reduce((max, h) => (h.endTime && h.endTime > max ? h.endTime : max), activeDays[0].endTime) : '19:00';

        let effectiveStart = sVal;
        let effectiveEnd = eVal;

        if (effectiveStart < salonMinS) {
          effectiveStart = salonMinS;
          if (bulkStartInp) bulkStartInp.value = salonMinS;
          if (bulkStartPrev) bulkStartPrev.textContent = formatTime12h(salonMinS);
          if (immediate) {
            this.showToast?.(`Shift start cannot be earlier than store opening (${formatTime12h(salonMinS)}). Clamped to store opening.`, 'warning');
          }
        }

        if (effectiveEnd > salonMaxE) {
          effectiveEnd = salonMaxE;
          if (bulkEndInp) bulkEndInp.value = salonMaxE;
          if (bulkEndPrev) bulkEndPrev.textContent = formatTime12h(salonMaxE);
          if (immediate) {
            this.showToast?.(`Shift end cannot be later than store closing (${formatTime12h(salonMaxE)}). Clamped to store closing.`, 'warning');
          }
        }

        if (effectiveStart >= effectiveEnd) {
          if (immediate) {
            this.showToast?.(`Shift start (${formatTime12h(effectiveStart)}) must be earlier than shift end (${formatTime12h(effectiveEnd)}).`, 'warning');
          }
          return;
        }

        const daysArr = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
        daysArr.forEach((dKey) => {
          const dayData = this.currentStaffHoursState?.days[dKey];
          if (dayData && dayData.isWorking) {
            dayData.startTime = effectiveStart;
            dayData.endTime = effectiveEnd;
            const swhStart = dayData.salonStart || this.salonProfile?.defaultStartTime || '09:00';
            const swhEnd = dayData.salonEnd || this.salonProfile?.defaultEndTime || '19:00';
            const isSalonClosed = Boolean(dayData.isSalonClosed);
            const isIdenticalToSalon = !isSalonClosed && effectiveStart === swhStart && effectiveEnd === swhEnd;
            dayData.isCustomized = !isIdenticalToSalon;
          }
        });

        if (this.currentStaffHoursState) {
          this.currentStaffHoursState.masterShift = { startTime: effectiveStart, endTime: effectiveEnd };
        }
        const subEl = document.querySelector('.bulk-setter-sub');
        if (subEl) {
          const activeDays = (this.salonWorkingHours || []).filter((h) => !h.isClosed);
          let minS = activeDays.length > 0 ? activeDays.reduce((min, h) => (h.startTime && h.startTime < min ? h.startTime : min), activeDays[0].startTime) : sVal;
          let maxE = activeDays.length > 0 ? activeDays.reduce((max, h) => (h.endTime && h.endTime > max ? h.endTime : max), activeDays[0].endTime) : eVal;
          if (sVal < minS) minS = sVal;
          if (eVal > maxE) maxE = eVal;
          subEl.textContent = `Changes auto-apply live · Store hours: ${formatTime12h(minS)} – ${formatTime12h(maxE)}`;
        }
        this.syncRoutineBreaksToDays();
        const rowsContainer = document.getElementById('stylist-roster-rows-container');
        if (rowsContainer) {
          rowsContainer.innerHTML = this.renderStaffRosterRowsHtml();
          this.attachStaffRosterListeners();
        }
        this.autoSaveStaffSchedule(st.id, immediate);
      };

      bulkStartInp?.addEventListener('input', () => handleBulkShiftLiveChange(false));
      bulkStartInp?.addEventListener('change', () => handleBulkShiftLiveChange(true));
      bulkStartInp?.addEventListener('blur', () => handleBulkShiftLiveChange(true));
      bulkEndInp?.addEventListener('input', () => handleBulkShiftLiveChange(false));
      bulkEndInp?.addEventListener('change', () => handleBulkShiftLiveChange(true));
      bulkEndInp?.addEventListener('blur', () => handleBulkShiftLiveChange(true));

      // 4. Add Routine Break Button (Opens bottom sheet)
      const btnAddBreak = container.querySelector('#btn-add-routine-break');
      if (btnAddBreak) {
        btnAddBreak.onclick = (e) => {
          e.preventDefault();
          this.openRoutineBreakBottomSheet(-1);
        };
      }

      // 5. Reset All to Salon Hours Banner / Button (Opens bottom sheet)
      const bannerSync = container.querySelector('#roster-sync-banner-row');
      const btnSyncAll = container.querySelector('#btn-open-sync-all-salon-sheet');
      [bannerSync, btnSyncAll].forEach((el) => {
        if (el) {
          el.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.openResetAllToSalonHoursBottomSheet();
          };
        }
      });
    }
  }

  attachStaffTabListeners(tabContent) {
    const root = tabContent || this.container || document;

    // =========================================================================
    // SCENARIO A: STYLIST DETAIL VIEW IS OPEN (HUB & SPOKE WORKSPACE)
    // =========================================================================
    if (this.selectedStaffId) {
      this.staffManager.attachListeners(root);
      return;
    }

    // =========================================================================
    // SCENARIO B: STYLIST LIST VIEW (MINIMALIST CARDS)
    // =========================================================================

    // 1. Add Stylist Button
    const addStaffBtn = root.querySelector('#btn-add-staff') || document.getElementById('btn-add-staff');
    addStaffBtn?.addEventListener('click', () => {
      this.showAddStaffModal();
    });

    // 2. Tap Stylist Card to open Executive Profile Hub
    root.querySelectorAll('.stylist-card[data-staff-id]').forEach((card) => {
      card.addEventListener('click', () => {
        const sId = card.getAttribute('data-staff-id');
        if (sId) {
          this.staffManager.setStaff(sId, 'overview');
          this.render();
        }
      });

      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          card.click();
        }
      });
    });

    // 3. Search Bar Live Filter
    const searchInput = root.querySelector('#input-search-stylists') || document.getElementById('input-search-stylists');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.staffSearchQuery = e.target.value;
        const q = (this.staffSearchQuery || '').trim().toLowerCase();
        const currentFilter = this.staffStatusFilter || 'ALL';

        root.querySelectorAll('.stylist-card').forEach((card) => {
          const text = card.textContent.toLowerCase();
          const matchesQuery = !q || text.includes(q);
          let matchesFilter = true;
          if (currentFilter !== 'ALL') {
            const badge = card.querySelector('.stylist-badge');
            const badgeText = badge ? badge.textContent.toUpperCase() : '';
            if (currentFilter === 'AVAILABLE' && !badgeText.includes('AVAILABLE')) matchesFilter = false;
            else if ((currentFilter === 'WORKING' || currentFilter === 'BUSY') && !badgeText.includes('IN CHAIR') && !badgeText.includes('WORKING')) matchesFilter = false;
            else if ((currentFilter === 'ON_BREAK' || currentFilter === 'BREAK') && !badgeText.includes('BREAK')) matchesFilter = false;
            else if ((currentFilter === 'ON_LEAVE' || currentFilter === 'LEAVE') && !badgeText.includes('LEAVE')) matchesFilter = false;
            else if ((currentFilter === 'SALON_OFF' || currentFilter === 'OFF') && !badgeText.includes('OFF') && !badgeText.includes('CLOSED')) matchesFilter = false;
            else if (currentFilter === 'INACTIVE' && !badgeText.includes('INACTIVE')) matchesFilter = false;
          }
          card.style.display = (matchesQuery && matchesFilter) ? 'flex' : 'none';
        });
      });
    }

    // 4. Custom Dark Luxury Popover Filter Trigger
    const filterTriggerBtn = root.querySelector('#btn-staff-filter-trigger') || document.getElementById('btn-staff-filter-trigger');
    const filterPopover = root.querySelector('#staff-filter-popover') || document.getElementById('staff-filter-popover');

    if (filterTriggerBtn && filterPopover) {
      filterTriggerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = filterPopover.style.display === 'block';
        filterPopover.style.display = isOpen ? 'none' : 'block';
      });

      const handleOutsideClick = (e) => {
        if (!filterPopover.contains(e.target) && !filterTriggerBtn.contains(e.target)) {
          filterPopover.style.display = 'none';
        }
      };
      document.addEventListener('click', handleOutsideClick);
    }

    // 5. Popover Filter Item Selection
    root.querySelectorAll('.popover-item[data-filter], .popover-clear-btn[data-filter]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.staffStatusFilter = btn.getAttribute('data-filter') || 'ALL';
        if (filterPopover) filterPopover.style.display = 'none';
        this.render();
      });
    });

    // 6. Clear Search X Button & Search Reset
    const clearSearchX = root.querySelector('#btn-clear-search-x');
    clearSearchX?.addEventListener('click', () => {
      this.staffSearchQuery = '';
      this.render();
    });

    const clearSearchBtn = root.querySelector('#btn-clear-staff-search') || document.getElementById('btn-clear-staff-search');
    clearSearchBtn?.addEventListener('click', () => {
      this.staffSearchQuery = '';
      this.staffStatusFilter = 'ALL';
      this.render();
    });
  }

  attachEventListeners() {
    // Logout
    const handleLogout = async () => {
      await ApiClient.logout();
      window.location.hash = '#login';
      window.location.reload();
    };
    document.getElementById('btn-logout')?.addEventListener('click', handleLogout);
    document.getElementById('card-feature-logout')?.addEventListener('click', handleLogout);

    // Reception Desk Quick Bar
    document.getElementById('btn-quick-copy')?.addEventListener('click', () => {
      const slug = this.salonProfile?.slug || 'glamour-studio';
      const url = `${window.location.origin}/#book/${slug}`;
      navigator.clipboard.writeText(url);
      this.showToast('Booking link copied to clipboard!', 'success');
    });
    document.getElementById('btn-quick-standee')?.addEventListener('click', () => {
      this.showStandeePrintModal();
    });

    // Dashboard Quick Action Cards
    document.getElementById('card-action-walkin')?.addEventListener('click', () => {
      this.showWalkInModal();
    });
    document.getElementById('card-action-qr')?.addEventListener('click', () => {
      this.showQRCodeModal();
    });
    document.getElementById('card-action-queue')?.addEventListener('click', () => {
      this.switchTab('queue');
    });
    document.getElementById('card-action-copy')?.addEventListener('click', () => {
      const slug = this.salonProfile?.slug || 'glamour-studio';
      const url = `${window.location.origin}/#book/${slug}`;
      navigator.clipboard.writeText(url);
      alert(`Booking link copied to clipboard:\n${url}`);
    });
    document.getElementById('btn-goto-staff')?.addEventListener('click', () => {
      this.switchTab('staff');
    });

    // Profile Feature Hub Cards
    document.getElementById('card-feature-crm')?.addEventListener('click', () => {
      this.switchTab('customers');
    });
    document.getElementById('card-feature-whatsapp')?.addEventListener('click', () => {
      this.switchTab('whatsapp-logs');
    });
    document.getElementById('card-feature-qr')?.addEventListener('click', () => {
      this.showQRCodeModal();
    });

    document.getElementById('card-feature-shifts')?.addEventListener('click', () => {
      this.switchTab('staff');
    });

    // Global Event Delegation for Add Service Triggers
    this.container?.addEventListener('click', (e) => {
      const addSvcBtn = e.target.closest('#btn-add-service, #btn-quick-add-service, #btn-empty-add-service, .btn-trigger-add-service');
      if (addSvcBtn) {
        e.preventDefault();
        this.showAddServiceModal();
      }
    });

    // Navigation Tabs (Desktop & Mobile Bottom Nav)
    this.container.querySelectorAll('.nav-tab, .bottom-nav-item').forEach((tab) => {
      tab.onclick = (e) => {
        e.preventDefault();
        const targetBtn = e.target.closest('[data-tab]');
        const targetTab = targetBtn ? targetBtn.getAttribute('data-tab') : null;
        if (targetTab) {
          this.switchTab(targetTab);
        }
      };
    });


    // Mobile Walk-In FAB
    const handleFabClick = (e) => {
      e.preventDefault();
      this.showWalkInModal();
    };
    const fabBtn = document.getElementById('mobile-btn-walkin');
    fabBtn?.addEventListener('click', handleFabClick);
    fabBtn?.addEventListener('touchend', handleFabClick);

    // Sound Mute / Unmute Toggle
    document.getElementById('btn-toggle-sound')?.addEventListener('click', () => {
      const isMuted = SoundManager.toggleMute();
      const btn = document.getElementById('btn-toggle-sound');
      if (btn) {
        btn.innerHTML = `<span id="sound-icon">${isMuted ? Icons.volumeX({ size: 16, color: '#94a3b8' }) : Icons.volume2({ size: 16, color: '#34d399' })}</span> <span id="sound-text" class="desktop-sound-text">${isMuted ? 'Muted' : 'Floor Audio ON'}</span>`;
        btn.title = isMuted ? 'Unmute Floor Audio' : 'Mute Floor Audio';
      }
    });

    // Quick Booking Request Triggers
    const openQuickRequestsModal = () => this.openQuickRequestsModal();
    document.getElementById('btn-header-quick-requests')?.addEventListener('click', openQuickRequestsModal);

    // Queue Filter Pills
    this.container.querySelectorAll('.q-chip').forEach((pill) => {
      pill.addEventListener('click', (e) => {
        const filter = e.currentTarget.getAttribute('data-filter');
        if (filter) {
          this.queueFilter = filter;
          this.render();
        }
      });
    });

    // Date Navigation Controls (Prev, Next, Today) with Smooth State Management
    const handleDateChange = async (newDate) => {
      if (!newDate) return;
      this.selectedDate = newDate;
      const syncBtn = document.getElementById('btn-refresh-queue');
      syncBtn?.classList.add('syncing');
      try {
        await this.loadData(true);
      } finally {
        this.render();
      }
    };

    document.getElementById('btn-date-prev')?.addEventListener('click', () => {
      const prevDate = this.addDaysToDateString(this.selectedDate, -1);
      handleDateChange(prevDate);
    });

    document.getElementById('btn-date-next')?.addEventListener('click', () => {
      const nextDate = this.addDaysToDateString(this.selectedDate, 1);
      handleDateChange(nextDate);
    });

    document.getElementById('btn-date-today')?.addEventListener('click', () => {
      handleDateChange(this.getLocalDateString());
    });

    // Date Picker Trigger on Badge Click
    const datePicker = document.getElementById('dashboard-date-picker');
    const dateBadge = this.container.querySelector('.q-date-badge');
    dateBadge?.addEventListener('click', (e) => {
      if (e.target !== datePicker) {
        try {
          if (typeof datePicker?.showPicker === 'function') {
            datePicker.showPicker();
          } else {
            datePicker?.click();
          }
        } catch (err) {
          datePicker?.focus();
        }
      }
    });

    datePicker?.addEventListener('change', (e) => {
      if (e.target.value) {
        handleDateChange(e.target.value);
      }
    });

    // Refresh queue
    const handleQueueSync = async () => {
      const syncBtn = document.getElementById('btn-refresh-queue');
      syncBtn?.classList.add('syncing');
      try {
        await this.loadData(true);
      } finally {
        this.render();
      }
    };
    document.getElementById('btn-refresh-queue')?.addEventListener('click', handleQueueSync);
    document.getElementById('btn-empty-sync')?.addEventListener('click', handleQueueSync);


    // Universal Pull-to-Refresh Gestures (Works on all screens)
    const ptrWrapper = document.getElementById('ptr-wrapper');
    const ptrIcon = document.getElementById('ptr-icon');
    const ptrText = document.getElementById('ptr-text');
    let startTouchY = 0;
    let currentPullDist = 0;
    let isPulling = false;

    window.addEventListener('touchstart', (e) => {
      if (window.scrollY <= 8 && e.touches.length === 1 && ptrWrapper) {
        startTouchY = e.touches[0].screenY;
        isPulling = true;
      }
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (!isPulling || !ptrWrapper || window.scrollY > 8) return;
      const touchY = e.touches[0].screenY;
      const diff = touchY - startTouchY;
      if (diff > 0) {
        currentPullDist = Math.min(65, diff * 0.45);
        ptrWrapper.classList.add('ptr-pulling');
        ptrWrapper.style.height = `${currentPullDist}px`;
        if (currentPullDist > 45) {
          if (ptrIcon) ptrIcon.style.transform = 'rotate(180deg)';
          if (ptrText) ptrText.textContent = 'Release to sync...';
        } else {
          if (ptrIcon) ptrIcon.style.transform = 'rotate(0deg)';
          if (ptrText) ptrText.textContent = 'Pull to refresh';
        }
      }
    }, { passive: true });

    window.addEventListener('touchend', async () => {
      if (!isPulling || !ptrWrapper) return;
      isPulling = false;
      if (currentPullDist > 45) {
        ptrWrapper.classList.add('ptr-spinning');
        if (ptrText) ptrText.textContent = 'Syncing store...';
        try {
          await this.loadData(true);
        } catch (err) {
          console.warn('[PTR] Error during sync:', err);
        } finally {
          ptrWrapper.style.height = '0px';
          ptrWrapper.classList.remove('ptr-pulling', 'ptr-spinning');
          if (ptrIcon) ptrIcon.style.transform = 'rotate(0deg)';
          if (ptrText) ptrText.textContent = 'Pull to refresh';
          this.refreshActiveTab();
        }
      } else {
        ptrWrapper.style.height = '0px';
        ptrWrapper.classList.remove('ptr-pulling');
      }
      currentPullDist = 0;
    }, { passive: true });


    // Copy Invite Link
    document.getElementById('btn-copy-invite')?.addEventListener('click', () => {
      const slug = this.salonProfile?.slug || 'glamour-studio';
      const url = `${window.location.origin}/#book/${slug}`;
      navigator.clipboard.writeText(url);
      alert(`Booking link copied to clipboard:\n${url}`);
    });

    // Open QR & WhatsApp Modal
    document.getElementById('btn-open-qr')?.addEventListener('click', () => {
      this.showQRCodeModal();
    });

    // Fast Walk-in Modal
    document.getElementById('btn-fast-walkin')?.addEventListener('click', () => {
      this.showWalkInModal();
    });

    // Status Updates (Check In, Start Service, Complete)
    this.container.querySelectorAll('.btn-status').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const status = e.currentTarget.getAttribute('data-status');
        e.currentTarget.textContent = 'Updating...';
        try {
          await ApiClient.updateAppointmentStatus(id, status);
          await this.loadData();
          this.render();
        } catch (err) {
          alert(`Could not update status: ${err.message}`);
        }
      });
    });

    // Reschedule Button
    this.container.querySelectorAll('.btn-open-reschedule').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const serviceId = e.currentTarget.getAttribute('data-service');
        const staffId = e.currentTarget.getAttribute('data-staff');
        const clientName = e.currentTarget.getAttribute('data-name');
        this.showRescheduleModal(id, serviceId, staffId, clientName);
      });
    });

    // Cancel Button
    this.container.querySelectorAll('.btn-open-cancel').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const clientName = e.currentTarget.getAttribute('data-name');
        this.showCancelModal(id, clientName);
      });
    });

    // Quick Onboarding Action Buttons & Empty State Triggers
    document.getElementById('btn-quick-add-staff')?.addEventListener('click', () => {
      this.showAddStaffModal();
    });
    document.getElementById('btn-empty-add-staff')?.addEventListener('click', () => {
      this.showAddStaffModal();
    });
    document.getElementById('btn-quick-add-service')?.addEventListener('click', () => {
      this.showAddServiceModal();
    });
    document.getElementById('btn-empty-add-service')?.addEventListener('click', () => {
      this.showAddServiceModal();
    });

    // Staff Tab Master-Detail Workspace Listeners
    if (this.activeTab === 'staff') {
      this.attachStaffTabListeners(this.container);
    }

    // Mark Staff Absent / Leave
    this.container.querySelectorAll('.btn-mark-absent').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const name = e.currentTarget.getAttribute('data-name');
        this.showMarkAbsentModal(id, name);
      });
    });

    // Staff Leave History
    this.container.querySelectorAll('.btn-leave-history').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const name = e.currentTarget.getAttribute('data-name');
        this.showLeaveHistoryModal(id, name);
      });
    });

    // Cancel / Reopen Staff Absence
    const handleCancelAbsent = async (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      const absenceId = e.currentTarget.getAttribute('data-absence-id');
      const name = e.currentTarget.getAttribute('data-name') || 'Specialist';
      if (!absenceId) {
        this.showToast('No active absence record found for this specialist on this date', 'error');
        return;
      }
      if (confirm(`Are you sure you want to cancel the absence for ${name}? The specialist will be marked available again.`)) {
        try {
          await Api.cancelStaffAbsence(id, absenceId);
          this.showToast(`Absence cancelled for ${name}. Specialist is available again.`, 'success');
          await this.loadStaff();
          this.render();
        } catch (err) {
          this.showToast(err.message || 'Failed to cancel absence', 'error');
        }
      }
    };

    this.container.querySelectorAll('.btn-cancel-absent').forEach((btn) => {
      btn.addEventListener('click', handleCancelAbsent);
    });
    this.attachStaffScheduleListeners(this.container);

    // Edit Service Modal
    this.container.querySelectorAll('.btn-edit-service').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const service = (this.servicesList || []).find((s) => String(s.id) === String(id)) || {
          id,
          name: e.currentTarget.getAttribute('data-name'),
          price: e.currentTarget.getAttribute('data-price'),
          durationMinutes: e.currentTarget.getAttribute('data-duration'),
          category: e.currentTarget.getAttribute('data-category'),
          description: e.currentTarget.getAttribute('data-desc'),
        };
        this.showEditServiceModal(service);
      });
    });

    // Delete Service Modal
    this.container.querySelectorAll('.btn-delete-service').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const name = e.currentTarget.getAttribute('data-name');
        this.showDeleteServiceModal(id, name);
      });
    });

    // CRM Search Debounce
    const searchInput = document.getElementById('customer-search-input');
    let debounceTimer;
    searchInput?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        this.loadCustomersTable(this.searchQuery, this.activeCustomerFilter || 'ALL');
      }, 300);
    });

    // Customer Strike Filter Chips
    this.container.querySelectorAll('.cust-filter-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        this.container.querySelectorAll('.cust-filter-btn').forEach((b) => {
          b.style.background = 'rgba(255,255,255,0.05)';
        });
        e.currentTarget.style.background = 'rgba(139, 61, 255,0.3)';
        const filter = e.currentTarget.getAttribute('data-filter');
        this.activeCustomerFilter = filter;
        this.loadCustomersTable(this.searchQuery, filter);
      });
    });

    // View Customer History
    this.container.querySelectorAll('.btn-view-customer-history').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const name = e.currentTarget.getAttribute('data-name');
        this.showCustomerHistoryModal(id, name);
      });
    });

    // WhatsApp Log Filter
    document.getElementById('btn-fetch-wa-logs')?.addEventListener('click', () => {
      const phone = document.getElementById('whatsapp-log-phone-filter')?.value || '';
      this.loadWhatsAppLogs(phone);
    });

    // Load table on initial tab switch
    if (this.activeTab === 'customers') this.loadCustomersTable();
    if (this.activeTab === 'whatsapp-logs') this.loadWhatsAppLogs();

    // Profile Tab: Initialize settings subtab listeners
    if (this.activeTab === 'profile') {
      this.attachProfileSubtabListeners();
    }

    // Delegated click listener on root container for settings navigation subtabs (guarantees click always works)
    if (!this._settingsNavDelegated && this.container) {
      this._settingsNavDelegated = true;
      this.container.addEventListener('click', (e) => {
        const navBtn = e.target.closest('.settings-nav-row[data-subtab]');
        if (navBtn) {
          e.preventDefault();
          const sub = navBtn.getAttribute('data-subtab');
          if (sub) this.switchProfileSubtab(sub);
        }
      });
    }
  }

  /**
   * PERFORMANCE: Re-attach only event listeners inside #tab-content.
   * Called during targeted SSE re-renders to avoid re-binding global header/nav listeners.
   */
  attachTabEventListeners() {
    const tabContent = document.getElementById('tab-content');
    if (!tabContent) return;

    // Dashboard Quick Action Cards & Reception Quick Bar
    document.getElementById('btn-quick-copy')?.addEventListener('click', () => {
      const slug = this.salonProfile?.slug || 'glamour-studio';
      const url = `${window.location.origin}/#book/${slug}`;
      navigator.clipboard.writeText(url);
      this.showToast('Booking link copied to clipboard!', 'success');
    });
    document.getElementById('btn-quick-standee')?.addEventListener('click', () => {
      this.showStandeePrintModal();
    });
    document.getElementById('btn-goto-services-banner')?.addEventListener('click', () => this.switchTab('services'));
    document.getElementById('card-action-walkin')?.addEventListener('click', () => this.showWalkInModal());
    document.getElementById('card-action-qr')?.addEventListener('click', () => this.showQRCodeModal());
    document.getElementById('card-action-queue')?.addEventListener('click', () => {
      this.switchTab('queue');
    });
    document.getElementById('card-action-copy')?.addEventListener('click', () => {
      const slug = this.salonProfile?.slug || 'glamour-studio';
      const url = `${window.location.origin}/#book/${slug}`;
      navigator.clipboard.writeText(url);
      alert(`Booking link copied to clipboard:\n${url}`);
    });
    document.getElementById('btn-goto-staff')?.addEventListener('click', () => {
      this.switchTab('staff');
    });


    // Queue Filter Pills
    tabContent.querySelectorAll('.q-chip').forEach((pill) => {
      pill.addEventListener('click', (e) => {
        const filter = e.currentTarget.getAttribute('data-filter');
        if (filter) {
          this.queueFilter = filter;
          this.render();
        }
      });
    });

    // Date Navigation Controls (Prev, Next, Today, Date Picker)
    const handleDateChange = async (newDate) => {
      if (!newDate) return;
      this.selectedDate = newDate;
      const syncBtn = document.getElementById('btn-refresh-queue');
      syncBtn?.classList.add('syncing');
      try {
        await this.loadData(true);
      } finally {
        this.render();
      }
    };

    document.getElementById('btn-date-prev')?.addEventListener('click', () => {
      const prevDate = this.addDaysToDateString(this.selectedDate, -1);
      handleDateChange(prevDate);
    });

    document.getElementById('btn-date-next')?.addEventListener('click', () => {
      const nextDate = this.addDaysToDateString(this.selectedDate, 1);
      handleDateChange(nextDate);
    });

    document.getElementById('btn-date-today')?.addEventListener('click', () => {
      handleDateChange(this.getLocalDateString());
    });

    const datePicker = document.getElementById('dashboard-date-picker');
    const dateBadge = tabContent.querySelector('.q-date-badge');
    dateBadge?.addEventListener('click', (e) => {
      if (e.target !== datePicker) {
        try {
          if (typeof datePicker?.showPicker === 'function') {
            datePicker.showPicker();
          } else {
            datePicker?.click();
          }
        } catch (err) {
          datePicker?.focus();
        }
      }
    });

    datePicker?.addEventListener('change', (e) => {
      if (e.target.value) {
        handleDateChange(e.target.value);
      }
    });

    // Refresh queue
    document.getElementById('btn-refresh-queue')?.addEventListener('click', async () => {
      const syncBtn = document.getElementById('btn-refresh-queue');
      syncBtn?.classList.add('syncing');
      try { await this.loadData(true); } finally { this.render(); }
    });

    // Status Updates
    tabContent.querySelectorAll('.btn-status').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const status = e.currentTarget.getAttribute('data-status');
        e.currentTarget.textContent = 'Updating...';
        try {
          await ApiClient.updateAppointmentStatus(id, status);
          await this.loadData();
          this.render();
        } catch (err) {
          alert(`Could not update status: ${err.message}`);
        }
      });
    });

    // Reschedule Button
    tabContent.querySelectorAll('.btn-open-reschedule').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const serviceId = e.currentTarget.getAttribute('data-service');
        const staffId = e.currentTarget.getAttribute('data-staff');
        const clientName = e.currentTarget.getAttribute('data-name');
        this.showRescheduleModal(id, serviceId, staffId, clientName);
      });
    });

    // Start Live 10-Minute Timer Ticks
    this.startLiveTimerTicks();

    // Cancel Button
    tabContent.querySelectorAll('.btn-open-cancel').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const clientName = e.currentTarget.getAttribute('data-name');
        this.showCancelModal(id, clientName);
      });
    });


    // Quick Onboarding Action Buttons
    document.getElementById('btn-quick-add-staff')?.addEventListener('click', () => this.showAddStaffModal());
    document.getElementById('btn-empty-add-staff')?.addEventListener('click', () => this.showAddStaffModal());

    // Staff Tab Master-Detail Workspace Listeners
    if (this.activeTab === 'staff') {
      this.attachStaffTabListeners(tabContent);
    }

    // Services Tab Buttons
    document.getElementById('btn-manage-categories')?.addEventListener('click', () => this.showManageCategoriesModal());
    tabContent.querySelectorAll('.btn-edit-service').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const service = (this.servicesList || []).find((s) => String(s.id) === String(id)) || {
          id,
          name: e.currentTarget.getAttribute('data-name'),
          price: e.currentTarget.getAttribute('data-price'),
          durationMinutes: e.currentTarget.getAttribute('data-duration'),
          category: e.currentTarget.getAttribute('data-category'),
          description: e.currentTarget.getAttribute('data-desc'),
        };
        this.showEditServiceModal(service);
      });
    });
    tabContent.querySelectorAll('.btn-delete-service').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        this.showDeleteServiceModal(e.currentTarget.getAttribute('data-id'), e.currentTarget.getAttribute('data-name'));
      });
    });

    // Profile Tab
    if (this.activeTab === 'profile') {
      this.attachProfileSubtabListeners();
    }
    document.getElementById('btn-copy-invite')?.addEventListener('click', () => {
      const slug = this.salonProfile?.slug || 'the-grand-royal-barber-1';
      const url = `${window.location.origin}/#book/${slug}`;
      navigator.clipboard.writeText(url);
      this.showToast('Booking link copied to clipboard!', 'success');
    });
    tabContent.querySelectorAll('.btn-open-closures-modal').forEach((b) => {
      b.onclick = () => {
        this.switchTab('profile');
        this.switchProfileSubtab('closures');
      };
    });
    document.getElementById('btn-open-qr')?.addEventListener('click', () => this.showQRCodeModal());
    document.getElementById('btn-block-time')?.addEventListener('click', () => this.showBlockTimeModal());


    // Back button listener for Customer Management Tab (Navigates to previously active tab)
    document.getElementById('btn-cust-back')?.addEventListener('click', () => {
      const target = this.previousTab || 'queue';
      this.switchTab(target);
    });

    // CRM Search & Customer Filter Chips
    const searchInput = document.getElementById('customer-search-input');
    let debounceTimer;
    searchInput?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => this.loadCustomersTable(this.searchQuery, this.activeCustomerFilter || 'ALL'), 300);
    });

    const custFilterBtns = tabContent.querySelectorAll('.cust-filter-btn');
    custFilterBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const filter = e.currentTarget.getAttribute('data-filter');
        this.activeCustomerFilter = filter;
        custFilterBtns.forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-filter') === filter);
        });
        this.loadCustomersTable(this.searchQuery || '', filter);
      });
    });

    tabContent.querySelectorAll('.btn-view-customer-history').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        this.showCustomerHistoryModal(e.currentTarget.getAttribute('data-id'), e.currentTarget.getAttribute('data-name'));
      });
    });

    // WhatsApp Log Filter
    document.getElementById('btn-fetch-wa-logs')?.addEventListener('click', () => {
      const phone = document.getElementById('whatsapp-log-phone-filter')?.value || '';
      this.loadWhatsAppLogs(phone);
    });

    // Load table on tab switch
    if (this.activeTab === 'customers') this.loadCustomersTable(this.searchQuery || '', this.activeCustomerFilter || 'ALL');
    if (this.activeTab === 'whatsapp-logs') this.loadWhatsAppLogs();
  }

  // =========================================================================
  // MODALS
  // =========================================================================
  showWalkInModal() {
    const modalContainer = document.getElementById('modal-container');
    const todayIso = this.getLocalDateString();
    const maxDays = this.salonProfile?.maxAdvanceDays || 3;
    const maxDateIso = this.addDaysToDateString(todayIso, maxDays);

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content modal-content-lg">
          <div class="modal-header">
            <h3>⚡ New Walk-In / Fast Booking</h3>
            <button class="close-btn" id="btn-close-modal">&times;</button>
          </div>

          <form id="fast-booking-form">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
              <div class="form-group">
                <label>Client Full Name *</label>
                <input type="text" class="form-control" id="walkin-name" placeholder="e.g. Ramesh Kumar" required />
              </div>
              <div class="form-group">
                <label>Client WhatsApp Phone *</label>
                <input type="tel" class="form-control" id="walkin-phone" placeholder="+91 98XXXXXX00" required />
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
              <div class="form-group">
                <label>Select Service *</label>
                <select class="form-control" id="walkin-service" required>
                  <option value="">-- Choose Service --</option>
                  ${this.servicesList.map((s) => `<option value="${s.id}">✂️ ${s.name} (₹${s.price} • ${s.durationMinutes}m)</option>`).join('')}
                </select>
              </div>

              <div class="form-group">
                <label>Preferred Stylist</label>
                <select class="form-control" id="walkin-staff">
                  <option value="">👤 Any Free Stylist (Auto-Balance)</option>
                  ${this.staffList.map((st) => `<option value="${st.id}">💈 ${st.name}</option>`).join('')}
                </select>
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
              <div class="form-group">
                <label>Date *</label>
                <input type="date" class="form-control" id="walkin-date" value="${this.selectedDate}" min="${todayIso}" max="${maxDateIso}" required />
              </div>
              <div class="form-group">
                <label>Start Time (HH:mm) *</label>
                <input type="time" class="form-control" id="walkin-time" value="11:00" required />
              </div>
            </div>

            <div id="walkin-error" style="color: var(--danger); font-size: 0.85rem; margin-bottom: 12px; display: none;"></div>

            <button type="submit" class="btn btn-primary" style="width: 100%;" id="btn-submit-walkin">
              Confirm & Book Appointment →
            </button>
          </form>
        </div>
      </div>
    `;

    document.getElementById('btn-close-modal')?.addEventListener('click', () => (modalContainer.innerHTML = ''));

    document.getElementById('fast-booking-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorDiv = document.getElementById('walkin-error');
      const submitBtn = document.getElementById('btn-submit-walkin');
      submitBtn.textContent = 'Verifying Slot & Booking...';
      submitBtn.setAttribute('disabled', 'true');
      errorDiv.style.display = 'none';

      try {
        const payload = {
          serviceId: document.getElementById('walkin-service').value,
          staffId: document.getElementById('walkin-staff').value || undefined,
          date: document.getElementById('walkin-date').value,
          startTime: document.getElementById('walkin-time').value,
          customerName: document.getElementById('walkin-name').value,
          customerPhone: document.getElementById('walkin-phone').value,
          source: 'WALK_IN',
        };

        await ApiClient.createAppointment(payload);
        modalContainer.innerHTML = '';
        await this.loadData();
        this.render();
      } catch (err) {
        errorDiv.textContent = err.message || 'Could not create appointment.';
        errorDiv.style.display = 'block';
        submitBtn.textContent = 'Confirm & Book Appointment →';
        submitBtn.removeAttribute('disabled');
      }
    });
  }

  showRescheduleModal(appointmentId, serviceId, staffId, clientName) {
    const modalContainer = document.getElementById('modal-container');
    const todayIso = this.getLocalDateString();
    const maxDays = this.salonProfile?.maxAdvanceDays || 3;
    const maxDateIso = this.addDaysToDateString(todayIso, maxDays);

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content">
          <div class="modal-header">
            <h3>🔄 Reschedule Appointment</h3>
            <button class="close-btn" id="btn-close-modal">&times;</button>
          </div>
          <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 16px;">Client: <strong>${clientName}</strong></p>

          <form id="reschedule-form">
            <div class="form-group">
              <label>New Date *</label>
              <input type="date" class="form-control" id="reschedule-date" value="${this.selectedDate}" min="${todayIso}" max="${maxDateIso}" required />
            </div>

            <div class="form-group">
              <label>New Start Time (HH:mm) *</label>
              <input type="time" class="form-control" id="reschedule-time" value="12:00" required />
            </div>

            <div class="form-group">
              <label>Stylist</label>
              <select class="form-control" id="reschedule-staff">
                <option value="">👤 Keep Auto / Any Stylist</option>
                ${this.staffList.map((st) => `<option value="${st.id}" ${st.id === staffId ? 'selected' : ''}>💈 ${st.name}</option>`).join('')}
              </select>
            </div>

            <div class="form-group">
              <label>Reason for Reschedule</label>
              <input type="text" class="form-control" id="reschedule-reason" placeholder="Client requested time shift" />
            </div>

            <div id="reschedule-error" style="color: var(--danger); font-size: 0.85rem; margin-bottom: 12px; display: none;"></div>

            <div style="display: flex; flex-direction: column; gap: 10px;">
              <button type="submit" class="btn btn-primary" style="width: 100%;" id="btn-submit-reschedule">
                ⚡ Update Schedule Immediately
              </button>
              <button type="button" class="btn btn-secondary" style="width: 100%; background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35);" id="btn-propose-reschedule">
                📩 Propose to Client via WhatsApp
              </button>
            </div>
          </form>
        </div>
      </div>
    `;

    document.getElementById('btn-close-modal')?.addEventListener('click', () => (modalContainer.innerHTML = ''));

    document.getElementById('reschedule-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorDiv = document.getElementById('reschedule-error');
      const submitBtn = document.getElementById('btn-submit-reschedule');
      submitBtn.textContent = 'Rescheduling...';
      submitBtn.setAttribute('disabled', 'true');

      try {
        await ApiClient.rescheduleAppointment(appointmentId, {
          newDate: document.getElementById('reschedule-date').value,
          newStartTime: document.getElementById('reschedule-time').value,
          newStaffId: document.getElementById('reschedule-staff').value || undefined,
          reason: document.getElementById('reschedule-reason').value,
        });

        modalContainer.innerHTML = '';
        await this.loadData();
        this.render();
      } catch (err) {
        errorDiv.textContent = err.message || 'Rescheduling failed.';
        errorDiv.style.display = 'block';
        submitBtn.textContent = '⚡ Update Schedule Immediately';
        submitBtn.removeAttribute('disabled');
      }
    });

    document.getElementById('btn-propose-reschedule')?.addEventListener('click', async () => {
      const errorDiv = document.getElementById('reschedule-error');
      const proposeBtn = document.getElementById('btn-propose-reschedule');
      proposeBtn.textContent = 'Sending WhatsApp Proposal...';
      proposeBtn.setAttribute('disabled', 'true');

      try {
        const dateVal = document.getElementById('reschedule-date').value;
        const timeVal = document.getElementById('reschedule-time').value;
        const [y, m, d] = dateVal.split('-').map(Number);
        const [hh, mm] = timeVal.split(':').map(Number);
        const proposedStartAt = new Date(y, m - 1, d, hh, mm, 0);
        const proposedEndAt = new Date(proposedStartAt.getTime() + 30 * 60000);

        await ApiClient.proposeAdminReschedule(appointmentId, {
          newStartAt: proposedStartAt.toISOString(),
          newEndAt: proposedEndAt.toISOString(),
        });

        modalContainer.innerHTML = '';
        await this.loadData();
        this.render();
      } catch (err) {
        errorDiv.textContent = err.message || 'Failed to propose reschedule.';
        errorDiv.style.display = 'block';
        proposeBtn.textContent = '📩 Propose to Client via WhatsApp';
        proposeBtn.removeAttribute('disabled');
      }
    });
  }

  startLiveTimerTicks() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      const badges = document.querySelectorAll('.qc__timer-badge[data-reminder-sent]');
      badges.forEach((badge) => {
        const sentAt = badge.getAttribute('data-reminder-sent');
        if (!sentAt) return;
        const elapsedMs = Date.now() - new Date(sentAt).getTime();
        const remainingMs = (10 * 60 * 1000) - elapsedMs;
        const countdownEl = badge.querySelector('.qc__timer-countdown');
        const graceEl = badge.querySelector('.qc__grace-countdown');

        if (remainingMs > 0) {
          const mins = Math.floor(remainingMs / 60000);
          const secs = Math.floor((remainingMs % 60000) / 1000);
          if (countdownEl) {
            countdownEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
          }
        } else {
          const graceMins = Math.floor(Math.abs(remainingMs) / 60000);
          if (graceEl) {
            graceEl.textContent = `${graceMins}m`;
          }
        }
      });
    }, 1000);
  }




  showCancelModal(appointmentId, clientName) {
    const modalContainer = document.getElementById('modal-container');

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content">
          <div class="modal-header">
            <h3 style="color: var(--danger);">✕ Cancel Appointment</h3>
            <button class="close-btn" id="btn-close-modal">&times;</button>
          </div>
          <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 16px;">
            Cancel booking for <strong>${clientName}</strong>. Select the cancellation reason category below:
          </p>

          <form id="cancel-form">
            <div class="form-group">
              <label>Penalty Setting *</label>
              <select class="form-control" id="cancel-penalty-select" required>
                <option value="NO_PENALTY">🟢 Cancel WITHOUT Penalty (Waive Strike / 0 Strikes)</option>
                <option value="APPLY_PENALTY">🔴 Cancel WITH Penalty (+1 Strike to Customer)</option>
              </select>
            </div>

            <div class="form-group">
              <label>Cancellation Reason Category *</label>
              <select class="form-control" id="cancel-category-select" required>
                <option value="SALON_EMERGENCY">🔵 Salon Emergency / Barber Unavailable</option>
                <option value="CLIENT_UNRESPONSIVE">🔴 Client Unresponsive / Client Mistake</option>
                <option value="CLIENT_CANCELLED">⚪ Customer Requested Cancellation</option>
              </select>
            </div>

            <div class="form-group">
              <label>Specific Note (Optional)</label>
              <input type="text" class="form-control" id="cancel-reason-note" placeholder="Client didn't answer phone call..." />
            </div>

            <button type="submit" class="btn btn-secondary" style="width: 100%; color: var(--danger); border-color: var(--danger);" id="btn-submit-cancel">
              Confirm Cancellation
            </button>
          </form>
        </div>
      </div>
    `;

    document.getElementById('btn-close-modal')?.addEventListener('click', () => (modalContainer.innerHTML = ''));

    document.getElementById('cancel-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('btn-submit-cancel');
      submitBtn.textContent = 'Processing Cancellation...';
      submitBtn.setAttribute('disabled', 'true');

      const penaltyMode = document.getElementById('cancel-penalty-select').value;
      const reasonCategory = document.getElementById('cancel-category-select').value;
      const reasonNote = document.getElementById('cancel-reason-note').value || '';
      const applyPenalty = penaltyMode === 'APPLY_PENALTY';
      const noPenalty = penaltyMode === 'NO_PENALTY';

      try {
        await ApiClient.cancelBooking(appointmentId, {
          source: 'ADMIN_DASHBOARD',
          fault: applyPenalty ? 'CLIENT' : 'SALON',
          applyPenalty,
          noPenalty,
          reason: reasonNote || reasonCategory,
        });
        modalContainer.innerHTML = '';
        await this.loadData();
        this.render();
      } catch (err) {
        alert(`Failed to cancel: ${err.message}`);
        submitBtn.textContent = 'Confirm Cancellation';
        submitBtn.removeAttribute('disabled');
      }
    });
  }

  attachStaffScheduleListeners(root) {
    if (!root) return;

    // Toggle Single Staff Schedule (On-Demand)
    root.querySelectorAll('.btn-toggle-staff-schedule').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        if (!id) return;
        this.openStaffScheduleIds = this.openStaffScheduleIds || new Set();
        if (this.openStaffScheduleIds.has(id)) {
          this.openStaffScheduleIds.delete(id);
        } else {
          this.openStaffScheduleIds.add(id);
        }
        this.refreshActiveTab();
      });
    });

    // Toggle All Staff Schedules (Master Toolbar Action)
    root.querySelector('#btn-toggle-all-schedules')?.addEventListener('click', () => {
      this.openStaffScheduleIds = this.openStaffScheduleIds || new Set();
      const allIds = (this.staffList || []).map((s) => s.id);
      const allOpen = allIds.length > 0 && allIds.every((id) => this.openStaffScheduleIds.has(id));
      if (allOpen) {
        this.openStaffScheduleIds.clear();
      } else {
        allIds.forEach((id) => this.openStaffScheduleIds.add(id));
      }
      this.refreshActiveTab();
    });

    // Switch View Mode (Timeline vs Agenda)
    root.querySelectorAll('.btn-switch-sched-view').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const mode = e.currentTarget.getAttribute('data-mode');
        if (!id || !mode) return;
        this.staffScheduleViewMode = this.staffScheduleViewMode || {};
        this.staffScheduleViewMode[id] = mode;
        this.refreshActiveTab();
      });
    });

    // Horizontal Scroll: Jump to NOW
    root.querySelectorAll('.btn-jump-now').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const track = root.querySelector(`#timeline-track-${id}`) || document.getElementById(`timeline-track-${id}`);
        const nowLeft = Number(e.currentTarget.getAttribute('data-now-left')) || 0;
        if (track) {
          track.scrollTo({ left: Math.max(0, nowLeft - 160), behavior: 'smooth' });
        }
      });
    });

    // Horizontal Scroll: Scroll Earlier
    root.querySelectorAll('.btn-scroll-earlier').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const track = root.querySelector(`#timeline-track-${id}`) || document.getElementById(`timeline-track-${id}`);
        if (track) {
          track.scrollBy({ left: -220, behavior: 'smooth' });
        }
      });
    });

    // Horizontal Scroll: Scroll Later
    root.querySelectorAll('.btn-scroll-later').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const track = root.querySelector(`#timeline-track-${id}`) || document.getElementById(`timeline-track-${id}`);
        if (track) {
          track.scrollBy({ left: 220, behavior: 'smooth' });
        }
      });
    });

    // Center live track initial scroll
    root.querySelectorAll('.staff-timeline-scroll-track').forEach((track) => {
      const initialScroll = Number(track.getAttribute('data-initial-scroll')) || 0;
      if (initialScroll > 0) {
        setTimeout(() => {
          track.scrollLeft = initialScroll;
        }, 50);
      }
    });
  }

  async handleToggleStaff(id) {
    if (!id || this._isTogglingStaff) return;
    this._isTogglingStaff = true;
    this.lastLocalActionTimestamp = Date.now();

    try {
      const idx = this.staffList.findIndex((s) => String(s.id) === String(id));
      if (idx !== -1) {
        this.staffList[idx] = {
          ...this.staffList[idx],
          status: this.staffList[idx].status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
        };
        this.render();
      }
      await ApiClient.toggleStaffStatus(id);
      this.loadData(true).then(() => this.refreshActiveTab()).catch(() => { });
    } catch (err) {
      alert(`Status update failed: ${err.message}`);
      this.loadData(true).then(() => this.render()).catch(() => { });
    } finally {
      setTimeout(() => {
        this._isTogglingStaff = false;
      }, 400);
    }
  }

  showAddStaffModal() {
    const modalContainer = document.getElementById('modal-container');
    const defaultPhone = this.salonProfile?.phone || this.currentUser?.salon?.phone || this.currentUser?.phone || '';
    const defaultEmail = this.salonProfile?.email || this.currentUser?.salon?.email || this.currentUser?.email || '';
    const hasServices = Array.isArray(this.servicesList) && this.servicesList.length > 0;

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content">
          <div class="modal-header">
            <h3>👥 Add Stylist Member</h3>
            <button class="close-btn" id="btn-close-modal">&times;</button>
          </div>

          <form id="add-staff-form">
            <div class="form-group">
              <label>Full Name *</label>
              <input type="text" class="form-control" id="new-staff-name" placeholder="e.g. Vikram Sharma" required />
            </div>

            <div class="form-group">
              <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px;">
                <label style="margin: 0;">Phone Number *</label>
                ${defaultPhone ? `<span style="font-size: 0.72rem; color: #34d399; font-weight: 500;">✓ Pre-filled with salon phone</span>` : ''}
              </div>
              <input type="tel" class="form-control" id="new-staff-phone" value="${defaultPhone}" placeholder="+91 98XXXXXX00" required />
              <small style="display: block; margin-top: 4px; font-size: 0.75rem; color: var(--text-muted);">Defaulted to salon phone number. You can change this to stylist's personal number.</small>
            </div>

            <div class="form-group">
              <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px;">
                <label style="margin: 0;">Email Address</label>
                ${defaultEmail ? `<span style="font-size: 0.72rem; color: #A855F7; font-weight: 500;">✓ Pre-filled with salon email</span>` : ''}
              </div>
              <input type="email" class="form-control" id="new-staff-email" value="${defaultEmail}" placeholder="stylist@example.com" />
              <small style="display: block; margin-top: 4px; font-size: 0.75rem; color: var(--text-muted);">Defaulted to salon email. You can change this if needed.</small>
            </div>

            <div class="form-group">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <label style="margin: 0; font-size: 0.88rem; font-weight: 600;">Select Qualified Services</label>
                <span style="font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #a5b4fc; background: rgba(139, 61, 255, 0.12); padding: 2px 8px; border-radius: 9999px; border: 1px solid rgba(139, 61, 255, 0.25);">Optional</span>
              </div>

              ${hasServices ? `
                <div style="max-height: 160px; overflow-y: auto; background: var(--bg-input, #0f172a); padding: 10px; border-radius: 8px; border: 1px solid var(--border-subtle, rgba(255,255,255,0.1)); display: flex; flex-direction: column; gap: 6px;">
                  ${this.servicesList.map((s) => `
                    <label style="display: flex; align-items: center; gap: 10px; font-size: 0.86rem; padding: 7px 10px; border-radius: 6px; cursor: pointer; transition: background 0.15s ease; background: rgba(255, 255, 255, 0.03);" onmouseover="this.style.background='rgba(139, 61, 255,0.12)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'">
                      <input type="checkbox" class="staff-service-chk" value="${s.id}" checked style="accent-color: var(--primary-accent, #8B3DFF); cursor: pointer; width: 16px; height: 16px;" />
                      <span style="font-weight: 500; color: #f1f5f9;">${s.name}</span>
                      <span style="margin-left: auto; color: #94a3b8; font-size: 0.8rem; background: rgba(255,255,255,0.06); padding: 2px 7px; border-radius: 4px; font-weight: 600;">₹${s.price}</span>
                    </label>
                  `).join('')}
                </div>
              ` : `
                <div style="background: rgba(30, 41, 59, 0.45); border: 1px dashed rgba(148, 163, 184, 0.25); border-radius: 10px; padding: 16px; text-align: center;">
                  <div style="display: flex; align-items: center; justify-content: center; gap: 8px; color: #f59e0b; font-size: 0.88rem; font-weight: 600; margin-bottom: 5px;">
                    <span>✂️ No Services in Catalog Yet</span>
                  </div>
                  <p style="font-size: 0.8rem; color: #94a3b8; margin: 0 0 12px 0; line-height: 1.45;">
                    You can add this stylist now and assign qualified services anytime after adding services in the <strong>Service Menu</strong> tab.
                  </p>
                  <button type="button" id="btn-quick-goto-services" style="display: inline-flex; align-items: center; gap: 6px; font-size: 0.78rem; font-weight: 600; color: #A855F7; background: rgba(139, 61, 255, 0.12); border: 1px solid rgba(139, 61, 255, 0.3); border-radius: 6px; padding: 6px 14px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(139, 61, 255,0.22)'" onmouseout="this.style.background='rgba(139, 61, 255,0.12)'">
                    <span>+ Add Services to Menu First</span>
                  </button>
                </div>
              `}
            </div>

            <button type="submit" class="btn btn-primary" style="width: 100%;">Create Stylist Member →</button>
          </form>
        </div>
      </div>
    `;

    document.getElementById('btn-close-modal')?.addEventListener('click', () => (modalContainer.innerHTML = ''));

    document.getElementById('btn-quick-goto-services')?.addEventListener('click', () => {
      modalContainer.innerHTML = '';
      this.switchTab('services');
      setTimeout(() => this.showAddServiceModal(), 120);
    });

    document.getElementById('add-staff-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = e.target.querySelector('button[type="submit"]');
      const originalText = submitBtn.innerHTML;
      submitBtn.textContent = 'Adding Stylist Member...';
      submitBtn.setAttribute('disabled', 'true');

      try {
        const selectedServices = Array.from(document.querySelectorAll('.staff-service-chk:checked')).map((c) => c.value);

        this.lastLocalActionTimestamp = Date.now();
        const created = await ApiClient.createStaff({
          name: document.getElementById('new-staff-name').value.trim(),
          phone: document.getElementById('new-staff-phone').value.trim(),
          email: document.getElementById('new-staff-email')?.value?.trim() || undefined,
          serviceIds: selectedServices,
        });

        if (created && created.id) {
          this.staffList = [created, ...this.staffList.filter((s) => s.id !== created.id)];
        }

        modalContainer.innerHTML = '';
        this.render();

        this.loadData(true).then(() => {
          this.refreshActiveTab();
        }).catch(() => { });
      } catch (err) {
        submitBtn.innerHTML = originalText;
        submitBtn.removeAttribute('disabled');
        alert(`Failed: ${err.message}`);
      }
    });
  }

  showAssignServicesModal(staffId, staffName) {
    const modalContainer = document.getElementById('modal-container');
    const staff = this.staffList.find((s) => s.id === staffId);
    const assignedIds = (staff?.services || []).map((s) => s.serviceId || s.service?.id);
    const hasServices = Array.isArray(this.servicesList) && this.servicesList.length > 0;

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content">
          <div class="modal-header">
            <h3>✂️ Assign Qualified Services</h3>
            <button class="close-btn" id="btn-close-modal">&times;</button>
          </div>
          <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 16px;">Configure which services <strong>${staffName}</strong> can perform.</p>

          ${hasServices ? `
            <form id="assign-services-form">
              <div style="max-height: 220px; overflow-y: auto; background: var(--bg-input, #0f172a); padding: 12px; border-radius: 8px; border: 1px solid var(--border-subtle); margin-bottom: 20px; display: flex; flex-direction: column; gap: 6px;">
                ${this.servicesList.map((s) => `
                  <label style="display: flex; align-items: center; gap: 10px; font-size: 0.88rem; padding: 7px 10px; border-radius: 6px; cursor: pointer; transition: background 0.15s ease; background: rgba(255, 255, 255, 0.03);" onmouseover="this.style.background='rgba(139, 61, 255,0.12)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'">
                    <input type="checkbox" class="chk-assign-svc" value="${s.id}" ${assignedIds.includes(s.id) ? 'checked' : ''} style="accent-color: var(--primary-accent, #8B3DFF); cursor: pointer; width: 16px; height: 16px;" />
                    <span style="font-weight: 600; color: #f1f5f9;">${s.name}</span>
                    <span style="margin-left: auto; color: #94a3b8; font-size: 0.8rem; background: rgba(255,255,255,0.06); padding: 2px 7px; border-radius: 4px;">₹${s.price} • ${s.durationMinutes}m</span>
                  </label>
                `).join('')}
              </div>

              <button type="submit" class="btn btn-primary" style="width: 100%;">Save Qualifications →</button>
            </form>
          ` : `
            <div style="background: rgba(30, 41, 59, 0.45); border: 1px dashed rgba(148, 163, 184, 0.25); border-radius: 10px; padding: 18px 16px; text-align: center; margin-bottom: 16px;">
              <p style="color: #f59e0b; font-size: 0.9rem; font-weight: 600; margin-bottom: 6px;">⚠️ No Services in Catalog Yet</p>
              <p style="font-size: 0.8rem; color: #94a3b8; margin: 0 0 14px 0; line-height: 1.45;">
                There are no active services created in this salon yet. Create services first in the Service Menu tab to assign them to <strong>${staffName}</strong>.
              </p>
              <button type="button" id="btn-assign-goto-services" class="btn btn-primary btn-sm" style="margin: 0 auto; display: inline-flex; align-items: center; gap: 6px;">
                <span>+ Go to Service Menu</span>
              </button>
            </div>
          `}
        </div>
      </div>
    `;

    document.getElementById('btn-close-modal')?.addEventListener('click', () => (modalContainer.innerHTML = ''));

    document.getElementById('btn-assign-goto-services')?.addEventListener('click', () => {
      modalContainer.innerHTML = '';
      this.switchTab('services');
      setTimeout(() => this.showAddServiceModal(), 120);
    });

    document.getElementById('assign-services-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const selected = Array.from(document.querySelectorAll('.chk-assign-svc:checked')).map((c) => c.value);
      try {
        const updated = await ApiClient.assignStaffServices(staffId, selected);
        const idx = this.staffList.findIndex((s) => String(s.id) === String(staffId));
        if (idx !== -1 && updated) {
          this.staffList[idx] = { ...this.staffList[idx], ...updated };
        }
        modalContainer.innerHTML = '';
        this.render();

        this.loadData(true).then(() => {
          this.refreshActiveTab();
        }).catch(() => { });
      } catch (err) {
        alert(err.message);
      }
    });
  }

  async showAddBreakModal(staffId, staffName) {
    const modalContainer = document.getElementById('modal-container');

    const formatTime12h = (t) => {
      if (!t) return '';
      const [hStr, mStr] = t.split(':');
      let h = parseInt(hStr, 10);
      const ampm = h >= 12 ? 'PM' : 'AM';
      h = h % 12 || 12;
      return `${h.toString().padStart(2, '0')}:${mStr || '00'} ${ampm}`;
    };

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content modal-content-sheet" style="max-width: 520px; max-height: 90vh; overflow-y: auto;">
          <div class="sheet-grab-handle"></div>
          <div class="modal-header" style="margin-bottom: 12px; padding-bottom: 10px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 1.25rem;">☕</span>
              <div>
                <h3 style="font-size: 1.15rem; font-weight: 700; color: #fff; margin: 0;">Shift Breaks: ${staffName}</h3>
                <span style="font-size: 0.74rem; color: #94a3b8;">Review inherited salon downtime and manage personal stylist shift breaks.</span>
              </div>
            </div>
            <button class="close-btn" id="btn-close-modal">&times;</button>
          </div>

          <div style="text-align: center; padding: 30px;" id="break-modal-loading">
            <span style="font-size: 0.85rem; color: #94a3b8;">Loading breaks schedule for ${staffName}...</span>
          </div>

          <div id="break-modal-body" style="display: none;">
            <div class="form-group" style="margin-bottom: 14px;">
              <label style="font-size: 0.78rem; font-weight: 700; color: #cbd5e1; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between;">
                <span>Select Day of Week *</span>
                <span id="day-break-count-badge" style="font-size: 0.72rem; font-weight: 600; color: #34d399;"></span>
              </label>
              <select class="form-control" id="break-day" required style="padding: 10px 12px; font-size: 0.88rem; background: rgba(15,23,42,0.8); border: 1px solid rgba(255,255,255,0.12);">
                <option value="MONDAY">Monday</option>
                <option value="TUESDAY">Tuesday</option>
                <option value="WEDNESDAY">Wednesday</option>
                <option value="THURSDAY">Thursday</option>
                <option value="FRIDAY">Friday</option>
                <option value="SATURDAY">Saturday</option>
                <option value="SUNDAY">Sunday</option>
              </select>
            </div>

            <!-- Active Breaks Reference Section for Selected Day -->
            <div id="active-day-breaks-container" style="margin-bottom: 16px;"></div>

            <!-- Add Additional Personal Break Container -->
            <div style="background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.07); border-radius: var(--radius-md); padding: 14px; margin-bottom: 14px;">
              <div style="font-size: 0.82rem; font-weight: 700; color: #f1f5f9; margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
                <span>➕</span>
                <span>Add Personal Break for <span id="label-selected-day" style="color: #A855F7;">Monday</span></span>
              </div>

              <form id="add-break-form">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
                  <div class="form-group" style="margin-bottom: 0;">
                    <label style="font-size: 0.76rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; display: block;">Start Time *</label>
                    <input type="time" class="form-control" id="break-start" required style="padding: 9px 12px; font-size: 0.88rem;" />
                  </div>
                  <div class="form-group" style="margin-bottom: 0;">
                    <label style="font-size: 0.76rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; display: block;">End Time *</label>
                    <input type="time" class="form-control" id="break-end" required style="padding: 9px 12px; font-size: 0.88rem;" />
                  </div>
                </div>

                <div id="break-duration-preview" style="display: none; padding: 6px 10px; border-radius: var(--radius-sm); font-size: 0.76rem; font-weight: 600; margin-bottom: 12px;"></div>

                <div class="form-group" style="margin-bottom: 14px;">
                  <label style="font-size: 0.76rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; display: block;">Break Label (Optional)</label>
                  <input type="text" class="form-control" id="break-title" placeholder="e.g. Tea Break / Afternoon Rest" style="padding: 9px 12px; font-size: 0.88rem;" />
                </div>

                <div id="break-form-error" style="display: none; color: #f87171; background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.25); border-radius: 6px; padding: 8px 10px; font-size: 0.76rem; margin-bottom: 12px;"></div>

                <button type="submit" class="btn btn-primary" id="btn-submit-break" style="width: 100%; min-height: 42px; font-weight: 700; background: linear-gradient(135deg, #8B3DFF 0%, #9D5CFF 100%);">
                  Save Personal Break →
                </button>
              </form>
            </div>

            <div style="display: flex; justify-content: flex-end;">
              <button type="button" class="btn btn-secondary" id="btn-cancel-modal" style="min-height: 38px; padding: 6px 20px;">Close</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-close-modal')?.addEventListener('click', () => (modalContainer.innerHTML = ''));
    document.getElementById('btn-cancel-modal')?.addEventListener('click', () => (modalContainer.innerHTML = ''));

    let staffBreaks = [];
    try {
      staffBreaks = await ApiClient.getStaffBreaks(staffId, true);
    } catch (err) {
      console.warn('[StaffBreaks] Failed to fetch breaks:', err);
      staffBreaks = [];
    }

    const loadingDiv = document.getElementById('break-modal-loading');
    const bodyDiv = document.getElementById('break-modal-body');
    if (loadingDiv) loadingDiv.style.display = 'none';
    if (bodyDiv) bodyDiv.style.display = 'block';

    const daySelect = document.getElementById('break-day');
    const dayLabel = document.getElementById('label-selected-day');
    const breaksContainer = document.getElementById('active-day-breaks-container');
    const countBadge = document.getElementById('day-break-count-badge');
    const bStart = document.getElementById('break-start');
    const bEnd = document.getElementById('break-end');
    const preview = document.getElementById('break-duration-preview');
    const formError = document.getElementById('break-form-error');

    const updateDurationPreview = () => {
      if (!bStart || !bEnd || !preview) return;
      if (bStart.value && bEnd.value) {
        const [sh, sm] = bStart.value.split(':').map(Number);
        const [eh, em] = bEnd.value.split(':').map(Number);
        const diff = (eh * 60 + em) - (sh * 60 + sm);
        if (diff > 0) {
          const selectedDay = daySelect.value;
          const currentSalonBreaks = staffBreaks.filter(b => b.dayOfWeek === selectedDay && b.origin === 'SALON');
          const overlappingSalonBreak = currentSalonBreaks.find(sb => {
            const [sbSh, sbSm] = sb.startTime.split(':').map(Number);
            const [sbEh, sbEm] = sb.endTime.split(':').map(Number);
            const sbStartM = sbSh * 60 + sbSm;
            const sbEndM = sbEh * 60 + sbEm;
            const curStartM = sh * 60 + sm;
            const curEndM = eh * 60 + em;
            return curStartM < sbEndM && curEndM > sbStartM;
          });

          preview.style.display = 'block';
          if (overlappingSalonBreak) {
            preview.style.background = 'rgba(245, 158, 11, 0.12)';
            preview.style.border = '1px solid rgba(245, 158, 11, 0.3)';
            preview.style.color = '#fbbf24';
            preview.textContent = `⏱️ ${diff} mins • ℹ️ Overlaps with Salon Break (${formatTime12h(overlappingSalonBreak.startTime)} - ${formatTime12h(overlappingSalonBreak.endTime)}). Facility downtime already protects this slot.`;
          } else {
            preview.style.background = 'rgba(16, 185, 129, 0.12)';
            preview.style.border = '1px solid rgba(16, 185, 129, 0.3)';
            preview.style.color = '#34d399';
            preview.textContent = `⏱️ Break Duration: ${diff} minutes`;
          }
        } else {
          preview.style.display = 'block';
          preview.style.background = 'rgba(239, 68, 68, 0.12)';
          preview.style.border = '1px solid rgba(239, 68, 68, 0.3)';
          preview.style.color = '#f87171';
          preview.textContent = `⚠️ End time must be later than start time.`;
        }
      } else {
        preview.style.display = 'none';
      }
    };

    bStart?.addEventListener('change', updateDurationPreview);
    bEnd?.addEventListener('change', updateDurationPreview);

    const renderDayBreaks = (selectedDay) => {
      const dayBreaks = staffBreaks.filter((b) => b.dayOfWeek === selectedDay);
      const salonBreaks = dayBreaks.filter((b) => b.origin === 'SALON');
      const stylistBreaks = dayBreaks.filter((b) => b.origin === 'STYLIST');

      if (dayLabel) {
        dayLabel.textContent = selectedDay.charAt(0) + selectedDay.slice(1).toLowerCase();
      }

      if (countBadge) {
        const total = salonBreaks.length + stylistBreaks.length;
        countBadge.textContent = total > 0 ? `${total} Active Break${total === 1 ? '' : 's'}` : '0 Breaks';
      }

      let html = '';

      // 1. Salon Facility Breaks Banner
      if (salonBreaks.length > 0) {
        html += `
          <div style="background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: var(--radius-sm); padding: 10px 12px; margin-bottom: 10px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <span style="font-size: 0.78rem; font-weight: 700; color: #34d399; display: flex; align-items: center; gap: 6px;">
                <span>🏢 Active Salon Facility Breaks (${salonBreaks.length})</span>
              </span>
              <span class="badge-salon-lock">🔒 Inherited & Active</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 6px;">
              ${salonBreaks.map((sb) => `
                <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.3); padding: 7px 10px; border-radius: 5px; border: 1px solid rgba(16,185,129,0.25);">
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 0.84rem; font-weight: 700; color: #fff;">${formatTime12h(sb.startTime)} – ${formatTime12h(sb.endTime)}</span>
                    <span style="font-size: 0.74rem; color: #a7f3d0; background: rgba(16,185,129,0.18); padding: 1px 7px; border-radius: 4px; font-weight: 600;">
                      ${sb.title || 'Lunch Break'}
                    </span>
                  </div>
                  <span style="font-size: 0.7rem; color: #34d399; font-weight: 600;">Active for ${staffName}</span>
                </div>
              `).join('')}
            </div>
            <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 6px; line-height: 1.35;">
              ℹ️ Inherited from the Salon Operating Schedule. Booking slots during this window are completely blocked across all stylists.
            </div>
          </div>
        `;
      }

      // 2. Stylist Personal Shift Breaks
      if (stylistBreaks.length > 0) {
        html += `
          <div style="background: rgba(139, 92, 246, 0.08); border: 1px solid rgba(139, 92, 246, 0.3); border-radius: var(--radius-sm); padding: 10px 12px; margin-bottom: 10px;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
              <span style="font-size: 0.78rem; font-weight: 700; color: #c4b5fd; display: flex; align-items: center; gap: 6px;">
                <span>☕ Stylist Personal Breaks (${stylistBreaks.length})</span>
              </span>
              <span class="badge-stylist-personal">👤 Custom Shift</span>
            </div>
            <div style="display: flex; flex-direction: column; gap: 6px;">
              ${stylistBreaks.map((pb) => `
                <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.3); padding: 7px 10px; border-radius: 5px; border: 1px solid rgba(139,92,246,0.25);">
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 0.84rem; font-weight: 700; color: #fff;">${formatTime12h(pb.startTime)} – ${formatTime12h(pb.endTime)}</span>
                    <span style="font-size: 0.74rem; color: #ddd6fe; background: rgba(139,92,246,0.18); padding: 1px 7px; border-radius: 4px; font-weight: 600;">
                      ${pb.title || 'Personal Break'}
                    </span>
                  </div>
                  <button type="button" class="btn-delete-staff-break" data-break-id="${pb.id}" style="background: rgba(239,68,68,0.18); color: #f87171; border: 1px solid rgba(239,68,68,0.3); padding: 3px 8px; font-size: 0.72rem; border-radius: 4px; cursor: pointer; display: flex; align-items: center; gap: 4px;">
                    <span>🗑</span>
                    <span>Remove</span>
                  </button>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      if (salonBreaks.length === 0 && stylistBreaks.length === 0) {
        html += `
          <div style="background: rgba(255, 255, 255, 0.03); border: 1px dashed rgba(255, 255, 255, 0.1); border-radius: var(--radius-sm); padding: 12px; margin-bottom: 10px; text-align: center;">
            <span style="color: var(--text-muted); font-size: 0.78rem;">No breaks scheduled for ${selectedDay.charAt(0) + selectedDay.slice(1).toLowerCase()}. Stylist is available throughout the operating shift.</span>
          </div>
        `;
      }

      breaksContainer.innerHTML = html;

      // Wire delete buttons for personal breaks
      breaksContainer.querySelectorAll('.btn-delete-staff-break').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          const breakId = e.currentTarget.getAttribute('data-break-id');
          if (!confirm('Are you sure you want to remove this personal break?')) return;
          try {
            await ApiClient.deleteStaffBreak(staffId, breakId);
            staffBreaks = await ApiClient.getStaffBreaks(staffId, true);
            renderDayBreaks(daySelect.value);
            this.loadData(true).then(() => {
              this.refreshActiveTab();
            }).catch(() => { });
          } catch (err) {
            alert(err.message || 'Failed to delete break');
          }
        });
      });

      updateDurationPreview();
    };

    daySelect?.addEventListener('change', (e) => {
      renderDayBreaks(e.target.value);
    });

    // Default to MONDAY or current day
    renderDayBreaks(daySelect.value || 'MONDAY');

    document.getElementById('add-break-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('btn-submit-break');
      if (formError) formError.style.display = 'none';
      if (submitBtn) {
        submitBtn.textContent = 'Saving Shift Break...';
        submitBtn.setAttribute('disabled', 'true');
      }

      try {
        await ApiClient.createStaffBreak(staffId, {
          dayOfWeek: daySelect.value,
          startTime: document.getElementById('break-start').value,
          endTime: document.getElementById('break-end').value,
          title: document.getElementById('break-title').value || 'Personal Break',
        });

        // Refetch breaks and update view
        staffBreaks = await ApiClient.getStaffBreaks(staffId, true);
        renderDayBreaks(daySelect.value);

        // Reset form inputs
        document.getElementById('break-start').value = '';
        document.getElementById('break-end').value = '';
        document.getElementById('break-title').value = '';
        if (preview) preview.style.display = 'none';

        if (submitBtn) {
          submitBtn.textContent = 'Save Personal Break →';
          submitBtn.removeAttribute('disabled');
        }

        this.loadData(true).then(() => {
          this.refreshActiveTab();
        }).catch(() => { });
      } catch (err) {
        if (formError) {
          formError.textContent = err.message || 'Failed to save shift break';
          formError.style.display = 'block';
        } else {
          alert(err.message);
        }
        if (submitBtn) {
          submitBtn.textContent = 'Save Personal Break →';
          submitBtn.removeAttribute('disabled');
        }
      }
    });
  }

  showMarkAbsentModal(staffId, staffName) {
    StaffApplyLeaveDialog.open({
      staffId: staffId || null,
      staffName: staffName || null,
      showModeSwitch: !staffId,
      salonWorkingHours: this.salonWorkingHours || [],
      staffList: this.staffList || [],
      onSuccess: async () => {
        await this.loadData(true);
      },
    });
  }

  showLeaveHistoryModal(staffId, staffName) {
    this.leaveUI.showLeaveHistoryModal(staffId, staffName);
  }

  showAbsenceResultModal(staffName, result) {
    this.leaveUI.showLeaveResultModal(staffName, result);
  }

  showBlockTimeModal() {
    const modalContainer = document.getElementById('modal-container');

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content">
          <div class="modal-header">
            <h3>🚫 Block Emergency Time / Leave</h3>
            <button class="close-btn" id="btn-close-modal">&times;</button>
          </div>
          <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 16px;">Temporarily block time slots for a single stylist or the entire salon.</p>

          <form id="block-time-form">
            <div class="form-group">
              <label>Target Stylist / Salon *</label>
              <select class="form-control" id="block-target" required>
                <option value="">🏢 Whole Salon (e.g. Power Cut / Maintenance)</option>
                ${this.staffList.map((st) => `<option value="${st.id}">👤 ${st.name}</option>`).join('')}
              </select>
            </div>

            <div class="form-group">
              <label>Date *</label>
              <input type="date" class="form-control" id="block-date" value="${this.selectedDate}" required />
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
              <div class="form-group">
                <label>Start Time (HH:mm) *</label>
                <input type="time" class="form-control" id="block-start-time" value="14:00" required />
              </div>
              <div class="form-group">
                <label>End Time (HH:mm) *</label>
                <input type="time" class="form-control" id="block-end-time" value="16:00" required />
              </div>
            </div>

            <div class="form-group">
              <label>Reason *</label>
              <input type="text" class="form-control" id="block-reason" placeholder="e.g. Doctor Visit / Personal Leave" required />
            </div>

            <button type="submit" class="btn btn-primary" style="width: 100%;">Save Blocked Time →</button>
          </form>
        </div>
      </div>
    `;

    document.getElementById('btn-close-modal')?.addEventListener('click', () => (modalContainer.innerHTML = ''));

    document.getElementById('block-time-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const staffId = document.getElementById('block-target').value || undefined;
      const date = document.getElementById('block-date').value;
      const startTime = document.getElementById('block-start-time').value;
      const endTime = document.getElementById('block-end-time').value;
      const reason = document.getElementById('block-reason').value;

      try {
        await ApiClient.addBlockedTime({
          staffId,
          startTime: `${date}T${startTime}:00.000Z`,
          endTime: `${date}T${endTime}:00.000Z`,
          reason,
        });

        modalContainer.innerHTML = '';
        await this.loadData();
        this.render();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  async showManageCategoriesModal() {
    const modalContainer = document.getElementById('modal-container');
    try {
      this.categoriesList = await ApiClient.getServiceCategories(true).catch(() => []);
    } catch (e) {
      console.warn('Failed to load categories', e);
    }
    const categories = Array.isArray(this.categoriesList) ? this.categoriesList : [];

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content modal-content-md" style="max-height: 90vh; overflow-y: auto;">
          <div class="modal-header">
            <h3>📂 Manage Service Categories</h3>
            <button class="close-btn" id="btn-close-modal">&times;</button>
          </div>
          <div style="padding: 16px;">
            <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 16px;">
              Categories organize your services in the WhatsApp booking flow and customer menu.
            </p>
            
            <!-- Category Create Form -->
            <form id="add-category-form" style="display: flex; gap: 8px; margin-bottom: 20px; align-items: flex-end;">
              <div style="flex: 2;">
                <label style="font-size: 0.8rem;">Category Name *</label>
                <input type="text" class="form-control" id="cat-name-input" placeholder="e.g. Hair Care, Facials" required />
              </div>
              <div style="flex: 1;">
                <label style="font-size: 0.8rem;">Icon/Emoji</label>
                <input type="text" class="form-control" id="cat-icon-input" placeholder="✂️" value="✂️" />
              </div>
              <button type="submit" class="btn btn-primary btn-sm" style="height: 38px;">➕ Add</button>
            </form>

            <div class="category-list" style="display: flex; flex-direction: column; gap: 8px;">
              ${categories.length === 0 ? `
                <div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 0.85rem;">No categories created yet. Add one above!</div>
              ` : categories.map((c) => `
                <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.05); padding: 10px 14px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                  <div style="display: flex; align-items: center; gap: 10px;">
                    <span style="font-size: 1.1rem;">${c.icon || '📂'}</span>
                    <strong style="color: #fff; font-size: 0.95rem;">${c.name}</strong>
                  </div>
                  <div style="display: flex; gap: 6px;">
                    <button class="btn btn-danger-outline btn-sm btn-delete-cat" data-id="${c.id}" data-name="${c.name}" style="padding: 4px 10px;" title="Delete Category">
                      ${Icons.trash({ size: 12 })}
                    </button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-close-modal')?.addEventListener('click', () => {
      modalContainer.innerHTML = '';
    });

    document.getElementById('add-category-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('cat-name-input').value.trim();
      const icon = document.getElementById('cat-icon-input').value.trim() || '✂️';
      if (!name) return;
      try {
        await ApiClient.createServiceCategory({ name, icon });
        showNotification(`Category "${name}" created!`, 'success');
        this.categoriesList = await ApiClient.getServiceCategories(true);
        await this.showManageCategoriesModal();
        await this.loadData(true);
      } catch (err) {
        showNotification(err.message || 'Failed to create category', 'error');
      }
    });

    document.querySelectorAll('.btn-delete-cat').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const id = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name');
        if (confirm(`Delete category "${name}"? Services in this category will become general uncategorized services.`)) {
          try {
            await ApiClient.deleteServiceCategory(id);
            showNotification(`Category "${name}" deleted`, 'success');
            this.categoriesList = await ApiClient.getServiceCategories(true);
            await this.showManageCategoriesModal();
            await this.loadData(true);
          } catch (err) {
            showNotification(err.message || 'Failed to delete category', 'error');
          }
        }
      });
    });
  }

  showAddServiceModal() {
    if (document.getElementById('add-service-form')) return;
    const modalContainer = this.getModalContainer();
    const activeStaff = (this.staffList || []).filter((st) => st.status === 'ACTIVE' || !st.status);

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content modal-content-lg" style="max-height: 90vh; overflow-y: auto;">
          <div class="modal-header">
            <h3>✂️ Add New Service</h3>
            <button class="close-btn" id="btn-close-modal">&times;</button>
          </div>

          <form id="add-service-form">
            <!-- 1. Category Selector Dropdown -->
            <div class="form-group">
              <label>Service Category *</label>
              <select class="form-control" id="svc-category-select" required>
                ${this.categoriesList && this.categoriesList.length > 0
        ? this.categoriesList.map((c) => `<option value="${c.name}" data-id="${c.id}">${c.icon || '✂️'} ${c.name}</option>`).join('') + '<option value="CUSTOM">➕ Other / Custom Category...</option>'
        : '<option value="CUSTOM" selected>➕ Create Custom Category...</option>'
      }
              </select>
            </div>

            <!-- Custom Category Input (Revealed if Other is picked) -->
            <div class="form-group" id="svc-custom-cat-group" style="${this.categoriesList && this.categoriesList.length > 0 ? 'display: none;' : 'display: block;'}">
              <label>Custom Category Name *</label>
              <input type="text" class="form-control" id="svc-custom-cat-input" placeholder="e.g. Bridal Special, Pedicure, Tattoo" />
            </div>

            <!-- Target Audience / Gender -->
            <div class="form-group">
              <label>Target Audience / Gender *</label>
              <select class="form-control" id="svc-gender" required>
                <option value="UNISEX" selected>✂️ Unisex (Both Men & Women)</option>
                <option value="MALE">👨 Men Only</option>
                <option value="FEMALE">👩 Women Only</option>
                <option value="KIDS">👶 Kids Only</option>
              </select>
            </div>

            <!-- 2. Service Name Text Field -->
            <div class="form-group">
              <label>Service Name *</label>
              <input type="text" class="form-control" id="svc-name" placeholder="e.g. Standard Haircut / Hair + Beard Combo" required />
            </div>

            <!-- 3. Price & Duration -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
              <div class="form-group">
                <label>Price (₹) *</label>
                <input type="number" class="form-control" id="svc-price" placeholder="100" min="0" required />
              </div>
              <div class="form-group">
                <label>Duration * <span style="color: var(--text-muted); font-size: 0.8rem; font-weight: normal;">(Min 30m, 15m steps)</span></label>
                <select class="form-control" id="svc-duration" required>
                  ${renderServiceDurationOptions(30)}
                </select>
              </div>
            </div>

            <!-- 4. Description -->
            <div class="form-group">
              <label>Service Description <span style="color: var(--text-muted); font-weight: normal; font-size: 0.8rem;">(Optional)</span></label>
              <textarea class="form-control" id="svc-desc" rows="2" placeholder="Brief details about the treatment / service..."></textarea>
            </div>

            <!-- 5. Assigned Team Members -->
            <div class="form-group">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <label style="margin-bottom: 0;">Assigned Stylists <span style="color: var(--text-muted); font-size: 0.8rem; font-weight: normal;">(Who provides this service?)</span></label>
                ${activeStaff.length > 0 ? `
                  <button type="button" id="btn-toggle-all-svc-staff" class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 2px 8px;">Deselect All</button>
                ` : ''}
              </div>
              <div style="max-height: 140px; overflow-y: auto; background: var(--bg-input); padding: 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                ${activeStaff.length === 0 ? `
                  <div style="font-size: 0.8rem; color: var(--text-muted); padding: 4px;">No active stylists in salon yet. Staff can be assigned later.</div>
                ` : activeStaff.map((st) => `
                  <label style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; margin-bottom: 6px; cursor: pointer;">
                    <input type="checkbox" class="svc-staff-assign-chk" value="${st.id}" checked />
                    <span>${st.name} ${st.phone ? `<span style="color: var(--text-muted); font-size: 0.78rem;">(${st.phone})</span>` : ''}</span>
                  </label>
                `).join('')}
              </div>
            </div>

            <button type="submit" class="btn btn-primary" style="width: 100%;">Create Service →</button>
          </form>
        </div>
      </div>
    `;

    document.getElementById('btn-close-modal')?.addEventListener('click', () => (modalContainer.innerHTML = ''));

    const categorySelect = document.getElementById('svc-category-select');
    const customCatGroup = document.getElementById('svc-custom-cat-group');
    const customCatInput = document.getElementById('svc-custom-cat-input');
    const nameInput = document.getElementById('svc-name');
    const priceInput = document.getElementById('svc-price');
    const durationSelect = document.getElementById('svc-duration');
    const descInput = document.getElementById('svc-desc');

    document.getElementById('btn-toggle-all-svc-staff')?.addEventListener('click', (e) => {
      const chks = document.querySelectorAll('.svc-staff-assign-chk');
      const allChecked = Array.from(chks).every((c) => c.checked);
      chks.forEach((c) => (c.checked = !allChecked));
      e.target.textContent = allChecked ? 'Select All' : 'Deselect All';
    });

    categorySelect?.addEventListener('change', (e) => {
      if (e.target.value === 'CUSTOM') {
        customCatGroup.style.display = 'block';
      } else {
        customCatGroup.style.display = 'none';
      }
    });

    document.getElementById('add-service-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rawCat = categorySelect.value;
      if (rawCat === 'CUSTOM' && !customCatInput.value.trim()) {
        alert('Please enter a custom category name.');
        customCatInput.focus();
        return;
      }
      const finalCategory = rawCat === 'CUSTOM' ? customCatInput.value.trim() : rawCat;
      const selectedOpt = categorySelect.options[categorySelect.selectedIndex];
      const categoryId = selectedOpt ? selectedOpt.getAttribute('data-id') : null;
      const matchedCat = categoryId ? null : (this.categoriesList || []).find((c) => c.name === finalCategory);
      const finalCategoryId = categoryId || (matchedCat ? matchedCat.id : undefined);

      const dur = parseInt(durationSelect.value, 10);
      if (isNaN(dur) || dur < 30 || dur % 15 !== 0) {
        alert('Service duration must be at least 30 minutes and a multiple of 15 (e.g. 30, 45, 60, 75, 90 mins).');
        return;
      }

      const selectedStylistIds = Array.from(document.querySelectorAll('.svc-staff-assign-chk:checked')).map((c) => c.value);

      const payload = {
        name: nameInput.value.trim(),
        price: parseFloat(priceInput.value),
        durationMinutes: dur,
        category: finalCategory,
        categoryId: finalCategoryId,
        targetGender: document.getElementById('svc-gender').value || 'UNISEX',
        description: descInput.value.trim(),
        stylistIds: selectedStylistIds,
      };

      try {
        this.lastLocalActionTimestamp = Date.now();
        const created = await ApiClient.createService(payload);
        if (created && created.id) {
          this.servicesList = [created, ...this.servicesList.filter((s) => s.id !== created.id)];
        }

        modalContainer.innerHTML = '';
        this.render();

        this.loadData(true).then(() => {
          this.refreshActiveTab();
        }).catch(() => { });
      } catch (err) {
        alert(err.message);
      }
    });
  }

  showEditServiceModal(service) {
    const modalContainer = this.getModalContainer();
    const matchedCat = (this.categoriesList || []).find((c) => c.name === service.category);
    const initialCatValue = matchedCat ? service.category : 'CUSTOM';
    const activeStaff = (this.staffList || []).filter((st) => st.status === 'ACTIVE' || !st.status);

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content modal-content-lg" style="max-height: 90vh; overflow-y: auto;">
          <div class="modal-header">
            <h3>✏️ Edit Service: ${service.name}</h3>
            <button class="close-btn" id="btn-close-modal">&times;</button>
          </div>

          <form id="edit-service-form">
            <!-- 1. Category Selector Dropdown -->
            <div class="form-group">
              <label>Service Category *</label>
              <select class="form-control" id="edit-svc-category-select" required>
                ${this.categoriesList && this.categoriesList.length > 0
        ? this.categoriesList.map((c) => `<option value="${c.name}" ${c.name === service.category ? 'selected' : ''}>${c.icon || '✂️'} ${c.name}</option>`).join('')
        : '<option value="General" selected>✂️ General Services</option>'
      }
                <option value="CUSTOM" ${initialCatValue === 'CUSTOM' ? 'selected' : ''}>➕ Other / Custom Category...</option>
              </select>
            </div>

            <!-- Custom Category Input -->
            <div class="form-group" id="edit-svc-custom-cat-group" style="${initialCatValue === 'CUSTOM' ? 'display: block;' : 'display: none;'}">
              <label>Custom Category Name *</label>
              <input type="text" class="form-control" id="edit-svc-custom-cat-input" value="${initialCatValue === 'CUSTOM' ? (service.category || '') : ''}" placeholder="e.g. Bridal & Groom Special" />
            </div>

            <!-- Target Audience / Gender -->
            <div class="form-group">
              <label>Target Audience / Gender *</label>
              <select class="form-control" id="edit-svc-gender" required>
                <option value="UNISEX" ${(service.targetGender || 'UNISEX') === 'UNISEX' ? 'selected' : ''}>✂️ Unisex (Both Men & Women)</option>
                <option value="MALE" ${service.targetGender === 'MALE' ? 'selected' : ''}>👨 Men Only</option>
                <option value="FEMALE" ${service.targetGender === 'FEMALE' ? 'selected' : ''}>👩 Women Only</option>
                <option value="KIDS" ${service.targetGender === 'KIDS' ? 'selected' : ''}>👶 Kids Only</option>
              </select>
            </div>

            <!-- 2. Service Name -->
            <div class="form-group">
              <label>Service Name *</label>
              <input type="text" class="form-control" id="edit-svc-name" value="${service.name}" required />
            </div>

            <!-- 3. Price & Duration -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
              <div class="form-group">
                <label>Price (₹) *</label>
                <input type="number" class="form-control" id="edit-svc-price" value="${service.price}" min="0" required />
              </div>
              <div class="form-group">
                <label>Duration * <span style="color: var(--text-muted); font-size: 0.8rem; font-weight: normal;">(Min 30m, 15m steps)</span></label>
                <select class="form-control" id="edit-svc-duration" required>
                  ${renderServiceDurationOptions(service.durationMinutes || 30)}
                </select>
              </div>
            </div>

            <!-- 4. Description -->
            <div class="form-group">
              <label>Description</label>
              <textarea class="form-control" id="edit-svc-desc" rows="2">${service.description || ''}</textarea>
            </div>

            <!-- 5. Assigned Team Members -->
            <div class="form-group">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <label style="margin-bottom: 0;">Assigned Stylists <span style="color: var(--text-muted); font-size: 0.8rem; font-weight: normal;">(Who provides this service?)</span></label>
                ${activeStaff.length > 0 ? `
                  <button type="button" id="btn-toggle-all-edit-svc-staff" class="btn btn-secondary btn-sm" style="font-size: 0.75rem; padding: 2px 8px;">Toggle All</button>
                ` : ''}
              </div>
              <div style="max-height: 140px; overflow-y: auto; background: var(--bg-input); padding: 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                ${activeStaff.length === 0 ? `
                  <div style="font-size: 0.8rem; color: var(--text-muted); padding: 4px;">No active stylists in salon yet.</div>
                ` : activeStaff.map((st) => {
        const isAssigned = (service.stylists || []).some((s) => String(s.stylistId || s.stylist?.id || s.id) === String(st.id));
        return `
                    <label style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; margin-bottom: 6px; cursor: pointer;">
                      <input type="checkbox" class="edit-svc-staff-assign-chk" value="${st.id}" ${isAssigned ? 'checked' : ''} />
                      <span>${st.name} ${st.phone ? `<span style="color: var(--text-muted); font-size: 0.78rem;">(${st.phone})</span>` : ''}</span>
                    </label>
                  `;
      }).join('')}
              </div>
            </div>

            <button type="submit" class="btn btn-primary" style="width: 100%;">Save Changes to Menu →</button>
          </form>
        </div>
      </div>
    `;

    document.getElementById('btn-close-modal')?.addEventListener('click', () => (modalContainer.innerHTML = ''));

    const categorySelect = document.getElementById('edit-svc-category-select');
    const customCatGroup = document.getElementById('edit-svc-custom-cat-group');
    const customCatInput = document.getElementById('edit-svc-custom-cat-input');

    categorySelect?.addEventListener('change', (e) => {
      if (e.target.value === 'CUSTOM') {
        customCatGroup.style.display = 'block';
      } else {
        customCatGroup.style.display = 'none';
      }
    });

    document.getElementById('btn-toggle-all-edit-svc-staff')?.addEventListener('click', () => {
      const chks = document.querySelectorAll('.edit-svc-staff-assign-chk');
      const allChecked = Array.from(chks).every((c) => c.checked);
      chks.forEach((c) => (c.checked = !allChecked));
    });

    document.getElementById('edit-service-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rawCat = categorySelect.value;
      const finalCategory = rawCat === 'CUSTOM' ? (customCatInput.value.trim() || 'General') : rawCat;
      const dur = parseInt(document.getElementById('edit-svc-duration').value, 10);
      if (isNaN(dur) || dur < 30 || dur % 15 !== 0) {
        alert('Service duration must be at least 30 minutes and a multiple of 15 (e.g. 30, 45, 60, 75, 90 mins).');
        return;
      }

      const selectedStylistIds = Array.from(document.querySelectorAll('.edit-svc-staff-assign-chk:checked')).map((c) => c.value);

      const payload = {
        name: document.getElementById('edit-svc-name').value.trim(),
        price: parseFloat(document.getElementById('edit-svc-price').value),
        durationMinutes: dur,
        category: finalCategory,
        targetGender: document.getElementById('edit-svc-gender').value || 'UNISEX',
        description: document.getElementById('edit-svc-desc').value.trim(),
        stylistIds: selectedStylistIds,
      };

      try {
        this.lastLocalActionTimestamp = Date.now();
        const updated = await ApiClient.updateService(service.id, payload);

        // Immediate in-memory state update for 0ms reactivity
        const idx = this.servicesList.findIndex((s) => String(s.id) === String(service.id));
        if (idx !== -1) {
          this.servicesList[idx] = {
            ...this.servicesList[idx],
            ...payload,
            ...(updated && typeof updated === 'object' ? updated : {}),
          };
        }

        modalContainer.innerHTML = '';
        this.render();

        this.loadData(true).then(() => {
          this.refreshActiveTab();
        }).catch(() => { });
      } catch (err) {
        alert(err.message);
      }
    });
  }

  showEditStaffModal(staff) {
    const modalContainer = document.getElementById('modal-container');

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content">
          <div class="modal-header">
            <h3>✏️ Edit Stylist Details</h3>
            <button class="close-btn" id="btn-close-modal">&times;</button>
          </div>

          <form id="edit-staff-form">
            <div class="form-group">
              <label>Full Name *</label>
              <input type="text" class="form-control" id="edit-staff-name" value="${staff.name || ''}" required />
            </div>

            <div class="form-group">
              <label>Phone Number *</label>
              <input type="tel" class="form-control" id="edit-staff-phone" value="${staff.phone || ''}" required />
            </div>

            <div class="form-group">
              <label>Email Address</label>
              <input type="email" class="form-control" id="edit-staff-email" value="${staff.email || ''}" />
            </div>

            <div class="form-group">
              <label>Profile Image URL</label>
              <input type="url" class="form-control" id="edit-staff-img" value="${staff.profileImageUrl || ''}" placeholder="https://..." />
            </div>

            <button type="submit" class="btn btn-primary" style="width: 100%;">Save Stylist Details →</button>
          </form>
        </div>
      </div>
    `;

    document.getElementById('btn-close-modal')?.addEventListener('click', () => (modalContainer.innerHTML = ''));

    document.getElementById('edit-staff-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        name: document.getElementById('edit-staff-name').value.trim(),
        phone: document.getElementById('edit-staff-phone').value.trim(),
        email: document.getElementById('edit-staff-email').value.trim() || undefined,
        profileImageUrl: document.getElementById('edit-staff-img').value.trim() || undefined,
      };

      try {
        this.lastLocalActionTimestamp = Date.now();
        const updated = await ApiClient.updateStaff(staff.id, payload);

        // Immediate in-memory state update for 0ms reactivity
        const idx = this.staffList.findIndex((s) => String(s.id) === String(staff.id));
        if (idx !== -1) {
          this.staffList[idx] = {
            ...this.staffList[idx],
            ...payload,
            ...(updated && typeof updated === 'object' ? updated : {}),
          };
        }

        modalContainer.innerHTML = '';
        this.render();

        this.loadData(true).then(() => {
          this.refreshActiveTab();
        }).catch(() => { });
      } catch (err) {
        alert(`Failed: ${err.message}`);
      }
    });
  }

  showDeleteStaffModal(staffId, staffName) {
    const modalContainer = document.getElementById('modal-container');

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content" style="text-align: center;">
          <div style="font-size: 3rem; margin-bottom: 8px;">🗑️</div>
          <h3 style="color: var(--danger); margin-bottom: 8px;">Delete Stylist</h3>
          <p style="color: var(--text-secondary); font-size: 0.88rem; margin-bottom: 20px;">
            Are you sure you want to permanently delete <strong>${staffName}</strong>? All their shift schedules, breaks, and qualified service assignments will be removed.
          </p>

          <div style="display: flex; gap: 10px;">
            <button class="btn btn-secondary" style="flex: 1;" id="btn-cancel-delete-staff">Cancel</button>
            <button class="btn btn-primary" style="flex: 1; background: var(--danger); border-color: var(--danger);" id="btn-confirm-delete-staff">
              Yes, Delete Stylist
            </button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-cancel-delete-staff')?.addEventListener('click', () => (modalContainer.innerHTML = ''));

    document.getElementById('btn-confirm-delete-staff')?.addEventListener('click', async () => {
      try {
        await ApiClient.deleteStaff(staffId);
        this.staffList = this.staffList.filter((s) => s.id !== staffId);
        modalContainer.innerHTML = '';
        this.render();

        this.loadData(true).then(() => {
          this.refreshActiveTab();
        }).catch(() => { });
      } catch (err) {
        alert(`Failed to delete stylist: ${err.message}`);
      }
    });
  }

  async showSalonScheduleModal() {
    const modalContainer = document.getElementById('modal-container');
    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content modal-content-sheet" style="max-width: 580px;">
          <div class="sheet-grab-handle"></div>
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6px;">
            <div>
              <h3 style="font-size: 1.15rem; font-weight: 800; color: #fff; margin: 0; display: flex; align-items: center; gap: 8px;">
                <span>🗓️ Weekly Operating Schedule</span>
              </h3>
              <p style="color: #94a3b8; font-size: 0.76rem; margin: 2px 0 0 0;">Defines master salon boundary. Stylists inherit these hours by default.</p>
            </div>
            <button class="close-btn" id="btn-close-salon-sched" style="width: 28px; height: 28px; font-size: 1.1rem;">&times;</button>
          </div>

          <div id="salon-sched-loading" style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 0.84rem;">
            ⏳ Fetching 7-Day Salon Schedule...
          </div>

          <form id="form-salon-schedule" style="display: none; display: flex; flex-direction: column;">
            <div class="day-sched-subbar">
              <span class="day-sched-subbar-title">7-Day Hours & Breaks</span>
              <button type="button" class="day-sched-copy-btn" id="btn-apply-mon-to-all">
                <span>✨ Copy Mon to All</span>
              </button>
            </div>

            <div id="salon-sched-days-container" style="display: flex; flex-direction: column; gap: 7px; margin-bottom: 12px; max-height: 60vh; overflow-y: auto; padding-right: 2px;">
              <!-- Dynamically populated 7 days -->
            </div>

            <!-- Conflict / Error Alert Banner -->
            <div id="salon-sched-error" style="background: rgba(244,63,94,0.15); border: 1px solid var(--danger-border); color: #f43f5e; padding: 8px 12px; border-radius: var(--radius-sm); font-size: 0.8rem; margin-bottom: 10px; display: none;"></div>

            <div class="sticky-modal-footer">
              <button type="button" class="btn btn-secondary" id="btn-cancel-salon-sched">Cancel</button>
              <button type="submit" class="btn btn-primary" id="btn-save-salon-sched" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); font-weight: 700;">
                💾 Save Schedule
              </button>
            </div>
          </form>
        </div>
      </div>
    `;

    document.getElementById('btn-close-salon-sched')?.addEventListener('click', () => (modalContainer.innerHTML = ''));
    document.getElementById('btn-cancel-salon-sched')?.addEventListener('click', () => (modalContainer.innerHTML = ''));

    try {
      const existingHours = await ApiClient.getSalonWorkingHours(true);
      const loadingDiv = document.getElementById('salon-sched-loading');
      const form = document.getElementById('form-salon-schedule');
      if (loadingDiv) loadingDiv.style.display = 'none';
      if (form) form.style.display = 'block';

      const days = [
        { key: 'MONDAY', label: 'Monday' },
        { key: 'TUESDAY', label: 'Tuesday' },
        { key: 'WEDNESDAY', label: 'Wednesday' },
        { key: 'THURSDAY', label: 'Thursday' },
        { key: 'FRIDAY', label: 'Friday' },
        { key: 'SATURDAY', label: 'Saturday' },
        { key: 'SUNDAY', label: 'Sunday' },
      ];

      // Strict Schedule State Hydration Invariant:
      // If found.breaks is an array (even []), PRESERVE IT VERBATIM as Continuous Operations.
      let salonSchedState = days.map((d) => {
        const found = (existingHours || []).find((h) => h.dayOfWeek === d.key) || {};
        const isClosed = found.isClosed !== undefined ? found.isClosed : false;
        let breaks = [];
        if (Array.isArray(found.breaks)) {
          breaks = found.breaks.map((b) => ({
            id: b.id || `brk-${d.key}-${Math.random().toString(36).substring(2, 7)}`,
            startTime: b.startTime || '13:00',
            endTime: b.endTime || '14:00',
            title: b.title || 'Lunch Break',
          }));
        } else if (found.breakStartTime && found.breakEndTime) {
          breaks = [{ id: `brk-${d.key}-legacy`, startTime: found.breakStartTime, endTime: found.breakEndTime, title: 'Lunch Break' }];
        } else {
          // Zero breaks: default to Continuous Operations mode
          breaks = [];
        }

        return {
          dayOfWeek: d.key,
          label: d.label,
          isClosed,
          startTime: found.startTime || '09:00',
          endTime: found.endTime || '19:00',
          breaks,
        };
      });

      const renderDays = () => {
        const container = document.getElementById('salon-sched-days-container');
        if (!container) return;

        container.innerHTML = salonSchedState.map((day, idx) => `
          <div class="day-sched-card ${day.isClosed ? 'is-closed' : ''}">
            <div class="day-sched-header">
              <div class="day-sched-title-wrap">
                <strong class="day-sched-name">${day.label}</strong>
                ${day.isClosed ? '<span class="day-sched-closed-tag">Closed</span>' : ''}
              </div>
              <button type="button" class="btn-toggle-salon-day day-sched-toggle-btn ${day.isClosed ? 'is-closed' : 'is-open'}" data-idx="${idx}" title="${day.isClosed ? 'Click to open this day' : 'Click to close this day'}">
                <span class="day-sched-toggle-dot"></span>
                <span>${day.isClosed ? 'Closed' : 'Open'}</span>
              </button>
            </div>

            ${!day.isClosed ? `
              <div class="day-sched-times-grid">
                <div class="day-sched-time-col">
                  <label class="day-sched-lbl">Opens</label>
                  <input type="time" class="day-sched-time-inp salon-day-start" data-idx="${idx}" value="${day.startTime}" aria-label="${day.label} Opening Time" />
                </div>
                <div class="day-sched-time-col">
                  <label class="day-sched-lbl">Closes</label>
                  <input type="time" class="day-sched-time-inp salon-day-end" data-idx="${idx}" value="${day.endTime}" aria-label="${day.label} Closing Time" />
                </div>
              </div>

              <div class="day-sched-breaks-bar">
                <div class="day-sched-breaks-title-wrap">
                  <span class="day-sched-breaks-title">Breaks</span>
                  ${day.breaks.length > 0 ? `<span class="day-sched-badge-count">${day.breaks.length}</span>` : ''}
                </div>
                <div class="day-sched-break-btns">
                  <button type="button" class="day-sched-sm-btn btn-quick-lunch-break" data-idx="${idx}" title="Quick-add 1:00 PM – 2:00 PM Lunch Break">
                    + Lunch
                  </button>
                  <button type="button" class="day-sched-sm-btn btn-add-salon-break" data-idx="${idx}" title="Add custom break">
                    + Custom
                  </button>
                </div>
              </div>

              ${day.breaks.length === 0 ? `
                <div class="day-sched-continuous-banner">
                  <span class="day-sched-green-dot"></span>
                  <span>Continuous operations (no breaks)</span>
                </div>
              ` : `
                <div class="day-sched-breaks-container">
                  ${day.breaks.map((b, bIdx) => `
                    <div class="day-sched-break-box">
                      <div class="day-sched-break-row1">
                        <input type="text" class="day-sched-break-name-inp salon-brk-title" data-idx="${idx}" data-bidx="${bIdx}" value="${b.title || 'Lunch Break'}" placeholder="Break Title (e.g. Lunch)" />
                        <button type="button" class="day-sched-break-trash btn-del-salon-break" data-idx="${idx}" data-bidx="${bIdx}" title="Delete Break" aria-label="Delete Break">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                        </button>
                      </div>
                      <div class="day-sched-break-row2">
                        <input type="time" class="day-sched-time-inp salon-brk-start" data-idx="${idx}" data-bidx="${bIdx}" value="${b.startTime}" aria-label="Break Start Time" />
                        <span class="day-sched-to-sep">to</span>
                        <input type="time" class="day-sched-time-inp salon-brk-end" data-idx="${idx}" data-bidx="${bIdx}" value="${b.endTime}" aria-label="Break End Time" />
                      </div>
                    </div>
                  `).join('')}
                </div>
              `}
            ` : ''}
          </div>
        `).join('');

        // Handlers
        container.querySelectorAll('.btn-toggle-salon-day').forEach((b) => {
          b.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
            salonSchedState[idx].isClosed = !salonSchedState[idx].isClosed;
            renderDays();
          });
        });

        container.querySelectorAll('.salon-day-start').forEach((inp) => {
          inp.addEventListener('change', (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
            salonSchedState[idx].startTime = e.currentTarget.value;
          });
        });

        container.querySelectorAll('.salon-day-end').forEach((inp) => {
          inp.addEventListener('change', (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
            salonSchedState[idx].endTime = e.currentTarget.value;
          });
        });

        container.querySelectorAll('.btn-add-salon-break').forEach((b) => {
          b.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
            salonSchedState[idx].breaks.push({
              id: `brk-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
              startTime: '13:00',
              endTime: '14:00',
              title: 'Lunch Break',
            });
            renderDays();
          });
        });

        container.querySelectorAll('.btn-quick-lunch-break').forEach((b) => {
          b.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
            const day = salonSchedState[idx];
            if (day) {
              const alreadyHas = day.breaks.some(br => br.startTime === '13:00' && br.endTime === '14:00');
              if (!alreadyHas) {
                day.breaks.push({
                  id: `brk-${day.dayOfWeek}-${Math.random().toString(36).substring(2, 7)}`,
                  startTime: '13:00',
                  endTime: '14:00',
                  title: 'Lunch Break',
                });
                renderDays();
              }
            }
          });
        });

        container.querySelectorAll('.btn-del-salon-break').forEach((b) => {
          b.addEventListener('click', (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
            const bIdx = parseInt(e.currentTarget.getAttribute('data-bidx'), 10);
            salonSchedState[idx].breaks.splice(bIdx, 1);
            renderDays();
          });
        });

        container.querySelectorAll('.salon-brk-title').forEach((inp) => {
          inp.addEventListener('change', (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
            const bIdx = parseInt(e.currentTarget.getAttribute('data-bidx'), 10);
            salonSchedState[idx].breaks[bIdx].title = e.currentTarget.value;
          });
        });

        container.querySelectorAll('.salon-brk-start').forEach((inp) => {
          inp.addEventListener('change', (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
            const bIdx = parseInt(e.currentTarget.getAttribute('data-bidx'), 10);
            salonSchedState[idx].breaks[bIdx].startTime = e.currentTarget.value;
          });
        });

        container.querySelectorAll('.salon-brk-end').forEach((inp) => {
          inp.addEventListener('change', (e) => {
            const idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
            const bIdx = parseInt(e.currentTarget.getAttribute('data-bidx'), 10);
            salonSchedState[idx].breaks[bIdx].endTime = e.currentTarget.value;
          });
        });
      };

      renderDays();

      document.getElementById('btn-apply-mon-to-all')?.addEventListener('click', () => {
        const mon = salonSchedState[0];
        if (!mon) return;

        for (let i = 1; i < salonSchedState.length; i++) {
          if (!salonSchedState[i].isClosed) {
            salonSchedState[i].startTime = mon.startTime;
            salonSchedState[i].endTime = mon.endTime;
            salonSchedState[i].breaks = (mon.breaks || []).map((b) => ({
              id: `brk-${salonSchedState[i].dayOfWeek}-${Math.random().toString(36).substring(2, 7)}`,
              startTime: b.startTime,
              endTime: b.endTime,
              title: b.title || 'Lunch Break',
            }));
          }
        }

        renderDays();
        const notice = document.getElementById('salon-sched-error');
        if (notice) {
          notice.style.background = 'rgba(16,185,129,0.15)';
          notice.style.borderColor = 'rgba(16,185,129,0.3)';
          notice.style.color = '#34d399';
          notice.textContent = '✨ Copied Monday shift hours and breaks to all open days! Review and click "Save Weekly Schedule" to confirm.';
          notice.style.display = 'block';
        }
      });

      document.getElementById('form-salon-schedule')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById('btn-save-salon-sched');
        const errorDiv = document.getElementById('salon-sched-error');
        submitBtn.textContent = 'Saving Schedule...';
        submitBtn.setAttribute('disabled', 'true');
        errorDiv.style.display = 'none';

        // Client-side validation
        for (const d of salonSchedState) {
          if (!d.isClosed) {
            if (d.startTime >= d.endTime) {
              errorDiv.textContent = `Opening time (${d.startTime}) must be earlier than closing time (${d.endTime}) for ${d.label}.`;
              errorDiv.style.display = 'block';
              submitBtn.textContent = '💾 Save Weekly Schedule →';
              submitBtn.removeAttribute('disabled');
              return;
            }
            for (const b of d.breaks) {
              if (b.startTime >= b.endTime) {
                errorDiv.textContent = `Break start time (${b.startTime}) must be earlier than break end time (${b.endTime}) on ${d.label}.`;
                errorDiv.style.display = 'block';
                submitBtn.textContent = '💾 Save Weekly Schedule →';
                submitBtn.removeAttribute('disabled');
                return;
              }
              if (b.startTime < d.startTime || b.endTime > d.endTime) {
                errorDiv.textContent = `Break ${b.startTime}-${b.endTime} must fall inside operating hours (${d.startTime}-${d.endTime}) on ${d.label}.`;
                errorDiv.style.display = 'block';
                submitBtn.textContent = '💾 Save Weekly Schedule →';
                submitBtn.removeAttribute('disabled');
                return;
              }
            }
          }
        }

        const hoursPayload = salonSchedState.map((d) => ({
          dayOfWeek: d.dayOfWeek,
          isClosed: d.isClosed,
          startTime: d.startTime,
          endTime: d.endTime,
          breaks: d.isClosed ? [] : d.breaks.map((b) => ({
            id: b.id,
            startTime: b.startTime,
            endTime: b.endTime,
            title: b.title || 'Break',
          })),
        }));

        try {
          await ApiClient.updateSalonWorkingHours(hoursPayload);
          modalContainer.innerHTML = '';
          this.loadData(true).then(() => {
            this.refreshActiveTab();
          }).catch(() => { });
        } catch (err) {
          errorDiv.textContent = err.message || 'Failed to update salon schedule. Please check for conflicting appointments.';
          errorDiv.style.display = 'block';
          submitBtn.textContent = '💾 Save Weekly Schedule →';
          submitBtn.removeAttribute('disabled');
        }
      });
    } catch (err) {
      alert(`Error loading salon operating schedule: ${err.message}`);
    }
  }

  openSalonClosuresModal(dateStr = null) {
    SalonClosuresModal.open({
      initialDate: dateStr || this.getLocalDateString(),
      salonWorkingHours: this.salonWorkingHours || [],
      existingClosures: this.closuresList || [],
      staffList: this.staffList || [],
      onSuccess: async () => {
        await this.loadData(true);
        const container = document.getElementById('profile-subtab-container');
        if (container) {
          container.innerHTML = this.renderProfileSubtabContent();
          this.attachProfileSubtabListeners();
        }
      },
    });
  }

  async showEditStaffHoursModal(staffId, staffName) {
    const modalContainer = document.getElementById('modal-container');
    const staff = this.staffList.find((s) => s.id === staffId);
    const existingHours = staff?.workingHours || [];
    let followsSalonSchedule = staff?.followsSalonSchedule ?? true;

    // Fetch salon working hours to show as reference
    let salonHours = [];
    try {
      salonHours = await ApiClient.getSalonWorkingHours();
    } catch (e) {
      salonHours = [];
    }

    const days = [
      { key: 'MONDAY', label: 'Monday' },
      { key: 'TUESDAY', label: 'Tuesday' },
      { key: 'WEDNESDAY', label: 'Wednesday' },
      { key: 'THURSDAY', label: 'Thursday' },
      { key: 'FRIDAY', label: 'Friday' },
      { key: 'SATURDAY', label: 'Saturday' },
      { key: 'SUNDAY', label: 'Sunday' },
    ];

    let staffState = days.map((d) => {
      const sDay = (salonHours || []).find((sh) => sh.dayOfWeek === d.key) || { isClosed: false, startTime: '09:00', endTime: '19:00' };
      const wh = (existingHours || []).find((h) => h.dayOfWeek === d.key) || {};

      let hasBreakOverride = wh.hasBreakOverride === true;
      let breaks = [];
      if (Array.isArray(wh.breaks) && wh.breaks.length > 0) {
        breaks = wh.breaks.map((b) => ({
          id: b.id || `st-brk-${d.key}-${Math.random()}`,
          startTime: b.startTime || '13:00',
          endTime: b.endTime || '14:00',
          title: b.title || 'Lunch Break',
        }));
      } else if (wh.breakStartTime && wh.breakEndTime) {
        breaks = [{ id: `st-brk-${d.key}-legacy`, startTime: wh.breakStartTime, endTime: wh.breakEndTime, title: 'Lunch Break' }];
      }

      return {
        dayOfWeek: d.key,
        label: d.label,
        isWorking: wh.isWorking !== undefined ? wh.isWorking : !sDay.isClosed,
        startTime: wh.startTime || sDay.startTime || '09:00',
        endTime: wh.endTime || sDay.endTime || '19:00',
        hasBreakOverride,
        breaks,
        salonOpen: sDay.startTime || '09:00',
        salonClose: sDay.endTime || '19:00',
        salonClosed: sDay.isClosed || false,
        salonBreaks: sDay.breaks || (sDay.breakStartTime ? [{ startTime: sDay.breakStartTime, endTime: sDay.breakEndTime, title: 'Lunch Break' }] : []),
      };
    });

    const renderStaffModal = () => {
      modalContainer.innerHTML = `
        <div class="modal-backdrop show">
          <div class="modal-content modal-content-lg" style="max-height: 90vh; overflow-y: auto; padding: 24px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px;">
              <div>
                <h3 style="font-size: 1.25rem; font-weight: 800; color: #fff; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
                  <span>⏰ Weekly Shift Hours: ${staffName}</span>
                </h3>
                <p style="color: var(--text-secondary); font-size: 0.84rem; margin: 0;">Configure active working days and daily shift start/end times for <strong>${staffName}</strong>.</p>
              </div>
              <button class="close-btn" id="btn-close-modal" style="background: rgba(255,255,255,0.06); border: 1px solid var(--border-subtle); border-radius: 50%; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--text-secondary); font-size: 1.1rem;">&times;</button>
            </div>

            <!-- Follow Salon Schedule Checkbox Banner -->
            <div style="background: rgba(139, 61, 255,0.08); border: 1px solid rgba(139, 61, 255,0.25); border-radius: var(--radius-md); padding: 12px 16px; margin-bottom: 18px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
              <label style="display: flex; align-items: center; gap: 12px; cursor: pointer; margin: 0;">
                <input type="checkbox" id="chk-follow-salon" ${followsSalonSchedule ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: #8B3DFF;" />
                <div>
                  <strong style="color: #fff; font-size: 0.92rem;">Follow Salon Operating Schedule</strong>
                  <div style="font-size: 0.76rem; color: var(--text-muted); margin-top: 2px;">
                    ${followsSalonSchedule ? 'Stylist inherits effective salon opening hours and default salon breaks automatically.' : 'Custom stylist hours enabled. (Must remain inside salon operating bounds).'}
                  </div>
                </div>
              </label>
              <span class="badge" style="background: ${followsSalonSchedule ? 'rgba(16,185,129,0.15)' : 'rgba(245,158,11,0.15)'}; color: ${followsSalonSchedule ? '#34d399' : '#fbbf24'}; border: 1px solid ${followsSalonSchedule ? 'rgba(16,185,129,0.3)' : 'rgba(245,158,11,0.3)'}; font-size: 0.72rem; padding: 3px 10px;">
                ${followsSalonSchedule ? 'INHERITING SALON' : 'CUSTOM SCHEDULE'}
              </span>
            </div>

            <form id="edit-hours-form">
              <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px;">
                ${staffState.map((d, idx) => {
        const isDayActive = d.isWorking && !d.salonClosed;
        return `
                    <div class="schedule-day-row ${!isDayActive ? 'off-day' : ''}" style="padding: 9px 12px; border-radius: 9px; gap: 6px;">
                      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                          <label class="switch-toggle" style="margin: 0;">
                            <input type="checkbox" class="st-day-chk" data-idx="${idx}" ${isDayActive ? 'checked' : ''} ${followsSalonSchedule || d.salonClosed ? 'disabled' : ''} />
                            <span class="switch-slider"></span>
                          </label>
                          <span style="font-weight: 700; color: #fff; font-size: 0.92rem; min-width: 85px;">${d.label}</span>
                          ${d.salonClosed ? `
                            <span class="badge" style="background: rgba(239,68,68,0.15); color: #f87171; border: 1px solid rgba(239,68,68,0.3); font-size: 0.65rem;">SALON CLOSED</span>
                          ` : isDayActive ? `
                            <span class="badge badge-completed" style="font-size: 0.65rem;">WORKING</span>
                          ` : `
                            <span class="badge" style="background: rgba(100,116,139,0.2); color: #94a3b8; font-size: 0.65rem;">OFF</span>
                          `}
                        </div>

                        ${!d.salonClosed && isDayActive ? `
                          <div style="display: flex; align-items: center; gap: 6px;">
                            <input type="time" class="day-sched-time-inp st-shift-start" data-idx="${idx}" value="${followsSalonSchedule ? d.salonOpen : d.startTime}" ${followsSalonSchedule ? 'disabled' : ''} style="width: 110px; min-height: 34px; padding: 4px 8px; font-size: 0.84rem;" />
                            <span style="color: var(--text-muted); font-size: 0.74rem; font-weight: 600;">to</span>
                            <input type="time" class="day-sched-time-inp st-shift-end" data-idx="${idx}" value="${followsSalonSchedule ? d.salonClose : d.endTime}" ${followsSalonSchedule ? 'disabled' : ''} style="width: 110px; min-height: 34px; padding: 4px 8px; font-size: 0.84rem;" />
                          </div>
                        ` : `
                          <div style="font-size: 0.78rem; color: var(--text-muted); font-style: italic;">
                            ${d.salonClosed ? 'Salon Closed' : 'Day Off'}
                          </div>
                        `}
                      </div>

                      ${!d.salonClosed && (d.isWorking || followsSalonSchedule) ? `
                        <!-- Break Section: Salon Facility Foundation & Stylist Personal Breaks -->
                        <div style="border-top: 1px dashed var(--border-subtle); padding-top: 8px; margin-top: 6px;">
                          <!-- Salon Facility Breaks Banner -->
                          <div style="background: rgba(16, 185, 129, 0.05); border: 1px dashed rgba(16, 185, 129, 0.25); border-radius: 6px; padding: 6px 8px; margin-bottom: 6px;">
                            <div style="display: flex; align-items: center; justify-content: space-between;">
                              <span style="font-size: 0.72rem; font-weight: 700; color: #34d399;">🏢 Salon Facility Breaks</span>
                              <span class="badge-salon-lock">🔒 Active</span>
                            </div>
                            ${d.salonBreaks && d.salonBreaks.length > 0 ? `
                              <div style="display: flex; flex-wrap: wrap; gap: 5px; margin-top: 4px;">
                                ${d.salonBreaks.map(sb => `
                                  <span class="break-chip-salon" style="padding: 2px 6px; font-size: 0.72rem;">
                                    <span>• ${sb.startTime} – ${sb.endTime} (${sb.title || 'Lunch'})</span>
                                  </span>
                                `).join('')}
                              </div>
                            ` : `
                              <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px; font-style: italic;">
                                Continuous operations (no salon downtime).
                              </div>
                            `}
                          </div>

                          <!-- Stylist Personal Shift Breaks -->
                          <div style="margin-top: 4px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                              <span style="font-size: 0.74rem; font-weight: 700; color: #c7d2fe;">
                                👤 Personal Shift Breaks (${d.breaks.length})
                              </span>
                              ${!followsSalonSchedule ? `
                                <button type="button" class="btn btn-secondary btn-sm btn-st-add-break" data-idx="${idx}" style="font-size: 0.7rem; padding: 2px 7px; font-weight: 600;">
                                  + Add Personal Break
                                </button>
                              ` : ''}
                            </div>

                            ${d.breaks.length === 0 ? `
                              <div style="font-size: 0.7rem; color: var(--text-muted); font-style: italic;">No personal breaks added.</div>
                            ` : d.breaks.map((b, bIdx) => {
          const hasOverlap = (d.salonBreaks || []).some(sb => b.startTime < sb.endTime && b.endTime > sb.startTime);
          return `
                                <div class="day-sched-break-box" style="margin-bottom: 5px;">
                                  <div class="day-sched-break-row1">
                                    <input type="text" class="day-sched-break-name-inp st-brk-title" data-idx="${idx}" data-bidx="${bIdx}" value="${b.title || 'Personal Break'}" placeholder="Break Title" />
                                    <button type="button" class="day-sched-break-trash btn-st-del-break" data-idx="${idx}" data-bidx="${bIdx}" title="Remove Personal Break" aria-label="Remove Personal Break">
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
                                    </button>
                                  </div>
                                  <div class="day-sched-break-row2">
                                    <input type="time" class="day-sched-time-inp st-brk-start" data-idx="${idx}" data-bidx="${bIdx}" value="${b.startTime}" aria-label="Break Start Time" />
                                    <span class="day-sched-to-sep">to</span>
                                    <input type="time" class="day-sched-time-inp st-brk-end" data-idx="${idx}" data-bidx="${bIdx}" value="${b.endTime}" aria-label="Break End Time" />
                                  </div>
                                  ${hasOverlap ? `
                                    <div class="break-overlap-notice" style="margin: 3px 0 0 0; padding: 2px 7px; font-size: 0.68rem;">
                                      <span>⚠️ Overlaps with Salon Break. Both will be observed.</span>
                                    </div>
                                  ` : ''}
                                </div>
                              `;
        }).join('')}
                          </div>
                        </div>
                      ` : ''}
                    </div>
                  `;
      }).join('')}
              </div>

              <!-- Error Banner -->
              <div id="st-hours-error" style="background: rgba(244,63,94,0.15); border: 1px solid var(--danger-border); color: #f43f5e; padding: 12px; border-radius: var(--radius-sm); font-size: 0.85rem; margin-bottom: 16px; display: none;"></div>

              <div style="display: flex; gap: 10px; justify-content: flex-end; align-items: center; border-top: 1px solid var(--border-subtle); padding-top: 16px;">
                <button type="button" class="btn btn-secondary btn-sm" id="btn-cancel-st-hours" style="padding: 8px 18px;">Cancel</button>
                <button type="submit" class="btn btn-primary btn-sm" id="btn-save-st-hours" style="padding: 8px 24px; font-weight: 700;">Save Weekly Shift Schedule →</button>
              </div>
            </form>
          </div>
        </div>
      `;

      // Event Listeners inside Staff Modal
      document.getElementById('btn-close-modal')?.addEventListener('click', () => (modalContainer.innerHTML = ''));
      document.getElementById('btn-cancel-st-hours')?.addEventListener('click', () => (modalContainer.innerHTML = ''));

      document.getElementById('chk-follow-salon')?.addEventListener('change', (e) => {
        followsSalonSchedule = e.target.checked;
        renderStaffModal();
      });

      modalContainer.querySelectorAll('.st-day-chk').forEach((chk) => {
        chk.addEventListener('change', (e) => {
          const idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
          staffState[idx].isWorking = e.currentTarget.checked;
          renderStaffModal();
        });
      });

      modalContainer.querySelectorAll('.st-shift-start').forEach((inp) => {
        inp.addEventListener('change', (e) => {
          const idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
          staffState[idx].startTime = e.currentTarget.value;
        });
      });

      modalContainer.querySelectorAll('.st-shift-end').forEach((inp) => {
        inp.addEventListener('change', (e) => {
          const idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
          staffState[idx].endTime = e.currentTarget.value;
        });
      });

      modalContainer.querySelectorAll('.st-break-rad').forEach((rad) => {
        rad.addEventListener('change', (e) => {
          const idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
          staffState[idx].hasBreakOverride = e.currentTarget.value === 'custom';
          renderStaffModal();
        });
      });

      modalContainer.querySelectorAll('.btn-st-add-break').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
          staffState[idx].breaks.push({
            id: `st-brk-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
            startTime: '14:00',
            endTime: '15:00',
            title: 'Lunch Break',
          });
          renderStaffModal();
        });
      });

      modalContainer.querySelectorAll('.btn-st-del-break').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
          const bIdx = parseInt(e.currentTarget.getAttribute('data-bidx'), 10);
          staffState[idx].breaks.splice(bIdx, 1);
          renderStaffModal();
        });
      });

      modalContainer.querySelectorAll('.st-brk-title').forEach((inp) => {
        inp.addEventListener('change', (e) => {
          const idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
          const bIdx = parseInt(e.currentTarget.getAttribute('data-bidx'), 10);
          staffState[idx].breaks[bIdx].title = e.currentTarget.value;
        });
      });

      modalContainer.querySelectorAll('.st-brk-start').forEach((inp) => {
        inp.addEventListener('change', (e) => {
          const idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
          const bIdx = parseInt(e.currentTarget.getAttribute('data-bidx'), 10);
          staffState[idx].breaks[bIdx].startTime = e.currentTarget.value;
        });
      });

      modalContainer.querySelectorAll('.st-brk-end').forEach((inp) => {
        inp.addEventListener('change', (e) => {
          const idx = parseInt(e.currentTarget.getAttribute('data-idx'), 10);
          const bIdx = parseInt(e.currentTarget.getAttribute('data-bidx'), 10);
          staffState[idx].breaks[bIdx].endTime = e.currentTarget.value;
        });
      });

      document.getElementById('edit-hours-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById('btn-save-st-hours');
        const errorDiv = document.getElementById('st-hours-error');
        submitBtn.textContent = 'Saving Stylist Schedule...';
        submitBtn.setAttribute('disabled', 'true');
        errorDiv.style.display = 'none';

        // Update followsSalonSchedule property on staff member first
        try {
          await ApiClient.updateStaff(staffId, { followsSalonSchedule });
        } catch (err) {
          errorDiv.textContent = `Failed updating schedule inheritance: ${err.message}`;
          errorDiv.style.display = 'block';
          submitBtn.textContent = 'Save Stylist Schedule & Breaks →';
          submitBtn.removeAttribute('disabled');
          return;
        }

        // Validate client boundary rules
        if (!followsSalonSchedule) {
          for (const d of staffState) {
            if (d.isWorking && !d.salonClosed) {
              if (d.startTime < d.salonOpen || d.endTime > d.salonClose) {
                errorDiv.textContent = `Stylist shift (${d.startTime}-${d.endTime}) on ${d.label} must fall within salon operating bounds (${d.salonOpen}-${d.salonClose}).`;
                errorDiv.style.display = 'block';
                submitBtn.textContent = 'Save Stylist Schedule & Breaks →';
                submitBtn.removeAttribute('disabled');
                return;
              }
              if (d.startTime >= d.endTime) {
                errorDiv.textContent = `Shift start time (${d.startTime}) must be earlier than shift end time (${d.endTime}) on ${d.label}.`;
                errorDiv.style.display = 'block';
                submitBtn.textContent = 'Save Stylist Schedule & Breaks →';
                submitBtn.removeAttribute('disabled');
                return;
              }
              if (d.hasBreakOverride) {
                for (const b of d.breaks) {
                  if (b.startTime >= b.endTime) {
                    errorDiv.textContent = `Break start (${b.startTime}) must be earlier than break end (${b.endTime}) on ${d.label}.`;
                    errorDiv.style.display = 'block';
                    submitBtn.textContent = 'Save Stylist Schedule & Breaks →';
                    submitBtn.removeAttribute('disabled');
                    return;
                  }
                  if (b.startTime < d.startTime || b.endTime > d.endTime) {
                    errorDiv.textContent = `Break ${b.startTime}-${b.endTime} must fall within stylist working shift (${d.startTime}-${d.endTime}) on ${d.label}.`;
                    errorDiv.style.display = 'block';
                    submitBtn.textContent = 'Save Stylist Schedule & Breaks →';
                    submitBtn.removeAttribute('disabled');
                    return;
                  }
                }
              }
            }
          }
        }

        const hoursPayload = staffState.map((d) => ({
          dayOfWeek: d.dayOfWeek,
          isWorking: followsSalonSchedule ? !d.salonClosed : d.isWorking,
          startTime: followsSalonSchedule ? d.salonOpen : d.startTime,
          endTime: followsSalonSchedule ? d.salonClose : d.endTime,
          hasBreakOverride: d.breaks.length > 0,
          breaks: d.breaks.map((b) => ({
            id: b.id,
            startTime: b.startTime,
            endTime: b.endTime,
            title: b.title || 'Personal Break',
          })),
        }));

        try {
          await ApiClient.updateStaffWorkingHours(staffId, hoursPayload, followsSalonSchedule);
          const idx = this.staffList.findIndex((s) => String(s.id) === String(staffId));
          if (idx !== -1) {
            this.staffList[idx] = {
              ...this.staffList[idx],
              followsSalonSchedule,
              workingHours: hoursPayload,
            };
          }
          modalContainer.innerHTML = '';
          this.render();

          this.loadData(true).then(() => {
            this.refreshActiveTab();
          }).catch(() => { });
        } catch (err) {
          errorDiv.textContent = err.message || 'Failed to update stylist schedule. Please verify input hours.';
          errorDiv.style.display = 'block';
          submitBtn.textContent = 'Save Stylist Schedule & Breaks →';
          submitBtn.removeAttribute('disabled');
        }
      });
    };

    renderStaffModal();
  }

  showDeleteServiceModal(serviceId, serviceName) {
    const modalContainer = document.getElementById('modal-container');

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content" style="text-align: center;">
          <div style="font-size: 3rem; margin-bottom: 8px;">🗑️</div>
          <h3 style="color: var(--danger); margin-bottom: 8px;">Delete Service</h3>
          <p style="color: var(--text-secondary); font-size: 0.88rem; margin-bottom: 20px;">
            Are you sure you want to delete <strong>${serviceName}</strong>? It will be removed from your menu and unassigned from all stylists.
          </p>

          <div style="display: flex; gap: 10px;">
            <button class="btn btn-secondary" style="flex: 1;" id="btn-cancel-delete-svc">Cancel</button>
            <button class="btn btn-primary" style="flex: 1; background: var(--danger); border-color: var(--danger);" id="btn-confirm-delete-svc">
              Yes, Delete Service
            </button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-cancel-delete-svc')?.addEventListener('click', () => (modalContainer.innerHTML = ''));

    document.getElementById('btn-confirm-delete-svc')?.addEventListener('click', async () => {
      try {
        this.lastLocalActionTimestamp = Date.now();
        await ApiClient.deleteService(serviceId);
        this.servicesList = this.servicesList.filter((s) => s.id !== serviceId);
        modalContainer.innerHTML = '';
        this.render();

        this.loadData(true).then(() => {
          this.refreshActiveTab();
        }).catch(() => { });
      } catch (err) {
        alert(`Failed to delete service: ${err.message}`);
      }
    });
  }

  showQRCodeModal() {
    const modalContainer = document.getElementById('modal-container');
    const slug = this.salonProfile?.slug || 'glamour-studio';
    const salonPhone = this.salonProfile?.phone?.replace(/[^\d]/g, '') || '917999817743';
    const whatsappUrl = `https://wa.me/${salonPhone}?text=Hi`;

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content" style="text-align: center; max-width: 420px;">
          <div class="modal-header">
            <h3 style="display: flex; align-items: center; gap: 8px;">
              <span style="color: #25D366;">💬</span> WhatsApp Booking QR
            </h3>
            <button class="close-btn" id="btn-close-modal">&times;</button>
          </div>

          <p style="font-size: 0.82rem; color: var(--text-secondary); margin-bottom: 16px;">
            Scan this QR code to immediately launch the automated <strong>WhatsApp Booking Bot</strong>.
          </p>

          <div style="background: #fff; padding: 16px; border-radius: var(--radius-md); display: inline-block; margin-bottom: 18px; box-shadow: 0 8px 30px rgba(37,211,102,0.25); border: 2px solid #25D366;">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(whatsappUrl)}" alt="WhatsApp Booking QR Code" style="display: block; width: 200px; height: 200px;" />
          </div>

          <div style="background: rgba(37,211,102,0.08); padding: 12px; border-radius: var(--radius-sm); border: 1px solid rgba(37,211,102,0.25); margin-bottom: 20px; text-align: left;">
            <div style="font-size: 0.72rem; color: #25D366; font-weight: 800; letter-spacing: 0.04em;">DIRECT WHATSAPP CHAT LINK</div>
            <div style="font-size: 0.85rem; font-family: monospace; color: #e2e8f0; word-break: break-all; margin-top: 4px;">${whatsappUrl}</div>
          </div>

          <div style="display: flex; gap: 10px;">
            <button class="btn btn-secondary" style="flex: 1;" id="btn-copy-wa-link">📋 Copy Link</button>
            <a href="${whatsappUrl}" target="_blank" class="btn btn-primary" style="flex: 1; background: #25D366; border-color: #25D366; color: #fff; font-weight: 700;">Open WhatsApp 💬</a>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-close-modal')?.addEventListener('click', () => (modalContainer.innerHTML = ''));

    document.getElementById('btn-copy-wa-link')?.addEventListener('click', () => {
      navigator.clipboard.writeText(whatsappUrl);
      alert('Copied WhatsApp booking link to clipboard!\n' + whatsappUrl);
    });
  }

  showStandeePrintModal() {
    const modalContainer = document.getElementById('modal-container');
    const profile = this.salonProfile || {};
    const salonName = profile.name || 'Salon Command';
    const slug = profile.slug || 'the-grand-royal-barber-1';
    const bookingUrl = `${window.location.origin}/#book/${slug}`;
    const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=${encodeURIComponent(bookingUrl)}`;
    const city = profile.city || (profile.address ? profile.address.split(',')[0].trim() : 'Indore');

    modalContainer.innerHTML = `
      <div class="modal-backdrop show" style="z-index: 99999;">
        <div class="modal-content" style="max-width: 520px; text-align: center; padding: 24px; border-radius: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
            <div style="text-align: left;">
              <h3 style="margin: 0; font-size: 1.15rem; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 8px;">
                <span>🖨️ Acrylic Reception Standee</span>
              </h3>
              <p style="margin: 2px 0 0 0; font-size: 0.76rem; color: #94a3b8;">
                A5 Desk Counter Standee with live scannable booking QR.
              </p>
            </div>
            <button class="close-btn" id="btn-close-standee-modal" style="width: 30px; height: 30px; font-size: 1.1rem;">&times;</button>
          </div>

          <!-- Standee Realistic Visual Preview -->
          <div id="standee-print-preview" style="background: #ffffff; color: #0f172a; border-radius: 16px; padding: 28px 24px; box-shadow: 0 16px 40px rgba(0,0,0,0.5); border: 2px solid rgba(255,255,255,0.2); margin-bottom: 18px; text-align: center;">
            <div style="font-size: 0.72rem; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; color: #8B3DFF; margin-bottom: 6px;">
              WELCOME TO
            </div>
            <div style="font-size: 1.5rem; font-weight: 900; letter-spacing: -0.02em; color: #0f172a; margin-bottom: 4px; font-family: var(--font-heading, sans-serif);">
              ${salonName}
            </div>
            <div style="font-size: 0.8rem; color: #64748b; font-weight: 600; margin-bottom: 16px;">
              Scan QR to Book & Join Live Chair Queue
            </div>

            <!-- Standee QR Box -->
            <div style="display: inline-block; padding: 14px; background: #f8fafc; border-radius: 16px; border: 2px solid #e2e8f0; box-shadow: 0 4px 14px rgba(0,0,0,0.06); margin-bottom: 14px;">
              <img src="${qrImgUrl}" alt="Booking QR" style="width: 190px; height: 190px; display: block; border-radius: 8px;" />
            </div>

            <!-- Fast Steps -->
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 14px; text-align: center;">
              <div style="background: #f1f5f9; padding: 6px 4px; border-radius: 8px;">
                <div style="font-size: 0.7rem; font-weight: 800; color: #0f172a;">1. SCAN</div>
                <div style="font-size: 0.62rem; color: #64748b;">With phone camera</div>
              </div>
              <div style="background: #f1f5f9; padding: 6px 4px; border-radius: 8px;">
                <div style="font-size: 0.7rem; font-weight: 800; color: #0f172a;">2. CHOOSE</div>
                <div style="font-size: 0.62rem; color: #64748b;">Stylist & Service</div>
              </div>
              <div style="background: #f1f5f9; padding: 6px 4px; border-radius: 8px;">
                <div style="font-size: 0.7rem; font-weight: 800; color: #10b981;">3. JOIN</div>
                <div style="font-size: 0.62rem; color: #64748b;">Live queue ticket</div>
              </div>
            </div>

            <div style="font-family: monospace; font-size: 0.74rem; font-weight: 700; color: #6D28D9; word-break: break-all;">
              ${bookingUrl}
            </div>
            <div style="font-size: 0.65rem; color: #94a3b8; margin-top: 4px;">
              Powered by Salon Command · ${city}
            </div>
          </div>

          <!-- Standee Modal Actions -->
          <div style="display: flex; gap: 10px;">
            <button type="button" class="btn btn-secondary" id="btn-cancel-standee" style="flex: 1;">Close</button>
            <button type="button" class="btn btn-primary" id="btn-trigger-print-standee" style="flex: 2; background: linear-gradient(135deg, #8B3DFF 0%, #9D5CFF 100%); font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 8px;">
              ${Icons.check ? Icons.check({ size: 16 }) : '🖨️'}
              <span>Print / Save PDF (A5 Standee)</span>
            </button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-close-standee-modal')?.addEventListener('click', () => (modalContainer.innerHTML = ''));
    document.getElementById('btn-cancel-standee')?.addEventListener('click', () => (modalContainer.innerHTML = ''));

    document.getElementById('btn-trigger-print-standee')?.addEventListener('click', () => {
      const printWin = window.open('', '_blank', 'width=650,height=850');
      if (!printWin) {
        alert('Popup blocked! Please allow popups for this site to print the standee.');
        return;
      }
      printWin.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Reception Standee - ${salonName.replace(/"/g, '&quot;')}</title>
          <style>
            @page {
              size: A5 portrait;
              margin: 12mm;
            }
            * { box-sizing: border-box; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              background: #ffffff;
              color: #0f172a;
              margin: 0;
              padding: 24px 20px;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              text-align: center;
              min-height: 90vh;
            }
            .standee-card {
              border: 3px solid #0f172a;
              border-radius: 20px;
              padding: 36px 28px;
              width: 100%;
              max-width: 440px;
              box-shadow: none;
            }
            .kicker {
              font-size: 11px;
              font-weight: 800;
              letter-spacing: 2px;
              text-transform: uppercase;
              color: #9D5CFF;
              margin-bottom: 8px;
            }
            .title {
              font-size: 26px;
              font-weight: 900;
              letter-spacing: -0.5px;
              margin-bottom: 6px;
            }
            .subtitle {
              font-size: 13px;
              color: #475569;
              font-weight: 600;
              margin-bottom: 22px;
            }
            .qr-box {
              display: inline-block;
              padding: 16px;
              border: 2px solid #e2e8f0;
              border-radius: 16px;
              margin-bottom: 20px;
            }
            .qr-img {
              width: 210px;
              height: 210px;
              display: block;
            }
            .steps-row {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 8px;
              margin-bottom: 18px;
            }
            .step-box {
              background: #f8fafc;
              border: 1px solid #e2e8f0;
              border-radius: 8px;
              padding: 8px 4px;
            }
            .step-num {
              font-size: 11px;
              font-weight: 800;
            }
            .step-desc {
              font-size: 9px;
              color: #64748b;
            }
            .url-box {
              font-family: monospace;
              font-size: 12px;
              font-weight: 700;
              color: #6D28D9;
              word-break: break-all;
            }
            .footer-note {
              font-size: 10px;
              color: #94a3b8;
              margin-top: 8px;
            }
          </style>
        </head>
        <body>
          <div class="standee-card">
            <div class="kicker">WELCOME TO</div>
            <div class="title">${salonName}</div>
            <div class="subtitle">Scan to Book & Join Live Chair Queue</div>
            <div class="qr-box">
              <img class="qr-img" src="${qrImgUrl}" alt="Booking QR" />
            </div>
            <div class="steps-row">
              <div class="step-box">
                <div class="step-num">1. SCAN</div>
                <div class="step-desc">With Phone Camera</div>
              </div>
              <div class="step-box">
                <div class="step-num">2. SELECT</div>
                <div class="step-desc">Stylist & Service</div>
              </div>
              <div class="step-box">
                <div class="step-num">3. JOIN</div>
                <div class="step-desc">Live Queue Ticket</div>
              </div>
            </div>
            <div class="url-box">${bookingUrl}</div>
            <div class="footer-note">Powered by Salon Command · ${city}</div>
          </div>
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 300);
            };
          </script>
        </body>
        </html>
      `);
      printWin.document.close();
    });
  }

  async showCustomerHistoryModal(customerId, customerName) {
    const modalContainer = document.getElementById('modal-container');

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content modal-content-lg" style="max-width: 680px;">
          <!-- Sleek, Perfectly-Aligned Header -->
          <div class="modal-header" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; padding-bottom: 10px;">
            <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
              <button class="close-btn" id="btn-back-to-customers" title="Back to Customers" style="width: 28px; height: 28px; border-radius: 6px; flex-shrink: 0; font-size: 0.85rem;">
                ←
              </button>
              <h3 style="font-size: 1.02rem; font-family: var(--font-heading); font-weight: 700; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                Customer Profile & History
              </h3>
            </div>
            <button class="close-btn" id="btn-close-modal" style="width: 28px; height: 28px; font-size: 1.1rem; flex-shrink: 0;">&times;</button>
          </div>
          <div id="cust-history-body" style="padding: 4px 0; text-align: center; color: var(--text-muted);">
            Loading customer details & booking history...
          </div>
        </div>
      </div>
    `;

    const closeModal = () => (modalContainer.innerHTML = '');
    document.getElementById('btn-close-modal')?.addEventListener('click', closeModal);
    document.getElementById('btn-back-to-customers')?.addEventListener('click', closeModal);

    try {
      const customer = await ApiClient.getCustomerById(customerId);
      const historyBody = document.getElementById('cust-history-body');
      if (!historyBody) return;

      const appts = customer.appointments || [];
      const strikes = customer.yearlyNoShowCount || 0;
      const isBlocked = customer.isBookingBlocked || strikes >= 3;
      const totalSpend = appts.reduce((acc, a) => acc + (Number(a.price) || 0), 0);

      historyBody.style.textAlign = 'left';
      historyBody.innerHTML = `
        <!-- Customer Summary Header Card (Ultra-Clean 2-Row Identity & Metrics) -->
        <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; padding: 10px 12px; margin-bottom: 12px;">
          <!-- Row 1: Identity & Strike Badge -->
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 9px; min-width: 0;">
              <div class="customer-avatar">${(customer.name || customerName || 'C').charAt(0).toUpperCase()}</div>
              <div style="min-width: 0;">
                <div style="font-size: 0.92rem; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${customer.name || customerName}</div>
                <div style="font-size: 0.73rem; color: #94a3b8; font-family: monospace; line-height: 1.2;">${customer.phone || 'No phone'}</div>
              </div>
            </div>
            <div style="flex-shrink: 0;">${this.renderStrikeBadge(customer)}</div>
          </div>

          <!-- Row 2: 2-Column Compact Metric Strip -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.05);">
            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px; padding: 6px 10px;">
              <div style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">Total Bookings</div>
              <div style="font-size: 0.88rem; font-weight: 700; color: #f1f5f9;">${appts.length} Bookings</div>
            </div>
            <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.04); border-radius: 8px; padding: 6px 10px;">
              <div style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">Total Spend</div>
              <div style="font-size: 0.88rem; font-weight: 800; color: #34d399;">₹${totalSpend.toLocaleString()}</div>
            </div>
          </div>
        </div>

        <!-- Penalty Strike & Booking Access Control Panel -->
        <div style="background: rgba(139, 61, 255, 0.05); border: 1px solid rgba(139, 61, 255, 0.2); border-radius: 12px; padding: 10px 12px; margin-bottom: 12px;">
          <!-- Section Title & Strikes Ratio -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 0.72rem; font-weight: 800; color: #a5b4fc; text-transform: uppercase; letter-spacing: 0.04em;">⚡ Strike Level:</span>
              <span style="font-size: 0.88rem; font-weight: 800; color: #fff;">${strikes} / 3 Strikes</span>
            </div>
            <span style="font-size: 0.7rem; color: #94a3b8;">Click tier to set</span>
          </div>

          <!-- Direct 4-Segment Strike Level Selector (100% Full-Width, ZERO-Wrap) -->
          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; margin-bottom: 8px;">
            <button class="btn btn-strike-set" data-count="0" style="min-height: 28px; padding: 4px 2px; font-size: 0.72rem; font-weight: 700; border-radius: 6px; border: 1px solid ${strikes === 0 ? 'rgba(16, 185, 129, 0.6)' : 'rgba(255,255,255,0.08)'}; background: ${strikes === 0 ? 'rgba(16, 185, 129, 0.25)' : 'rgba(255,255,255,0.03)'}; color: ${strikes === 0 ? '#34d399' : '#94a3b8'};">
              0 Clean
            </button>
            <button class="btn btn-strike-set" data-count="1" style="min-height: 28px; padding: 4px 2px; font-size: 0.72rem; font-weight: 700; border-radius: 6px; border: 1px solid ${strikes === 1 ? 'rgba(245, 158, 11, 0.6)' : 'rgba(255,255,255,0.08)'}; background: ${strikes === 1 ? 'rgba(245, 158, 11, 0.25)' : 'rgba(255,255,255,0.03)'}; color: ${strikes === 1 ? '#fbbf24' : '#94a3b8'};">
              1 Warn
            </button>
            <button class="btn btn-strike-set" data-count="2" style="min-height: 28px; padding: 4px 2px; font-size: 0.72rem; font-weight: 700; border-radius: 6px; border: 1px solid ${strikes === 2 ? 'rgba(249, 115, 22, 0.6)' : 'rgba(255,255,255,0.08)'}; background: ${strikes === 2 ? 'rgba(249, 115, 22, 0.25)' : 'rgba(255,255,255,0.03)'}; color: ${strikes === 2 ? '#fb923c' : '#94a3b8'};">
              2 Critical
            </button>
            <button class="btn btn-strike-set" data-count="3" style="min-height: 28px; padding: 4px 2px; font-size: 0.72rem; font-weight: 700; border-radius: 6px; border: 1px solid ${strikes >= 3 ? 'rgba(239, 68, 68, 0.6)' : 'rgba(255,255,255,0.08)'}; background: ${strikes >= 3 ? 'rgba(239, 68, 68, 0.25)' : 'rgba(255,255,255,0.03)'}; color: ${strikes >= 3 ? '#fca5a5' : '#94a3b8'};">
              3 Blocked
            </button>
          </div>

          <!-- Quick Action Buttons: 2-Column Balanced Grid -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
            <button class="btn btn-sm" id="btn-modal-unblock" style="min-height: 30px; font-weight: 700; font-size: 0.74rem; padding: 0 8px; border-radius: 6px; background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.35); color: #34d399; justify-content: center; gap: 4px;">
              🔓 Reset (0/3)
            </button>
            <button class="btn btn-sm" id="btn-modal-block" style="min-height: 30px; font-weight: 700; font-size: 0.74rem; padding: 0 8px; border-radius: 6px; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.35); color: #fca5a5; justify-content: center; gap: 4px;">
              🔒 Block (3/3)
            </button>
          </div>
        </div>

        <!-- Booking History Timeline -->
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
          <h4 style="font-size: 0.88rem; font-weight: 700; color: #fff; margin: 0; font-family: var(--font-heading); display: flex; align-items: center; gap: 6px;">
            <span>📜</span>
            <span>Booking History</span>
          </h4>
          <span style="font-size: 0.72rem; color: #94a3b8;">${appts.length} appointments</span>
        </div>

        ${appts.length === 0 ? `
          <div style="text-align: center; padding: 20px 14px; color: var(--text-muted); background: rgba(0,0,0,0.2); border-radius: 10px; border: 1px solid rgba(255,255,255,0.04); font-size: 0.8rem;">
            No past appointment records found for this customer.
          </div>
        ` : `
          <div style="max-height: 240px; overflow-y: auto; overflow-x: auto; border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; background: rgba(0,0,0,0.15);">
            <table class="cust-history-table">
              <thead>
                <tr>
                  <th>Date & Time</th>
                  <th>Service</th>
                  <th>Stylist</th>
                  <th>Price</th>
                  <th style="text-align: right;">Status</th>
                </tr>
              </thead>
              <tbody>
                ${appts.map((a) => {
        const dateStr = a.startAt ? new Date(a.startAt).toLocaleDateString() : 'N/A';
        const timeStr = a.startAt ? new Date(a.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        const statusColors = {
          CONFIRMED: 'rgba(139, 61, 255,0.2); color: #A855F7',
          COMPLETED: 'rgba(16,185,129,0.2); color: #34d399',
          CANCELLED: 'rgba(239,68,68,0.2); color: #f87171',
          IN_SERVICE: 'rgba(168,85,247,0.2); color: #c084fc',
          SEATED_IN_CHAIR: 'rgba(168,85,247,0.2); color: #c084fc',
        };
        const badgeStyle = statusColors[a.status] || 'rgba(255,255,255,0.1); color: #fff';
        return `
                    <tr>
                      <td>
                        <div style="font-weight: 700; color: #fff;">${dateStr}</div>
                        <div style="font-size: 0.72rem; color: #94a3b8;">${timeStr}</div>
                      </td>
                      <td style="font-weight: 600; color: #c7d2fe;">${getApptServices(a).map((s) => s.name).join(' + ') || a.serviceNameSnapshot || a.service?.name || 'Service'}</td>
                      <td style="color: #94a3b8;">${a.stylist?.name || 'Any Staff'}</td>
                      <td style="font-weight: 700; color: #34d399;">₹${a.price || 0}</td>
                      <td style="text-align: right;">
                        <span class="badge" style="background: ${badgeStyle}; font-weight: 700; font-size: 0.7rem; padding: 2px 7px; border-radius: 5px;">${a.status}</span>
                      </td>
                    </tr>
                  `;
      }).join('')}
              </tbody>
            </table>
          </div>
        `}
      `;

      // Event Listener: Unblock (Reset to 0)
      document.getElementById('btn-modal-unblock')?.addEventListener('click', async () => {
        if (confirm(`Reset strikes to 0 and unblock WhatsApp booking access for ${customer.name || customerName}?`)) {
          try {
            await ApiClient.unblockCustomer(customerId);
            alert(`🎉 Successfully reset strikes to 0. Customer unblocked!`);
            this.showCustomerHistoryModal(customerId, customerName);
            this.loadCustomersTable(this.searchQuery);
          } catch (err) {
            alert(`Error resetting strikes: ${err.message}`);
          }
        }
      });

      // Event Listener: Block (Set to 3)
      document.getElementById('btn-modal-block')?.addEventListener('click', async () => {
        if (confirm(`Are you sure you want to block ${customer.name || customerName} from booking?`)) {
          try {
            await ApiClient.updateCustomerStrikes(customerId, 3, true);
            alert(`🔒 Customer has been blocked.`);
            this.showCustomerHistoryModal(customerId, customerName);
            this.loadCustomersTable(this.searchQuery);
          } catch (err) {
            alert(`Error blocking customer: ${err.message}`);
          }
        }
      });

      // Event Listener: Manual Strike Adjuster Pills (0, 1, 2, 3)
      historyBody.querySelectorAll('.btn-strike-set').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          const count = parseInt(e.currentTarget.getAttribute('data-count'), 10);
          const blockState = count >= 3;
          try {
            if (count === 0) {
              await ApiClient.unblockCustomer(customerId);
            } else {
              await ApiClient.updateCustomerStrikes(customerId, count, blockState);
            }
            this.showCustomerHistoryModal(customerId, customerName);
            this.loadCustomersTable(this.searchQuery);
          } catch (err) {
            alert(`Error updating strikes: ${err.message}`);
          }
        });
      });

    } catch (err) {
      const historyBody = document.getElementById('cust-history-body');
      if (historyBody) {
        historyBody.innerHTML = `<div style="color: var(--danger); padding: 20px;">Failed to load customer details: ${err.message}</div>`;
      }
    }
  }

  showAdjustStrikesModal(customer) {
    const modalContainer = document.getElementById('modal-container');
    const currentStrikes = customer.yearlyNoShowCount || 0;

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content" style="max-width: 440px;">
          <div class="modal-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; padding-bottom: 10px;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 1.1rem;">⚙️</span>
              <h3 style="font-size: 1.02rem; font-family: var(--font-heading); font-weight: 700; margin: 0;">Adjust Penalty Strikes</h3>
            </div>
            <button class="close-btn" id="btn-close-modal" style="width: 28px; height: 28px; font-size: 1.1rem;">&times;</button>
          </div>

          <div style="padding: 2px 0 0 0;">
            <!-- Customer Identity & Current Status Strip -->
            <div style="background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.06); padding: 10px 12px; border-radius: 10px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; gap: 10px;">
              <div style="min-width: 0;">
                <div style="font-size: 0.65rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700; letter-spacing: 0.04em;">Customer</div>
                <div style="font-size: 0.95rem; font-weight: 700; color: #fff; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  ${customer.name || 'Customer'}
                </div>
                <div style="font-size: 0.74rem; color: #94a3b8; font-family: monospace;">${customer.phone || 'No phone'}</div>
              </div>
              <div style="flex-shrink: 0;">${this.renderStrikeBadge(customer)}</div>
            </div>

            <div style="font-size: 0.74rem; color: var(--text-muted); margin-bottom: 8px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.04em;">
              Set Strike Level Directly:
            </div>

            <!-- Direct 4-Tier Strike Grid -->
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 14px;">
              <button class="btn btn-strike-tier" data-count="0" style="padding: 6px 4px; font-size: 0.72rem; font-weight: 700; border-radius: 8px; border: 1px solid ${currentStrikes === 0 ? 'rgba(16, 185, 129, 0.5)' : 'rgba(255,255,255,0.08)'}; background: ${currentStrikes === 0 ? 'rgba(16, 185, 129, 0.25)' : 'rgba(255,255,255,0.04)'}; color: ${currentStrikes === 0 ? '#34d399' : '#cbd5e1'};">
                ✓ 0 Clean
              </button>
              <button class="btn btn-strike-tier" data-count="1" style="padding: 6px 4px; font-size: 0.72rem; font-weight: 700; border-radius: 8px; border: 1px solid ${currentStrikes === 1 ? 'rgba(245, 158, 11, 0.5)' : 'rgba(255,255,255,0.08)'}; background: ${currentStrikes === 1 ? 'rgba(245, 158, 11, 0.25)' : 'rgba(255,255,255,0.04)'}; color: ${currentStrikes === 1 ? '#fbbf24' : '#cbd5e1'};">
                ⚡ 1 Warn
              </button>
              <button class="btn btn-strike-tier" data-count="2" style="padding: 6px 4px; font-size: 0.72rem; font-weight: 700; border-radius: 8px; border: 1px solid ${currentStrikes === 2 ? 'rgba(249, 115, 22, 0.5)' : 'rgba(255,255,255,0.08)'}; background: ${currentStrikes === 2 ? 'rgba(249, 115, 22, 0.25)' : 'rgba(255,255,255,0.04)'}; color: ${currentStrikes === 2 ? '#fb923c' : '#cbd5e1'};">
                ⚠️ 2 Alert
              </button>
              <button class="btn btn-strike-tier" data-count="3" style="padding: 6px 4px; font-size: 0.72rem; font-weight: 700; border-radius: 8px; border: 1px solid ${currentStrikes >= 3 ? 'rgba(239, 68, 68, 0.5)' : 'rgba(255,255,255,0.08)'}; background: ${currentStrikes >= 3 ? 'rgba(239, 68, 68, 0.25)' : 'rgba(255,255,255,0.04)'}; color: ${currentStrikes >= 3 ? '#fca5a5' : '#cbd5e1'};">
                🔴 3 Block
              </button>
            </div>

            <div style="font-size: 0.74rem; color: var(--text-muted); margin-bottom: 8px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.04em;">
              Quick Operations:
            </div>

            <!-- Sleek, Compact Action Rows (Height ~38px, Dark Luxury Styling) -->
            <div style="display: flex; flex-direction: column; gap: 6px;">
              <!-- Option 1: Reset All to 0 -->
              <button class="btn" id="btn-opt-reset-all" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; font-size: 0.8rem; font-weight: 600; border-radius: 8px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.25); color: #34d399; transition: all 0.15s ease;">
                <span style="display: flex; align-items: center; gap: 6px;">
                  <span>🧹</span>
                  <span>Reset All Strikes (Set to 0/3)</span>
                </span>
                <span style="font-size: 0.68rem; font-weight: 700; background: rgba(16, 185, 129, 0.2); padding: 2px 7px; border-radius: 6px; color: #6ee7b7;">Clear 100%</span>
              </button>

              ${currentStrikes > 0 ? `
                <!-- Option 2: Remove 1 Strike -->
                <button class="btn" id="btn-opt-remove-1" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; font-size: 0.8rem; font-weight: 600; border-radius: 8px; background: rgba(139, 61, 255, 0.1); border: 1px solid rgba(139, 61, 255, 0.25); color: #c7d2fe; transition: all 0.15s ease;">
                  <span style="display: flex; align-items: center; gap: 6px;">
                    <span>➖</span>
                    <span>Remove 1 Strike (Set to ${Math.max(0, currentStrikes - 1)}/3)</span>
                  </span>
                  <span style="font-size: 0.68rem; font-weight: 700; background: rgba(139, 61, 255, 0.25); padding: 2px 7px; border-radius: 6px; color: #e0e7ff;">-1 Strike</span>
                </button>
              ` : ''}

              <!-- Option: Block / Unblock Customer -->
              <button class="btn" id="btn-opt-block" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; font-size: 0.8rem; font-weight: 600; border-radius: 8px; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.25); color: #fca5a5; transition: all 0.15s ease;">
                <span style="display: flex; align-items: center; gap: 6px;">
                  <span>🔒</span>
                  <span>Block Customer (Set to 3/3 Blocked)</span>
                </span>
                <span style="font-size: 0.68rem; font-weight: 700; background: rgba(239, 68, 68, 0.2); padding: 2px 7px; border-radius: 6px; color: #fecdd3;">3 Strikes</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;

    const closeModal = () => (modalContainer.innerHTML = '');
    document.getElementById('btn-close-modal')?.addEventListener('click', closeModal);

    // Direct Strike Tier Handler
    modalContainer.querySelectorAll('.btn-strike-tier').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const count = parseInt(e.currentTarget.getAttribute('data-count'), 10);
        const blockState = count >= 3;
        try {
          if (count === 0) {
            await ApiClient.unblockCustomer(customer.id);
          } else {
            await ApiClient.updateCustomerStrikes(customer.id, count, blockState);
          }
          alert(`⚡ Updated penalty strikes to ${count}/3 for ${customer.name || 'Customer'}.`);
          closeModal();
          this.loadCustomersTable(this.searchQuery);
        } catch (err) {
          alert(`Error updating strikes: ${err.message}`);
        }
      });
    });

    // Handler: Reset All (Set to 0)
    document.getElementById('btn-opt-reset-all')?.addEventListener('click', async () => {
      try {
        await ApiClient.unblockCustomer(customer.id);
        alert(`🎉 Reset all strikes to 0 for ${customer.name || 'Customer'}. Account unblocked & WhatsApp notification sent!`);
        closeModal();
        this.loadCustomersTable(this.searchQuery);
      } catch (err) {
        alert(`Error resetting strikes: ${err.message}`);
      }
    });

    // Handler: Remove 1 Strike
    document.getElementById('btn-opt-remove-1')?.addEventListener('click', async () => {
      const newCount = Math.max(0, currentStrikes - 1);
      try {
        await ApiClient.updateCustomerStrikes(customer.id, newCount, newCount >= 3);
        alert(`⚡ Reduced penalty strikes to ${newCount}/3 for ${customer.name || 'Customer'}.`);
        closeModal();
        this.loadCustomersTable(this.searchQuery);
      } catch (err) {
        alert(`Error updating strikes: ${err.message}`);
      }
    });

    // Handler: Block Customer (Set to 3)
    document.getElementById('btn-opt-block')?.addEventListener('click', async () => {
      try {
        await ApiClient.updateCustomerStrikes(customer.id, 3, true);
        alert(`🔒 ${customer.name || 'Customer'} has been blocked (3/3 strikes).`);
        closeModal();
        this.loadCustomersTable(this.searchQuery);
      } catch (err) {
        alert(`Error blocking customer: ${err.message}`);
      }
    });
  }
}


