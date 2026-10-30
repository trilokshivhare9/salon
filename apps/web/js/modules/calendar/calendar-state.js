import { ApiClient, SalonRepository } from '../../api.js';
import { LoadingOverlay } from '../shared/loading-overlay.js';
import { RealtimeNotifier } from '../../realtime.js';
import { AppSnackbar } from '../shared/app-snackbar.js';

/**
 * CalendarState
 * Centralized, production-grade state management, notification, loading,
 * and cache synchronization engine for Salon Closures, Specialist Leaves, and Calendar Views.
 */
class CalendarStateEngine {
  constructor() {
    this._listeners = new Set();
    this._activeView = null;
  }

  /**
   * Register the currently mounted CalendarView instance.
   * @param {Object} view
   */
  registerActiveView(view) {
    this._activeView = view;
  }

  /**
   * Unregister a CalendarView when unmounted.
   * @param {Object} view
   */
  unregisterActiveView(view) {
    if (this._activeView === view) {
      this._activeView = null;
    }
  }

  /**
   * Get the active CalendarView instance from state or dashboard.
   */
  getActiveView() {
    if (this._activeView && typeof this._activeView.refresh === 'function') {
      return this._activeView;
    }
    const dashCal = window.salonDashboard?.currentCalendarView || window.dashboardApp?.currentCalendarView;
    if (dashCal && typeof dashCal.refresh === 'function') {
      return dashCal;
    }
    return null;
  }

  /**
   * Display a sleek, non-blocking luxury snackbar notification without text truncation.
   * Safely updates action timestamps without risking 'this' context detachment.
   * @param {string} msg
   * @param {'info'|'success'|'warning'|'error'} [type='info']
   */
  notify(msg, type = 'info') {
    const now = Date.now();
    window.lastLocalActionTimestamp = now;
    window.lastDashboardActionTimestamp = now;
    if (window.salonDashboard) {
      window.salonDashboard.lastLocalActionTimestamp = now;
    }
    if (window.dashboardApp) {
      window.dashboardApp.lastLocalActionTimestamp = now;
    }

    try {
      AppSnackbar.show(msg, type);
    } catch (_) {
      console.log(`[CalendarState] [${type.toUpperCase()}]`, msg);
    }
  }

  /**
   * Universal loading overlay helper.
   * @param {string} text
   */
  showLoading(text = 'Updating calendar...') {
    try {
      LoadingOverlay.show(text);
    } catch (_) {}
  }

  /**
   * Universal loading overlay hide helper.
   * @param {number} delay
   */
  hideLoading(delay = 150) {
    try {
      LoadingOverlay.hide(delay);
    } catch (_) {}
  }

