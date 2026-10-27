/**
 * LoadingOverlay
 * Reusable full-screen lightweight loading overlay component.
 * Displays a subtle blurred backdrop and a sleek, minimal floating pill loader.
 *
 * Usage:
 *   import { LoadingOverlay } from './modules/shared/loading-overlay.js';
 *   // or window.LoadingOverlay
 *
 *   LoadingOverlay.show('Saving changes...');
 *   LoadingOverlay.hide();
 */

class LoadingOverlayManager {
  constructor() {
    this._overlayEl = null;
    this._textEl = null;
    this._hideTimeout = null;
  }

  /**
   * Ensures the overlay DOM element exists.
   */
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
        <span class="schedule-overlay-text" id="global-loading-overlay-text">Saving...</span>
      </div>
    `;

    this._overlayEl = el;
    this._textEl = el.querySelector('#global-loading-overlay-text');
  }

  /**
   * Shows the loading overlay.
   * @param {string} [text='Saving...'] - Text to display in the pill.
   */
  show(text = 'Saving...') {
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
   * Updates the loading overlay text while it is visible.
   * @param {string} text - Updated text.
   */
  setText(text) {
    if (this._textEl) {
      this._textEl.textContent = text;
    }
  }

  /**
   * Hides the loading overlay with a smooth transition.
   * @param {number} [delay=150] - Delay in milliseconds before hiding.
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

export const LoadingOverlay = new LoadingOverlayManager();

// Also expose globally for convenience across non-module scripts
if (typeof window !== 'undefined') {
  window.LoadingOverlay = LoadingOverlay;
}
