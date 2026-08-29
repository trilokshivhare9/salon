import { ApiClient } from './api.js';

export class PlatformAdminPortal {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.data = null;
  }

  async init() {
    this.renderLoading();
    try {
      this.data = await ApiClient.request('/salons/platform/all');
      this.render();
    } catch (err) {
      this.container.innerHTML = `
        <div class="glass-panel text-center" style="padding: 40px; text-align: center;">
          <h2 style="color: var(--danger); margin-bottom: 12px;">Platform Admin Access Required</h2>
          <p style="color: var(--text-secondary); margin-bottom: 20px;">Please login with Super Admin credentials.</p>
          <button class="btn btn-primary" id="btn-admin-login">Login as Super Admin</button>
        </div>
      `;
      document.getElementById('btn-admin-login')?.addEventListener('click', () => {
        window.location.hash = '#login';
      });
    }
  }

  renderLoading() {
    this.container.innerHTML = `
      <div style="text-align: center; padding: 60px;">
        <div style="font-size: 1.5rem; font-family: var(--font-heading); color: #818cf8;">Loading Platform Super Admin Portal...</div>
      </div>
    `;
  }

  render() {
    const { stats, salons } = this.data;

    this.container.innerHTML = `
      <div class="app-container">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 16px;">
          <div>
            <span class="badge" style="background: rgba(236,72,153,0.15); color: var(--accent); margin-bottom: 8px;">Super Admin Control</span>
            <h1 style="font-size: 1.8rem;">Platform Multi-Tenant Management</h1>
            <p style="color: var(--text-secondary); font-size: 0.9rem;">
              Manage SaaS tenant salons, provision new salon instances, and inspect platform telemetry.
            </p>
          </div>
          <button class="btn btn-primary" id="btn-open-create-salon">
            + Provision New Salon
          </button>
        </div>

        <!-- Global Platform KPIs -->
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">TOTAL REGISTERED SALONS</div>
            <div class="stat-value">${stats.totalSalons}</div>
            <div class="stat-sub">Across all regions</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">ACTIVE TENANTS</div>
            <div class="stat-value" style="color: var(--success);">${stats.activeSalons}</div>
            <div class="stat-sub">Live booking enabled</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">TOTAL PLATFORM BOOKINGS</div>
            <div class="stat-value" style="color: #818cf8;">${stats.totalAppointments}</div>
            <div class="stat-sub">Lifetime SaaS volume</div>
          </div>
        </div>

        <!-- Salons Directory -->
        <div class="glass-panel">
          <h3 style="margin-bottom: 20px;">Registered Salons Directory</h3>

          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 20px;">
            ${salons.map(s => {
              const owner = s.users && s.users[0] ? s.users[0] : { name: 'Owner', email: s.email };
              const planName = s.subscription?.plan?.name || 'Trial';
              const isSuspended = s.status !== 'ACTIVE';

              return `
                <div style="background: var(--bg-input); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 20px; display: flex; flex-direction: column; justify-content: space-between;">
                  <div>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                      <div>
                        <div style="font-weight: 700; font-size: 1.15rem; color: #fff;">${s.name}</div>
                        <div style="font-size: 0.8rem; color: #818cf8;">slug: /book/${s.slug}</div>
                      </div>
                      <span class="badge ${isSuspended ? 'badge-cancelled' : 'badge-completed'}">
                        ${s.status}
                      </span>
                    </div>

                    <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 16px;">
                      👤 Owner: <strong>${owner.name}</strong> (${owner.email})<br />
                      📍 ${s.city || 'India'} (${s.timezone})<br />
                      💼 Plan: <span class="badge" style="background: rgba(99,102,241,0.15); color: #818cf8;">${planName}</span>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; background: rgba(0,0,0,0.2); padding: 10px; border-radius: var(--radius-sm); margin-bottom: 16px; text-align: center;">
                      <div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">STAFF</div>
                        <div style="font-weight: 700; color: #fff;">${s._count.staff}</div>
                      </div>
                      <div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">SERVICES</div>
                        <div style="font-weight: 700; color: #fff;">${s._count.services}</div>
                      </div>
                      <div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">BOOKINGS</div>
                        <div style="font-weight: 700; color: #10b981;">${s._count.appointments}</div>
                      </div>
                    </div>
                  </div>

                  <div style="display: flex; gap: 8px; justify-content: space-between; border-top: 1px solid var(--border-color); padding-top: 14px;">
                    <a href="#book/${s.slug}" target="_blank" class="btn btn-secondary btn-sm" style="flex: 1;">
                      🌐 Public Link
                    </a>
                    <button class="btn btn-secondary btn-sm btn-toggle-status" data-id="${s.id}" style="color: ${isSuspended ? 'var(--success)' : 'var(--danger)'};">
                      ${isSuspended ? 'Activate' : 'Suspend'}
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>

      <!-- Provision Salon Modal -->
      <div id="superadmin-modal-container"></div>
    `;

    this.attachEventListeners();
  }

  showCreateSalonModal() {
    const modalContainer = document.getElementById('superadmin-modal-container');
    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Provision New Salon Instance</h3>
            <button class="close-btn" id="btn-close-salon-modal">&times;</button>
          </div>

          <form id="create-salon-form">
            <div class="form-group">
              <label>Salon Business Name *</label>
              <input type="text" class="form-control" id="new-salon-name" placeholder="e.g. Royal Crown Barbershop" required />
            </div>

            <div class="form-group">
              <label>Salon URL Slug (Optional)</label>
              <input type="text" class="form-control" id="new-salon-slug" placeholder="e.g. royal-crown" />
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div class="form-group">
                <label>Owner Full Name *</label>
                <input type="text" class="form-control" id="new-owner-name" placeholder="Owner Name" required />
              </div>
              <div class="form-group">
                <label>Owner Email *</label>
                <input type="email" class="form-control" id="new-owner-email" placeholder="owner@example.com" required />
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div class="form-group">
                <label>Admin Password *</label>
                <input type="password" class="form-control" id="new-owner-password" value="Password123!" required />
              </div>
              <div class="form-group">
                <label>Salon Phone *</label>
                <input type="tel" class="form-control" id="new-salon-phone" placeholder="+91 98000 11122" required />
              </div>
            </div>

            <div class="form-group">
              <label>Meta WhatsApp Phone ID (Optional)</label>
              <input type="text" class="form-control" id="new-salon-wa-id" placeholder="e.g. 109283746592837 (from Meta Developer portal)" />
              <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px;">If provided, instantly connects this salon to WhatsApp Cloud API</div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div class="form-group">
                <label>City</label>
                <input type="text" class="form-control" id="new-salon-city" placeholder="Mumbai" />
              </div>
              <div class="form-group">
                <label>Timezone</label>
                <select class="form-control" id="new-salon-tz">
                  <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
                  <option value="America/New_York">America/New_York (EST)</option>
                  <option value="Europe/London">Europe/London (GMT)</option>
                  <option value="Asia/Dubai">Asia/Dubai (GST)</option>
                </select>
              </div>
            </div>

            <div id="salon-create-error" style="color: var(--danger); font-size: 0.85rem; margin-bottom: 12px; display: none;"></div>

            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
              <button type="button" class="btn btn-secondary" id="btn-cancel-salon-modal">Cancel</button>
              <button type="submit" class="btn btn-primary" id="btn-submit-salon">Provision Salon →</button>
            </div>
          </form>
        </div>
      </div>
    `;

    document.getElementById('btn-close-salon-modal')?.addEventListener('click', () => { modalContainer.innerHTML = ''; });
    document.getElementById('btn-cancel-salon-modal')?.addEventListener('click', () => { modalContainer.innerHTML = ''; });

    document.getElementById('create-salon-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('btn-submit-salon');
      const errorDiv = document.getElementById('salon-create-error');
      submitBtn.textContent = 'Provisioning...';
      submitBtn.setAttribute('disabled', 'true');

      try {
        await ApiClient.request('/salons/platform/create', {
          method: 'POST',
          body: JSON.stringify({
            name: document.getElementById('new-salon-name').value.trim(),
            slug: document.getElementById('new-salon-slug').value.trim() || undefined,
            ownerName: document.getElementById('new-owner-name').value.trim(),
            email: document.getElementById('new-owner-email').value.trim(),
            password: document.getElementById('new-owner-password').value,
            phone: document.getElementById('new-salon-phone').value.trim(),
            whatsappPhoneNumberId: document.getElementById('new-salon-wa-id')?.value.trim() || undefined,
            city: document.getElementById('new-salon-city').value.trim() || undefined,
            timezone: document.getElementById('new-salon-tz').value,
          }),
        });

        modalContainer.innerHTML = '';
        this.data = await ApiClient.request('/salons/platform/all');
        this.render();
      } catch (err) {
        errorDiv.textContent = err.message;
        errorDiv.style.display = 'block';
        submitBtn.textContent = 'Provision Salon →';
        submitBtn.removeAttribute('disabled');
      }
    });
  }

  attachEventListeners() {
    document.getElementById('btn-open-create-salon')?.addEventListener('click', () => {
      this.showCreateSalonModal();
    });

    this.container.querySelectorAll('.btn-toggle-status').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const salonId = e.currentTarget.dataset.id;
        try {
          await ApiClient.request(`/salons/platform/${salonId}/toggle-status`, {
            method: 'PATCH',
          });
          this.data = await ApiClient.request('/salons/platform/all');
          this.render();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }
}
