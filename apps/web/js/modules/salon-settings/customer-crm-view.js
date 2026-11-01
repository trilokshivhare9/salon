import { Icons } from '../../icons.js';
import { ApiClient } from '../../api.js';
import { AppSnackbar } from '../shared/app-snackbar.js';
import { CalendarState } from '../calendar/calendar-state.js';
import { UniversalLoader } from '../shared/universal-loader.js';

/**
 * CustomerCrmView
 * Modular Customer CRM, Strike Management, and Profile History component.
 * Features:
 * - Reactive state management with dirty checking
 * - Save button disabled until changes occur (inspired by Working Hours)
 * - In-place loading states and AppSnackbar notifications
 * - Responsive desktop table & mobile card layouts
 */
export class CustomerCrmView {
  constructor(container, app) {
    this.container = container;
    this.app = app;
    this.customers = [];
    this.filteredCustomers = [];
    this.activeFilter = 'ALL'; // 'ALL' | 'BLOCKED' | 'WARNING' | 'CLEAN'
    this.searchQuery = '';
    this.isLoading = false;
    this.searchDebounceTimer = null;
    this.activeActionCustomerId = null;
  }

  /**
   * Factory initializer for Salon Settings CRM Subtab
   */
  static async init(container, app) {
    const view = new CustomerCrmView(container, app);
    await view.loadAndRender();
    return view;
  }

  /**
   * Global modal opener for customer profile & history
   */
  static async showCustomerHistoryModal(customerId, customerName, app) {
    const modalContainer = document.getElementById('modal-container');
    if (!modalContainer) return;

    modalContainer.innerHTML = `
      <div class="modal-backdrop show" id="customer-profile-backdrop">
        <div class="modal-content modal-content-lg" style="max-width: 680px;">
          <div class="modal-header" style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.08);">
            <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1;">
              <button class="close-btn" id="btn-back-to-customers" title="Back to Customers" style="width: 28px; height: 28px; border-radius: 6px; flex-shrink: 0; font-size: 0.85rem; display: flex; align-items: center; justify-content: center;">
                ←
              </button>
              <h3 style="font-size: 1.02rem; font-family: var(--font-heading); font-weight: 700; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #fff;">
                Customer Profile & History
              </h3>
            </div>
            <button class="close-btn" id="btn-close-modal" style="width: 28px; height: 28px; font-size: 1.1rem; flex-shrink: 0;">&times;</button>
          </div>
          <div id="cust-history-body" style="padding: 16px 0; text-align: center;">
            ${UniversalLoader.render({ title: 'Loading customer details & booking history...', minHeight: '180px', variant: 'compact' })}
          </div>
        </div>
      </div>
    `;

    const closeModal = () => (modalContainer.innerHTML = '');
    document.getElementById('btn-close-modal')?.addEventListener('click', closeModal);
    document.getElementById('btn-back-to-customers')?.addEventListener('click', closeModal);
    document.getElementById('customer-profile-backdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'customer-profile-backdrop') closeModal();
    });

