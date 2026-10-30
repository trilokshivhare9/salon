/**
 * AppSnackbar
 * Enterprise-grade, reusable luxury notification & snackbar engine.
 * Unified across mobile and desktop for Success, Warning, Error, and Info states.
 * 
 * Guarantees:
 * - NO text truncation (never shows trailing "...")
 * - User-friendly message extraction & humanization (handles Error, Object, Array, Strings)
 * - Auto-dismiss with pause-on-hover & interactive manual dismiss
 * - High z-index (renders cleanly above all modals, drawers, and sheets)
 * - Accessible (role="alert", aria-live="polite")
 */

class AppSnackbarEngine {
  constructor() {
    this._container = null;
    this._maxVisible = 1; // Strict Single-Snackbar Policy: Never stack multiple snackbars for the same or rapid operations
    this._defaultDuration = 4500; // ms
    this.lastNotificationTimestamp = 0;
    this.lastNotificationText = '';
    this.lastNotificationType = '';
  }

  _ensureContainer() {
    if (this._container && document.body.contains(this._container)) {
      return this._container;
    }

    let el = document.getElementById('app-snackbar-container');
    if (!el) {
      el = document.createElement('div');
      el.id = 'app-snackbar-container';
      el.className = 'app-snackbar-container';
      el.setAttribute('role', 'region');
      el.setAttribute('aria-label', 'Notifications');
      document.body.appendChild(el);
    }
    this._container = el;
    return el;
  }

  /**
   * Safely formats and humanizes any message (strings, Error instances, NestJS validation arrays, objects).
   * Ensures the text is NEVER truncated with '...'.
   * @param {any} raw
   * @returns {{ title: string, text: string }}
   */
  _normalizeMessage(raw, type = 'info') {
    let text = '';

    if (raw === null || raw === undefined) {
      text = type === 'error' ? 'An unexpected error occurred. Please try again.' : '';
    } else if (typeof raw === 'string') {
      text = raw.trim();
    } else if (raw instanceof Error) {
      text = raw.message || 'Operation failed.';
    } else if (Array.isArray(raw)) {
      // NestJS validation errors array
      text = raw.map((item) => (typeof item === 'object' ? item.message || JSON.stringify(item) : String(item))).join('. ');
    } else if (typeof raw === 'object') {
      if (raw.message) {
        if (Array.isArray(raw.message)) {
          text = raw.message.join('. ');
        } else {
          text = String(raw.message);
        }
      } else if (raw.error) {
        text = String(raw.error);
      } else if (raw.details) {
        text = String(raw.details);
      } else {
        try {
          text = JSON.stringify(raw);
        } catch (_) {
          text = 'Notification received.';
        }
      }
    } else {
      text = String(raw);
    }

    // Clean up common technical prefixes for end-user friendliness
    text = text.replace(/^Error:\s*/i, '');
    text = text.replace(/^GraphQLError:\s*/i, '');
    text = text.replace(/^[a-zA-Z]*Exception:\s*/i, '');

    // Default titles based on state
    let defaultTitle = 'Notice';
    if (type === 'success') defaultTitle = 'Success';
    else if (type === 'warning') defaultTitle = 'Attention Required';
    else if (type === 'error' || type === 'danger') defaultTitle = 'Action Failed';

    return {
      title: defaultTitle,
      text: text || 'Operation completed.',
    };
  }

