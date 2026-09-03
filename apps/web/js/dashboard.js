import { ApiClient, formatTime12h } from './api.js';
import { RealtimeNotifier } from './realtime.js';
import { SoundManager } from './sound.js';
import { Icons } from './icons.js';

export const SERVICE_CATALOG_PRESETS = [
  {
    category: 'Hair Care & Styling',
    icon: '✂️',
    presets: [
      { name: 'Standard Haircut', price: 100, duration: 20, desc: 'Classic precision haircut, scissor styling, and neck clean-up.' },
      { name: 'Fade & Modern Textured Haircut', price: 150, duration: 30, desc: 'Skin fade, low/mid fade with matte textured top styling.' },
      { name: 'Kids Haircut (बच्चों की कटिंग)', price: 80, duration: 20, desc: 'Gentle and stylish haircut for kids under 12.' },
      { name: 'Hair Wash & Blowdry Styling', price: 120, duration: 15, desc: 'Deep scalp cleanse, conditioning, and blowdry finish.' },
    ],
  },
  {
    category: 'Beard & Shaving',
    icon: '🧔',
    presets: [
      { name: 'Clean Razor Shave (शेविंग)', price: 60, duration: 15, desc: 'Hot towel prep, smooth foam razor shave, and aftershave splash.' },
      { name: 'Beard Trim & Precision Line-up', price: 80, duration: 15, desc: 'Beard reshaping, trimmer fade, and sharp cheek/jaw line-up.' },
      { name: 'Luxury Beard Spa & Hot Oil', price: 180, duration: 30, desc: 'Steam, beard softening oil massage, shaping, and balm conditioning.' },
    ],
  },
  {
    category: 'Combos & Packages',
    icon: '🔥',
    presets: [
      { name: 'Haircut + Beard Styling Combo', price: 180, duration: 35, desc: 'Complete head and beard grooming package at a discounted combo rate.' },
      { name: 'Grooming Royale: Hair + Beard + Champy', price: 280, duration: 50, desc: 'Signature package: custom haircut, beard styling, and relaxing oil champy.' },
      { name: 'Haircut + D-Tan Face Pack', price: 320, duration: 45, desc: 'Hair styling combined with deep tanning removal face pack.' },
      { name: 'Shave + Charcoal Face Mask', price: 220, duration: 30, desc: 'Clean razor shave with deep pore blackhead purifying mask.' },
    ],
  },
  {
    category: 'Head Massage & Champy',
    icon: '💆',
    presets: [
      { name: 'Herbal Oil Head Massage (Champy)', price: 100, duration: 20, desc: 'Traditional cooling herbal oil acupressure scalp massage.' },
      { name: 'Menthol Ice Cool Scalp Massage', price: 150, duration: 20, desc: 'Refreshing menthol ice cream/oil stress-relief massage.' },
    ],
  },
  {
    category: 'Facial, Bleach & D-Tan',
    icon: '✨',
    presets: [
      { name: 'Instant D-Tan Face Pack', price: 200, duration: 20, desc: 'Removes sun tan, cleans pores, and restores natural skin radiance.' },
      { name: 'Charcoal Deep Cleanse Detox', price: 250, duration: 30, desc: 'Blackhead extraction, charcoal mask, and cold towel finish.' },
      { name: 'Fruit Glow / Gold Facial', price: 600, duration: 45, desc: '5-step salon facial with exfoliation, cream massage, and glow mask.' },
    ],
  },
  {
    category: 'Hair Color & Highlights',
    icon: '🎨',
    presets: [
      { name: 'Black Hair Color / Dye Application', price: 150, duration: 30, desc: 'Ammonia-free rich black gray coverage with scalp wash.' },
      { name: 'Natural Herbal Mehndi / Henna', price: 200, duration: 45, desc: 'Pure organic henna treatment for hair nourishment and rich tint.' },
      { name: 'Global Hair Color & Highlights', price: 1200, duration: 75, desc: 'Premium salon color transformation with fashion shades.' },
    ],
  },
  {
    category: 'Hair Spa & Keratin',
    icon: '🧖',
    presets: [
      { name: 'Deep Nourishing Hair Spa', price: 700, duration: 45, desc: 'Intensive hair mask with steam therapy and scalp relaxation.' },
      { name: 'Keratin / Smoothening Treatment', price: 2500, duration: 120, desc: 'Frizz-free protein smoothing treatment for glossy straight hair.' },
    ],
  },
];

