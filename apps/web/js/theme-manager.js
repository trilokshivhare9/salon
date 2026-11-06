/**
 * StyleSlot Centralized Enterprise Theme Architecture
 * 
 * Supports seamless Dark & Light mode transitions based on the StyleSlot Emerald Design System.
 * - Single source of truth for runtime theme state
 * - Zero-FOUC persistence in localStorage
 * - Automatic OS color-scheme synchronization
 * - Accessible keyboard & screen-reader controls
 */

import { Icons } from './icons.js';

export class ThemeManager {
  static STORAGE_KEY = 'styleslot_theme';
  static currentTheme = 'dark';
  static initialized = false;

  /**
   * Initializes the theme engine. Reads localStorage or detects OS preference.
   */
  static init() {
    if (this.initialized) return;

    let savedTheme = null;
    try {
      savedTheme = localStorage.getItem(this.STORAGE_KEY);
    } catch (e) {
      // Sandboxed or restricted storage fallback
    }

    if (!savedTheme) {
      const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
      savedTheme = prefersLight ? 'light' : 'dark';
    }

    this.setTheme(savedTheme, false);
    this.initialized = true;

    // Listen to OS system preference changes (if user hasn't explicitly set a preference)
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', (e) => {
        try {
          const manualSetting = localStorage.getItem(this.STORAGE_KEY);
          if (!manualSetting) {
            this.setTheme(e.matches ? 'light' : 'dark', false);
          }
        } catch (err) { }
      });
    }
  }

  /**
   * Get current theme ('light' | 'dark')
   */
  static getTheme() {
    return document.documentElement.getAttribute('data-theme') || this.currentTheme || 'dark';
  }

  /**
   * Set theme programmatically
   */
  static setTheme(theme, persist = true) {
    const validTheme = theme === 'light' ? 'light' : 'dark';
    this.currentTheme = validTheme;

    document.documentElement.setAttribute('data-theme', validTheme);

    // Update PWA / browser address bar color
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', validTheme === 'light' ? '#F1F5F3' : '#0F1412');
    }

    if (persist) {
      try {
        localStorage.setItem(this.STORAGE_KEY, validTheme);
      } catch (e) { }
    }

    // Update all theme toggle buttons across the DOM
    this.syncAllToggleButtons();

    // Dispatch global custom event for any components that need reactive awareness
    window.dispatchEvent(new CustomEvent('styleslot:theme-changed', {
      detail: { theme: validTheme }
    }));
  }

  /**
   * Toggle between dark and light themes
   */
  static toggle() {
    const newTheme = this.getTheme() === 'light' ? 'dark' : 'light';
    this.setTheme(newTheme, true);
    return newTheme;
  }

  /**
   * Renders the HTML markup for the theme toggle button.
   */
  static renderToggle({ id = 'btn-theme-toggle', extraClass = '', showLabel = false } = {}) {
    const isLight = this.getTheme() === 'light';
    const title = isLight ? 'Switch to Dark Mode' : 'Switch to Light Mode';
    const icon = isLight ? Icons.moon({ size: 16, color: '#065F46' }) : Icons.sun({ size: 16, color: '#fbbf24' });

    return `
      <button 
        type="button"
        id="${id}" 
        class="btn btn-secondary btn-sm theme-toggle-btn ${extraClass}" 
        title="${title}"
        aria-label="${title}"
        data-theme-toggle="true"
        style="display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 10px; cursor: pointer; transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);"
      >
        <span class="theme-toggle-icon" style="display: flex; align-items: center;">${icon}</span>
        ${showLabel ? `<span class="theme-toggle-label" style="font-size: 0.8rem; font-weight: 600;">${isLight ? 'Dark' : 'Light'}</span>` : ''}
      </button>
    `;
  }

  /**
   * Binds click listener and auto-syncs state for a toggle element or selector.
   */
  static bindToggle(elementOrSelector) {
    const el = typeof elementOrSelector === 'string'
      ? document.querySelector(elementOrSelector)
      : elementOrSelector;

    if (!el || el.dataset.themeBound) return;

    el.dataset.themeBound = 'true';
    el.addEventListener('click', (e) => {
      e.preventDefault();
      this.toggle();
    });

    this.updateButtonVisuals(el);
  }

  /**
   * Synchronizes all toggle buttons currently rendered in the DOM
   */
  static syncAllToggleButtons() {
    document.querySelectorAll('[data-theme-toggle="true"]').forEach((btn) => {
      this.updateButtonVisuals(btn);
    });
  }

  /**
   * Updates an individual button's icon and label according to the active theme.
   */
  static updateButtonVisuals(btn) {
    if (!btn) return;
    const isLight = this.getTheme() === 'light';
    const title = isLight ? 'Switch to Dark Mode' : 'Switch to Light Mode';
    btn.setAttribute('title', title);
    btn.setAttribute('aria-label', title);

    const iconEl = btn.querySelector('.theme-toggle-icon');
    if (iconEl) {
      iconEl.innerHTML = isLight
        ? Icons.moon({ size: 16, color: '#065F46' })
        : Icons.sun({ size: 16, color: '#fbbf24' });
    }

    const labelEl = btn.querySelector('.theme-toggle-label');
    if (labelEl) {
      labelEl.textContent = isLight ? 'Dark' : 'Light';
    }
  }
}