    try {
      const customer = await ApiClient.getCustomerById(customerId);
      const historyBody = document.getElementById('cust-history-body');
      if (!historyBody) return;

      CustomerCrmView.renderCustomerModalContent(historyBody, customer, customerName, app);
    } catch (err) {
      const historyBody = document.getElementById('cust-history-body');
      if (historyBody) {
        historyBody.innerHTML = `
          <div style="padding: 20px; text-align: center; color: #f87171;">
            <p style="font-weight: 600; margin-bottom: 8px;">Failed to load customer profile</p>
            <p style="font-size: 0.8rem; color: #94a3b8; margin-bottom: 12px;">${err.message}</p>
            <button type="button" class="btn btn-sm btn-secondary" onclick="CustomerCrmView.showCustomerHistoryModal('${customerId}', '${customerName || ''}', window.salonDashboard)">Retry</button>
          </div>
        `;
      }
    }
  }

  /**
   * Render modal body with reactive state & dirty checking
   */
  static renderCustomerModalContent(historyBody, customer, customerName, app) {
    const appts = customer.appointments || [];
    const initialStrikes = customer.yearlyNoShowCount || 0;
    const initialIsBlocked = customer.isBookingBlocked || initialStrikes >= 3;
    const totalSpend = appts.reduce((acc, a) => acc + (Number(a.price) || 0), 0);

    // Modal In-Memory State
    const modalState = {
      customerId: customer.id,
      customerName: customer.name || customerName || 'Customer',
      originalStrikes: initialStrikes,
      originalIsBlocked: initialIsBlocked,
      selectedStrikes: initialStrikes,
      selectedIsBlocked: initialIsBlocked,
      isSaving: false,
    };

    historyBody.style.textAlign = 'left';
    historyBody.innerHTML = `
      <!-- Customer Identity & Spend Metrics -->
      <div style="background: rgba(0, 0, 0, 0.3); border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 12px; padding: 12px; margin-bottom: 14px;">
        <!-- Row 1: Avatar, Name, Phone & Live Badge -->
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px;">
          <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
            <div class="customer-avatar" style="width: 36px; height: 36px; font-size: 0.95rem; font-weight: 700; flex-shrink: 0; background: linear-gradient(135deg, #7c3aed, #4f46e5); color: #fff; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
              ${(customer.name || customerName || 'C').charAt(0).toUpperCase()}
            </div>
            <div style="min-width: 0;">
              <div style="font-size: 0.95rem; font-weight: 700; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                ${customer.name || customerName || 'Unnamed Customer'}
              </div>
              <div style="font-size: 0.74rem; color: #94a3b8; font-family: var(--font-mono, monospace); line-height: 1.2;">
                ${customer.phone || 'No phone'}
              </div>
            </div>
          </div>
          <div id="modal-header-strike-badge" style="flex-shrink: 0;">
            ${CustomerCrmView.formatStrikeBadge(modalState.selectedStrikes, modalState.selectedIsBlocked)}
          </div>
        </div>

        <!-- Row 2: 2-Column Metric Strip -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding-top: 10px; border-top: 1px solid rgba(255, 255, 255, 0.05);">
          <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 8px; padding: 7px 10px;">
            <div style="font-size: 0.65rem; color: #94a3b8; text-transform: uppercase; font-weight: 700; letter-spacing: 0.04em;">Total Bookings</div>
            <div style="font-size: 0.92rem; font-weight: 700; color: #f1f5f9; margin-top: 2px;">${appts.length} Bookings</div>
          </div>
          <div style="background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.05); border-radius: 8px; padding: 7px 10px;">
            <div style="font-size: 0.65rem; color: #94a3b8; text-transform: uppercase; font-weight: 700; letter-spacing: 0.04em;">Total Spend</div>
            <div style="font-size: 0.92rem; font-weight: 800; color: #34d399; margin-top: 2px;">₹${totalSpend.toLocaleString()}</div>
          </div>
        </div>
      </div>

      <!-- Penalty Strike & Access Control Hub with Save State ("Working Hours" Model) -->
      <div style="background: rgba(139, 61, 255, 0.05); border: 1px solid rgba(139, 61, 255, 0.22); border-radius: 12px; padding: 12px; margin-bottom: 14px;">
        <!-- Header & Staging Notice -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-size: 0.74rem; font-weight: 800; color: #a5b4fc; text-transform: uppercase; letter-spacing: 0.04em;">⚡ Strike Level:</span>
            <span id="modal-strike-ratio-text" style="font-size: 0.92rem; font-weight: 800; color: #fff;">
              ${modalState.selectedStrikes} / 3 Strikes
            </span>
          </div>
          <span id="modal-staging-hint" style="font-size: 0.70rem; color: #94a3b8;">
            Select tier to stage changes
          </span>
        </div>

        <!-- 4-Tier Interactive Strike Selector -->
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-bottom: 10px;" id="modal-tier-pills-container">
          <button type="button" class="btn btn-tier-pill" data-count="0" style="min-height: 32px; padding: 4px 6px; font-size: 0.74rem; font-weight: 700; border-radius: 8px; transition: all 0.2s ease;">
            0 Clean
          </button>
          <button type="button" class="btn btn-tier-pill" data-count="1" style="min-height: 32px; padding: 4px 6px; font-size: 0.74rem; font-weight: 700; border-radius: 8px; transition: all 0.2s ease;">
            1 Warn
          </button>
          <button type="button" class="btn btn-tier-pill" data-count="2" style="min-height: 32px; padding: 4px 6px; font-size: 0.74rem; font-weight: 700; border-radius: 8px; transition: all 0.2s ease;">
            2 Critical
          </button>
          <button type="button" class="btn btn-tier-pill" data-count="3" style="min-height: 32px; padding: 4px 6px; font-size: 0.74rem; font-weight: 700; border-radius: 8px; transition: all 0.2s ease;">
            3 Blocked
          </button>
        </div>

        <!-- Quick Staging Preset Buttons -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;">
          <button type="button" class="btn btn-sm" id="btn-stage-reset" style="min-height: 30px; font-weight: 700; font-size: 0.74rem; padding: 0 10px; border-radius: 7px; background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.3); color: #34d399; display: flex; align-items: center; justify-content: center; gap: 5px;">
            🔓 Stage Reset (0/3)
          </button>
          <button type="button" class="btn btn-sm" id="btn-stage-block" style="min-height: 30px; font-weight: 700; font-size: 0.74rem; padding: 0 10px; border-radius: 7px; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); color: #fca5a5; display: flex; align-items: center; justify-content: center; gap: 5px;">
            🔒 Stage Block (3/3)
          </button>
        </div>

        <!-- Dedicated Save Changes Bar ("Working Hours" Pattern) -->
        <div style="border-top: 1px solid rgba(255, 255, 255, 0.08); padding-top: 10px; display: flex; align-items: center; justify-content: space-between; gap: 10px;">
          <div style="font-size: 0.72rem; color: #94a3b8;" id="modal-diff-summary">
            No unsaved changes
          </div>
          <button type="button" class="btn btn-primary" id="btn-save-customer-strikes" disabled style="min-height: 34px; padding: 0 18px; font-size: 0.78rem; font-weight: 700; border-radius: 8px; border: none; cursor: not-allowed; display: inline-flex; align-items: center; justify-content: center; gap: 6px; transition: all 0.2s ease;">
            <span id="btn-save-customer-text">Save Changes</span>
          </button>
        </div>
      </div>

      <!-- Booking History Timeline -->
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
        <h4 style="font-size: 0.88rem; font-weight: 700; color: #fff; margin: 0; font-family: var(--font-heading); display: flex; align-items: center; gap: 6px;">
          <span>📜</span>
          <span>Booking History</span>
        </h4>
        <span style="font-size: 0.72rem; color: #94a3b8;">${appts.length} appointments</span>
      </div>

      ${appts.length === 0 ? `
        <div style="text-align: center; padding: 22px 14px; color: #94a3b8; background: rgba(0, 0, 0, 0.2); border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.04); font-size: 0.8rem;">
          No past appointment records found for this customer.
        </div>
      ` : `
        <div style="max-height: 240px; overflow-y: auto; overflow-x: auto; border: 1px solid rgba(255, 255, 255, 0.06); border-radius: 10px; background: rgba(0, 0, 0, 0.15);">
          <table class="cust-history-table" style="width: 100%; border-collapse: collapse; font-size: 0.76rem;">
            <thead>
              <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.08); background: rgba(255, 255, 255, 0.02); color: #94a3b8; text-transform: uppercase; font-size: 0.65rem;">
                <th style="padding: 8px 10px; text-align: left;">Date & Time</th>
                <th style="padding: 8px 10px; text-align: left;">Service</th>
                <th style="padding: 8px 10px; text-align: left;">Stylist</th>
                <th style="padding: 8px 10px; text-align: left;">Price</th>
                <th style="padding: 8px 10px; text-align: right;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${appts.map((a) => {
                const dateStr = a.startAt ? new Date(a.startAt).toLocaleDateString() : 'N/A';
                const timeStr = a.startAt ? new Date(a.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                const svcs = (a.appointmentServices || a.services || []).map((s) => s.service?.name || s.name).filter(Boolean);
                const serviceLabel = svcs.length > 0 ? svcs.join(' + ') : (a.serviceNameSnapshot || a.service?.name || 'Service');
                const statusStyles = {
                  CONFIRMED: 'background: rgba(139, 61, 255, 0.2); color: #c084fc;',
                  COMPLETED: 'background: rgba(16, 185, 129, 0.2); color: #34d399;',
                  CANCELLED: 'background: rgba(239, 68, 68, 0.2); color: #f87171;',
                  REJECTED: 'background: rgba(239, 68, 68, 0.2); color: #f87171;',
                  IN_SERVICE: 'background: rgba(168, 85, 247, 0.2); color: #d8b4fe;',
                  SEATED_IN_CHAIR: 'background: rgba(168, 85, 247, 0.2); color: #d8b4fe;',
                };
                const badgeStyle = statusStyles[a.status] || 'background: rgba(255, 255, 255, 0.08); color: #cbd5e1;';
                return `
                  <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.04);">
                    <td style="padding: 8px 10px;">
                      <div style="font-weight: 700; color: #fff;">${dateStr}</div>
                      <div style="font-size: 0.70rem; color: #94a3b8;">${timeStr}</div>
                    </td>
                    <td style="padding: 8px 10px; font-weight: 600; color: #c7d2fe;">${serviceLabel}</td>
                    <td style="padding: 8px 10px; color: #94a3b8;">${a.stylist?.name || 'Any Staff'}</td>
                    <td style="padding: 8px 10px; font-weight: 700; color: #34d399;">₹${a.price || 0}</td>
                    <td style="padding: 8px 10px; text-align: right;">
                      <span class="badge" style="${badgeStyle} font-weight: 700; font-size: 0.68rem; padding: 2px 7px; border-radius: 5px;">${a.status}</span>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `}
    `;

    // Tier Button Styles & Active State Synchronizer
    const updateModalUI = () => {
      const isDirty = modalState.selectedStrikes !== modalState.originalStrikes ||
                      modalState.selectedIsBlocked !== modalState.originalIsBlocked;

      // Update Header Strike Ratio
      const ratioEl = historyBody.querySelector('#modal-strike-ratio-text');
      if (ratioEl) {
        ratioEl.textContent = `${modalState.selectedStrikes} / 3 Strikes`;
      }

      // Update Staging Hint & Diff Summary
      const hintEl = historyBody.querySelector('#modal-staging-hint');
      const diffEl = historyBody.querySelector('#modal-diff-summary');
      if (isDirty) {
        if (hintEl) hintEl.innerHTML = `<span style="color: #fbbf24; font-weight: 700;">Unsaved change</span>`;
        if (diffEl) diffEl.innerHTML = `From <strong>${modalState.originalStrikes}/3</strong> → <strong style="color: #a78bfa;">${modalState.selectedStrikes}/3</strong> (${modalState.selectedStrikes >= 3 ? 'Blocked' : 'Restored'})`;
      } else {
        if (hintEl) hintEl.textContent = 'Select tier to stage changes';
        if (diffEl) diffEl.textContent = 'No unsaved changes';
      }

      // Update Tier Pills
      const tierStyles = [
        { count: 0, color: '#34d399', bgActive: 'rgba(16, 185, 129, 0.28)', borderActive: 'rgba(16, 185, 129, 0.7)' },
        { count: 1, color: '#fbbf24', bgActive: 'rgba(245, 158, 11, 0.28)', borderActive: 'rgba(245, 158, 11, 0.7)' },
        { count: 2, color: '#fb923c', bgActive: 'rgba(249, 115, 22, 0.28)', borderActive: 'rgba(249, 115, 22, 0.7)' },
        { count: 3, color: '#f87171', bgActive: 'rgba(239, 68, 68, 0.28)', borderActive: 'rgba(239, 68, 68, 0.7)' },
      ];

      historyBody.querySelectorAll('.btn-tier-pill').forEach((btn) => {
        const c = parseInt(btn.getAttribute('data-count'), 10);
        const isActive = modalState.selectedStrikes === c;
        const cfg = tierStyles[c] || tierStyles[0];

        if (isActive) {
          btn.style.background = cfg.bgActive;
          btn.style.borderColor = cfg.borderActive;
          btn.style.color = cfg.color;
          btn.style.boxShadow = `0 0 10px ${cfg.bgActive}`;
        } else {
          btn.style.background = 'rgba(255, 255, 255, 0.03)';
          btn.style.borderColor = 'rgba(255, 255, 255, 0.08)';
          btn.style.color = '#94a3b8';
          btn.style.boxShadow = 'none';
        }
      });

      // Update Save Button State
      const saveBtn = historyBody.querySelector('#btn-save-customer-strikes');
      const saveBtnText = historyBody.querySelector('#btn-save-customer-text');

      if (saveBtn) {
        if (modalState.isSaving) {
          saveBtn.disabled = true;
          saveBtn.style.opacity = '0.7';
          saveBtn.style.cursor = 'wait';
          saveBtn.style.background = 'linear-gradient(135deg, #7c3aed, #6366f1)';
          saveBtn.style.boxShadow = 'none';
          if (saveBtnText) saveBtnText.textContent = 'Saving...';
        } else if (isDirty) {
          saveBtn.disabled = false;
          saveBtn.style.opacity = '1';
          saveBtn.style.cursor = 'pointer';
          saveBtn.style.background = 'linear-gradient(135deg, #7c3aed, #6366f1)';
          saveBtn.style.boxShadow = '0 2px 12px rgba(124, 58, 237, 0.4)';
          if (saveBtnText) saveBtnText.textContent = `Save Changes (${modalState.selectedStrikes}/3)`;
        } else {
          saveBtn.disabled = true;
          saveBtn.style.opacity = '0.45';
          saveBtn.style.cursor = 'not-allowed';
          saveBtn.style.background = 'rgba(255, 255, 255, 0.06)';
          saveBtn.style.boxShadow = 'none';
          if (saveBtnText) saveBtnText.textContent = 'Saved';
        }
      }
    };

    // Attach Tier Selection Handlers
    historyBody.querySelectorAll('.btn-tier-pill').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        if (modalState.isSaving) return;
        const count = parseInt(e.currentTarget.getAttribute('data-count'), 10);
        modalState.selectedStrikes = count;
        modalState.selectedIsBlocked = count >= 3;
        updateModalUI();
      });
    });

    // Quick Action Handlers (Stage 0 or Stage 3)
    historyBody.querySelector('#btn-stage-reset')?.addEventListener('click', () => {
      if (modalState.isSaving) return;
      modalState.selectedStrikes = 0;
      modalState.selectedIsBlocked = false;
      updateModalUI();
    });

    historyBody.querySelector('#btn-stage-block')?.addEventListener('click', () => {
      if (modalState.isSaving) return;
      modalState.selectedStrikes = 3;
      modalState.selectedIsBlocked = true;
      updateModalUI();
    });

    // Save Changes Handler
    historyBody.querySelector('#btn-save-customer-strikes')?.addEventListener('click', async (e) => {
      e.preventDefault();
      const isDirty = modalState.selectedStrikes !== modalState.originalStrikes ||
                      modalState.selectedIsBlocked !== modalState.originalIsBlocked;
      if (!isDirty || modalState.isSaving) return;

      modalState.isSaving = true;
      updateModalUI();

      try {
        if (modalState.selectedStrikes === 0) {
          await ApiClient.unblockCustomer(modalState.customerId);
        } else {
          await ApiClient.updateCustomerStrikes(
            modalState.customerId,
            modalState.selectedStrikes,
            modalState.selectedIsBlocked
          );
        }

        // Commit Baseline
        modalState.originalStrikes = modalState.selectedStrikes;
        modalState.originalIsBlocked = modalState.selectedIsBlocked;
        modalState.isSaving = false;

        // Feedback
        AppSnackbar.success(`⚡ Penalty strikes saved to ${modalState.selectedStrikes}/3 for ${modalState.customerName}!`);

        // Synchronize Modal Header Badge smoothly
        const badgeEl = historyBody.querySelector('#modal-header-strike-badge');
        if (badgeEl) {
          badgeEl.innerHTML = CustomerCrmView.formatStrikeBadge(modalState.originalStrikes, modalState.originalIsBlocked);
        }

        updateModalUI();

        // Refresh Background Table if CRM View is mounted
        if (app && typeof app.loadCustomersTable === 'function') {
          app.loadCustomersTable();
        }
      } catch (err) {
        modalState.isSaving = false;
        updateModalUI();
        AppSnackbar.error(`Failed to save strikes: ${err.message}`);
      }
    });

    // Initial UI render
    updateModalUI();
  }

  /**
   * Helper: Strike badge HTML
   */
  static formatStrikeBadge(strikes, isBlocked) {
    if (isBlocked || strikes >= 3) {
      return `<span class="strike-badge strike-blocked" style="background: rgba(239, 68, 68, 0.18); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5; font-size: 0.70rem; font-weight: 800; padding: 2px 7px; border-radius: 6px;">🔴 3/3 Blocked</span>`;
    }
    if (strikes === 2) {
      return `<span class="strike-badge strike-2" style="background: rgba(249, 115, 22, 0.18); border: 1px solid rgba(249, 115, 22, 0.4); color: #fdba74; font-size: 0.70rem; font-weight: 800; padding: 2px 7px; border-radius: 6px;">⚠️ 2/3 Strikes</span>`;
    }
    if (strikes === 1) {
      return `<span class="strike-badge strike-1" style="background: rgba(245, 158, 11, 0.18); border: 1px solid rgba(245, 158, 11, 0.4); color: #fde68a; font-size: 0.70rem; font-weight: 800; padding: 2px 7px; border-radius: 6px;">⚡ 1/3 Strike</span>`;
    }
    return `<span class="strike-badge strike-0" style="background: rgba(16, 185, 129, 0.18); border: 1px solid rgba(16, 185, 129, 0.4); color: #6ee7b7; font-size: 0.70rem; font-weight: 800; padding: 2px 7px; border-radius: 6px;">✓ 0/3 Clean</span>`;
  }

  /**
   * Main Directory View: Load & Render
   */
  async loadAndRender() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="settings-panel-card">
        <div class="settings-panel-header cust-panel-header">
          <div class="settings-header-left">
            <div class="settings-header-icon" style="background: rgba(139, 61, 255, 0.15); color: #A855F7;">
              ${Icons.users({ size: 20 })}
            </div>
            <div>
              <h3 class="settings-panel-title">Store Users & Customer CRM</h3>
              <p class="settings-panel-subtitle">Manage customer directory, track penalty strikes (0–3), restrict no-show abusers, and review visit history.</p>
            </div>
          </div>
          <div class="cust-search-wrap">
            <input type="text" class="form-control" id="crm-search-input" placeholder="Search customer by name or phone..." value="${this.searchQuery}" />
          </div>
        </div>

        <div class="settings-panel-body" style="gap: 8px;">
          <!-- Filter Segmented Control -->
          <div id="customer-strike-filters">
            <button class="cust-filter-btn ${this.activeFilter === 'ALL' ? 'active' : ''}" data-filter="ALL">
              <span class="cust-filter-text">All</span>
              <span class="cust-filter-count" id="count-all">0</span>
            </button>
            <button class="cust-filter-btn ${this.activeFilter === 'BLOCKED' ? 'active' : ''}" data-filter="BLOCKED">
              <span class="cust-filter-text">Blocked</span>
              <span class="cust-filter-count" id="count-blocked">0</span>
            </button>
            <button class="cust-filter-btn ${this.activeFilter === 'WARNING' ? 'active' : ''}" data-filter="WARNING">
              <span class="cust-filter-text">Warn</span>
              <span class="cust-filter-count" id="count-warning">0</span>
            </button>
            <button class="cust-filter-btn ${this.activeFilter === 'CLEAN' ? 'active' : ''}" data-filter="CLEAN">
              <span class="cust-filter-text">Clean</span>
              <span class="cust-filter-count" id="count-clean">0</span>
            </button>
          </div>

          <div id="crm-table-container">
            ${UniversalLoader.render({ title: 'Loading customer records...', minHeight: '160px', variant: 'compact' })}
          </div>
        </div>
      </div>
    `;

    this.attachHeaderListeners();
    await this.fetchCustomers();
  }

  attachHeaderListeners() {
    const searchInput = this.container.querySelector('#crm-search-input');
    if (searchInput) {
      searchInput.oninput = (e) => {
        clearTimeout(this.searchDebounceTimer);
        const val = e.target.value.trim();
        this.searchQuery = val;
        this.searchDebounceTimer = setTimeout(() => {
          this.applyFilterAndRender();
        }, 200);
      };
    }

    this.container.querySelectorAll('#customer-strike-filters .cust-filter-btn').forEach((btn) => {
      btn.onclick = () => {
        const filter = btn.getAttribute('data-filter') || 'ALL';
        this.activeFilter = filter;
        this.container.querySelectorAll('#customer-strike-filters .cust-filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.applyFilterAndRender();
      };
    });
  }

  async fetchCustomers() {
    this.isLoading = true;
    try {
      const res = await ApiClient.getCustomers();
      this.customers = Array.isArray(res) ? res : res.data || [];
      this.isLoading = false;
      this.applyFilterAndRender();
    } catch (err) {
      this.isLoading = false;
      const tableContainer = this.container.querySelector('#crm-table-container');
      if (tableContainer) {
        tableContainer.innerHTML = `<div style="color: #f87171; padding: 24px; text-align: center;">Error loading customer list: ${err.message}</div>`;
      }
    }
  }

  applyFilterAndRender() {
    const tableContainer = this.container.querySelector('#crm-table-container');
    if (!tableContainer) return;

    // Filter counts
    const totalCount = this.customers.length;
    const blockedCount = this.customers.filter((c) => c.isBookingBlocked || (c.yearlyNoShowCount || 0) >= 3).length;
    const warningCount = this.customers.filter((c) => !c.isBookingBlocked && (c.yearlyNoShowCount || 0) > 0 && (c.yearlyNoShowCount || 0) < 3).length;
    const cleanCount = this.customers.filter((c) => !c.isBookingBlocked && (c.yearlyNoShowCount || 0) === 0).length;

    const countAll = this.container.querySelector('#count-all');
    const countBlocked = this.container.querySelector('#count-blocked');
    const countWarning = this.container.querySelector('#count-warning');
    const countClean = this.container.querySelector('#count-clean');

    if (countAll) countAll.textContent = totalCount;
    if (countBlocked) countBlocked.textContent = blockedCount;
    if (countWarning) countWarning.textContent = warningCount;
    if (countClean) countClean.textContent = cleanCount;

    // Filter by query and category
    let list = [...this.customers];
    if (this.searchQuery) {
      const q = this.searchQuery.toLowerCase();
      list = list.filter((c) => (c.name || '').toLowerCase().includes(q) || (c.phone || '').includes(q));
    }

    if (this.activeFilter === 'BLOCKED') {
      list = list.filter((c) => c.isBookingBlocked || (c.yearlyNoShowCount || 0) >= 3);
    } else if (this.activeFilter === 'WARNING') {
      list = list.filter((c) => !c.isBookingBlocked && (c.yearlyNoShowCount || 0) > 0 && (c.yearlyNoShowCount || 0) < 3);
    } else if (this.activeFilter === 'CLEAN') {
      list = list.filter((c) => !c.isBookingBlocked && (c.yearlyNoShowCount || 0) === 0);
    }

    // Sort by Strike Severity
    list.sort((a, b) => {
      const scoreA = (a.isBookingBlocked || (a.yearlyNoShowCount || 0) >= 3) ? 99 : (a.yearlyNoShowCount || 0);
      const scoreB = (b.isBookingBlocked || (b.yearlyNoShowCount || 0) >= 3) ? 99 : (b.yearlyNoShowCount || 0);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return (a.name || '').localeCompare(b.name || '');
    });

    this.filteredCustomers = list;

    if (list.length === 0) {
      tableContainer.innerHTML = `
        <div style="text-align: center; padding: 40px 14px; color: #94a3b8; font-size: 0.85rem;">
          No customer records found matching the filter criteria.
        </div>
      `;
      return;
    }

    tableContainer.innerHTML = `
      <!-- Desktop Table (≥ 768px) -->
      <div class="desktop-only" style="overflow-x: auto; width: 100%;">
        <table class="cust-table" style="width: 100%;">
          <thead>
            <tr>
              <th style="min-width: 170px;">Customer & Contact</th>
              <th style="min-width: 95px;">Strikes</th>
              <th style="min-width: 70px;">Visits</th>
              <th style="min-width: 70px;">Spend</th>
              <th style="min-width: 85px;">Last Visit</th>
              <th style="text-align: right; min-width: 130px;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${list.map((c) => this.renderTableRow(c)).join('')}
          </tbody>
        </table>
      </div>

      <!-- Mobile Card Grid (< 768px) -->
      <div class="mobile-only customer-cards-grid">
        ${list.map((c) => this.renderMobileCard(c)).join('')}
      </div>
    `;

    this.attachTableListeners();
  }

  renderTableRow(c) {
    const isBlocked = c.isBookingBlocked || (c.yearlyNoShowCount || 0) >= 3;
    const hasStrikes = (c.yearlyNoShowCount || 0) > 0 || isBlocked;
    const isActionLoading = this.activeActionCustomerId === c.id;

    return `
      <tr class="clickable-customer-row" data-id="${c.id}" data-name="${c.name}">
        <td>
          <div style="display: flex; align-items: center; gap: 8px;">
            <div class="customer-avatar">${(c.name || 'C').charAt(0).toUpperCase()}</div>
            <div style="min-width: 0;">
              <div style="font-weight: 700; color: #f8fafc; font-size: 0.84rem; line-height: 1.25; white-space: nowrap;">${c.name || 'Customer'}</div>
              <div style="font-size: 0.72rem; color: #94a3b8; font-family: var(--font-mono, monospace); line-height: 1.2; white-space: nowrap;">${c.phone || 'No phone'}</div>
            </div>
          </div>
        </td>
        <td class="cell-strike-badge">${CustomerCrmView.formatStrikeBadge(c.yearlyNoShowCount || 0, c.isBookingBlocked)}</td>
        <td><span class="cust-visit-pill">${c.totalVisits || 0} visits</span></td>
        <td style="font-weight: 700; color: #34d399; font-size: 0.84rem;">₹${Number(c.totalSpend || 0).toLocaleString()}</td>
        <td style="color: #94a3b8; font-size: 0.76rem;">${c.lastVisitAt ? new Date(c.lastVisitAt).toLocaleDateString() : 'New'}</td>
        <td style="text-align: right;">
          <div style="display: flex; gap: 5px; justify-content: flex-end; align-items: center; white-space: nowrap;">
            <button type="button" class="btn btn-secondary btn-xs btn-view-customer-history" data-id="${c.id}" data-name="${c.name}" title="View client visit history">
              ${typeof Icons.history === 'function' ? Icons.history({ size: 12 }) : '🕒'}
              <span>History</span>
            </button>
            ${hasStrikes ? `
              <button type="button" class="btn btn-success btn-xs btn-quick-reset" data-id="${c.id}" data-name="${c.name}" ${isActionLoading ? 'disabled' : ''} title="Reset strikes to 0">
                ${isActionLoading ? '⏳' : (typeof Icons.unlock === 'function' ? Icons.unlock({ size: 12 }) : '🔓')}
                <span>${isActionLoading ? 'Saving...' : 'Unblock'}</span>
              </button>
            ` : `
              <button type="button" class="btn btn-outline-danger btn-xs btn-quick-block" data-id="${c.id}" data-name="${c.name}" ${isActionLoading ? 'disabled' : ''} title="Block customer">
                ${isActionLoading ? '⏳' : (typeof Icons.lock === 'function' ? Icons.lock({ size: 12 }) : '🔒')}
                <span>${isActionLoading ? 'Saving...' : 'Block'}</span>
              </button>
            `}
          </div>
        </td>
      </tr>
    `;
  }

  renderMobileCard(c) {
    const isBlocked = c.isBookingBlocked || (c.yearlyNoShowCount || 0) >= 3;
    const hasStrikes = (c.yearlyNoShowCount || 0) > 0 || isBlocked;
    const isActionLoading = this.activeActionCustomerId === c.id;

    return `
      <div class="customer-card clickable-customer-card" data-id="${c.id}" data-name="${c.name}">
        <div class="customer-card-row-top">
          <div style="display: flex; align-items: center; gap: 10px; min-width: 0; flex: 1;">
            <div class="customer-avatar">${(c.name || 'C').charAt(0).toUpperCase()}</div>
            <div style="min-width: 0; flex: 1;">
              <div style="font-weight: 700; color: #f8fafc; font-size: 0.86rem; line-height: 1.25; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${c.name || 'Customer'}</div>
              <div style="font-size: 0.73rem; color: #94a3b8; font-family: var(--font-mono, monospace); line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1px;">${c.phone || 'No phone'}</div>
            </div>
          </div>
          <div style="flex-shrink: 0;" class="cell-strike-badge">${CustomerCrmView.formatStrikeBadge(c.yearlyNoShowCount || 0, c.isBookingBlocked)}</div>
        </div>

        <div class="customer-card-row-bottom">
          <div class="customer-card-meta">
            <span class="card-meta-pill">${c.totalVisits || 0} visits</span>
            <span class="card-meta-dot">·</span>
            <span class="card-meta-spend">₹${Number(c.totalSpend || 0).toLocaleString()}</span>
            <span class="card-meta-dot">·</span>
            <span class="card-meta-sub">${c.lastVisitAt ? new Date(c.lastVisitAt).toLocaleDateString() : 'New'}</span>
          </div>

          <div style="display: flex; gap: 6px; flex-shrink: 0;">
            <button type="button" class="btn btn-secondary btn-micro btn-view-customer-history" data-id="${c.id}" data-name="${c.name}" title="View client visit history">
              ${typeof Icons.history === 'function' ? Icons.history({ size: 12 }) : '🕒'}
              <span>History</span>
            </button>
            ${hasStrikes ? `
              <button type="button" class="btn btn-success btn-micro btn-quick-reset" data-id="${c.id}" data-name="${c.name}" ${isActionLoading ? 'disabled' : ''} title="Reset strikes to 0">
                ${isActionLoading ? '⏳' : (typeof Icons.unlock === 'function' ? Icons.unlock({ size: 12 }) : '🔓')}
                <span>${isActionLoading ? 'Saving...' : 'Unblock'}</span>
              </button>
            ` : `
              <button type="button" class="btn btn-outline-danger btn-micro btn-quick-block" data-id="${c.id}" data-name="${c.name}" ${isActionLoading ? 'disabled' : ''} title="Block customer">
                ${isActionLoading ? '⏳' : (typeof Icons.lock === 'function' ? Icons.lock({ size: 12 }) : '🔒')}
                <span>${isActionLoading ? 'Saving...' : 'Block'}</span>
              </button>
            `}
          </div>
        </div>
      </div>
    `;
  }

  attachTableListeners() {
    const tableContainer = this.container.querySelector('#crm-table-container');
    if (!tableContainer) return;

    // Click card / row to open customer profile modal
    tableContainer.querySelectorAll('.clickable-customer-row, .clickable-customer-card').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const id = el.getAttribute('data-id');
        const name = el.getAttribute('data-name');
        if (id) {
          CustomerCrmView.showCustomerHistoryModal(id, name, this.app);
        }
      });
    });

    // History button handler
    tableContainer.querySelectorAll('.btn-view-customer-history').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name');
        CustomerCrmView.showCustomerHistoryModal(id, name, this.app);
      });
    });

    // In-place Quick Reset / Unblock button handler
    tableContainer.querySelectorAll('.btn-quick-reset').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name') || 'Customer';

        const ok = await CalendarState.confirm({
          title: 'Unblock Customer',
          message: `Reset strikes to 0 and restore booking access for ${name}?`,
          confirmText: 'Unblock Customer',
          cancelText: 'Cancel',
          icon: '🎉',
          type: 'warning',
        });
        if (!ok) return;

        this.activeActionCustomerId = id;
        btn.disabled = true;
        btn.innerHTML = `<span>Saving...</span>`;

        try {
          await ApiClient.unblockCustomer(id);
          AppSnackbar.success(`🎉 ${name} unblocked & strikes reset to 0!`);

          // Update in-memory record optimistically
          const c = this.customers.find((item) => item.id === id);
          if (c) {
            c.yearlyNoShowCount = 0;
            c.isBookingBlocked = false;
          }
          this.activeActionCustomerId = null;
          this.applyFilterAndRender();
        } catch (err) {
          this.activeActionCustomerId = null;
          AppSnackbar.error(`Error unblocking customer: ${err.message}`);
          this.applyFilterAndRender();
        }
      });
    });

    // In-place Quick Block button handler
    tableContainer.querySelectorAll('.btn-quick-block').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name') || 'Customer';

        const ok = await CalendarState.confirm({
          title: 'Block Customer',
          message: `Are you sure you want to block ${name} from booking new appointment slots?`,
          confirmText: 'Block Customer',
          cancelText: 'Cancel',
          icon: '🔒',
          type: 'danger',
        });
        if (!ok) return;

        this.activeActionCustomerId = id;
        btn.disabled = true;
        btn.innerHTML = `<span>Saving...</span>`;

        try {
          await ApiClient.updateCustomerStrikes(id, 3, true);
          AppSnackbar.warning(`🔒 ${name} has been blocked (3/3 strikes).`);

          // Update in-memory record optimistically
          const c = this.customers.find((item) => item.id === id);
          if (c) {
            c.yearlyNoShowCount = 3;
            c.isBookingBlocked = true;
          }
          this.activeActionCustomerId = null;
          this.applyFilterAndRender();
        } catch (err) {
          this.activeActionCustomerId = null;
          AppSnackbar.error(`Error blocking customer: ${err.message}`);
          this.applyFilterAndRender();
        }
      });
    });
  }
}
