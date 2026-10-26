/**
 * LOCAL-FIRST SALON REPOSITORY
 * 
 * Provides instantaneous (<10ms) screen renders via Stale-While-Revalidate (SWR),
 * localStorage persistence, in-memory caching, mutation auto-invalidation,
 * and unified salon workspace state.
 */

import { HttpClient } from '../network/http-client.js';
import { ENDPOINTS } from '../network/endpoints.js';
import { SalonSession } from '../network/session-manager.js';

class SalonRepositoryEngine {
  constructor() {
    this.memoryStore = new Map();
    this.subscribers = new Map();

    // Cross-tab synchronization: Invalidate in-memory cache if another tab updates localStorage
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', (event) => {
        if (event.key && event.key.startsWith('ss_')) {
          this.memoryStore.delete(event.key);
          const parts = event.key.split('_');
          const entity = parts.slice(2).join('_');
          if (entity && event.newValue) {
            try {
              const parsed = JSON.parse(event.newValue);
              this.emit(`${entity}:updated`, parsed);
            } catch (_) {}
          }
        }
      });
    }
  }

  getStorageKey(entity) {
    const user = SalonSession.getUser();
    const salonId = user?.salonId || user?.salon?.id || 'default';
    return `ss_${salonId}_${entity}`;
  }

  // Event Subscription for Smooth In-Place Updates
  on(event, callback) {
    if (!this.subscribers.has(event)) {
      this.subscribers.set(event, new Set());
    }
    this.subscribers.get(event).add(callback);
    return () => this.subscribers.get(event)?.delete(callback);
  }

  emit(event, data) {
    const listeners = this.subscribers.get(event);
    if (listeners) {
      listeners.forEach((cb) => {
        try { cb(data); } catch (e) { console.warn(`[SalonRepository] Listener error on ${event}:`, e); }
      });
    }
  }

  readLocal(entity) {
    const key = this.getStorageKey(entity);
    if (this.memoryStore.has(key)) {
      return this.memoryStore.get(key);
    }
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        this.memoryStore.set(key, parsed);
        return parsed;
      }
    } catch (_) {}
    return null;
  }

  writeLocal(entity, data) {
    const key = this.getStorageKey(entity);
    this.memoryStore.set(key, data);
    try {
      if (data !== undefined && data !== null) {
        localStorage.setItem(key, JSON.stringify(data));
      } else {
        localStorage.removeItem(key);
      }
    } catch (_) {}
  }

  // =========================================================================
  // WORKSPACE CORE (10ms Instant Boot)
  // =========================================================================

  hasCachedWorkspace() {
    const user = SalonSession.getUser();
    if (!user) return false;
    const profile = this.readLocal('profile') || user?.salon;
    return !!(profile && (profile.id || profile.name));
  }

  getCachedWorkspace() {
    const user = SalonSession.getUser();
    return {
      profile: this.readLocal('profile') || user?.salon || {},
      staff: this.readLocal('staff') || [],
      services: this.readLocal('services') || [],
      categories: this.readLocal('categories') || [],
      workingHours: this.readLocal('working_hours') || [],
    };
  }

  // =========================================================================
  // ENTITY ACCESSORS (Stale-While-Revalidate)
  // =========================================================================

  async getSalonProfile(bypassCache = false) {
    const cached = this.readLocal('profile');
    if (cached && !bypassCache) {
      // Revalidate in background
      HttpClient.request(ENDPOINTS.SALONS.PROFILE).then((fresh) => {
        if (fresh && JSON.stringify(fresh) !== JSON.stringify(cached)) {
          this.writeLocal('profile', fresh);
          this.emit('profile:updated', fresh);
        }
      }).catch(() => {});
      return cached;
    }

    const fresh = await HttpClient.request(ENDPOINTS.SALONS.PROFILE);
    this.writeLocal('profile', fresh);
    this.emit('profile:updated', fresh);
    return fresh;
  }

  async getStaff(bypassCache = false) {
    const cached = this.readLocal('staff');
    if (cached && Array.isArray(cached) && !bypassCache) {
      // Revalidate in background
      HttpClient.request(ENDPOINTS.STAFF.LIST()).then((fresh) => {
        if (Array.isArray(fresh) && JSON.stringify(fresh) !== JSON.stringify(cached)) {
          this.writeLocal('staff', fresh);
          this.emit('staff:updated', fresh);
        }
      }).catch(() => {});
      return cached;
    }

    const fresh = await HttpClient.request(ENDPOINTS.STAFF.LIST());
    const list = Array.isArray(fresh) ? fresh : [];
    this.writeLocal('staff', list);
    this.emit('staff:updated', list);
    return list;
  }

  async getServices(bypassCache = false) {
    const cached = this.readLocal('services');
    if (cached && Array.isArray(cached) && !bypassCache) {
      HttpClient.request(ENDPOINTS.SERVICES.LIST()).then((fresh) => {
        if (Array.isArray(fresh) && JSON.stringify(fresh) !== JSON.stringify(cached)) {
          this.writeLocal('services', fresh);
          this.emit('services:updated', fresh);
        }
      }).catch(() => {});
      return cached;
    }

    const fresh = await HttpClient.request(ENDPOINTS.SERVICES.LIST());
    const list = Array.isArray(fresh) ? fresh : [];
    this.writeLocal('services', list);
    this.emit('services:updated', list);
    return list;
  }

  async getServiceCategories(bypassCache = false) {
    const cached = this.readLocal('categories');
    if (cached && Array.isArray(cached) && !bypassCache) {
      HttpClient.request(ENDPOINTS.SERVICES.CATEGORIES).then((fresh) => {
        if (Array.isArray(fresh)) {
          this.writeLocal('categories', fresh);
          this.emit('categories:updated', fresh);
        }
      }).catch(() => {});
      return cached;
    }

    const fresh = await HttpClient.request(ENDPOINTS.SERVICES.CATEGORIES);
    const list = Array.isArray(fresh) ? fresh : [];
    this.writeLocal('categories', list);
    this.emit('categories:updated', list);
    return list;
  }

  async getSalonWorkingHours(bypassCache = false) {
    const cached = this.readLocal('working_hours');
    if (cached && Array.isArray(cached) && !bypassCache) {
      HttpClient.request(ENDPOINTS.SALONS.WORKING_HOURS).then((fresh) => {
        if (Array.isArray(fresh)) {
          this.writeLocal('working_hours', fresh);
          this.emit('working_hours:updated', fresh);
        }
      }).catch(() => {});
      return cached;
    }

    const fresh = await HttpClient.request(ENDPOINTS.SALONS.WORKING_HOURS);
    const list = Array.isArray(fresh) ? fresh : [];
    this.writeLocal('working_hours', list);
    this.emit('working_hours:updated', list);
    return list;
  }

  async getSalonBreaks(bypassCache = false) {
    const cached = this.readLocal('breaks');
    if (cached && !bypassCache) {
      HttpClient.request(ENDPOINTS.SALONS.BREAKS).then((fresh) => {
        if (fresh) this.writeLocal('breaks', fresh);
      }).catch(() => {});
      return cached;
    }

    const fresh = await HttpClient.request(ENDPOINTS.SALONS.BREAKS);
    this.writeLocal('breaks', fresh);
    return fresh;
  }

  async getSalonClosures(bypassCache = false) {
    const cached = this.readLocal('closures');
    if (cached && Array.isArray(cached) && !bypassCache) {
      HttpClient.request(ENDPOINTS.SALONS.CLOSURES).then((fresh) => {
        if (Array.isArray(fresh)) this.writeLocal('closures', fresh);
      }).catch(() => {});
      return cached;
    }

    const fresh = await HttpClient.request(ENDPOINTS.SALONS.CLOSURES);
    const list = Array.isArray(fresh) ? fresh : [];
    this.writeLocal('closures', list);
    return list;
  }

  // =========================================================================
  // MUTATION INVALIDATION ENGINE
  // =========================================================================

  invalidate(entity) {
    const key = this.getStorageKey(entity);
    this.memoryStore.delete(key);
    try { localStorage.removeItem(key); } catch (_) {}

    // Immediately trigger silent background refresh for the invalidated entity
    if (entity === 'staff') this.getStaff(true);
    else if (entity === 'services') this.getServices(true);
    else if (entity === 'profile') this.getSalonProfile(true);
    else if (entity === 'categories') this.getServiceCategories(true);
    else if (entity === 'working_hours') this.getSalonWorkingHours(true);
    else if (entity === 'closures') this.getSalonClosures(true);
  }

  clear(explicitSalonId = null) {
    this.memoryStore.clear();
    const user = SalonSession.getUser();
    const salonId = explicitSalonId || user?.salonId || user?.salon?.id;
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith('ss_')) {
            if (!salonId || k.startsWith(`ss_${salonId}_`)) {
              keysToRemove.push(k);
            }
          }
        }
        keysToRemove.forEach((k) => localStorage.removeItem(k));
      } catch (_) {}
    }
  }
}

export const SalonRepository = new SalonRepositoryEngine();
