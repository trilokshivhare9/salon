import { ApiClient, formatTime12h, SalonRepository, NetworkHealth, ConnectionState } from './api.js';
import * as IndianFestivals from '@aryanjsx/indian-festivals';
import { RealtimeNotifier } from './realtime.js';
import { QueueSyncManager } from './queue/queue-sync.js';
import { SoundManager } from './sound.js';
import { Icons } from './icons.js';
import { LeaveManagementUI } from './leave-management.js';
import { LocationPicker } from './location-picker.js';
import { HomeManager } from './modules/home/home-manager.js';
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
import { PersonalProfileView } from './modules/salon-settings/personal-profile-view.js';
import { BookingQrView } from './modules/salon-settings/booking-qr-view.js';
import { PasswordSecurityView } from './modules/salon-settings/password-security-view.js';
import { ServicesAiScannerModal } from './modules/services-ai/services-ai-scanner.js';
import {
  SERVICE_DURATION_OPTIONS,
  renderServiceDurationOptions,
} from './constants.js';
import { AppointmentStatus, StatusPredicates } from './constants/appointment-status.js';
import { LoadingOverlay } from './modules/shared/loading-overlay.js';

export {
  SERVICE_DURATION_OPTIONS,
  renderServiceDurationOptions,
  LoadingOverlay,
};

function showNotification(msg, type = 'info') {
  let cleanMsg = typeof msg === 'object' ? (msg.message || JSON.stringify(msg)) : String(msg || '');
  if (cleanMsg.length > 200) {
    cleanMsg = cleanMsg.slice(0, 200) + '...';
  }

  const isError = type === 'error' || type === 'danger';
  const isWarning = type === 'warning';
  const isSuccess = type === 'success';

  const variant = isError ? 'danger' : (isWarning ? 'warning' : (isSuccess ? 'success' : 'info'));
  const icon = isError ? '✕' : (isWarning ? '⚠️' : (isSuccess ? '✓' : '⚡'));
  const badgeText = isError ? 'Error' : (isWarning ? 'Notice' : (isSuccess ? 'Success' : 'Salon Update'));

  RealtimeNotifier.showLuxuryBanner({
    badgeText,
    title: cleanMsg,
    clientName: cleanMsg,
    icon,
    variant,
  });
}

// Global Service Description Expansion Handler (Module Top-Level, Available Immediately)
window._expandedServiceDescIds = window._expandedServiceDescIds || new Set();

window.toggleServiceDesc = function(targetId, btnEl, event) {
  if (event && event._descHandled) return;
  if (event) {
    event._descHandled = true;
    try {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      if (typeof event.stopPropagation === 'function') event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    } catch (_) {}
  }

  const btn = (btnEl instanceof HTMLElement)
    ? btnEl
    : (event?.target ? event.target.closest('.btn-service-desc-more') : null);

  const wrap = btn?.closest('.service-card-desc-wrap');
  const textEl = (typeof targetId === 'string' && targetId ? document.getElementById(targetId) : null)
    || wrap?.querySelector('.service-card-desc-text')
    || btn?.previousElementSibling;

  if (!textEl) return;

  const rawId = textEl.id || (typeof targetId === 'string' ? targetId : '');
  const serviceId = rawId.replace('svc-desc-', '');

  const isCurrentlyExpanded = textEl.classList.contains('is-expanded') || textEl.getAttribute('data-expanded') === 'true';

  if (isCurrentlyExpanded) {
    if (serviceId) window._expandedServiceDescIds.delete(serviceId);
    textEl.setAttribute('data-expanded', 'false');
    textEl.classList.remove('is-expanded');
    textEl.classList.add('is-clamped');
    textEl.style.display = '-webkit-box';
    textEl.style.webkitLineClamp = '1';
    textEl.style.webkitBoxOrient = 'vertical';
    textEl.style.overflow = 'hidden';
    if (btn) btn.textContent = 'See more';
  } else {
    if (serviceId) window._expandedServiceDescIds.add(serviceId);
    textEl.setAttribute('data-expanded', 'true');
    textEl.classList.remove('is-clamped');
    textEl.classList.add('is-expanded');
    textEl.style.display = 'block';
    textEl.style.webkitLineClamp = 'none';
    textEl.style.webkitBoxOrient = 'unset';
    textEl.style.overflow = 'visible';
    if (btn) btn.textContent = 'See less';
  }
};

// Immediate global delegation in capture phase (module top-level, catches all clicks)
if (typeof document !== 'undefined' && !window._serviceDescListenerRegistered) {
  window._serviceDescListenerRegistered = true;
  document.addEventListener('click', (e) => {
    const descBtn = e.target.closest('.btn-service-desc-more');
    if (!descBtn) return;
    const targetId = descBtn.getAttribute('data-target');
    window.toggleServiceDesc(targetId, descBtn, e);
  }, true);
}

