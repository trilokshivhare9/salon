/**
 * CENTRALIZED SESSION & TOKEN MANAGER
 * 
 * Manages dual-realm authentication state, token lifecycles (60-day tokens),
 * in-memory cache, localStorage persistence, and multi-tab synchronization.
 */

import { ENDPOINTS } from './endpoints.js';
import { NetworkHealth } from './network-health.js';

export class SessionRealm {
  constructor(namespace, defaultLoginRoute) {
    this.namespace = namespace;
    this.defaultLoginRoute = defaultLoginRoute;
    this.accessTokenKey = `${namespace}_access_token`;
    this.refreshTokenKey = `${namespace}_refresh_token`;
    this.userKey = `${namespace}_user_profile`;
    this.inMemoryToken = null;
    this.isRefreshing = false;
    this.refreshSubscribers = [];

    this.initSyncChannel();
  }

  initSyncChannel() {
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.channel = new BroadcastChannel(`session_sync_${this.namespace}`);
        this.channel.onmessage = (event) => {
          const { type, data } = event.data || {};
          if (type === 'LOGOUT') {
            this.handleCrossTabLogout();
          } else if (type === 'TOKEN_ROTATED') {
            if (data?.accessToken) {
              this.inMemoryToken = data.accessToken;
            }
          }
        };
      } catch (err) {
        console.warn(`[SessionRealm:${this.namespace}] BroadcastChannel init error:`, err);
      }
    }

    // Storage event fallback for older environments
    window.addEventListener('storage', (event) => {
      if (event.key === this.accessTokenKey && !event.newValue) {
        this.handleCrossTabLogout();
      }
    });
  }

  handleCrossTabLogout() {
    this.inMemoryToken = null;
    const currentHash = (window.location.hash || '').replace(/^#\/?/, '');
    if (this.namespace === 'platform' && (currentHash === 'super-admin' || currentHash === 'superadmin-login')) {
      window.location.hash = this.defaultLoginRoute;
    } else if (this.namespace === 'salon' && (currentHash === 'admin' || currentHash.startsWith('admin/'))) {
      window.location.hash = this.defaultLoginRoute;
    }
  }

  getAccessToken() {
    return this.inMemoryToken || localStorage.getItem(this.accessTokenKey);
  }

  setAccessToken(token) {
    this.inMemoryToken = token || null;
    if (token) {
      localStorage.setItem(this.accessTokenKey, token);
      this.channel?.postMessage({ type: 'TOKEN_ROTATED', data: { accessToken: token } });
    } else {
      localStorage.removeItem(this.accessTokenKey);
    }
  }

  getRefreshToken() {
    return localStorage.getItem(this.refreshTokenKey);
  }

  setRefreshToken(token) {
    if (token) localStorage.setItem(this.refreshTokenKey, token);
    else localStorage.removeItem(this.refreshTokenKey);
  }

  getUser() {
    try {
      const token = this.getAccessToken();
      const refreshToken = this.getRefreshToken();
      if (!token && !refreshToken) return null;
      if (token && this.isTokenExpired(token) && !refreshToken) return null;

      const raw = localStorage.getItem(this.userKey);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  setUser(user) {
    if (user) localStorage.setItem(this.userKey, JSON.stringify(user));
    else localStorage.removeItem(this.userKey);
  }

  isAuthenticated() {
    const token = this.getAccessToken();
    const refreshToken = this.getRefreshToken();
    if (token && !this.isTokenExpired(token)) return true;
    if (refreshToken && !this.isTokenExpired(refreshToken)) return true;
    return false;
  }

  isTokenExpired(token, bufferSeconds = 30) {
    if (!token || typeof token !== 'string') return true;
    const parts = token.split('.');
    if (parts.length !== 3) {
      // Opaque token (e.g. refresh token rt_...); server-side validated only
      return false;
    }
    try {
      const base64Url = parts[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(decodeURIComponent(escape(window.atob(base64))));
      if (!payload || !payload.exp) return false;
      return Date.now() >= (payload.exp * 1000) - (bufferSeconds * 1000);
    } catch {
      return false;
    }
  }

  async refreshAccessToken() {
    const rawRefreshToken = this.getRefreshToken();
    if (!rawRefreshToken) {
      this.clear();
      throw new Error('Refresh token missing');
    }

    const apiBase = NetworkHealth.getApiBase();

    const refreshRes = await fetch(`${apiBase}${ENDPOINTS.AUTH.REFRESH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rawRefreshToken }),
    });

    if (!refreshRes.ok) {
      this.clear();
      throw new Error('Refresh token invalid or expired');
    }

    const refreshData = await refreshRes.json();
    const result = refreshData.data !== undefined ? refreshData.data : refreshData;

    this.setAccessToken(result.accessToken);
    if (result.refreshToken) this.setRefreshToken(result.refreshToken);
    if (result.user) this.setUser(result.user);

    return result;
  }

  clear() {
    this.inMemoryToken = null;
    localStorage.removeItem(this.accessTokenKey);
    localStorage.removeItem(this.refreshTokenKey);
    localStorage.removeItem(this.userKey);
    this.refreshSubscribers = [];
    this.isRefreshing = false;

    this.channel?.postMessage({ type: 'LOGOUT' });
  }
}

// Global realm instances
export const SalonSession = new SessionRealm('salon', '#login');
export const PlatformSession = new SessionRealm('platform', '#superadmin-login');
