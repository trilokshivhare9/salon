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

    this.init();
  }

  init() {
    this.requestNotificationPermission();
    this.connect();
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

  // Deduplication check: prevents multiple triggers for the exact same event within 6 seconds
  isDuplicateEvent(eventKey) {
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

    this.dedupCache.set(eventKey, now + 6000);
    return false;
  }

  // Smart Dispatcher: Only shows OS native notification when app is in BACKGROUND.
  // When in FOREGROUND, shows only the sleek in-app luxury banner.
  dispatchNotification({ title, body, badgeText, clientName, details, specialist, icon = '⚡', variant = 'success', eventKey, actionCallback }) {
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

  // Luxury Glassmorphic In-App Banner with Mobile Safe-Area Inset Protection
  showLuxuryBanner({ badgeText, title, clientName, details, specialist, icon = '⚡', variant = 'success', actionCallback }) {
    let container = document.getElementById('live-banner-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'live-banner-container';
      // Professional Safe Area positioning: Never cut off by iPhone Dynamic Island / notch / Android status bar
      container.style.cssText = `
        position: fixed;
        top: max(16px, env(safe-area-inset-top, 0px) + 14px);
        right: max(16px, env(safe-area-inset-right, 0px) + 14px);
        left: max(16px, env(safe-area-inset-left, 0px) + 14px);
        z-index: 999999;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        pointer-events: none;
      `;
      document.body.appendChild(container);
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
      accentColor = '#6366f1'; // Indigo
      glowColor = 'rgba(99, 102, 241, 0.25)';
      badgeBg = 'rgba(99, 102, 241, 0.15)';
    }

    const banner = document.createElement('div');
    banner.style.cssText = `
      width: 100%;
      max-width: 440px;
      margin-left: auto;
      pointer-events: auto;
      background: rgba(15, 23, 42, 0.94);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-left: 4px solid ${accentColor};
      border-radius: 16px;
      box-shadow: 0 20px 45px -10px rgba(0, 0, 0, 0.8), 0 0 28px ${glowColor};
      padding: 14px 16px;
      color: #fff;
      display: flex;
      flex-direction: column;
      gap: 8px;
      position: relative;
      overflow: hidden;
      transform: translateY(-24px);
      opacity: 0;
      transition: transform 0.35s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.35s ease;
      cursor: pointer;
    `;

    banner.innerHTML = `
      <!-- Top Tag Strip -->
      <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
        <div style="display: flex; align-items: center; gap: 6px;">
          <span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: ${accentColor}; box-shadow: 0 0 8px ${accentColor};"></span>
          <span style="font-size: 0.72rem; font-weight: 800; letter-spacing: 0.05em; text-transform: uppercase; color: ${accentColor}; background: ${badgeBg}; padding: 2px 8px; border-radius: 6px;">
            ${badgeText || title}
          </span>
        </div>
        <button class="banner-close-btn" style="background: transparent; border: none; color: #94a3b8; font-size: 1.1rem; cursor: pointer; padding: 2px 6px; border-radius: 4px; line-height: 1; transition: color 0.2s;">
          &times;
        </button>
      </div>

      <!-- Main Body -->
      <div style="display: flex; align-items: center; gap: 12px; margin-top: 2px;">
        <div style="width: 40px; height: 40px; border-radius: 10px; background: ${badgeBg}; display: flex; align-items: center; justify-content: center; font-size: 1.25rem; flex-shrink: 0; border: 1px solid rgba(255,255,255,0.06);">
          ${icon}
        </div>
        <div style="flex: 1; min-width: 0;">
          <div style="font-weight: 800; font-size: 0.96rem; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-heading);">
            ${clientName}
          </div>
          <div style="font-size: 0.8rem; color: #cbd5e1; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            ${details}
          </div>
          ${specialist ? `<div style="font-size: 0.73rem; color: #94a3b8; margin-top: 2px;">Specialist: <strong style="color: #e2e8f0;">${specialist}</strong></div>` : ''}
        </div>
      </div>

      <!-- Bottom Interactive Bar -->
      <div style="display: flex; align-items: center; justify-content: space-between; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 8px; margin-top: 4px;">
        <span style="font-size: 0.7rem; color: #64748b;">Just now • Tap to view queue</span>
        <button class="banner-action-btn" style="background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.1); color: #fff; font-size: 0.75rem; font-weight: 700; padding: 4px 10px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 4px;">
          <span>View Queue</span>
          <span style="font-size: 0.85rem;">→</span>
        </button>
      </div>

      <!-- Auto-dismiss Progress Bar -->
      <div class="banner-progress" style="position: absolute; bottom: 0; left: 0; height: 2.5px; background: linear-gradient(90deg, ${accentColor}, transparent); width: 100%; transform-origin: left; animation: bannerCountdown 5s linear forwards;"></div>
    `;

    container.appendChild(banner);

    // Trigger Entrance Animation
    requestAnimationFrame(() => {
      banner.style.transform = 'translateY(0)';
      banner.style.opacity = '1';
    });

    const dismissBanner = () => {
      banner.style.transform = 'translateY(-20px)';
      banner.style.opacity = '0';
      setTimeout(() => banner.remove(), 350);
    };

    // Click on banner or "View Queue" invokes action
    banner.addEventListener('click', (e) => {
      if (e.target.closest('.banner-close-btn')) {
        dismissBanner();
        return;
      }
      dismissBanner();
      if (actionCallback) {
        actionCallback();
      } else {
        window.location.hash = '#admin';
      }
    });

    // Auto-dismiss after 5 seconds
    setTimeout(dismissBanner, 5000);
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
        const payload = JSON.parse(event.data);
        console.log('[Realtime] 📡 Received live event:', payload);

        if (payload.type === 'NEW_BOOKING') {
          const appt = payload.data;
          const clientName = appt?.customer?.name || 'New Client';
          const serviceName = appt?.service?.name || appt?.serviceNameSnapshot || 'Salon Service';
          const specialistName = appt?.staff?.name || appt?.stylist?.name || 'Assigned Specialist';
          const timeStr = appt?.startTime ? formatTime12h(appt.startTime) : 'Today';
          const price = appt?.price ? ` • ₹${appt.price}` : '';
          const eventKey = `booking:${appt?.id || appt?.appointmentNumber || Date.now()}`;

          SoundManager.playNewBookingChime();

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

        } else if (
          payload.type === 'BOOKING_CANCELLED' ||
          payload.type === 'CANCELLED' ||
          (payload.type === 'STATUS_UPDATED' && payload.data?.status === 'CANCELLED')
        ) {
          const appt = payload.data;
          const clientName = appt?.customer?.name || 'Client';
          const serviceName = appt?.service?.name || appt?.serviceNameSnapshot || 'Service';
          const timeStr = appt?.startTime ? formatTime12h(appt.startTime) : '';
          const reason = appt?.cancellationReason || appt?.reason || 'Reservation cancelled';
          const eventKey = `cancel:${appt?.id}:${Date.now()}`;

          SoundManager.playCancelAlert();

          this.dispatchNotification({
            badgeText: 'Slot Released',
            title: '❌ Appointment Cancelled',
            clientName,
            details: `${serviceName} • ${timeStr} cancelled (${reason})`,
            icon: '✕',
            variant: 'danger',
            eventKey,
            actionCallback: () => {
              if (window.salonDashboard) {
                window.salonDashboard.switchTab('queue');
              }
            },
          });

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
          } else if (status === 'IN_SERVICE') {
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
      console.warn('[Realtime] EventSource error, will reconnect automatically:', err);
    };
  }

  destroy() {
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
