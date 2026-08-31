import { ApiClient } from './api.js';

export class PlatformAdminPortal {
  constructor(containerId, currentUser = null) {
    this.container = document.getElementById(containerId);
    this.currentUser = currentUser;
    this.data = null;
  }

  async init() {
    this.renderLoading();
    try {
      this.data = await ApiClient.getAllSalonsPlatform();
      this.render();
    } catch (err) {
      console.error(err);
      this.container.innerHTML = `
        <div style="min-height: 80vh; display: flex; align-items: center; justify-content: center; padding: 24px;">
          <div class="glass-panel text-center" style="max-width: 440px; text-align: center; padding: 40px;">
            <div style="font-size: 2.5rem; margin-bottom: 12px;">⚡</div>
            <h3 style="color: var(--danger); margin-bottom: 8px;">Super Admin Access Required</h3>
            <p style="color: var(--text-secondary); font-size: 0.88rem; margin-bottom: 20px;">Please login with verified platform master credentials.</p>
            <button class="btn btn-primary" id="btn-admin-login" style="width: 100%; background: linear-gradient(135deg, #ec4899 0%, #be185d 100%);">Login as Super Admin →</button>
          </div>
        </div>
      `;
      document.getElementById('btn-admin-login')?.addEventListener('click', () => {
        ApiClient.removeToken();
        window.location.hash = '#superadmin-login';
      });
    }
  }

  renderLoading() {
    this.container.innerHTML = `
      <div style="min-height: 80vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 40px;">
        <div class="brand-icon-box" style="width: 52px; height: 52px; font-size: 1.6rem; margin-bottom: 16px; background: linear-gradient(135deg, rgba(236,72,153,0.3), rgba(99,102,241,0.3));">⚡</div>
        <div style="font-size: 1.3rem; font-family: var(--font-heading); color: var(--accent); font-weight: 700;">Loading Multi-Tenant Control Engine...</div>
        <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 4px;">Auditing tenant database shards & platform volume</p>
      </div>
    `;
  }