  /**
   * Modern, dark-themed confirmation modal that replaces primitive native window.confirm.
   * Returns a Promise resolving to true (confirmed) or false (cancelled).
   * @param {Object} options
   * @param {string} options.title
   * @param {string} options.message
   * @param {string} [options.confirmText='Confirm']
   * @param {string} [options.cancelText='Cancel']
   * @param {string} [options.icon='⚠️']
   * @param {'danger'|'warning'|'primary'} [options.type='danger']
   * @returns {Promise<boolean>}
   */
  confirm(options = {}) {
    return new Promise((resolve) => {
      const {
        title = 'Are you sure?',
        message = 'Please confirm this action.',
        confirmText = 'Confirm',
        cancelText = 'Cancel',
        icon = '⚠️',
        type = 'danger',
      } = options;

      const modalId = `calendar-confirm-modal-${Date.now()}`;
      const backdrop = document.createElement('div');
      backdrop.id = modalId;
      backdrop.className = 'calendar-confirm-backdrop';
      backdrop.style.cssText = 'position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; background: rgba(0, 0, 0, 0.78) !important; backdrop-filter: blur(8px) !important; -webkit-backdrop-filter: blur(8px) !important; display: flex !important; align-items: center !important; justify-content: center !important; z-index: 999999 !important; padding: 20px !important; box-sizing: border-box !important; margin: 0 !important;';

      const confirmBtnBg = type === 'danger'
        ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
        : 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)';
      const confirmBtnShadow = type === 'danger'
        ? '0 4px 14px rgba(239, 68, 68, 0.4)'
        : '0 4px 14px rgba(139, 92, 246, 0.4)';

      backdrop.innerHTML = `
        <div class="calendar-confirm-card" style="max-width: 420px; width: 100%; margin: auto !important; padding: 24px; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 18px; background: #0f172a; box-shadow: 0 25px 60px rgba(0, 0, 0, 0.9); animation: modalFadeIn 0.2s ease-out; box-sizing: border-box;">
          <div style="display: flex; align-items: flex-start; gap: 14px; margin-bottom: 20px;">
            <div style="width: 46px; height: 46px; border-radius: 14px; background: ${type === 'danger' ? 'rgba(239, 68, 68, 0.14)' : 'rgba(139, 92, 246, 0.14)'}; border: 1px solid ${type === 'danger' ? 'rgba(239, 68, 68, 0.28)' : 'rgba(139, 92, 246, 0.28)'}; display: flex; align-items: center; justify-content: center; font-size: 1.4rem; flex-shrink: 0;">
              ${icon}
            </div>
            <div style="flex: 1; min-width: 0;">
              <h4 style="margin: 0; font-size: 1.05rem; font-weight: 800; color: #fff; line-height: 1.3;">${title}</h4>
              <p style="margin: 6px 0 0 0; font-size: 0.82rem; color: #94a3b8; line-height: 1.5;">${message}</p>
            </div>
          </div>
          <div style="display: flex; justify-content: flex-end; align-items: center; gap: 10px; margin-top: 22px;">
            <button type="button" id="${modalId}-cancel" style="padding: 9px 18px; border-radius: 10px; background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.14); color: #cbd5e1; font-size: 0.82rem; font-weight: 600; cursor: pointer; transition: all 0.15s ease;">
              ${cancelText}
            </button>
            <button type="button" id="${modalId}-confirm" style="padding: 9px 20px; border-radius: 10px; background: ${confirmBtnBg}; border: none; color: #fff; font-size: 0.82rem; font-weight: 700; cursor: pointer; box-shadow: ${confirmBtnShadow}; transition: all 0.15s ease;">
              ${confirmText}
            </button>
          </div>
        </div>
      `;

      document.body.appendChild(backdrop);

      const cleanup = (result) => {
        backdrop.remove();
        resolve(result);
      };

      backdrop.querySelector(`#${modalId}-cancel`)?.addEventListener('click', () => cleanup(false));
      backdrop.querySelector(`#${modalId}-confirm`)?.addEventListener('click', () => cleanup(true));
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) cleanup(false);
      });
    });
  }

  /**
   * High-performance, optimized calendar and leave state refresh pipeline.
   * Performs an instant in-place re-render of the active calendar and syncs
   * background dashboard caches asynchronously without blocking user interactions.
   */
  async refreshAll() {
    try {
      // 1. Invalidate caches in repository and HTTP layer
      ApiClient.invalidateCache('/salons/closures');
      ApiClient.invalidateCache('/salons/closures/calendar-schedule');
      ApiClient.invalidateCache('/staff');
      ApiClient.invalidateCache('/reports');
      SalonRepository.invalidate('closures');
      SalonRepository.invalidate('staff');

      // 2. High-speed in-place refresh of active CalendarView
      const activeView = this.getActiveView();
      if (activeView && typeof activeView.fetchFreshSchedule === 'function') {
        await activeView.fetchFreshSchedule();
        activeView.render();
        activeView.attachListeners();
      }

      // 3. Background Sync (Fire-and-forget: do NOT await so UI is unblocked immediately)
      if (window.salonDashboard?.loadData) {
        window.salonDashboard.loadData(true).catch(() => {});
      } else if (window.dashboardApp?.loadData) {
        window.dashboardApp.loadData(true).catch(() => {});
      }
    } catch (err) {
      console.warn('[CalendarState] refreshAll warning:', err);
    }
  }

  /**
   * Optimistically remove a salon closure from active view for instant (0ms) feedback.
   * @param {string} closureId
   */
  optimisticRemoveClosure(closureId) {
    try {
      const activeView = this.getActiveView();
      if (activeView && typeof activeView.removeClosure === 'function') {
        activeView.removeClosure(closureId);
      }
    } catch (e) {
      console.warn('[CalendarState] optimisticRemoveClosure error:', e);
    }
  }

  /**
   * Optimistically remove a staff leave from active view for instant (0ms) feedback.
   * @param {string} absenceId
   */
  optimisticRemoveLeave(absenceId) {
    try {
      const activeView = this.getActiveView();
      if (activeView && typeof activeView.removeStaffLeave === 'function') {
        activeView.removeStaffLeave(absenceId);
      }
    } catch (e) {
      console.warn('[CalendarState] optimisticRemoveLeave error:', e);
    }
  }
}

export const CalendarState = new CalendarStateEngine();

if (typeof window !== 'undefined') {
  window.CalendarState = CalendarState;
  window.showAppToast = (msg, type = 'info') => CalendarState.notify(msg, type);
  window.confirmModal = (opts) => CalendarState.confirm(opts);
}
