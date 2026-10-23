import { Icons } from '../../icons.js';
import { ApiClient } from '../../api.js';

/**
 * BookingQrView
 * Dedicated, modular component for Reception Walk-In QR Badge, WhatsApp Chat Link,
 * Storefront Identity, and A5 Acrylic Standee Printing.
 * Styled with the clean, compact, mobile-friendly design language of the Working Hours section.
 */
export class BookingQrView {
  constructor(container, app) {
    this.container = container;
    this.app = app;
    this.profile = null;
    this.servicesCount = 0;
    this.staffCount = 0;
    this.currentTab = 'qr'; // 'qr' or 'storefront'
  }

  /**
   * Factory initializer
   */
  static async init(container, app) {
    const view = new BookingQrView(container, app);
    await view.loadAndRender();
    return view;
  }

  static async showQuickQrModal(app) {
    const view = new BookingQrView(null, app);
    await view.loadAndRender();
    view.showQuickQrModal();
    return view;
  }

  static async showStandeeModal(app) {
    const view = new BookingQrView(null, app);
    await view.loadAndRender();
    view.showStandeeModal();
    return view;
  }

  async loadAndRender() {
    this.profile = this.app?.salonProfile || {};
    this.servicesCount = (this.app?.servicesList || []).length;
    this.staffCount = (this.app?.staffList || []).length;

    // Refresh profile in background if needed
    if (!this.profile.name || !this.profile.phone) {
      try {
        const fullProfile = await ApiClient.getPersonalProfile(true);
        if (fullProfile?.salon) {
          this.profile = { ...this.profile, ...fullProfile.salon };
        }
      } catch (e) {
        console.warn('[BookingQrView] Profile load fallback:', e);
      }
    }

    this.render();
    this.bindEvents();
  }

  getCleanLocation() {
    const raw = this.profile?.address || this.profile?.city || '';
    if (!raw) return 'Location not specified';
    const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
    return parts.length > 0 ? [...new Set(parts)].join(', ') : 'Location not specified';
  }

  getFormattedPhone() {
    const raw = this.profile?.phone || this.app?.currentUser?.phone || '';
    let digits = raw.replace(/[^\d]/g, '');
    if (digits.length === 10) digits = '91' + digits;
    return digits;
  }

  render() {
    if (!this.container) return;

    const profile = this.profile || {};
    const salonName = profile.name || 'Salon Command';
    const slug = profile.slug || 'salon';
    const salonPhone = this.getFormattedPhone();
    const hasValidPhone = Boolean(salonPhone && salonPhone.length >= 10);

    const bookingUrl = `${window.location.origin}/#book/${slug}`;
    const whatsappUrl = hasValidPhone ? `https://wa.me/${salonPhone}?text=Hi` : bookingUrl;
    const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(whatsappUrl)}`;
    const whatsappShareUrl = hasValidPhone
      ? `https://api.whatsapp.com/send?text=${encodeURIComponent(`Book your appointment with ${salonName} on WhatsApp: ${whatsappUrl}`)}`
      : `https://api.whatsapp.com/send?text=${encodeURIComponent(`Book your appointment with ${salonName} online: ${bookingUrl}`)}`;

    const cleanLocation = this.getCleanLocation();
    const todayClosure = typeof this.app?.getTodayClosure === 'function' ? this.app.getTodayClosure() : null;
    const isClosedToday = !!todayClosure;

