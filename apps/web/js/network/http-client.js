/**
 * RESILIENT HTTP CLIENT GATEWAY
 * 
 * Centralized network gateway for 100% of API requests.
 * Features:
 * - Environment auto-detection (localhost vs cloud)
 * - Single-flight 401 Token Refresh Mutex with Request Replay Queue
 * - In-flight GET promise deduplication
 * - Automatic exponential backoff retries on transient network drops
 * - Unified response normalization
 */

import { SalonSession, PlatformSession } from './session-manager.js';
import { ENDPOINTS } from './endpoints.js';
import { NetworkHealth, ConnectionState } from './network-health.js';

export let API_BASE = NetworkHealth.getApiBase();

NetworkHealth.on('targetChanged', ({ apiBase }) => {
  API_BASE = apiBase;
});

// In-flight GET request deduplication pool
const inFlightRequests = new Map();
// In-flight Mutation Mutex Pool (prevents duplicate writes across all forms/buttons)
const inFlightMutations = new Map();

export class ApiError extends Error {
  constructor(message, status = 500, payload = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
}

export function getClientId() {
  if (typeof window === 'undefined' || !window.sessionStorage) return 'server-session';
  let id = window.sessionStorage.getItem('salon_client_id');
  if (!id) {
    id = 'cid_' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
    window.sessionStorage.setItem('salon_client_id', id);
  }
  return id;
}

export class HttpClient {
  /**
   * Dispatches an HTTP request through the resilient gateway.
   * 
   * @param {string} endpoint - API endpoint (from ENDPOINTS registry)
   * @param {object} options - Fetch options (method, body, headers, etc.)
   * @param {SessionRealm} session - Realm session manager (SalonSession | PlatformSession)
   * @param {number} retriesRemaining - Automatic retry counter
   */
  static async request(endpoint, options = {}, session = SalonSession, retriesRemaining = 2) {
    const method = (options.method || 'GET').toUpperCase();
    const isGet = method === 'GET';

    // Track user-initiated mutations to suppress duplicate SSE self-echoes across the entire app
    if (!isGet && typeof window !== 'undefined') {
      const now = Date.now();
      window.lastLocalActionTimestamp = now;
      window.lastDashboardActionTimestamp = now;
      if (window.salonDashboard) window.salonDashboard.lastLocalActionTimestamp = now;
      if (window.dashboardApp) window.dashboardApp.lastLocalActionTimestamp = now;
    }

    // 1. In-flight deduplication key for concurrent identical GET requests
    const dedupeKey = isGet ? `${session?.namespace || 'public'}:${endpoint}` : null;
    if (isGet && inFlightRequests.has(dedupeKey)) {
      return inFlightRequests.get(dedupeKey);
    }

    // 2. In-flight mutation signature: METHOD:namespace:endpoint:body
    const mutationKey = !isGet ? `${method}:${session?.namespace || 'public'}:${endpoint}:${options.body || ''}` : null;
    if (mutationKey && inFlightMutations.has(mutationKey)) {
      console.warn(`[HttpClient] In-flight mutation detected, joining active promise for ${method} ${endpoint}`);
      return inFlightMutations.get(mutationKey);
    }

    const requestPromise = this._execute(endpoint, options, session, retriesRemaining, isGet)
      .finally(() => {
        if (!isGet && typeof window !== 'undefined') {
          const finishedNow = Date.now();
          window.lastLocalActionTimestamp = finishedNow;
          window.lastDashboardActionTimestamp = finishedNow;
          if (window.salonDashboard) window.salonDashboard.lastLocalActionTimestamp = finishedNow;
          if (window.dashboardApp) window.dashboardApp.lastLocalActionTimestamp = finishedNow;
        }
        if (dedupeKey) inFlightRequests.delete(dedupeKey);
        if (mutationKey) inFlightMutations.delete(mutationKey);
      });

    if (isGet) {
      inFlightRequests.set(dedupeKey, requestPromise);
    } else if (mutationKey) {
      inFlightMutations.set(mutationKey, requestPromise);
    }

    return requestPromise;
  }

  static async _execute(endpoint, options, session, retriesRemaining, isGet) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      NetworkHealth.recordFailure(new Error('No internet connection'), endpoint, 0);
      throw new ApiError('You are currently offline. Please check your internet connection.', 0);
    }

    const token = session.getAccessToken();