export class SalonDashboard {
  constructor(containerId, currentUser = null) {
    this.container = document.getElementById(containerId);
    this.currentUser = currentUser;
    this.activeTab = 'dashboard';
    this.selectedDate = this.getLocalDateString();
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
    this.salonProfile = {};
    this.searchQuery = '';
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

  async init() {
    this.renderLoading();
    try {
      await this.loadData();
      this.render();

      // Connect to Real-time Event Stream for live sync & audio chimes
      if (this.salonProfile?.id) {
        this.realtime = new RealtimeNotifier(this.salonProfile.id, async () => {
          // OPTIMIZED: Targeted tab-only re-render (no full DOM teardown)
          await this.loadData();
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
      document.getElementById('btn-goto-login')?.addEventListener('click', () => {
        ApiClient.removeToken();
        window.location.hash = '#login';
      });
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

  async loadData(fullReload = false) {
    const fallbackSummary = {
      statusCounts: { total: 0, confirmed: 0, checkedIn: 0, inService: 0, completed: 0, cancelled: 0, noShow: 0 },
      todayAppointments: [],
      todayRevenue: 0,
      timezone: 'Asia/Kolkata',
      whatsappQuota: { limit: 1000, used: 0, remaining: 1000, percentUsed: 0, resetsOn: '1st of next month' },
    };

    if (fullReload || !this.staffList || this.staffList.length === 0 || !this.servicesList || this.servicesList.length === 0) {
      try {
        const [summary, staff, services, profile] = await Promise.all([
          ApiClient.getDashboardSummary(this.selectedDate, fullReload).catch((err) => {
            console.warn('[Dashboard] Summary fetch error:', err);
            return this.summaryData || fallbackSummary;
          }),
          ApiClient.getStaff(fullReload).catch((err) => {
            console.warn('[Dashboard] Staff fetch error:', err);
            return this.staffList || [];
          }),
          ApiClient.getServices(fullReload).catch((err) => {
            console.warn('[Dashboard] Services fetch error:', err);
            return this.servicesList || [];
          }),
          ApiClient.getSalonProfile(fullReload).catch((err) => {
            console.warn('[Dashboard] Profile fetch error:', err);
            return this.salonProfile || {};
          }),
        ]);

        this.summaryData = summary || fallbackSummary;
        this.staffList = Array.isArray(staff) ? staff : [];
        this.servicesList = Array.isArray(services) ? services : [];
        this.salonProfile = profile || {};
      } catch (err) {
        console.warn('[Dashboard] loadData batch error:', err);
      }
    } else {
      try {
        const summary = await ApiClient.getDashboardSummary(this.selectedDate);
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


  render() {
    const salonName = this.salonProfile?.name || 'Salon Operations';
    const salonSlug = this.salonProfile?.slug || 'salon';
    const webBookingUrl = `${window.location.origin}/#book/${salonSlug}`;
    const isDeactivated = this.salonProfile?.status === 'DEACTIVATED' || this.staffList.length === 0 || this.servicesList.length === 0;

    this.container.innerHTML = `
      <!-- Dedicated Modern Luxury Header Bar -->
      <header class="portal-header">
        <div class="portal-header-content">
          <div class="header-brand-group">
            <div class="brand-icon-box">
              ${Icons.scissors({ size: 20, color: '#c7d2fe' })}
              <span class="brand-live-indicator ${isDeactivated ? 'offline' : 'live'}" title="${isDeactivated ? 'Offline' : 'Real-Time Connected'}"></span>
            </div>
            <div class="header-title-block">
              <div class="header-title-row">
                <span class="header-salon-name">${salonName}</span>
                <span class="q-live-pill desktop-only-badge" style="padding: 2px 7px;">
                  <span class="q-live-dot"></span>
                  <span class="q-live-label" style="font-size: 0.62rem;">${isDeactivated ? 'OFFLINE' : 'LIVE'}</span>
                </span>
              </div>
              <div class="header-meta-row">
                <span>${this.salonProfile?.city || 'India'}</span>
                <span>•</span>
                <span>${this.summaryData.timezone}</span>
              </div>
            </div>
          </div>
          <div class="header-actions-group">
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
            <span>Stylists (${this.staffList.length})</span>
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
    const statusCounts = summary.statusCounts || { total: 0, confirmed: 0, checkedIn: 0, inService: 0, completed: 0, cancelled: 0, noShow: 0 };
    const todayRevenue = summary.todayRevenue || 0;
    const todayAppointments = summary.todayAppointments || [];
    const profile = this.salonProfile || {};

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
              <span class="telemetry-chip-val" style="color: #fbbf24;">${statusCounts.checkedIn}</span>
              <span class="telemetry-chip-lbl">Waiting</span>
            </div>
            <div class="telemetry-chip">
              <span class="telemetry-chip-val" style="color: #c084fc;">${statusCounts.inService}</span>
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
                  const inService = todayAppts.find((a) => a.status === 'IN_SERVICE');
                  const isOccupied = !!inService;
                  return `
                    <div class="station-card ${isOccupied ? 'occupied' : 'ready'}">
                      <div class="station-num-badge">#${idx + 1}</div>
                      <div style="flex: 1; min-width: 0;">
                        <div style="font-weight: 700; font-size: 0.85rem; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                          ${st.name}
                        </div>
                        <div style="font-size: 0.72rem; color: ${isOccupied ? '#c084fc' : '#34d399'}; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                          ${isOccupied ? `In Chair: ${inService.customer?.name || 'Client'}` : '🟢 Ready for Walk-In'}
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
            <span>Confirmed: <strong style="color: #fff;">${statusCounts.confirmed}</strong></span>
            <span>•</span>
            <span>Waiting: <strong style="color: #fbbf24;">${statusCounts.checkedIn}</strong></span>
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
          <div class="stat-value" style="color: #c084fc;">${statusCounts.inService}</div>
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
              <span>Stylist Floor Status (${this.staffList.length} Active)</span>
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
            return `
              <div class="staff-card" style="display: flex; align-items: center; gap: 14px; padding: 16px;">
                <div class="staff-avatar" style="width: 44px; height: 44px; font-size: 1.1rem; border-radius: 12px; border: 2px solid ${isBusy ? '#8b5cf6' : '#10b981'}; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.05); font-weight: 800; color: #fff;">
                  ${st.profileImageUrl ? `<img src="${st.profileImageUrl}" alt="${st.name}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 10px;" />` : st.name.charAt(0).toUpperCase()}
                </div>
                <div style="flex: 1;">
                  <div style="font-weight: 700; color: #fff; font-size: 0.95rem;">${st.name}</div>
                  <div style="font-size: 0.78rem; display: flex; align-items: center; gap: 6px; margin-top: 2px; color: ${isBusy ? '#c084fc' : '#34d399'}; font-weight: 600;">
                    <span class="q-live-dot" style="width: 5px; height: 5px; background: ${isBusy ? '#8b5cf6' : '#10b981'}; box-shadow: 0 0 8px ${isBusy ? '#8b5cf6' : '#10b981'};"></span>
                    <span>${isBusy ? 'Serving in Chair' : 'Ready for Walk-in'}</span>
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
    const { statusCounts, todayAppointments } = this.summaryData;

    // Smart Operator Queue Sorting:
    // 1. IN_SERVICE (In Chair right now) -> TOP Priority
    // 2. CHECKED_IN (Waiting in salon) -> 2nd
    // 3. CONFIRMED (Upcoming today) -> Earliest startTime first
    // 4. COMPLETED (Finished) -> Sinks to bottom, most recent first
    // 5. CANCELLED / NO_SHOW -> Bottom
    const getStatusPriority = (status) => {
      switch (status) {
        case 'IN_SERVICE': return 1;
        case 'CHECKED_IN': return 2;
        case 'CONFIRMED': return 3;
        case 'COMPLETED': return 4;
        case 'CANCELLED': return 5;
        case 'NO_SHOW': return 6;
        default: return 7;
      }
    };

    const sortedAppointments = [...todayAppointments].sort((a, b) => {
      const pA = getStatusPriority(a.status);
      const pB = getStatusPriority(b.status);
      if (pA !== pB) return pA - pB;
      if (pA <= 3) {
        return new Date(a.startTime) - new Date(b.startTime);
      } else {
        return new Date(b.startTime) - new Date(a.startTime);
      }
    });

    // Filter appointments based on operator selection
    let filteredAppointments = sortedAppointments;
    if (this.queueFilter === 'WAITING') {
      filteredAppointments = sortedAppointments.filter((a) => ['CONFIRMED', 'CHECKED_IN'].includes(a.status));
    } else if (this.queueFilter === 'IN_CHAIR') {
      filteredAppointments = sortedAppointments.filter((a) => a.status === 'IN_SERVICE');
    } else if (this.queueFilter === 'COMPLETED') {
      filteredAppointments = sortedAppointments.filter((a) => a.status === 'COMPLETED');
    } else if (this.queueFilter === 'CANCELLED') {
      filteredAppointments = sortedAppointments.filter((a) => ['CANCELLED', 'NO_SHOW'].includes(a.status));
    }

    const waitingCount = statusCounts.confirmed + statusCounts.checkedIn;
    const inChairCount = statusCounts.inService;
    const completedCount = statusCounts.completed;
    const cancelledCount = (statusCounts.cancelled || 0) + (statusCounts.noShow || 0);

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
        return `+91 ${clean.slice(3,8)} ${clean.slice(8)}`;
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
      const startDt = new Date(appt.startTime);
      const startTimeStr = formatTime12h(startDt);
      const durationMins = appt.service?.durationMinutes || 30;
      const endDt = appt.endTime ? new Date(appt.endTime) : new Date(startDt.getTime() + durationMins * 60000);
      const endTimeStr = formatTime12h(endDt);
      return { startTimeStr, endTimeStr, timeRangeStr: `${startTimeStr} – ${endTimeStr}`, durationMins };
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
          const timeRange = formatServiceTimeRange(appt);
          const cancelDetails = formatCancellationDetails(appt);
          const cleanPhone = (appt.customer.phone || '').replace(/[^0-9+]/g, '');
          const rawPhoneForWa = cleanPhone.replace('+', '');
          const initials = getInitials(appt.customer.name);
          const avatarCls = getAvatarColor(appt.customer.name);
          const isDone = appt.status === 'COMPLETED';
          const isCancelled = ['CANCELLED', 'NO_SHOW'].includes(appt.status);
          const statusKey = appt.status.toLowerCase();

          const startDt = new Date(appt.startTime);
          const elapsedMins = Math.max(0, Math.floor((Date.now() - startDt.getTime()) / 60000));
          const remainingMins = Math.max(0, (appt.service?.durationMinutes || 30) - elapsedMins);

          return `
            <div class="qc ${isDone ? 'qc--done' : ''} ${isCancelled ? 'qc--cancelled' : ''}">
              <div class="qc__accent qc__accent--${statusKey}" style="background: ${this.getStatusColor(appt.status)};"></div>

              <div class="qc__body">
                <!-- Row 1: Time Window, Origin Telemetry, Status & Price -->
                <div class="qc__row1">
                  <div class="qc__time-block">
                    <div class="qc__time-primary">
                      <span class="qc__time">${timeRange.timeRangeStr}</span>
                      <span class="qc__duration-pill">${timeRange.durationMins}m</span>
                    </div>
                    <div class="qc__booking-meta">
                      ${formatBookingOrigin(appt)}
                    </div>
                  </div>
                  <div class="qc__status-wrap">
                    <span class="qc__status qc__status--${statusKey}">${appt.status.replace('_', ' ')}</span>
                    <span class="qc__price">₹${appt.price}</span>
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
                      <div class="qc__name">${appt.customer.name}</div>
                      <div class="qc__phone">${formatPhone(cleanPhone)}</div>
                      <div class="qc__barber">Specialist: <strong>${appt.staff.name}</strong></div>
                    </div>
                  </div>
                  <div class="qc__contacts">
                    <a href="tel:${cleanPhone}" class="qc__contact-btn qc__contact-btn--call" title="Direct Call">
                      ${Icons.phone({ size: 16 })}
                    </a>
                    <a href="https://wa.me/${rawPhoneForWa}" target="_blank" class="qc__contact-btn qc__contact-btn--wa" title="WhatsApp Message">
                      ${Icons.whatsapp({ size: 16 })}
                    </a>
                  </div>
                </div>

                <!-- Row 3: Service Tag + Live Status Badges -->
                <div class="qc__row3" style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center;">
                  <span class="qc__tag qc__tag--service">
                    ${Icons.scissors({ size: 13, color: '#94a3b8' })}
                    <span>${appt.service.name}</span>
                  </span>
                  ${appt.status === 'IN_SERVICE' ? `
                    <span class="qc__tag qc__tag--inchair">
                      <span class="qc__pulse-dot"></span>
                      <span>In Chair · ~${remainingMins}m left</span>
                    </span>
                  ` : ''}
                  ${appt.clientEtaStatus === 'ON_WAY_10M' || appt.clientEtaStatus === 'ON_WAY_15M' ? `
                    <span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35); font-size: 0.72rem; padding: 4px 8px; border-radius: 6px; font-weight: 700; display: inline-flex; align-items: center; gap: 4px;">
                      ${Icons.clock({ size: 13, color: '#fbbf24' })}
                      <span>Arriving in ~15m</span>
                    </span>
                  ` : ''}
                </div>

                <!-- Row 4: Action Bar -->
                <div class="qc__row4">
                  ${appt.status === 'CONFIRMED' ? `
                    <div class="qc__cta-wrap">
                      <button class="qc__cta qc__cta--checkin btn-status" data-id="${appt.id}" data-status="CHECKED_IN">
                        ${Icons.checkCircle2({ size: 16, color: '#c7d2fe' })}
                        <span>Check In Client</span>
                      </button>
                    </div>
                    <div class="qc__sec-actions">
                      <button class="qc__sec-btn btn-open-reschedule" data-id="${appt.id}" data-service="${appt.service.id}" data-staff="${appt.staff.id}" data-name="${appt.customer.name}" title="Reschedule">
                        ${Icons.calendar({ size: 15 })}
                      </button>
                      <button class="qc__sec-btn qc__sec-btn--danger btn-open-cancel" data-id="${appt.id}" data-name="${appt.customer.name}" title="Cancel">
                        ${Icons.x({ size: 15 })}
                      </button>
                    </div>
                  ` : ''}

                  ${appt.status === 'CHECKED_IN' ? `
                    <div class="qc__cta-wrap">
                      <button class="qc__cta qc__cta--seat btn-status" data-id="${appt.id}" data-status="IN_SERVICE">
                        ${Icons.armchair({ size: 16, color: '#fff' })}
                        <span>Seat in Chair</span>
                      </button>
                    </div>
                    <div class="qc__sec-actions">
                      <button class="qc__sec-btn btn-open-reschedule" data-id="${appt.id}" data-service="${appt.service.id}" data-staff="${appt.staff.id}" data-name="${appt.customer.name}" title="Reschedule">
                        ${Icons.calendar({ size: 15 })}
                      </button>
                      <button class="qc__sec-btn qc__sec-btn--danger btn-open-cancel" data-id="${appt.id}" data-name="${appt.customer.name}" title="Cancel">
                        ${Icons.x({ size: 15 })}
                      </button>
                    </div>
                  ` : ''}

                  ${appt.status === 'IN_SERVICE' ? `
                    <div class="qc__cta-wrap">
                      <button class="qc__cta qc__cta--finish btn-status" data-id="${appt.id}" data-status="COMPLETED">
                        ${Icons.check({ size: 16, color: '#fff' })}
                        <span>Complete & Free Chair</span>
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
  }

  getStatusColor(status) {
    switch (status) {
      case 'CONFIRMED': return '#0ea5e9';
      case 'CHECKED_IN': return '#f59e0b';
      case 'IN_SERVICE': return '#a855f7';
      case 'COMPLETED': return '#10b981';
      case 'CANCELLED': return '#f43f5e';
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

      return `
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
              <button class="btn btn-secondary btn-sm" id="btn-block-time" style="gap: 6px;">
                ${Icons.clock({ size: 14, color: '#fb7185' })}
                <span>Block Barber Time</span>
              </button>
              <button class="btn btn-primary btn-sm" id="btn-add-staff" style="gap: 6px;">
                ${Icons.plus({ size: 14 })}
                <span>Add New Stylist</span>
              </button>
            </div>
          </div>

          ${staff.length === 0 ? `
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
          ` : `
            <div class="staff-capacity-grid">
              ${staff.map((st) => {
                const todayAppts = appts.filter((a) => (a.staff?.id || a.staffId) === st.id);
                const inService = todayAppts.find((a) => a.status === 'IN_SERVICE');
                const confirmedCount = todayAppts.filter((a) => ['CONFIRMED', 'CHECKED_IN', 'IN_SERVICE'].includes(a.status)).length;
                const completedCount = todayAppts.filter((a) => a.status === 'COMPLETED').length;

                let statusDot = 'status-dot-free';
                let statusText = 'Available / Free for Walk-ins';
                if (st.status !== 'ACTIVE') {
                  statusDot = 'status-dot-off';
                  statusText = 'Inactive / Off-Duty';
                } else if (inService) {
                  statusDot = 'status-dot-busy';
                  statusText = `In Chair: ${inService.customer?.name || 'Client'}`;
                }

                return `
                  <div class="staff-card" style="display: flex; flex-direction: column; justify-content: space-between;">
                    <div>
                      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                          <img src="${st.profileImageUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150'}" style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover; border: 2px solid rgba(255,255,255,0.12);" />
                          <div>
                            <div style="font-weight: 700; font-size: 1.05rem; color: #fff;">${st.name || 'Specialist'}</div>
                            <div style="font-size: 0.8rem; color: var(--text-secondary);">${st.phone || 'No phone'}</div>
                          </div>
                        </div>
                        <span class="badge ${st.status === 'ACTIVE' ? 'badge-completed' : 'badge-cancelled'}" style="font-size: 0.65rem;">
                          ${st.status || 'ACTIVE'}
                        </span>
                      </div>

                      <div style="background: rgba(0,0,0,0.3); border-radius: var(--radius-sm); padding: 12px; margin-bottom: 14px;">
                        <div style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; font-weight: 600;">
                          <span class="status-dot ${statusDot}"></span>
                          <span style="color: #fff;">${statusText}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-muted); margin-top: 8px;">
                          <span>Today: <strong>${confirmedCount}</strong> Active • <strong>${completedCount}</strong> Done</span>
                        </div>
                        <div class="progress-bar-bg">
                          <div class="progress-bar-fill" style="width: ${Math.min(todayAppts.length * 20, 100)}%;"></div>
                        </div>
                      </div>

                      <div style="margin-bottom: 14px;">
                        <div style="font-size: 0.72rem; color: var(--text-muted); text-transform: uppercase; margin-bottom: 6px;">Qualified Services (${st.services?.length || 0}):</div>
                        <div style="display: flex; flex-wrap: wrap; gap: 4px;">
                          ${(st.services && st.services.length > 0)
                            ? st.services.map((svc) => `<span class="badge" style="background: rgba(99,102,241,0.15); color: #818cf8; font-size: 0.7rem;">${svc.service?.name || 'Service'}</span>`).join('')
                            : '<span style="font-size: 0.75rem; color: var(--text-muted);">No services assigned</span>'}
                        </div>
                      </div>
                    </div>

                    <div>
                      <!-- Primary Controls -->
                      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 6px;">
                        <button class="btn btn-secondary btn-sm btn-edit-staff" data-id="${st.id}" data-name="${st.name || ''}" data-phone="${st.phone || ''}" data-email="${st.email || ''}" data-img="${st.profileImageUrl || ''}" style="font-size: 0.75rem; gap: 4px;">
                          ${Icons.edit({ size: 13 })}
                          <span>Edit Info</span>
                        </button>
                        <button class="btn btn-secondary btn-sm btn-assign-services" data-id="${st.id}" data-name="${st.name || ''}" style="font-size: 0.75rem; gap: 4px;">
                          ${Icons.scissors({ size: 13 })}
                          <span>Services</span>
                        </button>
                      </div>
                      <!-- Secondary Controls -->
                      <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; border-top: 1px solid var(--border-subtle); padding-top: 10px;">
                        <button class="btn btn-secondary btn-sm btn-edit-hours" data-id="${st.id}" data-name="${st.name || ''}" style="font-size: 0.72rem; gap: 3px;" title="Shift Working Hours">
                          ${Icons.clock({ size: 12 })}
                          <span>Hours</span>
                        </button>
                        <button class="btn btn-secondary btn-sm btn-add-break" data-id="${st.id}" data-name="${st.name || ''}" style="font-size: 0.72rem; gap: 3px;" title="Shift Breaks">
                          ${Icons.coffee({ size: 12 })}
                          <span>Break</span>
                        </button>
                        <button class="btn btn-danger-outline btn-sm btn-delete-staff" data-id="${st.id}" data-name="${st.name || ''}" style="font-size: 0.72rem; gap: 3px;" title="Delete Stylist">
                          ${Icons.trash({ size: 12 })}
                          <span>Delete</span>
                        </button>
                      </div>
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
          <h4>Error loading stylists</h4>
          <p style="color: var(--text-secondary); font-size: 0.85rem; margin-top: 8px;">${err.message}</p>
        </div>
      `;
    }
  }

  // =========================================================================
  // TAB 3: SERVICE MENU CRUD
  // =========================================================================
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
            <button class="btn btn-primary btn-sm" id="btn-add-service" style="gap: 6px;">
              ${Icons.plus({ size: 14 })}
              <span>Add New Service</span>
            </button>
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
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 18px;">
              ${services.map((s) => `
                <div class="staff-card" style="display: flex; flex-direction: column; justify-content: space-between; padding: 20px;">
                  <div>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                      <div style="font-weight: 700; font-size: 1.1rem; color: #fff;">${s.name || 'Service'}</div>
                      <div style="font-weight: 800; color: #fbbf24; font-size: 1.25rem; font-family: var(--font-heading);">₹${s.price || 0}</div>
                    </div>
                    <p style="font-size: 0.84rem; color: var(--text-secondary); margin-bottom: 16px; min-height: 38px; line-height: 1.5;">
                      ${s.description || 'Standard salon treatment service.'}
                    </p>
                    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem; color: var(--text-muted); margin-bottom: 14px;">
                      <span style="display: flex; align-items: center; gap: 5px;">
                        ${Icons.clock({ size: 13, color: '#94a3b8' })}
                        <strong>${s.durationMinutes || 30}</strong> mins
                      </span>
                      <span class="badge badge-confirmed">${s.category || 'General'}</span>
                    </div>
                  </div>
                  <div style="display: flex; gap: 8px; border-top: 1px solid var(--border-subtle); padding-top: 12px;">
                    <button class="btn btn-secondary btn-sm btn-edit-service" data-id="${s.id}" data-name="${s.name || ''}" data-price="${s.price || 0}" data-duration="${s.durationMinutes || 30}" data-category="${s.category || ''}" data-desc="${s.description || ''}" style="flex: 1; gap: 6px;">
                      ${Icons.edit({ size: 13 })}
                      <span>Edit</span>
                    </button>
                    <button class="btn btn-danger-outline btn-sm btn-delete-service" data-id="${s.id}" data-name="${s.name || ''}" style="padding: 6px 12px;" title="Delete Service">
                      ${Icons.trash({ size: 13 })}
                    </button>
                  </div>
                </div>
              `).join('')}
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
  // TAB 4: VIP CLIENT CRM
  // =========================================================================
  renderCustomersTab() {
    return `
      <div class="glass-panel">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px;">
          <div>
            <h3 style="font-size: 1.25rem;">VIP Client CRM & Lifetime Intelligence</h3>
            <p style="color: var(--text-secondary); font-size: 0.85rem;">Client visit records, contact details, and historical revenue contributions.</p>
          </div>
          <input type="text" class="form-control" id="customer-search-input" placeholder="Search by name or phone..." value="${this.searchQuery}" style="max-width: 280px;" />
        </div>

        <div id="customers-table-container">
          <div style="text-align: center; padding: 30px; color: var(--text-muted);">Loading client records...</div>
        </div>
      </div>
    `;
  }

  async loadCustomersTable(searchTerm = '') {
    const tableContainer = document.getElementById('customers-table-container');
    if (!tableContainer) return;

    try {
      const res = await ApiClient.getCustomers(searchTerm);
      const customers = Array.isArray(res) ? res : res.data || [];

      if (customers.length === 0) {
        tableContainer.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-muted);">No client records found matching search.</div>`;
        return;
      }

      tableContainer.innerHTML = `
        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem;">
            <thead>
              <tr style="border-bottom: 1px solid var(--border-subtle); color: var(--text-secondary);">
                <th style="padding: 12px;">CLIENT</th>
                <th style="padding: 12px;">PHONE</th>
                <th style="padding: 12px;">TOTAL VISITS</th>
                <th style="padding: 12px;">LIFETIME SPEND</th>
                <th style="padding: 12px;">LAST VISIT</th>
                <th style="padding: 12px; text-align: right;">ACTION</th>
              </tr>
            </thead>
            <tbody>
              ${customers.map((c) => `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
                  <td style="padding: 12px; font-weight: 700; color: #fff;">${c.name}</td>
                  <td style="padding: 12px; color: var(--text-secondary);">${c.phone}</td>
                  <td style="padding: 12px;"><span class="badge" style="background: rgba(99,102,241,0.15); color: #818cf8;">${c.totalVisits} visits</span></td>
                  <td style="padding: 12px; font-weight: 700; color: #10b981; font-family: var(--font-heading);">₹${Number(c.totalSpend).toLocaleString()}</td>
                  <td style="padding: 12px; color: var(--text-muted);">${c.lastVisitAt ? new Date(c.lastVisitAt).toLocaleDateString() : 'New Client'}</td>
                  <td style="padding: 12px; text-align: right;">
                    <button class="btn btn-secondary btn-sm btn-view-customer-history" data-id="${c.id}" data-name="${c.name}">
                      📜 History
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (err) {
      tableContainer.innerHTML = `<div style="color: var(--danger); padding: 20px;">${err.message}</div>`;
    }
  }

  // =========================================================================
  // TAB 5: PROFILE & SALON HUB
  // =========================================================================
  renderProfileTab() {
    const profile = this.salonProfile || {};
    const staffCount = (this.staffList || []).length;
    const servicesCount = (this.servicesList || []).length;
    const freeChatsLeft = this.summaryData?.whatsappQuota?.remaining !== undefined ? this.summaryData.whatsappQuota.remaining : 1000;
    const slug = profile.slug || 'the-grand-royal-barber-1';
    const bookingUrl = `${window.location.origin}/#book/${slug}`;

    return `
      <!-- Salon Identity HQ Card -->
      <div class="profile-identity-card">
        <div class="profile-identity-header">
          <div class="profile-avatar-box">
            ${Icons.scissors({ size: 30, color: '#c7d2fe' })}
          </div>
          <div style="flex: 1; min-width: 240px;">
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
              <h2 style="font-size: 1.45rem; color: #fff; font-family: var(--font-heading); font-weight: 800; letter-spacing: -0.02em;">
                ${profile.name || 'Salon Command Operations'}
              </h2>
              <span class="badge badge-completed" style="font-size: 0.7rem; letter-spacing: 0.04em;">
                ${profile.status || 'ACTIVE STORE'}
              </span>
            </div>
            <div style="font-size: 0.82rem; color: var(--text-secondary); margin-top: 6px; display: flex; align-items: center; gap: 14px; flex-wrap: wrap;">
              <span style="display: flex; align-items: center; gap: 4px;">
                ${Icons.mapPin({ size: 13, color: '#818cf8' })}
                <span>${profile.address || profile.city || 'Indore, India'}</span>
              </span>
              <span style="display: flex; align-items: center; gap: 4px;">
                ${Icons.phone({ size: 13, color: '#34d399' })}
                <span>${profile.phone || '+91'}</span>
              </span>
              <span style="display: flex; align-items: center; gap: 4px;">
                ${Icons.clock({ size: 13, color: '#fbbf24' })}
                <span>${this.summaryData?.timezone || 'Asia/Kolkata'}</span>
              </span>
            </div>
          </div>
        </div>

        <!-- Direct Customer Booking Link Strip -->
        <div style="margin-top: 20px; padding: 14px 18px; background: rgba(0,0,0,0.35); border-radius: var(--radius-md); border: 1px solid rgba(255,255,255,0.08); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
          <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
            <div style="color: #818cf8; flex-shrink: 0;">${Icons.link({ size: 16 })}</div>
            <div style="font-size: 0.84rem; color: #fff; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${bookingUrl}
            </div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-secondary btn-sm" id="btn-copy-invite" style="gap: 6px; font-size: 0.78rem;">
              ${Icons.copy({ size: 13 })}
              <span>Copy Link</span>
            </button>
            <button class="btn btn-primary btn-sm" id="btn-open-qr" style="gap: 6px; font-size: 0.78rem;">
              ${Icons.qrCode({ size: 13 })}
              <span>QR Poster</span>
            </button>
          </div>
        </div>

        <!-- Business Telemetry -->
        <div class="profile-metrics-strip">
          <div class="profile-metric-pill">
            <div style="font-size: 0.7rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Stylist Staff</div>
            <div style="font-size: 1.3rem; font-weight: 800; color: #fff; font-family: var(--font-heading); margin-top: 2px;">${staffCount} Specialists</div>
          </div>
          <div class="profile-metric-pill">
            <div style="font-size: 0.7rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Service Catalog</div>
            <div style="font-size: 1.3rem; font-weight: 800; color: #fff; font-family: var(--font-heading); margin-top: 2px;">${servicesCount} Offerings</div>
          </div>
          <div class="profile-metric-pill">
            <div style="font-size: 0.7rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Meta Free Quota</div>
            <div style="font-size: 1.3rem; font-weight: 800; color: #34d399; font-family: var(--font-heading); margin-top: 2px;">${freeChatsLeft} Left</div>
          </div>
          <div class="profile-metric-pill">
            <div style="font-size: 0.7rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">Store Status</div>
            <div style="font-size: 1.3rem; font-weight: 800; color: #818cf8; font-family: var(--font-heading); margin-top: 2px;">Live & Online</div>
          </div>
        </div>
      </div>

      <!-- Features Launchpad & Intelligence Suite -->
      <div class="glass-panel">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <div>
            <h3 style="font-size: 1.2rem; font-weight: 800; color: #fff;">Salon Features & Command Tools</h3>
            <p style="color: var(--text-secondary); font-size: 0.82rem; margin-top: 2px;">Advanced telemetry, customer intelligence, and automated marketing tools.</p>
          </div>
        </div>

        <div class="profile-hub-grid">
          <!-- 1. VIP Client CRM -->
          <div class="profile-tool-card" id="card-feature-crm">
            <div class="profile-tool-icon" style="background: rgba(99,102,241,0.15); border: 1px solid rgba(99,102,241,0.3);">
              ${Icons.users({ size: 22, color: '#818cf8' })}
            </div>
            <div style="flex: 1;">
              <div style="font-weight: 700; color: #fff; font-size: 0.98rem;">VIP Client Intelligence & CRM</div>
              <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 3px;">Track client visit frequency, phone contacts, and lifetime spend.</div>
            </div>
            <div style="color: var(--text-muted);">${Icons.chevronRight({ size: 16 })}</div>
          </div>

          <!-- 2. WhatsApp Bot Logs -->
          <div class="profile-tool-card" id="card-feature-whatsapp">
            <div class="profile-tool-icon" style="background: rgba(37,211,102,0.12); border: 1px solid rgba(37,211,102,0.3);">
              ${Icons.whatsapp({ size: 22, color: '#25D366' })}
            </div>
            <div style="flex: 1;">
              <div style="font-weight: 700; color: #fff; font-size: 0.98rem;">WhatsApp Bot & Audit Logs</div>
              <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 3px;">Live PostgreSQL audit trail of inbound chats and instant booking triggers.</div>
            </div>
            <div style="color: var(--text-muted);">${Icons.chevronRight({ size: 16 })}</div>
          </div>

          <!-- 3. QR Booking Poster -->
          <div class="profile-tool-card" id="card-feature-qr">
            <div class="profile-tool-icon" style="background: rgba(245,158,11,0.12); border: 1px solid rgba(245,158,11,0.3);">
              ${Icons.qrCode({ size: 22, color: '#fbbf24' })}
            </div>
            <div style="flex: 1;">
              <div style="font-weight: 700; color: #fff; font-size: 0.98rem;">Mirror & Desk QR Posters</div>
              <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 3px;">Generate high-resolution printable QR codes for salon mirrors and counter.</div>
            </div>
            <div style="color: var(--text-muted);">${Icons.chevronRight({ size: 16 })}</div>
          </div>

          <!-- 4. Staff Shifts & Working Hours -->
          <div class="profile-tool-card" id="card-feature-shifts">
            <div class="profile-tool-icon" style="background: rgba(56,189,248,0.12); border: 1px solid rgba(56,189,248,0.3);">
              ${Icons.clock({ size: 22, color: '#38bdf8' })}
            </div>
            <div style="flex: 1;">
              <div style="font-weight: 700; color: #fff; font-size: 0.98rem;">Stylist Shifts & Working Hours</div>
              <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 3px;">Configure working shifts, lunch breaks, and holiday calendar schedules.</div>
            </div>
            <div style="color: var(--text-muted);">${Icons.chevronRight({ size: 16 })}</div>
          </div>

          <!-- 5. Sign Out -->
          <div class="profile-tool-card" id="card-feature-logout" style="border-color: rgba(244,63,94,0.3); background: rgba(244,63,94,0.04);">
            <div class="profile-tool-icon" style="background: rgba(244,63,94,0.12); border: 1px solid rgba(244,63,94,0.3);">
              ${Icons.lock({ size: 22, color: '#fb7185' })}
            </div>
            <div style="flex: 1;">
              <div style="font-weight: 700; color: #fb7185; font-size: 0.98rem;">Sign Out Store Session</div>
              <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 3px;">Safely end the manager session on this browser or mobile device.</div>
            </div>
            <div style="color: #fb7185;">${Icons.chevronRight({ size: 16, color: '#fb7185' })}</div>
          </div>
        </div>
      </div>
    `;
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
            <input type="text" class="form-control" id="whatsapp-log-phone-filter" placeholder="Filter by phone (e.g. 7999817743)..." style="max-width: 260px;" />
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
    const handleLogout = () => {
      ApiClient.removeToken();
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
      if (!newDate || this.selectedDate === newDate) return;
      this.selectedDate = newDate;
      const syncBtn = document.getElementById('btn-refresh-queue');
      syncBtn?.classList.add('syncing');
      try {
        await this.loadData();
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

    // Date Picker
    const datePicker = document.getElementById('dashboard-date-picker');
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
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        try {
          await ApiClient.toggleStaffStatus(id);
          await this.loadData();
          this.render();
        } catch (err) {
          alert(err.message);
        }
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

    // Add Service Modal
    document.getElementById('btn-add-service')?.addEventListener('click', () => {
      this.showAddServiceModal();
    });

    // Edit Service Modal
    this.container.querySelectorAll('.btn-edit-service').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const data = {
          id: e.currentTarget.getAttribute('data-id'),
          name: e.currentTarget.getAttribute('data-name'),
          price: e.currentTarget.getAttribute('data-price'),
          durationMinutes: e.currentTarget.getAttribute('data-duration'),
          category: e.currentTarget.getAttribute('data-category'),
          description: e.currentTarget.getAttribute('data-desc'),
        };
        this.showEditServiceModal(data);
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
        this.loadCustomersTable(this.searchQuery);
      }, 300);
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

    // Date Navigation Controls
    const handleDateChange = async (newDate) => {
      if (!newDate || this.selectedDate === newDate) return;
      this.selectedDate = newDate;
      try { await this.loadData(); } finally { this.render(); }
    };
    document.getElementById('btn-date-prev')?.addEventListener('click', () => handleDateChange(this.addDaysToDateString(this.selectedDate, -1)));
    document.getElementById('btn-date-next')?.addEventListener('click', () => handleDateChange(this.addDaysToDateString(this.selectedDate, 1)));
    document.getElementById('btn-date-today')?.addEventListener('click', () => handleDateChange(this.getLocalDateString()));
    document.getElementById('dashboard-date-picker')?.addEventListener('change', (e) => {
      if (e.target.value) handleDateChange(e.target.value);
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
    document.getElementById('btn-quick-add-service')?.addEventListener('click', () => this.showAddServiceModal());
    document.getElementById('btn-empty-add-service')?.addEventListener('click', () => this.showAddServiceModal());

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
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        try { await ApiClient.toggleStaffStatus(id); await this.loadData(); this.render(); } catch (err) { alert(err.message); }
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

    // Services Tab Buttons
    document.getElementById('btn-add-service')?.addEventListener('click', () => this.showAddServiceModal());
    tabContent.querySelectorAll('.btn-edit-service').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        this.showEditServiceModal({
          id: e.currentTarget.getAttribute('data-id'),
          name: e.currentTarget.getAttribute('data-name'),
          price: e.currentTarget.getAttribute('data-price'),
          durationMinutes: e.currentTarget.getAttribute('data-duration'),
          category: e.currentTarget.getAttribute('data-category'),
          description: e.currentTarget.getAttribute('data-desc'),
        });
      });
    });
    tabContent.querySelectorAll('.btn-delete-service').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        this.showDeleteServiceModal(e.currentTarget.getAttribute('data-id'), e.currentTarget.getAttribute('data-name'));
      });
    });

    // Profile Tab
    document.getElementById('btn-copy-invite')?.addEventListener('click', () => {
      const slug = this.salonProfile?.slug || 'glamour-studio';
      const url = `${window.location.origin}/#book/${slug}`;
      navigator.clipboard.writeText(url);
      alert(`Booking link copied to clipboard:\n${url}`);
    });
    tabContent.querySelectorAll('.btn-fast-walkin, #btn-fast-walkin').forEach((b) => {
      b.onclick = () => this.showWalkInModal();
    });
    document.getElementById('btn-open-qr')?.addEventListener('click', () => this.showQRCodeModal());
    document.getElementById('btn-block-time')?.addEventListener('click', () => this.showBlockTimeModal());

    // Profile Feature Hub Cards
    document.getElementById('card-feature-crm')?.addEventListener('click', () => {
      this.switchTab('customers');
    });
    document.getElementById('card-feature-whatsapp')?.addEventListener('click', () => {
      this.switchTab('whatsapp-logs');
    });
    document.getElementById('card-feature-shifts')?.addEventListener('click', () => {
      this.switchTab('staff');
    });
    document.getElementById('card-feature-logout')?.addEventListener('click', () => {
      ApiClient.removeToken();
      window.location.hash = '#login';
      window.location.reload();
    });


    // CRM Search
    const searchInput = document.getElementById('customer-search-input');
    let debounceTimer;
    searchInput?.addEventListener('input', (e) => {
      this.searchQuery = e.target.value;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => this.loadCustomersTable(this.searchQuery), 300);
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
    if (this.activeTab === 'customers') this.loadCustomersTable();
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
                <input type="tel" class="form-control" id="walkin-phone" placeholder="+91 98765 43210" required />
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

            <button type="submit" class="btn btn-primary" style="width: 100%;" id="btn-submit-reschedule">
              Update Schedule →
            </button>
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
        submitBtn.textContent = 'Update Schedule →';
        submitBtn.removeAttribute('disabled');
      }
    });
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
            Cancel booking for <strong>${clientName}</strong>. This will instantly free up the stylist's capacity for new bookings.
          </p>

          <form id="cancel-form">
            <div class="form-group">
              <label>Reason for Cancellation *</label>
              <select class="form-control" id="cancel-reason-select" required>
                <option value="Client requested cancellation">Client requested cancellation</option>
                <option value="Client did not show up (No-Show)">Client did not show up (No-Show)</option>
                <option value="Staff emergency / unavailability">Staff emergency / unavailability</option>
                <option value="Duplicate booking">Duplicate booking</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <button type="submit" class="btn btn-secondary" style="width: 100%; color: var(--danger); border-color: var(--danger);">
              Confirm Cancellation
            </button>
          </form>
        </div>
      </div>
    `;

    document.getElementById('btn-close-modal')?.addEventListener('click', () => (modalContainer.innerHTML = ''));

    document.getElementById('cancel-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const reason = document.getElementById('cancel-reason-select').value;
      const isNoShow = reason.includes('No-Show');
      const status = isNoShow ? 'NO_SHOW' : 'CANCELLED';

      try {
        await ApiClient.updateAppointmentStatus(appointmentId, status, reason);
        modalContainer.innerHTML = '';
        await this.loadData();
        this.render();
      } catch (err) {
        alert(`Failed: ${err.message}`);
      }
    });
  }

  showAddStaffModal() {
    const modalContainer = document.getElementById('modal-container');

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
              <label>Phone Number *</label>
              <input type="tel" class="form-control" id="new-staff-phone" placeholder="+91 98111 22334" required />
            </div>

            <div class="form-group">
              <label>Email Address</label>
              <input type="email" class="form-control" id="new-staff-email" placeholder="vikram@example.com" />
            </div>

            <div class="form-group">
              <label>Select Qualified Services</label>
              <div style="max-height: 140px; overflow-y: auto; background: var(--bg-input); padding: 8px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
                ${this.servicesList.map((s) => `
                  <label style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; margin-bottom: 6px; cursor: pointer;">
                    <input type="checkbox" class="staff-service-chk" value="${s.id}" checked />
                    <span>${s.name} (₹${s.price})</span>
                  </label>
                `).join('')}
              </div>
            </div>

            <button type="submit" class="btn btn-primary" style="width: 100%;">Create Stylist Member →</button>
          </form>
        </div>
      </div>
    `;

    document.getElementById('btn-close-modal')?.addEventListener('click', () => (modalContainer.innerHTML = ''));

    document.getElementById('add-staff-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const staff = await ApiClient.createStaff({
          name: document.getElementById('new-staff-name').value,
          phone: document.getElementById('new-staff-phone').value,
          email: document.getElementById('new-staff-email').value || undefined,
        });

        const selectedServices = Array.from(document.querySelectorAll('.staff-service-chk:checked')).map((c) => c.value);
        if (selectedServices.length > 0 && staff.id) {
          await ApiClient.assignStaffServices(staff.id, selectedServices);
        }

        modalContainer.innerHTML = '';
        await this.loadData();
        this.render();
      } catch (err) {
        alert(`Failed: ${err.message}`);
      }
    });
  }

  showAssignServicesModal(staffId, staffName) {
    const modalContainer = document.getElementById('modal-container');
    const staff = this.staffList.find((s) => s.id === staffId);
    const assignedIds = (staff?.services || []).map((s) => s.serviceId || s.service?.id);

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content">
          <div class="modal-header">
            <h3>✂️ Assign Qualified Services</h3>
            <button class="close-btn" id="btn-close-modal">&times;</button>
          </div>
          <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 16px;">Configure which services <strong>${staffName}</strong> can perform.</p>

          <form id="assign-services-form">
            <div style="max-height: 220px; overflow-y: auto; background: var(--bg-input); padding: 12px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); margin-bottom: 20px;">
              ${this.servicesList.map((s) => `
                <label style="display: flex; align-items: center; gap: 8px; font-size: 0.88rem; margin-bottom: 8px; cursor: pointer;">
                  <input type="checkbox" class="chk-assign-svc" value="${s.id}" ${assignedIds.includes(s.id) ? 'checked' : ''} />
                  <span style="font-weight: 600;">${s.name}</span>
                  <span style="color: var(--text-muted); font-size: 0.8rem;">(₹${s.price} • ${s.durationMinutes}m)</span>
                </label>
              `).join('')}
            </div>

            <button type="submit" class="btn btn-primary" style="width: 100%;">Save Qualifications →</button>
          </form>
        </div>
      </div>
    `;

    document.getElementById('btn-close-modal')?.addEventListener('click', () => (modalContainer.innerHTML = ''));

    document.getElementById('assign-services-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const selected = Array.from(document.querySelectorAll('.chk-assign-svc:checked')).map((c) => c.value);
      try {
        await ApiClient.assignStaffServices(staffId, selected);
        modalContainer.innerHTML = '';
        await this.loadData();
        this.render();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  showAddBreakModal(staffId, staffName) {
    const modalContainer = document.getElementById('modal-container');

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content">
          <div class="modal-header">
            <h3>☕ Add Shift Break</h3>
            <button class="close-btn" id="btn-close-modal">&times;</button>
          </div>
          <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 16px;">Set recurring break for <strong>${staffName}</strong> (automatically excludes booking slots).</p>

          <form id="add-break-form">
            <div class="form-group">
              <label>Day of Week *</label>
              <select class="form-control" id="break-day" required>
                <option value="MONDAY">Monday</option>
                <option value="TUESDAY">Tuesday</option>
                <option value="WEDNESDAY">Wednesday</option>
                <option value="THURSDAY">Thursday</option>
                <option value="FRIDAY">Friday</option>
                <option value="SATURDAY">Saturday</option>
                <option value="SUNDAY">Sunday</option>
              </select>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
              <div class="form-group">
                <label>Start Time (HH:mm) *</label>
                <input type="time" class="form-control" id="break-start" value="13:00" required />
              </div>
              <div class="form-group">
                <label>End Time (HH:mm) *</label>
                <input type="time" class="form-control" id="break-end" value="14:00" required />
              </div>
            </div>

            <div class="form-group">
              <label>Break Title</label>
              <input type="text" class="form-control" id="break-title" value="Lunch Break" />
            </div>

            <button type="submit" class="btn btn-primary" style="width: 100%;">Save Shift Break →</button>
          </form>
        </div>
      </div>
    `;

    document.getElementById('btn-close-modal')?.addEventListener('click', () => (modalContainer.innerHTML = ''));

    document.getElementById('add-break-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await ApiClient.createStaffBreak(staffId, {
          dayOfWeek: document.getElementById('break-day').value,
          startTime: document.getElementById('break-start').value,
          endTime: document.getElementById('break-end').value,
          title: document.getElementById('break-title').value,
        });

        modalContainer.innerHTML = '';
        await this.loadData();
        this.render();
      } catch (err) {
        alert(err.message);
      }
    });
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

  showAddServiceModal() {
    const modalContainer = document.getElementById('modal-container');
    const defaultCat = SERVICE_CATALOG_PRESETS[0];

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
                ${SERVICE_CATALOG_PRESETS.map((c) => `
                  <option value="${c.category}">${c.icon} ${c.category}</option>
                `).join('')}
                <option value="CUSTOM">➕ Other / Custom Category...</option>
              </select>
            </div>

            <!-- Custom Category Input (Revealed if Other is picked) -->
            <div class="form-group" id="svc-custom-cat-group" style="display: none;">
              <label>Custom Category Name *</label>
              <input type="text" class="form-control" id="svc-custom-cat-input" placeholder="e.g. Bridal Special, Pedicure, Tattoo" />
            </div>

            <!-- 2. Optional Suggestions Dropdown -->
            <div class="form-group">
              <label>Service Suggestions <span style="color: var(--text-muted); font-weight: normal; font-size: 0.8rem;">(Optional - pick to auto-fill)</span></label>
              <select class="form-control" id="svc-preset-select">
                <!-- Dynamically populated via JS -->
              </select>
            </div>

            <!-- 3. Service Name Text Field -->
            <div class="form-group">
              <label>Service Name *</label>
              <input type="text" class="form-control" id="svc-name" placeholder="e.g. Standard Haircut / Hair + Beard Combo" required />
            </div>

            <!-- 4. Price & Duration -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
              <div class="form-group">
                <label>Price (₹) *</label>
                <input type="number" class="form-control" id="svc-price" placeholder="100" min="0" required />
              </div>
              <div class="form-group">
                <label>Duration *</label>
                <select class="form-control" id="svc-duration" required>
                  <option value="15">15 mins</option>
                  <option value="20" selected>20 mins</option>
                  <option value="25">25 mins</option>
                  <option value="30">30 mins</option>
                  <option value="35">35 mins</option>
                  <option value="45">45 mins</option>
                  <option value="50">50 mins</option>
                  <option value="60">60 mins</option>
                  <option value="75">75 mins</option>
                  <option value="90">90 mins</option>
                  <option value="120">120 mins</option>
                </select>
              </div>
            </div>

            <!-- 5. Description -->
            <div class="form-group">
              <label>Service Description <span style="color: var(--text-muted); font-weight: normal; font-size: 0.8rem;">(Optional)</span></label>
              <textarea class="form-control" id="svc-desc" rows="2" placeholder="Brief details about the treatment / service..."></textarea>
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
    const presetSelect = document.getElementById('svc-preset-select');
    const nameInput = document.getElementById('svc-name');
    const priceInput = document.getElementById('svc-price');
    const durationSelect = document.getElementById('svc-duration');
    const descInput = document.getElementById('svc-desc');

    const updatePresetsForCategory = (catName) => {
      if (catName === 'CUSTOM') {
        customCatGroup.style.display = 'block';
        presetSelect.innerHTML = `<option value="">-- No suggestions for custom category --</option>`;
        return;
      }

      customCatGroup.style.display = 'none';
      const catObj = SERVICE_CATALOG_PRESETS.find((c) => c.category === catName);
      if (!catObj) return;

      presetSelect.innerHTML = `
        <option value="">-- Select from suggestions (Optional) --</option>
        ${catObj.presets.map((p, idx) => `
          <option value="${idx}">${p.name} (₹${p.price} • ${p.duration}m)</option>
        `).join('')}
      `;
    };

    const applyPreset = (preset) => {
      nameInput.value = preset.name;
      priceInput.value = preset.price;
      durationSelect.value = preset.duration;
      descInput.value = preset.desc || '';
    };

    categorySelect?.addEventListener('change', (e) => {
      updatePresetsForCategory(e.target.value);
    });

    presetSelect?.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === '') return;

      const catName = categorySelect.value;
      const catObj = SERVICE_CATALOG_PRESETS.find((c) => c.category === catName);
      const preset = catObj?.presets[parseInt(val, 10)];
      if (preset) {
        applyPreset(preset);
      }
    });

    // Initialize with first category
    updatePresetsForCategory(defaultCat.category);

    document.getElementById('add-service-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rawCat = categorySelect.value;
      const finalCategory = rawCat === 'CUSTOM' ? (customCatInput.value.trim() || 'General') : rawCat;

      try {
        await ApiClient.createService({
          name: nameInput.value.trim(),
          price: parseFloat(priceInput.value),
          durationMinutes: parseInt(durationSelect.value, 10),
          category: finalCategory,
          description: descInput.value.trim(),
        });

        modalContainer.innerHTML = '';
        await this.loadData();
        this.render();
      } catch (err) {
        alert(err.message);
      }
    });
  }

  showEditServiceModal(service) {
    const modalContainer = document.getElementById('modal-container');
    const matchedCat = SERVICE_CATALOG_PRESETS.find((c) => c.category === service.category);
    const initialCatValue = matchedCat ? service.category : 'CUSTOM';

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
                ${SERVICE_CATALOG_PRESETS.map((c) => `
                  <option value="${c.category}" ${c.category === service.category ? 'selected' : ''}>${c.icon} ${c.category}</option>
                `).join('')}
                <option value="CUSTOM" ${initialCatValue === 'CUSTOM' ? 'selected' : ''}>➕ Other / Custom Category...</option>
              </select>
            </div>

            <!-- Custom Category Input -->
            <div class="form-group" id="edit-svc-custom-cat-group" style="${initialCatValue === 'CUSTOM' ? 'display: block;' : 'display: none;'}">
              <label>Custom Category Name *</label>
              <input type="text" class="form-control" id="edit-svc-custom-cat-input" value="${initialCatValue === 'CUSTOM' ? (service.category || '') : ''}" placeholder="e.g. Bridal & Groom Special" />
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
                <label>Duration *</label>
                <select class="form-control" id="edit-svc-duration" required>
                  <option value="15" ${service.durationMinutes == 15 ? 'selected' : ''}>15 mins</option>
                  <option value="20" ${service.durationMinutes == 20 ? 'selected' : ''}>20 mins</option>
                  <option value="25" ${service.durationMinutes == 25 ? 'selected' : ''}>25 mins</option>
                  <option value="30" ${service.durationMinutes == 30 ? 'selected' : ''}>30 mins</option>
                  <option value="35" ${service.durationMinutes == 35 ? 'selected' : ''}>35 mins</option>
                  <option value="45" ${service.durationMinutes == 45 ? 'selected' : ''}>45 mins</option>
                  <option value="50" ${service.durationMinutes == 50 ? 'selected' : ''}>50 mins</option>
                  <option value="60" ${service.durationMinutes == 60 ? 'selected' : ''}>60 mins</option>
                  <option value="75" ${service.durationMinutes == 75 ? 'selected' : ''}>75 mins</option>
                  <option value="90" ${service.durationMinutes == 90 ? 'selected' : ''}>90 mins</option>
                  <option value="120" ${service.durationMinutes == 120 ? 'selected' : ''}>120 mins</option>
                </select>
              </div>
            </div>

            <!-- 4. Description -->
            <div class="form-group">
              <label>Description</label>
              <textarea class="form-control" id="edit-svc-desc" rows="2">${service.description || ''}</textarea>
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

    document.getElementById('edit-service-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const rawCat = categorySelect.value;
      const finalCategory = rawCat === 'CUSTOM' ? (customCatInput.value.trim() || 'General') : rawCat;

      try {
        await ApiClient.updateService(service.id, {
          name: document.getElementById('edit-svc-name').value.trim(),
          price: parseFloat(document.getElementById('edit-svc-price').value),
          durationMinutes: parseInt(document.getElementById('edit-svc-duration').value, 10),
          category: finalCategory,
          description: document.getElementById('edit-svc-desc').value.trim(),
        });

        modalContainer.innerHTML = '';
        await this.loadData();
        this.render();
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
      try {
        await ApiClient.updateStaff(staff.id, {
          name: document.getElementById('edit-staff-name').value.trim(),
          phone: document.getElementById('edit-staff-phone').value.trim(),
          email: document.getElementById('edit-staff-email').value.trim() || undefined,
          profileImageUrl: document.getElementById('edit-staff-img').value.trim() || undefined,
        });

        modalContainer.innerHTML = '';
        await this.loadData();
        this.render();
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
        modalContainer.innerHTML = '';
        await this.loadData();
        this.render();
      } catch (err) {
        alert(`Failed to delete stylist: ${err.message}`);
      }
    });
  }

  showEditStaffHoursModal(staffId, staffName) {
    const modalContainer = document.getElementById('modal-container');
    const staff = this.staffList.find((s) => s.id === staffId);
    const existingHours = staff?.workingHours || [];

    const days = [
      { key: 'MONDAY', label: 'Monday' },
      { key: 'TUESDAY', label: 'Tuesday' },
      { key: 'WEDNESDAY', label: 'Wednesday' },
      { key: 'THURSDAY', label: 'Thursday' },
      { key: 'FRIDAY', label: 'Friday' },
      { key: 'SATURDAY', label: 'Saturday' },
      { key: 'SUNDAY', label: 'Sunday' },
    ];

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content modal-content-lg" style="max-height: 90vh; overflow-y: auto;">
          <div class="modal-header">
            <h3>⏰ Weekly Shift Hours: ${staffName}</h3>
            <button class="close-btn" id="btn-close-modal">&times;</button>
          </div>
          <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 16px;">
            Configure active working days and daily shift start/end times for <strong>${staffName}</strong>.
          </p>

          <form id="edit-hours-form">
            <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px;">
              ${days.map((d) => {
                const wh = existingHours.find((h) => h.dayOfWeek === d.key) || { isWorking: true, startTime: '09:00', endTime: '21:00' };
                return `
                  <div style="display: flex; align-items: center; justify-content: space-between; background: var(--bg-input); padding: 10px 14px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); gap: 10px;">
                    <label style="display: flex; align-items: center; gap: 10px; min-width: 140px; cursor: pointer; margin-bottom: 0;">
                      <input type="checkbox" class="shift-day-chk" data-day="${d.key}" ${wh.isWorking ? 'checked' : ''} style="width: 18px; height: 18px;" />
                      <span style="font-weight: 700; color: #fff;">${d.label}</span>
                    </label>
                    <div style="display: flex; align-items: center; gap: 6px;">
                      <input type="time" class="form-control shift-start" data-day="${d.key}" value="${wh.startTime || '09:00'}" style="padding: 6px; font-size: 0.85rem;" />
                      <span style="color: var(--text-muted); font-size: 0.8rem;">to</span>
                      <input type="time" class="form-control shift-end" data-day="${d.key}" value="${wh.endTime || '21:00'}" style="padding: 6px; font-size: 0.85rem;" />
                    </div>
                  </div>
                `;
              }).join('')}
            </div>

            <button type="submit" class="btn btn-primary" style="width: 100%;">Save Weekly Shift Schedule →</button>
          </form>
        </div>
      </div>
    `;

    document.getElementById('btn-close-modal')?.addEventListener('click', () => (modalContainer.innerHTML = ''));

    document.getElementById('edit-hours-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const hoursPayload = days.map((d) => {
        const chk = document.querySelector(`.shift-day-chk[data-day="${d.key}"]`);
        const start = document.querySelector(`.shift-start[data-day="${d.key}"]`);
        const end = document.querySelector(`.shift-end[data-day="${d.key}"]`);
        return {
          dayOfWeek: d.key,
          isWorking: chk?.checked || false,
          startTime: start?.value || '09:00',
          endTime: end?.value || '21:00',
        };
      });

      try {
        await ApiClient.updateStaffWorkingHours(staffId, hoursPayload);
        modalContainer.innerHTML = '';
        await this.loadData();
        this.render();
      } catch (err) {
        alert(`Failed to update hours: ${err.message}`);
      }
    });
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
        modalContainer.innerHTML = '';
        await this.loadData();
        this.render();
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
        <div class="modal-content modal-content-lg">
          <div class="modal-header">
            <h3>📜 Visit History: ${customerName}</h3>
            <button class="close-btn" id="btn-close-modal">&times;</button>
          </div>
          <div id="cust-history-body" style="padding: 20px; text-align: center; color: var(--text-muted);">
            Loading client visit history...
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-close-modal')?.addEventListener('click', () => (modalContainer.innerHTML = ''));

    try {
      const customer = await ApiClient.getCustomerById(customerId);
      const historyBody = document.getElementById('cust-history-body');

      if (!customer.appointments || customer.appointments.length === 0) {
        historyBody.innerHTML = `<div style="padding: 30px;">No previous appointments recorded for this client.</div>`;
        return;
      }

      historyBody.innerHTML = `
        <div style="max-height: 340px; overflow-y: auto;">
          <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.88rem;">
            <thead>
              <tr style="border-bottom: 1px solid var(--border-subtle); color: var(--text-secondary);">
                <th style="padding: 8px;">DATE</th>
                <th style="padding: 8px;">SERVICE</th>
                <th style="padding: 8px;">SPECIALIST</th>
                <th style="padding: 8px;">AMOUNT</th>
                <th style="padding: 8px;">STATUS</th>
              </tr>
            </thead>
            <tbody>
              ${customer.appointments.map((a) => `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                  <td style="padding: 8px;">${new Date(a.date).toLocaleDateString()}</td>
                  <td style="padding: 8px; font-weight: 600; color: #fff;">${a.service?.name}</td>
                  <td style="padding: 8px; color: var(--text-secondary);">${a.staff?.name}</td>
                  <td style="padding: 8px; font-weight: 700; color: #10b981; font-family: var(--font-heading);">₹${a.price}</td>
                  <td style="padding: 8px;"><span class="badge badge-${a.status.toLowerCase()}">${a.status}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (err) {
      document.getElementById('cust-history-body').innerHTML = `<div style="color: var(--danger);">${err.message}</div>`;
    }
  }
}