    this.container.innerHTML = `
      <div class="stylist-routine-card" id="booking-qr-main-card">
        <!-- Top Navigation Row: [ Segmented Tabs | Status Badge ] -->
        <div class="stylist-schedule-top-row" style="margin-bottom: 10px;">
          <div class="stylist-schedule-segmented-tabs" id="booking-qr-tabs" style="max-width: 360px; width: 100%;">
            <button type="button" class="schedule-tab-btn ${this.currentTab === 'qr' ? 'active' : ''}" data-tab="qr" id="tab-btn-booking-qr">
              <span>📱 WhatsApp QR</span>
            </button>
            <button type="button" class="schedule-tab-btn ${this.currentTab === 'storefront' ? 'active' : ''}" data-tab="storefront" id="tab-btn-booking-storefront">
              <span>🏢 Storefront Identity</span>
            </button>
          </div>
          <div class="stylist-autosave-badge" style="color: ${isClosedToday ? '#f87171' : '#34d399'};">
            <span class="autosave-dot ${isClosedToday ? 'error' : ''}"></span>
            <span>${isClosedToday ? `Closed (${todayClosure.closureType})` : 'Live & Accepting'}</span>
          </div>
        </div>

        <!-- TAB 1: WhatsApp QR Badge & Actions View -->
        <div id="booking-qr-tab-content-qr" style="display: ${this.currentTab === 'qr' ? 'block' : 'none'};">
          <div class="stylist-bulk-setter-card" style="background: linear-gradient(135deg, rgba(37, 211, 102, 0.08), rgba(15, 23, 42, 0.5)); border: 1px solid rgba(37, 211, 102, 0.25); border-radius: 12px; padding: 14px; box-sizing: border-box; width: 100%;">
            <!-- Header Row -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); flex-wrap: wrap; gap: 6px;">
              <div style="display: flex; align-items: center; gap: 6px; color: #25D366; font-size: 0.76rem; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase;">
                ${Icons.whatsapp ? Icons.whatsapp({ size: 15 }) : '💬'}
                <span>Reception Counter Walk-In QR Badge</span>
              </div>
              <span style="font-size: 0.68rem; color: #34d399; background: rgba(52, 211, 153, 0.12); border: 1px solid rgba(52, 211, 153, 0.28); padding: 2px 8px; border-radius: 999px; font-weight: 700;">
                ⚡ Instant Chair Queue
              </span>
            </div>

            <!-- QR Box (Centered & Compact) -->
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; background: #ffffff; padding: 10px; border-radius: 12px; border: 2px solid #25D366; box-shadow: 0 4px 16px rgba(37, 211, 102, 0.25); margin: 0 auto 12px auto; width: 150px; box-sizing: border-box;">
              <img src="${qrImgUrl}" alt="Customer WhatsApp Booking QR" style="width: 128px; height: 128px; display: block; border-radius: 4px;" />
              <span style="font-size: 0.60rem; font-weight: 800; color: #ffffff; background: #25D366; padding: 2px 8px; border-radius: 12px; letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap;">
                Scan with Camera
              </span>
            </div>

            <!-- Direct URL Row -->
            <div style="margin-bottom: 10px; width: 100%; box-sizing: border-box;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 4px;">
                <span style="font-size: 0.70rem; font-weight: 800; color: #25D366; letter-spacing: 0.04em; text-transform: uppercase; display: flex; align-items: center; gap: 4px;">
                  ${Icons.whatsapp ? Icons.whatsapp({ size: 12 }) : '💬'} Direct WhatsApp Link
                </span>
                <span style="font-size: 0.66rem; color: #94a3b8; font-weight: 600;">${hasValidPhone ? `+${salonPhone}` : 'No phone set'}</span>
              </div>
              <div style="display: flex; align-items: center; gap: 8px; background: rgba(0, 0, 0, 0.45); border: 1px solid rgba(37, 211, 102, 0.3); border-radius: 8px; padding: 6px 10px; width: 100%; box-sizing: border-box; overflow: hidden;">
                <span style="color: #25D366; flex-shrink: 0; display: flex; align-items: center;">${Icons.whatsapp ? Icons.whatsapp({ size: 14 }) : '💬'}</span>
                <span style="font-family: ui-monospace, monospace; font-size: 0.75rem; color: #4ade80; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; user-select: all;" title="${whatsappUrl}">
                  ${whatsappUrl}
                </span>
                <button type="button" class="btn btn-secondary btn-sm" id="btn-copy-qr-link" data-url="${whatsappUrl}" style="height: 28px; padding: 0 10px; font-size: 0.72rem; border-radius: 6px; flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px;">
                  ${Icons.copy({ size: 11 })}
                  <span>Copy</span>
                </button>
              </div>
            </div>

            <!-- Action Buttons Grid (Responsive & Aligned) -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 8px; width: 100%; box-sizing: border-box; margin-bottom: 10px;">
              <a href="${whatsappUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-primary" style="text-decoration: none; height: 36px; padding: 0 8px; font-size: 0.74rem; font-weight: 700; border-radius: 8px; background: #25D366; border-color: #25D366; color: #ffffff; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 2px 8px rgba(37, 211, 102, 0.25);">
                ${Icons.whatsapp ? Icons.whatsapp({ size: 14 }) : '💬'}
                <span>Open Chat</span>
              </a>
              <a href="${whatsappShareUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary" style="text-decoration: none; height: 36px; padding: 0 8px; font-size: 0.74rem; font-weight: 600; border-radius: 8px; color: #34d399; background: rgba(52, 211, 153, 0.1); border-color: rgba(52, 211, 153, 0.3); display: flex; align-items: center; justify-content: center; gap: 6px;">
                ${Icons.share ? Icons.share({ size: 13 }) : '📤'}
                <span>Share Link</span>
              </a>
              <button type="button" class="btn btn-primary" id="btn-print-standee" style="height: 36px; padding: 0 8px; font-size: 0.74rem; font-weight: 700; border-radius: 8px; background: linear-gradient(135deg, #8B3DFF, #6D28D9); border: none; color: #ffffff; display: flex; align-items: center; justify-content: center; gap: 6px; box-shadow: 0 2px 10px rgba(139, 61, 255, 0.35);">
                ${Icons.qrCode ? Icons.qrCode({ size: 13 }) : '🖨️'}
                <span>Print Standee</span>
              </button>
            </div>

            <!-- Reception Tip Box -->
            <div style="background: rgba(37, 211, 102, 0.05); border: 1px solid rgba(37, 211, 102, 0.18); border-radius: 8px; padding: 8px 10px; font-size: 0.70rem; color: #94a3b8; line-height: 1.45; word-break: break-word;">
              ${hasValidPhone
                ? `💡 <strong style="color: #e2e8f0;">Reception Tip:</strong> When walk-ins scan this QR code with their mobile camera, WhatsApp opens directly to <strong style="color: #4ade80;">+${salonPhone}</strong> to chat and reserve their chair in 30 seconds.`
                : `⚠️ <strong style="color: #f87171;">Phone Required:</strong> Please configure your WhatsApp number in Salon Profile so customers can connect directly.`
              }
            </div>
          </div>
        </div>

        <!-- TAB 2: Verified Storefront Identity View -->
        <div id="booking-qr-tab-content-storefront" style="display: ${this.currentTab === 'storefront' ? 'block' : 'none'};">
          <div class="stylist-roster-card">
            <div class="stylist-roster-header">
              <div class="stylist-roster-header-left">
                ${Icons.store ? Icons.store({ size: 14, color: '#34d399' }) : '🏢'}
                <span class="stylist-roster-title">Verified Store Identity</span>
              </div>
              <span class="stylist-roster-count">Public Profile</span>
            </div>

            <!-- Quick Web Link Row -->
            <div class="roster-sync-banner" id="banner-open-web-store" style="cursor: default;">
              <div class="roster-sync-banner-left">
                <span class="roster-sync-banner-icon" style="background: rgba(52, 211, 153, 0.15); border-color: rgba(52, 211, 153, 0.3); color: #34d399;">🌐</span>
                <div class="roster-sync-banner-info">
                  <span class="roster-sync-banner-title">Online Customer Booking Portal</span>
                  <span class="roster-sync-banner-sub" style="color: #94a3b8;">${bookingUrl}</span>
                </div>
              </div>
              <div style="display: flex; gap: 6px;">
                <button type="button" class="btn btn-secondary btn-sm" id="btn-copy-web-link" data-url="${bookingUrl}" style="height: 28px; padding: 0 8px; font-size: 0.70rem;">
                  ${Icons.copy({ size: 11 })}
                  <span>Copy</span>
                </button>
                <a href="${bookingUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="height: 28px; padding: 0 8px; font-size: 0.70rem; text-decoration: none; color: #a5b4fc;">
                  <span>Open ↗</span>
                </a>
              </div>
            </div>

            <!-- Identity Rows Table -->
            <div style="padding: 10px 14px; display: flex; flex-direction: column; gap: 8px;">
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 0.78rem;">
                <span style="color: #94a3b8;">Salon Brand</span>
                <span style="color: #f8fafc; font-weight: 700;">${salonName}</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 0.78rem;">
                <span style="color: #94a3b8;">Store Handle</span>
                <span style="color: #a5b4fc; font-family: ui-monospace, monospace; font-weight: 600;">@${slug}</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 0.78rem;">
                <span style="color: #94a3b8;">Location</span>
                <span style="color: #cbd5e1; max-width: 65%; text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${cleanLocation}">${cleanLocation}</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 0.78rem;">
                <span style="color: #94a3b8;">WhatsApp Phone</span>
                <span style="color: #4ade80; font-weight: 600;">${hasValidPhone ? `+${salonPhone}` : 'Not configured'}</span>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 0.78rem;">
                <span style="color: #94a3b8;">Storefront Status</span>
                <span style="color: ${isClosedToday ? '#f87171' : '#34d399'}; font-weight: 700;">
                  ${isClosedToday ? `🔴 Closed (${todayClosure.closureType})` : '🟢 Live & Accepting Appointments'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Operations Telemetry Metric Strip (High-Density & Clean) -->
        <div class="ops-telemetry-grid" style="margin-top: 10px;">
          <div class="ops-telemetry-item">
            <span class="ops-telemetry-label">Services</span>
            <span class="ops-telemetry-val">${this.servicesCount} items</span>
          </div>
          <div class="ops-telemetry-item">
            <span class="ops-telemetry-label">Stylists</span>
            <span class="ops-telemetry-val">${this.staffCount} active</span>
          </div>
          <div class="ops-telemetry-item">
            <span class="ops-telemetry-label">Queue Flow</span>
            <span class="ops-telemetry-val" style="color: #34d399;">30s Instant</span>
          </div>
          <div class="ops-telemetry-item">
            <span class="ops-telemetry-label">Standee Format</span>
            <span class="ops-telemetry-val" style="color: #a78bfa;">A5 Acrylic</span>
          </div>
        </div>
      </div>
    `;
  }

  bindEvents() {
    if (!this.container) return;

    // Segmented tab switching: QR vs Storefront
    const btnTabQr = this.container.querySelector('#tab-btn-booking-qr');
    const btnTabStore = this.container.querySelector('#tab-btn-booking-storefront');
    const contentQr = this.container.querySelector('#booking-qr-tab-content-qr');
    const contentStore = this.container.querySelector('#booking-qr-tab-content-storefront');

    if (btnTabQr && btnTabStore) {
      btnTabQr.onclick = (e) => {
        e.preventDefault();
        this.currentTab = 'qr';
        btnTabQr.classList.add('active');
        btnTabStore.classList.remove('active');
        if (contentQr) contentQr.style.display = 'block';
        if (contentStore) contentStore.style.display = 'none';
      };

      btnTabStore.onclick = (e) => {
        e.preventDefault();
        this.currentTab = 'storefront';
        btnTabStore.classList.add('active');
        btnTabQr.classList.remove('active');
        if (contentQr) contentQr.style.display = 'none';
        if (contentStore) contentStore.style.display = 'block';
      };
    }

    // Copy QR WhatsApp link button
    this.container.querySelector('#btn-copy-qr-link')?.addEventListener('click', (e) => {
      const url = e.currentTarget.getAttribute('data-url');
      if (url) {
        navigator.clipboard.writeText(url);
        if (typeof this.app?.showToast === 'function') {
          this.app.showToast('WhatsApp booking link copied!', 'success');
        } else {
          alert('Link copied to clipboard!\n' + url);
        }
      }
    });

    // Copy web booking link button
    this.container.querySelector('#btn-copy-web-link')?.addEventListener('click', (e) => {
      const url = e.currentTarget.getAttribute('data-url');
      if (url) {
        navigator.clipboard.writeText(url);
        if (typeof this.app?.showToast === 'function') {
          this.app.showToast('Online booking link copied!', 'success');
        } else {
          alert('Link copied to clipboard!\n' + url);
        }
      }
    });

    // Print standee button
    this.container.querySelector('#btn-print-standee')?.addEventListener('click', () => {
      this.showStandeeModal();
    });
  }

  showStandeeModal() {
    const modalContainer = document.getElementById('modal-container');
    if (!modalContainer) return;

    const profile = this.profile || {};
    const salonName = profile.name || 'Salon Command';
    const salonPhone = this.getFormattedPhone();
    const hasValidPhone = Boolean(salonPhone && salonPhone.length >= 10);
    const slug = profile.slug || 'salon';

    const bookingUrl = `${window.location.origin}/#book/${slug}`;
    const targetUrl = hasValidPhone ? `https://wa.me/${salonPhone}?text=Hi` : bookingUrl;
    const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=${encodeURIComponent(targetUrl)}`;
    const city = profile.city || (profile.address ? profile.address.split(',')[0].trim() : 'Indore');

    modalContainer.innerHTML = `
      <div class="modal-backdrop show" style="z-index: 99999;">
        <div class="modal-content" style="max-width: 480px; width: 94%; text-align: center; padding: 20px 16px; border-radius: 16px; margin: 16px auto; box-sizing: border-box;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
            <div style="text-align: left;">
              <h3 style="margin: 0; font-size: 1.1rem; font-weight: 800; color: #fff; display: flex; align-items: center; gap: 8px;">
                <span>🖨️ Acrylic Reception Standee</span>
              </h3>
              <p style="margin: 2px 0 0 0; font-size: 0.74rem; color: #94a3b8;">
                A5 Desk Counter Standee with live scannable WhatsApp booking QR.
              </p>
            </div>
            <button class="close-btn" id="btn-close-standee-modal" style="width: 30px; height: 30px; font-size: 1.1rem;">&times;</button>
          </div>

          <!-- Standee Realistic Visual Preview -->
          <div id="standee-print-preview" style="background: #ffffff; color: #0f172a; border-radius: 14px; padding: 20px 16px; box-shadow: 0 16px 40px rgba(0,0,0,0.5); border: 2px solid rgba(255,255,255,0.2); margin-bottom: 16px; text-align: center; box-sizing: border-box;">
            <div style="font-size: 0.68rem; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: #16a34a; margin-bottom: 4px;">
              WELCOME TO
            </div>
            <div style="font-size: 1.35rem; font-weight: 900; letter-spacing: -0.02em; color: #0f172a; margin-bottom: 4px; font-family: var(--font-heading, sans-serif);">
              ${salonName}
            </div>
            <div style="font-size: 0.76rem; color: #475569; font-weight: 600; margin-bottom: 14px;">
              Scan QR to Book on WhatsApp & Join Live Chair Queue
            </div>

            <!-- Standee QR Box -->
            <div style="display: inline-block; padding: 10px; background: #f8fafc; border-radius: 14px; border: 2px solid #22c55e; box-shadow: 0 4px 14px rgba(34,197,94,0.15); margin-bottom: 12px;">
              <img src="${qrImgUrl}" alt="WhatsApp Booking QR" style="width: 160px; height: 160px; display: block; border-radius: 6px;" />
            </div>

            <!-- Fast Steps -->
            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 12px; text-align: center;">
              <div style="background: #f1f5f9; padding: 6px 4px; border-radius: 8px;">
                <div style="font-size: 0.68rem; font-weight: 800; color: #0f172a;">1. SCAN</div>
                <div style="font-size: 0.60rem; color: #64748b;">With phone camera</div>
              </div>
              <div style="background: #f1f5f9; padding: 6px 4px; border-radius: 8px;">
                <div style="font-size: 0.68rem; font-weight: 800; color: #16a34a;">2. SEND "Hi"</div>
                <div style="font-size: 0.60rem; color: #64748b;">On WhatsApp</div>
              </div>
              <div style="background: #f1f5f9; padding: 6px 4px; border-radius: 8px;">
                <div style="font-size: 0.68rem; font-weight: 800; color: #0f172a;">3. CONFIRM</div>
                <div style="font-size: 0.60rem; color: #64748b;">Stylist & Service</div>
              </div>
            </div>

            <div style="font-family: monospace; font-size: 0.78rem; font-weight: 800; color: #16a34a; word-break: break-all;">
              ${hasValidPhone ? `💬 wa.me/${salonPhone}` : bookingUrl}
            </div>
            <div style="font-size: 0.62rem; color: #94a3b8; margin-top: 4px;">
              Powered by StyleSlot WhatsApp Automation · ${city}
            </div>
          </div>

          <!-- Standee Modal Actions -->
          <div style="display: flex; gap: 8px;">
            <button type="button" class="btn btn-secondary" id="btn-cancel-standee" style="flex: 1; height: 38px;">Close</button>
            <button type="button" class="btn btn-primary" id="btn-trigger-print-standee" style="flex: 2; height: 38px; background: linear-gradient(135deg, #16a34a 0%, #22c55e 100%); border-color: #16a34a; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 6px;">
              ${Icons.check ? Icons.check({ size: 15 }) : '🖨️'}
              <span>Print A5 Standee</span>
            </button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-close-standee-modal')?.addEventListener('click', () => (modalContainer.innerHTML = ''));
    document.getElementById('btn-cancel-standee')?.addEventListener('click', () => (modalContainer.innerHTML = ''));

    document.getElementById('btn-trigger-print-standee')?.addEventListener('click', () => {
      const printWin = window.open('', '_blank', 'width=650,height=850');
      if (!printWin) {
        alert('Popup blocked! Please allow popups for this site to print the standee.');
        return;
      }
      printWin.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Reception Standee - ${salonName.replace(/"/g, '&quot;')}</title>
          <style>
            @page {
              size: A5 portrait;
              margin: 12mm;
            }
            * { box-sizing: border-box; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              background: #ffffff;
              color: #0f172a;
              margin: 0;
              padding: 24px 20px;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              text-align: center;
              min-height: 90vh;
            }
            .standee-card {
              border: 3px solid #0f172a;
              border-radius: 20px;
              padding: 36px 28px;
              width: 100%;
              max-width: 440px;
              box-shadow: none;
            }
            .kicker {
              font-size: 11px;
              font-weight: 800;
              letter-spacing: 2px;
              text-transform: uppercase;
              color: #16a34a;
              margin-bottom: 8px;
            }
            .title {
              font-size: 26px;
              font-weight: 900;
              letter-spacing: -0.5px;
              margin-bottom: 6px;
            }
            .subtitle {
              font-size: 13px;
              color: #475569;
              font-weight: 600;
              margin-bottom: 22px;
            }
            .qr-box {
              display: inline-block;
              padding: 16px;
              border: 3px solid #22c55e;
              border-radius: 16px;
              margin-bottom: 20px;
            }
            .qr-img {
              width: 210px;
              height: 210px;
              display: block;
            }
            .steps-row {
              display: grid;
              grid-template-columns: repeat(3, 1fr);
              gap: 8px;
              margin-bottom: 18px;
            }
            .step-box {
              background: #f8fafc;
              border: 1px solid #e2e8f0;
              border-radius: 8px;
              padding: 8px 4px;
            }
            .step-num {
              font-size: 11px;
              font-weight: 800;
              color: #0f172a;
            }
            .step-desc {
              font-size: 9px;
              color: #64748b;
            }
            .url-box {
              font-family: monospace;
              font-size: 14px;
              font-weight: 800;
              color: #16a34a;
              word-break: break-all;
            }
            .footer-note {
              font-size: 10px;
              color: #94a3b8;
              margin-top: 8px;
            }
          </style>
        </head>
        <body>
          <div class="standee-card">
            <div class="kicker">WELCOME TO</div>
            <div class="title">${salonName}</div>
            <div class="subtitle">Scan to Book on WhatsApp & Join Live Chair Queue</div>
            <div class="qr-box">
              <img class="qr-img" src="${qrImgUrl}" alt="WhatsApp Booking QR" />
            </div>
            <div class="steps-row">
              <div class="step-box">
                <div class="step-num">1. SCAN</div>
                <div class="step-desc">With Phone Camera</div>
              </div>
              <div class="step-box">
                <div class="step-num" style="color: #16a34a;">2. SEND "Hi"</div>
                <div class="step-desc">On WhatsApp</div>
              </div>
              <div class="step-box">
                <div class="step-num">3. CONFIRM</div>
                <div class="step-desc">Stylist & Service</div>
              </div>
            </div>
            <div class="url-box">${hasValidPhone ? `wa.me/${salonPhone}` : bookingUrl}</div>
            <div class="footer-note">Powered by StyleSlot WhatsApp Automation · ${city}</div>
          </div>
          <script>
            window.onload = function() {
              setTimeout(function() {
                window.print();
              }, 300);
              printWin.document.close();
            };
          </script>
        </body>
        </html>
      `);
      printWin.document.close();
    });
  }

  showQuickQrModal() {
    const modalContainer = document.getElementById('modal-container');
    if (!modalContainer) return;

    const profile = this.profile || {};
    const slug = profile.slug || 'salon';
    const salonPhone = this.getFormattedPhone();
    const hasValidPhone = Boolean(salonPhone && salonPhone.length >= 10);

    const bookingUrl = `${window.location.origin}/#book/${slug}`;
    const targetUrl = hasValidPhone ? `https://wa.me/${salonPhone}?text=Hi` : bookingUrl;
    const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(targetUrl)}`;

    modalContainer.innerHTML = `
      <div class="modal-backdrop show" style="z-index: 99999;">
        <div class="modal-content" style="text-align: center; max-width: 420px; width: 94%; padding: 20px 16px; border-radius: 16px; margin: 16px auto; box-sizing: border-box;">
          <div class="modal-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
            <h3 style="display: flex; align-items: center; gap: 8px; margin: 0; font-size: 1.05rem; font-weight: 800;">
              <span style="color: #25D366;">💬</span> WhatsApp Booking QR
            </h3>
            <button class="close-btn" id="btn-close-wa-modal" style="width: 30px; height: 30px; font-size: 1.1rem;">&times;</button>
          </div>

          <p style="font-size: 0.80rem; color: #94a3b8; margin-bottom: 14px;">
            ${hasValidPhone
              ? 'Scan this QR code with any phone camera to immediately launch the automated <strong>WhatsApp Booking Chat</strong>.'
              : 'Scan this QR code to open the online customer booking portal.'
            }
          </p>

          <div style="background: #ffffff; padding: 12px; border-radius: 14px; display: inline-block; margin-bottom: 14px; box-shadow: 0 8px 30px rgba(37,211,102,0.25); border: 2px solid #25D366;">
            <img src="${qrImgUrl}" alt="Booking QR Code" style="display: block; width: 180px; height: 180px; border-radius: 4px;" />
          </div>

          <div style="background: rgba(37,211,102,0.08); padding: 8px 12px; border-radius: 8px; border: 1px solid rgba(37,211,102,0.25); margin-bottom: 16px; text-align: left; width: 100%; box-sizing: border-box; overflow: hidden;">
            <div style="font-size: 0.65rem; color: #25D366; font-weight: 800; letter-spacing: 0.04em;">${hasValidPhone ? 'DIRECT WHATSAPP CHAT LINK' : 'ONLINE BOOKING LINK'}</div>
            <div style="font-size: 0.78rem; font-family: monospace; color: #e2e8f0; word-break: break-all; margin-top: 3px;">${targetUrl}</div>
          </div>

          <div style="display: flex; gap: 8px;">
            <button class="btn btn-secondary" style="flex: 1; height: 38px;" id="btn-copy-wa-modal-link">📋 Copy Link</button>
            <a href="${targetUrl}" target="_blank" rel="noopener noreferrer" class="btn btn-primary" style="flex: 1; height: 38px; background: #25D366; border-color: #25D366; color: #ffffff; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; text-decoration: none;">
              ${hasValidPhone ? 'Open WhatsApp 💬' : 'Open Booking 🌐'}
            </a>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-close-wa-modal')?.addEventListener('click', () => (modalContainer.innerHTML = ''));

    document.getElementById('btn-copy-wa-modal-link')?.addEventListener('click', () => {
      navigator.clipboard.writeText(targetUrl);
      if (typeof this.app?.showToast === 'function') {
        this.app.showToast('Booking link copied to clipboard!', 'success');
      } else {
        alert('Link copied to clipboard!\n' + targetUrl);
      }
    });
  }
}