    const headers = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'X-Client-Id': getClientId(),
      ...options.headers,
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Attach Idempotency-Key on all mutating requests (Stripe standard)
    if (!isGet && !headers['Idempotency-Key'] && typeof crypto !== 'undefined' && crypto.randomUUID) {
      headers['Idempotency-Key'] = crypto.randomUUID();
    }

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs || 35000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        cache: 'no-store',
        headers,
        signal: options.signal || controller.signal,
      });

      clearTimeout(timeoutId);

      let data;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await response.json().catch(() => ({}));
      } else {
        const text = await response.text().catch(() => '');
        data = { message: text || `HTTP ${response.status}: ${response.statusText}` };
      }

      // 401 Interception with Single-Flight Refresh Mutex & Replay Queue
      const isAuthEndpoint = endpoint.includes(ENDPOINTS.AUTH.LOGIN) || endpoint.includes(ENDPOINTS.AUTH.REFRESH);
      if (response.status === 401 && !isAuthEndpoint) {
        return this._handle401(session, endpoint, options);
      }

      // Transient Server Error Auto-Retry (502, 503, 504 - Render cold start / timeout)
      if (isGet && retriesRemaining > 0 && [502, 503, 504].includes(response.status)) {
        console.warn(`[HttpClient] Transient ${response.status} on ${endpoint}. Retrying (${retriesRemaining} left)...`);
        await new Promise((r) => setTimeout(r, 1000 * (3 - retriesRemaining)));
        return this.request(endpoint, options, session, retriesRemaining - 1);
      }

      if (!response.ok) {
        const message = data.message || `Request failed with status ${response.status}`;
        if (response.status >= 500) {
          NetworkHealth.recordFailure(new Error(message), endpoint, response.status);
        }
        throw new ApiError(message, response.status, data);
      }

      NetworkHealth.recordSuccess(endpoint);

      // Standardize response unwrapping
      return data.data !== undefined ? data.data : data;

    } catch (err) {
      clearTimeout(timeoutId);

      if (err instanceof ApiError) {
        throw err;
      }

      const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      const isConnectionDown = err.name === 'TypeError' || err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError');
      const isTimeout = err.name === 'AbortError';

      // Record failure with NetworkHealth immediately
      NetworkHealth.recordFailure(err, endpoint, 0);

      // Transient Network Offline / Abort retry logic for GET (only retry once if transient)
      if (isGet && retriesRemaining > 0 && (isTimeout || (!isOffline && isConnectionDown && retriesRemaining > 1))) {
        console.warn(`[HttpClient] Network retry on ${endpoint} (${retriesRemaining} left)...`);
        await new Promise((r) => setTimeout(r, 500));
        return this.request(endpoint, options, session, retriesRemaining - 1);
      }

      if (isOffline) {
        throw new ApiError('You are currently offline. Please check your internet connection.', 0, { originalError: err.message });
      }

      if (isConnectionDown) {
        throw new ApiError('Unable to reach the salon service. Please check your connection and try again.', 0, { originalError: err.message });
      }

      if (isTimeout) {
        throw new ApiError('The server took too long to respond. Please try again.', 408, { originalError: err.message });
      }

      throw new ApiError(err.message || 'An unexpected network error occurred.', 500, { originalError: err });
    }
  }

  /**
   * Coordinates token refresh without race conditions.
   * Pauses all concurrent callers and replays them when token rotates.
   */
  static async _handle401(session, endpoint, options) {
    if (!session.isRefreshing) {
      session.isRefreshing = true;

      try {
        const refreshToken = session.getRefreshToken();
        if (!refreshToken) {
          throw new Error('Refresh token missing');
        }

        const refreshRes = await fetch(`${API_BASE}${ENDPOINTS.AUTH.REFRESH}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });

        if (!refreshRes.ok) {
          throw new Error('Refresh token invalid or expired');
        }

        const refreshData = await refreshRes.json();
        const result = refreshData.data !== undefined ? refreshData.data : refreshData;

        session.setAccessToken(result.accessToken);
        if (result.refreshToken) session.setRefreshToken(result.refreshToken);
        if (result.user) session.setUser(result.user);

        session.isRefreshing = false;

        // Drain Replay Queue
        const subscribers = [...session.refreshSubscribers];
        session.refreshSubscribers = [];
        subscribers.forEach((resolve) => resolve(result.accessToken));

        // Replay current request
        return this.request(endpoint, options, session, 0);

      } catch (refreshErr) {
        session.isRefreshing = false;
        session.refreshSubscribers = [];
        session.clear();

        if (typeof window.onAuthFailure === 'function') {
          window.onAuthFailure();
        } else {
          window.location.hash = session.defaultLoginRoute;
        }

        throw new ApiError('Session expired. Please sign in again.', 401);
      }
    } else {
      // Enqueue to Replay Queue until refresh completes
      return new Promise((resolve, reject) => {
        session.refreshSubscribers.push((newToken) => {
          options.headers = { ...options.headers, Authorization: `Bearer ${newToken}` };
          this.request(endpoint, options, session, 0).then(resolve).catch(reject);
        });
      });
    }
  }
}
