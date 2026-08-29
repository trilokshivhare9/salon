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

  // Staff & Services
  static async getStaff() {
    return this.request('/staff');
  }

  static async getServices() {
    return this.request('/services');
  }

  // Customers
  static async getCustomers(search = '') {
    const endpoint = search ? `/customers?search=${encodeURIComponent(search)}` : '/customers';
    return this.request(endpoint);
  }
}
