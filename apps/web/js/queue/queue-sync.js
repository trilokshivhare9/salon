// Modular Queue State and Real-Time Synchronization Engine
import { ApiClient } from '../api.js';

export class QueueSyncManager {
  constructor(options = {}) {
    this.selectedDate = options.selectedDate || new Date().toISOString().split('T')[0];
    this.statusFilter = options.statusFilter || 'ALL';
    this.stylistFilter = options.stylistFilter || null;
    this.page = options.page || 1;
    this.limit = options.limit || 25;

    this.items = [];
    this.queueSummary = {
      inChair: 0,
      checkedIn: 0,
      upcoming: 0,
      completed: 0,
      cancelled: 0,
    };
    this.pagination = {
      page: 1,
      limit: 25,
      totalItems: 0,
      totalPages: 1,
      hasNextPage: false,
      hasPrevPage: false,
    };

    this.onStateChange = options.onStateChange || null;
  }

  setDate(dateStr) {
    if (dateStr && dateStr !== this.selectedDate) {
      this.selectedDate = dateStr;
      this.page = 1;
    }
  }

  setFilters({ status, stylistId, page }) {
    if (status !== undefined) this.statusFilter = status;
    if (stylistId !== undefined) this.stylistFilter = stylistId;
    if (page !== undefined) this.page = page;
  }

  async fetchQueue(bypassCache = true) {
    try {
      const res = await ApiClient.getQueue(
        {
          date: this.selectedDate,
          page: this.page,
          limit: this.limit,
          status: this.statusFilter !== 'ALL' ? this.statusFilter : undefined,
          stylistId: this.stylistFilter || undefined,
        },
        bypassCache,
      );

      // ApiClient unwraps `data.data`, so `res` may be { items, queueSummary, pagination }
      // or { data: { items, queueSummary, pagination } } depending on wrapper.
      const payload = (res && Array.isArray(res.items))
        ? res
        : (res && res.data && Array.isArray(res.data.items) ? res.data : (res?.data || res || {}));

      this.items = Array.isArray(payload.items) ? payload.items : [];
      if (payload.queueSummary) {
        this.queueSummary = payload.queueSummary;
      }
      if (payload.pagination) {
        this.pagination = payload.pagination;
      }

      this.notifyChange('FETCH');
      return { success: true, data: payload };
    } catch (err) {
      console.warn('[QueueSyncManager] fetchQueue error:', err);
      return { success: false, error: err };
    }
  }

  /**
   * Dispatches incoming real-time SSE events with ZERO network overhead.
   * Handles date mismatches, direct in-memory patching, and priority re-sorting.
   */
  handleRealtimeEvent(event) {
    if (!event || !event.type) return { handled: false };
    const { type, data } = event;
    if (!data || !data.id) return { handled: false };

    const eventDateStr = (data.startAt || data.startTime || '').split('T')[0];
    const isCurrentDate = !eventDateStr || eventDateStr === this.selectedDate;

    // 1. If event is for a different operational date, do not disrupt current view
    if (!isCurrentDate) {
      return {
        handled: true,
        isCurrentDate: false,
        eventDate: eventDateStr,
        type,
      };
    }

    // 2. In-Memory Delta Update for Current Date
    let mutated = false;

    switch (type) {
      case 'STATUS_UPDATED':
      case 'APPOINTMENT_UPDATED':
      case 'RESCHEDULED': {
        const idx = this.items.findIndex((a) => a.id === data.id);
        if (idx !== -1) {
          // Unified model allows direct object merge
          this.items[idx] = { ...this.items[idx], ...data };
        } else if (this.page === 1) {
          this.items.unshift(data);
          this.pagination.totalItems = (this.pagination.totalItems || 0) + 1;
        }
        this.sortItemsInPlace();
        this.recalculateSummary();
        mutated = true;
        break;
      }

      case 'NEW_BOOKING': {
        const exists = this.items.some((a) => a.id === data.id);
        if (!exists) {
          if (this.page === 1) {
            this.items.unshift(data);
            this.sortItemsInPlace();
          }
          this.pagination.totalItems = (this.pagination.totalItems || 0) + 1;
          this.recalculateSummary();
          mutated = true;
        }
        break;
      }

      case 'BOOKING_CANCELLED':
      case 'CANCELLED': {
        const idx = this.items.findIndex((a) => a.id === data.id);
        if (idx !== -1) {
          this.items[idx] = { ...this.items[idx], ...data, status: 'CANCELLED' };
          this.sortItemsInPlace();
          this.recalculateSummary();
          mutated = true;
        }
        break;
      }

      default:
        break;
    }

    if (mutated) {
      this.notifyChange(type, data);
    }

    return {
      handled: true,
      isCurrentDate: true,
      mutated,
      type,
      data,
    };
  }

  /**
   * Sorts items in memory following operational priority weighting.
   */
  sortItemsInPlace() {
    const STATUS_PRIORITY_WEIGHT = {
      SEATED_IN_CHAIR: 1,
      IN_SERVICE: 1,
      CHECKED_IN: 2,
      ON_THE_WAY: 3,
      CONFIRMED: 4,
      BOOKED: 5,
      PENDING_ACCEPTANCE: 6,
      PENDING_RESCHEDULE: 7,
      COMPLETED: 8,
      CANCELLED: 9,
      REJECTED: 10,
    };

    this.items.sort((a, b) => {
      const weightA = STATUS_PRIORITY_WEIGHT[a.status] || 99;
      const weightB = STATUS_PRIORITY_WEIGHT[b.status] || 99;
      if (weightA !== weightB) return weightA - weightB;

      const timeA = a.startAt ? new Date(a.startAt).getTime() : 0;
      const timeB = b.startAt ? new Date(b.startAt).getTime() : 0;
      if (timeA !== timeB) return timeA - timeB;

      return String(a.id).localeCompare(String(b.id));
    });
  }

  /**
   * Recalculates daily summary counters across current memory state.
   */
  recalculateSummary() {
    let inChair = 0;
    let checkedIn = 0;
    let upcoming = 0;
    let completed = 0;
    let cancelled = 0;

    for (const appt of this.items) {
      const st = appt.status;
      if (st === 'SEATED_IN_CHAIR' || st === 'IN_SERVICE') {
        inChair++;
      } else if (st === 'CHECKED_IN' || st === 'ON_THE_WAY') {
        checkedIn++;
      } else if (
        st === 'CONFIRMED' ||
        st === 'BOOKED' ||
        st === 'PENDING_ACCEPTANCE' ||
        st === 'PENDING_RESCHEDULE'
      ) {
        upcoming++;
      } else if (st === 'COMPLETED') {
        completed++;
      } else if (st === 'CANCELLED' || st === 'REJECTED') {
        cancelled++;
      }
    }

    this.queueSummary = { inChair, checkedIn, upcoming, completed, cancelled };
  }

  notifyChange(changeType, payload) {
    if (typeof this.onStateChange === 'function') {
      try {
        this.onStateChange({
          changeType,
          payload,
          items: this.items,
          summary: this.queueSummary,
          pagination: this.pagination,
        });
      } catch (err) {
        console.error('[QueueSyncManager] onStateChange error:', err);
      }
    }
  }
}
