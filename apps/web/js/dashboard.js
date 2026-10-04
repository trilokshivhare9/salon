import { ApiClient, formatTime12h } from './api.js';
import { RealtimeNotifier } from './realtime.js';
import { SoundManager } from './sound.js';
import { Icons } from './icons.js';
import { LeaveManagementUI } from './leave-management.js';
import { LocationPicker } from './location-picker.js';
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
  toast.style.cssText = `position:fixed; bottom:24px; right:24px; z-index:999999; padding:12px 20px; background:${type === 'error' ? '#ef4444' : '#10b981'}; color:#fff; font-weight:600; font-size:0.9rem; border-radius:10px; box-shadow:0 10px 25px rgba(0,0,0,0.4); font-family:sans-serif;`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
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

export class SalonDashboard {
  constructor(containerId, currentUser = null) {
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

  async init() {
    this.renderLoading();
    try {
      await this.loadData();
      this.render();

      window.salonDashboard = this;

      // Connect to Real-time Event Stream for live sync & audio chimes
      if (this.salonProfile?.id) {
        if (this.realtime) {
          this.realtime.destroy();
        }
        this.realtime = new RealtimeNotifier(this.salonProfile.id, async (payload) => {
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
        ? 'rgba(245,158,11,0.25)' : 'rgba(99,102,241,0.12)';
      btn.style.borderColor = pendingQuickCount > 0
        ? 'rgba(245,158,11,0.5)' : 'rgba(99,102,241,0.3)';
      btn.style.color = pendingQuickCount > 0 ? '#fbbf24' : '#818cf8';
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
        const _tabAvailCount = this.staffList.filter(s => s.status === 'ACTIVE' && !(s.absences || []).some(ab => (ab.absenceDate || '').split('T')[0] === _tabDateIso && ab.status === 'ACTIVE')).length;
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
    if (targetTab === 'profile') {
      this.mobileSettingsDrilled = false;
    }
    this.activeTab = targetTab;

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
        const [summary, staff, services, profile, categories, closures] = await Promise.all([
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
          ApiClient.getSalonClosures(true).catch((err) => {
            console.warn('[Dashboard] Closures fetch error:', err);
            return this.closuresList || [];
          }),
        ]);

        this.summaryData = summary || fallbackSummary;
        this.staffList = Array.isArray(staff) ? staff : [];
        this.servicesList = Array.isArray(services) ? services : [];
        this.categoriesList = Array.isArray(categories) ? categories : [];
        this.salonProfile = profile || {};
        this.closuresList = Array.isArray(closures) ? closures : [];


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
            <button class="btn btn-secondary btn-sm" id="btn-header-quick-requests" title="View Pending Quick Booking Requests" style="background: ${pendingQuickCount > 0 ? 'rgba(245,158,11,0.25)' : 'rgba(99,102,241,0.12)'}; border: 1px solid ${pendingQuickCount > 0 ? 'rgba(245,158,11,0.5)' : 'rgba(99,102,241,0.3)'}; color: ${pendingQuickCount > 0 ? '#fbbf24' : '#818cf8'}; font-weight: 700; gap: 6px; display: flex; align-items: center;">
              ${Icons.sparkles({ size: 14, color: pendingQuickCount > 0 ? '#fbbf24' : '#818cf8' })}
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
      <main id="main-content" style="max-width: 1300px; margin: 0 auto; padding: 24px 16px;">

        <!-- Universal Pull-to-Refresh Indicator (Always available on all screens) -->
        <div class="ptr-wrapper" id="ptr-wrapper">
          <div class="ptr-capsule" id="ptr-capsule">
            <span class="ptr-icon" id="ptr-icon">${Icons.arrowDown({ size: 14, color: '#818cf8' })}</span>
            <span id="ptr-text">Pull to refresh</span>
          </div>
        </div>

        <!-- Setup Required Onboarding Banner -->
        ${isDeactivated ? `
          <div style="background: linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(99,102,241,0.08) 100%); border: 1px solid rgba(245,158,11,0.3); border-radius: var(--radius-md); padding: 16px 20px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px;">
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
            <span>Stylists (${this.staffList.length}) \u2022 ${((sl, d) => sl.filter(s => s.status === 'ACTIVE' && !(s.absences || []).some(ab => (ab.absenceDate || '').split('T')[0] === d && ab.status === 'ACTIVE')).length)(this.staffList, this.selectedDate || new Date().toISOString().split('T')[0])} Available</span>
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
            const sDate = (ab.startDate || ab.absenceDate || '').split('T')[0];
            const eDate = (ab.endDate || ab.absenceDate || '').split('T')[0];
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
            <div class="stat-icon-wrapper" style="background: rgba(99,102,241,0.12); border-color: rgba(99,102,241,0.25);">
              ${Icons.calendar({ size: 18, color: '#818cf8' })}
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
      <div class="glass-panel" style="margin-bottom: 24px; padding: 20px 24px; border: 1px solid rgba(37,211,102,0.2); background: linear-gradient(135deg, rgba(37,211,102,0.04) 0%, rgba(16,19,29,0.85) 60%);">
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
            ${Icons.refreshCw({ size: 13, color: '#818cf8' })}
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
            <div class="action-tile-icon" style="background: rgba(99,102,241,0.15); border: 1px solid rgba(99,102,241,0.3);">
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
              ${Icons.users({ size: 18, color: '#818cf8' })}
              <span>Stylist Floor Status (${((sl, d) => sl.filter(s => s.status === 'ACTIVE' && !(s.absences || []).some(ab => (ab.absenceDate || '').split('T')[0] === d && ab.status === 'ACTIVE')).length)(this.staffList, this.selectedDate || new Date().toISOString().split('T')[0])} Available Today)</span>
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
          const sDate = (ab.startDate || ab.absenceDate || '').split('T')[0];
          const eDate = (ab.endDate || ab.absenceDate || '').split('T')[0];
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
        if (status === 'CANCELLED' || status === 'NO_SHOW' || status === 'REJECTED') {
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
        filteredAppointments = sortedAppointments.filter((a) => ['CANCELLED', 'NO_SHOW', 'REJECTED'].includes(a.status));
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
              ${Icons.globe({ size: 12, color: '#818cf8' })}
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
                ${Icons.armchair({ size: 30, color: '#818cf8' })}
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
                  ${Icons.refreshCw({ size: 13, color: '#818cf8' })}
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
        const isCancelled = ['CANCELLED', 'NO_SHOW', 'REJECTED'].includes(appt.status);
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
                          <span class="badge qc__timer-badge" data-reminder-sent="${appt.reminder10mSentAt}" style="background: rgba(99, 102, 241, 0.15); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.35); font-size: 0.72rem; padding: 4px 8px; border-radius: 6px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
                            ${Icons.clock({ size: 13, color: '#818cf8' })}
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
      case 'NO_SHOW': return '#64748b';
      default: return '#6366f1';
    }
  }

  // =========================================================================
  // TAB 2: STYLISTS & CAPACITY MONITOR (FULL CRUD)
  // =========================================================================
  renderStaffTab() {
    try {
      const staff = Array.isArray(this.staffList) ? this.staffList : [];
      const appts = this.summaryData?.todayAppointments || [];
      const todayClosure = this.getTodayClosure();

      let closureHtml = '';
      if (todayClosure) {
        closureHtml = `
          <div style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: var(--radius-md); padding: 14px 18px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; box-shadow: 0 8px 24px rgba(239, 68, 68, 0.15);">
            <div style="display: flex; align-items: center; gap: 10px; color: #f87171; font-size: 0.88rem; font-weight: 700;">
              <span style="font-size: 1.2rem;">🚨</span>
              <span>STORE CLOSED TODAY (${todayClosure.closureType}): ${todayClosure.reason}</span>
            </div>
            <button class="btn btn-secondary btn-sm btn-open-closures-modal" style="border-color: rgba(239, 68, 68, 0.4); color: #f87171; font-size: 0.78rem;">
              Manage Closures & Holidays →
            </button>
          </div>
        `;
      }

      let contentHtml = '';
      if (staff.length === 0) {
        contentHtml = `
            <div style="text-align: center; padding: 48px 20px; background: rgba(0,0,0,0.2); border-radius: var(--radius-md); border: 1px dashed var(--border-subtle);">
              <div style="margin-bottom: 14px;">
                ${Icons.users({ size: 44, color: '#64748b' })}
              </div>
              <h4 style="color: #fff; margin-bottom: 6px; font-weight: 700;">No Stylists Added Yet</h4>
              <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 16px;">Add your first staff member to start scheduling appointments and taking bookings.</p>
              <button class="btn btn-primary btn-sm" id="btn-empty-add-staff" style="gap: 6px;">
                ${Icons.plus({ size: 14 })}
                <span>Add Stylist Member</span>
              </button>
            </div>
        `;
      } else {
        const staffCardsHtml = staff.map((st) => {
          const todayAppts = appts.filter((a) => (a.staff?.id || a.staffId) === st.id);
          const inService = todayAppts.find((a) => a.status === 'SEATED_IN_CHAIR' || a.status === 'IN_SERVICE');
          const confirmedCount = todayAppts.filter((a) => ['CONFIRMED', 'CHECKED_IN', 'SEATED_IN_CHAIR', 'IN_SERVICE'].includes(a.status)).length;
          const completedCount = todayAppts.filter((a) => a.status === 'COMPLETED').length;
  
          const todayIso = (this.selectedDate || new Date().toISOString().split('T')[0]);
          const activeAbsence = (st.absences || []).find((ab) => {
            if (ab.status !== 'ACTIVE') return false;
            const sDate = (ab.startDate || ab.absenceDate || '').split('T')[0];
            const eDate = (ab.endDate || ab.absenceDate || '').split('T')[0];
            return todayIso >= sDate && todayIso <= eDate;
          });
          const isAbsentToday = !!activeAbsence;
  
          let statusDot = 'status-dot-free';
          let statusText = 'Available / Free for Walk-ins';
          if (todayClosure) {
            statusDot = 'status-dot-busy';
            statusText = `🚨 Store Closed Today (${todayClosure.reason})`;
          } else if (isAbsentToday) {
            statusDot = 'status-dot-busy';
            const portionText = activeAbsence.leavePortion === 'FIRST_HALF' ? 'First Half'
              : activeAbsence.leavePortion === 'SECOND_HALF' ? 'Second Half'
              : activeAbsence.leavePortion === 'CUSTOM_HOURS' ? `Custom (${activeAbsence.customStartTime || ''}-${activeAbsence.customEndTime || ''})`
              : 'Full Day';
            statusText = `🚫 On Leave (${portionText})`;
          } else if (st.status !== 'ACTIVE') {
            statusDot = 'status-dot-off';
            statusText = 'Inactive / Off-Duty';
          } else if (inService) {
            statusDot = 'status-dot-busy';
            statusText = `In Chair: ${inService.customer?.name || 'Client'}`;
          }
  
          const parseTime = (timeStr) => {
            if (!timeStr) return 0;
            const [h, m] = timeStr.split(':').map(Number);
            return h * 60 + m;
          };
          const formatTimeMins = (mins) => {
            const h = Math.floor(mins / 60);
            const m = mins % 60;
            const ampm = h >= 12 ? 'PM' : 'AM';
            const h12 = h % 12 || 12;
            return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
          };
  
          const daysArr = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
          const dayOfWeek = daysArr[new Date(todayIso).getDay()];
  
          let shiftStart = '09:00';
          let shiftEnd = '21:00';
          let isOffDay = false;
          let salonBreaks = [];
          let stylistPersonalBreaks = [];

          // 1. Salon-level facility breaks (The Immutable Foundation)
          if (this.salonProfile && this.salonProfile.workingHours) {
            const salonHours = this.salonProfile.workingHours.find(h => h.dayOfWeek === dayOfWeek);
            if (salonHours) {
              isOffDay = salonHours.isClosed || salonHours.isOff;
              if (!isOffDay) {
                shiftStart = salonHours.startTime || shiftStart;
                shiftEnd = salonHours.endTime || shiftEnd;
              }
              if (Array.isArray(salonHours.breaks) && salonHours.breaks.length > 0) {
                salonBreaks = salonHours.breaks.map(b => ({
                  id: b.id || `salon-brk-${dayOfWeek}-${b.startTime}`,
                  startTime: b.startTime,
                  endTime: b.endTime,
                  title: b.title || 'Salon Lunch',
                  origin: 'SALON',
                  isLocked: true,
                }));
              } else if (salonHours.breakStartTime && salonHours.breakEndTime) {
                salonBreaks = [{
                  id: `salon-brk-${dayOfWeek}-legacy`,
                  startTime: salonHours.breakStartTime,
                  endTime: salonHours.breakEndTime,
                  title: 'Salon Lunch',
                  origin: 'SALON',
                  isLocked: true,
                }];
              }
            }
          }

          // 2. Stylist-level personal shift hours & personal breaks
          if (st.workingHours && st.workingHours.length > 0) {
            const stHours = st.workingHours.find(h => h.dayOfWeek === dayOfWeek);
            if (stHours) {
              isOffDay = stHours.isOff !== undefined ? stHours.isOff : !stHours.isWorking;
              if (!isOffDay) {
                shiftStart = stHours.startTime || shiftStart;
                shiftEnd = stHours.endTime || shiftEnd;
              }
              if (stHours.hasBreakOverride) {
                if (Array.isArray(stHours.breaks) && stHours.breaks.length > 0) {
                  stylistPersonalBreaks = stHours.breaks.map(b => ({
                    id: b.id || `st-brk-${dayOfWeek}-${b.startTime}`,
                    startTime: b.startTime,
                    endTime: b.endTime,
                    title: b.title || 'Personal Break',
                    origin: 'STYLIST',
                    isLocked: false,
                  }));
                } else if (stHours.breakStartTime && stHours.breakEndTime) {
                  stylistPersonalBreaks = [{
                    id: `st-brk-${dayOfWeek}-legacy`,
                    startTime: stHours.breakStartTime,
                    endTime: stHours.breakEndTime,
                    title: 'Personal Break',
                    origin: 'STYLIST',
                    isLocked: false,
                  }];
                }
              }
            }
          }

          // Combined discrete breaks: Both co-exist natively with origin tagging
          let shiftBreaks = [...salonBreaks, ...stylistPersonalBreaks];

          this.openStaffScheduleIds = this.openStaffScheduleIds || new Set();
          this.staffScheduleViewMode = this.staffScheduleViewMode || {};
          const isScheduleOpen = this.openStaffScheduleIds.has(st.id);
          const scheduleViewMode = this.staffScheduleViewMode[st.id] || 'timeline';

          let startMins = parseTime(shiftStart);
          let endMins = parseTime(shiftEnd);
          if (endMins <= startMins) endMins = startMins + 720;
          let totalShiftMins = endMins - startMins;
          if (totalShiftMins <= 0) totalShiftMins = 720;

          // Practical Proportional Scale: ~70px per hour (~1.15px per min)
          const PIXELS_PER_MIN = 1.15;
          const trackWidth = Math.max(760, Math.round(totalShiftMins * PIXELS_PER_MIN));

          // Events aggregation
          let dailyEvents = [];
          shiftBreaks.forEach((b) => {
            dailyEvents.push({
              type: 'break',
              origin: b.origin || 'STYLIST',
              isLocked: b.isLocked || false,
              startMins: parseTime(b.startTime),
              endMins: parseTime(b.endTime),
              title: b.title || (b.origin === 'SALON' ? 'Salon Lunch' : 'Personal Break'),
            });
          });

          todayAppts.filter((a) => ['CONFIRMED', 'CHECKED_IN', 'SEATED_IN_CHAIR', 'IN_SERVICE', 'COMPLETED'].includes(a.status)).forEach((a) => {
            const aDate = new Date(a.startAt || a.startTime);
            const aStartMins = aDate.getHours() * 60 + aDate.getMinutes();
            const duration = a.duration || a.service?.duration || 30;
            dailyEvents.push({
              type: 'service',
              startMins: aStartMins,
              endMins: aStartMins + duration,
              title: a.service?.name || 'Service',
              customer: a.user?.name || a.customerName || 'Walk-in Client',
              phone: a.user?.phone || a.customerPhone || '',
              status: a.status,
            });
          });

          // Sort chronologically
          dailyEvents.sort((a, b) => a.startMins - b.startMins);
          const dailyApptsCount = todayAppts.filter((a) => ['CONFIRMED', 'CHECKED_IN', 'SEATED_IN_CHAIR', 'IN_SERVICE', 'COMPLETED'].includes(a.status)).length;

          // Current Time Needle
          const now = new Date();
          const nowMins = now.getHours() * 60 + now.getMinutes();
          const isNowInsideShift = nowMins >= startMins && nowMins <= endMins;
          const nowLeftPx = isNowInsideShift ? Math.round((nowMins - startMins) * PIXELS_PER_MIN) : 0;
          const initialScroll = isNowInsideShift ? Math.max(0, nowLeftPx - 160) : 0;

          // Render Schedule Widget (When Expanded)
          let scheduleWidgetHtml = '';
          if (isScheduleOpen) {
            if (isOffDay) {
              scheduleWidgetHtml = `
                <div style="margin-top: 10px; padding: 20px; text-align: center; background: rgba(251, 113, 133, 0.05); border: 1px dashed rgba(251, 113, 133, 0.25); border-radius: 8px;">
                  <div style="font-size: 1rem; color: #fb7185; font-weight: 700;">🚫 Not Scheduled Today</div>
                  <p style="font-size: 0.76rem; color: #94a3b8; margin: 4px 0 0 0;">Stylist has a scheduled day off or is marked absent.</p>
                </div>
              `;
            } else if (scheduleViewMode === 'agenda') {
              // Agenda List View
              scheduleWidgetHtml = `
                <div class="staff-schedule-panel">
                  <div class="staff-schedule-header">
                    <div style="display: flex; align-items: center; gap: 8px;">
                      <span style="font-size: 0.74rem; font-weight: 700; color: #f1f5f9;">
                        Shift: ${formatTimeMins(startMins)} – ${formatTimeMins(endMins)}
                      </span>
                      <span style="font-size: 0.68rem; color: #94a3b8;">(${Math.round(totalShiftMins / 60)}h)</span>
                    </div>

                    <div style="display: flex; background: rgba(0,0,0,0.3); padding: 2px; border-radius: 5px; border: 1px solid rgba(255,255,255,0.06);">
                      <button type="button" class="sched-control-btn btn-switch-sched-view" data-id="${st.id}" data-mode="timeline" title="Visual Timeline View">
                        <span>📊 Timeline</span>
                      </button>
                      <button type="button" class="sched-control-btn btn-switch-sched-view active" data-id="${st.id}" data-mode="agenda" title="Chronological Agenda List">
                        <span>📋 Agenda</span>
                      </button>
                    </div>
                  </div>

                  <div style="padding: 10px 12px; max-height: 220px; overflow-y: auto;">
                    ${dailyEvents.length === 0 ? `
                      <div style="padding: 24px; text-align: center;">
                        <span style="font-size: 1.2rem; display: block; margin-bottom: 4px;">🟢</span>
                        <span style="font-size: 0.82rem; font-weight: 600; color: #f1f5f9;">No bookings today</span>
                        <div style="font-size: 0.74rem; color: #64748b; margin-top: 2px;">Stylist is available for walk-in clients.</div>
                      </div>
                    ` : dailyEvents.map((ev) => {
                      const isBreak = ev.type === 'break';
                      const isSalonBreak = isBreak && ev.origin === 'SALON';
                      let badgeBg = 'rgba(59, 130, 246, 0.15)';
                      let badgeColor = '#60a5fa';
                      let badgeText = (ev.status || 'BOOKED').replace('_', ' ');

                      if (isSalonBreak) {
                        badgeBg = 'rgba(16, 185, 129, 0.18)';
                        badgeColor = '#34d399';
                        badgeText = '🔒 SALON BREAK';
                      } else if (isBreak) {
                        badgeBg = 'rgba(139, 92, 246, 0.18)';
                        badgeColor = '#c4b5fd';
                        badgeText = '☕ PERSONAL BREAK';
                      } else if (ev.status === 'COMPLETED') {
                        badgeBg = 'rgba(16, 185, 129, 0.15)';
                        badgeColor = '#34d399';
                        badgeText = 'DONE';
                      } else if (ev.status === 'IN_SERVICE' || ev.status === 'SEATED_IN_CHAIR') {
                        badgeBg = 'rgba(245, 158, 11, 0.15)';
                        badgeColor = '#fbbf24';
                        badgeText = 'IN CHAIR';
                      }

                      return `
                        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px; background: rgba(255, 255, 255, 0.02); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 6px; margin-bottom: 5px;">
                          <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                            <span style="font-size: 0.75rem; font-weight: 700; color: #e2e8f0; min-width: 105px;">
                              ${formatTimeMins(ev.startMins)} – ${formatTimeMins(ev.endMins)}
                            </span>
                            <div style="min-width: 0;">
                              <div style="font-size: 0.78rem; font-weight: 600; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 6px;">
                                <span>${isSalonBreak ? '🏢 ' + ev.title : (isBreak ? '☕ ' + ev.title : '✂️ ' + ev.title)}</span>
                                ${isSalonBreak ? '<span class="badge-salon-lock">Salon</span>' : ''}
                              </div>
                              ${!isBreak && ev.customer ? `<div style="font-size: 0.7rem; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">👤 ${ev.customer}</div>` : ''}
                            </div>
                          </div>
                          <div style="display: flex; align-items: center; gap: 6px; flex-shrink: 0;">
                            <span style="font-size: 0.68rem; color: #64748b;">${ev.endMins - ev.startMins}m</span>
                            <span style="font-size: 0.65rem; font-weight: 700; padding: 2px 6px; border-radius: 4px; background: ${badgeBg}; color: ${badgeColor};">
                              ${badgeText}
                            </span>
                          </div>
                        </div>
                      `;
                    }).join('')}
                  </div>
                </div>
              `;
            } else {
              // Visual Timeline Axis View (Horizontal Scrollable)
              let axisHtml = '';
              for (let m = startMins; m <= endMins; m += 30) {
                let leftPx = Math.round((m - startMins) * PIXELS_PER_MIN);
                let isHour = (m % 60 === 0);
                if (isHour) {
                  axisHtml += `
                    <div style="position: absolute; left: ${leftPx}px; top: 18px; bottom: 0; width: 1px; background: rgba(255,255,255,0.1); z-index: 1;"></div>
                    <div style="position: absolute; left: ${leftPx}px; top: 2px; transform: translateX(-50%); font-size: 0.66rem; color: #94a3b8; font-weight: 600; letter-spacing: 0.3px;">${formatTimeMins(m)}</div>
                  `;
                } else {
                  axisHtml += `
                    <div style="position: absolute; left: ${leftPx}px; top: 18px; height: 6px; width: 1px; background: rgba(255,255,255,0.06); z-index: 1;"></div>
                  `;
                }
              }

              let blocksHtml = '';
              let currentMins = startMins;

              dailyEvents.forEach((ev) => {
                // Free interval before event
                if (ev.startMins > currentMins) {
                  let gapDuration = ev.startMins - currentMins;
                  if (gapDuration >= 15) {
                    let gapLeft = Math.round((currentMins - startMins) * PIXELS_PER_MIN);
                    let gapWidth = Math.round(gapDuration * PIXELS_PER_MIN);
                    blocksHtml += `
                      <div style="position: absolute; top: 26px; left: ${gapLeft}px; width: ${gapWidth}px; height: 54px; background: rgba(255, 255, 255, 0.015); border: 1px dashed rgba(255, 255, 255, 0.08); border-radius: 6px; display: flex; align-items: center; justify-content: center; z-index: 1;" title="Free Slot (${gapDuration} mins)">
                        <span style="font-size: 0.6rem; color: #64748b; font-weight: 600;">Free • ${gapDuration >= 60 ? Math.floor(gapDuration / 60) + 'h ' + (gapDuration % 60) + 'm' : gapDuration + 'm'}</span>
                      </div>
                    `;
                  }
                }

                if (ev.endMins > currentMins) {
                  const trueStart = Math.max(currentMins, ev.startMins);
                  const duration = ev.endMins - trueStart;
                  let leftPx = Math.round((trueStart - startMins) * PIXELS_PER_MIN);
                  let widthPx = Math.round(duration * PIXELS_PER_MIN);

                  if (leftPx < 0) { widthPx += leftPx; leftPx = 0; }
                  if (leftPx + widthPx > trackWidth) widthPx = trackWidth - leftPx;

                  if (widthPx > 0) {
                    if (ev.type === 'break') {
                      const isSalon = ev.origin === 'SALON';
                      const breakBg = isSalon
                        ? 'linear-gradient(135deg, #059669, #047857)'
                        : 'linear-gradient(135deg, #7c3aed, #6d28d9)';
                      const breakBorder = isSalon
                        ? '1px solid rgba(52, 211, 153, 0.5)'
                        : '1px solid rgba(196, 181, 253, 0.4)';
                      const breakBadgeBg = isSalon ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.2)';
                      const breakLabel = isSalon ? '🔒 SALON' : '☕ PERSONAL';

                      blocksHtml += `
                        <div style="position: absolute; top: 26px; left: ${leftPx}px; width: ${widthPx}px; height: 54px; background: ${breakBg}; border: ${breakBorder}; border-radius: 7px; z-index: 3; padding: 4px 6px; box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.3);" title="Break: ${ev.title} (${duration}m)">
                          <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 0.54rem; font-weight: 800; color: #fff; text-transform: uppercase;">${breakLabel}</span>
                            <span style="font-size: 0.54rem; font-weight: 700; color: #fff; background: ${breakBadgeBg}; padding: 1px 4px; border-radius: 3px;">${duration}m</span>
                          </div>
                          <span style="font-size: 0.68rem; font-weight: 700; color: #fff; margin-top: auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${ev.title}</span>
                        </div>
                      `;
                    } else {
                      let bgGradient = 'linear-gradient(135deg, #2563eb, #1d4ed8)';
                      let borderClr = 'rgba(147, 197, 253, 0.4)';
                      let titleClr = '#eff6ff';
                      let badgeBg = 'rgba(0, 0, 0, 0.2)';
                      let badgeTxt = '#dbeafe';
                      let statusLabel = 'BOOKED';

                      if (ev.status === 'COMPLETED') {
                        bgGradient = 'linear-gradient(135deg, #059669, #047857)';
                        borderClr = 'rgba(110, 231, 183, 0.5)';
                        titleClr = '#ecfdf5';
                        badgeBg = 'rgba(0, 0, 0, 0.2)';
                        badgeTxt = '#d1fae5';
                        statusLabel = 'DONE';
                      } else if (ev.status === 'IN_SERVICE' || ev.status === 'SEATED_IN_CHAIR') {
                        bgGradient = 'linear-gradient(135deg, #d97706, #b45309)';
                        borderClr = 'rgba(252, 211, 77, 0.5)';
                        titleClr = '#fffbeb';
                        badgeBg = 'rgba(0, 0, 0, 0.2)';
                        badgeTxt = '#fef3c7';
                        statusLabel = 'IN CHAIR';
                      }

                      blocksHtml += `
                        <div style="position: absolute; top: 26px; left: ${leftPx}px; width: ${widthPx}px; height: 54px; background: ${bgGradient}; border: 1px solid ${borderClr}; border-radius: 7px; z-index: 3; padding: 4px 6px; box-sizing: border-box; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.3);" title="${ev.title} • ${ev.customer} (${duration}m)">
                          <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="font-size: 0.54rem; font-weight: 800; color: ${titleClr}; letter-spacing: 0.4px;">${statusLabel}</span>
                            <span style="font-size: 0.54rem; font-weight: 700; color: ${badgeTxt}; background: ${badgeBg}; padding: 1px 4px; border-radius: 3px;">${duration}m</span>
                          </div>
                          <span style="font-size: 0.68rem; font-weight: 700; color: #fff; margin-top: auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${ev.title}</span>
                          <span style="font-size: 0.56rem; color: ${badgeTxt}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">👤 ${ev.customer}</span>
                        </div>
                      `;
                    }
                  }
                  currentMins = Math.max(currentMins, ev.endMins);
                }
              });

              // Trailing free time until shift end
              if (currentMins < endMins) {
                let gapDuration = endMins - currentMins;
                if (gapDuration >= 15) {
                  let gapLeft = Math.round((currentMins - startMins) * PIXELS_PER_MIN);
                  let gapWidth = Math.round(gapDuration * PIXELS_PER_MIN);
                  blocksHtml += `
                    <div style="position: absolute; top: 26px; left: ${gapLeft}px; width: ${gapWidth}px; height: 54px; background: rgba(255, 255, 255, 0.015); border: 1px dashed rgba(255, 255, 255, 0.08); border-radius: 6px; display: flex; align-items: center; justify-content: center; z-index: 1;" title="Free Slot (${gapDuration} mins)">
                      <span style="font-size: 0.6rem; color: #64748b; font-weight: 600;">Free • ${gapDuration >= 60 ? Math.floor(gapDuration / 60) + 'h ' + (gapDuration % 60) + 'm' : gapDuration + 'm'}</span>
                    </div>
                  `;
                }
              }

              // Live Current Time Needle
              let currentTimeHtml = '';
              if (isNowInsideShift) {
                currentTimeHtml = `
                  <div style="position: absolute; left: ${nowLeftPx}px; top: 18px; bottom: 0; width: 2px; background: #f43f5e; z-index: 10; box-shadow: 0 0 8px rgba(244,63,94,0.8);">
                    <div style="position: absolute; bottom: 0; left: -3px; width: 8px; height: 8px; border-radius: 50%; background: #f43f5e;"></div>
                  </div>
                  <div style="position: absolute; left: ${nowLeftPx}px; top: 2px; transform: translateX(-50%); background: #f43f5e; color: #fff; font-size: 0.56rem; font-weight: 800; padding: 1px 6px; border-radius: 4px; z-index: 11; box-shadow: 0 2px 6px rgba(0,0,0,0.4); white-space: nowrap;">
                    NOW ${formatTimeMins(nowMins)}
                  </div>
                `;
              }

              scheduleWidgetHtml = `
                <div class="staff-schedule-panel">
                  <div class="staff-schedule-header">
                    <div style="display: flex; align-items: center; gap: 8px;">
                      <span style="font-size: 0.74rem; font-weight: 700; color: #f1f5f9;">
                        Shift: ${formatTimeMins(startMins)} – ${formatTimeMins(endMins)}
                      </span>
                      <span style="font-size: 0.68rem; color: #94a3b8;">(${Math.round(totalShiftMins / 60)}h)</span>
                    </div>

                    <div style="display: flex; align-items: center; gap: 6px;">
                      <div style="display: flex; background: rgba(0,0,0,0.3); padding: 2px; border-radius: 5px; border: 1px solid rgba(255,255,255,0.06);">
                        <button type="button" class="sched-control-btn btn-switch-sched-view active" data-id="${st.id}" data-mode="timeline" title="Visual Timeline View">
                          <span>📊 Timeline</span>
                        </button>
                        <button type="button" class="sched-control-btn btn-switch-sched-view" data-id="${st.id}" data-mode="agenda" title="Chronological Agenda List">
                          <span>📋 Agenda</span>
                        </button>
                      </div>

                      <div style="display: flex; align-items: center; gap: 3px;">
                        <button type="button" class="sched-control-btn btn-scroll-earlier" data-id="${st.id}" title="Scroll Earlier">◀</button>
                        ${isNowInsideShift ? `
                          <button type="button" class="sched-control-btn btn-jump-now" data-id="${st.id}" data-now-left="${nowLeftPx}" style="color: #fca5a5; border-color: rgba(252,165,165,0.3);" title="Jump to Current Time">
                            <span class="pulse-dot-live" style="background: #f87171; box-shadow: 0 0 6px #f87171;"></span>
                            <span>NOW</span>
                          </button>
                        ` : ''}
                        <button type="button" class="sched-control-btn btn-scroll-later" data-id="${st.id}" title="Scroll Later">▶</button>
                      </div>
                    </div>
                  </div>

                  <div style="padding: 10px 12px; width: 100%;">
                    <div class="staff-timeline-scroll-track" id="timeline-track-${st.id}" data-initial-scroll="${initialScroll}">
                      <div style="position: relative; width: ${trackWidth}px; height: 90px; padding-top: 2px;">
                        <div style="position: absolute; top: 18px; left: 0; right: 0; height: 1px; background: rgba(255,255,255,0.1);"></div>
                        ${axisHtml}
                        ${blocksHtml}
                        ${currentTimeHtml}
                      </div>
                    </div>

                    <div style="display: flex; gap: 10px; flex-wrap: wrap; font-size: 0.62rem; font-weight: 600; color: #94a3b8; margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.05); align-items: center; justify-content: flex-end;">
                      <div style="display: flex; align-items: center; gap: 4px;"><div style="width: 8px; height: 8px; background: #059669; border-radius: 2px;"></div> Done</div>
                      <div style="display: flex; align-items: center; gap: 4px;"><div style="width: 8px; height: 8px; background: #d97706; border-radius: 2px;"></div> In Chair</div>
                      <div style="display: flex; align-items: center; gap: 4px;"><div style="width: 8px; height: 8px; background: #7c3aed; border-radius: 2px;"></div> Break</div>
                      <div style="display: flex; align-items: center; gap: 4px;"><div style="width: 8px; height: 8px; background: #2563eb; border-radius: 2px;"></div> Booked</div>
                      <div style="display: flex; align-items: center; gap: 4px;"><div style="width: 8px; height: 8px; border: 1px dashed rgba(255,255,255,0.25); border-radius: 2px;"></div> Free</div>
                    </div>
                  </div>
                </div>
              `;
            }
          }

          return `
            <div class="staff-card" style="display: flex; flex-direction: column; justify-content: space-between;">
              <div>
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                  <div style="display: flex; align-items: center; gap: 12px;">
                    <img src="${st.profileImageUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150'}" style="width: 44px; height: 44px; border-radius: 50%; object-fit: cover; border: 2px solid rgba(255,255,255,0.12);" />
                    <div>
                      <div style="font-weight: 700; font-size: 1.05rem; color: #fff; line-height: 1.2;">${st.name || 'Specialist'}</div>
                      <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 2px;">${st.phone || 'No phone'}</div>
                    </div>
                  </div>
                  <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 4px;">
                    <span class="badge ${st.status === 'ACTIVE' ? 'badge-completed' : 'badge-cancelled'} btn-toggle-staff" data-id="${st.id}" style="font-size: 0.65rem; cursor: pointer;" title="Click to toggle Active/Inactive">
                      ${st.status || 'ACTIVE'}
                    </span>
                    ${isAbsentToday ? `
                      <span class="badge" style="background: rgba(251, 113, 133, 0.15); color: #fb7185; border: 1px solid rgba(251,113,133,0.3); font-size: 0.62rem; font-weight: 700;">
                        🚫 ON LEAVE
                      </span>
                    ` : ''}
                  </div>
                </div>

                <div style="background: rgba(0,0,0,0.3); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 10px 12px; margin-bottom: 12px;">
                  <div style="display: flex; align-items: center; justify-content: space-between;">
                    <div style="display: flex; align-items: center; gap: 8px; font-size: 0.82rem; font-weight: 600;">
                      <span class="status-dot ${statusDot}"></span>
                      <span style="color: #fff;">${statusText}</span>
                    </div>
                    <span style="font-size: 0.72rem; color: var(--text-muted);">
                      Today: <strong style="color: #fff;">${confirmedCount}</strong> Active • <strong style="color: #fff;">${completedCount}</strong> Done
                    </span>
                  </div>

                  <!-- Toggle Button for On-Demand Schedule & Timeline -->
                  <button type="button" class="btn-toggle-staff-schedule" data-id="${st.id}" style="width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; margin-top: 10px; background: ${isScheduleOpen ? 'rgba(99, 102, 241, 0.14)' : 'rgba(255, 255, 255, 0.04)'}; border: 1px solid ${isScheduleOpen ? 'rgba(99, 102, 241, 0.35)' : 'rgba(255, 255, 255, 0.08)'}; border-radius: 6px; color: ${isScheduleOpen ? '#a5b4fc' : '#cbd5e1'}; font-size: 0.76rem; font-weight: 600; cursor: pointer; transition: all 0.15s;">
                    <span style="display: flex; align-items: center; gap: 6px;">
                      <span>📅</span>
                      <span>${isScheduleOpen ? "Hide Today's Schedule" : "View Today's Schedule & Timeline"}</span>
                    </span>
                    <span style="display: flex; align-items: center; gap: 6px;">
                      <span style="font-size: 0.68rem; padding: 1px 6px; border-radius: 4px; background: ${dailyApptsCount > 0 ? 'rgba(52, 211, 153, 0.18)' : 'rgba(255,255,255,0.06)'}; color: ${dailyApptsCount > 0 ? '#34d399' : '#94a3b8'};">
                        ${dailyApptsCount} Appt${dailyApptsCount === 1 ? '' : 's'}${shiftBreaks.length > 0 ? ` • ${shiftBreaks.length} Break` : ''}
                      </span>
                      <span style="font-size: 0.72rem;">${isScheduleOpen ? '▲' : '▼'}</span>
                    </span>
                  </button>

                  ${scheduleWidgetHtml}
                </div>

                <div style="margin-bottom: 12px;">
                  <div class="meta-bullet-row">
                    <span style="color: var(--text-muted); font-size: 0.75rem;">QUALIFIED SERVICES (${st.services?.length || 0}):</span>
                    <span style="color: var(--text-secondary); font-size: 0.78rem; font-weight: 500;">
                      ${(st.services && st.services.length > 0)
                        ? st.services.map((svc) => svc.service?.name || 'Service').join(', ')
                        : 'None assigned'}
                    </span>
                  </div>
                </div>
              </div>

              <!-- 100% Retained Direct Action Buttons -->
              <div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 6px;">
                  <button class="btn btn-secondary btn-sm btn-edit-staff" data-id="${st.id}" data-name="${st.name || ''}" data-phone="${st.phone || ''}" data-email="${st.email || ''}" data-img="${st.profileImageUrl || ''}" style="font-size: 0.76rem; gap: 4px; justify-content: center;">
                    ${Icons.edit({ size: 13 })}
                    <span>Edit Info</span>
                  </button>
                  <button class="btn btn-secondary btn-sm btn-assign-services" data-id="${st.id}" data-name="${st.name || ''}" style="font-size: 0.76rem; gap: 4px; justify-content: center;">
                    ${Icons.scissors({ size: 13 })}
                    <span>Services</span>
                  </button>
                </div>

                <div class="segmented-action-bar">
                  <button class="segmented-action-btn btn-edit-hours" data-id="${st.id}" data-name="${st.name || ''}" title="Shift Working Hours">
                    <span>Hours</span>
                  </button>
                  <button class="segmented-action-btn btn-add-break" data-id="${st.id}" data-name="${st.name || ''}" title="Shift Breaks">
                    <span>Break</span>
                  </button>
                  <button class="segmented-action-btn btn-mark-absent" data-id="${st.id}" data-name="${st.name || ''}" style="color: #fb7185;" title="Record Leave">
                    <span>Leave</span>
                  </button>
                  <button class="segmented-action-btn btn-leave-history" data-id="${st.id}" data-name="${st.name || ''}" style="color: #818cf8;" title="Leave History & Actions">
                    <span>History</span>
                  </button>
                  <button class="segmented-action-btn danger-btn btn-delete-staff" data-id="${st.id}" data-name="${st.name || ''}" title="Delete Stylist">
                    ${Icons.trash({ size: 12 })}
                  </button>
                </div>
              </div>
            </div>
          `;
        }).join('');

        contentHtml = `
            <div class="staff-capacity-grid">
              ${staffCardsHtml}
            </div>
        `;
      }

      const allSchedulesOpen = this.staffList.length > 0 && this.staffList.every((s) => (this.openStaffScheduleIds || new Set()).has(s.id));

      return closureHtml + `
        <div class="glass-panel">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px;">
            <div>
              <h3 style="font-size: 1.25rem; display: flex; align-items: center; gap: 8px;">
                ${Icons.users({ size: 20, color: '#818cf8' })}
                <span>Stylist Shifts & Real-Time Capacity</span>
              </h3>
              <p style="color: var(--text-secondary); font-size: 0.85rem;">Manage staff members, personal details, weekly shift hours, and qualified services.</p>
            </div>
            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
              <button class="btn btn-secondary btn-sm" id="btn-toggle-all-schedules" style="gap: 6px;">
                <span>${allSchedulesOpen ? '⊟ Collapse All Schedules' : '⊞ Expand All Schedules'}</span>
              </button>
              <button class="btn btn-secondary btn-sm" id="btn-block-time" style="gap: 6px; border-color: rgba(251,113,133,0.3); color: #fb7185;">
                ${Icons.clock({ size: 14, color: '#fb7185' })}
                <span>Block Barber Time</span>
              </button>
              <button class="btn btn-primary btn-sm" id="btn-add-staff" style="gap: 6px;">
                ${Icons.plus({ size: 14 })}
                <span>Add New Stylist</span>
              </button>
            </div>
          </div>
          ${contentHtml}
        </div>
      `;
    } catch (err) {
      console.error('[Dashboard] renderStaffTab error:', err);
      return `<div class="glass-panel text-center" style="padding: 40px; color: var(--danger);">
        <i class="fas fa-exclamation-triangle" style="font-size: 2rem; margin-bottom: 12px;"></i>
        <h5>Failed to load Stylist Dashboard</h5>
        <p style="font-size: 0.85rem;">${err?.message || 'An unexpected error occurred.'}</p>
        <button class="btn btn-primary btn-sm" onclick="window.salonDashboard?.loadData(true).then(() => window.salonDashboard?.render())">
          Retry Loading
        </button>
      </div>`;
    }
  }
  renderServicesTab() {
    try {
      const services = Array.isArray(this.servicesList) ? this.servicesList : [];

      return `
        <div class="glass-panel">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px;">
            <div>
              <h3 style="font-size: 1.25rem; display: flex; align-items: center; gap: 8px;">
                ${Icons.scissors({ size: 20, color: '#818cf8' })}
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
                  <div class="settings-row-icon" style="background: rgba(99, 102, 241, 0.15); color: #818cf8;">
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

            <!-- Group 2: SALON & OPERATIONS -->
            <div class="settings-nav-group">
              <div class="settings-nav-label">Salon & Operations</div>
              <div class="settings-nav-list">
                <button type="button" class="settings-nav-row ${activeSub === 'storefront' ? 'active' : ''}" data-subtab="storefront">
                  <div class="settings-row-icon" style="background: rgba(16, 185, 129, 0.15); color: #34d399;">
                    ${Icons.scissors({ size: 16 })}
                  </div>
                  <div class="settings-row-content">
                    <span class="settings-row-title">Salon Storefront</span>
                    <span class="settings-row-desc">Public booking link & store details</span>
                  </div>
                  <span class="settings-row-chevron">${Icons.chevronRight({ size: 14 })}</span>
                </button>

                <button type="button" class="settings-nav-row ${activeSub === 'operations' ? 'active' : ''}" data-subtab="operations">
                  <div class="settings-row-icon" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8;">
                    ${Icons.calendar({ size: 16 })}
                  </div>
                  <div class="settings-row-content">
                    <span class="settings-row-title">Store Operations</span>
                    <span class="settings-row-desc">Weekly opening schedule & closures</span>
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
                  <div class="settings-row-icon" style="background: rgba(99, 102, 241, 0.15); color: #818cf8;">
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
              <div class="settings-header-icon" style="background: rgba(99, 102, 241, 0.15); color: #818cf8;">
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
                ${Icons.user({ size: 13, color: '#818cf8' })}
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
                  <span style="font-size: 0.64rem; color: #818cf8; font-weight: 600;">Used for password reset</span>
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
              <button type="submit" class="btn btn-primary" id="btn-save-profile" style="width: 100%; min-height: 42px; height: 42px; padding: 0 20px; font-weight: 700; font-size: 0.86rem; border-radius: 9px; background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); box-shadow: 0 4px 14px rgba(99, 102, 241, 0.35); display: flex; align-items: center; justify-content: center; gap: 8px;">
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

    // SECTION 2: SALON STOREFRONT & PUBLIC BOOKING
    if (subtab === 'storefront') {
      const cleanLocation = (() => {
        const raw = profile.address || profile.city || 'Indore, India';
        const parts = raw.split(',').map(s => s.trim()).filter(Boolean);
        return [...new Set(parts)].join(', ');
      })();

      const whatsappShareUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(`Book your appointment with ${profile.name || 'our salon'} online: ${bookingUrl}`)}`;

      return `
        <div class="settings-panel-card">
          <div class="settings-panel-header" style="margin-bottom: 12px; padding-bottom: 10px;">
            <div class="settings-header-left">
              <div class="settings-header-icon" style="background: rgba(16, 185, 129, 0.15); color: #34d399;">
                ${Icons.scissors({ size: 20 })}
              </div>
              <div>
                <h3 class="settings-panel-title">Salon Storefront & Booking Hub</h3>
                <p class="settings-panel-subtitle">Customer-facing booking website, social sharing, and live status.</p>
              </div>
            </div>
            <span class="badge ${isClosedToday ? 'badge-cancelled' : 'badge-completed'}" style="font-size: 0.68rem; padding: 3px 8px; border-radius: 6px;">
              ${isClosedToday ? `🔴 Closed (${todayClosure.closureType})` : '🟢 Live & Bookable'}
            </span>
          </div>

          <div class="settings-panel-body" style="gap: 12px;">
            <!-- Public Booking Hub -->
            <div class="settings-booking-hub" style="background: rgba(30, 41, 59, 0.45); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: 12px; padding: 12px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                <div style="font-size: 0.72rem; font-weight: 800; color: #a5b4fc; text-transform: uppercase; letter-spacing: 0.05em;">
                  Direct Customer Booking Link
                </div>
                <span style="font-size: 0.65rem; color: #94a3b8;">Share on bio / WhatsApp</span>
              </div>

              <div class="settings-booking-url-box" style="display: flex; align-items: center; gap: 8px; background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 8px; padding: 8px 10px; font-family: monospace; font-size: 0.78rem; color: #c7d2fe;">
                ${Icons.link({ size: 14, color: '#818cf8' })}
                <span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${bookingUrl}</span>
              </div>

              <!-- 4-Column Action Grid (Zero Stacked Bloat!) -->
              <div class="settings-booking-actions" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 4px;">
                <button type="button" class="btn btn-secondary btn-sm" id="btn-copy-invite" style="padding: 0 4px; font-size: 0.72rem; justify-content: center; height: 36px; border-radius: 8px;">
                  ${Icons.copy({ size: 13 })}
                  <span>Copy</span>
                </button>
                <a href="${bookingUrl}" target="_blank" class="btn btn-secondary btn-sm" id="btn-preview-storefront" style="text-decoration: none; padding: 0 4px; font-size: 0.72rem; justify-content: center; height: 36px; border-radius: 8px; background: rgba(99, 102, 241, 0.15); border-color: rgba(99, 102, 241, 0.35); color: #c7d2fe;">
                  ${Icons.externalLink({ size: 13 })}
                  <span>Open</span>
                </a>
                <a href="${whatsappShareUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" id="btn-share-whatsapp-store" style="text-decoration: none; padding: 0 4px; font-size: 0.72rem; justify-content: center; height: 36px; border-radius: 8px; color: #25D366; background: rgba(37, 211, 102, 0.1); border-color: rgba(37, 211, 102, 0.3);">
                  ${Icons.whatsapp ? Icons.whatsapp({ size: 13 }) : '💬'}
                  <span>Share</span>
                </a>
                <button type="button" class="btn btn-secondary btn-sm" id="btn-open-qr" style="padding: 0 4px; font-size: 0.72rem; justify-content: center; height: 36px; border-radius: 8px;">
                  ${Icons.qrCode({ size: 13 })}
                  <span>Poster</span>
                </button>
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
                ${Icons.key ? Icons.key({ size: 13, color: '#818cf8' }) : Icons.lock({ size: 13, color: '#818cf8' })}
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
              <button type="submit" class="btn btn-primary" id="btn-submit-change-password" style="width: 100%; min-height: 42px; height: 42px; padding: 0 20px; font-weight: 700; font-size: 0.86rem; border-radius: 9px; background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); box-shadow: 0 4px 14px rgba(99, 102, 241, 0.35); display: flex; align-items: center; justify-content: center; gap: 8px;">
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

    // SECTION 4: STORE OPERATIONS & SCHEDULES
    if (subtab === 'operations') {
      return `
        <div class="settings-panel-card">
          <div class="settings-panel-header" style="padding-bottom: 8px; margin-bottom: 10px;">
            <div class="settings-header-left">
              <div class="settings-header-icon" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; width: 32px; height: 32px; border-radius: 8px;">
                ${Icons.calendar({ size: 18 })}
              </div>
              <div>
                <h3 class="settings-panel-title" style="font-size: 1.02rem; margin: 0 0 2px 0;">Store Operations & Schedules</h3>
                <p class="settings-panel-subtitle" style="font-size: 0.78rem;">Configure weekly business hours, facility breaks, and holiday closures.</p>
              </div>
            </div>
          </div>

          <div class="settings-panel-body" style="gap: 8px;">
            <!-- Action Navigation Tiles -->
            <div class="settings-tools-grid">
              <div class="settings-tool-tile" id="card-feature-salon-schedule">
                <div class="settings-tile-icon" style="background: rgba(16, 185, 129, 0.12); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.25);">
                  ${Icons.calendar({ size: 17 })}
                </div>
                <div class="settings-tile-content">
                  <div class="settings-tile-title">Weekly Operating Schedule</div>
                  <div class="settings-tile-desc">Recurring hours, shifts & facility lunch breaks</div>
                </div>
                <div class="settings-tile-arrow">${Icons.chevronRight({ size: 14 })}</div>
              </div>

              <div class="settings-tool-tile settings-tool-tile--warning" id="card-feature-closures">
                <div class="settings-tile-icon" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3);">
                  ${Icons.alertTriangle ? Icons.alertTriangle({ size: 17, color: '#f87171' }) : '🚨'}
                </div>
                <div class="settings-tile-content">
                  <div class="settings-tile-title">
                    <span>Store Closures & Holidays</span>
                    <span class="badge badge-cancelled" style="font-size: 0.6rem; padding: 1px 5px; font-weight: 700;">HOLIDAYS</span>
                  </div>
                  <div class="settings-tile-desc">Festival off-days & emergency 0-penalty closures</div>
                </div>
                <div class="settings-tile-arrow">${Icons.chevronRight({ size: 14 })}</div>
              </div>
            </div>

            <!-- Operations Telemetry Metric Strip (Replaces bulky 4-row list) -->
            <div class="ops-telemetry-grid">
              <div class="ops-telemetry-item">
                <span class="ops-telemetry-label">Store Status</span>
                <span class="ops-telemetry-val" style="color: ${isClosedToday ? '#f87171' : '#34d399'};">
                  ${isClosedToday ? `🔴 Closed (${todayClosure.closureType})` : '🟢 Live & Online'}
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
        </div>
      `;
    }

    // SECTION 5: STORE USERS & CUSTOMER CRM
    if (subtab === 'customers') {
      const activeFilter = this.activeCustomerFilter || 'ALL';
      return `
        <div class="settings-panel-card">
          <div class="settings-panel-header cust-panel-header">
            <div class="settings-header-left">
              <div class="settings-header-icon" style="background: rgba(99, 102, 241, 0.15); color: #818cf8;">
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
      container.innerHTML = this.renderProfileSubtabContent();
      this.attachProfileSubtabListeners();
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  attachProfileSubtabListeners() {
    // 1. Navigation switcher
    document.querySelectorAll('.settings-nav-row[data-subtab]').forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        const sub = btn.getAttribute('data-subtab');
        if (sub) this.switchProfileSubtab(sub);
      };
    });

    // 2. Mobile Back button
    document.getElementById('btn-settings-mobile-back')?.addEventListener('click', () => {
      this.mobileSettingsDrilled = false;
      const layoutRoot = document.getElementById('settings-layout-root');
      if (layoutRoot) {
        layoutRoot.classList.remove('settings-drilled');
      }
      document.querySelector('.settings-container')?.classList.remove('settings-drilled-active');
      document.querySelector('.settings-page-header')?.classList.remove('settings-page-header-drilled');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

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

    // 4. Subtab: Storefront Copy Link & QR
    const copyLinkHandler = () => {
      const slug = this.salonProfile?.slug || 'the-grand-royal-barber-1';
      const url = `${window.location.origin}/#book/${slug}`;
      navigator.clipboard.writeText(url);
      this.showToast('Booking link copied to clipboard!', 'success');
    };
    document.getElementById('btn-copy-invite')?.addEventListener('click', copyLinkHandler);
    document.getElementById('btn-copy-invite-subtab')?.addEventListener('click', copyLinkHandler);
    document.getElementById('btn-open-qr')?.addEventListener('click', () => {
      this.showQRCodeModal();
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
      this.openSalonClosuresModal();
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
  attachEventListeners() {
    // Logout
    const handleLogout = async () => {
      await ApiClient.logout();
      window.location.hash = '#login';
      window.location.reload();
    };
    document.getElementById('btn-logout')?.addEventListener('click', handleLogout);
    document.getElementById('card-feature-logout')?.addEventListener('click', handleLogout);

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

    // Add Staff Modal
    document.getElementById('btn-add-staff')?.addEventListener('click', () => {
      this.showAddStaffModal();
    });

    // Edit Staff Modal
    this.container.querySelectorAll('.btn-edit-staff').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const staff = {
          id: e.currentTarget.getAttribute('data-id'),
          name: e.currentTarget.getAttribute('data-name'),
          phone: e.currentTarget.getAttribute('data-phone'),
          email: e.currentTarget.getAttribute('data-email'),
          profileImageUrl: e.currentTarget.getAttribute('data-img'),
        };
        this.showEditStaffModal(staff);
      });
    });

    // Delete Staff Modal
    this.container.querySelectorAll('.btn-delete-staff').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const name = e.currentTarget.getAttribute('data-name');
        this.showDeleteStaffModal(id, name);
      });
    });

    // Edit Shift Hours
    this.container.querySelectorAll('.btn-edit-hours').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const name = e.currentTarget.getAttribute('data-name');
        this.showEditStaffHoursModal(id, name);
      });
    });

    // Block Time Modal
    document.getElementById('btn-block-time')?.addEventListener('click', () => {
      this.showBlockTimeModal();
    });

    // Toggle Staff Status
    this.container.querySelectorAll('.btn-toggle-staff').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        this.handleToggleStaff(id);
      });
    });

    // Assign Services to Staff
    this.container.querySelectorAll('.btn-assign-services').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const name = e.currentTarget.getAttribute('data-name');
        this.showAssignServicesModal(id, name);
      });
    });

    // Add Break to Staff
    this.container.querySelectorAll('.btn-add-break').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const name = e.currentTarget.getAttribute('data-name');
        this.showAddBreakModal(id, name);
      });
    });

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
        e.currentTarget.style.background = 'rgba(99,102,241,0.3)';
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
  }

  /**
   * PERFORMANCE: Re-attach only event listeners inside #tab-content.
   * Called during targeted SSE re-renders to avoid re-binding global header/nav listeners.
   */
  attachTabEventListeners() {
    const tabContent = document.getElementById('tab-content');
    if (!tabContent) return;

    // Dashboard Quick Action Cards
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

    // Staff Tab Buttons
    document.getElementById('btn-add-staff')?.addEventListener('click', () => this.showAddStaffModal());
    tabContent.querySelectorAll('.btn-edit-staff').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        this.showEditStaffModal({
          id: e.currentTarget.getAttribute('data-id'),
          name: e.currentTarget.getAttribute('data-name'),
          phone: e.currentTarget.getAttribute('data-phone'),
          email: e.currentTarget.getAttribute('data-email'),
          profileImageUrl: e.currentTarget.getAttribute('data-img'),
        });
      });
    });
    tabContent.querySelectorAll('.btn-delete-staff').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        this.showDeleteStaffModal(e.currentTarget.getAttribute('data-id'), e.currentTarget.getAttribute('data-name'));
      });
    });
    tabContent.querySelectorAll('.btn-edit-hours').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        this.showEditStaffHoursModal(e.currentTarget.getAttribute('data-id'), e.currentTarget.getAttribute('data-name'));
      });
    });
    tabContent.querySelectorAll('.btn-toggle-staff').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        this.handleToggleStaff(id);
      });
    });
    tabContent.querySelectorAll('.btn-assign-services').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        this.showAssignServicesModal(e.currentTarget.getAttribute('data-id'), e.currentTarget.getAttribute('data-name'));
      });
    });
    tabContent.querySelectorAll('.btn-add-break').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        this.showAddBreakModal(e.currentTarget.getAttribute('data-id'), e.currentTarget.getAttribute('data-name'));
      });
    });
    tabContent.querySelectorAll('.btn-mark-absent').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        this.showMarkAbsentModal(e.currentTarget.getAttribute('data-id'), e.currentTarget.getAttribute('data-name'));
      });
    });
    tabContent.querySelectorAll('.btn-leave-history').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        this.showLeaveHistoryModal(e.currentTarget.getAttribute('data-id'), e.currentTarget.getAttribute('data-name'));
      });
    });
    tabContent.querySelectorAll('.btn-cancel-absent').forEach((btn) => {
      btn.addEventListener('click', handleCancelAbsent);
    });
    this.attachStaffScheduleListeners(tabContent);

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
      b.onclick = () => this.openSalonClosuresModal();
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
                <input type="date" class="form-control" id="walkin-date" value="${this.selectedDate}" required />
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
              <input type="date" class="form-control" id="reschedule-date" value="${this.selectedDate}" required />
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
    if (!id) return;
    const idx = this.staffList.findIndex((s) => String(s.id) === String(id));
    if (idx !== -1) {
      this.staffList[idx] = {
        ...this.staffList[idx],
        status: this.staffList[idx].status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
      };
      this.render();
    }
    try {
      await ApiClient.toggleStaffStatus(id);
      this.loadData(true).then(() => this.refreshActiveTab()).catch(() => { });
    } catch (err) {
      alert(`Status update failed: ${err.message}`);
      this.loadData(true).then(() => this.render()).catch(() => { });
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
                ${defaultEmail ? `<span style="font-size: 0.72rem; color: #818cf8; font-weight: 500;">✓ Pre-filled with salon email</span>` : ''}
              </div>
              <input type="email" class="form-control" id="new-staff-email" value="${defaultEmail}" placeholder="stylist@example.com" />
              <small style="display: block; margin-top: 4px; font-size: 0.75rem; color: var(--text-muted);">Defaulted to salon email. You can change this if needed.</small>
            </div>

            <div class="form-group">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <label style="margin: 0; font-size: 0.88rem; font-weight: 600;">Select Qualified Services</label>
                <span style="font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #a5b4fc; background: rgba(99, 102, 241, 0.12); padding: 2px 8px; border-radius: 9999px; border: 1px solid rgba(99, 102, 241, 0.25);">Optional</span>
              </div>

              ${hasServices ? `
                <div style="max-height: 160px; overflow-y: auto; background: var(--bg-input, #0f172a); padding: 10px; border-radius: 8px; border: 1px solid var(--border-subtle, rgba(255,255,255,0.1)); display: flex; flex-direction: column; gap: 6px;">
                  ${this.servicesList.map((s) => `
                    <label style="display: flex; align-items: center; gap: 10px; font-size: 0.86rem; padding: 7px 10px; border-radius: 6px; cursor: pointer; transition: background 0.15s ease; background: rgba(255, 255, 255, 0.03);" onmouseover="this.style.background='rgba(99,102,241,0.12)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'">
                      <input type="checkbox" class="staff-service-chk" value="${s.id}" checked style="accent-color: var(--primary-accent, #6366f1); cursor: pointer; width: 16px; height: 16px;" />
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
                  <button type="button" id="btn-quick-goto-services" style="display: inline-flex; align-items: center; gap: 6px; font-size: 0.78rem; font-weight: 600; color: #818cf8; background: rgba(99, 102, 241, 0.12); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 6px; padding: 6px 14px; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='rgba(99,102,241,0.22)'" onmouseout="this.style.background='rgba(99,102,241,0.12)'">
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
                  <label style="display: flex; align-items: center; gap: 10px; font-size: 0.88rem; padding: 7px 10px; border-radius: 6px; cursor: pointer; transition: background 0.15s ease; background: rgba(255, 255, 255, 0.03);" onmouseover="this.style.background='rgba(99,102,241,0.12)'" onmouseout="this.style.background='rgba(255,255,255,0.03)'">
                    <input type="checkbox" class="chk-assign-svc" value="${s.id}" ${assignedIds.includes(s.id) ? 'checked' : ''} style="accent-color: var(--primary-accent, #6366f1); cursor: pointer; width: 16px; height: 16px;" />
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
                <span>Add Personal Break for <span id="label-selected-day" style="color: #818cf8;">Monday</span></span>
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

                <button type="submit" class="btn btn-primary" id="btn-submit-break" style="width: 100%; min-height: 42px; font-weight: 700; background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%);">
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
            }).catch(() => {});
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
        }).catch(() => {});
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
    this.leaveUI.showCreateLeaveModal(staffId, staffName);
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
          }).catch(() => {});
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

  async openSalonClosuresModal() {
    const modalContainer = document.getElementById('modal-container');
    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content modal-content-lg" style="max-height: 90vh; overflow-y: auto; padding: 24px; max-width: 780px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <div>
              <h3 style="font-size: 1.35rem; font-weight: 800; color: #fff; margin-bottom: 4px; display: flex; align-items: center; gap: 8px;">
                <span>🚨 Store Closures & Holiday Calendar</span>
              </h3>
              <p style="color: var(--text-secondary); font-size: 0.82rem; margin: 0;">
                Schedule planned festival holidays or trigger instant zero-penalty emergency store closures.
              </p>
            </div>
            <button class="close-btn" id="btn-close-closures-modal">&times;</button>
          </div>

          <!-- Top Action Bar -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); padding: 12px 16px; border-radius: var(--radius-sm);">
            <div style="font-size: 0.85rem; font-weight: 700; color: #fff;">
              Salon Closures List
            </div>
            <button class="btn btn-primary btn-sm" id="btn-show-add-closure-form" style="background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); font-weight: 700; border: none; box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);">
              + Schedule Closure / Holiday
            </button>
          </div>

          <!-- Add Closure Form Container (Hidden by default) -->
          <div id="container-add-closure-form" style="display: none; background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: var(--radius-sm); padding: 16px; margin-bottom: 20px;">
            <h4 style="font-size: 1rem; font-weight: 700; color: #f87171; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between;">
              <span>🗓️ New Store Closure Specification</span>
              <button type="button" class="btn btn-secondary btn-sm" id="btn-cancel-add-closure" style="padding: 2px 8px; font-size: 0.75rem;">✕ Close Form</button>
            </h4>

            <form id="form-create-closure">
              <div style="display: flex; flex-direction: column; gap: 14px;">
                <!-- Closure Type Selector -->
                <div>
                  <label class="form-label" style="font-size: 0.8rem; font-weight: 700; color: #fff; margin-bottom: 6px;">Closure Category *</label>
                  <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px;">
                    <label style="display: flex; flex-direction: column; gap: 4px; border: 1px solid var(--border-subtle); padding: 10px; border-radius: var(--radius-sm); cursor: pointer; background: var(--bg-input); font-size: 0.8rem;" class="type-pill">
                      <div style="display: flex; align-items: center; gap: 6px; font-weight: 700; color: #fff;">
                        <input type="radio" name="closureType" value="HOLIDAY" checked /> 🌴 Planned Holiday
                      </div>
                      <span style="font-size: 0.72rem; color: var(--text-muted);">Diwali, Eid, National Holidays</span>
                    </label>

                    <label style="display: flex; flex-direction: column; gap: 4px; border: 1px solid rgba(239,68,68,0.4); padding: 10px; border-radius: var(--radius-sm); cursor: pointer; background: rgba(239,68,68,0.08); font-size: 0.8rem;" class="type-pill">
                      <div style="display: flex; align-items: center; gap: 6px; font-weight: 700; color: #f87171;">
                        <input type="radio" name="closureType" value="EMERGENCY_CLOSURE" /> 🚨 Emergency Closure
                      </div>
                      <span style="font-size: 0.72rem; color: var(--text-muted);">Power Cut, Maintenance, Emergency</span>
                    </label>

                    <label style="display: flex; flex-direction: column; gap: 4px; border: 1px solid var(--border-subtle); padding: 10px; border-radius: var(--radius-sm); cursor: pointer; background: var(--bg-input); font-size: 0.8rem;" class="type-pill">
                      <div style="display: flex; align-items: center; gap: 6px; font-weight: 700; color: #fff;">
                        <input type="radio" name="closureType" value="PARTIAL_DAY" /> ⏳ Partial-Day Hours
                      </div>
                      <span style="font-size: 0.72rem; color: var(--text-muted);">Closing early or opening late</span>
                    </label>
                  </div>
                </div>

                <!-- Date Range -->
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                  <div>
                    <label class="form-label" style="font-size: 0.78rem; font-weight: 700; color: #fff;">Start Date *</label>
                    <input type="date" class="form-control" id="closure-start-date" required value="${new Date().toISOString().split('T')[0]}" />
                  </div>
                  <div>
                    <label class="form-label" style="font-size: 0.78rem; font-weight: 700; color: #fff;">End Date *</label>
                    <input type="date" class="form-control" id="closure-end-date" required value="${new Date().toISOString().split('T')[0]}" />
                  </div>
                </div>

                <!-- Partial Day Hours (Only shown if PARTIAL_DAY selected) -->
                <div id="row-partial-day-hours" style="display: none; grid-template-columns: 1fr 1fr; gap: 12px; background: rgba(255,255,255,0.02); border: 1px dashed var(--border-subtle); padding: 10px; border-radius: var(--radius-sm);">
                  <div>
                    <label class="form-label" style="font-size: 0.78rem; font-weight: 700; color: #fbbf24;">Closed From Time *</label>
                    <input type="time" class="form-control" id="closure-start-time" value="14:00" />
                  </div>
                  <div>
                    <label class="form-label" style="font-size: 0.78rem; font-weight: 700; color: #fbbf24;">Closed Until Time *</label>
                    <input type="time" class="form-control" id="closure-end-time" value="19:00" />
                  </div>
                </div>

                <!-- Reason -->
                <div>
                  <label class="form-label" style="font-size: 0.78rem; font-weight: 700; color: #fff;">Closure Reason / Note *</label>
                  <input type="text" class="form-control" id="closure-reason" placeholder="e.g. Festival Holiday / Sudden Power Cut & Maintenance" required />
                </div>

                <!-- Emergency Banner Warning -->
                <div id="closure-emergency-notice" style="display: none; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); padding: 10px 12px; border-radius: var(--radius-sm); font-size: 0.78rem; color: #f87171; line-height: 1.4;">
                  ⚡ <strong>0-Penalty Emergency Guarantee:</strong> Creating an Emergency Closure will instantly cancel all overlapping <code>CONFIRMED</code>, <code>CHECKED_IN</code>, and <code>PENDING</code> appointments. Affected clients receive zero no-show penalty strikes and are notified via emergency WhatsApp apology messages.
                </div>

                <!-- Submit Button -->
                <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px;">
                  <button type="submit" class="btn btn-primary" id="btn-submit-create-closure" style="background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%); font-weight: 700; width: 100%;">
                    🚀 Create Store Closure & Block Booking Calendar
                  </button>
                </div>
              </div>
            </form>
          </div>

          <!-- Loading Spinner / Content Area -->
          <div id="closures-loading" style="text-align: center; padding: 40px; color: var(--text-muted);">
            ⏳ Loading Store Closures from Database...
          </div>

          <div id="closures-list-container" style="display: none;">
            <!-- Populated dynamically -->
          </div>
        </div>
      </div>
    `;

    const closeBtn = document.getElementById('btn-close-closures-modal');
    closeBtn?.addEventListener('click', () => (modalContainer.innerHTML = ''));

    const toggleFormBtn = document.getElementById('btn-show-add-closure-form');
    const formContainer = document.getElementById('container-add-closure-form');
    const cancelFormBtn = document.getElementById('btn-cancel-add-closure');

    toggleFormBtn?.addEventListener('click', () => {
      formContainer.style.display = formContainer.style.display === 'none' ? 'block' : 'none';
    });

    cancelFormBtn?.addEventListener('click', () => {
      formContainer.style.display = 'none';
    });

    // Handle Closure Type Radio Switch
    const radioTypes = document.querySelectorAll('input[name="closureType"]');
    const partialHoursRow = document.getElementById('row-partial-day-hours');
    const emergencyNotice = document.getElementById('closure-emergency-notice');

    radioTypes.forEach((radio) => {
      radio.addEventListener('change', (e) => {
        const val = e.target.value;
        if (val === 'PARTIAL_DAY') {
          partialHoursRow.style.display = 'grid';
        } else {
          partialHoursRow.style.display = 'none';
        }

        if (val === 'EMERGENCY_CLOSURE') {
          emergencyNotice.style.display = 'block';
        } else {
          emergencyNotice.style.display = 'none';
        }
      });
    });

    // Function to render closures list
    const fetchAndRenderClosures = async () => {
      const loadingDiv = document.getElementById('closures-loading');
      const listDiv = document.getElementById('closures-list-container');
      if (loadingDiv) loadingDiv.style.display = 'block';
      if (listDiv) listDiv.style.display = 'none';

      try {
        const closures = await ApiClient.getSalonClosures(true);
        if (loadingDiv) loadingDiv.style.display = 'none';
        if (listDiv) listDiv.style.display = 'block';

        if (!closures || closures.length === 0) {
          listDiv.innerHTML = `
            <div style="text-align: center; padding: 30px; background: rgba(255,255,255,0.02); border: 1px dashed var(--border-subtle); border-radius: var(--radius-sm); color: var(--text-muted);">
              🌴 No store closures or holidays currently configured.<br>
              <span style="font-size: 0.78rem;">Click <strong>"+ Schedule Closure / Holiday"</strong> to block operating dates.</span>
            </div>
          `;
          return;
        }

        listDiv.innerHTML = `
          <div style="display: flex; flex-direction: column; gap: 12px;">
            ${closures.map((c) => {
              const startDateFormatted = new Date(c.startDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
              const endDateFormatted = new Date(c.endDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
              const isSameDate = startDateFormatted === endDateFormatted;
              const dateDisplay = isSameDate ? startDateFormatted : `${startDateFormatted} → ${endDateFormatted}`;

              let typeBadge = '';
              if (c.closureType === 'HOLIDAY') {
                typeBadge = `<span class="badge" style="background: rgba(59,130,246,0.15); color: #60a5fa; border: 1px solid rgba(59,130,246,0.3); font-size: 0.7rem; font-weight: 800;">🌴 PLANNED HOLIDAY</span>`;
              } else if (c.closureType === 'EMERGENCY_CLOSURE') {
                typeBadge = `<span class="badge" style="background: rgba(239,68,68,0.2); color: #f87171; border: 1px solid rgba(239,68,68,0.4); font-size: 0.7rem; font-weight: 800;">🚨 EMERGENCY CLOSURE</span>`;
              } else {
                typeBadge = `<span class="badge" style="background: rgba(245,158,11,0.15); color: #fbbf24; border: 1px solid rgba(245,158,11,0.3); font-size: 0.7rem; font-weight: 800;">⏳ PARTIAL-DAY (${c.startTime || '00:00'} - ${c.endTime || '23:59'})</span>`;
              }

              return `
                <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 14px; display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;">
                  <div style="flex: 1; min-width: 240px;">
                    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                      ${typeBadge}
                      <span style="font-size: 0.88rem; font-weight: 700; color: #fff;">${dateDisplay}</span>
                    </div>
                    <div style="font-size: 0.82rem; color: var(--text-secondary); line-height: 1.4;">
                      Reason: <strong style="color: #fff;">${c.reason}</strong>
                    </div>
                    ${c.cancelledAppointmentsCount > 0 ? `
                      <div style="font-size: 0.75rem; color: #f87171; margin-top: 4px; font-weight: 600;">
                        ⚠️ Auto-cancelled ${c.cancelledAppointmentsCount} appointment(s) with 0 customer penalty.
                      </div>
                    ` : ''}
                  </div>
                  <div>
                    <button class="btn btn-secondary btn-sm btn-delete-closure" data-id="${c.id}" style="border-color: rgba(239,68,68,0.4); color: #f87171; font-size: 0.78rem;">
                      🗑️ Reopen / Delete
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;

        // Bind delete buttons
        listDiv.querySelectorAll('.btn-delete-closure').forEach((btn) => {
          btn.addEventListener('click', async (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            if (confirm('Are you sure you want to delete this store closure and reopen the booking calendar for these dates?')) {
              try {
                await ApiClient.deleteSalonClosure(id);
                fetchAndRenderClosures();
              } catch (err) {
                alert(err.message || 'Failed to delete store closure.');
              }
            }
          });
        });
      } catch (err) {
        if (loadingDiv) loadingDiv.style.display = 'none';
        if (listDiv) {
          listDiv.style.display = 'block';
          listDiv.innerHTML = `
            <div style="color: #f87171; padding: 14px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); border-radius: var(--radius-sm); font-size: 0.85rem;">
              Failed to load store closures: ${err.message || 'Server error'}
            </div>
          `;
        }
      }
    };

    // Form Submit Handler
    document.getElementById('form-create-closure')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('btn-submit-create-closure');
      const closureType = document.querySelector('input[name="closureType"]:checked')?.value || 'HOLIDAY';
      const startDate = document.getElementById('closure-start-date').value;
      const endDate = document.getElementById('closure-end-date').value;
      const startTime = document.getElementById('closure-start-time').value;
      const endTime = document.getElementById('closure-end-time').value;
      const reason = document.getElementById('closure-reason').value.trim();

      if (!startDate || !endDate || !reason) {
        alert('Please fill in all required fields.');
        return;
      }

      if (endDate < startDate) {
        alert('End date cannot be earlier than start date.');
        return;
      }

      const payload = {
        closureType,
        startDate,
        endDate,
        reason,
        autoCancelAppointments: true
      };

      if (closureType === 'PARTIAL_DAY') {
        payload.startTime = startTime;
        payload.endTime = endTime;
      }

      submitBtn.textContent = 'Enforcing Store Closure...';
      submitBtn.setAttribute('disabled', 'true');

      try {
        await ApiClient.createSalonClosure(payload);
        formContainer.style.display = 'none';
        submitBtn.textContent = '🚀 Create Store Closure & Block Booking Calendar';
        submitBtn.removeAttribute('disabled');
        fetchAndRenderClosures();
      } catch (err) {
        alert(err.message || 'Failed to create store closure.');
        submitBtn.textContent = '🚀 Create Store Closure & Block Booking Calendar';
        submitBtn.removeAttribute('disabled');
      }
    });

    // Initial Load
    fetchAndRenderClosures();
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
            <div style="background: rgba(99,102,241,0.08); border: 1px solid rgba(99,102,241,0.25); border-radius: var(--radius-md); padding: 12px 16px; margin-bottom: 18px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
              <label style="display: flex; align-items: center; gap: 12px; cursor: pointer; margin: 0;">
                <input type="checkbox" id="chk-follow-salon" ${followsSalonSchedule ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: #6366f1;" />
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
        <div style="background: rgba(99, 102, 241, 0.05); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: 12px; padding: 10px 12px; margin-bottom: 12px;">
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
                    CONFIRMED: 'rgba(99,102,241,0.2); color: #818cf8',
                    COMPLETED: 'rgba(16,185,129,0.2); color: #34d399',
                    CANCELLED: 'rgba(239,68,68,0.2); color: #f87171',
                    NO_SHOW: 'rgba(245,158,11,0.2); color: #fbbf24',
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
                <button class="btn" id="btn-opt-remove-1" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; font-size: 0.8rem; font-weight: 600; border-radius: 8px; background: rgba(99, 102, 241, 0.1); border: 1px solid rgba(99, 102, 241, 0.25); color: #c7d2fe; transition: all 0.15s ease;">
                  <span style="display: flex; align-items: center; gap: 6px;">
                    <span>➖</span>
                    <span>Remove 1 Strike (Set to ${Math.max(0, currentStrikes - 1)}/3)</span>
                  </span>
                  <span style="font-size: 0.68rem; font-weight: 700; background: rgba(99, 102, 241, 0.25); padding: 2px 7px; border-radius: 6px; color: #e0e7ff;">-1 Strike</span>
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


