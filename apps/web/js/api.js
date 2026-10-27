import { HttpClient, API_BASE, ApiError } from './network/http-client.js';
import { SalonSession, PlatformSession, SessionRealm } from './network/session-manager.js';
import { SalonRepository } from './repositories/salon-repository.js';
import { ENDPOINTS } from './network/endpoints.js';
import { NetworkHealth, ConnectionState } from './network/network-health.js';

export { API_BASE, ApiError, SalonRepository, ENDPOINTS, NetworkHealth, ConnectionState };

// Dual-Realm Session Bindings
export const PlatformRealm = PlatformSession;
export const SalonRealm = SalonSession;
export const AuthRealm = SessionRealm;

const memoryCache = new Map();
const authChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('salon_auth_sync') : null;

/**
 * REUSABLE REALM HTTP REQUEST EXECUTOR
 * Delegates directly to the centralized, resilient HttpClient gateway.
 */
async function executeRealmRequest(realm, endpoint, options = {}, ttlMs = 0) {
  return HttpClient.request(endpoint, options, realm);
}

/**
 * PLATFORM SUPER ADMIN AUTH MANAGER
 */
export class PlatformAuth {
  static getToken() { return PlatformRealm.getAccessToken(); }
  static getUser() { return PlatformRealm.getUser(); }
  static setUser(user) { return PlatformRealm.setUser(user); }
  static isAuthenticated() {
    const user = PlatformRealm.getUser();
    return !!(user && (user.role === 'SUPER_ADMIN' || user.role === 'PLATFORM_ADMIN'));
  }
  static refreshSession() {
    return PlatformRealm.refreshAccessToken();
  }
  static async login(email, password) {
    PlatformRealm.clear();
    const data = await executeRealmRequest(PlatformRealm, ENDPOINTS.AUTH.LOGIN, {
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
        await executeRealmRequest(PlatformRealm, ENDPOINTS.AUTH.LOGOUT, {
          method: 'POST',
          body: JSON.stringify({ refreshToken: refresh }),
        }).catch(() => { });
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
  static setUser(user) { return SalonRealm.setUser(user); }
  static isAuthenticated() {
    const user = SalonRealm.getUser();
    return !!user;
  }
  static refreshSession() {
    return SalonRealm.refreshAccessToken();
  }
  static async login(identifier, password) {
    SalonRealm.clear();
    const data = await executeRealmRequest(SalonRealm, ENDPOINTS.AUTH.LOGIN, {
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
        await executeRealmRequest(SalonRealm, ENDPOINTS.AUTH.LOGOUT, {
          method: 'POST',
          body: JSON.stringify({ refreshToken: refresh }),
        }).catch(() => { });
      }
    } finally {
      SalonRepository.clear();
      SalonRealm.clear();
      if (authChannel) authChannel.postMessage({ type: 'SALON_LOGOUT', timestamp: Date.now() });
    }
  }

  static async lookupSalonForReset(mobile) {
    return executeRealmRequest(SalonRealm, ENDPOINTS.AUTH.FORGOT_PASSWORD_LOOKUP, {
      method: 'POST',
      body: JSON.stringify({ mobile }),
    });
  }

  static async forgotPassword(mobile) {
    return executeRealmRequest(SalonRealm, ENDPOINTS.AUTH.FORGOT_PASSWORD, {
      method: 'POST',
      body: JSON.stringify({ mobile }),
    });
  }

  static async resetPasswordWithOtp(identifier, otp, newPassword) {
    return executeRealmRequest(SalonRealm, ENDPOINTS.AUTH.RESET_PASSWORD_OTP, {
      method: 'POST',
      body: JSON.stringify({ identifier, otp, newPassword }),
    });
  }

  static async changePassword(currentPassword, newPassword) {
    return executeRealmRequest(SalonRealm, ENDPOINTS.AUTH.CHANGE_PASSWORD, {
      method: 'PATCH',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }

  static async updateProfile(profileData) {
    const data = await executeRealmRequest(SalonRealm, ENDPOINTS.AUTH.PROFILE, {
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
    if (!token || typeof token !== 'string') return true;
    const parts = token.split('.');
    if (parts.length !== 3) {
      // Opaque token format (e.g. rt_...); server-side validated only
      return false;
    }
    const payload = this.parseJwt(token);
    if (!payload || !payload.exp) return false;
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
    SalonRepository.clear();
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
      }).catch(() => { });

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
      await this.request(ENDPOINTS.AUTH.LOGOUT_ALL, { method: 'POST' }).catch(() => { });
    } finally {
      SalonRealm.clear();
    }
  }

  static async getMe() {
    const user = await this.request(ENDPOINTS.AUTH.ME, {}, 60000); // 1-min cache
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
    return this.request(ENDPOINTS.BOOKING.DETAILS(slug), {}, 120000); // 2-min cache
  }

  static async getPublicAvailability(slug, serviceId, date, staffId = null) {
    return this.request(ENDPOINTS.BOOKING.AVAILABILITY(slug, serviceId, date, staffId), {}, 10000); // 10-sec cache
  }

  static async createPublicAppointment(slug, payload) {
    this.invalidateCache('/booking');
    this.invalidateCache('/reports');
    return this.request(ENDPOINTS.BOOKING.CREATE(slug), {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Salon Dashboard & Appointments
  static async getDashboardSummary(dateStr, bypassCache = false) {
    return this.request(ENDPOINTS.REPORTS.DASHBOARD(dateStr), {}, (bypassCache || dateStr) ? 0 : 5000);
  }

  static async getQueue(params = {}, bypassCache = true) {
    const cleanParams = {};
    for (const [key, val] of Object.entries(params)) {
      if (val !== undefined && val !== null && val !== '') {
        cleanParams[key] = val;
      }
    }
    const query = new URLSearchParams(cleanParams).toString();
    return this.request(ENDPOINTS.APPOINTMENTS.QUEUE(query), {}, bypassCache ? 0 : 5000);
  }

  static async getAppointments(filters = {}) {
    const query = new URLSearchParams(filters).toString();
    return this.request(ENDPOINTS.APPOINTMENTS.LIST(query), {}, 15000);
  }

  static async getAppointmentById(id) {
    return this.request(ENDPOINTS.APPOINTMENTS.DETAIL(id));
  }

  static async createAppointment(payload) {
    this.invalidateCache('/reports');
    this.invalidateCache('/appointments');
    return this.request(ENDPOINTS.APPOINTMENTS.CREATE, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  static async updateAppointmentStatus(id, status, reason = '', reasonCategory = '') {
    this.invalidateCache('/reports');
    this.invalidateCache('/appointments');
    return this.request(ENDPOINTS.APPOINTMENTS.STATUS(id), {
      method: 'PATCH',
      body: JSON.stringify({ status, reason, reasonCategory }),
    });
  }

  static async acceptQuickBooking(id) {
    this.invalidateCache('/reports');
    this.invalidateCache('/appointments');
    return this.request(ENDPOINTS.APPOINTMENTS.ACCEPT_QUICK_BOOKING(id), {
      method: 'POST',
    });
  }

  static async declineQuickBooking(id, reason = '') {
    this.invalidateCache('/reports');
    this.invalidateCache('/appointments');
    return this.request(ENDPOINTS.APPOINTMENTS.DECLINE_QUICK_BOOKING(id), {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  static async cancelBooking(id, context) {
    this.invalidateCache('/reports');
    this.invalidateCache('/appointments');
    return this.request(ENDPOINTS.APPOINTMENTS.CANCEL(id), {
      method: 'POST',
      body: JSON.stringify(context),
    });
  }


  static async rescheduleAppointment(id, payload) {
    this.invalidateCache('/reports');
    this.invalidateCache('/appointments');
    return this.request(ENDPOINTS.APPOINTMENTS.RESCHEDULE(id), {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  static async proposeAdminReschedule(id, payload) {
    this.invalidateCache('/reports');
    this.invalidateCache('/appointments');
    return this.request(ENDPOINTS.APPOINTMENTS.PROPOSE_RESCHEDULE(id), {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  static async addAddonService(id, serviceId) {
    this.invalidateCache('/reports');
    this.invalidateCache('/appointments');
    return this.request(ENDPOINTS.APPOINTMENTS.ADDONS(id), {
      method: 'POST',
      body: JSON.stringify({ serviceId }),
    });
  }

  static async sendStaffChatMessage(salonId, customerPhone, messageText) {
    return this.request(ENDPOINTS.WHATSAPP.SEND_MESSAGE, {
      method: 'POST',
      body: JSON.stringify({ salonId, customerPhone, messageText }),
    });
  }

  static async resumeBot(salonId, customerPhone) {
    return this.request(ENDPOINTS.WHATSAPP.RESUME_BOT, {
      method: 'POST',
      body: JSON.stringify({ salonId, customerPhone }),
    });
  }

  static async getChatHistory(salonId, customerPhone) {
    const params = new URLSearchParams({ salonId, customerPhone });
    return this.request(ENDPOINTS.WHATSAPP.CHAT_HISTORY(params.toString()));
  }

  // Salon Closures & Holidays Management
  static async getSalonClosures(bypassCache = false) {
    return SalonRepository.getSalonClosures(bypassCache);
  }

  static async createSalonClosure(payload) {
    this.invalidateCache('/salons/closures');
    this.invalidateCache('/salons/closures/calendar-schedule');
    this.invalidateCache('/appointments');
    this.invalidateCache('/reports');
    const res = await this.request(ENDPOINTS.SALONS.CLOSURES, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    SalonRepository.invalidate('closures');
    return res;
  }

  static async deleteSalonClosure(id) {
    this.invalidateCache('/salons/closures');
    this.invalidateCache('/salons/closures/calendar-schedule');
    this.invalidateCache('/appointments');
    this.invalidateCache('/reports');
    const res = await this.request(ENDPOINTS.SALONS.CLOSURE_BY_ID(id), {
      method: 'DELETE',
    });
    SalonRepository.invalidate('closures');
    return res;
  }

  static async getCalendarSchedule(options = {}, bypassCache = false) {
    const params = new URLSearchParams();
    if (options.month) params.append('month', options.month);
    if (options.startDate) params.append('startDate', options.startDate);
    if (options.endDate) params.append('endDate', options.endDate);
    if (options.calendarFor) params.append('calendarFor', options.calendarFor);
    const targetStaffId = options.staffId || options.stylistId;
    if (targetStaffId) {
      params.append('staffId', targetStaffId);
      params.append('stylistId', targetStaffId);
    }
    return this.request(ENDPOINTS.SALONS.CLOSURES_SCHEDULE(params.toString()), {}, bypassCache ? 0 : 30000);
  }

  static async getHolidays(options = {}) {
    const params = new URLSearchParams();
    if (options.startDate) params.append('startDate', options.startDate);
    if (options.endDate) params.append('endDate', options.endDate);
    if (options.year) params.append('year', options.year);
    if (options.month) params.append('month', options.month);
    return this.request(ENDPOINTS.SALONS.CLOSURES_HOLIDAYS(params.toString()));
  }


  // Staff Management (Cached for 3 mins)
  static async getStaff(bypassCache = false) {
    return SalonRepository.getStaff(bypassCache);
  }

  static async createStaff(payload) {
    this.invalidateCache('/staff');
    this.invalidateCache('/reports');
    const res = await this.request(ENDPOINTS.STAFF.CREATE, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    SalonRepository.invalidate('staff');
    return res;
  }
  static async updateStaff(id, payload) {
    this.invalidateCache('/staff');
    this.invalidateCache('/reports');
    const res = await this.request(ENDPOINTS.STAFF.UPDATE(id), {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    SalonRepository.invalidate('staff');
    return res;
  }

  static async toggleStaffStatus(id) {
    this.invalidateCache('/staff');
    this.invalidateCache('/reports');
    const res = await this.request(ENDPOINTS.STAFF.TOGGLE_STATUS(id), {
      method: 'PATCH',
    });
    SalonRepository.invalidate('staff');
    return res;
  }

  static async assignStaffServices(staffId, serviceIds) {
    this.invalidateCache('/staff');
    this.invalidateCache('/services');
    this.invalidateCache('/reports');
    const res = await this.request(ENDPOINTS.STAFF.SERVICES(staffId), {
      method: 'PUT',
      body: JSON.stringify({ serviceIds }),
      keepalive: true,
    });
    SalonRepository.invalidate('staff');
    SalonRepository.invalidate('services');
    return res;
  }

  static async deleteStaff(id) {
    this.invalidateCache('/staff');
    this.invalidateCache('/reports');
    const res = await this.request(ENDPOINTS.STAFF.DELETE(id), {
      method: 'DELETE',
    });
    SalonRepository.invalidate('staff');
    return res;
  }

  static async getStaffWorkingHours(staffId, bypassCache = true) {
    const query = bypassCache ? `_t=${Date.now()}` : '';
    const url = ENDPOINTS.STAFF.WORKING_HOURS(staffId) + (query ? `?${query}` : '');
    return this.request(url, {}, bypassCache ? 0 : 60000);
  }

  static async updateStaffWorkingHours(staffId, hours, followsSalonSchedule) {
    this.invalidateCache('/staff');
    this.invalidateCache('/salons/closures/calendar-schedule');
    const sanitizedHours = (hours || []).map((h) => {
      const clean = {
        dayOfWeek: h.dayOfWeek,
        isWorking: h.isWorking !== undefined ? Boolean(h.isWorking) : true,
      };
      if (h.startTime) clean.startTime = h.startTime;
      if (h.endTime) clean.endTime = h.endTime;
      if (h.isCustomized !== undefined) clean.isCustomized = Boolean(h.isCustomized);
      return clean;
    });

    const payload = { hours: sanitizedHours };
    if (followsSalonSchedule !== undefined) {
      payload.followsSalonSchedule = followsSalonSchedule;
    }
    const res = await this.request(ENDPOINTS.STAFF.WORKING_HOURS(staffId), {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    this.invalidateCache('/staff');
    this.invalidateCache('/salons/closures/calendar-schedule');
    return res;
  }

  static async patchStaffDayShift(staffId, dayOfWeek, shiftData) {
    this.invalidateCache('/staff');
    this.invalidateCache('/salons/closures/calendar-schedule');
    const res = await this.request(ENDPOINTS.STAFF.WORKING_HOURS_DAY(staffId, dayOfWeek), {
      method: 'PATCH',
      body: JSON.stringify(shiftData),
    });
    this.invalidateCache('/staff');
    this.invalidateCache('/salons/closures/calendar-schedule');
    return res;
  }

  static async resetStaffWorkingHours(staffId) {
    this.invalidateCache('/staff');
    const res = await this.request(ENDPOINTS.STAFF.WORKING_HOURS_RESET(staffId), {
      method: 'POST',
      body: JSON.stringify({}),
    });
    this.invalidateCache('/staff');
    return res;
  }

  static async getStaffBreaks(staffId, bypassCache = true) {
    const query = bypassCache ? `_t=${Date.now()}` : '';
    const url = ENDPOINTS.STAFF.BREAKS(staffId) + (query ? `?${query}` : '');
    return this.request(url, {}, bypassCache ? 0 : 60000);
  }

  static async createStaffBreak(staffId, payload) {
    this.invalidateCache('/staff');
    const res = await this.request(ENDPOINTS.STAFF.BREAKS(staffId), {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    this.invalidateCache('/staff');
    return res;
  }

  static async deleteStaffBreak(staffId, breakId) {
    this.invalidateCache('/staff');
    const res = await this.request(ENDPOINTS.STAFF.BREAK_BY_ID(staffId, breakId), {
      method: 'DELETE',
    });
    this.invalidateCache('/staff');
    return res;
  }

  static async updateStaffBreak(staffId, breakId, payload) {
    this.invalidateCache('/staff');
    const res = await this.request(ENDPOINTS.STAFF.BREAK_BY_ID(staffId, breakId), {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    this.invalidateCache('/staff');
    return res;
  }

  static async resetStaffBreak(staffId, breakId) {
    this.invalidateCache('/staff');
    const res = await this.request(ENDPOINTS.STAFF.BREAKS_RESET(staffId, breakId), {
      method: 'POST',
    });
    this.invalidateCache('/staff');
    return res;
  }

  static async inheritSalonBreak(staffId, payload) {
    this.invalidateCache('/staff');
    const res = await this.request(ENDPOINTS.STAFF.BREAKS_INHERIT(staffId), {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    this.invalidateCache('/staff');
    return res;
  }

  static async updateStaffRoutineBreak(staffId, payload) {
    this.invalidateCache('/staff');
    const res = await this.request(ENDPOINTS.STAFF.BREAKS_ROUTINE(staffId), {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    this.invalidateCache('/staff');
    return res;
  }

  static async deleteStaffRoutineBreak(staffId, payload) {
    this.invalidateCache('/staff');
    const res = await this.request(ENDPOINTS.STAFF.BREAKS_ROUTINE(staffId), {
      method: 'DELETE',
      body: JSON.stringify(payload),
    });
    this.invalidateCache('/staff');
    return res;
  }

  static async markStaffAbsent(staffId, payload) {
    this.invalidateCache('/staff');
    const res = await this.request(ENDPOINTS.STAFF.ABSENCE(staffId), {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    this.invalidateCache('/staff');
    return res;
  }

  static async cancelStaffAbsence(staffId, absenceId) {
    this.invalidateCache('/staff');
    const res = await this.request(ENDPOINTS.STAFF.ABSENCE_BY_ID(staffId, absenceId), {
      method: 'DELETE',
    });
    this.invalidateCache('/staff');
    return res;
  }

  static async previewStaffAbsence(staffId, queryParams) {
    let qStr = '';
    if (typeof queryParams === 'string') {
      qStr = `date=${encodeURIComponent(queryParams)}`;
    } else if (queryParams && typeof queryParams === 'object') {
      const params = new URLSearchParams();
      if (queryParams.date) params.append('date', queryParams.date);
      if (queryParams.startDate) params.append('startDate', queryParams.startDate);
      if (queryParams.endDate) params.append('endDate', queryParams.endDate);
      if (queryParams.isPartialDay !== undefined) params.append('isPartialDay', String(queryParams.isPartialDay));
      if (queryParams.startTime) params.append('startTime', queryParams.startTime);
      if (queryParams.endTime) params.append('endTime', queryParams.endTime);
      qStr = params.toString();
    }
    return this.request(ENDPOINTS.STAFF.ABSENCE_PREVIEW(staffId, qStr));
  }

  static async extendStaffAbsence(staffId, absenceId, payload) {
    this.invalidateCache('/staff');
    const res = await this.request(ENDPOINTS.STAFF.ABSENCE_EXTEND(staffId, absenceId), {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    this.invalidateCache('/staff');
    return res;
  }

  static async getStaffAbsences(staffId, queryParams = {}) {
    const params = new URLSearchParams();
    if (queryParams.startDate) params.append('startDate', queryParams.startDate);
    if (queryParams.endDate) params.append('endDate', queryParams.endDate);
    return this.request(ENDPOINTS.STAFF.ABSENCE_CALENDAR(staffId, params.toString()));
  }

  // Service Category Management
  static async getServiceCategories(bypassCache = false) {
    return SalonRepository.getServiceCategories(bypassCache);
  }

  static async createServiceCategory(payload) {
    this.invalidateCache('/services/categories');
    this.invalidateCache('/services');
    const res = await this.request(ENDPOINTS.SERVICES.CATEGORY_CREATE, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    SalonRepository.invalidate('categories');
    SalonRepository.invalidate('services');
    return res;
  }

  static async updateServiceCategory(id, payload) {
    this.invalidateCache('/services/categories');
    this.invalidateCache('/services');
    const res = await this.request(ENDPOINTS.SERVICES.CATEGORY_UPDATE(id), {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    SalonRepository.invalidate('categories');
    SalonRepository.invalidate('services');
    return res;
  }

  static async deleteServiceCategory(id) {
    this.invalidateCache('/services/categories');
    this.invalidateCache('/services');
    const res = await this.request(ENDPOINTS.SERVICES.CATEGORY_DELETE(id), {
      method: 'DELETE',
    });
    SalonRepository.invalidate('categories');
    SalonRepository.invalidate('services');
    return res;
  }

  // Super Admin Master Categories
  static async getMasterCategories(bypassCache = false) {
    const url = bypassCache ? `${ENDPOINTS.PLATFORM.CATEGORIES()}?_t=${Date.now()}` : ENDPOINTS.PLATFORM.CATEGORIES();
    return this.request(url, {}, bypassCache ? 0 : 60000);
  }

  static async createMasterCategory(payload) {
    this.invalidateCache('/super-admin/categories');
    const res = await this.request(ENDPOINTS.PLATFORM.CATEGORIES(), {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    this.invalidateCache('/super-admin/categories');
    return res;
  }

  static async updateMasterCategory(id, payload) {
    this.invalidateCache('/super-admin/categories');
    const res = await this.request(ENDPOINTS.PLATFORM.CATEGORY_BY_ID(id), {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    this.invalidateCache('/super-admin/categories');
    return res;
  }

  static async deleteMasterCategory(id) {
    this.invalidateCache('/super-admin/categories');
    const res = await this.request(ENDPOINTS.PLATFORM.CATEGORY_BY_ID(id), {
      method: 'DELETE',
    });
    this.invalidateCache('/super-admin/categories');
    return res;
  }

  // Service Management (Cached for 3 mins)
  static async getServices(bypassCache = false) {
    return SalonRepository.getServices(bypassCache);
  }

  static async createService(payload) {
    this.invalidateCache('/services');
    this.invalidateCache('/reports');
    const res = await this.request(ENDPOINTS.SERVICES.CREATE, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    SalonRepository.invalidate('services');
    return res;
  }

  static async updateService(id, payload) {
    this.invalidateCache('/services');
    this.invalidateCache('/reports');
    const res = await this.request(ENDPOINTS.SERVICES.UPDATE(id), {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    SalonRepository.invalidate('services');
    return res;
  }

  static async toggleServiceStatus(id) {
    this.invalidateCache('/services');
    this.invalidateCache('/reports');
    const res = await this.request(ENDPOINTS.SERVICES.TOGGLE_STATUS(id), {
      method: 'PATCH',
    });
    SalonRepository.invalidate('services');
    return res;
  }

  static async deleteService(id) {
    this.invalidateCache('/services');
    this.invalidateCache('/reports');
    const res = await this.request(ENDPOINTS.SERVICES.DELETE(id), {
      method: 'DELETE',
    });
    SalonRepository.invalidate('services');
    return res;
  }

  static async scanMenuCardWithAi(imageBase64, mimeType = 'image/jpeg') {
    return this.request(ENDPOINTS.SERVICES.AI_SCAN, {
      method: 'POST',
      body: JSON.stringify({ imageBase64, mimeType }),
    });
  }

  static async bulkImportServices(services) {
    this.invalidateCache('/services');
    this.invalidateCache('/reports');
    const res = await this.request(ENDPOINTS.SERVICES.BULK_IMPORT, {
      method: 'POST',
      body: JSON.stringify({ services }),
    });
    SalonRepository.invalidate('services');
    return res;
  }

  static async getSalonProfile(bypassCache = false) {
    return SalonRepository.getSalonProfile(bypassCache);
  }

  static async updateSalonProfile(payload) {
    this.invalidateCache('/salons');
    this.invalidateCache('/reports');
    const res = await this.request(ENDPOINTS.SALONS.PROFILE, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    SalonRepository.invalidate('profile');
    return res;
  }

  static async getPersonalProfile(bypassCache = false) {
    return this.request(ENDPOINTS.SALONS.PERSONAL_PROFILE, {}, bypassCache ? 0 : 60000);
  }

  static async updatePersonalProfile(payload) {
    this.invalidateCache('/salons');
    this.invalidateCache('/reports');
    return this.request(ENDPOINTS.SALONS.PERSONAL_PROFILE, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  static async getSalonWorkingHours(bypassCache = false) {
    return SalonRepository.getSalonWorkingHours(bypassCache);
  }

  static async updateSalonWorkingHours(hours) {
    this.invalidateCache('/salons/working-hours');
    this.invalidateCache('/salons/profile');
    this.invalidateCache('/salons');
    this.invalidateCache('/booking');
    this.invalidateCache('/staff');
    this.invalidateCache('/reports');

    const sanitizedHours = (hours || []).map((h) => {
      const item = { dayOfWeek: h.dayOfWeek };
      if (h.isClosed !== undefined) {
        item.isClosed = Boolean(h.isClosed);
      } else if (h.isOpen !== undefined) {
        item.isClosed = !h.isOpen;
      }
      if (h.startTime || h.openTime) {
        item.startTime = h.startTime || h.openTime;
      }
      if (h.endTime || h.closeTime) {
        item.endTime = h.endTime || h.closeTime;
      }
      return item;
    });

    const res = await this.request(ENDPOINTS.SALONS.WORKING_HOURS, {
      method: 'PUT',
      body: JSON.stringify({ hours: sanitizedHours }),
    });
    SalonRepository.invalidate('working_hours');
    SalonRepository.invalidate('profile');
    return res;
  }

  static async getSalonBreaks(bypassCache = false) {
    return SalonRepository.getSalonBreaks(bypassCache);
  }

  static async createSalonBreak(payload) {
    this.invalidateCache('/salons');
    this.invalidateCache('/staff');
    const res = await this.request(ENDPOINTS.SALONS.BREAKS, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    SalonRepository.invalidate('breaks');
    return res;
  }

  static async updateSalonBreak(breakId, payload) {
    this.invalidateCache('/salons');
    this.invalidateCache('/staff');
    const res = await this.request(ENDPOINTS.SALONS.BREAK_BY_ID(breakId), {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    SalonRepository.invalidate('breaks');
    return res;
  }

  static async deleteSalonBreak(breakId) {
    this.invalidateCache('/salons');
    this.invalidateCache('/staff');
    const res = await this.request(ENDPOINTS.SALONS.BREAK_BY_ID(breakId), {
      method: 'DELETE',
    });
    SalonRepository.invalidate('breaks');
    return res;
  }

  static async updateSalonRoutineBreak(payload) {
    this.invalidateCache('/salons');
    this.invalidateCache('/staff');
    const res = await this.request(ENDPOINTS.SALONS.BREAKS_ROUTINE, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    this.invalidateCache('/salons');
    this.invalidateCache('/staff');
    return res;
  }

  static async deleteSalonRoutineBreak(payload) {
    this.invalidateCache('/salons');
    this.invalidateCache('/staff');
    const res = await this.request(ENDPOINTS.SALONS.BREAKS_ROUTINE, {
      method: 'DELETE',
      body: JSON.stringify(payload),
    });
    this.invalidateCache('/salons');
    this.invalidateCache('/staff');
    return res;
  }

  static async createSalonFacilityBreak(payload) {
    return this.createSalonBreak(payload);
  }

  static async updateSalonFacilityBreak(breakId, payload) {
    return this.updateSalonBreak(breakId, payload);
  }

  static async deleteSalonFacilityBreak(breakId) {
    return this.deleteSalonBreak(breakId);
  }

  static async updateSalonWorkingHoursForSalon(salonId, hours) {
    this.invalidateCache('/salons/working-hours');
    this.invalidateCache('/salons/profile');
    this.invalidateCache('/salons');
    this.invalidateCache('/booking');
    this.invalidateCache('/staff');
    this.invalidateCache('/reports');
    const res = await this.request(ENDPOINTS.SALONS.WORKING_HOURS, {
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
    return this.request(ENDPOINTS.SALONS.BLOCKED_TIMES, {}, 60000);
  }

  static async addBlockedTime(payload) {
    this.invalidateCache('/salons/blocked-times');
    this.invalidateCache('/reports');
    return this.request(ENDPOINTS.SALONS.BLOCKED_TIMES, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  static async deleteBlockedTime(id) {
    this.invalidateCache('/salons/blocked-times');
    this.invalidateCache('/reports');
    return this.request(ENDPOINTS.SALONS.BLOCKED_TIME_BY_ID(id), {
      method: 'DELETE',
    });
  }

  static async getHolidays() {
    return this.request(ENDPOINTS.SALONS.HOLIDAYS(), {}, 120000);
  }

  static async addHoliday(payload) {
    this.invalidateCache('/salons/holidays');
    return this.request(ENDPOINTS.SALONS.HOLIDAYS(), {
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
    return this.request(ENDPOINTS.CUSTOMERS.LIST(params.toString()));
  }

  static async getCustomerById(id) {
    return this.request(ENDPOINTS.CUSTOMERS.DETAIL(id));
  }

  static async unblockCustomer(id) {
    this.invalidateCache('/customers');
    return this.request(ENDPOINTS.CUSTOMERS.UNBLOCK(id), {
      method: 'PATCH',
    });
  }

  static async updateCustomerStrikes(id, yearlyNoShowCount, isBookingBlocked) {
    this.invalidateCache('/customers');
    return this.request(ENDPOINTS.CUSTOMERS.STRIKES(id), {
      method: 'PATCH',
      body: JSON.stringify({ yearlyNoShowCount, isBookingBlocked }),
    });
  }

  // Quick Booking Code Management
  static async getQuickCode(salonId) {
    return this.request(ENDPOINTS.SALONS.QUICK_CODE(salonId));
  }

  static async regenerateQuickCode(salonId) {
    return this.request(ENDPOINTS.SALONS.QUICK_CODE_GENERATE(salonId), {
      method: 'POST',
    });
  }

  // WhatsApp Logs & Simulator
  static async getWhatsAppLogs(filters = {}) {
    const params = new URLSearchParams(filters);
    return this.request(ENDPOINTS.WHATSAPP.LOGS(params.toString()));
  }

  static async getWhatsAppStatus(salonId = '') {
    return this.request(ENDPOINTS.WHATSAPP.STATUS(salonId));
  }

  static async simulateWhatsAppMessage(payload) {
    return this.request(ENDPOINTS.WHATSAPP.SIMULATE, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Super Admin Platform
  static async getAllSalonsPlatform() {
    return this.request(ENDPOINTS.SALONS.PLATFORM_ALL);
  }

  static async createSalonPlatform(payload) {
    return this.request(ENDPOINTS.SALONS.PLATFORM_CREATE, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  static async getDeactivationPreview(salonId) {
    return this.request(ENDPOINTS.SALONS.PLATFORM_DEACTIVATION_PREVIEW(salonId));
  }

  static async toggleSalonStatusPlatform(salonId, forceCancel = false) {
    return this.request(ENDPOINTS.SALONS.PLATFORM_TOGGLE_STATUS(salonId, forceCancel), {
      method: 'PATCH',
      body: JSON.stringify({ forceCancelBookings: forceCancel }),
    });
  }

  static async verifyMetaPhoneId(phoneNumberId) {
    return this.request(ENDPOINTS.SALONS.PLATFORM_VERIFY_META_PHONE(phoneNumberId));
  }

  static async verifySalonPhoneNumber(phone, usePlatformBot = false) {
    return this.request(ENDPOINTS.SALONS.PLATFORM_VERIFY_PHONE, {
      method: 'POST',
      body: JSON.stringify({ phone, usePlatformBot }),
    });
  }

  static async linkSalonWhatsAppAccount(salonId, phoneNumberId) {
    return this.request(ENDPOINTS.SALONS.PLATFORM_LINK_WHATSAPP(salonId), {
      method: 'POST',
      body: JSON.stringify({ phoneNumberId }),
    });
  }

  static async deleteSalonPlatform(salonId) {
    return this.request(ENDPOINTS.SALONS.PLATFORM_DELETE(salonId), {
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
    return this.request(ENDPOINTS.PLATFORM.ERRORS(query.toString()));
  }

  static async getErrorLogById(id) {
    return this.request(ENDPOINTS.PLATFORM.ERROR_BY_ID(id));
  }

  static async resolveErrorLog(id, resolutionNotes = '') {
    return this.request(ENDPOINTS.PLATFORM.ERROR_RESOLVE(id), {
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

if (typeof window !== 'undefined') {
  window.ApiClient = ApiClient;
}