  /**
   * Core display method
   * @param {any} message
   * @param {'success'|'warning'|'error'|'danger'|'info'} [type='info']
   * @param {Object} [options]
   * @param {string} [options.title] Custom title override
   * @param {number} [options.duration] Auto-dismiss time in ms (0 = permanent until clicked)
   * @param {string} [options.icon] Custom icon override
   * @param {boolean} [options.deferIfLoading] If true (default for success), waits for action overlay to complete
   * @returns {HTMLElement|null} The created snackbar element
   */
  show(message, type = 'info', options = {}) {
    const container = this._ensureContainer();

    const normalizedType = (type === 'danger' || type === 'error') ? 'error' : (type === 'warning' ? 'warning' : (type === 'success' ? 'success' : 'info'));
    const { title: defaultTitle, text } = this._normalizeMessage(message, normalizedType);
    const title = options.title || defaultTitle;
    const duration = options.duration !== undefined ? options.duration : (normalizedType === 'error' ? 6000 : this._defaultDuration);

    const now = Date.now();

    // Deduplication Guards:
    // 1. Prevent duplicate identical notifications within 2.5 seconds
    if (text === this.lastNotificationText && now - this.lastNotificationTimestamp < 2500) {
      return null;
    }
    // 2. Prevent generic "info" push messages if a "success" notification was just shown within 3.5 seconds
    if (normalizedType === 'info' && this.lastNotificationType === 'success' && now - this.lastNotificationTimestamp < 3500) {
      return null;
    }

    // Update global action timestamps so SSE streams know an action was handled locally
    this.lastNotificationTimestamp = now;
    this.lastNotificationText = text;
    this.lastNotificationType = normalizedType;
    if (typeof window !== 'undefined') {
      window.lastLocalActionTimestamp = now;
      window.lastDashboardActionTimestamp = now;
      if (window.salonDashboard) window.salonDashboard.lastLocalActionTimestamp = now;
      if (window.dashboardApp) window.dashboardApp.lastLocalActionTimestamp = now;
    }

    // If an action overlay loader (such as "Saving...") is active and this is a success message,
    // defer rendering until the loading state is fully complete and dismissed.
    if (normalizedType === 'success' && options.deferIfLoading !== false) {
      const isOverlayActive = typeof document !== 'undefined' && Boolean(
        document.getElementById('global-schedule-fullscreen-overlay')?.classList.contains('is-active')
      );
      if (isOverlayActive) {
        const checkAndShow = () => {
          const stillActive = Boolean(
            document.getElementById('global-schedule-fullscreen-overlay')?.classList.contains('is-active')
          );
          if (stillActive) {
            setTimeout(checkAndShow, 80);
          } else {
            setTimeout(() => {
              this._renderCard(container, title, text, normalizedType, duration, options);
            }, 100);
          }
        };
        setTimeout(checkAndShow, 100);
        return null;
      }
    }

    return this._renderCard(container, title, text, normalizedType, duration, options);
  }

  _renderCard(container, title, text, normalizedType, duration, options = {}) {
    // Limit active snackbars to prevent layout flooding
    const activeCards = container.querySelectorAll('.app-snackbar-card:not(.is-dismissing)');
    if (activeCards.length >= this._maxVisible) {
      for (let i = 0; i <= activeCards.length - this._maxVisible; i++) {
        this.dismiss(activeCards[i]);
      }
    }

    // Style tokens & icons
    let defaultIcon = '⚡';
    if (normalizedType === 'success') defaultIcon = '✓';
    else if (normalizedType === 'warning') defaultIcon = '⚠️';
    else if (normalizedType === 'error') defaultIcon = '✕';
    const icon = options.icon || defaultIcon;

    const card = document.createElement('div');
    card.className = `app-snackbar-card app-snackbar-${normalizedType}`;
    card.setAttribute('role', 'alert');
    card.setAttribute('aria-live', normalizedType === 'error' ? 'assertive' : 'polite');

    card.innerHTML = `
      <div class="app-snackbar-left-accent"></div>
      <div class="app-snackbar-content-wrap">
        <div class="app-snackbar-header-row">
          <div class="app-snackbar-badge-wrap">
            <span class="app-snackbar-status-dot"></span>
            <span class="app-snackbar-badge-label">${title}</span>
          </div>
          <button type="button" class="app-snackbar-close-btn" aria-label="Dismiss">&times;</button>
        </div>
        <div class="app-snackbar-body-row">
          <div class="app-snackbar-icon-box">
            <span>${icon}</span>
          </div>
          <div class="app-snackbar-text-area">
            <p class="app-snackbar-message">${text}</p>
          </div>
        </div>
        ${options.actionText ? `
        <div class="app-snackbar-action-row">
          <button type="button" class="app-snackbar-action-btn">
            <span>${options.actionText}</span>
            <span>→</span>
          </button>
        </div>` : ''}
      </div>
      ${duration > 0 ? `<div class="app-snackbar-progress-bar" style="animation-duration: ${duration}ms;"></div>` : ''}
    `;

    container.appendChild(card);

    // Trigger enter animation on next frame
    requestAnimationFrame(() => {
      card.classList.add('is-visible');
    });

    let dismissTimer = null;
    let isPaused = false;
    let remainingTime = duration;
    let startTime = Date.now();

    const startTimer = () => {
      if (duration > 0) {
        dismissTimer = setTimeout(() => {
          this.dismiss(card);
        }, remainingTime);
      }
    };

    const pauseTimer = () => {
      if (dismissTimer) {
        clearTimeout(dismissTimer);
        dismissTimer = null;
        remainingTime -= (Date.now() - startTime);
        isPaused = true;
        const progressBar = card.querySelector('.app-snackbar-progress-bar');
        if (progressBar) progressBar.style.animationPlayState = 'paused';
      }
    };

    const resumeTimer = () => {
      if (isPaused && remainingTime > 0) {
        startTime = Date.now();
        isPaused = false;
        const progressBar = card.querySelector('.app-snackbar-progress-bar');
        if (progressBar) progressBar.style.animationPlayState = 'running';
        startTimer();
      }
    };

    // Close button dismiss
    card.querySelector('.app-snackbar-close-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.dismiss(card);
    });

