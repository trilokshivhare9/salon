const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const forceCloud = new URLSearchParams(window.location.search).get('cloud') === '1' || localStorage.getItem('use_cloud_backend') === 'true';
const useLocal = (isLocalhost && !forceCloud) || new URLSearchParams(window.location.search).get('local') === '1' || localStorage.getItem('use_local_backend') === 'true';

export const API_BASE = useLocal
  ? `http://${window.location.hostname || 'localhost'}:3000/api/v1`
  : 'https://salon-api-tuwo.onrender.com/api/v1';

const memoryCache = new Map();

/**
 * REFRESH TRANSPORT ABSTRACTION
 * Encapsulates refresh token storage.
 * To migrate to HttpOnly Cookies in the future, these 3 methods become no-ops.
 * Security Trade-off Note: Storing refresh tokens in browser storage carries XSS trade-offs, 
 * which is why Access Tokens are strictly kept in-memory.
 */
export class RefreshTransport {
  static getRefreshToken() {
    return localStorage.getItem('salon_refresh_token');
  }

  static setRefreshToken(token) {
    if (token) localStorage.setItem('salon_refresh_token', token);
  }

  static clearRefreshToken() {
    localStorage.removeItem('salon_refresh_token');
  }
}

// Global In-Memory Access Token & Refresh Mutex Queue
let inMemoryAccessToken = null;
let isRefreshing = false;
let refreshSubscribers = [];

function subscribeTokenRefresh(cb) {
  refreshSubscribers.push(cb);
}

function onRefreshed(token) {
  refreshSubscribers.forEach((cb) => cb(token));
  refreshSubscribers = [];
}

const authChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('salon_auth_sync') : null;

