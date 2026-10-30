/**
 * ============================================================================
 * STYLESLOT UNIFIED APPLICATION LOADING SYSTEM
 * ============================================================================
 * 
 * Single Source of Truth for all loading indicators across StyleSlot.
 * Standardizes the 3 distinct loading tiers so developers and users are never confused:
 * 
 * 1. AppBootLoader       (Tier 1: Full-Screen Initial App Launch & Workspace Boot)
 * 2. PageDataLoader      (Tier 2: Inline Page / Tab / Section Asynchronous Data Fetching)
 * 3. ActionOverlayLoader  (Tier 3: User Action / Mutation Universal Full-Screen Overlay)
 * ============================================================================
 */

// ============================================================================
// TIER 1: AppBootLoader
// Displayed when the app is first opened, reloaded, or authenticating workspace.
// ============================================================================
export class AppBootLoader {
  /**
   * Renders the full-screen initial app launch splash loader.
   * @param {string} [statusText='Connecting to salon workspace...']
   * @returns {string} HTML string
   */
  static render(statusText = 'Connecting to salon workspace...') {
    return `
      <div class="app-boot-loader-wrap">
        <div class="universal-loader-spinner" style="width: 52px; height: 52px;">
          <div class="universal-loader-ring-outer" style="border-width: 3.5px;"></div>
          <div class="universal-loader-ring-inner" style="inset: 8px; border-width: 2.5px;"></div>
          <div class="universal-loader-dot" style="width: 10px; height: 10px;"></div>
        </div>
        <div class="app-boot-loader-text-group">
          <div class="app-boot-loader-brand">StyleSlot Operations</div>
          <div class="app-boot-loader-status" id="app-boot-status-text">${statusText}</div>
          <div class="universal-loader-shimmer-track" style="width: 160px; margin-top: 8px;">
            <div class="universal-loader-shimmer-thumb"></div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Dynamically update the status text of the boot loader if visible.
   * @param {string} text
   */
  static updateStatus(text) {
    const el = document.getElementById('app-boot-status-text') || document.getElementById('loading-status-text');
    if (el) el.textContent = text;
  }
}

// ============================================================================
// TIER 2: PageDataLoader
// Displayed inside page containers, subtabs, or cards while fetching live data.
// ============================================================================
export class PageDataLoader {
  /**
   * Renders the universal luxury animated inline loader.
   * @param {Object|string} [options={}]
   * @param {string} [options.title='Loading live calendar...']
   * @param {string} [options.subtitle='Syncing live salon schedule...']
   * @param {string} [options.minHeight='360px']
   * @param {'default'|'compact'} [options.variant='default']
   * @returns {string} HTML string
   */
  static render(options = {}) {
    const title = typeof options === 'string'
      ? options
      : (options.title || 'Loading live calendar...');
    const subtitle = typeof options === 'object' && options.subtitle !== undefined
      ? options.subtitle
      : 'Syncing live salon schedule...';
    const minHeight = typeof options === 'object' && options.minHeight
      ? options.minHeight
      : '360px';
    const isCompact = typeof options === 'object' && options.variant === 'compact';

    if (isCompact) {
      return `
        <div class="universal-loader-wrap" style="min-height: ${minHeight}; padding: 18px 12px; gap: 10px;">
          <div class="universal-loader-spinner" style="width: 28px; height: 28px;">
            <div class="universal-loader-ring-outer" style="border-width: 2px;"></div>
            <div class="universal-loader-dot" style="width: 5px; height: 5px;"></div>
          </div>
          <span style="font-size: 0.78rem; font-weight: 600; color: #cbd5e1;">${title}</span>
        </div>
      `;
    }

    return `
      <div class="universal-loader-wrap" style="min-height: ${minHeight};">
        <div class="universal-loader-spinner">
          <div class="universal-loader-ring-outer"></div>
          <div class="universal-loader-ring-inner"></div>
          <div class="universal-loader-dot"></div>
        </div>
        <div class="universal-loader-text-group">
          <div class="universal-loader-title">${title}</div>
          ${subtitle ? `<div class="universal-loader-subtitle">${subtitle}</div>` : ''}
          <div class="universal-loader-shimmer-track">
            <div class="universal-loader-shimmer-thumb"></div>
          </div>
        </div>
      </div>
    `;
  }
}

// ============================================================================
// TIER 3: ActionOverlayLoader
// Displayed when the user performs an active mutation / operation.
// Blocks double-clicks and shows a floating pill with dynamic status.
// ============================================================================
class ActionOverlayLoaderManager {
  constructor() {
    this._overlayEl = null;
    this._textEl = null;
    this._hideTimeout = null;
  }

  _ensureElement() {
    if (this._overlayEl && document.body.contains(this._overlayEl)) {
      return;
    }

    let el = document.getElementById('global-schedule-fullscreen-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'global-schedule-fullscreen-overlay';
      el.className = 'schedule-fullscreen-overlay';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }

    el.innerHTML = `
      <div class="schedule-overlay-simple">
        <div class="schedule-clean-spinner"></div>
        <span class="schedule-overlay-text" id="global-loading-overlay-text">Saving changes...</span>
      </div>
    `;

    this._overlayEl = el;
    this._textEl = el.querySelector('#global-loading-overlay-text');
  }

  /**
   * Shows the action loading overlay.
   * @param {string} [text='Saving changes...']
   */
  show(text = 'Saving changes...') {
    this._ensureElement();

    if (this._hideTimeout) {
      clearTimeout(this._hideTimeout);
      this._hideTimeout = null;
    }

    if (this._textEl) {
      this._textEl.textContent = text;
    }

    void this._overlayEl.offsetHeight;
    this._overlayEl.classList.add('is-active');
  }

  /**
   * Updates overlay text while visible.
   * @param {string} text
   */
  setText(text) {
    if (this._textEl) {
      this._textEl.textContent = text;
    }
  }

  /**
   * Smoothly hides the action loading overlay.
   * @param {number} [delay=150]
   */
  hide(delay = 150) {
    if (!this._overlayEl) return;

    if (this._hideTimeout) {
      clearTimeout(this._hideTimeout);
    }

    this._hideTimeout = setTimeout(() => {
      if (this._overlayEl) {
        this._overlayEl.classList.remove('is-active');
      }
    }, delay);
  }
}

export const ActionOverlayLoader = new ActionOverlayLoaderManager();

// ============================================================================
// MASTER NAMESPACE & CONVENIENCE ALIASES
// ============================================================================
export const AppLoaders = {
  Boot: AppBootLoader,
  Page: PageDataLoader,
  Action: ActionOverlayLoader,
};

// Aliases for seamless backward compatibility
export {
  AppBootLoader as InitialSplashLoader,
  PageDataLoader as UniversalLoader,
  ActionOverlayLoader as LoadingOverlay,
};

// Global exposure across all scripts & console debugging
if (typeof window !== 'undefined') {
  window.AppLoaders = AppLoaders;
  window.AppBootLoader = AppBootLoader;
  window.PageDataLoader = PageDataLoader;
  window.ActionOverlayLoader = ActionOverlayLoader;
  window.UniversalLoader = PageDataLoader;
  window.LoadingOverlay = ActionOverlayLoader;
}