export function getApptServices(appt) {
  if (!appt) return [];

  // 1) If appt.services is a non-empty array
  if (Array.isArray(appt.services) && appt.services.length > 0) {
    return appt.services.map((s, idx) => {
      const name = s.serviceNameSnapshot || s.service?.name || s.name || 'Service';
      const durationMinutes = s.durationMinutes || s.service?.durationMinutes || 0;
      const price = s.price !== undefined && s.price !== null
        ? Number(s.price)
        : (s.service?.price !== undefined && s.service?.price !== null ? Number(s.service.price) : null);
      const isAddon = (s.orderIndex !== undefined && s.orderIndex > 0) || idx > 0 || Boolean(s.service?.isAddon || s.isAddon);
      return { name, durationMinutes, price, isAddon, raw: s };
    });
  }

  // 2) If serviceNameSnapshot contains comma or plus separated values (e.g. "Hair Cut, Beard Trim" or "Hair Cut + Beard")
  if (appt.serviceNameSnapshot && typeof appt.serviceNameSnapshot === 'string' && (appt.serviceNameSnapshot.includes(',') || appt.serviceNameSnapshot.includes('+'))) {
    const rawParts = appt.serviceNameSnapshot.split(/[,+]/).map((n) => n.trim()).filter(Boolean);
    const totalDur = appt.durationMinutes || 0;
    const primaryDur = appt.service?.durationMinutes || 0;
    return rawParts.map((name, idx) => {
      const isAddon = idx > 0;
      let durationMinutes = 0;
      if (idx === 0) {
        durationMinutes = primaryDur || (rawParts.length === 1 ? totalDur : 0);
      } else if (idx === rawParts.length - 1 && primaryDur > 0 && totalDur > primaryDur) {
        durationMinutes = totalDur - primaryDur;
      } else if (totalDur > primaryDur && primaryDur > 0) {
        durationMinutes = Math.round((totalDur - primaryDur) / (rawParts.length - 1));
      }
      return { name, durationMinutes, price: null, isAddon };
    });
  }

  // 3) If appt.service is object
  if (appt.service && appt.service.name) {
    const mainName = appt.service.name;
    const mainDur = appt.service.durationMinutes || appt.durationMinutes || 0;

    // Check if appt.serviceNameSnapshot has add-on names not equal to mainName
    if (appt.serviceNameSnapshot && typeof appt.serviceNameSnapshot === 'string' && appt.serviceNameSnapshot !== mainName) {
      const parts = appt.serviceNameSnapshot.split(/[,+]/).map((n) => n.trim()).filter(Boolean);
      const addonParts = parts.filter((p) => p !== mainName);
      if (addonParts.length > 0) {
        const totalDur = appt.durationMinutes || 0;
        const primaryDur = appt.service.durationMinutes || 0;
        const remainingDur = Math.max(0, totalDur - primaryDur);
        const addonDur = Math.round(remainingDur / addonParts.length);

        const list = [{ name: mainName, durationMinutes: primaryDur || mainDur, price: null, isAddon: false }];
        addonParts.forEach((aName) => {
          list.push({ name: aName, durationMinutes: addonDur, price: null, isAddon: true });
        });
        return list;
      }
    }

    return [{ name: mainName, durationMinutes: mainDur, price: null, isAddon: false }];
  }

  // 4) If serviceNameSnapshot is a single string
  if (appt.serviceNameSnapshot && typeof appt.serviceNameSnapshot === 'string') {
    return [{ name: appt.serviceNameSnapshot.trim(), durationMinutes: appt.durationMinutes || 0, price: null, isAddon: false }];
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
    this.summaryData = {
      statusCounts: { total: 0, confirmed: 0, checkedIn: 0, inService: 0, completed: 0, cancelled: 0, noShow: 0 },
      todayAppointments: [],
      todayRevenue: 0,
      timezone: 'Asia/Kolkata',
      whatsappQuota: { limit: 1000, used: 0, remaining: 1000, percentUsed: 0, resetsOn: '1st of next month' },
    };
    this.queueFilter = 'ALL';
    this.queueDrawerFilters = {
      stylistId: '',
      bookingType: '',
      status: '',
      categoryId: '',
    };
    this.calNavDate = null;
    this.queueSummary = null;
    this.recentAppointments = [];
    this.queueSync = new QueueSyncManager({
      selectedDate: this.selectedDate,
      statusFilter: this.queueFilter,
      onStateChange: ({ items, summary }) => {
        if (this.summaryData && items) {
          this.summaryData.todayAppointments = items;
        }
        if (summary) {
          this.queueSummary = summary;
        }
        if (this.activeTab === 'queue' || this.activeTab === 'dashboard') {
          this.refreshActiveTab();
        }
        this.updateQuickRequestsBadge();
      },
    });
    this.staffList = [];
    this.servicesList = [];
    this.categoriesList = [];
    this.salonProfile = this.currentUser?.salon ? { ...this.currentUser.salon } : {};
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
    this.aiScanner = new ServicesAiScannerModal(this);
    this.aiScanner.init();
    this.homeManager = new HomeManager({
      onOpenQrModal: () => this.showQRCodeModal(),
      onOpenQuickRequests: () => this.openQuickRequestsModal(),
      onSeatWalkIn: (stylistId) => this.showWalkInModal(stylistId),
      onViewFullQueue: () => this.switchTab('queue'),
      onOpenWalkIn: () => this.showWalkInModal(),
      onOpenClosures: () => {
        this.switchTab('profile');
        this.switchProfileSubtab('closures');
      },
      onOpenServices: () => this.switchTab('services'),
      onViewStaff: () => this.switchTab('staff'),
      onCopyLink: () => {
        const slug = this.salonProfile?.slug || 'salon';
        const url = `${window.location.origin}/#book/${slug}`;
        navigator.clipboard.writeText(url);
        if (typeof showNotification === 'function') {
          showNotification('📋 Booking link copied to clipboard!', 'success');
        } else {
          alert(`Booking link copied:\n${url}`);
        }
      },
      onFilterQueue: (filter) => {
        this.queueFilter = filter;
        this.switchTab('queue');
      },
      onUpdateStatus: async (id, status) => {
        try {
          await ApiClient.updateAppointmentStatus(id, status);
          if (typeof showNotification === 'function') {
            showNotification(`Updated appointment status to ${status}`, 'success');
          }
          if (this.activeTab === 'home') {
            const fresh = await ApiClient.getDashboardSummary(this.selectedDate, true).catch(() => null);
            if (fresh) this.summaryData = fresh;
            this.refreshActiveTab();
          } else {
            await this.loadData(true);
            this.refreshActiveTab();
          }
        } catch (err) {
          console.error('[Dashboard] Status update failed:', err);
          if (typeof showNotification === 'function') {
            showNotification(err.message || 'Status update failed', 'error');
          }
        }
      },
    });

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
    this.lastLocalActionTimestamp = Date.now();
    window.lastDashboardActionTimestamp = Date.now();
    showNotification(msg, type);
  }

  showScheduleSavingIndicator(text = 'Saving...') {
    LoadingOverlay.show(text);
  }

  hideScheduleSavingIndicator(success = true, text = 'Saved') {
    LoadingOverlay.hide(150);
  }

  openQuickRequestsModal() {
    const pool = (Array.isArray(this.summaryData?.quickRequests) && this.summaryData.quickRequests.length > 0)
      ? this.summaryData.quickRequests
      : (this.summaryData?.todayAppointments || this.queueSync?.items || []);
    const pendingRequests = pool.filter(
      (a) => a.status === 'PENDING_ACCEPTANCE' || (a.source === 'QUICK_BOOK' && a.status === 'PENDING_ACCEPTANCE')
    );

    // Group pending requests by stylist
    const stylistGroups = [];
    const stylistGroupMap = new Map();

    for (const req of pendingRequests) {
      const sId = req.stylist?.id || req.staff?.id || 'unassigned';
      if (!stylistGroupMap.has(sId)) {
        const group = {
          stylist: req.stylist?.id
            ? req.stylist
            : (req.staff?.id ? req.staff : { id: 'unassigned', name: 'Any Specialist', colorCode: '#94a3b8' }),
          requests: [],
        };
        stylistGroupMap.set(sId, group);
        stylistGroups.push(group);
      }
      stylistGroupMap.get(sId).requests.push(req);
    }

    let modal = document.getElementById('modal-quick-requests');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'modal-quick-requests';
    modal.className = 'modal-backdrop';
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0; width: 100%; height: 100%;
      background: rgba(8, 6, 14, 0.85); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      z-index: 99999; display: flex; align-items: center; justify-content: center;
      padding: 16px; box-sizing: border-box; overflow-y: auto;
    `;

    const renderReqCard = (req) => {
        const clientName = req.customer?.name || req.customerPhone || 'In-Salon Client';
        const clientPhone = req.customer?.phone || req.customerPhone || '';
        const reqServices = getApptServices(req);
        const serviceName = reqServices.length > 0
          ? reqServices.map((s) => `${s.name}${s.isAddon ? ' (Add-on)' : ''}`).join(' + ')
          : (req.serviceNameSnapshot || req.service?.name || 'Quick Service');
        const rawTime = req.startTime || req.startAt;
        const timeStr = rawTime
          ? (typeof formatTime12h === 'function' ? formatTime12h(rawTime) : new Date(rawTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }))
          : 'Today';
        const specialist = req.staff?.name || req.stylist?.name || 'Any Specialist';
        const finalPrice = req.totalPrice !== undefined ? req.totalPrice : req.price;
        const price = finalPrice ? `₹${Number(finalPrice).toLocaleString('en-IN')}` : '';

        // Clean customer initials
        const nameParts = clientName.trim().split(/\s+/);
        const initials = nameParts.length >= 2
          ? (nameParts[0][0] + nameParts[nameParts.length - 1][0]).toUpperCase()
          : (clientName.substring(0, 2) || 'CL').toUpperCase();

        // High quality channel badge (compact)
        let channelBadge = '';
        if (req.source === 'WHATSAPP') {
          channelBadge = `
            <span style="display: inline-flex; align-items: center; gap: 3px; background: rgba(34, 197, 94, 0.15); border: 1px solid rgba(34, 197, 94, 0.35); color: #4ade80; font-size: 0.66rem; font-weight: 700; padding: 1px 7px; border-radius: 9999px;">
              ${Icons.messageCircle ? Icons.messageCircle({ size: 11, color: '#4ade80' }) : '💬'}
              <span>WhatsApp</span>
            </span>
          `;
        } else if (req.source === 'QUICK_BOOK') {
          channelBadge = `
            <span style="display: inline-flex; align-items: center; gap: 3px; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.35); color: #fbbf24; font-size: 0.66rem; font-weight: 700; padding: 1px 7px; border-radius: 9999px;">
              ${Icons.qrCode ? Icons.qrCode({ size: 11, color: '#fbbf24' }) : '📱'}
              <span>Store QR</span>
            </span>
          `;
        } else {
          channelBadge = `
            <span style="display: inline-flex; align-items: center; gap: 3px; background: rgba(56, 189, 248, 0.15); border: 1px solid rgba(56, 189, 248, 0.35); color: #38bdf8; font-size: 0.66rem; font-weight: 700; padding: 1px 7px; border-radius: 9999px;">
              ${Icons.user ? Icons.user({ size: 11, color: '#38bdf8' }) : '📲'}
              <span>App</span>
            </span>
          `;
        }

        return `
          <div class="quick-req-card" style="background: #1e172e; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 11px; padding: 10px 12px; margin-bottom: 8px; box-sizing: border-box; width: 100%; display: block; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);">
            
            <!-- Row 1: Header (Avatar, Name, Badge & Price/Time) -->
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px;">
              
              <!-- Avatar + Name & Phone -->
              <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                <div style="width: 32px; height: 32px; border-radius: 8px; background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 0.78rem; color: #ffffff; flex-shrink: 0;">
                  ${initials}
                </div>

                <div style="min-width: 0;">
                  <div style="display: flex; align-items: center; gap: 6px;">
                    <span style="font-weight: 700; color: #ffffff; font-size: 0.92rem; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;">
                      ${clientName}
                    </span>
                    ${channelBadge}
                  </div>
                  ${clientPhone ? `
                    <div style="margin-top: 1px;">
                      <a href="tel:${clientPhone}" style="color: #94a3b8; font-size: 0.72rem; text-decoration: none; display: inline-flex; align-items: center; gap: 4px; font-weight: 500;">
                        ${Icons.phone ? Icons.phone({ size: 10, color: '#94a3b8' }) : '📞'}
                        <span>${clientPhone}</span>
                      </a>
                    </div>
                  ` : ''}
                </div>
              </div>

              <!-- Price & Time -->
              <div style="text-align: right; flex-shrink: 0;">
                <div style="font-weight: 800; color: #34d399; font-size: 1.1rem; font-family: var(--font-heading, sans-serif); line-height: 1;">
                  ${price}
                </div>
                <div style="display: inline-flex; align-items: center; gap: 3px; color: #cbd5e1; font-size: 0.70rem; font-weight: 600; margin-top: 2px;">
                  ${Icons.clock ? Icons.clock({ size: 11, color: '#94a3b8' }) : '🕒'}
                  <span>${timeStr}</span>
                </div>
              </div>

            </div>

            <!-- Row 2: Service & Specialist Box (Inline Horizontal Strip) -->
            <div style="background: rgba(0, 0, 0, 0.22); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 7px; padding: 5px 9px; margin-bottom: 7px; font-size: 0.76rem; display: flex; flex-direction: column; gap: 3px;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap;">
                <div style="display: inline-flex; align-items: center; gap: 5px; min-width: 0;">
                  <span style="color: #fbbf24; font-weight: 700; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em;">Service:</span>
                  <span style="color: #ffffff; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${serviceName}</span>
                </div>
                <div style="display: inline-flex; align-items: center; gap: 5px; min-width: 0;">
                  <span style="color: #c084fc; font-weight: 700; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em;">Specialist:</span>
                  <span style="color: #f1f5f9; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${specialist}</span>
                </div>
              </div>
              ${req.notes ? `
                <div style="font-size: 0.70rem; color: #94a3b8; font-style: italic; border-top: 1px dashed rgba(255, 255, 255, 0.07); padding-top: 2px; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                  "${req.notes}"
                </div>
              ` : ''}
            </div>

            <!-- Row 3: Action Buttons (Compact & Prominent) -->
            <div style="display: flex; gap: 8px; width: 100%;">
              <button type="button" class="btn-accept-quick-req" data-id="${req.id}" style="flex: 1; padding: 7px 10px; font-weight: 700; font-size: 0.80rem; letter-spacing: 0.01em; display: flex; align-items: center; justify-content: center; gap: 6px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border: none; border-radius: 8px; color: #ffffff; cursor: pointer; box-shadow: 0 3px 10px rgba(16, 185, 129, 0.3); transition: all 0.2s ease;">
                ${Icons.check ? Icons.check({ size: 14, color: '#ffffff', strokeWidth: 2.5 }) : '✓'}
                <span>Accept & Check In</span>
              </button>
              <button type="button" class="btn-decline-quick-req" data-id="${req.id}" style="flex: 1; padding: 7px 10px; font-weight: 700; font-size: 0.80rem; display: flex; align-items: center; justify-content: center; gap: 6px; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 8px; color: #f87171; cursor: pointer; transition: all 0.2s ease;">
                ${Icons.x ? Icons.x({ size: 14, color: '#f87171', strokeWidth: 2.5 }) : '✕'}
                <span>Decline</span>
              </button>
            </div>

          </div>
        `;
    };

    const listHtml = pendingRequests.length === 0
      ? `
        <div style="text-align: center; padding: 48px 20px; color: #94a3b8; display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <div style="width: 56px; height: 56px; border-radius: 16px; background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.25); display: flex; align-items: center; justify-content: center; margin-bottom: 14px;">
            ${Icons.check ? Icons.check({ size: 28, color: '#34d399', strokeWidth: 2.5 }) : '✓'}
          </div>
          <h4 style="color: #f8fafc; margin: 0 0 6px 0; font-size: 1.08rem; font-weight: 700;">All Caught Up!</h4>
          <p style="font-size: 0.84rem; color: #94a3b8; margin: 0; max-width: 280px; line-height: 1.4;">
            There are no pending quick booking check-in requests waiting for approval right now.
          </p>
        </div>
      `
      : stylistGroups.map((group) => {
          const sName = group.stylist?.name || 'Any Specialist';
          const sColor = group.stylist?.colorCode || '#8b5cf6';
          const sInitial = (sName.charAt(0) || 'S').toUpperCase();
          const reqCount = group.requests.length;

          return `
            <div class="stylist-request-group" style="margin-bottom: 14px;">
              <!-- Stylist Group Header Banner -->
              <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 12px; margin-bottom: 8px; border-radius: 9px; background: rgba(255, 255, 255, 0.04); border-left: 3px solid ${sColor};">
                <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
                  <div style="width: 24px; height: 24px; border-radius: 6px; background: ${sColor}33; border: 1px solid ${sColor}88; display: flex; align-items: center; justify-content: center; font-size: 0.72rem; font-weight: 800; color: #ffffff; flex-shrink: 0;">
                    ${sInitial}
                  </div>
                  <div style="min-width: 0;">
                    <span style="font-weight: 700; font-size: 0.86rem; color: #f8fafc;">
                      ${sName}
                    </span>
                  </div>
                </div>
                <span style="font-size: 0.72rem; font-weight: 700; color: #fbbf24; background: rgba(245, 158, 11, 0.12); padding: 2px 8px; border-radius: 6px; border: 1px solid rgba(245, 158, 11, 0.25); flex-shrink: 0;">
                  ${reqCount} ${reqCount === 1 ? 'Request' : 'Requests'}
                </span>
              </div>

              <!-- Cards for this stylist -->
              <div style="display: flex; flex-direction: column; gap: 6px;">
                ${group.requests.map((req) => renderReqCard(req)).join('')}
              </div>
            </div>
          `;
        }).join('');

    modal.innerHTML = `
      <style>
        .quick-req-card {
          transition: transform 0.15s ease, border-color 0.15s ease;
        }
        .quick-req-card:hover {
          border-color: rgba(245, 158, 11, 0.45) !important;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5) !important;
        }
        .btn-accept-quick-req:hover {
          filter: brightness(1.1);
          transform: translateY(-1px);
        }
        .btn-decline-quick-req:hover {
          background: rgba(239, 68, 68, 0.22) !important;
          border-color: rgba(239, 68, 68, 0.5) !important;
        }
        #btn-close-quick-requests-modal:hover {
          background: rgba(255, 255, 255, 0.16) !important;
          color: #ffffff !important;
        }
      </style>
      <div class="modal-card" style="background: #140f20; border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 16px; max-width: 500px; width: 100%; max-height: 85vh; display: flex; flex-direction: column; box-shadow: 0 25px 60px rgba(0, 0, 0, 0.75); margin: auto; overflow: hidden;">
        
        <!-- Header -->
        <div style="padding: 13px 16px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); display: flex; justify-content: space-between; align-items: center; gap: 12px; background: rgba(245, 158, 11, 0.05); flex-shrink: 0;">
          
          <!-- Left: Icon + Title & Subtitle -->
          <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
            <div style="width: 32px; height: 32px; border-radius: 8px; background: rgba(245, 158, 11, 0.16); border: 1px solid rgba(245, 158, 11, 0.35); display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
              ${Icons.zap ? Icons.zap({ size: 16, color: '#fbbf24' }) : '⚡'}
            </div>
            <div style="min-width: 0;">
              <h3 style="margin: 0; color: #ffffff; font-size: 1.02rem; font-weight: 800; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                Quick Booking Requests
              </h3>
              <div style="font-size: 0.70rem; color: #94a3b8; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                Review and approve incoming WhatsApp & QR appointments
              </div>
            </div>
          </div>

          <!-- Right: Pending Badge + Close Button -->
          <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
            ${pendingRequests.length > 0 ? `
              <span style="background: rgba(245, 158, 11, 0.16); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.38); font-size: 0.68rem; font-weight: 700; padding: 3px 8px; border-radius: 9999px; white-space: nowrap; display: inline-flex; align-items: center; flex-shrink: 0; line-height: 1.2;">
                ${pendingRequests.length} Pending
              </span>
            ` : ''}
            <button id="btn-close-quick-requests-modal" type="button" aria-label="Close" style="width: 28px; height: 28px; border-radius: 50%; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.12); color: #94a3b8; font-size: 0.9rem; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; transition: all 0.15s ease;">
              ✕
            </button>
          </div>

        </div>

        <!-- Body: Block display with smooth vertical scroll, cards never squish -->
        <div style="padding: 10px 12px; overflow-y: auto; flex: 1; -webkit-overflow-scrolling: touch; display: block;">
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
          await ApiClient.acceptQuickBooking(id);
          this.showToast('Quick booking accepted & customer checked in!', 'success');
          modal.remove();
          await this.refreshCurrentView(true);
          this.render();
        } catch (err) {
          this.showToast(`Error accepting booking: ${err.message}`, 'danger');
          btn.disabled = false;
          btn.innerText = '✓ Accept & Check In';
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
          await ApiClient.declineQuickBooking(id);
          this.showToast('Quick booking declined.', 'warning');
          modal.remove();
          await this.refreshCurrentView(true);
          this.render();
        } catch (err) {
          this.showToast(`Error declining booking: ${err.message}`, 'danger');
          btn.disabled = false;
          btn.innerText = '✕ Decline';
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

  async init(initialTab = null) {
    try {
      try {
        const savedTab = initialTab || sessionStorage.getItem('active_dashboard_tab');
        if (savedTab && ['dashboard', 'staff', 'queue', 'services', 'profile', 'customers', 'whatsapp-logs'].includes(savedTab)) {
          this.activeTab = savedTab;
        }
      } catch (_) { }

      // Listen for network state changes and server health events
      this.initNetworkListeners();

      const hasCache = SalonRepository.hasCachedWorkspace();

      if (hasCache) {
        // FAST PATH: Instant Frame-1 Paint (<15ms)
        const cachedWorkspace = SalonRepository.getCachedWorkspace();
        this.salonProfile = cachedWorkspace.profile || this.salonProfile || {};
        this.staffList = cachedWorkspace.staff || [];
        this.servicesList = cachedWorkspace.services || [];
        this.categoriesList = cachedWorkspace.categories || [];
        this.salonWorkingHours = cachedWorkspace.workingHours || [];

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

        // Render immediately with 0 delay and NO full-screen blocking spinner!
        this.render();

        // Silent background revalidation
        this.loadData(true).then(() => {
          this.refreshActiveTab();
          this.updateQuickRequestsBadge();
          this.updateOfflineBanner();
        }).catch((err) => {
          console.warn('[Dashboard] Background revalidation warning:', err);
          this.updateOfflineBanner();
        });
      } else {
        // COLD BOOT: Show loading indicator with strict timeout guard
        this.renderLoading();

        // Timeout guard: never trap the user for more than 3.5 seconds
        const loadPromise = this.loadData();
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Initial data load timeout')), 3500));

        try {
          await Promise.race([loadPromise, timeoutPromise]);
        } catch (err) {
          console.warn('[Dashboard] Cold boot load error/timeout:', err);
        }

        // If backend is unreachable and we have no cached salon profile, show server unreachable diagnostic screen
        if (NetworkHealth.isServerUnreachable() && (!this.salonProfile || !this.salonProfile.id)) {
          this.renderServerUnreachable(NetworkHealth.getLastError());
          return;
        }

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
      }

      // Repository reactive listener cleanup & registration
      if (this._repoUnsub) {
        this._repoUnsub.forEach((unsub) => unsub());
      }
      this._repoUnsub = [
        SalonRepository.on('staff:updated', (newStaff) => {
          this.staffList = newStaff;
          if (this.activeTab === 'staff') this.refreshActiveTab();
        }),
        SalonRepository.on('services:updated', (newServices) => {
          this.servicesList = newServices;
          if (this.activeTab === 'services') this.refreshActiveTab();
        }),
        SalonRepository.on('profile:updated', (newProfile) => {
          this.salonProfile = newProfile;
          if (this.activeTab === 'profile') this.refreshActiveTab();
        }),
      ];

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

          // 1. In-Memory Zero-Latency Queue Event Dispatch
          const syncResult = this.queueSync.handleRealtimeEvent(payload);
          if (syncResult && syncResult.handled && syncResult.mutated && syncResult.isCurrentDate) {
            // Handled completely in memory without redundant HTTP requests!
            this.updateQuickRequestsBadge();
            // Re-sync Home pulse in background so revenue and floor metrics stay 100% accurate
            if (this.activeTab === 'home') {
              ApiClient.getDashboardSummary(this.selectedDate, true).then((fresh) => {
                if (fresh) {
                  this.summaryData = fresh;
                  this.refreshActiveTab();
                }
              }).catch(() => {});
            }
            return;
          }

          // 2. Staff or Services updates
          const isStaffOrService = payload?.type === 'STAFF_UPDATED' || payload?.type === 'SERVICE_UPDATED';
          if (isStaffOrService) {
            if (payload?.type === 'STAFF_UPDATED') {
              this.staffList = await ApiClient.getStaff(true).catch(() => this.staffList);
            }
            if (payload?.type === 'SERVICE_UPDATED') {
              this.servicesList = await ApiClient.getServices(true).catch(() => this.servicesList);
            }
            // If currently on Home tab, refresh the Home feed directly so Staff & Services summaries update instantly
            if (this.activeTab === 'home') {
              const fresh = await ApiClient.getDashboardSummary(this.selectedDate, true).catch(() => null);
              if (fresh) this.summaryData = fresh;
              this.refreshActiveTab();
              return;
            }
            if (this.activeTab === 'staff' || this.activeTab === 'services') {
              this.render();
            }
            return;
          }

          // 3. Fallback for other events: If on Home tab, execute fast single-call sync
          if (this.activeTab === 'home') {
            const fresh = await ApiClient.getDashboardSummary(this.selectedDate, true).catch(() => null);
            if (fresh) this.summaryData = fresh;
            this.updateQuickRequestsBadge();
            this.refreshActiveTab();
            return;
          }

          // Multi-tab deep reload
          await this.loadData(true);
          this.updateQuickRequestsBadge();
          this.refreshActiveTab();
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

      // Ensure nav tabs active class matches this.activeTab
      this.container.querySelectorAll('.nav-tab').forEach((el) => {
        el.classList.toggle('active', el.getAttribute('data-tab') === this.activeTab);
      });
      this.container.querySelectorAll('.bottom-nav-item').forEach((el) => {
        el.classList.toggle('active', el.getAttribute('data-tab') === this.activeTab);
      });

      // Update header quick requests button count
      const quickReqVal = this.container.querySelector('#header-quick-requests-val');
      if (quickReqVal) {
        const pendingCount = (this.summaryData?.todayAppointments || []).filter((a) => a.status === 'PENDING_ACCEPTANCE').length;
        quickReqVal.textContent = pendingCount;
      }

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
        staffTabSpan.textContent = `Stylists (${this.staffList.length}) • ${_tabAvailCount} Available`;
      }
      const servicesTabSpan = this.container.querySelector('.nav-tab[data-tab="services"] span');
      if (servicesTabSpan && this.servicesList) {
        servicesTabSpan.textContent = `Service Menu (${this.servicesList.length})`;
      }

      // Auto-remove setup required banner if store is active or setup is complete
      const totalStaff = (this.salonProfile?._count?.stylists !== undefined ? this.salonProfile._count.stylists : (this.staffList ? this.staffList.length : 0));
      const totalServices = (this.salonProfile?._count?.services !== undefined ? this.salonProfile._count.services : (this.servicesList ? this.servicesList.length : 0));
      const isStillSetupRequired = (this.salonProfile?.status && this.salonProfile.status !== 'ACTIVE') && (totalStaff === 0 || totalServices === 0);
      const setupBanner = this.container.querySelector('#setup-required-banner');
      if (setupBanner && !isStillSetupRequired) {
        setupBanner.remove();
      }

      if (window.history && window.history.replaceState) {
        try {
          const newHash = this.activeTab === 'dashboard' ? '#admin' : `#admin/${this.activeTab}`;
          window.history.replaceState(null, '', newHash);
        } catch (_) {}
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
  switchTab(targetTab, updateHistory = true) {
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

    if (updateHistory && window.history && window.history.replaceState) {
      try {
        const newHash = targetTab === 'dashboard' ? '#admin' : `#admin/${targetTab}`;
        window.history.replaceState(null, '', newHash);
      } catch (_) {}
    }

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
        if (targetTab === 'services') {
          ApiClient.getServices(true).then((fresh) => {
            if (Array.isArray(fresh)) {
              this.servicesList = fresh;
            }
          }).catch(() => {});
        }
      } catch (err) {
        console.error('[Dashboard] Error rendering tab:', targetTab, err);
      }
    } else {
      this.render();
    }
  }

  async refreshCurrentView(force = true) {
    const tab = this.activeTab || 'queue';
    try {
      if (tab === 'queue' || tab === 'dashboard') {
        await Promise.all([
          this.queueSync.fetchQueue(force).catch(() => {}),
          ApiClient.getDashboardSummary(this.selectedDate, force).then((s) => {
            if (s) this.summaryData = s;
          }).catch(() => {}),
        ]);
        if (Array.isArray(this.queueSync.items)) {
          this.summaryData.todayAppointments = this.queueSync.items;
        }
      } else if (tab === 'services') {
        const [services, categories] = await Promise.all([
          ApiClient.getServices(force).catch(() => this.servicesList),
          ApiClient.getServiceCategories(force).catch(() => this.categoriesList),
        ]);
        if (Array.isArray(services)) this.servicesList = services;
        if (Array.isArray(categories)) this.categoriesList = categories;
      } else if (tab === 'staff') {
        const staff = await ApiClient.getStaff(force).catch(() => this.staffList);
        if (Array.isArray(staff)) this.staffList = staff;
      } else if (tab === 'calendar') {
        const calData = await ApiClient.getCalendarSchedule({
          month: `${this.calYear}-${String(this.calMonth + 1).padStart(2, '0')}`,
        }, force).catch(() => null);
        if (calData) {
          const payload = calData.data || calData;
          this.calendarSchedule = payload;
          this.closuresList = payload?.salonSchedule?.closures || [];
        }
      } else {
        const profile = await ApiClient.getSalonProfile(force).catch(() => this.salonProfile);
        if (profile) this.salonProfile = profile;
      }
    } catch (err) {
      console.warn('[Dashboard] Targeted refresh failed:', err);
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
        this.queueSync.setDate(this.selectedDate);
        const bypass = !!fullReload;
        // Stage 1: Critical Core Data (Immediate display — fast path without cache-busting penalty)
        const [summary, staff, services, profile, queueRes, recentApptsRes] = await Promise.all([
          ApiClient.getDashboardSummary(this.selectedDate, bypass).catch((err) => {
            console.warn('[Dashboard] Summary fetch error:', err);
            return fallbackSummary;
          }),
          ApiClient.getStaff(bypass).catch((err) => {
            console.warn('[Dashboard] Staff fetch error:', err);
            return this.staffList || [];
          }),
          ApiClient.getServices(bypass).catch((err) => {
            console.warn('[Dashboard] Services fetch error:', err);
            return this.servicesList || [];
          }),
          ApiClient.getSalonProfile(bypass).catch((err) => {
            console.warn('[Dashboard] Profile fetch error:', err);
            return this.salonProfile || {};
          }),
          this.queueSync.fetchQueue(bypass).catch((err) => {
            console.warn('[Dashboard] Queue fetch error:', err);
            return null;
          }),
          ApiClient.getAppointments({ limit: 10 }).catch(() => []),
        ]);

        this.summaryData = summary || fallbackSummary;
        if (Array.isArray(this.queueSync.items)) {
          this.summaryData.todayAppointments = this.queueSync.items;
        }
        this.recentAppointments = Array.isArray(recentApptsRes)
          ? recentApptsRes
          : (Array.isArray(recentApptsRes?.data) ? recentApptsRes.data : (Array.isArray(recentApptsRes?.items) ? recentApptsRes.items : []));
        this.staffList = Array.isArray(staff) ? staff : [];
        this.servicesList = Array.isArray(services) ? services : [];
        this.salonProfile = profile || {};

        // Stage 2: Background Non-Blocking Enrichment (Hydrates categories, calendar, hours, breaks asynchronously)
        Promise.all([
          ApiClient.getServiceCategories(bypass).catch(() => this.categoriesList || []),
          ApiClient.getCalendarSchedule({
            month: `${this.calYear}-${String(this.calMonth + 1).padStart(2, '0')}`,
          }, bypass).catch(() => null),
          ApiClient.getSalonWorkingHours(bypass).catch(() => this.salonWorkingHours || []),
          ApiClient.getSalonBreaks(bypass).catch(() => this.salonBreaks || []),
        ]).then(([categories, calendarScheduleRes, workingHours, salonBreaks]) => {
          this.categoriesList = Array.isArray(categories) ? categories : [];
          const calData = calendarScheduleRes?.data || calendarScheduleRes;
          this.calendarSchedule = calData || null;
          this.closuresList = this.calendarSchedule?.salonSchedule?.closures || [];
          this.salonWorkingHours = this.calendarSchedule?.salonSchedule?.weeklyHours || (Array.isArray(workingHours) ? workingHours : (this.salonProfile?.workingHours || []));
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
          }
        }).catch((err) => console.warn('[Dashboard] Background enrichment error:', err));

      } catch (err) {
        console.warn('[Dashboard] loadData batch error:', err);
      }
    } else {
      try {
        this.queueSync.setDate(this.selectedDate);
        const [summary, queueRes] = await Promise.all([
          ApiClient.getDashboardSummary(this.selectedDate, true).catch(() => fallbackSummary),
          this.queueSync.fetchQueue(true).catch(() => null),
        ]);
        this.summaryData = summary || fallbackSummary;
        if (Array.isArray(this.queueSync.items)) {
          this.summaryData.todayAppointments = this.queueSync.items;
        }
      } catch (err) {
        console.warn('[Dashboard] date switch error:', err);
      }
    }
  }


  initNetworkListeners() {
    if (this._networkListenersInitialized) return;
    this._networkListenersInitialized = true;

    NetworkHealth.on('stateChanged', () => {
      this.updateOfflineBanner();
    });

    NetworkHealth.on('serverRestored', () => {
      showNotification('🟢 Salon server reconnected! Syncing live data...', 'info');
      this.loadData(true).then(() => {
        this.refreshActiveTab();
        this.updateQuickRequestsBadge();
        this.updateOfflineBanner();
      }).catch((err) => console.warn('[Dashboard] Sync on restore error:', err));
    });
  }

  updateOfflineBanner() {
    const slot = document.getElementById('salon-offline-banner-slot');
    if (!slot) return;

    if (!NetworkHealth.isServerUnreachable()) {
      slot.innerHTML = '';
      slot.style.display = 'none';
      return;
    }

    const isDeviceOffline = (typeof navigator !== 'undefined' && !navigator.onLine) || NetworkHealth.getState() === ConnectionState.OFFLINE;
    const label = isDeviceOffline ? 'No Internet' : 'Offline Mode';
    const subLabel = isDeviceOffline ? 'Check connection' : 'Showing saved data';
    const dotColor = isDeviceOffline ? '#ef4444' : '#f59e0b';
    const labelColor = isDeviceOffline ? '#fca5a5' : '#fbbf24';

    slot.style.display = 'block';
    slot.innerHTML = `
      <div id="salon-offline-pill" style="display: flex; align-items: center; justify-content: center; margin: 4px auto 14px auto; max-width: max-content;">
        <div style="background: rgba(28, 23, 38, 0.92); backdrop-filter: blur(14px); border: 1px solid rgba(245, 158, 11, 0.35); border-radius: 9999px; padding: 5px 14px; display: inline-flex; align-items: center; gap: 8px; font-size: 0.76rem; color: #f1f5f9; box-shadow: 0 4px 18px rgba(0,0,0,0.4);">
          <span style="width: 7px; height: 7px; border-radius: 50%; background: ${dotColor}; display: inline-block; box-shadow: 0 0 8px ${dotColor};"></span>
          <span style="font-weight: 700; color: ${labelColor};">${label}</span>
          <span style="color: #475569;">•</span>
          <span style="color: #94a3b8;">${subLabel}</span>
          <button type="button" id="btn-banner-retry" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); color: #fff; padding: 2px 10px; border-radius: 9999px; font-size: 0.70rem; cursor: pointer; margin-left: 2px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; transition: background 0.15s ease;">
            <span>Sync</span>
          </button>
        </div>
      </div>
    `;

    document.getElementById('btn-banner-retry')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Syncing...';
      const isAlive = await NetworkHealth.checkHealth();
      if (isAlive) {
        showNotification('Connected to salon server!', 'info');
        this.loadData(true).then(() => {
          this.refreshActiveTab();
          this.updateQuickRequestsBadge();
          this.updateOfflineBanner();
        });
      } else {
        btn.disabled = false;
        btn.textContent = 'Sync';
        showNotification(isDeviceOffline ? 'Still no internet connection. Please check your Wi-Fi or mobile data.' : 'Still offline. Data will sync automatically once connected.', 'warning');
      }
    });
  }

  renderServerUnreachable(errorDetails = null) {
    const isDeviceOffline = (typeof navigator !== 'undefined' && !navigator.onLine) || NetworkHealth.getState() === ConnectionState.OFFLINE;
    const title = isDeviceOffline ? 'No Internet Connection' : 'Unable to Connect';
    const desc = isDeviceOffline 
      ? 'Your device is currently offline. Please check your Wi-Fi or mobile data connection.'
      : "We're having trouble reaching the salon service. Please check your connection and try again.";
    const btnLabel = isDeviceOffline ? 'Check Connection' : 'Try Again';

    this.container.innerHTML = `
      <div style="min-height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 24px; background: #0c0f17; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
        <div style="width: 100%; max-width: 400px; text-align: center;">
          
          <div style="display: inline-flex; align-items: center; justify-content: center; width: 60px; height: 60px; border-radius: 20px; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); margin-bottom: 20px; font-size: 26px;">
            ${isDeviceOffline ? '📶' : '📡'}
          </div>

          <h2 style="font-size: 1.45rem; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 8px; color: #fff;">
            ${title}
          </h2>
          <p style="color: #94a3b8; font-size: 0.88rem; line-height: 1.5; margin-bottom: 24px;">
            ${desc}
          </p>

          <div style="display: flex; flex-direction: column; gap: 10px;">
            <button type="button" id="btn-unreachable-retry" class="btn btn-primary" style="width: 100%; padding: 13px; font-weight: 700; font-size: 0.92rem; justify-content: center;">
              <span>${btnLabel}</span>
            </button>

            <button type="button" id="btn-unreachable-logout" style="width: 100%; padding: 10px; background: transparent; border: none; color: #94a3b8; font-size: 0.82rem; cursor: pointer; margin-top: 4px;">
              Sign in with another account
            </button>
          </div>

        </div>
      </div>
    `;

    document.getElementById('btn-unreachable-retry')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Connecting...';
      const isAlive = await NetworkHealth.checkHealth();
      if (isAlive) {
        showNotification('Connection restored!', 'info');
        this.init();
      } else {
        btn.disabled = false;
        btn.textContent = btnLabel;
        showNotification(isDeviceOffline ? 'Still offline. Please check your Wi-Fi.' : 'Could not connect. Please try again in a moment.', 'warning');
      }
    });

    document.getElementById('btn-unreachable-logout')?.addEventListener('click', async () => {
      await ApiClient.logout();
      window.location.hash = '#login';
      window.location.reload();
    });
  }

  renderLoading() {
    // If persistent shell is already mounted, NEVER wipe the DOM during background syncs!
    if (this.container && this.container.querySelector('.portal-header')) {
      return;
    }

    this.container.innerHTML = `
      <div style="min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #0c0f17; color: #fff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; gap: 16px;">
        <div style="width: 46px; height: 46px; border: 3px solid rgba(168, 85, 247, 0.2); border-top-color: #a855f7; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
        <div style="font-size: 0.95rem; font-weight: 700; color: #e2e8f0; letter-spacing: -0.01em;">StyleSlot Operations</div>
        <div style="font-size: 0.78rem; color: #94a3b8;" id="loading-status-text">Connecting to salon workspace...</div>
      </div>
      <style>@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
    `;

    setTimeout(() => {
      const el = document.getElementById('loading-status-text');
      if (el) el.textContent = 'Verifying server connection...';
    }, 1800);
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
    // PERSISTENT SHELL PATTERN:
    // If outer shell (header and tab-content) is already mounted in DOM, update in-place with zero flicker.
    const existingTabContent = document.getElementById('tab-content');
    const existingHeader = this.container?.querySelector('.portal-header');
    if (existingTabContent && existingHeader) {
      this.refreshActiveTab();
      this.updateOfflineBanner();
      return;
    }

    const salonName = this.salonProfile?.name || 'Salon Operations';
    const salonSlug = this.salonProfile?.slug || 'salon';
    const webBookingUrl = `${window.location.origin}/#book/${salonSlug}`;

    // A salon is ONLY deactivated if its explicit status in DB is DEACTIVATED
    const isDeactivated = this.salonProfile?.status === 'DEACTIVATED';

    // A salon only requires initial setup onboarding if its status is NOT active AND it has 0 staff & 0 services
    const stylistCount = (this.salonProfile?._count?.stylists !== undefined ? this.salonProfile._count.stylists : (this.staffList ? this.staffList.length : 0));
    const serviceCount = (this.salonProfile?._count?.services !== undefined ? this.salonProfile._count.services : (this.servicesList ? this.servicesList.length : 0));
    const isSetupRequired = (this.salonProfile?.status && this.salonProfile.status !== 'ACTIVE') && (stylistCount === 0 || serviceCount === 0);

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

        <!-- Universal Offline / Reconnecting Banner Slot -->
        <div id="salon-offline-banner-slot" style="display: none;"></div>

        <!-- Setup Required Onboarding Banner (Only for genuinely inactive/unconfigured salons) -->
        ${isSetupRequired ? `
          <div id="setup-required-banner" style="background: linear-gradient(135deg, rgba(245,158,11,0.08) 0%, rgba(139, 61, 255,0.08) 100%); border: 1px solid rgba(245,158,11,0.3); border-radius: var(--radius-md); padding: 16px 20px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px;">
            <div style="display: flex; align-items: center; gap: 14px;">
              <div style="width: 44px; height: 44px; border-radius: 12px; background: rgba(245,158,11,0.15); display: flex; align-items: center; justify-content: center; color: #fbbf24;">
                ${Icons.sparkles({ size: 22, color: '#fbbf24' })}
              </div>
              <div>
                <div style="font-weight: 800; font-size: 1.05rem; color: #fff;">Initial Store Setup Required</div>
                <div style="font-size: 0.82rem; color: var(--text-secondary); margin-top: 2px;">
                  Add at least <strong>1 Stylist</strong> (${stylistCount}/1) and <strong>1 Service</strong> (${serviceCount}/1) to automatically activate your store for live online bookings.
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
    this.updateOfflineBanner();
    if (window.history && window.history.replaceState) {
      try {
        const newHash = this.activeTab === 'dashboard' ? '#admin' : `#admin/${this.activeTab}`;
        window.history.replaceState(null, '', newHash);
      } catch (_) {}
    }
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
      labelPrefix = formatted;
    }

    return this.homeManager.getHtml({
      salonProfile: profile,
      summaryData: summary,
      todayAppointments: summary.todayAppointments || this.queueSync?.items || [],
      recentAppointments: this.recentAppointments || [],
      staffList: this.staffList || [],
      servicesList: this.servicesList || [],
      categoriesList: this.categoriesList || [],
      todayClosure,
      selectedDate: this.selectedDate || todayISO,
      labelPrefix,
    });
  }

  renderCalendarPopoverContent() {
    const todayISO = this.getLocalDateString();
    const tmrwISO = this.addDaysToDateString(todayISO, 1);
    const dayAfterISO = this.addDaysToDateString(todayISO, 2);

    if (!this.calNavDate) {
      const [sy, sm] = (this.selectedDate || todayISO).split('-').map(Number);
      this.calNavDate = new Date(sy, sm - 1, 1);
    }
    const navYear = this.calNavDate.getFullYear();
    const navMonth = this.calNavDate.getMonth();

    const monthTitle = this.calNavDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    const firstDayIndex = new Date(navYear, navMonth, 1).getDay();
    const daysInMonth = new Date(navYear, navMonth + 1, 0).getDate();
    const weekdays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

    let cellsHtml = '';
    for (let i = 0; i < firstDayIndex; i++) {
      cellsHtml += `<div class="q-cal-day-cell empty"></div>`;
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const dateIso = `${navYear}-${String(navMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const isSelected = dateIso === this.selectedDate;
      const isToday = dateIso === todayISO;

      let cls = 'q-cal-day-cell';
      if (isSelected) cls += ' is-selected';
      if (isToday) cls += ' is-today';

      cellsHtml += `
        <div class="${cls}" data-date="${dateIso}">
          <span>${day}</span>
        </div>
      `;
    }

    return `
      <div class="q-cal-quick-row">
        <button class="q-cal-quick-btn ${this.selectedDate === todayISO ? 'active' : ''}" data-date="${todayISO}">Today</button>
        <button class="q-cal-quick-btn ${this.selectedDate === tmrwISO ? 'active' : ''}" data-date="${tmrwISO}">Tomorrow</button>
        <button class="q-cal-quick-btn ${this.selectedDate === dayAfterISO ? 'active' : ''}" data-date="${dayAfterISO}">+2 Days</button>
      </div>

      <div class="q-cal-header">
        <button class="q-cal-nav-btn" id="btn-qcal-prev" title="Previous Month">
          ${Icons.chevronLeft({ size: 14 })}
        </button>
        <span class="q-cal-month-title">${monthTitle}</span>
        <button class="q-cal-nav-btn" id="btn-qcal-next" title="Next Month">
          ${Icons.chevronRight({ size: 14 })}
        </button>
      </div>

      <div class="q-cal-weekdays">
        ${weekdays.map((w) => `<div>${w}</div>`).join('')}
      </div>

      <div class="q-cal-days-grid">
        ${cellsHtml}
      </div>
    `;
  }

  renderQueueDrawerContent(activeCount) {
    const filters = this.queueDrawerFilters || {};
    return `
      <div class="queue-drawer-header">
        <div class="queue-drawer-title-row">
          <span class="queue-drawer-icon">${Icons.sliders({ size: 16 })}</span>
          <div>
            <div class="queue-drawer-title">Filter Queue</div>
            <div class="queue-drawer-subtitle">${activeCount > 0 ? `${activeCount} filter(s) active` : 'Showing all appointments'}</div>
          </div>
        </div>
        <button class="queue-drawer-close" id="btn-close-queue-drawer" title="Close Drawer">
          ${Icons.x({ size: 15 })}
        </button>
      </div>

      <div class="queue-drawer-body">
        <!-- Specialists -->
        <div class="qd-section">
          <div class="qd-section-label">
            <span>Specialist</span>
            ${filters.stylistId ? `<span class="qd-section-badge">Active</span>` : ''}
          </div>
          <div class="qd-chips" data-filter-group="stylistId">
            <div class="qd-chip ${!filters.stylistId ? 'active' : ''}" data-val="">
              <span class="qd-chip-avatar all">✦</span>
              <span>All Specialists</span>
            </div>
            ${this.staffList.map((st) => {
              const initials = (st.name || 'S').trim().split(/\s+/).map((n) => n[0]).slice(0, 2).join('').toUpperCase();
              return `
                <div class="qd-chip ${filters.stylistId === st.id ? 'active' : ''}" data-val="${st.id}">
                  <span class="qd-chip-avatar">${initials}</span>
                  <span>${st.name}</span>
                </div>
              `;
            }).join('')}
          </div>
        </div>

        <!-- Booking Type -->
        <div class="qd-section">
          <div class="qd-section-label">
            <span>Booking Channel / Type</span>
            ${filters.bookingType ? `<span class="qd-section-badge">Active</span>` : ''}
          </div>
          <div class="qd-chips" data-filter-group="bookingType">
            <div class="qd-chip ${!filters.bookingType ? 'active' : ''}" data-val="">
              <span>All Types</span>
            </div>
            <div class="qd-chip ${filters.bookingType === 'QUICK' ? 'active' : ''}" data-val="QUICK">
              <span>⚡</span> <span>Quick Booking</span>
            </div>
            <div class="qd-chip ${filters.bookingType === 'NORMAL' ? 'active' : ''}" data-val="NORMAL">
              <span>📅</span> <span>Normal Booking</span>
            </div>
          </div>
        </div>

        <!-- Pipeline Status -->
        <div class="qd-section">
          <div class="qd-section-label">
            <span>Appointment Status</span>
            ${filters.status ? `<span class="qd-section-badge">Active</span>` : ''}
          </div>
          <div class="qd-chips" data-filter-group="status">
            <div class="qd-chip ${!filters.status ? 'active' : ''}" data-val="">
              <span class="qd-status-dot all"></span>
              <span>All Statuses</span>
            </div>
            <div class="qd-chip ${filters.status === 'PENDING_ACCEPTANCE' ? 'active' : ''}" data-val="PENDING_ACCEPTANCE">
              <span class="qd-status-dot pending"></span>
              <span>Pending Approval</span>
            </div>
            <div class="qd-chip ${filters.status === 'CONFIRMED' ? 'active' : ''}" data-val="CONFIRMED">
              <span class="qd-status-dot confirmed"></span>
              <span>Confirmed</span>
            </div>
            <div class="qd-chip ${filters.status === 'BOOKED' ? 'active' : ''}" data-val="BOOKED">
              <span class="qd-status-dot booked"></span>
              <span>Booked</span>
            </div>
            <div class="qd-chip ${filters.status === 'ON_THE_WAY' ? 'active' : ''}" data-val="ON_THE_WAY">
              <span class="qd-status-dot ontheway"></span>
              <span>On The Way</span>
            </div>
            <div class="qd-chip ${filters.status === 'CHECKED_IN' ? 'active' : ''}" data-val="CHECKED_IN">
              <span class="qd-status-dot checkedin"></span>
              <span>Checked In</span>
            </div>
            <div class="qd-chip ${filters.status === 'IN_SERVICE' ? 'active' : ''}" data-val="IN_SERVICE">
              <span class="qd-status-dot inchair"></span>
              <span>In Chair</span>
            </div>
            <div class="qd-chip ${filters.status === 'COMPLETED' ? 'active' : ''}" data-val="COMPLETED">
              <span class="qd-status-dot completed"></span>
              <span>Completed</span>
            </div>
            <div class="qd-chip ${filters.status === 'CANCELLED' ? 'active' : ''}" data-val="CANCELLED">
              <span class="qd-status-dot cancelled"></span>
              <span>Cancelled</span>
            </div>
          </div>
        </div>

        <!-- Service Category -->
        ${this.categoriesList && this.categoriesList.length > 0 ? `
          <div class="qd-section">
            <div class="qd-section-label">
              <span>Service Category</span>
              ${filters.categoryId ? `<span class="qd-section-badge">Active</span>` : ''}
            </div>
            <div class="qd-chips" data-filter-group="categoryId">
              <div class="qd-chip ${!filters.categoryId ? 'active' : ''}" data-val="">
                <span>All Categories</span>
              </div>
              ${this.categoriesList.map((cat) => `
                <div class="qd-chip ${filters.categoryId === cat.id ? 'active' : ''}" data-val="${cat.id}">
                  <span>🏷️</span>
                  <span>${cat.name}</span>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>

      <div class="queue-drawer-footer">
        <button class="qd-btn-reset" id="btn-reset-queue-filters">
          Reset All
        </button>
        <button class="qd-btn-apply" id="btn-apply-queue-filters">
          Apply Filters
        </button>
      </div>
    `;
  }

  wireCalendarPopoverEvents(calPopover, handleDateChange) {
    if (!calPopover) return;
    calPopover.querySelectorAll('[data-date]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const d = e.currentTarget.getAttribute('data-date');
        if (d) {
          calPopover.classList.remove('is-open');
          if (this._handlePopoverDocClick) {
            document.removeEventListener('click', this._handlePopoverDocClick);
            this._handlePopoverDocClick = null;
          }
          handleDateChange(d);
        }
      });
    });

    calPopover.querySelector('#btn-qcal-prev')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.calNavDate) {
        const [sy, sm] = (this.selectedDate || this.getLocalDateString()).split('-').map(Number);
        this.calNavDate = new Date(sy, sm - 1, 1);
      }
      this.calNavDate.setMonth(this.calNavDate.getMonth() - 1);
      calPopover.innerHTML = this.renderCalendarPopoverContent();
      this.wireCalendarPopoverEvents(calPopover, handleDateChange);
    });

    calPopover.querySelector('#btn-qcal-next')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.calNavDate) {
        const [sy, sm] = (this.selectedDate || this.getLocalDateString()).split('-').map(Number);
        this.calNavDate = new Date(sy, sm - 1, 1);
      }
      this.calNavDate.setMonth(this.calNavDate.getMonth() + 1);
      calPopover.innerHTML = this.renderCalendarPopoverContent();
      this.wireCalendarPopoverEvents(calPopover, handleDateChange);
    });
  }

  async handleQueueDateChange(newDate) {
    if (!newDate || newDate === this.selectedDate) return;
    this.selectedDate = newDate;
    this.queueSync.setDate(newDate);

    // Sync calNavDate to the newly selected date's month
    const [ny, nm] = newDate.split('-').map(Number);
    this.calNavDate = new Date(ny, nm - 1, 1);

    // Optimistic date label update for instant 0ms visual feedback
    const dateDisplay = document.getElementById('date-label-display');
    if (dateDisplay) {
      const [sy, sm, sd] = newDate.split('-').map(Number);
      const selDate = new Date(sy, sm - 1, sd);
      const [ty, tm, td] = this.getLocalDateString().split('-').map(Number);
      const todayDate = new Date(ty, tm - 1, td);
      const diffDays = Math.round((selDate - todayDate) / (1000 * 60 * 60 * 24));
      let datePrefix = '';
      if (diffDays === 0) datePrefix = 'Today, ';
      else if (diffDays === 1) datePrefix = 'Tomorrow, ';
      else if (diffDays === -1) datePrefix = 'Yesterday, ';
      else datePrefix = selDate.toLocaleDateString('en-US', { weekday: 'short' }) + ', ';
      dateDisplay.textContent = datePrefix + selDate.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
    }

    // Close any open popover and clean document listeners
    const calPopover = document.getElementById('q-calendar-popover');
    if (calPopover) {
      calPopover.classList.remove('is-open');
    }
    if (this._handlePopoverDocClick) {
      document.removeEventListener('click', this._handlePopoverDocClick);
      this._handlePopoverDocClick = null;
    }

    // Subtle card stream dimming instead of jarring page bounce
    const streamEl = document.querySelector('.q-stream');
    if (streamEl) {
      streamEl.style.opacity = '0.45';
      streamEl.style.pointerEvents = 'none';
      streamEl.style.transition = 'opacity 0.15s ease';
    }

    try {
      await this.loadData(false);
    } finally {
      this.refreshActiveTab();
    }
  }

  toggleCalendarPopover(event) {
    if (event) {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      if (typeof event.stopPropagation === 'function') event.stopPropagation();
      if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    }
    const popover = document.getElementById('q-calendar-popover');
    const btn = document.getElementById('btn-toggle-cal-popover') || (event ? event.currentTarget : null);
    if (!popover || !btn) return;

    const isOpen = popover.classList.contains('is-open');
    if (isOpen) {
      popover.classList.remove('is-open');
      if (this._handlePopoverDocClick) {
        document.removeEventListener('click', this._handlePopoverDocClick);
        this._handlePopoverDocClick = null;
      }
      return;
    }

    // Close any other open popovers
    document.querySelectorAll('.q-calendar-popover.is-open').forEach((p) => p.classList.remove('is-open'));

    // Synchronize navigation month to currently selected date
    const [sy, sm] = (this.selectedDate || this.getLocalDateString()).split('-').map(Number);
    this.calNavDate = new Date(sy, sm - 1, 1);

    // Re-render fresh calendar content for current selected date
    popover.innerHTML = this.renderCalendarPopoverContent();
    this.wireCalendarPopoverEvents(popover, (d) => this.handleQueueDateChange(d));

    // Dynamic viewport positioning: attach directly below button, clamped inside screen
    const rect = btn.getBoundingClientRect();
    popover.style.position = 'fixed';
    popover.style.top = `${Math.min(window.innerHeight - 380, rect.bottom + 8)}px`;
    popover.style.left = `${Math.max(10, Math.min(window.innerWidth - 325, rect.left))}px`;
    popover.style.zIndex = '999999';

    popover.classList.add('is-open');

    // Attach document outside-click handler
    if (this._handlePopoverDocClick) {
      document.removeEventListener('click', this._handlePopoverDocClick);
      this._handlePopoverDocClick = null;
    }
    this._handlePopoverDocClick = (e) => {
      const activePopover = document.getElementById('q-calendar-popover');
      const activeBtn = document.getElementById('btn-toggle-cal-popover');
      if (activePopover && activePopover.classList.contains('is-open')) {
        if (!activePopover.contains(e.target) && !activeBtn?.contains(e.target)) {
          activePopover.classList.remove('is-open');
          if (this._handlePopoverDocClick) {
            document.removeEventListener('click', this._handlePopoverDocClick);
            this._handlePopoverDocClick = null;
          }
        }
      }
    };
    setTimeout(() => {
      if (this._handlePopoverDocClick) {
        document.addEventListener('click', this._handlePopoverDocClick);
      }
    }, 10);
  }

  // =========================================================================
  // TAB 3: PURPOSE-DRIVEN OPERATOR CHAIR QUEUE (COMPACT & SORTED)
  // =========================================================================
  renderQueueTab() {
    try {
      const summary = this.summaryData || {};
      const todayISO = this.getLocalDateString();
      const targetDateIso = this.selectedDate || todayISO;

      const isApptOnSelectedDate = (appt) => {
        const raw = appt.startTime || appt.startAt || appt.proposedStartAt;
        if (!raw) return true;
        const d = new Date(raw);
        if (isNaN(d.getTime())) return true;
        const tz = summary.timezone || 'Asia/Kolkata';
        const apptDateIso = d.toLocaleDateString('en-CA', { timeZone: tz });
        return apptDateIso === targetDateIso;
      };

      const queueItems = (this.queueSync && Array.isArray(this.queueSync.items))
        ? this.queueSync.items
        : (Array.isArray(summary.todayAppointments) ? summary.todayAppointments : []);
      const todayAppointments = queueItems.filter(isApptOnSelectedDate);

      // Filter appointments based on operator selection & side drawer
      let filteredAppointments = todayAppointments;
      if (this.queueFilter === 'WAITING') {
        filteredAppointments = todayAppointments.filter((a) =>
          ['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'ON_THE_WAY', 'PENDING_ACCEPTANCE', 'PENDING_RESCHEDULE'].includes(a.status)
        );
      } else if (this.queueFilter === 'IN_CHAIR') {
        filteredAppointments = todayAppointments.filter((a) => a.status === 'IN_SERVICE' || a.status === 'SEATED_IN_CHAIR');
      } else if (this.queueFilter === 'COMPLETED') {
        filteredAppointments = todayAppointments.filter((a) => a.status === 'COMPLETED');
      } else if (this.queueFilter === 'CANCELLED') {
        filteredAppointments = todayAppointments.filter((a) => ['CANCELLED', 'REJECTED'].includes(a.status));
      }

      // Drawer Filter Refinements
      const qd = this.queueDrawerFilters || {};
      if (qd.stylistId) {
        filteredAppointments = filteredAppointments.filter((a) =>
          (a.stylistId === qd.stylistId || a.staffId === qd.stylistId)
        );
      }
      if (qd.bookingType) {
        filteredAppointments = filteredAppointments.filter((a) =>
          (a.bookingType === qd.bookingType)
        );
      }
      if (qd.status) {
        filteredAppointments = filteredAppointments.filter((a) =>
          (a.status === qd.status)
        );
      }
      if (qd.categoryId) {
        filteredAppointments = filteredAppointments.filter((a) => {
          const svcs = getApptServices(a);
          return svcs.some((s) => s.categoryId === qd.categoryId) || a.service?.categoryId === qd.categoryId;
        });
      }
      const activeFilterCount = Object.values(qd).filter(Boolean).length;

      // Summary counts strictly computed for selected date
      const waitingCount = todayAppointments.filter((a) =>
        ['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'ON_THE_WAY', 'PENDING_ACCEPTANCE', 'PENDING_RESCHEDULE'].includes(a.status)
      ).length;
      const inChairCount = todayAppointments.filter((a) => a.status === 'IN_SERVICE' || a.status === 'SEATED_IN_CHAIR').length;
      const completedCount = todayAppointments.filter((a) => a.status === 'COMPLETED').length;
      const cancelledCount = todayAppointments.filter((a) => ['CANCELLED', 'REJECTED', 'NO_SHOW'].includes(a.status)).length;

      const [sy, sm, sd] = targetDateIso.split('-').map(Number);
      const selDate = new Date(sy, sm - 1, sd);
      const [ty, tm, td] = todayISO.split('-').map(Number);
      const todayDate = new Date(ty, tm - 1, td);
      const diffDays = Math.round((selDate - todayDate) / (1000 * 60 * 60 * 24));

      let datePrefix = '';
      if (diffDays === 0) datePrefix = 'Today, ';
      else if (diffDays === 1) datePrefix = 'Tomorrow, ';
      else if (diffDays === -1) datePrefix = 'Yesterday, ';
      else {
        datePrefix = selDate.toLocaleDateString('en-US', { weekday: 'short' }) + ', ';
      }

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
        let label = 'Online';
        let cls = 'web';
        let iconHtml = Icons.globe ? Icons.globe({ size: 10, color: '#A855F7' }) : '🌐';

        if (source === 'WHATSAPP') {
          label = 'WhatsApp';
          cls = 'wa';
          iconHtml = Icons.whatsapp({ size: 10, color: '#25D366' });
        } else if (source === 'WALK_IN') {
          label = 'Walk-In';
          cls = 'walkin';
          iconHtml = Icons.zap({ size: 10, color: '#f59e0b' });
        }

        const tagHtml = `
          <span class="qc__origin-tag qc__origin-tag--${cls}" title="Booked via ${label}">
            ${iconHtml}
            <span>${label}</span>
          </span>
        `;
        return { label, cls, iconHtml, timeLabel, tagHtml };
      };

      // Format Scheduled Service Time Range Window (12-Hour AM/PM)
      const formatServiceTimeRange = (appt) => {
        const rawStart = appt.startTime || appt.startAt;
        const startDt = rawStart ? new Date(rawStart) : new Date();
        const startTimeStr = formatTime12h(startDt) || '--:--';

        const servicesList = getApptServices(appt);

        let totalDurationMins = 0;
        if (servicesList.length > 0) {
          totalDurationMins = servicesList.reduce((sum, s) => sum + (Number(s.durationMinutes) || 0), 0);
        }
        if (!totalDurationMins || totalDurationMins === 0) {
          totalDurationMins = appt.durationMinutes || 30;
        }

        let durationDisplayStr = `${totalDurationMins}m`;
        if (totalDurationMins >= 60) {
          const h = Math.floor(totalDurationMins / 60);
          const m = totalDurationMins % 60;
          durationDisplayStr = m > 0 ? `${h}h ${m}m` : `${h}h`;
        }

        const rawEnd = appt.endTime || appt.endAt;
        const endDt = (servicesList.length > 0 && totalDurationMins > 0)
          ? new Date(startDt.getTime() + totalDurationMins * 60000)
          : (rawEnd ? new Date(rawEnd) : new Date(startDt.getTime() + totalDurationMins * 60000));
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

      // Format Human Friendly Status Title
      const formatFriendlyStatus = (status) => {
        switch (status) {
          case 'PENDING_ACCEPTANCE': return 'Pending Approval';
          case 'BOOKED': return 'Booked';
          case 'CONFIRMED': return 'Confirmed';
          case 'ON_THE_WAY': return 'On The Way';
          case 'CHECKED_IN': return 'Checked In';
          case 'SEATED_IN_CHAIR':
          case 'IN_SERVICE': return 'In Chair';
          case 'PENDING_RESCHEDULE': return 'Reschedule Proposed';
          case 'COMPLETED': return 'Completed';
          case 'CANCELLED': return 'Cancelled';
          case 'REJECTED': return 'Declined';
          default: return (status || 'CONFIRMED').replace(/_/g, ' ');
        }
      };

      // Operational Evaluation for Queue Items (Overdue slot detection)
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
          const isOverdue = startMs > 0 && (Date.now() - startMs > 15 * 60 * 1000);
          return {
            tier: isOverdue ? 5 : 4,
            isUpcoming: !isOverdue,
            isOverdue,
          };
        }
        if (status === 'PENDING_RESCHEDULE') return { tier: 6, isUpcoming: true, isOverdue: false };
        if (status === 'COMPLETED') return { tier: 7, isUpcoming: false, isOverdue: false };
        if (status === 'CANCELLED' || status === 'NO_SHOW' || status === 'REJECTED') {
          return { tier: 8, isUpcoming: false, isOverdue: false };
        }
        return { tier: 9, isUpcoming: false, isOverdue: false };
      };

      // Format remaining time countdown in decreasing order: e.g. "1 min 24 sec", "25 min 10 sec", "1 hr 15 min 20 sec"
      const formatTimeReductionCountdown = (diffMs) => {
        if (diffMs <= 0) {
          return `0 min 0 sec`;
        }

        const totalSecs = Math.floor(diffMs / 1000);
        const hours = Math.floor(totalSecs / 3600);
        const mins = Math.floor((totalSecs % 3600) / 60);
        const secs = totalSecs % 60;

        if (hours > 0) {
          return `${hours} hr ${mins} min ${secs} sec`;
        }
        if (mins > 0) {
          return `${mins} min ${secs} sec`;
        }
        return `${secs} sec`;
      };

      // Resolve Next Action & Reverse Countdown directly from booking table schema (nextActionType, nextActionAt)
      const getApptActionAndClock = (appt) => {
        const status = appt.status || 'BOOKED';
        const now = Date.now();
        const rawStart = appt.startTime || appt.startAt;
        const startDt = rawStart ? new Date(rawStart) : new Date();
        const servicesList = getApptServices(appt);
        let totalDur = servicesList.reduce((sum, s) => sum + (Number(s.durationMinutes) || 0), 0);
        if (!totalDur || totalDur === 0) totalDur = appt.durationMinutes || 30;
        const endDt = new Date(startDt.getTime() + totalDur * 60000);
        const endMs = endDt.getTime();
        const startMs = startDt.getTime();

        // 1. Fetch exact fields from booking table
        let nextActionType = appt.nextActionType || null;
        let nextActionAt = appt.nextActionAt ? new Date(appt.nextActionAt) : null;

        // 2. Fallback if not yet saved in DB row (mirrors AppointmentNextActionService)
        if (!nextActionType || !nextActionAt || isNaN(nextActionAt.getTime())) {
          if (status === 'COMPLETED' || status === 'CANCELLED' || status === 'REJECTED') {
            nextActionType = 'NONE';
            nextActionAt = null;
          } else if (status === 'SEATED_IN_CHAIR' || status === 'IN_SERVICE' || status === 'CHECKED_IN' || status === 'ON_THE_WAY') {
            nextActionType = 'AUTO_COMPLETE';
            nextActionAt = endDt;
          } else if (status === 'CONFIRMED') {
            const arrivalLeadMs = 15 * 60 * 1000;
            if (appt.reminder10mSentAt) {
              nextActionType = 'CUTOFF_10M';
              nextActionAt = new Date(new Date(appt.reminder10mSentAt).getTime() + 10 * 60 * 1000);
            } else if (now >= startMs - arrivalLeadMs) {
              nextActionType = 'AUTO_COMPLETE';
              nextActionAt = endDt;
            } else {
              nextActionType = 'ARRIVAL_15M';
              nextActionAt = new Date(startMs - arrivalLeadMs);
            }
          } else if (status === 'BOOKED') {
            const reminder2hLeadMs = 120 * 60 * 1000;
            const cutoff60mLeadMs = 60 * 60 * 1000;
            if (!appt.reminder2hSentAt && now < startMs - reminder2hLeadMs) {
              nextActionType = 'REMINDER_2H';
              nextActionAt = new Date(startMs - reminder2hLeadMs);
            } else {
              nextActionType = 'CUTOFF_60M';
              nextActionAt = new Date(startMs - cutoff60mLeadMs);
            }
          } else if (status === 'PENDING_ACCEPTANCE') {
            nextActionType = 'CUTOFF_5M';
            nextActionAt = new Date(Math.min(now + 5 * 60 * 1000, startMs));
          } else if (status === 'PENDING_RESCHEDULE') {
            nextActionType = 'PROPOSAL_EXPIRY';
            nextActionAt = appt.expiresAt ? new Date(appt.expiresAt) : new Date(now + 60 * 60 * 1000);
          }
        }

        // 3. Human-friendly labels for each action type from booking policy
        let badgeLabel = 'NEXT ACTION';
        let titleLabel = 'Automated Action';
        let badgeClass = 'default';

        switch (nextActionType) {
          case 'REMINDER_2H':
            badgeLabel = '2H REMINDER';
            titleLabel = 'WhatsApp 2h Confirmation';
            badgeClass = 'reminder';
            break;
          case 'CUTOFF_5M':
            badgeLabel = '5M APPROVAL';
            titleLabel = 'Auto-Purge Cutoff';
            badgeClass = 'cutoff';
            break;
          case 'CUTOFF_60M':
            badgeLabel = status === 'PENDING_ACCEPTANCE' ? '5M APPROVAL' : '60M CUTOFF';
            titleLabel = status === 'PENDING_ACCEPTANCE' ? 'Auto-Purge Cutoff' : 'Unconfirmed Auto-Cancel';
            badgeClass = 'cutoff';
            break;
          case 'ARRIVAL_15M':
            badgeLabel = '15M ALERT';
            titleLabel = 'WhatsApp 15m Arrival Prompt';
            badgeClass = 'arrival';
            break;
          case 'CUTOFF_10M':
            badgeLabel = '10M CUTOFF';
            titleLabel = 'No-Response Auto-Cancel';
            badgeClass = 'cutoff';
            break;
          case 'AUTO_COMPLETE':
            badgeLabel = 'AUTO COMPLETE';
            titleLabel = 'Finish Visit & Free Chair';
            badgeClass = 'autocomplete';
            break;
          case 'PROPOSAL_EXPIRY':
            badgeLabel = 'EXPIRY';
            titleLabel = 'Reschedule Proposal Cutoff';
            badgeClass = 'cutoff';
            break;
          case 'NONE':
          default:
            badgeLabel = 'FINISHED';
            titleLabel = 'Visit Concluded';
            badgeClass = 'none';
            break;
        }

        const targetMs = nextActionAt ? nextActionAt.getTime() : 0;
        const timeStr = nextActionAt ? formatTime12h(nextActionAt) : '';

        let clockHtml = '';
        if (targetMs > 0) {
          const diffMs = targetMs - now;
          if (diffMs > 0) {
            const initialText = formatTimeReductionCountdown(diffMs);
            clockHtml = `
              <span class="qc__normal-time">
                <span class="qc__clock-timer" data-countdown-target="${targetMs}" data-time-str="${timeStr}">⏳ ${initialText}</span>
              </span>
            `;
          } else {
            clockHtml = timeStr ? `<span class="qc__normal-time">⏰ ${timeStr}</span>` : '';
          }
        } else {
          clockHtml = timeStr ? `<span class="qc__normal-time">⏰ ${timeStr}</span>` : '';
        }

        return {
          nextActionType,
          badgeLabel,
          badgeClass,
          titleLabel,
          timeStr,
          clockHtml,
          targetMs,
        };
      };

      // Visual Booking Lifecycle Pipeline (Compact Segmented Progress Bar inspired by Working Hours)
      const renderBookingLifecycle = (appt) => {
        const status = appt.status || 'BOOKED';

        // Terminal Cancelled State
        if (status === 'CANCELLED') {
          const cancelInfo = formatCancellationDetails(appt);
          return `
            <div class="qc__lifecycle-alert qc__lifecycle-alert--cancel">
              <div class="qc__alert-top">
                ${Icons.xCircle({ size: 12, color: '#fb7185' })}
                <span class="qc__alert-title">Cancelled · Chair Released</span>
                ${cancelInfo.timeStr ? `<span class="qc__alert-tag">${cancelInfo.timeStr}</span>` : ''}
              </div>
              <div class="qc__alert-sub"><strong>Reason:</strong> ${cancelInfo.reason}</div>
            </div>
          `;
        }

        // Terminal Declined State
        if (status === 'REJECTED') {
          const cancelInfo = formatCancellationDetails(appt);
          return `
            <div class="qc__lifecycle-alert qc__lifecycle-alert--cancel">
              <div class="qc__alert-top">
                ${Icons.xCircle({ size: 12, color: '#fb7185' })}
                <span class="qc__alert-title">Declined · Chair Released</span>
                <span class="qc__alert-tag">FREED</span>
              </div>
              <div class="qc__alert-sub"><strong>Reason:</strong> ${cancelInfo.reason || 'Salon at peak capacity'}</div>
            </div>
          `;
        }

        // Pending Reschedule Proposal
        if (status === 'PENDING_RESCHEDULE') {
          const propStart = appt.proposedStartAt ? new Date(appt.proposedStartAt) : null;
          const propEnd = appt.proposedEndAt ? new Date(appt.proposedEndAt) : null;
          const propSlot = propStart ? `${formatTime12h(propStart)} – ${formatTime12h(propEnd || propStart)}` : 'Proposed Slot';
          return `
            <div class="qc__lifecycle-alert qc__lifecycle-alert--warn">
              <div class="qc__alert-top">
                ${Icons.clock({ size: 12, color: '#fbbf24' })}
                <span class="qc__alert-title">Reschedule Proposal Pending</span>
                <span class="qc__alert-tag">${propSlot}</span>
              </div>
              <div class="qc__alert-sub">Waiting client confirmation on WhatsApp</div>
            </div>
          `;
        }

        // Standard 6-Step Pipeline
        const steps = [
          { key: 'BOOKED', label: status === 'PENDING_ACCEPTANCE' ? 'Requested' : 'Booked', num: 1 },
          { key: 'CONFIRMED', label: 'Confirmed', num: 2 },
          { key: 'ON_THE_WAY', label: 'On Way', num: 3 },
          { key: 'CHECKED_IN', label: 'Checked In', num: 4 },
          { key: 'SEATED_IN_CHAIR', label: 'In Chair', num: 5 },
          { key: 'COMPLETED', label: 'Done', num: 6 },
        ];

        let currentIdx = 0;
        let activeColor = '#3b82f6';
        let stageLabel = 'Requested';

        if (status === 'PENDING_ACCEPTANCE') {
          currentIdx = 0;
          activeColor = '#f59e0b';
          stageLabel = 'Pending Approval';
        } else if (status === 'BOOKED') {
          currentIdx = 0;
          activeColor = '#3b82f6';
          stageLabel = 'Booked';
        } else if (status === 'CONFIRMED') {
          currentIdx = 1;
          activeColor = '#0ea5e9';
          stageLabel = 'Confirmed';
        } else if (status === 'ON_THE_WAY') {
          currentIdx = 2;
          activeColor = '#10b981';
          stageLabel = 'Client On Way';
        } else if (status === 'CHECKED_IN') {
          currentIdx = 3;
          activeColor = '#f59e0b';
          stageLabel = 'Checked In';
        } else if (status === 'SEATED_IN_CHAIR' || status === 'IN_SERVICE') {
          currentIdx = 4;
          activeColor = '#a855f7';
          stageLabel = 'In Chair';
        } else if (status === 'COMPLETED') {
          currentIdx = 5;
          activeColor = '#10b981';
          stageLabel = 'Completed';
        }

        const actionInfo = getApptActionAndClock(appt);

        return `
          <div class="qc__pipeline">
            <!-- Next Action & Remaining Time Strip -->
            <div class="qc__action-countdown-bar">
              <div class="qc__next-action">
                <span class="qc__next-action-label">Next Action:</span>
                <span class="qc__action-tag qc__action-tag--${actionInfo.badgeClass}">${actionInfo.badgeLabel}</span>
              </div>
              <div class="qc__reverse-clock">
                ${actionInfo.clockHtml}
              </div>
            </div>

            <div class="qc__pipeline-top">
              <div class="qc__pipeline-current">
                <span class="qc__pipeline-dot" style="background: ${activeColor}; box-shadow: 0 0 6px ${activeColor};"></span>
                <span class="qc__pipeline-step-badge">Stage ${currentIdx + 1}/6</span>
                <span class="qc__pipeline-label" style="color: ${activeColor};">${stageLabel}</span>
              </div>
              <div class="qc__pipeline-next">
                ${currentIdx < 5 ? `<span class="qc__pipeline-next-text">Next: <strong>${steps[currentIdx + 1].label}</strong></span>` : `<span class="qc__pipeline-next-text" style="color: #34d399;">✓ Complete</span>`}
              </div>
            </div>
            <div class="qc__pipeline-track" title="Step ${currentIdx + 1} of 6: ${stageLabel}">
              ${steps.map((st, i) => {
                const isDone = i < currentIdx;
                const isCurrent = i === currentIdx;
                const cls = isDone ? 'is-done' : (isCurrent ? 'is-current' : 'is-upcoming');
                const bg = isDone ? '#10b981' : (isCurrent ? activeColor : 'rgba(255, 255, 255, 0.08)');
                const shadow = isCurrent ? `box-shadow: 0 0 6px ${activeColor};` : '';
                return `<div class="qc__pipeline-seg ${cls}" style="background: ${bg}; ${shadow}" title="${st.num}. ${st.label} ${isCurrent ? '(Current)' : (isDone ? '(Done)' : '')}"></div>`;
              }).join('')}
            </div>
          </div>
        `;
      };

      return `
        <!-- Date & Actions Bar (Minimal & Functional Day-Off Navigation Style) -->
        <div class="q-date-bar">
          <!-- Left: Date Selector Badge with Popover Trigger -->
          <div class="q-calendar-wrapper">
            <button type="button" class="q-date-display-btn" id="btn-toggle-cal-popover" onclick="window.salonDashboard?.toggleCalendarPopover(event)" title="Tap to choose date or jump days">
              <span class="q-date-icon">${Icons.calendar({ size: 16, color: '#a5b4fc' })}</span>
              <span class="q-date-text" id="date-label-display">${formattedDateLabel}</span>
              <span class="q-date-chevron">${Icons.chevronDown({ size: 13, color: '#94a3b8' })}</span>
            </button>
            <div class="q-calendar-popover" id="q-calendar-popover">
              ${this.renderCalendarPopoverContent()}
            </div>
          </div>

          <!-- Right: Actions Group (Today, Prev, Next, Filters) -->
          <div class="q-actions-group">
            ${diffDays !== 0 ? `<button type="button" class="q-today-pill" id="btn-date-today" onclick="window.salonDashboard?.handleQueueDateChange(window.salonDashboard?.getLocalDateString())" title="Jump to Today">Today</button>` : ''}
            <button type="button" class="q-nav-arrow" id="btn-date-prev" onclick="window.salonDashboard?.handleQueueDateChange(window.salonDashboard?.addDaysToDateString(window.salonDashboard?.selectedDate, -1))" title="Previous Day" aria-label="Previous Day">
              ${Icons.chevronLeft({ size: 15 })}
            </button>
            <button type="button" class="q-nav-arrow" id="btn-date-next" onclick="window.salonDashboard?.handleQueueDateChange(window.salonDashboard?.addDaysToDateString(window.salonDashboard?.selectedDate, 1))" title="Next Day" aria-label="Next Day">
              ${Icons.chevronRight({ size: 15 })}
            </button>
            <button type="button" class="q-filter-btn ${activeFilterCount > 0 ? 'is-active' : ''}" id="btn-open-queue-drawer" title="Filter Queue">
              ${Icons.sliders({ size: 14 })}
              <span>Filters</span>
              ${activeFilterCount > 0 ? `<span class="q-filter-badge" id="queue-filter-badge">${activeFilterCount}</span>` : ''}
            </button>
          </div>
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
        const customer = appt.customer || appt.user || (appt.salonUser ? appt.salonUser.user : {}) || {};
        const staff = appt.staff || appt.stylist || {};
        const service = appt.service || {};
        const customerName = customer.name || 'Walk-In Client';
        const staffName = staff.name || 'Any Stylist';
        const staffId = staff.id || appt.stylistId || appt.staffId || '';
        const serviceId = service.id || appt.serviceId || '';
        const apptSvcs = getApptServices(appt);
        const serviceName = apptSvcs.map((s) => s.name).join(' + ') || appt.serviceNameSnapshot || service.name || 'Service';
        let computedPrice = 0;
        if (apptSvcs.length > 0) {
          computedPrice = apptSvcs.reduce((sum, s) => sum + (Number(s.price) || 0), 0);
        }
        if (!computedPrice || computedPrice === 0) {
          computedPrice = Number(appt.price ?? service.price ?? 0);
        }
        const originInfo = formatBookingOrigin(appt);

        const timeRange = formatServiceTimeRange(appt);
        const cleanPhone = (customer.phone || '').replace(/[^0-9+]/g, '');
        const rawPhoneForWa = cleanPhone.replace('+', '');
        const initials = getInitials(customerName);
        const avatarCls = getAvatarColor(customerName);
        const isDone = appt.status === 'COMPLETED';
        const isCancelled = ['CANCELLED', 'REJECTED'].includes(appt.status);
        const statusKey = (appt.status || 'CONFIRMED').toLowerCase();
        const friendlyStatus = formatFriendlyStatus(appt.status);
        const queueItemEval = evaluateQueueItem(appt);
        const isOverdue = queueItemEval.isOverdue;

        const rawStart = appt.startTime || appt.startAt;
        const startDt = rawStart ? new Date(rawStart) : new Date();
        const elapsedMins = Math.max(0, Math.floor((Date.now() - startDt.getTime()) / 60000));
        const remainingMins = Math.max(0, (service.durationMinutes || appt.durationMinutes || 30) - elapsedMins);

        return `
          <div class="qc ${isDone ? 'qc--done' : ''} ${isCancelled ? 'qc--cancelled' : ''}">
            <div class="qc__accent qc__accent--${statusKey}"></div>

            <div class="qc__content">
              <!-- Row 1: Header (Time & Duration on Left, Prominent Status Badge on Right - Proper Status) -->
              <div class="qc__header">
                <div class="qc__header-left">
                  <span class="qc__clock-icon">⏰</span>
                  <span class="qc__time">${timeRange.timeRangeStr}</span>
                  <span class="qc__duration">${timeRange.durationDisplayStr}</span>
                </div>
                <div class="qc__header-right">
                  <div class="qc__status-badge qc__status-badge--${statusKey}">
                    <span class="qc__status-dot">●</span>
                    <span class="qc__status-text">${friendlyStatus.toUpperCase()}</span>
                  </div>
                </div>
              </div>

              <!-- Row 2: Party Row (Client on Left, Price & Specialist on Right - Clean Balanced Space) -->
              <div class="qc__party-row">
                <div class="qc__party-client">
                  <div class="qc__client-name-line">
                    <span class="qc__client-name" title="${customerName}">${customerName}</span>
                    ${cleanPhone ? `
                      <div class="qc__contacts">
                        <a href="tel:${cleanPhone}" class="qc__contact-btn qc__contact-btn--call" title="Call ${customerName}">
                          ${Icons.phone({ size: 10 })}
                        </a>
                        <a href="https://wa.me/${rawPhoneForWa}" target="_blank" class="qc__contact-btn qc__contact-btn--wa" title="WhatsApp Chat">
                          ${Icons.whatsapp({ size: 10 })}
                        </a>
                      </div>
                    ` : ''}
                  </div>
                  <div class="qc__client-sub">
                    ${cleanPhone ? `<span class="qc__phone">${formatPhone(cleanPhone)}</span>` : '<span class="qc__no-phone">No Phone</span>'}
                    ${originInfo.timeLabel ? `<span class="qc__dot-sep">•</span><span class="qc__time-ago">${originInfo.timeLabel}</span>` : ''}
                  </div>
                </div>
                <div class="qc__party-right">
                  <span class="qc__price">₹${computedPrice}</span>
                  <div class="qc__party-stylist">
                    <span class="qc__stylist-label">SPECIALIST</span>
                    <span class="qc__stylist-name" title="${staffName}">${staffName}</span>
                  </div>
                </div>
              </div>

              <!-- Row 3: Services Roster (Natural wrapping, zero truncation) -->
              <div class="qc__services-box">
                <div class="qc__services-top">
                  <span class="qc__services-label">SERVICES (${apptSvcs.length || 1})</span>
                  ${(!isDone && !isCancelled && appt.status !== 'PENDING_ACCEPTANCE' && appt.status !== 'PENDING_RESCHEDULE') ? `
                    <button type="button" class="qc__add-svc-btn btn-open-add-addon" data-id="${appt.id}" data-name="${customerName}" title="Add extra service or add-on">
                      + Add Service
                    </button>
                  ` : ''}
                </div>
                <div class="qc__services-items">
                  ${(() => {
                    if (apptSvcs.length === 0) {
                      return `
                        <div class="qc__svc-row">
                          <span class="qc__svc-bullet">✂</span>
                          <span class="qc__svc-name">${serviceName}</span>
                          <div class="qc__svc-meta">
                            <span class="qc__svc-dur">${timeRange.durationDisplayStr}</span>
                            <span class="qc__svc-amt">₹${computedPrice}</span>
                          </div>
                        </div>
                      `;
                    }
                    return apptSvcs.map((s) => `
                      <div class="qc__svc-row ${s.isAddon ? 'qc__svc-row--addon' : ''}">
                        <span class="qc__svc-bullet ${s.isAddon ? 'qc__svc-bullet--plus' : ''}">${s.isAddon ? '+' : '✂'}</span>
                        <span class="qc__svc-name">${s.name}</span>
                        <div class="qc__svc-meta">
                          <span class="qc__svc-dur">${s.durationMinutes ? `${s.durationMinutes}m` : ''}</span>
                          <span class="qc__svc-amt ${s.isAddon ? 'qc__svc-amt--addon' : ''}">${s.isAddon ? (s.price !== null && s.price !== undefined ? `+₹${s.price}` : 'Incl.') : `₹${s.price ?? computedPrice}`}</span>
                        </div>
                      </div>
                    `).join('');
                  })()}
                </div>
              </div>

              <!-- Row 3.5: Contextual Note (Overdue / Late) -->
              ${(() => {
                if (isOverdue && !isDone && !isCancelled) {
                  return `<div class="qc__note qc__note--warn">⚠️ Slot Passed · Client not checked in</div>`;
                }
                if (appt.clientEtaStatus === 'ON_THE_WAY' && appt.status !== 'ON_THE_WAY') {
                  return `<div class="qc__note qc__note--green">🚗 Client On The Way</div>`;
                }
                if (appt.clientEtaStatus === 'RUNNING_LATE_10M' || appt.clientEtaStatus === 'RUNNING_LATE_20M') {
                  return `<div class="qc__note qc__note--warn">⏰ Client Running Late (${appt.clientEtaStatus === 'RUNNING_LATE_20M' ? '20m' : '10m'})</div>`;
                }
                return '';
              })()}

              <!-- Row 4: Lifecycle Progress Bar (Requested by user) -->
              ${renderBookingLifecycle(appt)}

              <!-- Row 5: Action Bar (Ergonomic 32px Buttons) -->
              <div class="qc__actions">
                ${appt.status === 'PENDING_ACCEPTANCE' ? `
                  <div class="qc__actions-group qc__actions-group--split">
                    <button class="qc__btn qc__btn--accept btn-status" data-id="${appt.id}" data-status="CHECKED_IN">
                      ${Icons.check({ size: 14, color: '#fff', strokeWidth: 2.5 })}
                      <span>Accept & Check In</span>
                    </button>
                    <button class="qc__btn qc__btn--decline btn-status" data-id="${appt.id}" data-status="REJECTED">
                      ${Icons.x({ size: 14, color: '#fb7185' })}
                      <span>Decline</span>
                    </button>
                  </div>
                ` : ''}

                ${appt.status === 'CONFIRMED' || appt.status === 'BOOKED' || appt.status === 'ON_THE_WAY' ? `
                  <div class="qc__actions-group">
                    <button class="qc__btn qc__btn--primary btn-status" data-id="${appt.id}" data-status="CHECKED_IN">
                      ${Icons.userCheck ? Icons.userCheck({ size: 14, color: '#fff' }) : Icons.check({ size: 14, color: '#fff' })}
                      <span>Check In Client</span>
                    </button>
                    <button class="qc__icon-btn btn-open-reschedule" data-id="${appt.id}" data-service="${serviceId}" data-staff="${staffId}" data-name="${customerName}" title="Reschedule">
                      ${Icons.calendar({ size: 13 })}
                    </button>
                    <button class="qc__icon-btn qc__icon-btn--danger btn-open-cancel" data-id="${appt.id}" data-name="${customerName}" title="Cancel">
                      ${Icons.x({ size: 13 })}
                    </button>
                  </div>
                ` : ''}

                ${appt.status === 'CHECKED_IN' ? `
                  <div class="qc__actions-group">
                    <button class="qc__btn qc__btn--seat btn-status" data-id="${appt.id}" data-status="SEATED_IN_CHAIR">
                      ${Icons.armchair({ size: 14, color: '#fff' })}
                      <span>Seat in Chair</span>
                    </button>
                    <button class="qc__icon-btn btn-open-reschedule" data-id="${appt.id}" data-service="${serviceId}" data-staff="${staffId}" data-name="${customerName}" title="Reschedule">
                      ${Icons.calendar({ size: 13 })}
                    </button>
                    <button class="qc__icon-btn qc__icon-btn--danger btn-open-cancel" data-id="${appt.id}" data-name="${customerName}" title="Cancel">
                      ${Icons.x({ size: 13 })}
                    </button>
                  </div>
                ` : ''}

                ${appt.status === 'IN_SERVICE' || appt.status === 'SEATED_IN_CHAIR' ? `
                  <div class="qc__actions-group">
                    <button class="qc__btn qc__btn--finish btn-status" data-id="${appt.id}" data-status="COMPLETED">
                      ${Icons.checkCircle2({ size: 14, color: '#fff' })}
                      <span>Complete Visit & Free Chair</span>
                    </button>
                  </div>
                ` : ''}

                ${appt.status === 'PENDING_RESCHEDULE' ? `
                  <div class="qc__actions-group">
                    <button class="qc__btn qc__btn--disabled" disabled>
                      ${Icons.clock({ size: 13, color: '#fbbf24' })}
                      <span>Waiting Customer Approval</span>
                    </button>
                    <button class="qc__icon-btn qc__icon-btn--danger btn-open-cancel" data-id="${appt.id}" data-name="${customerName}" title="Cancel Booking">
                      ${Icons.x({ size: 13 })}
                    </button>
                  </div>
                ` : ''}

                ${isDone ? `
                  <div class="qc__terminal-pill qc__terminal-pill--done">
                    ${Icons.checkCircle2({ size: 13, color: '#34d399' })}
                    <span>Visit Completed · Chair Ready</span>
                  </div>
                ` : ''}

                ${isCancelled ? `
                  <div class="qc__terminal-pill qc__terminal-pill--cancel">
                    ${Icons.xCircle({ size: 13, color: '#fb7185' })}
                    <span>Booking Closed · Chair Released</span>
                  </div>
                ` : ''}
              </div>
            </div>
          </div>
        `;
      }).join('')}

        </div>

        <!-- Right Side Filter Drawer Panel & Backdrop -->
        <div class="queue-drawer-backdrop" id="queue-drawer-backdrop"></div>
        <aside class="queue-drawer" id="queue-drawer" aria-label="Queue Filter Drawer">
          ${this.renderQueueDrawerContent(activeFilterCount)}
        </aside>

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
                  <div class="stylist-card-header">
                    <div class="stylist-card-brand">
                      <div class="stylist-card-avatar-wrap">
                        ${avatarHtml}
                        <span class="stylist-status-dot ${st.statusDotClass}"></span>
                      </div>
                      <div class="stylist-card-headings">
                        <h4 class="stylist-card-name" title="${st.name}">${st.name}</h4>
                        <span class="stylist-card-role">${st.role || 'Hair & Beard Specialist'}</span>
                      </div>
                    </div>
                    <div class="stylist-card-status-wrap">
                      <span class="stylist-badge ${st.statusBadgeClass}" title="${st.statusReason || ''}">
                        <span class="status-pip ${st.statusDotClass}"></span>
                        <span>${st.statusLabel}</span>
                      </span>
                    </div>
                  </div>

                  <div class="stylist-card-footer">
                    <div class="stylist-card-meta-group">
                      <span class="stylist-meta-pill service-count-pill" title="${(st.services || []).length} assigned services">
                        <svg class="meta-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <circle cx="6" cy="6" r="3"></circle>
                          <circle cx="6" cy="18" r="3"></circle>
                          <line x1="20" y1="4" x2="8.12" y2="15.88"></line>
                          <line x1="14.47" y1="14.48" x2="20" y2="20"></line>
                          <line x1="8.12" y1="8.12" x2="12" y2="12"></line>
                        </svg>
                        <span><strong>${(st.services || []).length}</strong> Services</span>
                      </span>
                      ${st.phone ? `
                        <span class="stylist-meta-pill phone-pill" title="Phone: ${st.phone}">
                          <svg class="meta-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                          </svg>
                          <span>${st.phone}</span>
                        </span>
                      ` : ''}
                    </div>
                    <div class="stylist-card-action">
                      <button type="button" class="btn-delete-stylist stylist-action-del-btn" 
                        data-staff-id="${st.id}" 
                        data-staff-name="${(st.name || '').replace(/"/g, '&quot;')}" 
                        title="Delete Stylist ${(st.name || '').replace(/"/g, '&quot;')}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <polyline points="3 6 5 6 21 6"></polyline>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        </svg>
                      </button>
                      <span class="stylist-manage-btn">
                        <span>Manage</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                          <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                      </span>
                    </div>
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

    this.showScheduleSavingIndicator('Saving...');

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
        this.hideScheduleSavingIndicator(true, 'Staff schedule saved');

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
        this.hideScheduleSavingIndicator(false, err.message || 'Save error');
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

  autoSaveSalonSchedule(immediate = false, deltaPayload = null) {
    if (!this.currentSalonHoursState) return;

    this.showScheduleSavingIndicator('Saving...');

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
      let hoursPayload = deltaPayload;

      if (!hoursPayload || !hoursPayload.length) {
        const daysArr = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
        hoursPayload = [];

        for (const day of daysArr) {
          const d = this.currentSalonHoursState?.days ? this.currentSalonHoursState.days[day] : null;
          const isOpen = d ? Boolean(d.isOpen) : true;
          let start = d?.startTime || '09:00';
          let end = d?.endTime || '21:00';

          hoursPayload.push({
            dayOfWeek: day,
            isClosed: !isOpen,
            startTime: start,
            endTime: end,
          });
        }
      }

      try {
        const updated = await ApiClient.updateSalonWorkingHours(hoursPayload);
        const hoursList = Array.isArray(updated)
          ? updated
          : (Array.isArray(updated?.hours) ? updated.hours : null);

        if (hoursList) {
          this.salonWorkingHours = hoursList;
          this.salonBreaks = hoursList.flatMap((h) =>
            (h.breaks || []).map((b) => ({ ...b, dayOfWeek: h.dayOfWeek })),
          );
        }

        if (statusBadge) {
          statusBadge.innerHTML = `<span class="autosave-dot"></span><span class="autosave-text">Auto-saved</span>`;
        }
        this.hideScheduleSavingIndicator(true, 'Salon schedule saved');

        if (updated?.affectedBookingsCount > 0) {
          this.showToast?.(updated.message || `${updated.affectedBookingsCount} booking(s) automatically sent reschedule request via WhatsApp.`, 'info');
        }
      } catch (err) {
        console.error('Failed to auto-save salon schedule:', err);
        if (statusBadge) {
          statusBadge.innerHTML = `<span class="autosave-dot error"></span><span class="autosave-text" title="${err.message || 'Error'}">⚠️ Save error</span>`;
        }
        this.hideScheduleSavingIndicator(false, err.message || 'Save error');
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
      const changedDays = [];
      daysArr.forEach((dKey) => {
        if (this.currentSalonHoursState?.days[dKey] && this.currentSalonHoursState.days[dKey].isOpen) {
          this.currentSalonHoursState.days[dKey].startTime = sVal;
          this.currentSalonHoursState.days[dKey].endTime = eVal;
          changedDays.push({
            dayOfWeek: dKey,
            isClosed: false,
            startTime: sVal,
            endTime: eVal,
          });
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
      this.autoSaveSalonSchedule(immediate, changedDays);
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

    // 1. Instant Open/Closed Toggle Switch (Sends single-day delta)
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

        // ⚡ Delta save: send ONLY this single day's isClosed status!
        this.autoSaveSalonSchedule(true, [{
          dayOfWeek: day,
          isClosed: !isOpen,
        }]);
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
      const allDaysPayload = [];
      daysArr.forEach((dKey) => {
        if (this.currentSalonHoursState.days[dKey]) {
          this.currentSalonHoursState.days[dKey].isOpen = isOpen;
          this.currentSalonHoursState.days[dKey].startTime = sVal;
          this.currentSalonHoursState.days[dKey].endTime = eVal;
          allDaysPayload.push({
            dayOfWeek: dKey,
            isClosed: !isOpen,
            startTime: sVal,
            endTime: eVal,
          });
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
      this.autoSaveSalonSchedule(true, allDaysPayload);
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
      // ⚡ Send ONLY this single day's updated values!
      this.autoSaveSalonSchedule(true, [{
        dayOfWeek: dayKey,
        isClosed: !isOpen,
        startTime: sVal,
        endTime: eVal,
      }]);
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
      const categories = ['ALL', ...new Set(services.map((s) => s.category).filter(Boolean))];

      const getCatIcon = (cat, name) => {
        const text = `${cat || ''} ${name || ''}`.toLowerCase();
        if (text.includes('hair') || text.includes('cut') || text.includes('trim')) return '✂️';
        if (text.includes('beard') || text.includes('shave') || text.includes('mustache')) return '🪒';
        if (text.includes('facial') || text.includes('skin') || text.includes('glow') || text.includes('clean')) return '✨';
        if (text.includes('massage') || text.includes('spa') || text.includes('therapy')) return '💆';
        if (text.includes('nail') || text.includes('mani') || text.includes('pedi')) return '💅';
        if (text.includes('color') || text.includes('dye') || text.includes('bleach') || text.includes('highlight')) return '🎨';
        if (text.includes('wash') || text.includes('shampoo')) return '🧴';
        if (text.includes('wax') || text.includes('thread')) return '🪄';
        return '✂️';
      };


      const activeFilters = this.serviceFilters || { category: 'ALL', gender: 'ALL', staff: 'ALL' };

      // Clean up any drawer elements previously appended to document.body from past renders
      const existingDrawer = document.getElementById('svc-filter-drawer');
      if (existingDrawer && existingDrawer.parentElement === document.body) {
        existingDrawer.remove();
      }
      const existingBackdrop = document.getElementById('svc-filter-drawer-backdrop');
      if (existingBackdrop && existingBackdrop.parentElement === document.body) {
        existingBackdrop.remove();
      }

      return `
        <div class="services-hub-view" style="position: relative;">
          <!-- Filter Drawer Backdrop -->
          <div class="services-filter-drawer-backdrop" id="svc-filter-drawer-backdrop"></div>

          <!-- Natural Full Height Filter Drawer (Slides out smoothly from right edge) -->
          <div class="services-filter-drawer" id="svc-filter-drawer">
            <div class="drawer-header">
              <div class="drawer-header-left">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
                </svg>
                <span class="drawer-title">Filter Services</span>
                <span class="drawer-tally-sub" id="svc-drawer-match-count">${services.length} items</span>
              </div>
              <button type="button" class="drawer-close-btn" id="btn-close-filter-drawer" title="Close drawer">✕</button>
            </div>

            <div class="drawer-body">
              <!-- Filter by Category -->
              <div class="filter-group">
                <div class="filter-group-header-row">
                  <span class="filter-group-label">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
                      <rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
                      <rect x="14" y="14" width="7" height="7" rx="1.5"></rect>
                      <rect x="3" y="14" width="7" height="7" rx="1.5"></rect>
                    </svg>
                    Category (${categories.length > 1 ? categories.length - 1 : 0})
                  </span>
                  <button type="button" class="btn-drawer-manage-cat-link" id="btn-drawer-manage-cat-link">Manage Categories</button>
                </div>
                <div class="filter-chips-row" id="drawer-category-chips">
                  <button type="button" class="filter-chip-btn ${(activeFilters.category || 'ALL').toUpperCase() === 'ALL' ? 'is-active' : ''}" data-filter-type="category" data-value="ALL">
                    All (${services.length})
                  </button>
                  ${categories.filter((c) => c !== 'ALL').map((c) => {
                    const count = services.filter((s) => (s.category || '').toUpperCase() === (c || '').toUpperCase()).length;
                    const isAct = (activeFilters.category || '').toUpperCase() === c.toUpperCase();
                    return `
                      <button type="button" class="filter-chip-btn ${isAct ? 'is-active' : ''}" data-filter-type="category" data-value="${c}">
                        <span>${getCatIcon(c, '')}</span>
                        <span>${c}</span>
                        <span class="filter-chip-count">(${count})</span>
                      </button>
                    `;
                  }).join('')}
                </div>
              </div>

              <!-- Filter by Target Audience / Gender -->
              <div class="filter-group">
                <div class="filter-group-header-row">
                  <span class="filter-group-label">👤 Target Audience / Gender</span>
                </div>
                <div class="filter-chips-row" id="drawer-gender-chips">
                  <button type="button" class="filter-chip-btn ${(activeFilters.gender || 'ALL').toUpperCase() === 'ALL' ? 'is-active' : ''}" data-filter-type="gender" data-value="ALL">
                    All (${services.length})
                  </button>
                  <button type="button" class="filter-chip-btn ${(activeFilters.gender || '').toUpperCase() === 'MALE' ? 'is-active' : ''}" data-filter-type="gender" data-value="MALE">
                    <span>👤</span>
                    <span>Men</span>
                    <span class="filter-chip-count">(${services.filter((s) => (s.targetGender || '').toUpperCase() === 'MALE').length})</span>
                  </button>
                  <button type="button" class="filter-chip-btn ${(activeFilters.gender || '').toUpperCase() === 'FEMALE' ? 'is-active' : ''}" data-filter-type="gender" data-value="FEMALE">
                    <span>👩</span>
                    <span>Women</span>
                    <span class="filter-chip-count">(${services.filter((s) => (s.targetGender || '').toUpperCase() === 'FEMALE').length})</span>
                  </button>
                  <button type="button" class="filter-chip-btn ${(activeFilters.gender || '').toUpperCase() === 'UNISEX' ? 'is-active' : ''}" data-filter-type="gender" data-value="UNISEX">
                    <span>👥</span>
                    <span>Unisex</span>
                    <span class="filter-chip-count">(${services.filter((s) => !s.targetGender || (s.targetGender || '').toUpperCase() === 'UNISEX').length})</span>
                  </button>
                  <button type="button" class="filter-chip-btn ${(activeFilters.gender || '').toUpperCase() === 'KIDS' ? 'is-active' : ''}" data-filter-type="gender" data-value="KIDS">
                    <span>👶</span>
                    <span>Kids</span>
                    <span class="filter-chip-count">(${services.filter((s) => (s.targetGender || '').toUpperCase() === 'KIDS').length})</span>
                  </button>
                </div>
              </div>

              <!-- Filter by Staffing Assignment -->
              <div class="filter-group">
                <div class="filter-group-header-row">
                  <span class="filter-group-label">✂️ Stylist Assignment</span>
                </div>
                <div class="filter-chips-row" id="drawer-staff-chips">
                  <button type="button" class="filter-chip-btn ${(activeFilters.staff || 'ALL').toUpperCase() === 'ALL' ? 'is-active' : ''}" data-filter-type="staff" data-value="ALL">
                    All (${services.length})
                  </button>
                  <button type="button" class="filter-chip-btn ${(activeFilters.staff || '').toUpperCase() === 'ASSIGNED' ? 'is-active' : ''}" data-filter-type="staff" data-value="ASSIGNED">
                    <span>●</span>
                    <span>Assigned</span>
                    <span class="filter-chip-count">(${services.filter((s) => ((s.stylists && s.stylists.length) || s._count?.stylists || 0) > 0).length})</span>
                  </button>
                  <button type="button" class="filter-chip-btn ${(activeFilters.staff || '').toUpperCase() === 'UNASSIGNED' ? 'is-active' : ''}" data-filter-type="staff" data-value="UNASSIGNED">
                    <span>○</span>
                    <span>Unassigned</span>
                    <span class="filter-chip-count">(${services.filter((s) => ((s.stylists && s.stylists.length) || s._count?.stylists || 0) === 0).length})</span>
                  </button>
                </div>
              </div>
            </div>

            <div class="drawer-footer-actions">
              <button type="button" class="btn-reset-filters" id="btn-drawer-reset-filters">Reset All</button>
              <button type="button" class="btn-apply-filters" id="btn-drawer-apply-filters">Show Results</button>
            </div>
          </div>

          <!-- 1. Header Bar: Title & Count (Left) + Actions: AI Scan & Add Service (Right) -->
          <div class="service-operations-bar">
            <div class="service-hub-title-wrap">
              <span class="service-hub-icon">✂️</span>
              <h3 class="service-hub-title">Services & Pricing</h3>
              <span class="service-hub-count" id="svc-total-count">${services.length}</span>
            </div>
            <div class="service-hub-actions">
              <button type="button" class="btn-scan-camera" id="btn-scan-menu-ai" title="Scan Rate Card with AI">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                  <circle cx="12" cy="13" r="4"></circle>
                </svg>
                <span>Scan Menu</span>
              </button>
              <button type="button" class="service-hub-btn btn-primary" id="btn-add-service" title="Add Service">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                <span>Add Service</span>
              </button>
            </div>
          </div>

          ${services.length === 0 ? `
            <div style="text-align: center; padding: 40px 20px; background: rgba(255,255,255,0.02); border-radius: var(--radius-md); border: 1px dashed rgba(255,255,255,0.1);">
              <div style="font-size: 2rem; margin-bottom: 8px;">✂️</div>
              <h4 style="color: #fff; margin-bottom: 4px; font-weight: 700; font-size: 0.95rem;">No Services Added Yet</h4>
              <p style="color: var(--text-secondary); font-size: 0.8rem; margin-bottom: 16px;">Scan your physical menu card with AI to add all services instantly, or add manually.</p>
              <div style="display: flex; justify-content: center; gap: 10px; flex-wrap: wrap;">
                <button type="button" class="btn-scan-camera" id="btn-empty-scan-menu-ai" style="padding: 10px 18px; font-size: 0.9rem;">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                    <circle cx="12" cy="13" r="4"></circle>
                  </svg>
                  <span>Scan Menu Card with AI</span>
                </button>
                <button type="button" class="service-hub-btn btn-primary" id="btn-empty-add-service" style="padding: 10px 18px; font-size: 0.9rem;">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
                  <span>Add Manually</span>
                </button>
              </div>
            </div>
          ` : `
            <!-- 2. Search & Filter Bar: Live Search (Left) + Filter Trigger Button (Right) -->
            <div class="service-search-filter-toolbar">
              <!-- Live Search Box with Clear Button -->
              <div class="services-search-box">
                <svg class="search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <input type="text" class="services-search-input" id="svc-search-input" placeholder="Search services..." />
                <button type="button" class="btn-clear-search" id="btn-clear-svc-search" style="display: none;" title="Clear search">✕</button>
              </div>

              <!-- Filter Drawer Trigger Button (Right Side) -->
              <button type="button" class="service-filter-drawer-trigger" id="btn-open-filter-drawer" title="Filter by Category, Gender & Staff">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="4" y1="21" x2="4" y2="14"></line>
                  <line x1="4" y1="10" x2="4" y2="3"></line>
                  <line x1="12" y1="21" x2="12" y2="12"></line>
                  <line x1="12" y1="8" x2="12" y2="3"></line>
                  <line x1="20" y1="21" x2="20" y2="16"></line>
                  <line x1="20" y1="12" x2="20" y2="3"></line>
                  <line x1="1" y1="14" x2="7" y2="14"></line>
                  <line x1="9" y1="8" x2="15" y2="8"></line>
                  <line x1="17" y1="16" x2="23" y2="16"></line>
                </svg>
                <span>Filter</span>
                <span class="filter-count-badge" id="svc-active-filter-badge" style="display: none;">0</span>
              </button>
            </div>

            <!-- Active Filter Badges Bar (Shows selected Category/Gender/Staff with ✕ to remove) -->
            <div class="service-active-filters-bar" id="svc-active-filters-bar" style="display: none;">
              <span class="active-filters-label">Active:</span>
              <div class="active-filters-chips" id="svc-active-filters-chips"></div>
              <button type="button" class="btn-clear-all-filters" id="btn-clear-all-filters">Clear all</button>
            </div>

            <!-- 3. Dedicated Frameless Service List Container (Separated from Operations) -->
            <div class="service-list-container" id="svc-list-container">
              ${services.map((s) => {
                const count = (s.stylists && s.stylists.length) || s._count?.stylists || 0;
                const g = (s.targetGender || 'UNISEX').toUpperCase();
                const labelMap = { MALE: 'Men', FEMALE: 'Women', UNISEX: 'Unisex', KIDS: 'Kids' };
                const genderIcons = { MALE: '👤', FEMALE: '👩', UNISEX: '👥', KIDS: '👶' };
                const genderLabel = labelMap[g] || 'Unisex';
                const gIcon = genderIcons[g] || '👥';
                const catName = s.category || 'General';
                const catIcon = getCatIcon(catName, s.name);
                const descText = (s.description || '').trim();
                const isLongDesc = descText.length > 42;
                const isExpanded = Boolean(window._expandedServiceDescIds && window._expandedServiceDescIds.has(s.id));

                return `
                  <div class="service-card-item" data-category="${catName.toUpperCase()}" data-name="${(s.name || '').toLowerCase()}" data-gender="${g}" data-staff-count="${count}">
                    <!-- Top: Icon + Headings & Tags (Left) | Action Buttons (Right) -->
                    <div class="service-card-header">
                      <div class="service-card-brand">
                        <div class="service-card-icon-badge">${catIcon}</div>
                        <div class="service-card-headings">
                          <h4 class="service-card-name" title="${(s.name || 'Service').replace(/"/g, '&quot;')}">${s.name || 'Service'}</h4>
                          <div class="service-card-pills-row">
                            <span class="service-card-cat-pill">${catName}</span>
                            <span class="service-card-gender-pill gender-${g.toLowerCase()}">
                              <span>${gIcon}</span>
                              <span>${genderLabel}</span>
                            </span>
                          </div>
                        </div>
                      </div>

                      <div class="service-card-actions">
                        <button type="button" class="service-action-icon-btn btn-edit-service" 
                          data-id="${s.id}" 
                          data-name="${(s.name || '').replace(/"/g, '&quot;')}" 
                          data-price="${s.price || 0}" 
                          data-duration="${s.durationMinutes || 30}" 
                          data-category="${(s.category || '').replace(/"/g, '&quot;')}" 
                          data-desc="${descText.replace(/"/g, '&quot;')}" 
                          title="Edit Service">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                          </svg>
                        </button>
                        <button type="button" class="service-action-icon-btn action-del btn-delete-service" 
                          data-id="${s.id}" 
                          data-name="${(s.name || '').replace(/"/g, '&quot;')}" 
                          title="Delete Service">
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                          </svg>
                        </button>
                      </div>
                    </div>

                    <!-- Middle: Description with See more / See less (Full Width) -->
                    ${descText ? `
                      <div class="service-card-desc-wrap">
                        <p class="service-card-desc-text ${isExpanded ? 'is-expanded' : 'is-clamped'}" id="svc-desc-${s.id}" data-expanded="${isExpanded ? 'true' : 'false'}" style="${isExpanded ? 'display:block !important;-webkit-line-clamp:none !important;overflow:visible !important;' : ''}" onclick="window.toggleServiceDesc('svc-desc-${s.id}', null, event)">${descText.replace(/"/g, '&quot;')}</p>
                        ${isLongDesc ? `
                          <button type="button" class="btn-service-desc-more" data-target="svc-desc-${s.id}" onclick="window.toggleServiceDesc('svc-desc-${s.id}', this, event)">${isExpanded ? 'See less' : 'See more'}</button>
                        ` : ''}
                      </div>
                    ` : ''}

                    <!-- Bottom: Duration & Stylist Assignment (Left) | Price (Right) -->
                    <div class="service-card-footer">
                      <div class="service-card-meta-group">
                        <span class="service-meta-pill" title="Duration">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <polyline points="12 6 12 12 16 14"></polyline>
                          </svg>
                          <span><strong>${s.durationMinutes || 30}</strong> mins</span>
                        </span>

                        <span class="service-staff-pill ${count > 0 ? 'is-assigned' : 'is-unassigned'}" title="${count > 0 ? `${count} Stylist(s) assigned` : 'No stylists assigned'}">
                          <span class="staff-dot ${count > 0 ? 'dot-active' : 'dot-unassigned'}"></span>
                          <span>${count > 0 ? `${count} Stylist${count > 1 ? 's' : ''}` : 'Unassigned'}</span>
                        </span>
                      </div>

                      <div class="service-card-price-wrap">
                        <span class="service-card-currency">₹</span><span class="service-card-amount">${s.price || 0}</span>
                      </div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>

            <!-- Empty Search / Filter State -->
            <div id="svc-no-results" class="services-empty-search-state" style="display: none;">
              <div class="empty-search-icon">🔍</div>
              <p class="empty-search-text">No services match your active filters or search.</p>
              <button type="button" class="btn-reset-search-state" id="btn-reset-empty-search">Reset Filters</button>
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

    // SECTION 1: PERSONAL ACCOUNT & SALON PROFILE (Clean 2-Section PersonalProfileView)
    if (subtab === 'account') {
      return `
        <div id="personal-profile-mount-point" class="personal-profile-view-root"></div>
      `;
    }

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

    // SECTION 2: CLIENT BOOKING & RECEPTION QR (Modular BookingQrView)
    if (subtab === 'booking-qr' || subtab === 'storefront') {
      return `
        <div id="booking-qr-mount-point" class="booking-qr-view-root"></div>
      `;
    }

    // SECTION 3: PASSWORD & SECURITY (Modular PasswordSecurityView)
    if (subtab === 'security') {
      return `
        <div id="password-security-mount-point" class="password-security-view-root"></div>
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
      await ApiClient.updateSalonWorkingHours([{ dayOfWeek, isClosed: newIsClosed }]);
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

    // 3. Subtab: Account Profile & Salon Information (PersonalProfileView)
    const ppMount = document.getElementById('personal-profile-mount-point');
    if (ppMount) {
      PersonalProfileView.init(ppMount, this);
    }

    // 4. Subtab: Client Booking & QR Link (Modular BookingQrView)
    const qrMount = document.getElementById('booking-qr-mount-point');
    if (qrMount) {
      BookingQrView.init(qrMount, this);
    }

    const copyLinkHandler = () => {
      const slug = this.salonProfile?.slug || 'salon';
      const url = `${window.location.origin}/#book/${slug}`;
      navigator.clipboard.writeText(url);
      this.showToast('Web booking link copied to clipboard!', 'success');
    };
    document.getElementById('btn-copy-invite')?.addEventListener('click', copyLinkHandler);
    document.getElementById('btn-copy-invite-subtab')?.addEventListener('click', copyLinkHandler);

    // 4b. Subtab: Hours & Closures listeners
    if (this.activeProfileSubtab === 'hours' || this.activeProfileSubtab === 'operations') {
      this.attachSalonHoursSubtabListeners();
    }
    document.getElementById('btn-edit-hours-schedule')?.addEventListener('click', () => {
      this.showSalonScheduleModal();
    });



    // 5. Subtab: Security Form (Modular PasswordSecurityView)
    const secMount = document.getElementById('password-security-mount-point');
    if (secMount) {
      PasswordSecurityView.init(secMount, this);
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

  openServicesFilterDrawer() {
    const drawer = document.getElementById('svc-filter-drawer');
    const backdrop = document.getElementById('svc-filter-drawer-backdrop');
    if (!drawer) return;

    // Relocate to document.body so that fixed positioning is 100vh viewport-wide
    // and cannot be constrained or trapped by any parent transform, filter, or backdrop-filter
    if (drawer.parentElement !== document.body) {
      if (backdrop) document.body.appendChild(backdrop);
      document.body.appendChild(drawer);
    }

    // Force reflow for smooth slide transition
    void drawer.offsetHeight;

    drawer.classList.add('is-open');
    if (backdrop) backdrop.classList.add('is-open');
    document.body.style.overflow = 'hidden';

    // Synchronize active chips immediately upon opening
    this.syncServicesFilterPills();
  }

  closeServicesFilterDrawer() {
    const drawer = document.getElementById('svc-filter-drawer');
    const backdrop = document.getElementById('svc-filter-drawer-backdrop');
    if (drawer) drawer.classList.remove('is-open');
    if (backdrop) backdrop.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  syncServicesFilterPills() {
    if (!this.serviceFilters) {
      this.serviceFilters = { category: 'ALL', gender: 'ALL', staff: 'ALL' };
    }
    const activeCat = (this.serviceFilters.category || 'ALL').toUpperCase();
    const activeGender = (this.serviceFilters.gender || 'ALL').toUpperCase();
    const activeStaff = (this.serviceFilters.staff || 'ALL').toUpperCase();

    // Category chips in drawer (searches document-wide by data-filter-type to reach body-relocated drawer)
    document.querySelectorAll('.filter-chip-btn[data-filter-type="category"]').forEach((btn) => {
      const val = (btn.getAttribute('data-value') || '').toUpperCase();
      btn.classList.toggle('is-active', val === activeCat);
    });
    // Gender chips in drawer
    document.querySelectorAll('.filter-chip-btn[data-filter-type="gender"]').forEach((btn) => {
      const val = (btn.getAttribute('data-value') || '').toUpperCase();
      btn.classList.toggle('is-active', val === activeGender);
    });
    // Staff chips in drawer
    document.querySelectorAll('.filter-chip-btn[data-filter-type="staff"]').forEach((btn) => {
      const val = (btn.getAttribute('data-value') || '').toUpperCase();
      btn.classList.toggle('is-active', val === activeStaff);
    });
  }

  triggerServicesFilter() {
    this.syncServicesFilterPills();
    const searchInput = document.getElementById('svc-search-input');
    const q = (searchInput?.value || '').trim().toLowerCase();
    const clearSearchBtn = document.getElementById('btn-clear-svc-search');
    if (clearSearchBtn) {
      clearSearchBtn.style.display = q ? 'flex' : 'none';
    }

    const activeCat = (this.serviceFilters?.category || 'ALL').toUpperCase();
    const activeGender = (this.serviceFilters?.gender || 'ALL').toUpperCase();
    const activeStaff = (this.serviceFilters?.staff || 'ALL').toUpperCase();

    const cards = document.querySelectorAll('.service-card-item, .service-row-card, .service-compact-card');
    let visible = 0;
    cards.forEach((card) => {
      const name = (card.getAttribute('data-name') || '').toLowerCase();
      const cat = (card.getAttribute('data-category') || '').toUpperCase();
      const gender = (card.getAttribute('data-gender') || 'UNISEX').toUpperCase();
      const staffCount = parseInt(card.getAttribute('data-staff-count') || '0', 10);

      const matchesQuery = !q || name.includes(q) || cat.toLowerCase().includes(q);
      const matchesCat = activeCat === 'ALL' || cat === activeCat;
      const matchesGender =
        activeGender === 'ALL' ||
        gender === activeGender ||
        (gender === 'UNISEX' && (activeGender === 'MALE' || activeGender === 'FEMALE' || activeGender === 'KIDS'));
      let matchesStaff = true;
      if (activeStaff === 'ASSIGNED') matchesStaff = staffCount > 0;
      else if (activeStaff === 'UNASSIGNED') matchesStaff = staffCount === 0;

      if (matchesQuery && matchesCat && matchesGender && matchesStaff) {
        card.style.display = 'flex';
        visible++;
      } else {
        card.style.display = 'none';
      }
    });

    const noResults = document.getElementById('svc-no-results');
    if (noResults) {
      noResults.style.display = visible === 0 && cards.length > 0 ? 'flex' : 'none';
    }
    const drawerTally = document.getElementById('svc-drawer-match-count');
    if (drawerTally) {
      drawerTally.textContent = `${visible} items`;
    }
    const activeBadge = document.getElementById('svc-active-filter-badge');
    const openDrawerBtn = document.getElementById('btn-open-filter-drawer');
    let activeCount = 0;
    if (activeCat !== 'ALL') activeCount++;
    if (activeGender !== 'ALL') activeCount++;
    if (activeStaff !== 'ALL') activeCount++;
    if (activeBadge) {
      if (activeCount > 0) {
        activeBadge.textContent = String(activeCount);
        activeBadge.style.display = 'inline-flex';
        openDrawerBtn?.classList.add('is-filtered');
      } else {
        activeBadge.style.display = 'none';
        openDrawerBtn?.classList.remove('is-filtered');
      }
    }

    const activeBar = document.getElementById('svc-active-filters-bar');
    const activeChipsContainer = document.getElementById('svc-active-filters-chips');
    if (activeBar && activeChipsContainer) {
      const pills = [];
      if (activeCat !== 'ALL') pills.push({ type: 'category', label: `Category: ${this.serviceFilters.category}` });
      if (activeGender !== 'ALL') {
        const gLabels = { MALE: 'Men', FEMALE: 'Women', UNISEX: 'Unisex', KIDS: 'Kids' };
        pills.push({ type: 'gender', label: `Gender: ${gLabels[activeGender] || activeGender}` });
      }
      if (activeStaff !== 'ALL') {
        pills.push({ type: 'staff', label: activeStaff === 'ASSIGNED' ? 'Assigned' : 'Unassigned' });
      }
      if (pills.length > 0) {
        activeBar.style.display = 'flex';
        activeChipsContainer.innerHTML = pills.map((p) => `
          <span class="active-filter-pill">
            <span>${p.label}</span>
            <button type="button" class="btn-remove-filter" data-filter-type="${p.type}" title="Remove filter">✕</button>
          </span>
        `).join('');
      } else {
        activeBar.style.display = 'none';
        activeChipsContainer.innerHTML = '';
      }
    }
  }

  attachServicesTabListeners(tabContent) {
    const root = tabContent || this.container || document;
    const searchInput = root.querySelector('#svc-search-input');
    const clearSearchBtn = root.querySelector('#btn-clear-svc-search');
    const cards = root.querySelectorAll('.service-card-item, .service-row-card, .service-compact-card');
    const catTabs = root.querySelectorAll('.service-cat-tab-btn[data-cat]');
    const noResults = root.querySelector('#svc-no-results');
    const resetEmptyBtn = root.querySelector('#btn-reset-empty-search');

    // Drawer elements (search document in case relocated to body)
    const drawer = document.getElementById('svc-filter-drawer') || root.querySelector('#svc-filter-drawer');
    const backdrop = document.getElementById('svc-filter-drawer-backdrop') || root.querySelector('#svc-filter-drawer-backdrop');
    const openDrawerBtn = root.querySelector('#btn-open-filter-drawer');
    const closeDrawerBtn = document.getElementById('btn-close-filter-drawer') || root.querySelector('#btn-close-filter-drawer');
    const applyDrawerBtn = document.getElementById('btn-drawer-apply-filters') || root.querySelector('#btn-drawer-apply-filters');
    const resetDrawerBtn = document.getElementById('btn-drawer-reset-filters') || root.querySelector('#btn-drawer-reset-filters');
    const drawerTally = document.getElementById('svc-drawer-match-count') || root.querySelector('#svc-drawer-match-count');
    const activeBadge = root.querySelector('#svc-active-filter-badge');

    // Active filters bar
    const activeBar = root.querySelector('#svc-active-filters-bar');
    const activeChipsContainer = root.querySelector('#svc-active-filters-chips');
    const clearAllBtn = root.querySelector('#btn-clear-all-filters');

    // Filter states
    if (!this.serviceFilters) {
      this.serviceFilters = { category: 'ALL', gender: 'ALL', staff: 'ALL' };
    }

    const openDrawer = () => {
      this.openServicesFilterDrawer();
    };

    const closeDrawer = () => {
      this.closeServicesFilterDrawer();
    };

    openDrawerBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      openDrawer();
    });
    closeDrawerBtn?.addEventListener('click', closeDrawer);
    backdrop?.addEventListener('click', closeDrawer);
    applyDrawerBtn?.addEventListener('click', closeDrawer);

    // Close on ESC
    const handleKeydown = (e) => {
      if (e.key === 'Escape' && drawer?.classList.contains('is-open')) {
        closeDrawer();
      }
    };
    if (this._svcDrawerEscHandler) {
      document.removeEventListener('keydown', this._svcDrawerEscHandler);
    }
    this._svcDrawerEscHandler = handleKeydown;
    document.addEventListener('keydown', this._svcDrawerEscHandler);

    const updateFilterBadgeAndPills = () => {
      let activeCount = 0;
      const pills = [];

      if (this.serviceFilters.category && this.serviceFilters.category !== 'ALL') {
        activeCount++;
        pills.push({ type: 'category', label: `Category: ${this.serviceFilters.category}` });
      }
      if (this.serviceFilters.gender && this.serviceFilters.gender !== 'ALL') {
        activeCount++;
        const gLabels = { MALE: 'Men', FEMALE: 'Women', UNISEX: 'Unisex', KIDS: 'Kids' };
        pills.push({ type: 'gender', label: `Gender: ${gLabels[this.serviceFilters.gender] || this.serviceFilters.gender}` });
      }
      if (this.serviceFilters.staff && this.serviceFilters.staff !== 'ALL') {
        activeCount++;
        pills.push({ type: 'staff', label: this.serviceFilters.staff === 'ASSIGNED' ? 'Staffed (>0)' : 'No Stylists (0)' });
      }

      if (activeBadge) {
        if (activeCount > 0) {
          activeBadge.textContent = String(activeCount);
          activeBadge.style.display = 'inline-flex';
          openDrawerBtn?.classList.add('is-filtered');
        } else {
          activeBadge.style.display = 'none';
          openDrawerBtn?.classList.remove('is-filtered');
        }
      }

      if (activeBar && activeChipsContainer) {
        if (pills.length > 0) {
          activeBar.style.display = 'flex';
          activeChipsContainer.innerHTML = pills.map((p) => `
            <span class="active-filter-pill">
              <span>${p.label}</span>
              <button type="button" class="btn-remove-filter" data-filter-type="${p.type}" title="Remove filter">✕</button>
            </span>
          `).join('');

          activeChipsContainer.querySelectorAll('.btn-remove-filter').forEach((btn) => {
            btn.addEventListener('click', (e) => {
              const type = e.currentTarget.getAttribute('data-filter-type');
              if (type) {
                this.serviceFilters[type] = 'ALL';
                syncDrawerPills();
                filterServices();
              }
            });
          });
        } else {
          activeBar.style.display = 'none';
          activeChipsContainer.innerHTML = '';
        }
      }
    };

    const syncDrawerPills = () => {
      this.syncServicesFilterPills();
    };

    const filterServices = () => {
      const q = (searchInput?.value || '').trim().toLowerCase();
      if (clearSearchBtn) {
        clearSearchBtn.style.display = q ? 'flex' : 'none';
      }

      const activeCat = (this.serviceFilters.category || 'ALL').toUpperCase();
      const activeGender = (this.serviceFilters.gender || 'ALL').toUpperCase();
      const activeStaff = (this.serviceFilters.staff || 'ALL').toUpperCase();

      let visible = 0;
      cards.forEach((card) => {
        const name = (card.getAttribute('data-name') || '').toLowerCase();
        const cat = (card.getAttribute('data-category') || '').toUpperCase();
        const gender = (card.getAttribute('data-gender') || 'UNISEX').toUpperCase();
        const staffCount = parseInt(card.getAttribute('data-staff-count') || '0', 10);

        const matchesQuery = !q || name.includes(q) || cat.toLowerCase().includes(q);
        const matchesCat = activeCat === 'ALL' || cat === activeCat;
        const matchesGender =
          activeGender === 'ALL' ||
          gender === activeGender ||
          (gender === 'UNISEX' && (activeGender === 'MALE' || activeGender === 'FEMALE' || activeGender === 'KIDS'));
        let matchesStaff = true;
        if (activeStaff === 'ASSIGNED') matchesStaff = staffCount > 0;
        else if (activeStaff === 'UNASSIGNED') matchesStaff = staffCount === 0;

        if (matchesQuery && matchesCat && matchesGender && matchesStaff) {
          card.style.display = 'flex';
          visible++;
        } else {
          card.style.display = 'none';
        }
      });

      if (noResults) {
        noResults.style.display = visible === 0 && cards.length > 0 ? 'flex' : 'none';
      }
      if (drawerTally) {
        drawerTally.textContent = `${visible} items`;
      }

      updateFilterBadgeAndPills();
    };

    searchInput?.addEventListener('input', filterServices);
    clearSearchBtn?.addEventListener('click', () => {
      if (searchInput) searchInput.value = '';
      filterServices();
    });

    // Expose filter trigger for delegated listener
    this.triggerServicesFilter = () => {
      syncDrawerPills();
      filterServices();
    };

    // Drawer chips click (search document-wide so relocated drawer is fully wired)
    document.querySelectorAll('.filter-chip-btn[data-filter-type]').forEach((btn) => {
      btn.onclick = (e) => {
        e.preventDefault();
        const type = btn.getAttribute('data-filter-type');
        const val = btn.getAttribute('data-value');
        if (type && val) {
          this.serviceFilters[type] = val;
          syncDrawerPills();
          filterServices();
        }
      };
    });

    const resetAllFilters = () => {
      this.serviceFilters = { category: 'ALL', gender: 'ALL', staff: 'ALL' };
      if (searchInput) searchInput.value = '';
      syncDrawerPills();
      filterServices();
    };

    resetDrawerBtn?.addEventListener('click', resetAllFilters);
    clearAllBtn?.addEventListener('click', resetAllFilters);
    resetEmptyBtn?.addEventListener('click', resetAllFilters);


    // Initial sync and filtering
    syncDrawerPills();
    filterServices();
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
      card.addEventListener('click', (e) => {
        if (e.target.closest('.btn-delete-stylist')) return;
        const sId = card.getAttribute('data-staff-id');
        if (sId) {
          if (String(sId).startsWith('temp-')) {
            this.showToast('Please wait a moment while this stylist finishes saving to the cloud...', 'info');
            return;
          }
          this.staffManager.setStaff(sId, 'overview');
          this.render();
        }
      });

      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          if (e.target.closest('.btn-delete-stylist')) return;
          e.preventDefault();
          card.click();
        }
      });
    });

    // 2b. Delete Stylist Action
    root.querySelectorAll('.btn-delete-stylist').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const staffId = btn.getAttribute('data-staff-id');
        const staffName = btn.getAttribute('data-staff-name') || 'Stylist';
        this.showDeleteStaffModal(staffId, staffName);
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
      const scanBtn = e.target.closest('#btn-scan-menu-ai, #btn-empty-scan-menu-ai, .btn-trigger-ai-scan');
      if (scanBtn) {
        e.preventDefault();
        this.aiScanner?.openCapturePrompt();
        return;
      }

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

    // Universal Pull-to-Refresh Gestures (Touch & Desktop Mouse Drag)
    const ptrWrapper = document.getElementById('ptr-wrapper');
    const ptrIcon = document.getElementById('ptr-icon');
    const ptrText = document.getElementById('ptr-text');
    let startY = 0;
    let currentPullDist = 0;
    let isPulling = false;

    const startPull = (clientY) => {
      if (window.scrollY <= 10 && ptrWrapper) {
        startY = clientY;
        isPulling = true;
      }
    };

    const updatePull = (clientY) => {
      if (!isPulling || !ptrWrapper || window.scrollY > 10) return;
      const diff = clientY - startY;
      if (diff > 0) {
        currentPullDist = Math.min(65, diff * 0.45);
        ptrWrapper.classList.add('ptr-pulling');
        ptrWrapper.style.height = `${currentPullDist}px`;
        if (currentPullDist > 45) {
          if (ptrIcon) ptrIcon.style.transform = 'rotate(180deg)';
          if (ptrText) ptrText.textContent = 'Release to refresh';
        } else {
          if (ptrIcon) ptrIcon.style.transform = 'rotate(0deg)';
          if (ptrText) ptrText.textContent = 'Pull to refresh';
        }
      }
    };

    const endPull = async () => {
      if (!isPulling || !ptrWrapper) return;
      isPulling = false;
      if (currentPullDist > 45) {
        ptrWrapper.classList.add('ptr-spinning');
        const tabName = (this.activeTab || 'queue');
        if (ptrText) ptrText.textContent = `Refreshing ${tabName}...`;
        try {
          await this.refreshCurrentView(true);
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
    };

    window.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) startPull(e.touches[0].screenY);
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1) updatePull(e.touches[0].screenY);
    }, { passive: true });

    window.addEventListener('touchend', endPull, { passive: true });

    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        const target = e.target;
        if (target.closest('#main-content') || target.closest('.q-stream') || target.closest('.q-date-bar')) {
          startPull(e.clientY);
        }
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (isPulling) updatePull(e.clientY);
    });

    window.addEventListener('mouseup', () => {
      if (isPulling) endPull();
    });


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
        const targetBtn = e.currentTarget;
        if (targetBtn.disabled) return;
        targetBtn.disabled = true;
        const id = targetBtn.getAttribute('data-id');
        const status = targetBtn.getAttribute('data-status');

        // Optimistic in-memory update (0ms Frame 1)
        const targetItem = (this.queueSync?.items || []).find((item) => item.id === id);
        const prevStatus = targetItem ? targetItem.status : null;
        if (targetItem) {
          targetItem.status = status;
          this.render();
        }

        try {
          if (prevStatus === 'PENDING_ACCEPTANCE') {
            if (status === 'CHECKED_IN' || status === 'CONFIRMED') {
              await ApiClient.acceptQuickBooking(id);
            } else if (status === 'REJECTED' || status === 'CANCELLED') {
              await ApiClient.declineQuickBooking(id);
            } else {
              await ApiClient.updateAppointmentStatus(id, status);
            }
          } else {
            await ApiClient.updateAppointmentStatus(id, status);
          }
        } catch (err) {
          if (targetItem && prevStatus) {
            targetItem.status = prevStatus;
            this.render();
          }
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

    // Services Tab Listeners
    if (this.activeTab === 'services') {
      this.attachServicesTabListeners(this.container);
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

    // Call tab event listeners for active tab content
    this.attachTabEventListeners();

    // Global Delegated Filter Drawer Controller (guarantees filter trigger button always works)
    if (!this._servicesFilterGlobalDelegated) {
      this._servicesFilterGlobalDelegated = true;

      document.addEventListener('click', (e) => {
        const openTrigger = e.target.closest('#btn-open-filter-drawer');
        if (openTrigger) {
          e.preventDefault();
          e.stopPropagation();
          this.openServicesFilterDrawer();
          return;
        }

        const catTrigger = e.target.closest('#btn-manage-categories, #btn-drawer-manage-cat-link');
        if (catTrigger) {
          e.preventDefault();
          e.stopPropagation();
          this.closeServicesFilterDrawer();
          this.showManageCategoriesModal();
          return;
        }

        const closeTrigger = e.target.closest('#btn-close-filter-drawer, .drawer-close-btn, #btn-drawer-apply-filters');
        if (closeTrigger) {
          e.preventDefault();
          this.closeServicesFilterDrawer();
          return;
        }

        const backdropTrigger = e.target.closest('#svc-filter-drawer-backdrop');
        if (backdropTrigger) {
          e.preventDefault();
          this.closeServicesFilterDrawer();
          return;
        }

        // Delegated Filter Chip Selection (Reliable even when drawer is relocated to document.body)
        const chipTrigger = e.target.closest('.filter-chip-btn');
        if (chipTrigger) {
          e.preventDefault();
          const type = chipTrigger.getAttribute('data-filter-type');
          const val = chipTrigger.getAttribute('data-value');
          if (type && val) {
            if (!this.serviceFilters) {
              this.serviceFilters = { category: 'ALL', gender: 'ALL', staff: 'ALL' };
            }
            this.serviceFilters[type] = val;
            this.syncServicesFilterPills();
            this.triggerServicesFilter();
          }
          return;
        }

        // Delegated Reset All Filters
        const resetTrigger = e.target.closest('#btn-drawer-reset-filters, #btn-clear-all-filters, #btn-reset-empty-search');
        if (resetTrigger) {
          e.preventDefault();
          this.serviceFilters = { category: 'ALL', gender: 'ALL', staff: 'ALL' };
          const searchInput = document.getElementById('svc-search-input');
          if (searchInput) searchInput.value = '';
          this.syncServicesFilterPills();
          this.triggerServicesFilter();
          return;
        }

        // Delegated Remove Filter Pill
        const removePillTrigger = e.target.closest('.btn-remove-filter');
        if (removePillTrigger) {
          e.preventDefault();
          const type = removePillTrigger.getAttribute('data-filter-type');
          if (type) {
            if (!this.serviceFilters) {
              this.serviceFilters = { category: 'ALL', gender: 'ALL', staff: 'ALL' };
            }
            this.serviceFilters[type] = 'ALL';
            this.syncServicesFilterPills();
            this.triggerServicesFilter();
          }
          return;
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          const drawer = document.getElementById('svc-filter-drawer');
          if (drawer && drawer.classList.contains('is-open')) {
            this.closeServicesFilterDrawer();
          }
        }
      });
    }
  }

  setupQueueTabListeners(tabContent) {
    if (!tabContent) return;

    // Queue Filter Pills (All, Waiting, In Chair, Done, Cancelled)
    tabContent.querySelectorAll('.q-chip').forEach((pill) => {
      pill.addEventListener('click', (e) => {
        const filter = e.currentTarget.getAttribute('data-filter');
        if (filter) {
          this.queueFilter = filter;
          this.render();
        }
      });
    });

    // Date Navigation Controls (Prev, Next, Today)
    const prevBtn = tabContent.querySelector('#btn-date-prev');
    if (prevBtn) {
      prevBtn.onclick = (e) => {
        e.preventDefault();
        this.handleQueueDateChange(this.addDaysToDateString(this.selectedDate, -1));
      };
    }

    const nextBtn = tabContent.querySelector('#btn-date-next');
    if (nextBtn) {
      nextBtn.onclick = (e) => {
        e.preventDefault();
        this.handleQueueDateChange(this.addDaysToDateString(this.selectedDate, 1));
      };
    }

    const todayBtn = tabContent.querySelector('#btn-date-today');
    if (todayBtn) {
      todayBtn.onclick = (e) => {
        e.preventDefault();
        this.handleQueueDateChange(this.getLocalDateString());
      };
    }

    // Interactive Calendar Popover Trigger - Single Canonical Controller
    const calPopover = tabContent.querySelector('#q-calendar-popover') || document.getElementById('q-calendar-popover');
    const calToggleBtn = tabContent.querySelector('#btn-toggle-cal-popover') || document.getElementById('btn-toggle-cal-popover');

    if (calToggleBtn) {
      calToggleBtn.onclick = (e) => this.toggleCalendarPopover(e);
    }

    if (calPopover) {
      this.wireCalendarPopoverEvents(calPopover, (d) => this.handleQueueDateChange(d));
    }

    // Ensure clean state for outside-click listener on tab re-render
    if (this._handlePopoverDocClick) {
      document.removeEventListener('click', this._handlePopoverDocClick);
      this._handlePopoverDocClick = null;
    }

    // Right-Side Filter Drawer Controls
    const filterDrawer = tabContent.querySelector('#queue-drawer') || document.getElementById('queue-drawer');
    const drawerBackdrop = tabContent.querySelector('#queue-drawer-backdrop') || document.getElementById('queue-drawer-backdrop');

    const openQueueDrawer = () => {
      filterDrawer?.classList.add('is-open');
      drawerBackdrop?.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    };

    const closeQueueDrawer = () => {
      filterDrawer?.classList.remove('is-open');
      drawerBackdrop?.classList.remove('is-open');
      document.body.style.overflow = '';
    };

    tabContent.querySelector('#btn-open-queue-drawer')?.addEventListener('click', openQueueDrawer);
    document.getElementById('btn-open-queue-drawer')?.addEventListener('click', openQueueDrawer);
    filterDrawer?.querySelector('#btn-close-queue-drawer')?.addEventListener('click', closeQueueDrawer);
    drawerBackdrop?.addEventListener('click', closeQueueDrawer);

    // Drawer Chips Selection
    filterDrawer?.querySelectorAll('.qd-chips').forEach((groupEl) => {
      groupEl.querySelectorAll('.qd-chip').forEach((chip) => {
        chip.addEventListener('click', () => {
          groupEl.querySelectorAll('.qd-chip').forEach((c) => c.classList.remove('active'));
          chip.classList.add('active');
        });
      });
    });

    // Apply Drawer Filters
    filterDrawer?.querySelector('#btn-apply-queue-filters')?.addEventListener('click', () => {
      const newFilters = { stylistId: '', bookingType: '', status: '', categoryId: '' };
      filterDrawer.querySelectorAll('.qd-chips').forEach((groupEl) => {
        const groupKey = groupEl.getAttribute('data-filter-group');
        const activeChip = groupEl.querySelector('.qd-chip.active');
        if (activeChip && groupKey) {
          newFilters[groupKey] = activeChip.getAttribute('data-val') || '';
        }
      });
      this.queueDrawerFilters = newFilters;
      closeQueueDrawer();
      this.render();
    });

    // Reset Drawer Filters
    filterDrawer?.querySelector('#btn-reset-queue-filters')?.addEventListener('click', () => {
      this.queueDrawerFilters = { stylistId: '', bookingType: '', status: '', categoryId: '' };
      closeQueueDrawer();
      this.render();
    });
  }

  /**
   * PERFORMANCE: Re-attach only event listeners inside #tab-content.
   * Called during targeted SSE re-renders to avoid re-binding global header/nav listeners.
   */
  attachTabEventListeners() {
    const tabContent = document.getElementById('tab-content');
    if (!tabContent) return;

    // Home Dashboard Event Delegation
    if (this.activeTab === 'dashboard') {
      this.homeManager.attachEventListeners(tabContent);
    }

    // Queue Screen Interactive Listeners (Date Popover, Filter Drawer, Chips)
    this.setupQueueTabListeners(tabContent);

    // Status Updates
    tabContent.querySelectorAll('.btn-status').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const targetBtn = e.currentTarget;
        if (targetBtn.disabled) return;
        targetBtn.disabled = true;
        const id = targetBtn.getAttribute('data-id');
        const status = targetBtn.getAttribute('data-status');

        // Optimistic in-memory update (0ms Frame 1)
        const targetItem = (this.queueSync?.items || []).find((item) => item.id === id);
        const prevStatus = targetItem ? targetItem.status : null;
        if (targetItem) {
          targetItem.status = status;
          this.render();
        }

        try {
          if (prevStatus === 'PENDING_ACCEPTANCE') {
            if (status === 'CHECKED_IN' || status === 'CONFIRMED') {
              await ApiClient.acceptQuickBooking(id);
            } else if (status === 'REJECTED' || status === 'CANCELLED') {
              await ApiClient.declineQuickBooking(id);
            } else {
              await ApiClient.updateAppointmentStatus(id, status);
            }
          } else {
            await ApiClient.updateAppointmentStatus(id, status);
          }
        } catch (err) {
          if (targetItem && prevStatus) {
            targetItem.status = prevStatus;
            this.render();
          }
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

    // Add Service / Add-on Button
    tabContent.querySelectorAll('.btn-open-add-addon').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const clientName = e.currentTarget.getAttribute('data-name');
        this.showAddAddonModal(id, clientName);
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
    if (this.activeTab === 'services') {
      this.attachServicesTabListeners(tabContent);
    }
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

  showAddAddonModal(appointmentId, clientName) {
    const modalContainer = document.getElementById('modal-container');
    if (!modalContainer) return;
    const services = Array.isArray(this.servicesList) ? this.servicesList.filter((s) => s.status !== 'INACTIVE') : [];

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content" style="max-width: 480px; width: 100%; border: 1px solid rgba(245, 158, 11, 0.35); box-shadow: 0 20px 40px rgba(0,0,0,0.6);">
          <div class="modal-header" style="border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 1.2rem;">✨</span>
              <h3 style="margin: 0; font-size: 1.05rem; font-weight: 700; color: #f8fafc;">Add Service / Add-on</h3>
            </div>
            <button class="close-btn" id="btn-close-modal">&times;</button>
          </div>
          <p style="color: #94a3b8; font-size: 0.82rem; margin: 12px 0 16px 0;">
            Add an extra service or add-on to <strong>${clientName}</strong>'s active visit. Duration and total billing will update automatically.
          </p>

          <div style="margin-bottom: 12px;">
            <input type="text" id="addon-search-inp" class="form-control" placeholder="Search service menu..." style="background: rgba(15, 23, 42, 0.6); font-size: 0.82rem; border-color: rgba(255,255,255,0.1);" />
          </div>

          <div id="addon-services-list" style="max-height: 280px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 4px;">
            ${services.length === 0 ? `
              <div style="text-align: center; color: #94a3b8; padding: 24px;">No services found in menu.</div>
            ` : services.map((s) => `
              <div class="addon-item" data-name="${s.name.toLowerCase()}" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; transition: all 0.15s ease;">
                <div>
                  <div style="font-weight: 700; color: #f8fafc; font-size: 0.86rem;">${s.name}</div>
                  <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 2px;">
                    ⏱️ ${s.durationMinutes} mins · <span style="color: #34d399; font-weight: 700;">₹${s.price}</span>
                  </div>
                </div>
                <button class="btn btn-primary btn-sm btn-select-addon" data-appt-id="${appointmentId}" data-service-id="${s.id}" data-service-name="${s.name}" style="padding: 5px 12px; font-size: 0.75rem; font-weight: 700; border-radius: 6px; background: rgba(245, 158, 11, 0.2); border: 1px solid rgba(245, 158, 11, 0.5); color: #fbbf24; cursor: pointer;">
                  + Add
                </button>
              </div>
            `).join('')}
          </div>

          <div id="addon-error" style="color: #f87171; font-size: 0.82rem; margin-top: 12px; display: none; padding: 8px; background: rgba(239, 68, 68, 0.1); border-radius: 6px;"></div>

          <div class="modal-footer" style="margin-top: 16px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 12px; display: flex; justify-content: flex-end;">
            <button class="btn btn-secondary btn-sm" id="btn-cancel-addon">Close</button>
          </div>
        </div>
      </div>
    `;

    const close = () => { modalContainer.innerHTML = ''; };
    document.getElementById('btn-close-modal')?.addEventListener('click', close);
    document.getElementById('btn-cancel-addon')?.addEventListener('click', close);

    const searchInp = document.getElementById('addon-search-inp');
    searchInp?.addEventListener('input', (e) => {
      const q = (e.target.value || '').toLowerCase().trim();
      modalContainer.querySelectorAll('.addon-item').forEach((el) => {
        const name = el.getAttribute('data-name') || '';
        el.style.display = name.includes(q) ? 'flex' : 'none';
      });
    });

    modalContainer.querySelectorAll('.btn-select-addon').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const apptId = e.currentTarget.getAttribute('data-appt-id');
        const svcId = e.currentTarget.getAttribute('data-service-id');
        const svcName = e.currentTarget.getAttribute('data-service-name');
        const errDiv = document.getElementById('addon-error');
        if (errDiv) errDiv.style.display = 'none';

        e.currentTarget.textContent = 'Adding...';
        e.currentTarget.disabled = true;

        try {
          const res = await ApiClient.addAddonService(apptId, svcId);
          if (res?.conflict) {
            if (errDiv) {
              errDiv.textContent = `Cannot add ${svcName}: Time slot conflicts with ${res.conflictBooking?.name || 'another booking or salon operating hours'}.`;
              errDiv.style.display = 'block';
            }
            e.currentTarget.textContent = '+ Add';
            e.currentTarget.disabled = false;
            return;
          }

          close();
          await this.loadData();
          this.render();
        } catch (err) {
          if (errDiv) {
            errDiv.textContent = err?.message || 'Could not add service.';
            errDiv.style.display = 'block';
          }
          e.currentTarget.textContent = '+ Add';
          e.currentTarget.disabled = false;
        }
      });
    });
  }

  startLiveTimerTicks() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      // 1) Existing Reminder Badges
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

      // 2) Live Reverse Countdown Clocks on Cards (Normal time styling, decreasing order)
      const clockTimers = document.querySelectorAll('.qc__clock-timer[data-countdown-target]');
      clockTimers.forEach((timerEl) => {
        const targetMs = Number(timerEl.getAttribute('data-countdown-target'));
        if (!targetMs || isNaN(targetMs)) return;
        const now = Date.now();
        const diffMs = targetMs - now;

        if (diffMs > 0) {
          const totalSecs = Math.floor(diffMs / 1000);
          const hours = Math.floor(totalSecs / 3600);
          const mins = Math.floor((totalSecs % 3600) / 60);
          const secs = totalSecs % 60;

          if (hours > 0) {
            timerEl.textContent = `⏳ ${hours} hr ${mins} min ${secs} sec`;
          } else if (mins > 0) {
            timerEl.textContent = `⏳ ${mins} min ${secs} sec`;
          } else {
            timerEl.textContent = `⏳ ${secs} sec`;
          }
        } else {
          const timeStr = timerEl.getAttribute('data-time-str') || '';
          timerEl.textContent = timeStr ? `⏰ ${timeStr}` : '';
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

    const idx = this.staffList.findIndex((s) => String(s.id) === String(id));
    const previousStatus = idx !== -1 ? this.staffList[idx].status : null;

    try {
      if (idx !== -1) {
        this.staffList[idx] = {
          ...this.staffList[idx],
          status: previousStatus === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
        };
        this.render();
      }
      await ApiClient.toggleStaffStatus(id);
      SalonRepository.invalidate('staff');
      this.showToast(`Stylist is now ${this.staffList[idx]?.status === 'ACTIVE' ? 'Active' : 'Inactive'}`, 'success');
    } catch (err) {
      if (idx !== -1 && previousStatus) {
        this.staffList[idx] = {
          ...this.staffList[idx],
          status: previousStatus,
        };
        this.render();
      }
      alert(`${err.message}`);
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

    document.getElementById('add-staff-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('new-staff-name').value.trim();
      const phone = document.getElementById('new-staff-phone').value.trim();
      const email = document.getElementById('new-staff-email')?.value?.trim() || undefined;
      const selectedServices = Array.from(document.querySelectorAll('.staff-service-chk:checked')).map((c) => c.value);

      // Instant UI response (0ms)
      const tempId = `temp-staff-${Date.now()}`;
      const optimisticStaff = {
        id: tempId,
        name,
        phone,
        email,
        status: 'ACTIVE',
        statusLabel: 'Available',
        statusDotClass: 'status-available',
        statusBadgeClass: 'badge-available',
        services: selectedServices.map((id) => ({ serviceId: id })),
        workingHours: [],
        breaks: [],
        _isOptimistic: true,
      };

      this.lastLocalActionTimestamp = Date.now();
      window.lastDashboardActionTimestamp = Date.now();
      this.staffList = [optimisticStaff, ...this.staffList];
      modalContainer.innerHTML = '';
      this.showToast(`Stylist "${name}" added!`, 'success');
      this.render();

      // Background network sync
      ApiClient.createStaff({
        name,
        phone,
        email,
        serviceIds: selectedServices,
      }).then((created) => {
        if (created && created.id) {
          this.staffList = this.staffList.map((s) => (s.id === tempId ? created : s));
          this.render();
          SalonRepository.invalidate('staff');
        }
      }).catch((err) => {
        this.staffList = this.staffList.filter((s) => s.id !== tempId);
        this.render();
        alert(`Failed to add stylist: ${err.message}`);
      });
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

    const renderCatOptions = (selected = '') => {
      if (!this.categoriesList || this.categoriesList.length === 0) {
        return '<option value="General" selected>✂️ General Services</option><option value="CUSTOM">➕ Other / Custom Category...</option>';
      }
      return this.categoriesList.map((c) => `<option value="${c.name}" data-id="${c.id}" ${c.name === selected ? 'selected' : ''}>${c.icon || '✂️'} ${c.name}</option>`).join('') + '<option value="CUSTOM">➕ Other / Custom Category...</option>';
    };

    const catList = (this.categoriesList && this.categoriesList.length > 0)
      ? this.categoriesList
      : [{ id: 'cat-general', name: 'General', icon: '✂️' }];

    const firstCat = catList[0];
    const initialCatName = firstCat.name;
    const initialCatIcon = firstCat.icon || '✂️';

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content modal-content-md service-modal-form" style="max-height: 90vh; overflow-y: auto; padding: 24px; max-width: 520px; width: 100%;">
          <!-- Header (Compact, no subtitle) -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; padding-bottom: 12px; border-bottom: 1px solid var(--border-subtle);">
            <h3 style="font-size: 1.2rem; font-weight: 700; color: #fff; margin: 0; display: flex; align-items: center; gap: 8px;">
              <span>✂️</span>
              <span>Add New Service</span>
            </h3>
            <button class="close-btn" id="btn-close-modal" style="font-size: 1.4rem; line-height: 1; padding: 2px 6px;">&times;</button>
          </div>

          <form id="add-service-form" style="display: flex; flex-direction: column; gap: 15px;">
            <!-- 1. Service Name -->
            <div class="form-group">
              <label style="font-size: 0.85rem; font-weight: 600; color: #fff; margin-bottom: 6px; display: block;">Service Name *</label>
              <input type="text" class="form-control" id="svc-name" placeholder="e.g. Standard Haircut, Beard Trim, Facial" style="height: 40px; font-size: 0.88rem;" required />
            </div>

            <!-- 2. Category with Custom Dropdown + Inline New Category -->
            <div class="form-group" style="position: relative;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <label style="font-size: 0.85rem; font-weight: 600; color: #fff; margin: 0;">Category *</label>
                <button type="button" id="btn-toggle-inline-cat" class="btn btn-secondary btn-sm" style="font-size: 0.72rem; padding: 2px 8px; border-radius: 6px;">
                  ➕ New Category
                </button>
              </div>

              <!-- Custom Category Select (replaces native OS select) -->
              <div class="custom-select-container" id="svc-cat-custom-container">
                <button type="button" class="custom-select-trigger" id="svc-cat-custom-trigger">
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span id="svc-cat-selected-icon">${initialCatIcon}</span>
                    <span id="svc-cat-selected-name" style="color: #fff; font-size: 0.88rem; font-weight: 500;">${initialCatName}</span>
                  </div>
                  <span class="custom-select-chevron" id="svc-cat-custom-chevron">▼</span>
                </button>

                <div class="custom-select-menu" id="svc-cat-custom-menu">
                  ${catList.map((c) => `
                    <div class="custom-select-option ${c.name === initialCatName ? 'selected' : ''}" data-value="${c.name}" data-icon="${c.icon || '✂️'}" data-id="${c.id || ''}">
                      <div style="display: flex; align-items: center; gap: 8px;">
                        <span>${c.icon || '✂️'}</span>
                        <span>${c.name}</span>
                      </div>
                      ${c.name === initialCatName ? '<span class="custom-select-opt-check">✓</span>' : ''}
                    </div>
                  `).join('')}
                  <div class="custom-select-option" data-value="CUSTOM" data-icon="➕" data-id="" style="border-top: 1px solid rgba(255,255,255,0.08); margin-top: 4px; padding-top: 8px; color: #c084fc;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                      <span>➕</span>
                      <span>Other / Custom Category...</span>
                    </div>
                  </div>
                </div>

                <select class="form-control" id="svc-category-select" style="display: none;" required>
                  ${renderCatOptions(initialCatName)}
                </select>
              </div>

              <!-- Inline Add Category Box -->
              <div id="svc-inline-cat-box" class="inline-cat-box" style="display: none; margin-top: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                  <span style="font-size: 0.75rem; font-weight: 600; color: #fff;">Quick Create Category</span>
                  <button type="button" id="btn-close-inline-cat" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.8rem;">✕</button>
                </div>
                <div style="display: flex; gap: 6px; align-items: center;">
                  <input type="text" id="inline-cat-icon" value="✂️" style="width: 40px; text-align: center; height: 34px; font-size: 1rem;" class="form-control" />
                  <input type="text" id="inline-cat-name" placeholder="Category name (e.g. Spa, Shave)" class="form-control" style="flex: 1; height: 34px; font-size: 0.82rem;" />
                  <button type="button" id="btn-save-inline-cat" class="btn btn-primary btn-sm" style="height: 34px; padding: 0 12px; font-size: 0.8rem;">Add</button>
                </div>
              </div>

              <!-- Custom Category Input fallback -->
              <div id="svc-custom-cat-group" style="display: none; margin-top: 8px;">
                <input type="text" class="form-control" id="svc-custom-cat-input" placeholder="Type custom category name..." style="height: 38px;" />
              </div>
            </div>

            <!-- 3. Target Audience / Gender -->
            <div class="form-group">
              <label style="font-size: 0.85rem; font-weight: 600; color: #fff; margin-bottom: 6px; display: block;">Target Audience *</label>
              <div class="audience-selector-grid" style="gap: 8px;">
                <button type="button" class="audience-toggle-btn svc-aud-btn selected" data-val="UNISEX" style="padding: 8px; font-size: 0.82rem;">✂️ Unisex</button>
                <button type="button" class="audience-toggle-btn svc-aud-btn" data-val="MALE" style="padding: 8px; font-size: 0.82rem;">👨 Men</button>
                <button type="button" class="audience-toggle-btn svc-aud-btn" data-val="FEMALE" style="padding: 8px; font-size: 0.82rem;">👩 Women</button>
                <button type="button" class="audience-toggle-btn svc-aud-btn" data-val="KIDS" style="padding: 8px; font-size: 0.82rem;">👶 Kids</button>
              </div>
              <input type="hidden" id="svc-gender" value="UNISEX" />
            </div>

            <!-- 4. Price & Duration (Side by side) -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
              <div class="form-group">
                <label style="font-size: 0.85rem; font-weight: 600; color: #fff; margin-bottom: 6px; display: block;">Price (₹) *</label>
                <div style="position: relative;">
                  <span style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); font-weight: 700; color: #fbbf24; font-size: 0.95rem;">₹</span>
                  <input type="number" class="form-control" id="svc-price" placeholder="100" min="0" step="1" style="padding-left: 28px; height: 40px; font-size: 0.88rem;" required />
                </div>
              </div>

              <div class="form-group">
                <label style="font-size: 0.85rem; font-weight: 600; color: #fff; margin-bottom: 6px; display: block;">Duration *</label>
                <div class="custom-select-container" id="svc-dur-custom-container">
                  <button type="button" class="custom-select-trigger" id="svc-dur-custom-trigger">
                    <span id="svc-dur-selected-label" style="color: #fff; font-size: 0.88rem;">30 mins</span>
                    <span class="custom-select-chevron" id="svc-dur-custom-chevron">▼</span>
                  </button>
                  <div class="custom-select-menu" id="svc-dur-custom-menu">
                    ${SERVICE_DURATION_OPTIONS.map((opt) => `
                      <div class="custom-select-option ${opt.value === 30 ? 'selected' : ''}" data-value="${opt.value}">
                        <span>${opt.label}</span>
                        ${opt.value === 30 ? '<span class="custom-select-opt-check">✓</span>' : ''}
                      </div>
                    `).join('')}
                  </div>
                  <select class="form-control" id="svc-duration" style="display: none;" required>
                    ${renderServiceDurationOptions(30)}
                  </select>
                </div>
              </div>
            </div>

            <!-- 5. Assigned Stylists (Multi-Select Dropdown) -->
            <div class="form-group" style="position: relative;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <label style="font-size: 0.85rem; font-weight: 600; color: #fff; margin: 0;">Assigned Stylists</label>
                <span id="svc-staff-hint" style="font-size: 0.74rem; color: #c084fc; font-weight: 500;">
                  ${activeStaff.length === 0 ? 'No stylists' : `All ${activeStaff.length} Stylists Selected`}
                </span>
              </div>

              <div class="svc-staff-dd-wrapper" id="svc-staff-dd-wrapper">
                <button type="button" class="svc-staff-dd-trigger" id="svc-staff-dd-trigger">
                  <div class="svc-staff-dd-label">
                    <span>👥</span>
                    <span id="svc-staff-dd-label-text">
                      ${activeStaff.length === 0 ? 'No stylists available' : `All Stylists Assigned (${activeStaff.length})`}
                    </span>
                  </div>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="svc-staff-dd-badge" id="svc-staff-dd-badge">${activeStaff.length}/${activeStaff.length}</span>
                    <span class="svc-staff-dd-chevron" id="svc-staff-dd-chevron">▼</span>
                  </div>
                </button>

                <div class="svc-staff-dd-menu" id="svc-staff-dd-menu">
                  <div class="svc-staff-dd-toolbar">
                    <div class="svc-staff-dd-search-wrap">
                      <span class="svc-staff-dd-search-icon">🔍</span>
                      <input type="text" class="svc-staff-dd-search" id="svc-staff-search" placeholder="Search stylist name..." autocomplete="off" />
                    </div>
                    <div class="svc-staff-dd-actions-row">
                      <span class="svc-staff-dd-count-text" id="svc-staff-dd-count-text">
                        ${activeStaff.length} of ${activeStaff.length} selected
                      </span>
                      <div class="svc-staff-dd-actions">
                        <button type="button" class="svc-staff-dd-action-btn" id="svc-staff-select-all">Select All</button>
                        <button type="button" class="svc-staff-dd-action-btn" id="svc-staff-clear-all">Clear All</button>
                      </div>
                    </div>
                  </div>

                  <div class="svc-staff-dd-list" id="svc-staff-dd-list">
                    ${activeStaff.length === 0 ? `
                      <div style="font-size: 0.8rem; color: var(--text-muted); padding: 12px; text-align: center;">No active stylists yet. Can be assigned later.</div>
                    ` : activeStaff.map((st) => {
                      const initials = st.name.split(' ').map((n) => n[0]).join('').substring(0, 2).toUpperCase();
                      return `
                        <div class="svc-staff-dd-item selected" data-id="${st.id}" data-name="${st.name.toLowerCase()}">
                          <input type="checkbox" class="svc-staff-assign-chk" value="${st.id}" checked style="display: none;" />
                          <div class="svc-staff-dd-checkbox">✓</div>
                          <span class="svc-staff-avatar">${initials}</span>
                          <span class="svc-staff-name" title="${st.name}">${st.name}</span>
                        </div>
                      `;
                    }).join('')}
                  </div>

                  <div class="svc-staff-dd-footer">
                    <span style="font-size: 0.74rem; color: var(--text-muted);">Click to toggle selection</span>
                    <button type="button" class="svc-staff-dd-footer-btn" id="svc-staff-dd-done-btn">Done ✓</button>
                  </div>
                </div>
              </div>
            </div>

            <!-- 6. Service Description (Clean & Simple) -->
            <div class="form-group">
              <label style="font-size: 0.85rem; font-weight: 600; color: #fff; margin-bottom: 6px; display: block;">
                Description <span style="font-weight: normal; color: var(--text-muted); font-size: 0.78rem;">(Optional)</span>
              </label>
              <input type="text" class="form-control" id="svc-desc" placeholder="Brief details about what is included in this service..." style="height: 40px; font-size: 0.88rem;" />
            </div>

            <button type="submit" class="btn btn-primary" id="btn-submit-svc-form" style="width: 100%; height: 42px; font-weight: 700; font-size: 0.9rem; margin-top: 4px;">
              Create Service →
            </button>
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
    const genderInput = document.getElementById('svc-gender');

    // Audience toggle buttons
    document.querySelectorAll('.svc-aud-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.svc-aud-btn').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        if (genderInput) genderInput.value = btn.getAttribute('data-val');
      });
    });

    // Inline category toggle & creation
    const inlineBox = document.getElementById('svc-inline-cat-box');
    document.getElementById('btn-toggle-inline-cat')?.addEventListener('click', () => {
      inlineBox.style.display = inlineBox.style.display === 'none' ? 'block' : 'none';
      if (inlineBox.style.display === 'block') {
        document.getElementById('inline-cat-name')?.focus();
      }
    });

    document.getElementById('btn-close-inline-cat')?.addEventListener('click', () => {
      inlineBox.style.display = 'none';
    });

    document.getElementById('btn-save-inline-cat')?.addEventListener('click', async () => {
      const catName = document.getElementById('inline-cat-name')?.value.trim();
      const catIcon = document.getElementById('inline-cat-icon')?.value.trim() || '✂️';
      if (!catName) return;

      try {
        const newCat = await ApiClient.createServiceCategory({ name: catName, icon: catIcon });
        this.categoriesList = await ApiClient.getServiceCategories(true).catch(() => [
          ...(this.categoriesList || []),
          newCat || { id: `cat-${Date.now()}`, name: catName, icon: catIcon },
        ]);
        categorySelect.innerHTML = renderCatOptions(catName);
        categorySelect.value = catName;
        if (catSelectedIcon) catSelectedIcon.textContent = catIcon;
        if (catSelectedName) catSelectedName.textContent = catName;

        if (catMenu) {
          catMenu.innerHTML = `
            ${this.categoriesList.map((c) => `
              <div class="custom-select-option ${c.name === catName ? 'selected' : ''}" data-value="${c.name}" data-icon="${c.icon || '✂️'}" data-id="${c.id || ''}">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span>${c.icon || '✂️'}</span>
                  <span>${c.name}</span>
                </div>
                ${c.name === catName ? '<span class="custom-select-opt-check">✓</span>' : ''}
              </div>
            `).join('')}
            <div class="custom-select-option" data-value="CUSTOM" data-icon="➕" data-id="" style="border-top: 1px solid rgba(255,255,255,0.08); margin-top: 4px; padding-top: 8px; color: #c084fc;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span>➕</span>
                <span>Other / Custom Category...</span>
              </div>
            </div>
          `;
          bindCatOptions();
        }

        inlineBox.style.display = 'none';
        document.getElementById('inline-cat-name').value = '';
        this.showToast(`Category "${catName}" added!`, 'success');
      } catch (err) {
        this.showToast(err.message || 'Failed to create category', 'error');
      }
    });

    // Custom Category Dropdown Interactions
    const catContainer = document.getElementById('svc-cat-custom-container');
    const catTrigger = document.getElementById('svc-cat-custom-trigger');
    const catMenu = document.getElementById('svc-cat-custom-menu');
    const catChevron = document.getElementById('svc-cat-custom-chevron');
    const catSelectedIcon = document.getElementById('svc-cat-selected-icon');
    const catSelectedName = document.getElementById('svc-cat-selected-name');

    const toggleCatMenu = (forceOpen) => {
      if (!catMenu) return;
      const isOpen = forceOpen !== undefined ? forceOpen : !catMenu.classList.contains('open');
      catMenu.classList.toggle('open', isOpen);
      catTrigger?.classList.toggle('active', isOpen);
      catChevron?.classList.toggle('open', isOpen);
    };

    catTrigger?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDdMenu?.(false);
      toggleDurMenu?.(false);
      toggleCatMenu();
    });

    const bindCatOptions = () => {
      catMenu?.querySelectorAll('.custom-select-option').forEach((opt) => {
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          const val = opt.getAttribute('data-value');
          const icon = opt.getAttribute('data-icon') || '✂️';
          const name = opt.querySelector('span:nth-child(2)')?.textContent || val;

          if (categorySelect) {
            categorySelect.value = val;
            categorySelect.dispatchEvent(new Event('change'));
          }

          if (catSelectedIcon) catSelectedIcon.textContent = icon;
          if (catSelectedName) catSelectedName.textContent = val === 'CUSTOM' ? 'Custom Category' : name;

          catMenu.querySelectorAll('.custom-select-option').forEach((o) => {
            o.classList.toggle('selected', o === opt);
            const check = o.querySelector('.custom-select-opt-check');
            if (check) check.remove();
            if (o === opt) {
              const checkSpan = document.createElement('span');
              checkSpan.className = 'custom-select-opt-check';
              checkSpan.textContent = '✓';
              o.appendChild(checkSpan);
            }
          });

          toggleCatMenu(false);
        });
      });
    };
    bindCatOptions();

    // Custom Duration Dropdown Interactions
    const durContainer = document.getElementById('svc-dur-custom-container');
    const durTrigger = document.getElementById('svc-dur-custom-trigger');
    const durMenu = document.getElementById('svc-dur-custom-menu');
    const durChevron = document.getElementById('svc-dur-custom-chevron');
    const durLabel = document.getElementById('svc-dur-selected-label');

    const toggleDurMenu = (forceOpen) => {
      if (!durMenu) return;
      const isOpen = forceOpen !== undefined ? forceOpen : !durMenu.classList.contains('open');
      durMenu.classList.toggle('open', isOpen);
      durTrigger?.classList.toggle('active', isOpen);
      durChevron?.classList.toggle('open', isOpen);
    };

    durTrigger?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDdMenu?.(false);
      toggleCatMenu?.(false);
      toggleDurMenu();
    });

    durMenu?.querySelectorAll('.custom-select-option').forEach((opt) => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = opt.getAttribute('data-value');
        const text = opt.querySelector('span')?.textContent || `${val} mins`;
        if (durationSelect) durationSelect.value = val;
        if (durLabel) durLabel.textContent = text;

        durMenu.querySelectorAll('.custom-select-option').forEach((o) => {
          o.classList.toggle('selected', o === opt);
          const check = o.querySelector('.custom-select-opt-check');
          if (check) check.remove();
          if (o === opt) {
            const checkSpan = document.createElement('span');
            checkSpan.className = 'custom-select-opt-check';
            checkSpan.textContent = '✓';
            o.appendChild(checkSpan);
          }
        });
        toggleDurMenu(false);
      });
    });

    document.addEventListener('click', (e) => {
      if (catContainer && !catContainer.contains(e.target)) toggleCatMenu(false);
      if (durContainer && !durContainer.contains(e.target)) toggleDurMenu(false);
    });

    // Multi-Select Stylist Dropdown Interactions
    const ddWrapper = document.getElementById('svc-staff-dd-wrapper');
    const ddTrigger = document.getElementById('svc-staff-dd-trigger');
    const ddMenu = document.getElementById('svc-staff-dd-menu');
    const ddChevron = document.getElementById('svc-staff-dd-chevron');
    const ddSearch = document.getElementById('svc-staff-search');
    const ddLabelText = document.getElementById('svc-staff-dd-label-text');
    const ddBadge = document.getElementById('svc-staff-dd-badge');
    const ddHint = document.getElementById('svc-staff-hint');
    const ddFooterCount = document.getElementById('svc-staff-dd-footer-count');
    const ddDoneBtn = document.getElementById('svc-staff-dd-done-btn');
    const ddSelectAll = document.getElementById('svc-staff-select-all');
    const ddClearAll = document.getElementById('svc-staff-clear-all');

    const updateStaffDropdownState = () => {
      const items = Array.from(document.querySelectorAll('#svc-staff-dd-list .svc-staff-dd-item'));
      const total = items.length;
      if (total === 0) return;
      const checkedItems = items.filter((it) => {
        const chk = it.querySelector('.svc-staff-assign-chk');
        return chk && chk.checked;
      });
      const checkedCount = checkedItems.length;

      if (ddBadge) ddBadge.textContent = `${checkedCount}/${total}`;
      const countText = document.getElementById('svc-staff-dd-count-text');
      if (countText) countText.textContent = `${checkedCount} of ${total} selected`;

      if (checkedCount === total) {
        if (ddLabelText) ddLabelText.textContent = `All Stylists Assigned (${total})`;
        if (ddHint) ddHint.textContent = `All ${total} Stylists Selected`;
      } else if (checkedCount === 0) {
        if (ddLabelText) ddLabelText.textContent = `No Stylists Selected`;
        if (ddHint) ddHint.textContent = `0 Selected`;
      } else if (checkedCount === 1) {
        const name = checkedItems[0].querySelector('.svc-staff-name')?.textContent || '1 Stylist';
        if (ddLabelText) ddLabelText.textContent = name;
        if (ddHint) ddHint.textContent = `1 of ${total} Selected`;
      } else if (checkedCount === 2) {
        const names = checkedItems.map((it) => it.querySelector('.svc-staff-name')?.textContent || '').filter(Boolean).join(', ');
        if (ddLabelText) ddLabelText.textContent = names;
        if (ddHint) ddHint.textContent = `2 of ${total} Selected`;
      } else {
        if (ddLabelText) ddLabelText.textContent = `${checkedCount} Stylists Selected`;
        if (ddHint) ddHint.textContent = `${checkedCount} of ${total} Selected`;
      }
    };

    const toggleDdMenu = (forceOpen) => {
      if (!ddMenu) return;
      const isOpen = forceOpen !== undefined ? forceOpen : !ddMenu.classList.contains('open');
      ddMenu.classList.toggle('open', isOpen);
      ddTrigger?.classList.toggle('active', isOpen);
      ddChevron?.classList.toggle('open', isOpen);
      if (isOpen && ddSearch) {
        ddSearch.value = '';
        ddSearch.focus({ preventScroll: true });
        document.querySelectorAll('#svc-staff-dd-list .svc-staff-dd-item').forEach((it) => (it.style.display = 'flex'));
      }
    };

    ddTrigger?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDdMenu();
    });

    ddDoneBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleDdMenu(false);
    });

    ddSearch?.addEventListener('input', (e) => {
      const q = (e.target.value || '').toLowerCase().trim();
      document.querySelectorAll('#svc-staff-dd-list .svc-staff-dd-item').forEach((it) => {
        const name = (it.getAttribute('data-name') || '').toLowerCase();
        it.style.display = name.includes(q) ? 'flex' : 'none';
      });
    });

    ddSearch?.addEventListener('click', (e) => e.stopPropagation());

    document.querySelectorAll('#svc-staff-dd-list .svc-staff-dd-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const chk = item.querySelector('.svc-staff-assign-chk');
        if (!chk) return;
        chk.checked = !chk.checked;
        item.classList.toggle('selected', chk.checked);
        updateStaffDropdownState();
      });
    });

    ddSelectAll?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('#svc-staff-dd-list .svc-staff-dd-item').forEach((it) => {
        const chk = it.querySelector('.svc-staff-assign-chk');
        if (chk) chk.checked = true;
        it.classList.add('selected');
      });
      updateStaffDropdownState();
    });

    ddClearAll?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('#svc-staff-dd-list .svc-staff-dd-item').forEach((it) => {
        const chk = it.querySelector('.svc-staff-assign-chk');
        if (chk) chk.checked = false;
        it.classList.remove('selected');
      });
      updateStaffDropdownState();
    });

    const onAddModalClickOutside = (e) => {
      if (ddWrapper && !ddWrapper.contains(e.target)) {
        toggleDdMenu(false);
      }
    };
    document.addEventListener('click', onAddModalClickOutside);

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
        targetGender: genderInput?.value || 'UNISEX',
        description: descInput.value.trim(),
        stylistIds: selectedStylistIds,
      };

      // Instant UI response (0ms)
      const tempId = `temp-svc-${Date.now()}`;
      const optimisticService = {
        id: tempId,
        ...payload,
        status: 'ACTIVE',
        stylists: selectedStylistIds.map((id) => ({ stylistId: id })),
        _isOptimistic: true,
      };

      this.servicesList = [optimisticService, ...this.servicesList];
      modalContainer.innerHTML = '';
      this.showToast(`Service "${payload.name}" created!`, 'success');
      this.render();

      // Background network sync
      ApiClient.createService(payload).then((created) => {
        if (created && created.id) {
          this.servicesList = this.servicesList.map((s) => (s.id === tempId ? created : s));
          this.render();
          SalonRepository.invalidate('services');
        }
      }).catch((err) => {
        this.servicesList = this.servicesList.filter((s) => s.id !== tempId);
        this.render();
        alert(`Failed to create service: ${err.message}`);
      });
    });
  }

  showEditServiceModal(service) {
    if (service?.id && String(service.id).startsWith('temp-')) {
      this.showToast('Please wait a moment while this service finishes saving to the cloud...', 'info');
      return;
    }
    const modalContainer = this.getModalContainer();
    const matchedCat = (this.categoriesList || []).find((c) => c.name === service.category);
    const initialCatValue = matchedCat ? service.category : 'CUSTOM';
    const activeStaff = (this.staffList || []).filter((st) => st.status === 'ACTIVE' || !st.status);
    const currentAudience = (service.targetGender || 'UNISEX').toUpperCase();
    const currentDuration = service.durationMinutes || 30;

    const renderCatOptions = (selected = '') => {
      if (!this.categoriesList || this.categoriesList.length === 0) {
        return '<option value="General" selected>✂️ General Services</option><option value="CUSTOM">➕ Other / Custom Category...</option>';
      }
      return this.categoriesList.map((c) => `<option value="${c.name}" data-id="${c.id}" ${c.name === selected ? 'selected' : ''}>${c.icon || '✂️'} ${c.name}</option>`).join('') + '<option value="CUSTOM">➕ Other / Custom Category...</option>';
    };

    const initialAssignedCount = activeStaff.filter((st) =>
      (service.stylists || []).some((s) => String(s.stylistId || s.stylist?.id || s.id) === String(st.id))
    ).length;

    let initialStaffLabel = 'No Stylists Assigned';
    if (initialAssignedCount === activeStaff.length && activeStaff.length > 0) {
      initialStaffLabel = `All Stylists Assigned (${activeStaff.length})`;
    } else if (initialAssignedCount === 1) {
      const oneSt = activeStaff.find((st) => (service.stylists || []).some((s) => String(s.stylistId || s.stylist?.id || s.id) === String(st.id)));
      initialStaffLabel = oneSt ? oneSt.name : '1 Stylist Assigned';
    } else if (initialAssignedCount > 0) {
      initialStaffLabel = `${initialAssignedCount} Stylists Assigned`;
    }

    const catList = (this.categoriesList && this.categoriesList.length > 0)
      ? this.categoriesList
      : [{ id: 'cat-general', name: 'General', icon: '✂️' }];

    let editSelectedCatName = matchedCat ? service.category : (service.category || 'General');
    let editSelectedCatIcon = matchedCat?.icon || '✂️';
    if (!matchedCat && service.category) {
      editSelectedCatName = 'CUSTOM';
      editSelectedCatIcon = '➕';
    }

    const matchedDur = SERVICE_DURATION_OPTIONS.find((opt) => opt.value === currentDuration);
    const initialDurLabel = matchedDur ? matchedDur.label : `${currentDuration} mins`;

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content modal-content-md service-modal-form" style="max-height: 90vh; overflow-y: auto; padding: 24px; max-width: 520px; width: 100%;">
          <!-- Header (Compact, no subtitle) -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px; padding-bottom: 12px; border-bottom: 1px solid var(--border-subtle);">
            <h3 style="font-size: 1.2rem; font-weight: 700; color: #fff; margin: 0; display: flex; align-items: center; gap: 8px;">
              <span>✏️</span>
              <span>Edit Service: ${service.name}</span>
            </h3>
            <button class="close-btn" id="btn-close-modal" style="font-size: 1.4rem; line-height: 1; padding: 2px 6px;">&times;</button>
          </div>

          <form id="edit-service-form" style="display: flex; flex-direction: column; gap: 15px;">
            <!-- 1. Service Name -->
            <div class="form-group">
              <label style="font-size: 0.85rem; font-weight: 600; color: #fff; margin-bottom: 6px; display: block;">Service Name *</label>
              <input type="text" class="form-control" id="edit-svc-name" value="${service.name}" style="height: 40px; font-size: 0.88rem;" required />
            </div>

            <!-- 2. Category with Custom Dropdown + Inline New Category -->
            <div class="form-group" style="position: relative;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <label style="font-size: 0.85rem; font-weight: 600; color: #fff; margin: 0;">Category *</label>
                <button type="button" id="edit-btn-toggle-inline-cat" class="btn btn-secondary btn-sm" style="font-size: 0.72rem; padding: 2px 8px; border-radius: 6px;">
                  ➕ New Category
                </button>
              </div>

              <!-- Custom Category Select (replaces native OS select) -->
              <div class="custom-select-container" id="edit-svc-cat-custom-container">
                <button type="button" class="custom-select-trigger" id="edit-svc-cat-custom-trigger">
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span id="edit-svc-cat-selected-icon">${editSelectedCatIcon}</span>
                    <span id="edit-svc-cat-selected-name" style="color: #fff; font-size: 0.88rem; font-weight: 500;">${editSelectedCatName === 'CUSTOM' ? 'Custom Category' : editSelectedCatName}</span>
                  </div>
                  <span class="custom-select-chevron" id="edit-svc-cat-custom-chevron">▼</span>
                </button>

                <div class="custom-select-menu" id="edit-svc-cat-custom-menu">
                  ${catList.map((c) => `
                    <div class="custom-select-option ${c.name === editSelectedCatName ? 'selected' : ''}" data-value="${c.name}" data-icon="${c.icon || '✂️'}" data-id="${c.id || ''}">
                      <div style="display: flex; align-items: center; gap: 8px;">
                        <span>${c.icon || '✂️'}</span>
                        <span>${c.name}</span>
                      </div>
                      ${c.name === editSelectedCatName ? '<span class="custom-select-opt-check">✓</span>' : ''}
                    </div>
                  `).join('')}
                  <div class="custom-select-option ${editSelectedCatName === 'CUSTOM' ? 'selected' : ''}" data-value="CUSTOM" data-icon="➕" data-id="" style="border-top: 1px solid rgba(255,255,255,0.08); margin-top: 4px; padding-top: 8px; color: #c084fc;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                      <span>➕</span>
                      <span>Other / Custom Category...</span>
                    </div>
                  </div>
                </div>

                <select class="form-control" id="edit-svc-category-select" style="display: none;" required>
                  ${renderCatOptions(service.category)}
                </select>
              </div>

              <!-- Inline Add Category Box -->
              <div id="edit-svc-inline-cat-box" class="inline-cat-box" style="display: none; margin-top: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                  <span style="font-size: 0.75rem; font-weight: 600; color: #fff;">Quick Create Category</span>
                  <button type="button" id="edit-btn-close-inline-cat" style="background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.8rem;">✕</button>
                </div>
                <div style="display: flex; gap: 6px; align-items: center;">
                  <input type="text" id="edit-inline-cat-icon" value="✂️" style="width: 40px; text-align: center; height: 34px; font-size: 1rem;" class="form-control" />
                  <input type="text" id="edit-inline-cat-name" placeholder="Category name (e.g. Spa, Shave)" class="form-control" style="flex: 1; height: 34px; font-size: 0.82rem;" />
                  <button type="button" id="edit-btn-save-inline-cat" class="btn btn-primary btn-sm" style="height: 34px; padding: 0 12px; font-size: 0.8rem;">Add</button>
                </div>
              </div>

              <!-- Custom Category Input fallback -->
              <div id="edit-svc-custom-cat-group" style="${initialCatValue === 'CUSTOM' ? 'display: block;' : 'display: none;'} margin-top: 8px;">
                <input type="text" class="form-control" id="edit-svc-custom-cat-input" value="${initialCatValue === 'CUSTOM' ? (service.category || '') : ''}" placeholder="Type custom category name..." style="height: 38px;" />
              </div>
            </div>

            <!-- 3. Target Audience / Gender -->
            <div class="form-group">
              <label style="font-size: 0.85rem; font-weight: 600; color: #fff; margin-bottom: 6px; display: block;">Target Audience *</label>
              <div class="audience-selector-grid" style="gap: 8px;">
                <button type="button" class="audience-toggle-btn edit-svc-aud-btn ${currentAudience === 'UNISEX' ? 'selected' : ''}" data-val="UNISEX" style="padding: 8px; font-size: 0.82rem;">✂️ Unisex</button>
                <button type="button" class="audience-toggle-btn edit-svc-aud-btn ${currentAudience === 'MALE' ? 'selected' : ''}" data-val="MALE" style="padding: 8px; font-size: 0.82rem;">👨 Men</button>
                <button type="button" class="audience-toggle-btn edit-svc-aud-btn ${currentAudience === 'FEMALE' ? 'selected' : ''}" data-val="FEMALE" style="padding: 8px; font-size: 0.82rem;">👩 Women</button>
                <button type="button" class="audience-toggle-btn edit-svc-aud-btn ${currentAudience === 'KIDS' ? 'selected' : ''}" data-val="KIDS" style="padding: 8px; font-size: 0.82rem;">👶 Kids</button>
              </div>
              <input type="hidden" id="edit-svc-gender" value="${currentAudience}" />
            </div>

            <!-- 4. Price & Duration (Side by side) -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px;">
              <div class="form-group">
                <label style="font-size: 0.85rem; font-weight: 600; color: #fff; margin-bottom: 6px; display: block;">Price (₹) *</label>
                <div style="position: relative;">
                  <span style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); font-weight: 700; color: #fbbf24; font-size: 0.95rem;">₹</span>
                  <input type="number" class="form-control" id="edit-svc-price" value="${service.price}" min="0" step="1" style="padding-left: 28px; height: 40px; font-size: 0.88rem;" required />
                </div>
              </div>

              <div class="form-group">
                <label style="font-size: 0.85rem; font-weight: 600; color: #fff; margin-bottom: 6px; display: block;">Duration *</label>
                <div class="custom-select-container" id="edit-svc-dur-custom-container">
                  <button type="button" class="custom-select-trigger" id="edit-svc-dur-custom-trigger">
                    <span id="edit-svc-dur-selected-label" style="color: #fff; font-size: 0.88rem;">${initialDurLabel}</span>
                    <span class="custom-select-chevron" id="edit-svc-dur-custom-chevron">▼</span>
                  </button>
                  <div class="custom-select-menu" id="edit-svc-dur-custom-menu">
                    ${SERVICE_DURATION_OPTIONS.map((opt) => `
                      <div class="custom-select-option ${opt.value === currentDuration ? 'selected' : ''}" data-value="${opt.value}">
                        <span>${opt.label}</span>
                        ${opt.value === currentDuration ? '<span class="custom-select-opt-check">✓</span>' : ''}
                      </div>
                    `).join('')}
                  </div>
                  <select class="form-control" id="edit-svc-duration" style="display: none;" required>
                    ${renderServiceDurationOptions(currentDuration)}
                  </select>
                </div>
              </div>
            </div>

            <!-- 5. Assigned Stylists (Multi-Select Dropdown) -->
            <div class="form-group" style="position: relative;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <label style="font-size: 0.85rem; font-weight: 600; color: #fff; margin: 0;">Assigned Stylists</label>
                <span id="edit-svc-staff-hint" style="font-size: 0.74rem; color: #c084fc; font-weight: 500;">
                  ${initialAssignedCount === activeStaff.length ? `All ${activeStaff.length} Stylists Assigned` : `${initialAssignedCount} of ${activeStaff.length} Selected`}
                </span>
              </div>

              <div class="svc-staff-dd-wrapper" id="edit-svc-staff-dd-wrapper">
                <button type="button" class="svc-staff-dd-trigger" id="edit-svc-staff-dd-trigger">
                  <div class="svc-staff-dd-label">
                    <span>👥</span>
                    <span id="edit-svc-staff-dd-label-text">${initialStaffLabel}</span>
                  </div>
                  <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="svc-staff-dd-badge" id="edit-svc-staff-dd-badge">${initialAssignedCount}/${activeStaff.length}</span>
                    <span class="svc-staff-dd-chevron" id="edit-svc-staff-dd-chevron">▼</span>
                  </div>
                </button>

                <div class="svc-staff-dd-menu" id="edit-svc-staff-dd-menu">
                  <div class="svc-staff-dd-toolbar">
                    <div class="svc-staff-dd-search-wrap">
                      <span class="svc-staff-dd-search-icon">🔍</span>
                      <input type="text" class="svc-staff-dd-search" id="edit-svc-staff-search" placeholder="Search stylist name..." autocomplete="off" />
                    </div>
                    <div class="svc-staff-dd-actions-row">
                      <span class="svc-staff-dd-count-text" id="edit-svc-staff-dd-count-text">
                        ${initialAssignedCount} of ${activeStaff.length} selected
                      </span>
                      <div class="svc-staff-dd-actions">
                        <button type="button" class="svc-staff-dd-action-btn" id="edit-svc-staff-select-all">Select All</button>
                        <button type="button" class="svc-staff-dd-action-btn" id="edit-svc-staff-clear-all">Clear All</button>
                      </div>
                    </div>
                  </div>

                  <div class="svc-staff-dd-list" id="edit-svc-staff-dd-list">
                    ${activeStaff.length === 0 ? `
                      <div style="font-size: 0.8rem; color: var(--text-muted); padding: 12px; text-align: center;">No active stylists in salon yet.</div>
                    ` : activeStaff.map((st) => {
                      const isAssigned = (service.stylists || []).some((s) => String(s.stylistId || s.stylist?.id || s.id) === String(st.id));
                      const initials = st.name.split(' ').map((n) => n[0]).join('').substring(0, 2).toUpperCase();
                      return `
                        <div class="svc-staff-dd-item ${isAssigned ? 'selected' : ''}" data-id="${st.id}" data-name="${st.name.toLowerCase()}">
                          <input type="checkbox" class="edit-svc-staff-assign-chk" value="${st.id}" ${isAssigned ? 'checked' : ''} style="display: none;" />
                          <div class="svc-staff-dd-checkbox">✓</div>
                          <span class="svc-staff-avatar">${initials}</span>
                          <span class="svc-staff-name" title="${st.name}">${st.name}</span>
                        </div>
                      `;
                    }).join('')}
                  </div>

                  <div class="svc-staff-dd-footer">
                    <span style="font-size: 0.74rem; color: var(--text-muted);">Click to toggle selection</span>
                    <button type="button" class="svc-staff-dd-footer-btn" id="edit-svc-staff-dd-done-btn">Done ✓</button>
                  </div>
                </div>
              </div>
            </div>

            <!-- 6. Service Description (Clean & Simple) -->
            <div class="form-group">
              <label style="font-size: 0.85rem; font-weight: 600; color: #fff; margin-bottom: 6px; display: block;">
                Description <span style="font-weight: normal; color: var(--text-muted); font-size: 0.78rem;">(Optional)</span>
              </label>
              <input type="text" class="form-control" id="edit-svc-desc" value="${service.description || ''}" placeholder="Brief details about what is included in this service..." style="height: 40px; font-size: 0.88rem;" />
            </div>

            <button type="submit" class="btn btn-primary" id="btn-submit-edit-svc" style="width: 100%; height: 42px; font-weight: 700; font-size: 0.9rem; margin-top: 4px;">
              Save Changes to Menu →
            </button>
          </form>
        </div>
      </div>
    `;

    document.getElementById('btn-close-modal')?.addEventListener('click', () => (modalContainer.innerHTML = ''));

    const categorySelect = document.getElementById('edit-svc-category-select');
    const customCatGroup = document.getElementById('edit-svc-custom-cat-group');
    const customCatInput = document.getElementById('edit-svc-custom-cat-input');
    const durationSelect = document.getElementById('edit-svc-duration');
    const genderInput = document.getElementById('edit-svc-gender');

    // Audience toggle buttons
    document.querySelectorAll('.edit-svc-aud-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.edit-svc-aud-btn').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        if (genderInput) genderInput.value = btn.getAttribute('data-val');
      });
    });

    // Multi-Select Stylist Dropdown Interactions (Edit Modal)
    const editDdWrapper = document.getElementById('edit-svc-staff-dd-wrapper');
    const editDdTrigger = document.getElementById('edit-svc-staff-dd-trigger');
    const editDdMenu = document.getElementById('edit-svc-staff-dd-menu');
    const editDdChevron = document.getElementById('edit-svc-staff-dd-chevron');
    const editDdSearch = document.getElementById('edit-svc-staff-search');
    const editDdLabelText = document.getElementById('edit-svc-staff-dd-label-text');
    const editDdBadge = document.getElementById('edit-svc-staff-dd-badge');
    const editDdHint = document.getElementById('edit-svc-staff-hint');
    const editDdFooterCount = document.getElementById('edit-svc-staff-dd-footer-count');
    const editDdDoneBtn = document.getElementById('edit-svc-staff-dd-done-btn');
    const editDdSelectAll = document.getElementById('edit-svc-staff-select-all');
    const editDdClearAll = document.getElementById('edit-svc-staff-clear-all');

    const updateEditStaffDropdownState = () => {
      const items = Array.from(document.querySelectorAll('#edit-svc-staff-dd-list .svc-staff-dd-item'));
      const total = items.length;
      if (total === 0) return;
      const checkedItems = items.filter((it) => {
        const chk = it.querySelector('.edit-svc-staff-assign-chk');
        return chk && chk.checked;
      });
      const checkedCount = checkedItems.length;

      if (editDdBadge) editDdBadge.textContent = `${checkedCount}/${total}`;
      const editCountText = document.getElementById('edit-svc-staff-dd-count-text');
      if (editCountText) editCountText.textContent = `${checkedCount} of ${total} selected`;

      if (checkedCount === total) {
        if (editDdLabelText) editDdLabelText.textContent = `All Stylists Assigned (${total})`;
        if (editDdHint) editDdHint.textContent = `All ${total} Stylists Assigned`;
      } else if (checkedCount === 0) {
        if (editDdLabelText) editDdLabelText.textContent = `No Stylists Assigned`;
        if (editDdHint) editDdHint.textContent = `0 Selected`;
      } else if (checkedCount === 1) {
        const name = checkedItems[0].querySelector('.svc-staff-name')?.textContent || '1 Stylist';
        if (editDdLabelText) editDdLabelText.textContent = name;
        if (editDdHint) editDdHint.textContent = `1 of ${total} Selected`;
      } else if (checkedCount === 2) {
        const names = checkedItems.map((it) => it.querySelector('.svc-staff-name')?.textContent || '').filter(Boolean).join(', ');
        if (editDdLabelText) editDdLabelText.textContent = names;
        if (editDdHint) editDdHint.textContent = `2 of ${total} Selected`;
      } else {
        if (editDdLabelText) editDdLabelText.textContent = `${checkedCount} Stylists Assigned`;
        if (editDdHint) editDdHint.textContent = `${checkedCount} of ${total} Selected`;
      }
    };

    const toggleEditDdMenu = (forceOpen) => {
      if (!editDdMenu) return;
      const isOpen = forceOpen !== undefined ? forceOpen : !editDdMenu.classList.contains('open');
      editDdMenu.classList.toggle('open', isOpen);
      editDdTrigger?.classList.toggle('active', isOpen);
      editDdChevron?.classList.toggle('open', isOpen);
      if (isOpen && editDdSearch) {
        editDdSearch.value = '';
        editDdSearch.focus({ preventScroll: true });
        document.querySelectorAll('#edit-svc-staff-dd-list .svc-staff-dd-item').forEach((it) => (it.style.display = 'flex'));
      }
    };

    editDdTrigger?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleEditDdMenu();
    });

    editDdDoneBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleEditDdMenu(false);
    });

    editDdSearch?.addEventListener('input', (e) => {
      const q = (e.target.value || '').toLowerCase().trim();
      document.querySelectorAll('#edit-svc-staff-dd-list .svc-staff-dd-item').forEach((it) => {
        const name = (it.getAttribute('data-name') || '').toLowerCase();
        it.style.display = name.includes(q) ? 'flex' : 'none';
      });
    });

    editDdSearch?.addEventListener('click', (e) => e.stopPropagation());

    document.querySelectorAll('#edit-svc-staff-dd-list .svc-staff-dd-item').forEach((item) => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const chk = item.querySelector('.edit-svc-staff-assign-chk');
        if (!chk) return;
        chk.checked = !chk.checked;
        item.classList.toggle('selected', chk.checked);
        updateEditStaffDropdownState();
      });
    });

    editDdSelectAll?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('#edit-svc-staff-dd-list .svc-staff-dd-item').forEach((it) => {
        const chk = it.querySelector('.edit-svc-staff-assign-chk');
        if (chk) chk.checked = true;
        it.classList.add('selected');
      });
      updateEditStaffDropdownState();
    });

    editDdClearAll?.addEventListener('click', (e) => {
      e.stopPropagation();
      document.querySelectorAll('#edit-svc-staff-dd-list .svc-staff-dd-item').forEach((it) => {
        const chk = it.querySelector('.edit-svc-staff-assign-chk');
        if (chk) chk.checked = false;
        it.classList.remove('selected');
      });
      updateEditStaffDropdownState();
    });

    const onEditModalClickOutside = (e) => {
      if (editDdWrapper && !editDdWrapper.contains(e.target)) {
        toggleEditDdMenu(false);
      }
    };
    document.addEventListener('click', onEditModalClickOutside);

    // Inline category toggle & creation
    const inlineBox = document.getElementById('edit-svc-inline-cat-box');
    document.getElementById('edit-btn-toggle-inline-cat')?.addEventListener('click', () => {
      inlineBox.style.display = inlineBox.style.display === 'none' ? 'block' : 'none';
      if (inlineBox.style.display === 'block') {
        document.getElementById('edit-inline-cat-name')?.focus();
      }
    });

    document.getElementById('edit-btn-close-inline-cat')?.addEventListener('click', () => {
      inlineBox.style.display = 'none';
    });

    document.getElementById('edit-btn-save-inline-cat')?.addEventListener('click', async () => {
      const catName = document.getElementById('edit-inline-cat-name')?.value.trim();
      const catIcon = document.getElementById('edit-inline-cat-icon')?.value.trim() || '✂️';
      if (!catName) return;

      try {
        const newCat = await ApiClient.createServiceCategory({ name: catName, icon: catIcon });
        this.categoriesList = await ApiClient.getServiceCategories(true).catch(() => [
          ...(this.categoriesList || []),
          newCat || { id: `cat-${Date.now()}`, name: catName, icon: catIcon },
        ]);
        categorySelect.innerHTML = renderCatOptions(catName);
        categorySelect.value = catName;
        if (editCatSelectedIcon) editCatSelectedIcon.textContent = catIcon;
        if (editCatSelectedName) editCatSelectedName.textContent = catName;

        if (editCatMenu) {
          editCatMenu.innerHTML = `
            ${this.categoriesList.map((c) => `
              <div class="custom-select-option ${c.name === catName ? 'selected' : ''}" data-value="${c.name}" data-icon="${c.icon || '✂️'}" data-id="${c.id || ''}">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span>${c.icon || '✂️'}</span>
                  <span>${c.name}</span>
                </div>
                ${c.name === catName ? '<span class="custom-select-opt-check">✓</span>' : ''}
              </div>
            `).join('')}
            <div class="custom-select-option" data-value="CUSTOM" data-icon="➕" data-id="" style="border-top: 1px solid rgba(255,255,255,0.08); margin-top: 4px; padding-top: 8px; color: #c084fc;">
              <div style="display: flex; align-items: center; gap: 8px;">
                <span>➕</span>
                <span>Other / Custom Category...</span>
              </div>
            </div>
          `;
          bindEditCatOptions();
        }

        inlineBox.style.display = 'none';
        document.getElementById('edit-inline-cat-name').value = '';
        this.showToast(`Category "${catName}" added!`, 'success');
      } catch (err) {
        this.showToast(err.message || 'Failed to create category', 'error');
      }
    });

    // Custom Category Dropdown Interactions (Edit Modal)
    const editCatContainer = document.getElementById('edit-svc-cat-custom-container');
    const editCatTrigger = document.getElementById('edit-svc-cat-custom-trigger');
    const editCatMenu = document.getElementById('edit-svc-cat-custom-menu');
    const editCatChevron = document.getElementById('edit-svc-cat-custom-chevron');
    const editCatSelectedIcon = document.getElementById('edit-svc-cat-selected-icon');
    const editCatSelectedName = document.getElementById('edit-svc-cat-selected-name');

    const toggleEditCatMenu = (forceOpen) => {
      if (!editCatMenu) return;
      const isOpen = forceOpen !== undefined ? forceOpen : !editCatMenu.classList.contains('open');
      editCatMenu.classList.toggle('open', isOpen);
      editCatTrigger?.classList.toggle('active', isOpen);
      editCatChevron?.classList.toggle('open', isOpen);
    };

    editCatTrigger?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleEditDdMenu?.(false);
      toggleEditDurMenu?.(false);
      toggleEditCatMenu();
    });

    const bindEditCatOptions = () => {
      editCatMenu?.querySelectorAll('.custom-select-option').forEach((opt) => {
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          const val = opt.getAttribute('data-value');
          const icon = opt.getAttribute('data-icon') || '✂️';
          const name = opt.querySelector('span:nth-child(2)')?.textContent || val;

          if (categorySelect) {
            categorySelect.value = val;
            categorySelect.dispatchEvent(new Event('change'));
          }

          if (editCatSelectedIcon) editCatSelectedIcon.textContent = icon;
          if (editCatSelectedName) editCatSelectedName.textContent = val === 'CUSTOM' ? 'Custom Category' : name;

          editCatMenu.querySelectorAll('.custom-select-option').forEach((o) => {
            o.classList.toggle('selected', o === opt);
            const check = o.querySelector('.custom-select-opt-check');
            if (check) check.remove();
            if (o === opt) {
              const checkSpan = document.createElement('span');
              checkSpan.className = 'custom-select-opt-check';
              checkSpan.textContent = '✓';
              o.appendChild(checkSpan);
            }
          });

          toggleEditCatMenu(false);
        });
      });
    };
    bindEditCatOptions();

    // Custom Duration Dropdown Interactions (Edit Modal)
    const editDurContainer = document.getElementById('edit-svc-dur-custom-container');
    const editDurTrigger = document.getElementById('edit-svc-dur-custom-trigger');
    const editDurMenu = document.getElementById('edit-svc-dur-custom-menu');
    const editDurChevron = document.getElementById('edit-svc-dur-custom-chevron');
    const editDurLabel = document.getElementById('edit-svc-dur-selected-label');
    const editDurSelect = document.getElementById('edit-svc-duration');

    const toggleEditDurMenu = (forceOpen) => {
      if (!editDurMenu) return;
      const isOpen = forceOpen !== undefined ? forceOpen : !editDurMenu.classList.contains('open');
      editDurMenu.classList.toggle('open', isOpen);
      editDurTrigger?.classList.toggle('active', isOpen);
      editDurChevron?.classList.toggle('open', isOpen);
    };

    editDurTrigger?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleEditDdMenu?.(false);
      toggleEditCatMenu?.(false);
      toggleEditDurMenu();
    });

    editDurMenu?.querySelectorAll('.custom-select-option').forEach((opt) => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = opt.getAttribute('data-value');
        const text = opt.querySelector('span')?.textContent || `${val} mins`;
        if (editDurSelect) editDurSelect.value = val;
        if (editDurLabel) editDurLabel.textContent = text;

        editDurMenu.querySelectorAll('.custom-select-option').forEach((o) => {
          o.classList.toggle('selected', o === opt);
          const check = o.querySelector('.custom-select-opt-check');
          if (check) check.remove();
          if (o === opt) {
            const checkSpan = document.createElement('span');
            checkSpan.className = 'custom-select-opt-check';
            checkSpan.textContent = '✓';
            o.appendChild(checkSpan);
          }
        });
        toggleEditDurMenu(false);
      });
    });

    document.addEventListener('click', (e) => {
      if (editCatContainer && !editCatContainer.contains(e.target)) toggleEditCatMenu(false);
      if (editDurContainer && !editDurContainer.contains(e.target)) toggleEditDurMenu(false);
    });

    categorySelect?.addEventListener('change', (e) => {
      if (e.target.value === 'CUSTOM') {
        customCatGroup.style.display = 'block';
      } else {
        customCatGroup.style.display = 'none';
      }
    });

    document.getElementById('edit-service-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('btn-submit-edit-svc') || e.target.querySelector('button[type="submit"]');
      if (submitBtn) {
        if (submitBtn.disabled) return;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Saving changes...';
      }

      const rawCat = categorySelect.value;
      const finalCategory = rawCat === 'CUSTOM' ? (customCatInput.value.trim() || 'General') : rawCat;
      const dur = parseInt(document.getElementById('edit-svc-duration').value, 10);
      if (isNaN(dur) || dur < 30 || dur % 15 !== 0) {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = 'Save Changes to Menu →';
        }
        alert('Service duration must be at least 30 minutes and a multiple of 15 (e.g. 30, 45, 60, 75, 90 mins).');
        return;
      }

      const selectedStylistIds = Array.from(document.querySelectorAll('.edit-svc-staff-assign-chk:checked')).map((c) => c.value);

      const payload = {
        name: document.getElementById('edit-svc-name').value.trim(),
        price: parseFloat(document.getElementById('edit-svc-price').value),
        durationMinutes: dur,
        category: finalCategory,
        targetGender: genderInput?.value || 'UNISEX',
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
        this.showToast(`Service "${payload.name}" updated!`, 'success');
        this.render();
        SalonRepository.invalidate('services');
      } catch (err) {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = 'Save Changes to Menu →';
        }
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
      const submitBtn = e.target.querySelector('button[type="submit"]');
      if (submitBtn) {
        if (submitBtn.disabled) return;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Saving...';
      }

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
        this.showToast('Stylist details saved!', 'success');
        this.render();
        SalonRepository.invalidate('staff');
      } catch (err) {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = 'Save Stylist Details →';
        }
        alert(`Failed: ${err.message}`);
      }
    });
  }

  showDeleteStaffModal(staffId, staffName) {
    const modalContainer = document.getElementById('modal-container');
    if (!modalContainer) return;

    const targetStaff = (this.staffList || []).find((s) => String(s.id) === String(staffId)) || { name: staffName };
    const initials = (targetStaff.name || staffName || 'ST')
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

    const servicesCount = (targetStaff.services || []).length;
    
    // Check if stylist has active / waiting queue appointments today
    const queueItems = this.queueSync?.items || this.summaryData?.todayAppointments || [];
    const activeAppts = queueItems.filter((a) => {
      const aStaffId = a.stylistId || a.stylist?.id;
      const status = (a.status || '').toUpperCase();
      return String(aStaffId) === String(staffId) && !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(status);
    });
    const hasActiveAppts = activeAppts.length > 0;

    modalContainer.innerHTML = `
      <div class="modal-backdrop show" id="delete-staff-backdrop">
        <div class="modal-content modal-content-sheet" style="max-width: 440px; background: linear-gradient(160deg, #171b2d 0%, #0e1220 100%); border: 1px solid rgba(239, 68, 68, 0.3); box-shadow: 0 24px 60px rgba(0,0,0,0.7), 0 0 30px rgba(239,68,68,0.15); border-radius: 16px; padding: 22px 24px;">
          
          <!-- Header: Danger Icon + Title -->
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
            <div style="width: 44px; height: 44px; border-radius: 12px; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.35); display: flex; align-items: center; justify-content: center; color: #ef4444; flex-shrink: 0;">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                <line x1="10" y1="11" x2="10" y2="17"></line>
                <line x1="14" y1="11" x2="14" y2="17"></line>
              </svg>
            </div>
            <div>
              <h3 style="font-size: 1.12rem; font-weight: 800; color: #ffffff; margin: 0; line-height: 1.2;">Delete Stylist</h3>
              <p style="color: #94a3b8; font-size: 0.76rem; margin: 3px 0 0 0;">This action permanently removes the stylist record</p>
            </div>
          </div>

          <!-- Stylist Profile Snapshot Card -->
          <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 10px; padding: 12px 14px; margin-bottom: 16px; display: flex; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="width: 36px; height: 36px; border-radius: 9px; background: linear-gradient(135deg, #a855f7 0%, #6366f1 100%); color: #fff; font-weight: 700; font-size: 0.85rem; display: flex; align-items: center; justify-content: center;">
                ${initials}
              </div>
              <div>
                <div style="font-weight: 700; color: #ffffff; font-size: 0.88rem;">${targetStaff.name || staffName}</div>
                <div style="color: #94a3b8; font-size: 0.74rem;">${targetStaff.role || 'Hair & Beard Specialist'}</div>
              </div>
            </div>
            <span style="font-size: 0.72rem; padding: 3px 8px; border-radius: 6px; background: rgba(168, 85, 247, 0.15); border: 1px solid rgba(168, 85, 247, 0.3); color: #d8b4fe; font-weight: 600;">
              ${servicesCount} Services
            </span>
          </div>

          ${hasActiveAppts ? `
            <!-- Active Bookings Warning Alert -->
            <div style="background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: 10px; padding: 10px 12px; margin-bottom: 16px; display: flex; gap: 9px; align-items: flex-start;">
              <span style="font-size: 1.1rem; line-height: 1;">⚠️</span>
              <div style="font-size: 0.76rem; color: #fca5a5; line-height: 1.4;">
                <strong>Active Appointments:</strong> This stylist currently has <strong>${activeAppts.length} active/pending client(s)</strong> in today's queue. Deleting will cancel or unassign these appointments.
              </div>
            </div>
          ` : `
            <p style="color: #94a3b8; font-size: 0.82rem; line-height: 1.45; margin: 0 0 18px 0;">
              Are you sure you want to permanently delete <strong style="color: #ffffff;">${targetStaff.name || staffName}</strong>? All their routine break schedules, working hours, and service qualifications will be permanently deleted.
            </p>
          `}

          <!-- Actions: Cancel vs Confirm Delete -->
          <div style="display: flex; gap: 10px; align-items: center;">
            <button type="button" class="btn btn-secondary" style="flex: 1; padding: 9px 14px; font-size: 0.84rem; font-weight: 600;" id="btn-cancel-delete-staff">
              Cancel
            </button>
            <button type="button" class="btn btn-primary" style="flex: 1.2; padding: 9px 14px; font-size: 0.84rem; font-weight: 700; background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); border-color: #ef4444; box-shadow: 0 4px 14px rgba(239, 68, 68, 0.35);" id="btn-confirm-delete-staff">
              Yes, Delete Stylist
            </button>
          </div>

        </div>
      </div>
    `;

    const closeModal = () => {
      modalContainer.innerHTML = '';
      document.removeEventListener('keydown', handleEsc);
    };

    const handleEsc = (e) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', handleEsc);

    document.getElementById('btn-cancel-delete-staff')?.addEventListener('click', closeModal);
    document.getElementById('delete-staff-backdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'delete-staff-backdrop') closeModal();
    });

    document.getElementById('btn-confirm-delete-staff')?.addEventListener('click', async (e) => {
      const confirmBtn = e.currentTarget;
      const originalStaffList = [...this.staffList];
      
      // Loading state on button
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = `
        <span style="display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite; margin-right: 6px; vertical-align: middle;"></span>
        Deleting...
      `;

      // Mark local action timestamp to suppress SSE self-echo notification
      this.lastLocalActionTimestamp = Date.now();
      window.lastDashboardActionTimestamp = Date.now();

      // 1. Optimistic removal from in-memory state
      this.staffList = this.staffList.filter((s) => String(s.id) !== String(staffId));
      if (this.staffManager) {
        this.staffManager.staffList = this.staffList;
      }
      closeModal();
      this.render();

      try {
        await ApiClient.deleteStaff(staffId);
        this.lastLocalActionTimestamp = Date.now();
        window.lastDashboardActionTimestamp = Date.now();
        this.showToast(`Stylist "${targetStaff?.name || staffName}" deleted successfully`, 'success');
        
        // Invalidate both staff & services caches so counts update across tabs
        SalonRepository.invalidate('staff');
        SalonRepository.invalidate('services');
        
        // Re-fetch fresh staff & services silently
        ApiClient.getStaff(true).catch(() => {});
        ApiClient.getServices(true).then((fresh) => {
          if (Array.isArray(fresh)) this.servicesList = fresh;
        }).catch(() => {});
      } catch (err) {
        // Rollback state on error
        this.staffList = originalStaffList;
        if (this.staffManager) {
          this.staffManager.staffList = originalStaffList;
        }
        this.render();
        this.showToast(err.message || 'Failed to delete stylist. Please try again.', 'error');
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
    if (serviceId && String(serviceId).startsWith('temp-')) {
      this.showToast('Please wait a moment while this service finishes saving to the cloud...', 'info');
      return;
    }
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

    document.getElementById('btn-confirm-delete-svc')?.addEventListener('click', async (e) => {
      const confirmBtn = e.currentTarget;
      if (confirmBtn.disabled) return;
      confirmBtn.disabled = true;

      // 1. Snapshot previous state for rollback safety
      const previousServices = [...(this.servicesList || [])];

      // 2. Optimistic Update (Frame 1: 0ms delay)
      this.servicesList = this.servicesList.filter((s) => s.id !== serviceId);
      modalContainer.innerHTML = '';
      this.render();
      this.showToast('Service deleted.', 'info');

      try {
        // 3. Background Sync (Zero re-fetch!)
        this.lastLocalActionTimestamp = Date.now();
        await ApiClient.deleteService(serviceId);
        SalonRepository.invalidate('services');
      } catch (err) {
        // 4. Safe Rollback on rejection (e.g. active bookings guard)
        this.servicesList = previousServices;
        this.render();
        alert(`Failed to delete service: ${err.message}`);
      }
    });
  }

  showQRCodeModal() {
    BookingQrView.showQuickQrModal(this);
  }

  showStandeePrintModal() {
    BookingQrView.showStandeeModal(this);
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


