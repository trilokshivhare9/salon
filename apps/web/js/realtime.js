// Realtime Event Stream, Audio Chimes & Professional PWA Notification Dispatcher
import { API_BASE, formatTime12h } from './api.js';
import { SoundManager } from './sound.js';

export class RealtimeNotifier {
  static activeInstance = null;

  constructor(salonId, onEventCallback) {
    // Singleton Enforcement: Clean up any previous event stream immediately
    if (RealtimeNotifier.activeInstance) {
      RealtimeNotifier.activeInstance.destroy();
    }
    RealtimeNotifier.activeInstance = this;

    this.salonId = salonId;
    this.onEventCallback = onEventCallback;
    this.eventSource = null;
    this.dedupCache = new Map(); // key -> expiry timestamp
    this.lastPacketAt = Date.now();
    this.watchdogTimer = null;

    this.handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        const elapsed = Date.now() - this.lastPacketAt;
        console.log(`[Realtime] 👁️ Tab became visible (last packet ${Math.round(elapsed / 1000)}s ago)`);
        if (!this.eventSource || this.eventSource.readyState !== EventSource.OPEN || elapsed > 35000) {
          console.log('[Realtime] 🔄 Re-establishing live stream on tab focus...');
          this.connect();
        }
        if (window.salonDashboard && typeof window.salonDashboard.loadData === 'function') {
          window.salonDashboard.loadData(true).catch(() => {});
        }
      }
    };

    this.handleOnline = () => {
      console.log('[Realtime] 🌐 Network online: Re-establishing live stream and syncing data...');
      this.connect();
      if (window.salonDashboard && typeof window.salonDashboard.loadData === 'function') {
        window.salonDashboard.loadData(true).catch(() => {});
      }
    };

    this.init();
  }

  init() {
    this.requestNotificationPermission();
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('online', this.handleOnline);
    this.startWatchdog();
    this.connect();
  }

  startWatchdog() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.watchdogTimer = setInterval(() => {
      const elapsed = Date.now() - this.lastPacketAt;
      if (elapsed > 45000) {
        console.warn(`[Realtime] ⏱️ Watchdog: Missed ping for ${Math.round(elapsed / 1000)}s. Force-reconnecting live stream...`);
        this.connect();
        if (window.salonDashboard && typeof window.salonDashboard.loadData === 'function') {
          window.salonDashboard.loadData(true).catch(() => {});
        }
      }
    }, 10000);
  }

  async requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch (e) {
        console.warn('[Realtime] Notification permission request error:', e);
      }
    }
  }

  // Deduplication check: prevents multiple triggers for the exact same event within 8 seconds
  isDuplicateEvent(eventKey) {
    if (!eventKey) return false;
    const now = Date.now();
    // Clean expired entries
    for (const [key, expiry] of this.dedupCache.entries()) {
      if (expiry < now) {
        this.dedupCache.delete(key);
      }
    }

    if (this.dedupCache.has(eventKey)) {
      return true;
    }

    this.dedupCache.set(eventKey, now + 8000);
    return false;
  }

  // Smart Dispatcher: Only shows OS native notification when app is in BACKGROUND.
  // When in FOREGROUND, shows only the sleek in-app luxury banner.
  dispatchNotification({ title, body, badgeText, clientName, details, specialist, icon = '⚡', variant = 'success', eventKey, actionCallback, showActionBtn = false }) {
    if (eventKey && this.isDuplicateEvent(eventKey)) {
      console.log('[Realtime] Ignored duplicate event:', eventKey);
      return;
    }

    const isForeground = document.visibilityState === 'visible';

    if (isForeground) {
      // 1. FOREGROUND MODE: Luxury In-App Floating Banner (Zero OS duplicate clutter)
      this.showLuxuryBanner({
        badgeText,
        title,
        clientName,
        details,
        specialist,
        icon,
        variant,
        actionCallback,
        showActionBtn,
      });
    } else {
      // 2. BACKGROUND MODE: Native Phone/OS Push via Service Worker (Rings/vibrates when locked/minimized)
      this.dispatchBackgroundNotification(title, `${clientName} • ${details}`, eventKey, {
        salonId: this.salonId,
      });
    }
  }

  async dispatchBackgroundNotification(title, body, tag, data = {}) {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      return;
    }

    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready;
        if (registration && 'showNotification' in registration) {
          await registration.showNotification(title, {
            body,
            icon: '/icon.svg',
            badge: '/icon.svg',
            tag: tag || 'salonflow-alert',
            renotify: true,
            vibrate: [200, 100, 200],
            data: {
              url: '/#admin',
              ...data,
            },
          });
          return;
        }
      }

      // Fallback if Service Worker is inactive
      new Notification(title, {
        body,
        icon: '/icon.svg',
        tag: tag || 'salonflow-alert',
      });
    } catch (e) {
      console.warn('[Realtime] Background notification failed:', e);
    }
  }

  // Luxury Glassmorphic In-App Banner with Mobile-First Capsule & Stack Limiter
  showLuxuryBanner({ badgeText, title, clientName, details, specialist, icon = '⚡', variant = 'success', actionCallback, showActionBtn = false }) {
    let container = document.getElementById('live-banner-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'live-banner-container';
      document.body.appendChild(container);
    }

    // Stack Limiter: Max 1 on mobile, Max 2 on desktop (prevents multiple banners cascading down)
    const isMobile = window.innerWidth <= 640;
    const maxAllowed = isMobile ? 1 : 2;
    const existingBanners = Array.from(container.querySelectorAll('.live-luxury-banner'));
    if (existingBanners.length >= maxAllowed) {
      for (let i = 0; i <= existingBanners.length - maxAllowed; i++) {
        const oldBanner = existingBanners[i];
        oldBanner.classList.remove('banner-visible');
        setTimeout(() => oldBanner.remove(), 250);
      }
    }

    // Color tokens based on variant
    let accentColor = '#10b981'; // Emerald
    let glowColor = 'rgba(16, 185, 129, 0.25)';
    let badgeBg = 'rgba(16, 185, 129, 0.15)';

    if (variant === 'danger') {
      accentColor = '#f43f5e'; // Rose
      glowColor = 'rgba(244, 63, 94, 0.25)';
      badgeBg = 'rgba(244, 63, 94, 0.15)';
    } else if (variant === 'warning') {
      accentColor = '#f59e0b'; // Amber
      glowColor = 'rgba(245, 158, 11, 0.25)';
      badgeBg = 'rgba(245, 158, 11, 0.15)';
    } else if (variant === 'info') {
      accentColor = '#8B3DFF'; // Indigo
      glowColor = 'rgba(139, 61, 255, 0.25)';
      badgeBg = 'rgba(139, 61, 255, 0.15)';
    }

    const banner = document.createElement('div');
    banner.className = 'live-luxury-banner';
    banner.style.setProperty('--banner-accent', accentColor);
    banner.style.setProperty('--banner-glow', glowColor);
    banner.style.setProperty('--banner-bg', badgeBg);

    banner.innerHTML = `
      <!-- Top Tag Strip (Desktop) -->
      <div class="banner-top-strip">
        <div class="banner-tag-wrap">
          <span class="banner-status-dot"></span>
          <span class="banner-tag-badge">
            ${badgeText || title}
          </span>
        </div>
        <button type="button" class="banner-close-btn" aria-label="Dismiss">&times;</button>
      </div>

      <!-- Main Body -->
      <div class="banner-body-row">
        <div class="banner-icon-box">
          ${icon}
        </div>
        <div class="banner-text-wrap">
          <div class="banner-title">
            ${clientName || title}
          </div>
          ${details ? `<div class="banner-details">${details}</div>` : ''}
          ${specialist ? `<div class="banner-details">Specialist: <strong>${specialist}</strong></div>` : ''}
        </div>
        <button type="button" class="banner-close-btn mobile-close" aria-label="Dismiss">&times;</button>
      </div>

      <!-- Bottom Interactive Bar (Only when actionCallback or showActionBtn is enabled) -->
      ${showActionBtn || actionCallback ? `
      <div class="banner-footer-row">
        <span class="banner-footer-text">Just now • Tap to view queue</span>
        <button type="button" class="banner-action-btn">
          <span>View Queue</span>
          <span>→</span>
        </button>
      </div>
      ` : ''}

      <!-- Auto-dismiss Progress Bar -->
      <div class="banner-progress"></div>
    `;

    container.appendChild(banner);

    // Trigger Entrance Animation
    requestAnimationFrame(() => {
      banner.classList.add('banner-visible');
    });

    let dismissTimer = null;
    const dismissBanner = () => {
      if (dismissTimer) clearTimeout(dismissTimer);
      banner.classList.remove('banner-visible');
      setTimeout(() => banner.remove(), 250);
    };

    // Close button dismisses
    banner.querySelectorAll('.banner-close-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        dismissBanner();
      });
    });

    // Click on banner invokes action
    banner.addEventListener('click', (e) => {
      if (e.target.closest('.banner-close-btn')) return;
      dismissBanner();
      if (actionCallback) {
        actionCallback();
      } else if (showActionBtn) {
        window.location.hash = '#admin';
      }
    });

    // Auto-dismiss after 4.5 seconds
    dismissTimer = setTimeout(dismissBanner, 4500);
  }

  connect() {
    if (!this.salonId) return;

    const streamUrl = `${API_BASE}/appointments/stream/${this.salonId}`;
    console.log('[Realtime] ⚡ Connecting to Live Event Stream:', streamUrl);

    if (this.eventSource) {
      this.eventSource.close();
    }

    this.eventSource = new EventSource(streamUrl);

    this.eventSource.onmessage = (event) => {
      try {
        this.lastPacketAt = Date.now();
        const payload = JSON.parse(event.data);

        // Heartbeat keepalive ping from backend
        if (payload?.type === 'PING') {
          return;
        }

        console.log('[Realtime] 📡 Received live event:', payload);

        if (payload.type === 'NEW_BOOKING') {
          const appt = payload.data;
          const clientName = appt?.customer?.name || 'New Client';
          const svcs = (typeof window !== 'undefined' && window.getApptServices) ? window.getApptServices(appt) : [];
          const serviceName = svcs.length > 0
            ? svcs.map((s) => s.name).join(' + ')
            : (appt?.serviceNameSnapshot || appt?.service?.name || 'Salon Service');
          const specialistName = appt?.staff?.name || appt?.stylist?.name || 'Assigned Specialist';
          const timeStr = appt?.startTime ? formatTime12h(appt.startTime) : 'Today';
          const price = appt?.price ? ` • ₹${appt.price}` : '';
          const eventKey = `booking:${appt?.id || appt?.appointmentNumber || Date.now()}`;

          SoundManager.playNewBookingChime();

          const isQuickRequest = appt?.status === 'PENDING_ACCEPTANCE' || appt?.source === 'QUICK_BOOK';

          if (isQuickRequest && appt?.status === 'PENDING_ACCEPTANCE') {
            this.dispatchNotification({
              badgeText: 'Quick Book Request',
              title: '⚡ Incoming Quick Booking Request!',
              clientName,
              details: `${serviceName}${price} • ${timeStr}`,
              specialist: specialistName,
              icon: '📩',
              variant: 'warning',
              eventKey,
              actionCallback: () => {
                if (window.salonDashboard && typeof window.salonDashboard.openQuickRequestsModal === 'function') {
                  window.salonDashboard.openQuickRequestsModal();
                } else if (window.salonDashboard) {
                  window.salonDashboard.switchTab('queue');
                }
              },
            });
          } else {
            this.dispatchNotification({
              badgeText: 'New Appointment',
              title: '⚡ New Salon Booking!',
              clientName,
              details: `${serviceName}${price} • ${timeStr}`,
              specialist: specialistName,
              icon: '✂️',
              variant: 'success',
              eventKey,
              actionCallback: () => {
                if (window.salonDashboard) {
                  window.salonDashboard.switchTab('queue');
                }
              },
            });
          }

          // Deterministic async sync: await loadData before refreshing open quick requests modal
          if (window.salonDashboard && typeof window.salonDashboard.loadData === 'function') {
            window.salonDashboard.loadData(true).then(() => {
              if (isQuickRequest && document.getElementById('modal-quick-requests')) {
                window.salonDashboard?.openQuickRequestsModal?.();
              }
              if (window.salonDashboard?.updateQuickRequestsBadge) {
                window.salonDashboard.updateQuickRequestsBadge();
              }
            }).catch((err) => {
              console.warn('[Realtime] loadData error on NEW_BOOKING:', err);
            });
          }

        } else if (
          payload.type === 'BOOKING_CANCELLED' ||
          payload.type === 'CANCELLED' ||
          (payload.type === 'STATUS_UPDATED' && payload.data?.status === 'CANCELLED')
        ) {
          const appt = payload.data;
          const clientName = appt?.customer?.name || appt?.user?.name || appt?.salonUser?.user?.name || 'Client';
          const svcs = (typeof window !== 'undefined' && window.getApptServices) ? window.getApptServices(appt) : [];
          const serviceName = svcs.length > 0
            ? svcs.map((s) => s.name).join(' + ')
            : (appt?.serviceNameSnapshot || appt?.service?.name || 'Service');
          const timeStr = appt?.startTime ? formatTime12h(appt.startTime) : (appt?.startAt ? formatTime12h(appt.startAt) : '');
          const reason = appt?.cancellationReason || appt?.reason || 'Reservation cancelled';
          const eventKey = `cancel:${appt?.id || 'unknown'}`;

          SoundManager.playCancelAlert();

          this.dispatchNotification({
            badgeText: 'Slot Released',
            title: '❌ Appointment Cancelled',
            clientName,
            details: `${serviceName}${timeStr ? ` • ${timeStr}` : ''} cancelled (${reason})`,
            icon: '✕',
            variant: 'danger',
            eventKey,
            actionCallback: () => {
              if (window.salonDashboard) {
                window.salonDashboard.switchTab('queue');
              }
            },
          });

          // Auto-refresh the quick requests modal if it's already open
          if (document.getElementById('modal-quick-requests')) {
            setTimeout(() => {
              if (window.salonDashboard?.openQuickRequestsModal) {
                window.salonDashboard.openQuickRequestsModal();
              }
            }, 300);
          }

        } else if (payload.type === 'STATUS_UPDATED') {
          const appt = payload.data;
          const clientName = appt?.customer?.name || 'Client';
          const status = appt?.status || 'UPDATED';
          const eventKey = `status:${appt?.id}:${status}`;

          if (status === 'CHECKED_IN') {
            SoundManager.playCheckinChime();
            this.dispatchNotification({
              badgeText: 'Client Arrived',
              title: '📍 Client Checked In',
              clientName,
              details: 'Waiting in lounge • Ready for chair',
              icon: '📍',
              variant: 'warning',
              eventKey,
            });
          } else if (status === 'ON_THE_WAY') {
            SoundManager.playCheckinChime();
            this.dispatchNotification({
              badgeText: 'On The Way',
              title: '🚗 Client En Route',
              clientName,
              details: 'Customer notified they are on the way',
              icon: '🚗',
              variant: 'info',
              eventKey,
            });
          } else if (status === 'IN_SERVICE' || status === 'SEATED_IN_CHAIR') {
            SoundManager.playCheckinChime();
            this.dispatchNotification({
              badgeText: 'In Chair',
              title: '✂️ Service In Progress',
              clientName,
              details: 'Service has commenced',
              icon: '✂️',
              variant: 'success',
              eventKey,
            });
          } else if (status === 'COMPLETED') {
            SoundManager.playCheckinChime();
            this.dispatchNotification({
              badgeText: 'Chair Freed',
              title: '✅ Service Completed',
              clientName,
              details: 'Appointment fulfilled • Chair is now free',
              icon: '✅',
              variant: 'success',
              eventKey,
            });
          }
        } else if (payload.type === 'STAFF_UPDATED') {
          // Check for self-action suppression:
          // If the user recently triggered an admin action on staff (within last 4 seconds),
          // suppress the incoming toast to prevent self-echo notification storms.
          const isLocalStaffAction = window.salonDashboard?.lastLocalActionTimestamp &&
            (Date.now() - window.salonDashboard.lastLocalActionTimestamp < 4000);

          if (!isLocalStaffAction) {
            const action = payload.data?.action || 'UPDATED';
            const staffId = payload.data?.staffId || payload.data?.id || 'all';
            const eventKey = `staff:${staffId}:${action}`;

            let msg = 'Stylist schedule or profile updated';
            let icon = '👥';
            if (action === 'CREATE') { msg = 'New stylist added to team'; icon = '✨'; }
            else if (action === 'DELETE') { msg = 'Stylist removed from team'; icon = '🗑️'; }
            else if (action === 'ASSIGN_SERVICES') { msg = 'Stylist service qualifications updated'; icon = '✂️'; }
            else if (action === 'UPDATE_HOURS') { msg = 'Stylist shift hours updated'; icon = '⏰'; }

            SoundManager.playCheckinChime();
            this.dispatchNotification({
              badgeText: 'Team Update',
              title: '👥 Stylists Updated',
              clientName: msg,
              details: 'Live salon roster synced',
              icon,
              variant: 'info',
              eventKey,
              showActionBtn: false,
            });
          }
        } else if (payload.type === 'SERVICE_UPDATED') {
          // Check for self-action suppression:
          const isLocalServiceAction = window.salonDashboard?.lastLocalActionTimestamp &&
            (Date.now() - window.salonDashboard.lastLocalActionTimestamp < 4000);

          if (!isLocalServiceAction) {
            const action = payload.data?.action || 'UPDATED';
            const serviceId = payload.data?.serviceId || payload.data?.id || 'all';
            const eventKey = `service:${serviceId}:${action}`;

            let msg = 'Service catalogue updated';
            let icon = '✂️';
            if (action === 'CREATE') { msg = 'New service added to menu'; icon = '✨'; }
            else if (action === 'DELETE') { msg = 'Service removed from menu'; icon = '🗑️'; }
            else if (action === 'UPDATE') { msg = 'Service pricing or details updated'; icon = '✏️'; }

            SoundManager.playCheckinChime();
            this.dispatchNotification({
              badgeText: 'Menu Update',
              title: '✂️ Service Menu Synced',
              clientName: msg,
              details: 'Real-time catalogue live',
              icon,
              variant: 'info',
              eventKey,
              showActionBtn: false,
            });
          }
        } else if (payload.type === 'APPOINTMENT_UPDATED') {
          // ETA updates, auto-completion, reschedule confirmations — silent dashboard refresh
          // (Handled by the generic onEventCallback below)
        }

        // Trigger callback to refresh dashboard data in real-time
        if (this.onEventCallback) {
          this.onEventCallback(payload);
        }
      } catch (err) {
        console.error('[Realtime] Message parse error:', err);
      }
    };

    this.eventSource.onerror = (err) => {
      console.warn('[Realtime] EventSource error or disconnect:', err);
      if (this.eventSource && this.eventSource.readyState === EventSource.CLOSED) {
        setTimeout(() => {
          if (this.eventSource && this.eventSource.readyState === EventSource.CLOSED) {
            console.log('[Realtime] 🔄 Auto-reconnecting closed EventSource stream...');
            this.connect();
          }
        }, 2500);
      }
    };
  }

  destroy() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('online', this.handleOnline);

    if (this.eventSource) {
      console.log('[Realtime] Closing EventSource stream');
      this.eventSource.close();
      this.eventSource = null;
    }
    if (RealtimeNotifier.activeInstance === this) {
      RealtimeNotifier.activeInstance = null;
    }
  }
}
