// Realtime Event Stream, Audio Chimes & Professional PWA Notification Dispatcher
import { API_BASE, formatTime12h, getClientId } from './api.js';
import { SoundManager } from './sound.js';
import { AppSnackbar } from './modules/shared/app-snackbar.js';

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

  /**
   * Architectural Originator Check
   * Returns true if the event was originated by the current client session.
   */
  isSelfOrigin(payload) {
    if (!payload) return false;
    const currentClientId = typeof getClientId === 'function' ? getClientId() : '';
    return Boolean(currentClientId && payload.originatorClientId && payload.originatorClientId === currentClientId);
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

  /**
   * Unified In-App Live Notification
   * Delegates directly to AppSnackbar for consistent luxury UI across all states.
   */
  static showLuxuryBanner({ badgeText, title, clientName, details, specialist, icon = '⚡', variant = 'info', actionCallback, showActionBtn = false }) {
    const cardTitle = badgeText || title || 'Live Update';
    let messageText = clientName || title || '';
    if (details) {
      messageText = messageText ? `${messageText} — ${details}` : details;
    }
    if (specialist) {
      messageText = `${messageText} (Specialist: ${specialist})`;
    }

    const normalizedVariant = (variant === 'danger' || variant === 'error')
      ? 'error'
      : (variant === 'warning' ? 'warning' : (variant === 'success' ? 'success' : 'info'));

    const effectiveCallback = actionCallback || (showActionBtn ? () => { window.location.hash = '#admin'; } : null);

    return AppSnackbar.show(messageText, normalizedVariant, {
      title: cardTitle,
      icon,
      actionText: effectiveCallback ? 'View Queue' : null,
      actionCallback: effectiveCallback,
    });
  }

  showLuxuryBanner(options) {
    return RealtimeNotifier.showLuxuryBanner(options);
  }

  connect() {
    if (!this.salonId) return;

    const clientId = typeof getClientId === 'function' ? getClientId() : '';
    const streamUrl = `${API_BASE}/appointments/stream/${this.salonId}${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ''}`;
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

        // Architectural Self-Action Suppression:
        // If the event was originated by this client session, silently sync state and drop redundant banners/chimes
        if (this.isSelfOrigin(payload)) {
          console.log(`[Realtime] 🛡️ Suppressing UI banner for self-originated event (${payload.type})`);
          if (this.onEventCallback) {
            this.onEventCallback(payload);
          }
          return;
        }

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

          // Refresh open quick requests modal or badge without heavy full reload
          if (isQuickRequest && document.getElementById('modal-quick-requests')) {
            window.salonDashboard?.openQuickRequestsModal?.();
          }
          if (window.salonDashboard?.updateQuickRequestsBadge) {
            window.salonDashboard.updateQuickRequestsBadge();
          }

        } else if (
          payload.type === 'BOOKING_CANCELLED' ||
          payload.type === 'CANCELLED' ||
          payload.type === 'BOOKING_REJECTED' ||
          payload.type === 'REJECTED' ||
          (payload.type === 'STATUS_UPDATED' && (payload.data?.status === 'CANCELLED' || payload.data?.status === 'REJECTED'))
        ) {
          const appt = payload.data;
          const isRejected = appt?.status === 'REJECTED' || payload.type.includes('REJECT');
          const clientName = appt?.customer?.name || appt?.user?.name || appt?.salonUser?.user?.name || 'Client';
          const svcs = (typeof window !== 'undefined' && window.getApptServices) ? window.getApptServices(appt) : [];
          const serviceName = svcs.length > 0
            ? svcs.map((s) => s.name).join(' + ')
            : (appt?.serviceNameSnapshot || appt?.service?.name || 'Service');
          const timeStr = appt?.startTime ? formatTime12h(appt.startTime) : (appt?.startAt ? formatTime12h(appt.startAt) : '');
          const reason = appt?.cancellationReason || appt?.reason || (isRejected ? 'Declined or slot conflict' : 'Reservation cancelled');
          const eventKey = `${isRejected ? 'reject' : 'cancel'}:${appt?.id || 'unknown'}`;

          SoundManager.playCancelAlert();

          this.dispatchNotification({
            badgeText: isRejected ? 'Booking Declined' : 'Slot Released',
            title: isRejected ? 'Booking Request Declined' : '❌ Appointment Cancelled',
            clientName,
            details: `${serviceName}${timeStr ? ` • ${timeStr}` : ''} (${reason})`,
            icon: isRejected ? '✕' : '✕',
            variant: isRejected ? 'warning' : 'danger',
            eventKey,
            actionCallback: () => {
              if (window.salonDashboard) {
                window.salonDashboard.switchTab('queue');
              }
            },
          });

          // Auto-refresh the quick requests modal if it's already open
          if (document.getElementById('modal-quick-requests')) {
            window.salonDashboard?.openQuickRequestsModal?.();
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
        } else if (payload.type === 'STAFF_UPDATED' || payload.type === 'SERVICE_UPDATED') {
          // Architectural Separation of Concerns: Staff roster and service catalogue changes are strictly
          // background data synchronization / cache invalidation events. They refresh views silently without
          // interrupting the user with disruptive banners or chime sounds.
          console.log(`[Realtime] 🔄 Data sync event received (${payload.type}): local state syncing silently`);
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
