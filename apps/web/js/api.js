const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:3000/api/v1'
  : 'https://salon-api-tuwo.onrender.com/api/v1';

export class ApiClient {
  static getToken() {
    return localStorage.getItem('salon_saas_token');
  }

  static setToken(token) {
    localStorage.setItem('salon_saas_token', token);
  }

  static removeToken() {
    localStorage.removeItem('salon_saas_token');
  }

  static async request(endpoint, options = {}) {
    const token = this.getToken();
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 401 && !endpoint.includes('/auth/login')) {
          this.removeToken();
          throw new Error('Session expired or unauthorized. Please log in again.');
        }
        throw new Error(data.message || 'An error occurred during request.');
      }

      return data.data !== undefined ? data.data : data;
    } catch (err) {
      console.error(`API Error on ${endpoint}:`, err);
      throw err;
    }
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
    return data;
  }

  static async getMe() {
    return this.request('/auth/me');
  }

  // Public Booking
  static async getPublicSalon(slug) {
    return this.request(`/booking/${slug}`);
  }

  static async getPublicAvailability(slug, serviceId, date, staffId = null) {
    let url = `/booking/${slug}/availability?serviceId=${serviceId}&date=${date}`;
    if (staffId) {
      url += `&staffId=${staffId}`;
    }
    return this.request(url);
  }

  static async createPublicAppointment(slug, payload) {
    return this.request(`/booking/${slug}/appointments`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Salon Dashboard & Appointments
  static async getDashboardSummary(dateStr) {
    const endpoint = dateStr ? `/reports/dashboard?date=${dateStr}` : '/reports/dashboard';
    return this.request(endpoint);
  }

  static async getAppointments(filters = {}) {
    const query = new URLSearchParams(filters).toString();
    return this.request(`/appointments?${query}`);
  }

  static async getAppointmentById(id) {
    return this.request(`/appointments/${id}`);
  }

  static async createAppointment(payload) {
    return this.request('/appointments', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  static async updateAppointmentStatus(id, status, reason = '') {
    return this.request(`/appointments/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, reason }),
    });
  }

  static async rescheduleAppointment(id, payload) {
    return this.request(`/appointments/${id}/reschedule`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Staff Management
  static async getStaff() {
    return this.request('/staff');
  }

  static async createStaff(payload) {
    return this.request('/staff', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  static async updateStaff(id, payload) {
    return this.request(`/staff/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  static async toggleStaffStatus(id) {
    return this.request(`/staff/${id}/toggle-status`, {
      method: 'PATCH',
    });
  }

  static async assignStaffServices(staffId, serviceIds) {
    return this.request(`/staff/${staffId}/services`, {
      method: 'PUT',
      body: JSON.stringify({ serviceIds }),
    });
  }

  static async deleteStaff(id) {
    return this.request(`/staff/${id}`, {
      method: 'DELETE',
    });
  }

  static async updateStaffWorkingHours(staffId, hours) {
    return this.request(`/staff/${staffId}/working-hours`, {
      method: 'PUT',
      body: JSON.stringify({ hours }),
    });
  }

  static async createStaffBreak(staffId, payload) {
    return this.request(`/staff/${staffId}/breaks`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  static async deleteStaffBreak(staffId, breakId) {
    return this.request(`/staff/${staffId}/breaks/${breakId}`, {
      method: 'DELETE',
    });
  }

  // Service Management
  static async getServices() {
    return this.request('/services');
  }

  static async createService(payload) {
    return this.request('/services', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  static async updateService(id, payload) {
    return this.request(`/services/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  static async toggleServiceStatus(id) {
    return this.request(`/services/${id}/toggle-status`, {
      method: 'PATCH',
    });
  }

  static async deleteService(id) {
    return this.request(`/services/${id}`, {
      method: 'DELETE',
    });
  }

  // Salon Configuration & Blocked Times
  static async getSalonProfile() {
    return this.request('/salons/profile');
  }

  static async updateSalonProfile(payload) {
    return this.request('/salons/profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  static async getBlockedTimes() {
    return this.request('/salons/blocked-times');
  }

  static async addBlockedTime(payload) {
    return this.request('/salons/blocked-times', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  static async deleteBlockedTime(id) {
    return this.request(`/salons/blocked-times/${id}`, {
      method: 'DELETE',
    });
  }

  static async getHolidays() {
    return this.request('/salons/holidays');
  }

  static async addHoliday(payload) {
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