    // Optional Action Button handler
    if (options.actionCallback) {
      const actionBtn = card.querySelector('.app-snackbar-action-btn');
      if (actionBtn) {
        actionBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.dismiss(card);
          try {
            options.actionCallback();
          } catch (err) {
            console.error('[AppSnackbar] actionCallback error:', err);
          }
        });
      }
    }

    // Pause auto-dismiss on mouse hover or touch
    card.addEventListener('mouseenter', pauseTimer);
    card.addEventListener('mouseleave', resumeTimer);
    card.addEventListener('touchstart', pauseTimer, { passive: true });
    card.addEventListener('touchend', resumeTimer, { passive: true });

    startTimer();

    return card;
  }

  /**
   * Gracefully animates and cleans up a snackbar card
   * @param {HTMLElement} card
   */
  dismiss(card) {
    if (!card || card.classList.contains('is-dismissing')) return;
    card.classList.add('is-dismissing');
    card.classList.remove('is-visible');
    setTimeout(() => {
      if (card.parentNode) {
        card.parentNode.removeChild(card);
      }
    }, 280);
  }

  /**
   * Dismiss all currently visible snackbars
   */
  dismissAll() {
    if (!this._container) return;
    const cards = this._container.querySelectorAll('.app-snackbar-card');
    cards.forEach((card) => this.dismiss(card));
  }

  // Semantic helper shortcuts
  success(message, options = {}) {
    return this.show(message, 'success', options);
  }

  warning(message, options = {}) {
    return this.show(message, 'warning', options);
  }

  error(message, options = {}) {
    return this.show(message, 'error', options);
  }

  info(message, options = {}) {
    return this.show(message, 'info', options);
  }
}

export const AppSnackbar = new AppSnackbarEngine();

// Universal Window Bindings & Safe Interceptors
if (typeof window !== 'undefined') {
  window.AppSnackbar = AppSnackbar;
  window.showToast = (msg, type = 'info', opts = {}) => AppSnackbar.show(msg, type, opts);
  window.showSnackbar = (msg, type = 'info', opts = {}) => AppSnackbar.show(msg, type, opts);

  // Modern browser defense-in-depth: intercept native window.alert to show modern luxury snackbars
  const originalAlert = window.alert;
  window.alert = function (message) {
    try {
      AppSnackbar.warning(message);
    } catch (_) {
      if (typeof originalAlert === 'function') {
        originalAlert(message);
      }
    }
  };
}
