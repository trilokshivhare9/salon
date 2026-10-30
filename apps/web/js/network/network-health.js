/**
 * CENTRALIZED NETWORK & SYSTEM HEALTH MANAGER
 * 
 * Tracks real-time connection status across the application:
 * - ONLINE: Server reachable and healthy
 * - CONNECTING: Network probe in flight
 * - OFFLINE: Device network is disconnected (navigator.onLine === false)
 * - SERVER_UNREACHABLE: Backend is offline, connection refused (e.g. port down)
 * - DEGRADED: Server returning 5xx or experiencing severe timeouts
 * 
 * Provides automated silent reconnection loops, error diagnostic details,
 * and zero-reload backend target switching (Localhost vs Cloud).
 */

export const ConnectionState = {
  ONLINE: 'ONLINE',
  CONNECTING: 'CONNECTING',
  OFFLINE: 'OFFLINE',
  SERVER_UNREACHABLE: 'SERVER_UNREACHABLE',
  DEGRADED: 'DEGRADED',
};

class NetworkHealthManager {
  constructor() {
    this.state = navigator.onLine ? ConnectionState.CONNECTING : ConnectionState.OFFLINE;
    this.lastError = null;
    this.lastCheckedAt = null;
    this.listeners = new Map();
    this.reconnectTimer = null;
    this.probeInFlight = false;

    // Browser online/offline event listeners
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        console.log('[NetworkHealth] Browser detected network restoration.');
        this.checkHealth();
      });

      window.addEventListener('offline', () => {
        console.warn('[NetworkHealth] Browser went offline.');
        this.setState(ConnectionState.OFFLINE, { message: 'Internet connection lost.' });
      });
    }
  }

  // Event Subscription System
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.listeners.get(event)?.delete(callback);
  }

  emit(event, data) {
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      callbacks.forEach((cb) => {
        try { cb(data); } catch (e) { console.error(`[NetworkHealth] Listener error on ${event}:`, e); }
      });
    }
  }

  getState() {
    return this.state;
  }

  isOnline() {
    return this.state === ConnectionState.ONLINE;
  }

  isServerUnreachable() {
    return this.state === ConnectionState.SERVER_UNREACHABLE || this.state === ConnectionState.OFFLINE;
  }

  getLastError() {
    return this.lastError;
  }

  setState(newState, errorDetails = null) {
    const previousState = this.state;
    this.state = newState;
    if (errorDetails) {
      this.lastError = {
        ...errorDetails,
        timestamp: Date.now(),
      };
    } else if (newState === ConnectionState.ONLINE) {
      this.lastError = null;
    }

    if (previousState !== newState) {
      console.log(`[NetworkHealth] State transitioned: ${previousState} ➔ ${newState}`);
      this.emit('stateChanged', {
        state: newState,
        previousState,
        error: this.lastError,
        apiBase: this.getApiBase(),
      });
    }
  }

  getApiBase() {
    if (typeof window === 'undefined') return 'http://localhost:3000/api/v1';

    const host = window.location.hostname;
    const isLocalhost = host === 'localhost' || host === '127.0.0.1';
    const params = new URLSearchParams(window.location.search);

    // 1. Explicit query parameter or localStorage overrides
    if (params.get('render') === '1' || localStorage.getItem('use_render_backend') === 'true') {
      return 'https://salon-api-tuwo.onrender.com/api/v1';
    }
    if (params.get('vps') === '1' || localStorage.getItem('use_vps_backend') === 'true') {
      return 'http://129.121.133.105/api/v1';
    }
    if (params.get('local') === '1' || localStorage.getItem('use_local_backend') === 'true') {
      return `http://${host || 'localhost'}:3000/api/v1`;
    }

    // 2. If running locally on development machine (port 5173, 8080, etc.)
    if (isLocalhost) {
      if (params.get('cloud') === '1' || localStorage.getItem('use_cloud_backend') === 'true') {
        return 'http://129.121.133.105/api/v1';
      }
      return `http://${host}:3000/api/v1`;
    }

    // 3. If running on legacy Render frontend
    if (host.includes('onrender.com')) {
      return 'https://salon-api-tuwo.onrender.com/api/v1';
    }

    // 4. Production Mumbai VPS (129.121.133.105 or custom domain):
    // Nginx directly reverse-proxies /api/ to the local NestJS backend on port 3000!
    return `${window.location.origin}/api/v1`;
  }

  isUsingLocal() {
    const base = this.getApiBase();
    return base.includes('localhost') || base.includes('127.0.0.1');
  }

  switchBackend(target = 'vps') {
    if (target === 'render') {
      localStorage.setItem('use_render_backend', 'true');
      localStorage.removeItem('use_local_backend');
      localStorage.removeItem('use_vps_backend');
      localStorage.removeItem('use_cloud_backend');
    } else if (target === 'local') {
      localStorage.setItem('use_local_backend', 'true');
      localStorage.removeItem('use_render_backend');
      localStorage.removeItem('use_vps_backend');
      localStorage.removeItem('use_cloud_backend');
    } else {
      localStorage.removeItem('use_render_backend');
      localStorage.removeItem('use_local_backend');
      localStorage.removeItem('use_vps_backend');
      localStorage.removeItem('use_cloud_backend');
    }
    console.log(`[NetworkHealth] Switched backend target to ${target}. New target: ${this.getApiBase()}`);
    this.emit('targetChanged', { target, apiBase: this.getApiBase() });
    return this.checkHealth();
  }

  recordSuccess(endpoint = '') {
    this.lastCheckedAt = Date.now();
    if (this.state !== ConnectionState.ONLINE) {
      this.setState(ConnectionState.ONLINE);
      this.stopAutoReconnect();
    }
  }

  recordFailure(error, endpoint = '', status = null) {
    this.lastCheckedAt = Date.now();

    if (!navigator.onLine) {
      this.setState(ConnectionState.OFFLINE, {
        message: 'No internet connection.',
        endpoint,
        status: 0,
      });
      this.startAutoReconnect();
      return;
    }

    const isConnectionRefused = error?.message?.includes('Failed to fetch') ||
      error?.name === 'TypeError' ||
      error?.message?.includes('NetworkError') ||
      status === 0;

    if (isConnectionRefused) {
      this.setState(ConnectionState.SERVER_UNREACHABLE, {
        message: 'Salon server is offline or unreachable.',
        endpoint,
        status: status || 0,
        originalError: error?.message || 'Connection refused',
      });
      this.startAutoReconnect();
    } else if (status >= 500) {
      this.setState(ConnectionState.DEGRADED, {
        message: `Server returned temporary error (HTTP ${status}).`,
        endpoint,
        status,
        originalError: error?.message,
      });
      this.startAutoReconnect();
    }
  }

  /**
   * Fast, non-blocking health probe with a strict 3.5s timeout.
   */
  async checkHealth() {
    if (this.probeInFlight) return this.state === ConnectionState.ONLINE;
    this.probeInFlight = true;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    const targetUrl = `${this.getApiBase()}/auth/me`;

    try {
      const response = await fetch(targetUrl, {
        method: 'GET',
        headers: { 'Cache-Control': 'no-cache' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // Even if 401 Unauthorized, the server is healthy and responding!
      if (response.status < 500) {
        this.recordSuccess('/auth/me');
        this.probeInFlight = false;
        return true;
      } else {
        this.recordFailure(new Error(`Server returned ${response.status}`), '/auth/me', response.status);
        this.probeInFlight = false;
        return false;
      }
    } catch (err) {
      clearTimeout(timeoutId);
      this.recordFailure(err, '/auth/me', 0);
      this.probeInFlight = false;
      return false;
    }
  }

  startAutoReconnect(intervalMs = 7000) {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setInterval(async () => {
      if (this.state === ConnectionState.ONLINE) {
        this.stopAutoReconnect();
        return;
      }

      console.log('[NetworkHealth] Probing backend recovery...');
      const isAlive = await this.checkHealth();
      if (isAlive) {
        console.log('[NetworkHealth] Backend recovered successfully!');
        this.stopAutoReconnect();
        this.emit('serverRestored', { apiBase: this.getApiBase() });
      }
    }, intervalMs);
  }

  stopAutoReconnect() {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

export const NetworkHealth = new NetworkHealthManager();
