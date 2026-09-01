// Realtime Event Stream, Audio Chimes & PWA Push Notification Dispatcher
import { API_BASE } from './api.js';

export class RealtimeNotifier {
  constructor(salonId, onEventCallback) {
    this.salonId = salonId;
    this.onEventCallback = onEventCallback;
    this.eventSource = null;
    this.audioCtx = null;
    this.init();
  }

  init() {
    this.initAudio();
    this.requestNotificationPermission();
    this.connect();
  }

  initAudio() {
    // Unlock Web Audio API on first user touch / click
    const unlockAudio = () => {
      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
          this.audioCtx = new AudioContextClass();
        }
      }
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };

    window.addEventListener('click', unlockAudio, { once: true });
    window.addEventListener('touchstart', unlockAudio, { once: true });
  }

  playLuxuryChime() {
    try {
      if (!this.audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) this.audioCtx = new AudioContextClass();
      }

      if (!this.audioCtx) return;
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

      const now = this.audioCtx.currentTime;

      // Note 1: E5 (659.25 Hz)
      const osc1 = this.audioCtx.createOscillator();
      const gain1 = this.audioCtx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(659.25, now);
      gain1.gain.setValueAtTime(0.35, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.55);
      osc1.connect(gain1);
      gain1.connect(this.audioCtx.destination);
      osc1.start(now);
      osc1.stop(now + 0.6);

      // Note 2: B5 (987.77 Hz) - Harmonic shimmer
      const osc2 = this.audioCtx.createOscillator();
      const gain2 = this.audioCtx.createGain();
      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(987.77, now + 0.12);
      gain2.gain.setValueAtTime(0.4, now + 0.12);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.75);
      osc2.connect(gain2);
      gain2.connect(this.audioCtx.destination);
      osc2.start(now + 0.12);
      osc2.stop(now + 0.8);
    } catch (e) {
      console.warn('[Realtime] Audio chime failed:', e);
    }
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
    toast.className = 'live-toast-card';
    toast.style.cssText = `
      pointer-events: auto;
      background: rgba(15, 22, 36, 0.95);
      border: 1px solid rgba(99, 102, 241, 0.5);
      border-radius: 14px;
      padding: 14px 18px;
      display: flex;
      align-items: center;
      gap: 12px;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.75), 0 0 20px rgba(99, 102, 241, 0.35);
      backdrop-filter: blur(16px);
      color: #fff;
      min-width: 290px;
      max-width: 380px;
      animation: slideInToast 0.35s cubic-bezier(0.16, 1, 0.3, 1);
    `;

    toast.innerHTML = `
      <div style="font-size: 1.8rem; background: rgba(99,102,241,0.2); width: 42px; height: 42px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
        ${icon}
      </div>
      <div style="flex: 1;">
        <div style="font-weight: 800; font-size: 0.92rem; color: #fff;">${title}</div>
        <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 2px;">${message}</div>
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

          this.playLuxuryChime();
          this.showToastAlert('⚡ New Booking Alert!', `${clientName} booked ${serviceName} at ${timeStr} with ${specialistName}`, '⚡');
          this.showNativeNotification('⚡ New Salon Booking!', `${clientName} booked ${serviceName} with ${specialistName}`);
        } else if (payload.type === 'STATUS_UPDATED') {
          const appt = payload.data;
          const clientName = appt?.customer?.name || 'Client';
          const status = appt?.status || 'UPDATED';

          this.playLuxuryChime();
          this.showToastAlert('Status Updated', `${clientName}'s appointment is now ${status.replace('_', ' ')}`, '🔄');
        } else if (payload.type === 'RESCHEDULED') {
          const appt = payload.data;
          const clientName = appt?.customer?.name || 'Client';

          this.playLuxuryChime();
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
