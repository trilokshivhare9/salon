/**
 * HOME DASHBOARD CONTROLLER (HomeManager)
 * 
 * Orchestrates user interactions, event delegation, and callbacks:
 * - [Store QR] & [Share Link] actions
 * - Quick filter clicks on operational telemetry cards
 * - 1-Click Accept / Reject pending online requests
 * - [Check In] upcoming queue items
 * - Fast Walk-In registration and chair assignment
 * - Full queue navigation
 */

import { HomeView } from './home-view.js';

export class HomeManager {
  /**
   * @param {object} options
   * @param {Function} options.onOpenQrModal
   * @param {Function} options.onSeatWalkIn
   * @param {Function} options.onViewFullQueue
   * @param {Function} options.onOpenWalkIn
   * @param {Function} options.onUpdateStatus
   * @param {Function} options.onOpenClosures
   * @param {Function} options.onOpenServices
   * @param {Function} options.onCopyLink
   * @param {Function} options.onFilterQueue
   * @param {Function} options.onOpenQuickRequests
   */
  constructor(options = {}) {
    this.options = {
      onOpenQrModal: options.onOpenQrModal || (() => {}),
      onSeatWalkIn: options.onSeatWalkIn || (() => {}),
      onViewFullQueue: options.onViewFullQueue || (() => {}),
      onOpenWalkIn: options.onOpenWalkIn || (() => {}),
      onUpdateStatus: options.onUpdateStatus || null,
      onOpenClosures: options.onOpenClosures || (() => {}),
      onOpenServices: options.onOpenServices || (() => {}),
      onViewStaff: options.onViewStaff || (() => {}),
      onCopyLink: options.onCopyLink || (() => {}),
      onFilterQueue: options.onFilterQueue || null,
      onOpenQuickRequests: options.onOpenQuickRequests || (() => {}),
    };
  }

  /**
   * Renders the complete HTML string for the Home cockpit.
   * @param {object} state
   * @returns {string}
   */
  getHtml(state = {}) {
    return HomeView.render(state);
  }

  /**
   * Attaches interactive event handlers to the rendered container.
   * @param {HTMLElement} container
   */
  attachEventListeners(container) {
    if (!container) return;

    // 1. Store QR Buttons (Hero button & Bento launchpad tile)
    const handleOpenQr = (e) => {
      e.preventDefault();
      this.options.onOpenQrModal();
    };
    container.querySelector('#btn-home-store-qr')?.addEventListener('click', handleOpenQr);
    container.querySelector('#card-action-qr')?.addEventListener('click', handleOpenQr);

    // 2. Quick Requests Button & Card (Opens Accept/Reject Popup Modal)
    container.querySelectorAll('.btn-open-quick-modal, #btn-hero-quick-requests, #home-quick-booking-card').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        // Prevent duplicate trigger if clicked on child button
        if (btn.id === 'home-quick-booking-card' && e.target.closest('.btn-open-quick-modal')) return;
        e.preventDefault();
        if (typeof this.options.onOpenQuickRequests === 'function') {
          this.options.onOpenQuickRequests();
        }
      });
    });

    // 2. Share Booking Link Buttons (Hero button & Bento launchpad tile)
    const handleCopyLink = (e) => {
      e.preventDefault();
      this.options.onCopyLink();
    };
    container.querySelector('#btn-home-copy-link')?.addEventListener('click', handleCopyLink);
    container.querySelector('#card-action-copy')?.addEventListener('click', handleCopyLink);

    // 3. View Full Queue (Button & Bento tile)
    const handleViewQueue = (e) => {
      e.preventDefault();
      this.options.onViewFullQueue();
    };
    container.querySelector('#btn-home-view-queue')?.addEventListener('click', handleViewQueue);
    container.querySelector('#card-action-queue')?.addEventListener('click', handleViewQueue);

    // 4. Fast Walk-In Launchpad Tile & General Walk-In
    const handleOpenWalkIn = (e) => {
      e.preventDefault();
      this.options.onOpenWalkIn();
    };
    container.querySelector('#card-action-walkin')?.addEventListener('click', handleOpenWalkIn);
    container.querySelectorAll('.btn-home-open-walkin').forEach((btn) => {
      btn.addEventListener('click', handleOpenWalkIn);
    });

    // 5. Interactive Pulse Metric Cells (Filter queue on click)
    container.querySelectorAll('.home-pulse-metric-cell').forEach((cell) => {
      cell.addEventListener('click', (e) => {
        e.preventDefault();
        const filter = cell.getAttribute('data-filter') || 'ALL';
        if (typeof this.options.onFilterQueue === 'function') {
          this.options.onFilterQueue(filter);
        } else {
          this.options.onViewFullQueue();
        }
      });
    });

    // 6. Seat Walk-In for a specific available stylist
    container.querySelectorAll('.btn-home-seat-stylist').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const stylistId = btn.getAttribute('data-stylist-id');
        const stylistName = btn.getAttribute('data-stylist-name');
        this.options.onSeatWalkIn(stylistId, stylistName);
      });
    });

    // 7. Store Closed / Inactive Setup Banners
    container.querySelector('.btn-open-closures-modal')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.options.onOpenClosures();
    });

    container.querySelector('#btn-goto-services-banner')?.addEventListener('click', (e) => {
      e.preventDefault();
      this.options.onOpenServices();
    });

    // 8. Staff Summary Roster Navigation
    container.querySelectorAll('.btn-home-manage-staff, #btn-home-manage-staff').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof this.options.onViewStaff === 'function') {
          this.options.onViewStaff();
        }
      });
    });

    // 9. Services Summary Navigation
    container.querySelectorAll('.btn-home-manage-services, #btn-home-manage-services').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        if (typeof this.options.onOpenServices === 'function') {
          this.options.onOpenServices();
        }
      });
    });

    // 8. Action Status Buttons (Accept, Decline, Check In)
    if (typeof this.options.onUpdateStatus === 'function') {
      container.querySelectorAll('.btn-status').forEach((btn) => {
        btn.addEventListener('click', async (e) => {
          const target = e.currentTarget;
          if (target.disabled) return;
          target.disabled = true;
          const id = target.getAttribute('data-id');
          const status = target.getAttribute('data-status');
          if (id && status) {
            await this.options.onUpdateStatus(id, status);
          }
        });
      });
    }
  }
}