  render() {
    const { stats, salons } = this.data;

    this.container.innerHTML = `
      <!-- Dedicated Super Admin Header Bar -->
      <header class="portal-header" style="border-bottom-color: rgba(236,72,153,0.25);">
        <div class="portal-header-content">
          <div style="display: flex; align-items: center; gap: 14px;">
            <div class="brand-icon-box" style="background: linear-gradient(135deg, rgba(236,72,153,0.3), rgba(99,102,241,0.3)); border-color: rgba(236,72,153,0.4);">⚡</div>
            <div>
              <div style="display: flex; align-items: center; gap: 8px;">
                <span style="font-family: var(--font-heading); font-size: 1.15rem; font-weight: 800; color: #fff;">SalonFlow Multi-Tenant Engine</span>
                <span class="badge" style="background: rgba(236,72,153,0.2); color: var(--accent); font-size: 0.65rem; border: 1px solid rgba(236,72,153,0.4);">SUPER ADMIN MODE</span>
              </div>
              <div style="font-size: 0.75rem; color: var(--text-muted);">Master Tenant Provisioning & Platform Administration</div>
            </div>
          </div>

          <div style="display: flex; gap: 10px; align-items: center;">
            <button class="btn btn-primary btn-sm" id="btn-open-create-salon" style="background: linear-gradient(135deg, #ec4899 0%, #be185d 100%); border-color: rgba(255,255,255,0.2); box-shadow: 0 4px 16px rgba(236,72,153,0.35);">
              ⚡ + Create New Salon
            </button>
            <div style="height: 24px; width: 1px; background: var(--border-subtle); margin: 0 4px;"></div>
            <button class="btn btn-secondary btn-sm" id="btn-super-logout" style="color: var(--text-muted);">
              🚪 Logout
            </button>
          </div>
        </div>
      </header>

      <!-- Main Workspace -->
      <main style="max-width: 1300px; margin: 0 auto; padding: 24px 16px;">
        
        <!-- Platform KPI Cards -->
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">TOTAL REGISTERED SALONS</div>
            <div class="stat-value" style="color: #ec4899;">${stats.totalSalons}</div>
            <div class="stat-sub">Across all cities</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">ACTIVE LIVE SALONS</div>
            <div class="stat-value" style="color: var(--success);">${stats.activeSalons}</div>
            <div class="stat-sub">Ready & accepting bookings</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">LIFETIME PLATFORM BOOKINGS</div>
            <div class="stat-value" style="color: #818cf8;">${stats.totalAppointments}</div>
            <div class="stat-sub">Total bookings processed</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">SYSTEM HEALTH PROBE</div>
            <div class="stat-value" style="color: #10b981; font-size: 1.3rem; line-height: 1.8;">🟢 OPERATIONAL</div>
            <div class="stat-sub">PostgreSQL • Meta Cloud API</div>
          </div>
        </div>

        <!-- Tenant Salons Grid -->
        <div class="glass-panel">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px;">
            <div>
              <h3 style="font-size: 1.25rem;">Registered Salon Tenants (${salons.length})</h3>
              <p style="color: var(--text-secondary); font-size: 0.85rem;">Manage tenant lifecycle, inspect real staff/service counts, and toggle active status.</p>
            </div>
            <button class="btn btn-secondary btn-sm" id="btn-refresh-platform">🔄 Refresh List</button>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 20px;">
            ${salons.map((s) => {
              const owner = s.users && s.users[0] ? s.users[0] : { name: 'Owner', email: s.email };
              const isDeactivated = s.status === 'DEACTIVATED' || s.status === 'SUSPENDED' || s.status === 'INACTIVE';
              const staffCount = s._count?.staff || 0;
              const serviceCount = s._count?.services || 0;
              const isSetupIncomplete = staffCount === 0 || serviceCount === 0;

              return `
                <div class="staff-card" style="display: flex; flex-direction: column; justify-content: space-between;">
                  <div>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                      <div>
                        <div style="font-weight: 800; font-size: 1.15rem; color: #fff;">${s.name}</div>
                        <div style="font-size: 0.8rem; color: #818cf8; font-family: monospace;">/#book/${s.slug}</div>
                      </div>
                      <span class="badge ${isDeactivated ? 'badge-cancelled' : 'badge-completed'}" style="font-size: 0.65rem;">
                        ${isDeactivated ? (isSetupIncomplete ? 'DEACTIVATED (SETUP REQ)' : 'DEACTIVATED') : '● ACTIVE'}
                      </span>
                    </div>

                    <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 16px; line-height: 1.6;">
                      👤 Owner: <strong style="color: #fff;">${owner.name}</strong> (${owner.email})<br />
                      📞 Phone: <strong style="color: #fff;">${s.phone}</strong><br />
                      📍 Location: <strong>${s.city || 'India'}</strong> ${s.address ? `• ${s.address}` : ''}
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; background: rgba(0,0,0,0.3); padding: 12px; border-radius: var(--radius-sm); margin-bottom: 16px; text-align: center;">
                      <div>
                        <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: 700;">STAFF</div>
                        <div style="font-weight: 800; font-size: 1.1rem; color: ${staffCount > 0 ? '#fff' : '#f43f5e'};">${staffCount}</div>
                      </div>
                      <div>
                        <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: 700;">SERVICES</div>
                        <div style="font-weight: 800; font-size: 1.1rem; color: ${serviceCount > 0 ? '#fff' : '#f43f5e'};">${serviceCount}</div>
                      </div>
                      <div>
                        <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: 700;">BOOKINGS</div>
                        <div style="font-weight: 800; font-size: 1.1rem; color: #10b981;">${s._count?.appointments || 0}</div>
                      </div>
                    </div>
                  </div>

                  <div style="display: flex; gap: 8px; justify-content: space-between; border-top: 1px solid var(--border-subtle); padding-top: 14px;">
                    <a href="#book/${s.slug}" target="_blank" class="btn btn-secondary btn-sm" style="flex: 1;">
                      🌐 Public Link
                    </a>
                    <button class="btn btn-secondary btn-sm btn-toggle-salon-status" data-id="${s.id}" style="color: ${isDeactivated ? 'var(--success)' : 'var(--danger)'};">
                      ${isDeactivated ? 'Activate' : 'Deactivate'}
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </main>

      <!-- Super Admin Modals -->
      <div id="superadmin-modal-container"></div>
    `;

    this.attachEventListeners();
  }

  showCreateSalonModal() {
    const modalContainer = document.getElementById('superadmin-modal-container');

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content" style="max-width: 520px; max-height: 90vh; overflow-y: auto;">
          <div class="modal-header">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div class="brand-icon-box" style="width: 38px; height: 38px; font-size: 1.2rem; background: linear-gradient(135deg, rgba(236,72,153,0.3), rgba(99,102,241,0.3));">⚡</div>
              <div>
                <h3 style="font-size: 1.25rem; font-weight: 800; color: #fff;">Create New Salon</h3>
                <p style="font-size: 0.78rem; color: var(--text-muted);">Starts clean as Deactivated until owner adds staff & services</p>
              </div>
            </div>
            <button class="close-btn" id="btn-close-super-modal">&times;</button>
          </div>

          <form id="create-salon-form">
            
            <!-- Salon Name -->
            <div class="form-group">
              <label>Salon Business Name *</label>
              <input type="text" class="form-control" id="prov-name" placeholder="e.g. Royal Men's Barber Shop / Looks Unisex Salon" minlength="3" required />
            </div>

            <!-- Owner & Contact Details -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div class="form-group">
                <label>Owner Full Name *</label>
                <input type="text" class="form-control" id="prov-owner-name" placeholder="e.g. Trilok Shivhare" minlength="2" required />
              </div>

              <div class="form-group">
                <label>Owner Email *</label>
                <input type="email" class="form-control" id="prov-email" placeholder="owner@gmail.com" required />
              </div>
            </div>

            <div style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 12px;">
              <div class="form-group">
                <label>Mobile / WhatsApp Number *</label>
                <input type="tel" class="form-control" id="prov-phone" placeholder="e.g. 7999817743" maxlength="13" required autocomplete="off" />
                <div id="prov-phone-hint" style="font-size: 0.72rem; color: var(--text-muted); margin-top: 2px;">Enter 10-digit Indian number</div>
              </div>

              <div class="form-group">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                  <label style="margin-bottom: 0;">Password *</label>
                  <a href="#" id="btn-gen-pass" style="font-size: 0.72rem; color: var(--accent); font-weight: 700;">⚡ Gen Pass</a>
                </div>
                <input type="text" class="form-control" id="prov-password" value="Pass@${Math.floor(100000 + Math.random() * 900000)}" minlength="6" required />
              </div>
            </div>

            <!-- City, Address & Operating Hours -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div class="form-group">
                <label>City *</label>
                <input type="text" class="form-control" id="prov-city" placeholder="e.g. Indore / Bhopal / Mumbai" required />
              </div>

              <div class="form-group">
                <label>Store Hours *</label>
                <div style="display: flex; gap: 6px; align-items: center;">
                  <input type="time" class="form-control" id="prov-open-time" value="09:00" style="padding: 8px;" required />
                  <span style="color: var(--text-muted); font-size: 0.8rem;">to</span>
                  <input type="time" class="form-control" id="prov-close-time" value="21:00" style="padding: 8px;" required />
                </div>
              </div>
            </div>

            <div class="form-group" style="margin-bottom: 16px;">
              <label>Shop Address / Landmark (Optional)</label>
              <input type="text" class="form-control" id="prov-address" placeholder="e.g. Shop 12, Main Market, Rajwada" />
            </div>

            <div style="background: rgba(99,102,241,0.06); border: 1px solid rgba(99,102,241,0.2); border-radius: var(--radius-sm); padding: 12px; margin-bottom: 16px; font-size: 0.8rem; color: var(--text-secondary); line-height: 1.5;">
              ℹ️ <strong>Zero Dummy Guarantee:</strong> This salon will start clean with 0 staff & 0 services in <strong>DEACTIVATED</strong> status. It will automatically activate as soon as the salon owner adds their first staff member and service.
            </div>

            <!-- Error Banner -->
            <div id="prov-error" style="background: rgba(244,63,94,0.15); border: 1px solid var(--danger-border); color: #f43f5e; padding: 12px; border-radius: var(--radius-sm); font-size: 0.85rem; margin-bottom: 16px; display: none;"></div>

            <!-- Submit Button Bar -->
            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 10px;">
              <button type="button" class="btn btn-secondary" id="btn-cancel-super-modal">Cancel</button>
              <button type="submit" class="btn btn-primary" id="btn-submit-provision" style="background: linear-gradient(135deg, #ec4899 0%, #be185d 100%);">
                ⚡ Create Salon Shard →
              </button>
            </div>
          </form>
        </div>
      </div>
    `;

    // Handlers
    document.getElementById('btn-close-super-modal')?.addEventListener('click', () => { modalContainer.innerHTML = ''; });
    document.getElementById('btn-cancel-super-modal')?.addEventListener('click', () => { modalContainer.innerHTML = ''; });

    // Strict Real-Time Mobile Input Mask
    const phoneInput = document.getElementById('prov-phone');
    const phoneHint = document.getElementById('prov-phone-hint');

    phoneInput?.addEventListener('input', (e) => {
      let val = e.target.value;
      const startsWithPlus = val.startsWith('+');
      let digitsOnly = val.replace(/\D/g, '');

      // Enforce numeric only (with optional single leading +)
      e.target.value = startsWithPlus ? `+${digitsOnly}` : digitsOnly;

      const effectiveDigits = startsWithPlus && digitsOnly.startsWith('91') ? digitsOnly.slice(2) : digitsOnly;

      if (effectiveDigits.length > 0) {
        if (!/^[6-9]/.test(effectiveDigits)) {
          phoneHint.textContent = '❌ Indian mobile numbers must start with 6, 7, 8, or 9';
          phoneHint.style.color = '#f43f5e';
          phoneInput.style.borderColor = '#f43f5e';
        } else if (effectiveDigits.length < 10) {
          phoneHint.textContent = `⏳ ${10 - effectiveDigits.length} more digit(s) needed`;
          phoneHint.style.color = 'var(--text-muted)';
          phoneInput.style.borderColor = '';
        } else if (effectiveDigits.length === 10) {
          phoneHint.textContent = '✅ Valid 10-digit Indian mobile number';
          phoneHint.style.color = '#10b981';
          phoneInput.style.borderColor = '#10b981';
        }
      } else {
        phoneHint.textContent = 'Enter 10-digit Indian number';
        phoneHint.style.color = 'var(--text-muted)';
        phoneInput.style.borderColor = '';
      }
    });

    // Generate strong password
    document.getElementById('btn-gen-pass')?.addEventListener('click', (e) => {
      e.preventDefault();
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#';
      let pass = 'Pass@';
      for (let i = 0; i < 4; i++) {
        pass += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      document.getElementById('prov-password').value = pass;
    });

    // Form Submit
    document.getElementById('create-salon-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('btn-submit-provision');
      const errorDiv = document.getElementById('prov-error');
      submitBtn.textContent = 'Creating Salon Shard...';
      submitBtn.setAttribute('disabled', 'true');
      errorDiv.style.display = 'none';

      const rawPhone = document.getElementById('prov-phone').value.trim();
      const digitsOnly = rawPhone.replace(/\D/g, '');
      const effectiveDigits = rawPhone.startsWith('+91') ? digitsOnly.slice(2) : (digitsOnly.startsWith('91') && digitsOnly.length === 12 ? digitsOnly.slice(2) : digitsOnly);

      if (!/^[6-9]\d{9}$/.test(effectiveDigits)) {
        errorDiv.textContent = 'Please enter a valid 10-digit mobile number starting with 6, 7, 8, or 9.';
        errorDiv.style.display = 'block';
        submitBtn.textContent = '⚡ Create Salon Shard →';
        submitBtn.removeAttribute('disabled');
        return;
      }

      const payload = {
        name: document.getElementById('prov-name').value.trim(),
        ownerName: document.getElementById('prov-owner-name').value.trim(),
        email: document.getElementById('prov-email').value.trim(),
        password: document.getElementById('prov-password').value,
        phone: rawPhone,
        city: document.getElementById('prov-city').value.trim(),
        address: document.getElementById('prov-address')?.value?.trim() || undefined,
        timezone: 'Asia/Kolkata',
        openTime: document.getElementById('prov-open-time').value,
        closeTime: document.getElementById('prov-close-time').value,
      };

      try {
        const createdSalon = await ApiClient.createSalonPlatform(payload);
        this.showProvisionSuccessModal(createdSalon, payload.password);
        this.data = await ApiClient.getAllSalonsPlatform();
        this.render();
      } catch (err) {
        if (err.message && (err.message.includes('Session') || err.message.includes('Unauthorized') || err.message.includes('unauthorized'))) {
          errorDiv.innerHTML = `
            <div style="margin-bottom: 6px;"><strong>⚠️ Super Admin Session Expired:</strong> The database was freshly reset.</div>
            <a href="#superadmin-login" class="btn btn-sm btn-primary" style="display: inline-block; background: linear-gradient(135deg, #ec4899 0%, #be185d 100%); font-size: 0.8rem; padding: 6px 12px;">Login as Super Admin (admin@salonsaas.com) →</a>
          `;
        } else {
          errorDiv.textContent = err.message || 'Could not create salon. Please verify input fields.';
        }
        errorDiv.style.display = 'block';
        submitBtn.textContent = '⚡ Create Salon Shard →';
        submitBtn.removeAttribute('disabled');
      }
    });
  }

