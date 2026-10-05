const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const forceCloud = new URLSearchParams(window.location.search).get('cloud') === '1' || localStorage.getItem('use_cloud_backend') === 'true';
const useLocal = (isLocalhost && !forceCloud) || new URLSearchParams(window.location.search).get('local') === '1' || localStorage.getItem('use_local_backend') === 'true';

export const API_BASE = useLocal
  ? `http://${window.location.hostname || 'localhost'}:3000/api/v1`
  : 'https://salon-api-tuwo.onrender.com/api/v1';

const memoryCache = new Map();

/**
 * DUAL-REALM ISOLATED STORAGE & SESSION ENGINE
 * 
 * Provides absolute physical isolation between Platform Super Admin
 * and Salon Store Operations. A browser instance can have both active
 * simultaneously with zero token collisions or cross-realm state leaks.
 */
export class AuthRealm {
  constructor(namespace, defaultLoginRoute) {
    this.namespace = namespace;
    this.defaultLoginRoute = defaultLoginRoute;
    this.accessTokenKey = `${namespace}_access_token`;
    this.refreshTokenKey = `${namespace}_refresh_token`;
    this.userKey = `${namespace}_user_profile`;
    this.inMemoryToken = null;
    this.isRefreshing = false;
    this.refreshSubscribers = [];
  }

  getAccessToken() {
    return this.inMemoryToken || localStorage.getItem(this.accessTokenKey);
  }