export class ApiClient {
  static parseJwt(token) {
    try {
      if (!token || typeof token !== 'string') return null;
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const base64Url = parts[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(
        atob(base64)
          .split('')
          .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
          .join('')
      );
      return JSON.parse(jsonPayload);
    } catch {
      return null;
    }
  }

  static isTokenExpired(token) {
    const payload = this.parseJwt(token);
    if (!payload || !payload.exp) return true;
    return Date.now() >= payload.exp * 1000 - 15000; // 15s buffer
  }

  static getAccessToken() {
    return inMemoryAccessToken;
  }

  static setAccessToken(token) {
    inMemoryAccessToken = token || null;
  }

  static getTenantContext() {
    const token = this.getAccessToken();
    const payload = this.parseJwt(token);
    const user = this.getUser();
    return user?.salonId || payload?.salonId || payload?.sub || 'public';
  }

  static getSuperAdminToken() {
    return inMemoryAccessToken || localStorage.getItem('super_admin_token');
  }

  static setSuperAdminToken(token) {
    inMemoryAccessToken = token;
    if (token) localStorage.setItem('super_admin_token', token);
  }

  static removeSuperAdminToken() {
    localStorage.removeItem('super_admin_token');
    localStorage.removeItem('super_admin_user');
  }

  static getSuperAdminUser() {
    try {
      const raw = localStorage.getItem('super_admin_user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  static setSuperAdminUser(user) {
    if (user) localStorage.setItem('super_admin_user', JSON.stringify(user));
  }

  static getToken() {
    return inMemoryAccessToken;
  }

  static setToken(token) {
    inMemoryAccessToken = token || null;
  }

  static removeToken() {
    inMemoryAccessToken = null;
  }

  static getUser() {
    try {
      const raw = localStorage.getItem('salon_user_data');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  static setUser(user) {
    if (user) {
      localStorage.setItem('salon_user_data', JSON.stringify(user));
      const identifier = user.phone || user.email;
      if (identifier) localStorage.setItem('last_user_identifier', identifier);
    }
  }

  static removeUser() {
    localStorage.removeItem('salon_user_data');
  }

  static clearSession(broadcast = true) {
    this.removeToken();
    this.removeUser();
    RefreshTransport.clearRefreshToken();
    this.removeSuperAdminToken();
    this.invalidateCache();
    if (broadcast && authChannel) {
      authChannel.postMessage({ type: 'LOGOUT', timestamp: Date.now() });
    }
  }

  static invalidateCache(pattern = '') {
    if (!pattern) {
      memoryCache.clear();
      return;
    }
    for (const key of memoryCache.keys()) {
      if (key.includes(pattern)) {
        memoryCache.delete(key);
      }
    }
  }

  static async refreshSession() {
    const rawRefreshToken = RefreshTransport.getRefreshToken();
    if (!rawRefreshToken) {
      throw new Error('No refresh token available');
    }

    const response = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rawRefreshToken }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      RefreshTransport.clearRefreshToken();
      this.clearSession(false);
      throw new Error(errData.message || 'Session expired or refresh failed');
    }

    const data = await response.json();
    const result = data.data !== undefined ? data.data : data;

    if (result.accessToken) {
      this.setAccessToken(result.accessToken);
    }
    if (result.refreshToken) {
      RefreshTransport.setRefreshToken(result.refreshToken);
    }
    if (result.user) {
      this.setUser(result.user);
    }

    return result;
  }

  static async request(endpoint, options = {}, ttlMs = 0) {
    const isGet = !options.method || options.method === 'GET';
    const tenantContext = this.getTenantContext();
    const cacheKey = `${tenantContext}:${endpoint}`;

    // Tenant-Scoped Cache hit — return immediately
    if (isGet && ttlMs > 0) {
      const cached = memoryCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < ttlMs) {
        return cached.data;
      }
    }

    const token = this.getToken();

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
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || 45000);

    let coldStartTimer = setTimeout(() => {
      if (!document.getElementById('cold-start-banner')) {
        const banner = document.createElement('div');
        banner.id = 'cold-start-banner';
        banner.style.cssText = 'position:fixed; top:calc(env(safe-area-inset-top, 0px) + 12px); left:50%; transform:translateX(-50%); width:calc(100% - 24px); max-width:440px; z-index:999999; display:flex; align-items:center; justify-content:center; gap:10px; padding:10px 16px; background:rgba(30, 27, 75, 0.96); border:1px solid rgba(99, 102, 241, 0.6); border-radius:999px; color:#e0e7ff; font-family:var(--font-body, system-ui, sans-serif); font-size:13px; font-weight:600; box-shadow:0 12px 32px rgba(0,0,0,0.7), 0 0 16px rgba(99,102,241,0.25); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); text-align:center; box-sizing:border-box; animation: fadeIn 0.3s ease-out;';
        banner.innerHTML = `<span style="font-size:16px;">⚡</span> Waking up server after inactivity (~15s cold start)... Please wait!`;
        document.body.appendChild(banner);
      }
    }, 2500);

    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        cache: 'no-store',
        headers,
        signal: options.signal || controller.signal,
      });

      clearTimeout(timeoutId);
      clearTimeout(coldStartTimer);
      document.getElementById('cold-start-banner')?.remove();