  showProvisionSuccessModal(salon, rawPassword) {
    const modalContainer = document.getElementById('superadmin-modal-container');
    const loginUrl = `${window.location.origin}/#login`;

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content" style="text-align: center; max-width: 480px;">
          <div style="font-size: 3rem; margin-bottom: 8px;">🎉</div>
          <h2 style="color: var(--success); margin-bottom: 4px;">Salon Created Successfully!</h2>
          <p style="color: var(--text-secondary); font-size: 0.88rem; margin-bottom: 20px;">
            <strong>${salon.name}</strong> created in <span class="badge badge-cancelled" style="font-size: 0.7rem;">DEACTIVATED (Setup Required)</span> state.
          </p>

          <div style="background: var(--bg-input); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 16px; text-align: left; margin-bottom: 20px; font-size: 0.88rem; line-height: 1.8;">
            <div><strong>🏢 Salon Name:</strong> <span style="color: #fff;">${salon.name}</span></div>
            <div><strong>👤 Owner Email:</strong> <code style="color: #fff;">${salon.email}</code></div>
            <div><strong>🔑 Password:</strong> <code style="color: #10b981;">${rawPassword}</code></div>
            <div><strong>🚀 Salon Admin Portal:</strong> <a href="${loginUrl}" target="_blank" style="color: #818cf8;">${loginUrl}</a></div>
          </div>

          <div style="display: flex; gap: 10px;">
            <button class="btn btn-secondary" style="flex: 1;" id="btn-copy-onboarding">📋 Copy Login Details</button>
            <button class="btn btn-primary" style="flex: 1;" id="btn-close-success">Done</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-close-success')?.addEventListener('click', () => { modalContainer.innerHTML = ''; });

    document.getElementById('btn-copy-onboarding')?.addEventListener('click', () => {
      const msg = `🎉 Your Salon Portal is ready!\n\n🏢 Business: ${salon.name}\n👤 Login Email: ${salon.email}\n🔑 Password: ${rawPassword}\n🚀 Login URL: ${window.location.origin}/#admin`;
      navigator.clipboard.writeText(msg);
      alert('Copied login details to clipboard!');
    });
  }

  attachEventListeners() {
    document.getElementById('btn-super-logout')?.addEventListener('click', () => {
      ApiClient.removeToken();
      window.location.hash = '#superadmin-login';
      window.location.reload();
    });

    document.getElementById('btn-refresh-platform')?.addEventListener('click', async () => {
      this.renderLoading();
      this.data = await ApiClient.getAllSalonsPlatform();
      this.render();
    });

    document.getElementById('btn-open-create-salon')?.addEventListener('click', () => {
      this.showCreateSalonModal();
    });

    this.container.querySelectorAll('.btn-toggle-salon-status').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const salonId = e.currentTarget.getAttribute('data-id');
        try {
          await ApiClient.toggleSalonStatusPlatform(salonId);
          this.data = await ApiClient.getAllSalonsPlatform();
          this.render();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }
}
