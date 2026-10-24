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

const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const forceCloud = new URLSearchParams(window.location.search).get('cloud') === '1' || localStorage.getItem('use_cloud_backend') === 'true';
const useLocal = (isLocalhost && !forceCloud) || new URLSearchParams(window.location.search).get('local') === '1' || localStorage.getItem('use_local_backend') === 'true';

export const API_BASE = useLocal
  ? `http://${window.location.hostname || 'localhost'}:3000/api/v1`
  : 'https://salon-api-tuwo.onrender.com/api/v1';

// In-flight GET request deduplication pool
const inFlightRequests = new Map();

export class ApiError extends Error {
  constructor(message, status = 500, payload = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
  }
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

    // In-flight deduplication key for concurrent identical GET requests
    const dedupeKey = isGet ? `${session.namespace}:${endpoint}` : null;
    if (isGet && inFlightRequests.has(dedupeKey)) {
      return inFlightRequests.get(dedupeKey);
    }

    const requestPromise = this._execute(endpoint, options, session, retriesRemaining, isGet)
      .finally(() => {
        if (dedupeKey) inFlightRequests.delete(dedupeKey);
      });

    if (isGet) {
      inFlightRequests.set(dedupeKey, requestPromise);
    }

    return requestPromise;
  }

  static async _execute(endpoint, options, session, retriesRemaining, isGet) {
    const token = session.getAccessToken();

    const headers = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      ...options.headers,
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
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
        throw new ApiError(message, response.status, data);
      }

      // Standardize response unwrapping
      return data.data !== undefined ? data.data : data;

    } catch (err) {
      clearTimeout(timeoutId);

      // Network Offline / Abort retry logic for GET
      if (isGet && retriesRemaining > 0 && (err.name === 'AbortError' || err.message?.includes('Failed to fetch'))) {
        console.warn(`[HttpClient] Network hiccup on ${endpoint}. Retrying...`);
        await new Promise((r) => setTimeout(r, 800));
        return this.request(endpoint, options, session, retriesRemaining - 1);
      }

      throw err;
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