      let data;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const text = await response.text();
        data = { message: text || `Server error (${response.status}: ${response.statusText})` };
      }

      // Handle 401 Unauthorized with Mutex Refresh Retry Queue
      if (response.status === 401 && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/refresh')) {
        if (!isRefreshing) {
          isRefreshing = true;
          try {
            const refreshRes = await this.refreshSession();
            isRefreshing = false;
            onRefreshed(refreshRes.accessToken);

            // Retry original request with new token
            options.headers = { ...options.headers, Authorization: `Bearer ${refreshRes.accessToken}` };
            return this.request(endpoint, options, ttlMs);
          } catch (refreshErr) {
            isRefreshing = false;
            refreshSubscribers = [];
            this.clearSession();
            if (typeof window.onAuthFailure === 'function') {
              window.onAuthFailure();
            }
            throw new Error(data.message || 'Session expired. Please log in again.');
          }
        } else {
          // Queue request during ongoing refresh mutex lock
          return new Promise((resolve, reject) => {
            subscribeTokenRefresh((newToken) => {
              options.headers = { ...options.headers, Authorization: `Bearer ${newToken}` };
              this.request(endpoint, options, ttlMs).then(resolve).catch(reject);
            });
          });
        }
      }

      if (!response.ok) {
        throw new Error(data.message || `Request failed with status ${response.status}`);
      }

      const result = data.data !== undefined ? data.data : data;

      if (isGet && ttlMs > 0) {
        memoryCache.set(cacheKey, { data: result, timestamp: Date.now() });
      }

      return result;
    } catch (err) {
      clearTimeout(timeoutId);
      clearTimeout(coldStartTimer);
      document.getElementById('cold-start-banner')?.remove();

      if (isGet && ttlMs > 0) {
        const stale = memoryCache.get(cacheKey);
        if (stale) {
          return stale.data;
        }
      }

      if (err.name === 'AbortError') {
        throw new Error('Request timed out. The cloud server may be waking up from sleep, please try again.');
      }
      throw err;
    }
  }

  /**
   * Stale-While-Revalidate: returns cached data instantly + refreshes in background.
   * @param {string} endpoint
   * @param {number} ttlMs - Cache TTL
   * @param {Function} onFreshData - Called with fresh data after background fetch completes
   * @returns {Promise<{data: any, isStale: boolean}>}
   */
  static async requestSWR(endpoint, ttlMs, onFreshData) {
    const tenantContext = this.getTenantContext();
    const cacheKey = `${tenantContext}:${endpoint}`;
    const cached = memoryCache.get(cacheKey);

    if (cached) {
      // Return stale data instantly, fetch fresh in background
      this.request(endpoint, {}, 0).then((freshData) => {
        memoryCache.set(cacheKey, { data: freshData, timestamp: Date.now() });
        if (onFreshData && JSON.stringify(freshData) !== JSON.stringify(cached.data)) {
          onFreshData(freshData);
        }
      }).catch(() => {}); // Silently fail background refresh

      return { data: cached.data, isStale: Date.now() - cached.timestamp > ttlMs };
    }

    // No cache — must fetch
    const freshData = await this.request(endpoint, {}, ttlMs);
    return { data: freshData, isStale: false };
  }

  // Auth
  static async login(email, password) {
    if (email) localStorage.setItem('last_user_identifier', email);
    this.clearSession(false);

    const data = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    const accessToken = data.accessToken || data.tokens?.accessToken;
    const refreshToken = data.refreshToken || data.tokens?.refreshToken;

    if (accessToken) {
      this.setAccessToken(accessToken);
    }
    if (refreshToken) {
      RefreshTransport.setRefreshToken(refreshToken);
    }
    if (data.user) {
      this.setUser(data.user);
    }

    this.invalidateCache();
    if (authChannel) {
      authChannel.postMessage({ type: 'LOGIN', timestamp: Date.now() });
    }
    return data;
  }

  static async logout() {
    const rawRefreshToken = RefreshTransport.getRefreshToken();
    try {
      if (rawRefreshToken) {
        await this.request('/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ refreshToken: rawRefreshToken }),
        }).catch(() => {});
      }
    } finally {
      this.clearSession(true);
    }
  }

  static async logoutAllDevices() {
    try {
      await this.request('/auth/logout-all', { method: 'POST' }).catch(() => {});
    } finally {
      this.clearSession(true);
    }
  }

  static async getMe() {
    const user = await this.request('/auth/me', {}, 60000); // 1-min cache
    if (user) {
      this.setUser(user);
    }
    return user;
  }

  // Public Booking
  static async getPublicSalon(slug) {
    return this.request(`/booking/${slug}`, {}, 120000); // 2-min cache
  }

  static async getPublicAvailability(slug, serviceId, date, staffId = null) {
    let url = `/booking/${slug}/availability?serviceId=${serviceId}&date=${date}`;
    if (staffId) {
      url += `&staffId=${staffId}`;
    }
    return this.request(url, {}, 10000); // 10-sec cache
  }

  static async createPublicAppointment(slug, payload) {
    this.invalidateCache('/booking');
    this.invalidateCache('/reports');
    return this.request(`/booking/${slug}/appointments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Salon Dashboard & Appointments
  static async getDashboardSummary(dateStr, bypassCache = false) {
    const endpoint = dateStr ? `/reports/dashboard?date=${dateStr}` : '/reports/dashboard';
    return this.request(endpoint, {}, bypassCache ? 0 : 20000); // 20-sec cache for superfast date flipping
  }

  static async getAppointments(filters = {}) {
    const query = new URLSearchParams(filters).toString();
    return this.request(`/appointments?${query}`, {}, 15000);
  }

  static async getAppointmentById(id) {
    return this.request(`/appointments/${id}`);
  }

  static async createAppointment(payload) {
    this.invalidateCache('/reports');
    this.invalidateCache('/appointments');
    return this.request('/appointments', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  static async updateAppointmentStatus(id, status, reason = '', reasonCategory = '') {
    this.invalidateCache('/reports');
    this.invalidateCache('/appointments');
    return this.request(`/appointments/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, reason, reasonCategory }),
    });
  }


  static async rescheduleAppointment(id, payload) {
    this.invalidateCache('/reports');
    this.invalidateCache('/appointments');
    return this.request(`/appointments/${id}/reschedule`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  static async proposeAdminReschedule(id, payload) {
    this.invalidateCache('/reports');
    this.invalidateCache('/appointments');
    return this.request(`/appointments/${id}/propose-reschedule`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  static async sendStaffChatMessage(salonId, customerPhone, messageText) {
    return this.request('/whatsapp/chat/send-message', {
      method: 'POST',
      body: JSON.stringify({ salonId, customerPhone, messageText }),
    });
  }

  static async resumeBot(salonId, customerPhone) {
    return this.request('/whatsapp/chat/resume-bot', {
      method: 'POST',
      body: JSON.stringify({ salonId, customerPhone }),
    });
  }

  static async getChatHistory(salonId, customerPhone) {
    const params = new URLSearchParams({ salonId, customerPhone });
    return this.request(`/whatsapp/chat/history?${params.toString()}`);
  }


  // Staff Management (Cached for 3 mins)
  static async getStaff(bypassCache = false) {
    const url = bypassCache ? `/staff?_t=${Date.now()}` : '/staff';
    return this.request(url, {}, bypassCache ? 0 : 180000);
  }

  static async createStaff(payload) {
    this.invalidateCache('/staff');
    this.invalidateCache('/reports');
    const res = await this.request('/staff', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    this.invalidateCache('/staff');
    this.invalidateCache('/reports');
    return res;
  }
  static async updateStaff(id, payload) {
    this.invalidateCache('/staff');
    this.invalidateCache('/reports');
    const res = await this.request(`/staff/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    this.invalidateCache('/staff');
    this.invalidateCache('/reports');
    return res;
  }

  static async toggleStaffStatus(id) {
    this.invalidateCache('/staff');
    this.invalidateCache('/reports');
    const res = await this.request(`/staff/${id}/toggle-status`, {
      method: 'PATCH',
    });
    this.invalidateCache('/staff');
    this.invalidateCache('/reports');
    return res;
  }

  static async assignStaffServices(staffId, serviceIds) {
    this.invalidateCache('/staff');
    this.invalidateCache('/services');
    this.invalidateCache('/reports');
    const res = await this.request(`/staff/${staffId}/services`, {
      method: 'PUT',
      body: JSON.stringify({ serviceIds }),
    });
    this.invalidateCache('/staff');
    this.invalidateCache('/services');
    this.invalidateCache('/reports');
    return res;
  }

  static async deleteStaff(id) {
    this.invalidateCache('/staff');
    this.invalidateCache('/reports');
    const res = await this.request(`/staff/${id}`, {
      method: 'DELETE',
    });
    this.invalidateCache('/staff');
    this.invalidateCache('/reports');
    return res;
  }

  static async updateStaffWorkingHours(staffId, hours) {
    this.invalidateCache('/staff');
    const res = await this.request(`/staff/${staffId}/working-hours`, {
      method: 'PUT',
      body: JSON.stringify({ hours }),
    });
    this.invalidateCache('/staff');
    return res;
  }

  static async createStaffBreak(staffId, payload) {
    this.invalidateCache('/staff');
    const res = await this.request(`/staff/${staffId}/breaks`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    this.invalidateCache('/staff');
    return res;
  }

  static async deleteStaffBreak(staffId, breakId) {
    this.invalidateCache('/staff');
    const res = await this.request(`/staff/${staffId}/breaks/${breakId}`, {
      method: 'DELETE',
    });
    this.invalidateCache('/staff');
    return res;
  }

  // Service Category Management
  static async getServiceCategories(bypassCache = false) {
    const url = bypassCache ? `/services/categories?_t=${Date.now()}` : '/services/categories';
    return this.request(url, {}, bypassCache ? 0 : 180000);
  }

  static async createServiceCategory(payload) {
    this.invalidateCache('/services/categories');
    this.invalidateCache('/services');
    const res = await this.request('/services/categories', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    this.invalidateCache('/services/categories');
    this.invalidateCache('/services');
    return res;
  }

  static async updateServiceCategory(id, payload) {
    this.invalidateCache('/services/categories');
    this.invalidateCache('/services');
    const res = await this.request(`/services/categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    this.invalidateCache('/services/categories');
    this.invalidateCache('/services');
    return res;
  }

  static async deleteServiceCategory(id) {
    this.invalidateCache('/services/categories');
    this.invalidateCache('/services');
    const res = await this.request(`/services/categories/${id}`, {
      method: 'DELETE',
    });
    this.invalidateCache('/services/categories');
    this.invalidateCache('/services');
    return res;
  }

  // Super Admin Master Categories
  static async getMasterCategories(bypassCache = false) {
    const url = bypassCache ? `/super-admin/categories?_t=${Date.now()}` : '/super-admin/categories';
    return this.request(url, {}, bypassCache ? 0 : 60000);
  }

  static async createMasterCategory(payload) {
    this.invalidateCache('/super-admin/categories');
    const res = await this.request('/super-admin/categories', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    this.invalidateCache('/super-admin/categories');
    return res;
  }

  static async updateMasterCategory(id, payload) {
    this.invalidateCache('/super-admin/categories');
    const res = await this.request(`/super-admin/categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    this.invalidateCache('/super-admin/categories');
    return res;
  }

  static async deleteMasterCategory(id) {
    this.invalidateCache('/super-admin/categories');
    const res = await this.request(`/super-admin/categories/${id}`, {
      method: 'DELETE',
    });
    this.invalidateCache('/super-admin/categories');
    return res;
  }

  // Service Management (Cached for 3 mins)
  static async getServices(bypassCache = false) {
    const url = bypassCache ? `/services?_t=${Date.now()}` : '/services';
    return this.request(url, {}, bypassCache ? 0 : 180000);
  }

  static async createService(payload) {
    this.invalidateCache('/services');
    this.invalidateCache('/reports');
    const res = await this.request('/services', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    this.invalidateCache('/services');
    this.invalidateCache('/reports');
    return res;
  }

  static async updateService(id, payload) {
    this.invalidateCache('/services');
    this.invalidateCache('/reports');
    const res = await this.request(`/services/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    this.invalidateCache('/services');
    this.invalidateCache('/reports');
    return res;
  }

  static async toggleServiceStatus(id) {
    this.invalidateCache('/services');
    this.invalidateCache('/reports');
    const res = await this.request(`/services/${id}/toggle-status`, {
      method: 'PATCH',
    });
    this.invalidateCache('/services');
    this.invalidateCache('/reports');
    return res;
  }

  static async deleteService(id) {
    this.invalidateCache('/services');
    this.invalidateCache('/reports');
    const res = await this.request(`/services/${id}`, {
      method: 'DELETE',
    });
    this.invalidateCache('/services');
    this.invalidateCache('/reports');
    return res;
  }

  // Salon Configuration & Blocked Times (Cached for 5 mins)
  static async getSalonProfile(bypassCache = false) {
    return this.request('/salons/profile', {}, bypassCache ? 0 : 300000);
  }

  static async updateSalonProfile(payload) {
    this.invalidateCache('/salons');
    this.invalidateCache('/reports');
    return this.request('/salons/profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  static async getBlockedTimes() {
    return this.request('/salons/blocked-times', {}, 60000);
  }

  static async addBlockedTime(payload) {
    this.invalidateCache('/salons/blocked-times');
    this.invalidateCache('/reports');
    return this.request('/salons/blocked-times', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  static async deleteBlockedTime(id) {
    this.invalidateCache('/salons/blocked-times');
    this.invalidateCache('/reports');
    return this.request(`/salons/blocked-times/${id}`, {
      method: 'DELETE',
    });
  }

  static async getHolidays() {
    return this.request('/salons/holidays', {}, 120000);
  }

  static async addHoliday(payload) {
    this.invalidateCache('/salons/holidays');
    return this.request('/salons/holidays', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Customers
  static async getCustomers(search = '', page = 1, limit = 50) {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    params.append('page', page.toString());
    params.append('limit', limit.toString());
    return this.request(`/customers?${params.toString()}`);
  }

  static async getCustomerById(id) {
    return this.request(`/customers/${id}`);
  }

  // WhatsApp Logs & Simulator
  static async getWhatsAppLogs(filters = {}) {
    const params = new URLSearchParams(filters);
    return this.request(`/whatsapp/logs?${params.toString()}`);
  }

  static async getWhatsAppStatus(salonId = '') {
    const endpoint = salonId ? `/whatsapp/status?salonId=${salonId}` : '/whatsapp/status';
    return this.request(endpoint);
  }

  static async simulateWhatsAppMessage(payload) {
    return this.request('/whatsapp/simulate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Super Admin Platform
  static async getAllSalonsPlatform() {
    return this.request('/salons/platform/all');
  }

  static async createSalonPlatform(payload) {
    return this.request('/salons/platform/create', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  static async getDeactivationPreview(salonId) {
    return this.request(`/salons/platform/${salonId}/deactivation-preview`);
  }

  static async toggleSalonStatusPlatform(salonId, forceCancel = false) {
    return this.request(`/salons/platform/${salonId}/toggle-status?forceCancel=${forceCancel ? 'true' : 'false'}`, {
      method: 'PATCH',
      body: JSON.stringify({ forceCancelBookings: forceCancel }),
    });
  }

  static async verifyMetaPhoneId(phoneNumberId) {
    return this.request(`/salons/platform/verify-meta-phone/${phoneNumberId}`);
  }

  static async verifySalonPhoneNumber(phone, usePlatformBot = false) {
    return this.request('/salons/platform/verify-phone-number', {
      method: 'POST',
      body: JSON.stringify({ phone, usePlatformBot }),
    });
  }

  static async linkSalonWhatsAppAccount(salonId, phoneNumberId) {
    return this.request(`/salons/platform/${salonId}/link-whatsapp`, {
      method: 'POST',
      body: JSON.stringify({ phoneNumberId }),
    });
  }

  static async deleteSalonPlatform(salonId) {
    return this.request(`/salons/platform/${salonId}`, {
      method: 'DELETE',
    });
  }
}

/**
 * Global 12-Hour Time Formatter (hh:mm A)
 * Guarantees clean, human-friendly 12-hour format across the entire application.
 * Accepts Date objects, ISO strings, timestamps, or "HH:mm" strings.
 * Examples:
 *   "00:24" -> "12:24 AM"
 *   "14:00" -> "2:00 PM"
 *   "09:30" -> "9:30 AM"
 *   Date(2026-09-04T00:24:00) -> "12:24 AM"
 */
export function formatTime12h(val) {
  if (!val) return '';
  // 1. Handle "HH:mm" or "HH:mm:ss" strings directly
  if (typeof val === 'string' && /^\d{1,2}:\d{2}(:\d{2})?$/.test(val.trim())) {
    const parts = val.trim().split(':');
    let h = parseInt(parts[0], 10);
    const m = parts[1];
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${m} ${ampm}`;
  }
  // 2. Handle Date objects, timestamps, ISO strings
  const dt = typeof val === 'string' || typeof val === 'number' ? new Date(val) : val;
  if (isNaN(dt.getTime())) return '';
  return dt.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

