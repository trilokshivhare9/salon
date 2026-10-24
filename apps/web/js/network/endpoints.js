/**
 * CENTRALIZED API ENDPOINTS REGISTRY
 * 
 * Single source of truth for all backend API routes.
 * Eliminates scattered string literals across the application.
 */

export const ENDPOINTS = {
  // Authentication & Session
  AUTH: {
    LOGIN: '/auth/login',
    REFRESH: '/auth/refresh',
    ME: '/auth/me',
    LOGOUT: '/auth/logout',
    LOGOUT_ALL: '/auth/logout-all',
    REGISTER: '/auth/register',
    FORGOT_PASSWORD_REQUEST: '/auth/forgot-password/request',
    FORGOT_PASSWORD_CONFIRM: '/auth/forgot-password/confirm',
  },

  // Salon Operations & Working Hours
  SALONS: {
    PROFILE: '/salons/profile',
    PERSONAL_PROFILE: '/salons/personal-profile',
    WORKING_HOURS: '/salons/working-hours',
    WORKING_HOURS_DAY: (day) => `/salons/working-hours/${day}`,
    BREAKS: '/salons/breaks',
    BREAK_BY_ID: (id) => `/salons/breaks/${id}`,
    BREAKS_ROUTINE: '/salons/breaks/routine',
    CLOSURES: '/salons/closures',
    CLOSURE_BY_ID: (id) => `/salons/closures/${id}`,
    CLOSURES_SCHEDULE: (query = '') => `/salons/closures/calendar-schedule${query ? (query.startsWith('?') ? query : `?${query}`) : ''}`,
    CLOSURES_HOLIDAYS: (query = '') => `/salons/closures/holidays${query ? (query.startsWith('?') ? query : `?${query}`) : ''}`,
  },

  // Staff Management & Stylist Schedules
  STAFF: {
    LIST: (query = '') => `/staff${query ? (query.startsWith('?') ? query : `?${query}`) : ''}`,
    DETAIL: (id) => `/staff/${id}`,
    CREATE: '/staff',
    UPDATE: (id) => `/staff/${id}`,
    DELETE: (id) => `/staff/${id}`,
    TOGGLE_STATUS: (id) => `/staff/${id}/toggle-status`,
    SERVICES: (staffId) => `/staff/${staffId}/services`,
    WORKING_HOURS: (staffId) => `/staff/${staffId}/working-hours`,
    WORKING_HOURS_DAY: (staffId, day) => `/staff/${staffId}/working-hours/${day}`,
    WORKING_HOURS_RESET: (staffId) => `/staff/${staffId}/working-hours/reset`,
    BREAKS: (staffId) => `/staff/${staffId}/breaks`,
    BREAK_BY_ID: (staffId, breakId) => `/staff/${staffId}/breaks/${breakId}`,
    BREAKS_RESET: (staffId, breakId) => `/staff/${staffId}/breaks/${breakId}/reset`,
    BREAKS_INHERIT: (staffId) => `/staff/${staffId}/breaks/inherit`,
    BREAKS_ROUTINE: (staffId) => `/staff/${staffId}/breaks/routine`,
    ABSENCE: (staffId) => `/staff/${staffId}/absence`,
    ABSENCE_BY_ID: (staffId, absenceId) => `/staff/${staffId}/absence/${absenceId}`,
    ABSENCE_PREVIEW: (staffId, query = '') => `/staff/${staffId}/absence/preview${query ? (query.startsWith('?') ? query : `?${query}`) : ''}`,
    ABSENCE_EXTEND: (staffId, absenceId) => `/staff/${staffId}/absence/${absenceId}/extend`,
    ABSENCE_CANCEL: (staffId, absenceId) => `/staff/${staffId}/absence/${absenceId}/cancel`,
    ABSENCE_CALENDAR: (staffId, query = '') => `/staff/${staffId}/absence/calendar${query ? (query.startsWith('?') ? query : `?${query}`) : ''}`,
  },

  // Services Menu & Categories
  SERVICES: {
    LIST: (query = '') => `/services${query ? (query.startsWith('?') ? query : `?${query}`) : ''}`,
    CATEGORIES: '/services/categories',
    CREATE: '/services',
    UPDATE: (id) => `/services/${id}`,
    DELETE: (id) => `/services/${id}`,
    CATEGORY_CREATE: '/services/categories',
    CATEGORY_UPDATE: (id) => `/services/categories/${id}`,
    CATEGORY_DELETE: (id) => `/services/categories/${id}`,
  },

  // Appointments, Dashboard Summary & Live Queue
  APPOINTMENTS: {
    QUEUE: (query = '') => `/appointments/queue${query ? (query.startsWith('?') ? query : `?${query}`) : ''}`,
    SUMMARY: (dateStr = '') => `/dashboard/summary${dateStr ? `?date=${dateStr}` : ''}`,
    LIST: (query = '') => `/appointments${query ? (query.startsWith('?') ? query : `?${query}`) : ''}`,
    DETAIL: (id) => `/appointments/${id}`,
    CREATE: '/appointments',
    STATUS: (id) => `/appointments/${id}/status`,
    CANCEL: (id) => `/appointments/${id}/cancel`,
    RESCHEDULE: (id) => `/appointments/${id}/reschedule`,
    PROPOSE_RESCHEDULE: (id) => `/appointments/${id}/propose-reschedule`,
    ADDONS: (id) => `/appointments/${id}/addons`,
  },

  // Customer Directory
  CUSTOMERS: {
    LIST: (query = '') => `/customers${query ? (query.startsWith('?') ? query : `?${query}`) : ''}`,
    DETAIL: (id) => `/customers/${id}`,
    HISTORY: (id) => `/customers/${id}/history`,
  },

  // Analytics & Business Performance
  REPORTS: {
    STATS: (range = '30d') => `/reports/stats?range=${range}`,
    HEATMAP: '/reports/heatmap',
    SERVICE_MIX: '/reports/service-mix',
  },

  // WhatsApp Operations & Messaging
  WHATSAPP: {
    CONFIG: '/whatsapp/config',
    QR: '/whatsapp/qr',
    STATUS: '/whatsapp/status',
    SEND_MESSAGE: '/whatsapp/chat/send-message',
    RESUME_BOT: '/whatsapp/chat/resume-bot',
    CHAT_HISTORY: (params) => `/whatsapp/chat/history?${params}`,
    LOGS: (query = '') => `/whatsapp/logs${query ? (query.startsWith('?') ? query : `?${query}`) : ''}`,
    SIMULATE: '/whatsapp/simulate',
  },

  // Public Booking Wizard (Client-facing)
  BOOKING: {
    DETAILS: (slug) => `/booking/${slug}`,
    SLOTS: (slug, dateStr, serviceId, stylistId) =>
      `/booking/${slug}/slots?date=${dateStr}&serviceId=${serviceId}${stylistId ? `&stylistId=${stylistId}` : ''}`,
    CREATE: (slug) => `/booking/${slug}/appointments`,
  },

  // Super Admin Platform Realm
  PLATFORM: {
    TENANTS: '/super-admin/tenants',
    TENANT_BY_ID: (id) => `/super-admin/tenants/${id}`,
    TOGGLE_STATUS: (id) => `/super-admin/tenants/${id}/toggle-status`,
    EXTEND_TRIAL: (id) => `/super-admin/tenants/${id}/extend-trial`,
    METRICS: '/super-admin/tenants/metrics',
    ERROR_LOGS: '/super-admin/error-logs',
    AUDIT_LOGS: '/super-admin/audit-logs',
    BROADCAST_ALERT: '/super-admin/broadcast-alert',
    ANALYTICS: '/super-admin/analytics',
  },

  // Health & Heartbeat
  HEALTH: {
    PING: '/health/ping',
    STATUS: '/health',
  },
};
