// Realtime Event Stream, Audio Chimes & PWA Push Notification Dispatcher
import { API_BASE } from './api.js';
import { SoundManager } from './sound.js';

export class RealtimeNotifier {
  constructor(salonId, onEventCallback) {
    this.salonId = salonId;
    this.onEventCallback = onEventCallback;
    this.eventSource = null;
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

  showNativeNotification(title, body) {
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body,
          icon: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>✂️</text></svg>',
          badge: 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>⚡</text></svg>',
          vibrate: [200, 100, 200],
        });
      } catch (e) {
        console.warn('[Realtime] Native notification failed:', e);
      }
    }
  }

  showToastAlert(title, message, icon = '🔔') {
    let container = document.getElementById('live-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'live-toast-container';
      container.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 10000;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
        max-width: calc(100vw - 40px);
      `;
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.style.cssText = `
      background: rgba(15, 23, 42, 0.96);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(99, 102, 241, 0.4);
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5), 0 0 20px rgba(99, 102, 241, 0.2);
      border-radius: 12px;
      padding: 14px 18px;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 280px;
      animation: slideInRight 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    `;

    toast.innerHTML = `
      <div style="font-size: 1.6rem; background: rgba(99, 102, 241, 0.2); width: 42px; height: 42px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${icon}</div>
      <div style="flex: 1;">
        <div style="font-weight: 700; font-size: 0.95rem; color: #fff;">${title}</div>
        <div style="font-size: 0.8rem; color: #94a3b8; margin-top: 2px;">${message}</div>
      </div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(30px)';
      setTimeout(() => toast.remove(), 400);
    }, 4500);
  }

  connect() {
    if (!this.salonId) return;

    const streamUrl = `${API_BASE}/appointments/stream/${this.salonId}`;
    console.log('[Realtime] Connecting to Live Event Stream:', streamUrl);

    if (this.eventSource) {
      this.eventSource.close();
    }

    this.eventSource = new EventSource(streamUrl);

    this.eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        console.log('[Realtime] Received live event:', payload);

        // Handle event types
        if (payload.type === 'NEW_BOOKING') {
          const appt = payload.data;
          const clientName = appt?.customer?.name || 'Client';
          const serviceName = appt?.service?.name || 'Service';
          const specialistName = appt?.staff?.name || 'Specialist';
          const timeStr = appt?.startTime ? new Date(appt.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Today';

          SoundManager.playNewBookingChime();
          this.showToastAlert('⚡ New Booking Alert!', `${clientName} booked ${serviceName} at ${timeStr} with ${specialistName}`, '⚡');
          this.showNativeNotification('⚡ New Salon Booking!', `${clientName} booked ${serviceName} with ${specialistName}`);
        } else if (payload.type === 'STATUS_UPDATED') {
          const appt = payload.data;
          const clientName = appt?.customer?.name || 'Client';
          const status = appt?.status || 'UPDATED';

          if (status === 'CHECKED_IN') {
            SoundManager.playCheckinChime();
          } else {
            SoundManager.playCheckinChime();
          }
          this.showToastAlert('Status Updated', `${clientName}'s appointment is now ${status.replace('_', ' ')}`, '🔄');
        } else if (payload.type === 'APPOINTMENT_UPDATED') {
          const appt = payload.data;
          if (appt?.clientEtaStatus === 'ON_WAY_10M') {
            SoundManager.playLateAlert();
            this.showToastAlert('🚗 Client Running Late (~10m)', `${appt.customer?.name || 'Client'} notified arrival in ~10 minutes.`, '🚗');
          }
        } else if (payload.type === 'RESCHEDULED') {
          const appt = payload.data;
          const clientName = appt?.customer?.name || 'Client';

          SoundManager.playCheckinChime();
          this.showToastAlert('Appointment Rescheduled', `${clientName}'s appointment was rescheduled`, '🔄');
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
      console.warn('[Realtime] EventSource error, will reconnect:', err);
    };
  }

  destroy() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}