  setAccessToken(token) {
    this.inMemoryToken = token || null;
    if (token) localStorage.setItem(this.accessTokenKey, token);
    else localStorage.removeItem(this.accessTokenKey);
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
      if (!token || ApiClient.isTokenExpired(token)) {
        return null;
      }
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

  clear() {
    this.inMemoryToken = null;
    localStorage.removeItem(this.accessTokenKey);
    localStorage.removeItem(this.refreshTokenKey);
    localStorage.removeItem(this.userKey);
    this.refreshSubscribers = [];
    this.isRefreshing = false;
  }
}

// Global Singletons for Platform Super Admin and Salon Store Operations
export const PlatformRealm = new AuthRealm('platform', '#superadmin-login');
export const SalonRealm = new AuthRealm('salon', '#login');

const authChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('salon_auth_sync') : null;

/**
 * REUSABLE REALM HTTP REQUEST EXECUTOR
 * Executes authenticated API requests within an isolated realm context.
 */
async function executeRealmRequest(realm, endpoint, options = {}, ttlMs = 0) {
  const isGet = !options.method || options.method === 'GET';
  const token = realm.getAccessToken();
  const user = realm.getUser();
  const tenantContext = user?.salonId || 'tenant_' + realm.namespace;
  const cacheKey = `${tenantContext}:${endpoint}`;

  if (isGet && ttlMs > 0) {
    const cached = memoryCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < ttlMs) {
      return cached.data;
    }
  }

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
      data = await response.json();
    } else {
      const text = await response.text();
      data = { message: text || `Server error (${response.status}: ${response.statusText})` };
    }

    // 401 Interception with realm-isolated refresh mutex
    if (response.status === 401 && !endpoint.includes('/auth/login') && !endpoint.includes('/auth/refresh')) {
      if (!realm.isRefreshing) {
        realm.isRefreshing = true;
        try {
          const rawRefreshToken = realm.getRefreshToken();
          if (!rawRefreshToken) throw new Error('No refresh token');

          const refreshRes = await fetch(`${API_BASE}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: rawRefreshToken }),
          });

          if (!refreshRes.ok) throw new Error('Refresh token invalid');
          const refreshData = await refreshRes.json();
          const result = refreshData.data !== undefined ? refreshData.data : refreshData;

          realm.setAccessToken(result.accessToken);
          if (result.refreshToken) realm.setRefreshToken(result.refreshToken);
          if (result.user) realm.setUser(result.user);

          realm.isRefreshing = false;
          realm.refreshSubscribers.forEach((cb) => cb(result.accessToken));
          realm.refreshSubscribers = [];

          options.headers = { ...options.headers, Authorization: `Bearer ${result.accessToken}` };
          return executeRealmRequest(realm, endpoint, options, ttlMs);
        } catch (refreshErr) {
          realm.isRefreshing = false;
          realm.refreshSubscribers = [];
          realm.clear();

          // Only redirect if current route belongs to this realm
          const currentHash = (window.location.hash || '').replace('#', '');
          if (realm === PlatformRealm && (currentHash === 'super-admin' || currentHash === 'superadmin-login')) {
            window.location.hash = '#superadmin-login';
          } else if (realm === SalonRealm && (currentHash === 'admin' || currentHash === 'login' || currentHash === 'salon-login')) {
            window.location.hash = '#login';
          }

          throw new Error(data.message || 'Session expired. Please log in again.');
        }
      } else {
        return new Promise((resolve, reject) => {
          realm.refreshSubscribers.push((newToken) => {
            options.headers = { ...options.headers, Authorization: `Bearer ${newToken}` };
            executeRealmRequest(realm, endpoint, options, ttlMs).then(resolve).catch(reject);
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
    if (isGet && ttlMs > 0) {
      const stale = memoryCache.get(cacheKey);
      if (stale) return stale.data;
    }
    throw err;
  }
}

/**
 * PLATFORM SUPER ADMIN AUTH MANAGER
 */
export class PlatformAuth {
  static getToken() { return PlatformRealm.getAccessToken(); }
  static getUser() { return PlatformRealm.getUser(); }
  static isAuthenticated() {
    const user = PlatformRealm.getUser();
    return !!(user && (user.role === 'SUPER_ADMIN' || user.role === 'PLATFORM_ADMIN'));
  }
  static async login(email, password) {
    PlatformRealm.clear();
    const data = await executeRealmRequest(PlatformRealm, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (data.user?.role !== 'SUPER_ADMIN' && data.user?.role !== 'PLATFORM_ADMIN') {
      PlatformRealm.clear();
      throw new Error('Access Denied: Account is not a Platform Super Admin.');
    }
    PlatformRealm.setAccessToken(data.accessToken || data.tokens?.accessToken);
    if (data.refreshToken || data.tokens?.refreshToken) {
      PlatformRealm.setRefreshToken(data.refreshToken || data.tokens?.refreshToken);
    }
    PlatformRealm.setUser(data.user);
    if (authChannel) authChannel.postMessage({ type: 'PLATFORM_LOGIN', timestamp: Date.now() });
    return data;
  }
  static async logout() {
    const refresh = PlatformRealm.getRefreshToken();
    try {
      if (refresh) {
        await executeRealmRequest(PlatformRealm, '/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ refreshToken: refresh }),
        }).catch(() => {});
      }
    } finally {
      PlatformRealm.clear();
      if (authChannel) authChannel.postMessage({ type: 'PLATFORM_LOGOUT', timestamp: Date.now() });
    }
  }
}

/**
 * SALON STORE OWNER AUTH MANAGER
 */
export class SalonAuth {
  static getToken() { return SalonRealm.getAccessToken(); }
  static getUser() { return SalonRealm.getUser(); }
  static isAuthenticated() {
    const user = SalonRealm.getUser();
    return !!user;
  }
  static async login(identifier, password) {
    SalonRealm.clear();
    const data = await executeRealmRequest(SalonRealm, '/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: identifier, password }),
    });
    SalonRealm.setAccessToken(data.accessToken || data.tokens?.accessToken);
    if (data.refreshToken || data.tokens?.refreshToken) {
      SalonRealm.setRefreshToken(data.refreshToken || data.tokens?.refreshToken);
    }
    SalonRealm.setUser(data.user);
    if (authChannel) authChannel.postMessage({ type: 'SALON_LOGIN', timestamp: Date.now() });
    return data;
  }
  static async logout() {
    const refresh = SalonRealm.getRefreshToken();
    try {
      if (refresh) {
        await executeRealmRequest(SalonRealm, '/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ refreshToken: refresh }),
        }).catch(() => {});
      }
    } finally {
      SalonRealm.clear();
      if (authChannel) authChannel.postMessage({ type: 'SALON_LOGOUT', timestamp: Date.now() });
    }
  }

  static async lookupSalonForReset(mobile) {
    return executeRealmRequest(SalonRealm, '/auth/forgot-password-lookup', {
      method: 'POST',
      body: JSON.stringify({ mobile }),
    });
  }

  static async forgotPassword(mobile) {
    return executeRealmRequest(SalonRealm, '/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ mobile }),
    });
  }

  static async resetPasswordWithOtp(identifier, otp, newPassword) {
    return executeRealmRequest(SalonRealm, '/auth/reset-password-otp', {
      method: 'POST',
      body: JSON.stringify({ identifier, otp, newPassword }),
    });
  }

  static async changePassword(currentPassword, newPassword) {
    return executeRealmRequest(SalonRealm, '/auth/change-password', {
      method: 'PATCH',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }

  static async updateProfile(profileData) {
    const data = await executeRealmRequest(SalonRealm, '/auth/profile', {
      method: 'PATCH',
      body: JSON.stringify(profileData),
    });
    if (data.admin) {
      const current = SalonRealm.getUser() || {};
      SalonRealm.setUser({ ...current, ...data.admin });
    }
    return data;
  }
}

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

  // Delegated Realm Identity Mappings
  static getSuperAdminToken() { return PlatformRealm.getAccessToken(); }
  static setSuperAdminToken(token) { PlatformRealm.setAccessToken(token); }
  static removeSuperAdminToken() { PlatformRealm.clear(); }
  static getSuperAdminUser() { return PlatformRealm.getUser(); }
  static setSuperAdminUser(user) { PlatformRealm.setUser(user); }

  static getAccessToken() { return SalonRealm.getAccessToken(); }
  static setAccessToken(token) { SalonRealm.setAccessToken(token); }
  static getToken() { return SalonRealm.getAccessToken(); }
  static setToken(token) { SalonRealm.setAccessToken(token); }
  static removeToken() { SalonRealm.clear(); }
  static getUser() { return SalonRealm.getUser(); }
  static setUser(user) { SalonRealm.setUser(user); }
  static removeUser() { SalonRealm.clear(); }

  static getTenantContext() {
    const user = SalonRealm.getUser();
    return user?.salonId || 'public';
  }

  static clearSession() {
    PlatformRealm.clear();
    SalonRealm.clear();
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
    const isPlatform = endpoint.startsWith('/super-admin') || endpoint.startsWith('/salons/platform');
    const realm = isPlatform ? PlatformRealm : SalonRealm;
    return executeRealmRequest(realm, endpoint, options, ttlMs);
  }

  static async requestSWR(endpoint, ttlMs, onFreshData) {
    const isPlatform = endpoint.startsWith('/super-admin') || endpoint.startsWith('/salons/platform');
    const realm = isPlatform ? PlatformRealm : SalonRealm;
    const user = realm.getUser();
    const tenantContext = user?.salonId || 'tenant_' + realm.namespace;
    const cacheKey = `${tenantContext}:${endpoint}`;
    const cached = memoryCache.get(cacheKey);

    if (cached) {
      this.request(endpoint, {}, 0).then((freshData) => {
        memoryCache.set(cacheKey, { data: freshData, timestamp: Date.now() });
        if (onFreshData && JSON.stringify(freshData) !== JSON.stringify(cached.data)) {
          onFreshData(freshData);
        }
      }).catch(() => {});

      return { data: cached.data, isStale: Date.now() - cached.timestamp > ttlMs };
    }

    const freshData = await this.request(endpoint, {}, ttlMs);
    return { data: freshData, isStale: false };
  }

  static async login(email, password) {
    // If logging in on salon login or with non-admin, use SalonAuth
    return SalonAuth.login(email, password);
  }

  static async logout() {
    return SalonAuth.logout();
  }

  static async logoutAllDevices() {
    try {
      await this.request('/auth/logout-all', { method: 'POST' }).catch(() => {});
    } finally {
      SalonRealm.clear();
    }
  }

  static async getMe() {
    const user = await this.request('/auth/me', {}, 60000); // 1-min cache
    if (user) {
      this.setUser(user);
    }
    return user;
  }

  static async lookupSalonForReset(mobile) {
    return SalonAuth.lookupSalonForReset(mobile);
  }

  static async forgotPassword(identifier) {
    return SalonAuth.forgotPassword(identifier);
  }

  static async resetPasswordWithOtp(identifier, otp, newPassword) {
    return SalonAuth.resetPasswordWithOtp(identifier, otp, newPassword);
  }

  static async changePassword(currentPassword, newPassword) {
    return SalonAuth.changePassword(currentPassword, newPassword);
  }

  static async updateProfile(profileData) {
    return SalonAuth.updateProfile(profileData);
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
    return this.request(endpoint, {}, (bypassCache || dateStr) ? 0 : 5000);
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

  static async cancelBooking(id, context) {
    this.invalidateCache('/reports');
    this.invalidateCache('/appointments');
    return this.request(`/appointments/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify(context),
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

  // Salon Closures & Holidays Management
  static async getSalonClosures(bypassCache = false) {
    const url = bypassCache ? `/salons/closures?_t=${Date.now()}` : '/salons/closures';
    return this.request(url, {}, 30000);
  }

  static async createSalonClosure(payload) {
    this.invalidateCache('/salons/closures');
    this.invalidateCache('/appointments');
    this.invalidateCache('/reports');
    return this.request('/salons/closures', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  static async deleteSalonClosure(id) {
    this.invalidateCache('/salons/closures');
    this.invalidateCache('/appointments');
    this.invalidateCache('/reports');
    return this.request(`/salons/closures/${id}`, {
      method: 'DELETE',
    });
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

  static async updateStaffWorkingHours(staffId, hours, followsSalonSchedule) {
    this.invalidateCache('/staff');
    const payload = { hours };
    if (followsSalonSchedule !== undefined) {
      payload.followsSalonSchedule = followsSalonSchedule;
    }
    const res = await this.request(`/staff/${staffId}/working-hours`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    this.invalidateCache('/staff');
    return res;
  }

  static async getStaffBreaks(staffId, bypassCache = true) {
    const url = bypassCache ? `/staff/${staffId}/breaks?_t=${Date.now()}` : `/staff/${staffId}/breaks`;
    return this.request(url, {}, bypassCache ? 0 : 60000);
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

  static async markStaffAbsent(staffId, payload) {
    this.invalidateCache('/staff');
    const res = await this.request(`/staff/${staffId}/absence`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    this.invalidateCache('/staff');
    return res;
  }

  static async cancelStaffAbsence(staffId, absenceId) {
    this.invalidateCache('/staff');
    const res = await this.request(`/staff/${staffId}/absence/${absenceId}`, {
      method: 'DELETE',
    });
    this.invalidateCache('/staff');
    return res;
  }

  static async previewStaffAbsence(staffId, queryParams) {
    let url = `/staff/${staffId}/absence/preview`;
    if (typeof queryParams === 'string') {
      url += `?date=${encodeURIComponent(queryParams)}`;
    } else if (queryParams && typeof queryParams === 'object') {
      const params = new URLSearchParams();
      if (queryParams.date) params.append('date', queryParams.date);
      if (queryParams.startDate) params.append('startDate', queryParams.startDate);
      if (queryParams.endDate) params.append('endDate', queryParams.endDate);
      if (queryParams.leavePortion) params.append('leavePortion', queryParams.leavePortion);
      if (queryParams.customStartTime) params.append('customStartTime', queryParams.customStartTime);
      if (queryParams.customEndTime) params.append('customEndTime', queryParams.customEndTime);
      const qStr = params.toString();
      if (qStr) url += `?${qStr}`;
    }
    return this.request(url);
  }

  static async extendStaffAbsence(staffId, absenceId, payload) {
    this.invalidateCache('/staff');
    const res = await this.request(`/staff/${staffId}/absence/${absenceId}/extend`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    this.invalidateCache('/staff');
    return res;
  }

  static async getStaffAbsences(staffId, queryParams = {}) {
    let url = `/staff/${staffId}/absences`;
    const params = new URLSearchParams();
    if (queryParams.startDate) params.append('startDate', queryParams.startDate);
    if (queryParams.endDate) params.append('endDate', queryParams.endDate);
    const queryString = params.toString();
    if (queryString) url += `?${queryString}`;
    return this.request(url);
  }

  static async cancelStaffAbsence(staffId, absenceId) {
    this.invalidateCache('/staff');
    const res = await this.request(`/staff/${staffId}/absence/${absenceId}`, {
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

  static async getSalonWorkingHours(bypassCache = false) {
    const url = bypassCache ? `/salons/working-hours?_t=${Date.now()}` : '/salons/working-hours';
    return this.request(url, {}, bypassCache ? 0 : 180000);
  }

  static async updateSalonWorkingHours(hours) {
    this.invalidateCache('/salons/working-hours');
    this.invalidateCache('/salons/profile');
    this.invalidateCache('/salons');
    this.invalidateCache('/booking');
    this.invalidateCache('/staff');
    this.invalidateCache('/reports');
    const res = await this.request('/salons/working-hours', {
      method: 'PUT',
      body: JSON.stringify({ hours }),
    });
    this.invalidateCache('/salons/working-hours');
    this.invalidateCache('/salons/profile');
    this.invalidateCache('/salons');
    this.invalidateCache('/booking');
    this.invalidateCache('/staff');
    this.invalidateCache('/reports');
    return res;
  }

  static async updateSalonWorkingHoursForSalon(salonId, hours) {
    this.invalidateCache('/salons/working-hours');
    this.invalidateCache('/salons/profile');
    this.invalidateCache('/salons');
    this.invalidateCache('/booking');
    this.invalidateCache('/staff');
    this.invalidateCache('/reports');
    const res = await this.request('/salons/working-hours', {
      method: 'PUT',
      headers: { 'x-salon-id': salonId },
      body: JSON.stringify({ hours }),
    });
    this.invalidateCache('/salons/working-hours');
    this.invalidateCache('/salons/profile');
    this.invalidateCache('/salons');
    this.invalidateCache('/booking');
    this.invalidateCache('/staff');
    this.invalidateCache('/reports');
    return res;
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

  static async unblockCustomer(id) {
    this.invalidateCache('/customers');
    return this.request(`/customers/${id}/unblock`, {
      method: 'PATCH',
    });
  }

  static async updateCustomerStrikes(id, yearlyNoShowCount, isBookingBlocked) {
    this.invalidateCache('/customers');
    return this.request(`/customers/${id}/strikes`, {
      method: 'PATCH',
      body: JSON.stringify({ yearlyNoShowCount, isBookingBlocked }),
    });
  }

  // Quick Booking Code Management
  static async getQuickCode(salonId) {
    return this.request(`/salons/${salonId}/quick-code`);
  }

  static async regenerateQuickCode(salonId) {
    return this.request(`/salons/${salonId}/quick-code/generate`, {
      method: 'POST',
    });
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

  // Super Admin Error Management APIs
  static async getErrorLogs(params = {}) {
    const query = new URLSearchParams();
    if (params.status) query.append('status', params.status);
    if (params.severity) query.append('severity', params.severity);
    if (params.salonId) query.append('salonId', params.salonId);
    if (params.search) query.append('search', params.search);
    if (params.page) query.append('page', params.page);
    if (params.limit) query.append('limit', params.limit);
    const queryString = query.toString() ? `?${query.toString()}` : '';
    return this.request(`/super-admin/errors${queryString}`);
  }

  static async getErrorLogById(id) {
    return this.request(`/super-admin/errors/${id}`);
  }

  static async resolveErrorLog(id, resolutionNotes = '') {
    return this.request(`/super-admin/errors/${id}/resolve`, {
      method: 'PATCH',
      body: JSON.stringify({ resolutionNotes }),
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

