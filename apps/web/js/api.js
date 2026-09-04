const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const forceCloud = new URLSearchParams(window.location.search).get('cloud') === '1' || localStorage.getItem('use_cloud_backend') === 'true';
const useLocal = (isLocalhost && !forceCloud) || new URLSearchParams(window.location.search).get('local') === '1' || localStorage.getItem('use_local_backend') === 'true';

export const API_BASE = useLocal
  ? `http://${window.location.hostname || 'localhost'}:3000/api/v1`
  : 'https://salon-api-tuwo.onrender.com/api/v1';

const memoryCache = new Map();

export class ApiClient {
  static getToken() {
    return localStorage.getItem('salon_saas_token');
  }

  static setToken(token) {
    if (token) localStorage.setItem('salon_saas_token', token);
  }

  static removeToken() {
    localStorage.removeItem('salon_saas_token');
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
    if (user) localStorage.setItem('salon_user_data', JSON.stringify(user));
  }

  static removeUser() {
    localStorage.removeItem('salon_user_data');
  }

  static clearSession() {
    this.removeToken();
    this.removeUser();
    this.invalidateCache();
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

  static async request(endpoint, options = {}, ttlMs = 0) {
    const isGet = !options.method || options.method === 'GET';
    const cacheKey = `${endpoint}`;

    // Cache hit — return immediately (SWR: caller gets instant data)
    if (isGet && ttlMs > 0) {
      const cached = memoryCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < ttlMs) {
        return cached.data;
      }
    }

    const token = this.getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || 45000);

    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
        signal: options.signal || controller.signal,
      });

      clearTimeout(timeoutId);

      let data;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        const text = await response.text();
        data = { message: text || `Server error (${response.status}: ${response.statusText})` };
      }

      if (!response.ok) {
        if (response.status === 401 && !endpoint.includes('/auth/login')) {
          this.clearSession();
          throw new Error('Session expired or unauthorized. Please log in again.');
        }
        throw new Error(data.message || `Request failed with status ${response.status}`);
      }

      const result = data.data !== undefined ? data.data : data;

      // Save to cache if TTL specified
      if (isGet && ttlMs > 0) {
        memoryCache.set(cacheKey, { data: result, timestamp: Date.now() });
      }

      return result;
    } catch (err) {
      clearTimeout(timeoutId);

      // SWR Fallback: if network fails but we have stale cache, return it
      if (isGet && ttlMs > 0) {
        const stale = memoryCache.get(cacheKey);
        if (stale) {
          console.warn(`[SWR] Serving stale cache for ${endpoint} due to network error`);
          return stale.data;
        }
      }

      if (err.name === 'AbortError') {
        const timeoutErr = new Error('Request timed out. The cloud server may be waking up from sleep, please try again in a moment.');
        console.error(`API Timeout on ${endpoint}:`, timeoutErr);
        throw timeoutErr;
      }

      console.error(`API Error on ${endpoint}:`, err);
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
    const cacheKey = `${endpoint}`;
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
    const data = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (data.accessToken) {
      this.setToken(data.accessToken);
    }
    if (data.user) {
      this.setUser(data.user);
    }
    this.invalidateCache();
    return data;
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

  static async updateAppointmentStatus(id, status, reason = '') {
    this.invalidateCache('/reports');
    this.invalidateCache('/appointments');
    return this.request(`/appointments/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, reason }),
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

  // Staff Management (Cached for 3 mins)
  static async getStaff(bypassCache = false) {
    return this.request('/staff', {}, bypassCache ? 0 : 180000);
  }

  static async createStaff(payload) {
    this.invalidateCache('/staff');
    this.invalidateCache('/reports');
    return this.request('/staff', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }
  static async updateStaff(id, payload) {
    this.invalidateCache('/staff');
    this.invalidateCache('/reports');
    return this.request(`/staff/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  static async toggleStaffStatus(id) {
    this.invalidateCache('/staff');
    this.invalidateCache('/reports');
    return this.request(`/staff/${id}/toggle-status`, {
      method: 'PATCH',
    });
  }

  static async assignStaffServices(staffId, serviceIds) {
    this.invalidateCache('/staff');
    this.invalidateCache('/services');
    this.invalidateCache('/reports');
    return this.request(`/staff/${staffId}/services`, {
      method: 'PUT',
      body: JSON.stringify({ serviceIds }),
    });
  }

  static async deleteStaff(id) {
    this.invalidateCache('/staff');
    this.invalidateCache('/reports');
    return this.request(`/staff/${id}`, {
      method: 'DELETE',
    });
  }

  static async updateStaffWorkingHours(staffId, hours) {
    this.invalidateCache('/staff');
    return this.request(`/staff/${staffId}/working-hours`, {
      method: 'PUT',
      body: JSON.stringify({ hours }),
    });
  }

  static async createStaffBreak(staffId, payload) {
    this.invalidateCache('/staff');
    return this.request(`/staff/${staffId}/breaks`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  static async deleteStaffBreak(staffId, breakId) {
    this.invalidateCache('/staff');
    return this.request(`/staff/${staffId}/breaks/${breakId}`, {
      method: 'DELETE',
    });
  }

  // Service Management (Cached for 3 mins)
  static async getServices(bypassCache = false) {
    return this.request('/services', {}, bypassCache ? 0 : 180000);
  }

  static async createService(payload) {
    this.invalidateCache('/services');
    this.invalidateCache('/reports');
    return this.request('/services', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  static async updateService(id, payload) {
    this.invalidateCache('/services');
    this.invalidateCache('/reports');
    return this.request(`/services/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  static async toggleServiceStatus(id) {
    this.invalidateCache('/services');
    this.invalidateCache('/reports');
    return this.request(`/services/${id}/toggle-status`, {
      method: 'PATCH',
    });
  }

  static async deleteService(id) {
    this.invalidateCache('/services');
    this.invalidateCache('/reports');
    return this.request(`/services/${id}`, {
      method: 'DELETE',
    });
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

  static async toggleSalonStatusPlatform(salonId) {
    return this.request(`/salons/platform/${salonId}/toggle-status`, {
      method: 'PATCH',
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

