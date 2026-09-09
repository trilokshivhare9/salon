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
      const owner = s.admins && s.admins[0] ? s.admins[0] : (s.users && s.users[0] ? s.users[0] : { name: 'Owner', email: s.email });
      const staffCount = s._count?.stylists ?? s._count?.staff ?? 0;
      const serviceCount = s._count?.services ?? 0;
      const hasMinCatalog = staffCount >= 1 && serviceCount >= 1;
      const isOperational = s.status === 'ACTIVE' && hasMinCatalog;
      const waId = s.whatsappAccount?.phoneNumberId;

      return `
                <div class="staff-card" style="display: flex; flex-direction: column; justify-content: space-between;">
                  <div>
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px;">
                      <div>
                        <div style="font-weight: 800; font-size: 1.15rem; color: #fff;">${s.name}</div>
                        <div style="font-size: 0.8rem; color: #818cf8; font-family: monospace;">/#book/${s.slug}</div>
                      </div>
                      <span class="badge ${isOperational ? 'badge-completed' : 'badge-cancelled'}" style="font-size: 0.65rem; ${!hasMinCatalog ? 'background: rgba(245,158,11,0.15); border-color: rgba(245,158,11,0.4); color: #f59e0b;' : ''}">
                        ${isOperational ? '● ACTIVE' : (!hasMinCatalog ? '⚪ INACTIVE (Setup Req)' : '⚪ INACTIVE (Paused)')}
                      </span>
                    </div>

                    <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 12px; line-height: 1.6;">
                      👤 Owner: <strong style="color: #fff;">${owner.name}</strong> (${owner.email})<br />
                      📞 Salon Phone: <strong style="color: #fff;">${s.phone}</strong><br />
                      📍 Location: <strong>${s.city || 'India'}</strong> ${s.address ? `• ${s.address}` : ''}
                    </div>

                    <!-- Meta WhatsApp Bot Status -->
                    <div style="margin-bottom: 14px; padding: 8px 10px; background: rgba(0,0,0,0.3); border-radius: var(--radius-sm); border: 1px solid rgba(255,255,255,0.06); font-size: 0.78rem;">
                      ${waId ? `
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                          <span style="color: #10b981; font-weight: 700; display: flex; align-items: center; gap: 4px;">
                            <span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #10b981;"></span>
                            WhatsApp Bot Active
                          </span>
                          <code style="color: #cbd5e1; font-size: 0.75rem; background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px;">${waId}</code>
                        </div>
                      ` : `
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                          <span style="color: #f59e0b; font-weight: 600; display: flex; align-items: center; gap: 4px;">
                            <span style="display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: #f59e0b;"></span>
                            No WhatsApp Bot Linked
                          </span>
                          <button class="btn btn-xs btn-open-link-wa" data-id="${s.id}" data-name="${s.name}" style="background: rgba(245,158,11,0.15); border: 1px solid rgba(245,158,11,0.35); color: #f59e0b; font-size: 0.72rem; padding: 3px 8px; border-radius: 4px; cursor: pointer; font-weight: 600;">
                            🔗 Link Phone ID
                          </button>
                        </div>
                      `}
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

                  <div style="display: flex; gap: 6px; justify-content: space-between; border-top: 1px solid var(--border-subtle); padding-top: 14px; align-items: center;">
                    <a href="#book/${s.slug}" target="_blank" class="btn btn-secondary btn-sm" style="flex: 1; text-align: center;">
                      🌐 Public Link
                    </a>
                    <button class="btn btn-secondary btn-sm btn-toggle-salon-status" data-id="${s.id}" data-name="${s.name}" data-ready="${hasMinCatalog}" style="color: ${!isOperational ? 'var(--success)' : 'var(--warning)'}; font-size: 0.78rem;">
                      ${!isOperational ? 'Activate' : 'Deactivate'}
                    </button>
                    <button class="btn btn-sm btn-delete-salon" data-id="${s.id}" data-name="${s.name}" style="background: rgba(244,63,94,0.12); border: 1px solid rgba(244,63,94,0.3); color: #f43f5e; padding: 6px 10px; border-radius: var(--radius-sm); font-size: 0.78rem; cursor: pointer;" title="Delete this salon permanently">
                      🗑️ Delete
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
        <div class="modal-content" style="max-width: 580px; max-height: 90vh; overflow-y: auto;">
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
            <div class="form-group" style="margin-bottom: 14px;">
              <label>Salon Business Name *</label>
              <input type="text" class="form-control" id="prov-name" placeholder="e.g. Royal Men's Barber Shop / Looks Unisex Salon" minlength="3" required />
            </div>

            <!-- Owner & Contact Details -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px;">
              <div class="form-group">
                <label>Owner Full Name *</label>
                <input type="text" class="form-control" id="prov-owner-name" placeholder="e.g. Rahul Sharma" minlength="2" required />
              </div>

              <div class="form-group">
                <label>Owner Email *</label>
                <input type="email" class="form-control" id="prov-email" placeholder="owner@example.com" required />
              </div>
            </div>

            <!-- Meta WhatsApp Phone Number ID with Live Auto-Fetch -->
            <div class="form-group" style="margin-bottom: 14px;">
              <label for="prov-whatsapp-phone-id">Meta WhatsApp Phone Number ID *</label>
              <div style="display: flex; gap: 8px; align-items: stretch;">
                <input type="text" class="form-control" id="prov-whatsapp-phone-id" placeholder="Enter 15-17 digit Phone Number ID (e.g. 109876543210987)" style="flex: 1; min-width: 0;" required />
                <button type="button" id="btn-verify-meta-phone" class="btn btn-secondary btn-sm" style="flex-shrink: 0; white-space: nowrap; font-size: 0.8rem; padding: 8px 14px; background: rgba(99,102,241,0.18); border: 1px solid rgba(99,102,241,0.4); color: #a5b4fc; cursor: pointer; border-radius: var(--radius-sm); font-weight: 600;">
                  🔍 Verify & Fetch Phone
                </button>
              </div>
              <div id="prov-wa-verify-result" style="margin-top: 8px; display: none;"></div>
              <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 4px;">
                Enter your Meta Phone ID. Live Meta probe verifies account and auto-fills the phone number below.
              </div>
            </div>

            <!-- Mobile / WhatsApp Number (Auto-Filled from Meta - Read Only) -->
            <div class="form-group" style="margin-bottom: 14px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <label for="prov-phone" style="margin-bottom: 0;">Mobile / WhatsApp Number *</label>
                <span style="font-size: 0.72rem; color: #a5b4fc; font-weight: 600; display: flex; align-items: center; gap: 3px;">
                  🔒 Auto-fetched from Meta (Read-only)
                </span>
              </div>
              <input type="tel" class="form-control" id="prov-phone" placeholder="Auto-filled from Meta once Phone ID is verified" readonly style="background: rgba(255,255,255,0.04); cursor: not-allowed; opacity: 0.9; border: 1px solid var(--border-subtle);" required autocomplete="off" />
              <div id="prov-phone-hint" style="font-size: 0.72rem; color: var(--text-muted); margin-top: 4px;">
                🔒 Not editable. Enter Meta Phone ID above & click "Verify & Fetch Phone" to auto-fill this number.
              </div>
            </div>

            <!-- City & Password (Clean Equal Alignment) -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px;">
              <div class="form-group">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                  <label style="margin-bottom: 0;">City *</label>
                </div>
                <input type="text" class="form-control" id="prov-city" placeholder="e.g. Indore / Bhopal" required />
              </div>

              <div class="form-group">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                  <label style="margin-bottom: 0;">Password *</label>
                  <a href="#" id="btn-gen-pass" style="font-size: 0.72rem; color: var(--accent); font-weight: 700; text-decoration: none;">⚡ Gen Pass</a>
                </div>
                <input type="text" class="form-control" id="prov-password" value="Pass@${Math.floor(100000 + Math.random() * 900000)}" minlength="6" required />
              </div>
            </div>

            <!-- Operating Hours (Dedicated Clean Row) -->
            <div class="form-group" style="margin-bottom: 14px;">
              <label style="margin-bottom: 6px; display: block;">Store Operating Hours *</label>
              <div style="display: grid; grid-template-columns: 1fr auto 1fr; gap: 10px; align-items: center;">
                <div>
                  <input type="time" class="form-control" id="prov-open-time" value="09:00" style="padding: 8px 12px; width: 100%;" required />
                </div>
                <span style="color: var(--text-muted); font-size: 0.82rem; font-weight: 600;">to</span>
                <div>
                  <input type="time" class="form-control" id="prov-close-time" value="21:00" style="padding: 8px 12px; width: 100%;" required />
                </div>
              </div>
            </div>

            <!-- Shop Address / Landmark (Full Width for Full Comfort) -->
            <div class="form-group" style="margin-bottom: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <label style="margin-bottom: 0;">Shop Address / Landmark</label>
                <span style="font-size: 0.72rem; color: var(--text-muted);">(Optional)</span>
              </div>
              <input type="text" class="form-control" id="prov-address" placeholder="e.g. Shop 12, Main Market, Near Rajwada" />
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

    // Live Meta Verification Logic & Auto-Fill Phone Number
    let isMetaPhoneVerified = false;
    let verifiedMetaData = null;
    const waIdInput = document.getElementById('prov-whatsapp-phone-id');
    const waVerifyResult = document.getElementById('prov-wa-verify-result');
    const btnVerifyMeta = document.getElementById('btn-verify-meta-phone');
    const phoneInput = document.getElementById('prov-phone');
    const phoneHint = document.getElementById('prov-phone-hint');

    waIdInput?.addEventListener('input', () => {
      isMetaPhoneVerified = false;
      verifiedMetaData = null;
      btnVerifyMeta.textContent = '🔍 Verify & Fetch Phone';
      btnVerifyMeta.style.background = 'rgba(99,102,241,0.18)';
      btnVerifyMeta.style.borderColor = 'rgba(99,102,241,0.4)';
      btnVerifyMeta.style.color = '#a5b4fc';
      waVerifyResult.style.display = 'none';
      phoneInput.value = '';
      phoneInput.style.borderColor = '';
      phoneInput.style.background = 'rgba(255,255,255,0.04)';
      phoneInput.style.color = '';
      phoneInput.style.fontWeight = 'normal';
      phoneHint.textContent = '🔒 Not editable. Enter Meta Phone ID above & click "Verify & Fetch Phone" to auto-fill this number.';
      phoneHint.style.color = 'var(--text-muted)';
    });

    const runMetaVerification = async () => {
      const idVal = waIdInput.value.trim();
      if (!idVal || !/^\d{10,20}$/.test(idVal)) {
        waVerifyResult.style.display = 'block';
        waVerifyResult.innerHTML = `<div style="padding: 6px 10px; background: rgba(244,63,94,0.12); border: 1px solid #f43f5e; border-radius: 6px; color: #f43f5e;">❌ Phone Number ID must be numeric (10-20 digits).</div>`;
        isMetaPhoneVerified = false;
        return false;
      }

      btnVerifyMeta.textContent = '⏳ Probing Meta...';
      btnVerifyMeta.setAttribute('disabled', 'true');
      waVerifyResult.style.display = 'block';
      waVerifyResult.innerHTML = `<div style="padding: 6px 10px; color: var(--text-muted); font-size: 0.8rem;">⏳ Probing Meta Cloud API (v20.0)...</div>`;

      try {
        const res = await ApiClient.verifyMetaPhoneId(idVal);
        isMetaPhoneVerified = true;
        verifiedMetaData = res;

        // Auto-fill phone number from Meta Graph API (Read-only / locked)
        if (res.displayPhoneNumber) {
          phoneInput.value = res.displayPhoneNumber;
          phoneHint.innerHTML = `🔒 <strong>Locked:</strong> Auto-filled from Meta (${res.displayPhoneNumber}). Salon owner logs in with this number.`;
          phoneHint.style.color = '#10b981';
          phoneInput.style.borderColor = '#10b981';
          phoneInput.style.background = 'rgba(16,185,129,0.06)';
          phoneInput.style.color = '#34d399';
          phoneInput.style.fontWeight = '600';
        }

        btnVerifyMeta.textContent = '✅ Verified';
        btnVerifyMeta.style.background = 'rgba(16,185,129,0.18)';
        btnVerifyMeta.style.borderColor = '#10b981';
        btnVerifyMeta.style.color = '#10b981';

        waVerifyResult.innerHTML = `
          <div style="padding: 10px 12px; background: rgba(16,185,129,0.12); border: 1px solid #10b981; border-radius: 8px; color: #10b981; line-height: 1.5; font-size: 0.8rem;">
            <div style="display: flex; align-items: center; justify-content: space-between;">
              <strong>✅ Meta WhatsApp Account Verified</strong>
              <span style="font-size: 0.7rem; background: rgba(16,185,129,0.25); padding: 2px 6px; border-radius: 4px; font-weight: 700;">PASSED</span>
            </div>
            <div style="color: #6ee7b7; font-size: 0.75rem; margin-top: 4px;">
              Account: <strong>${res.verifiedName}</strong> (<code>${res.displayPhoneNumber}</code>)
            </div>
            <div style="color: #a7f3d0; font-size: 0.72rem; margin-top: 2px;">
              ⚡ Phone Number <code>${res.displayPhoneNumber}</code> auto-filled below!
            </div>
          </div>
        `;
        return true;
      } catch (err) {
        isMetaPhoneVerified = false;
        verifiedMetaData = null;
        btnVerifyMeta.textContent = '🔍 Verify & Fetch Phone';
        btnVerifyMeta.style.background = 'rgba(99,102,241,0.18)';
        btnVerifyMeta.style.borderColor = 'rgba(99,102,241,0.4)';
        btnVerifyMeta.style.color = '#a5b4fc';

        waVerifyResult.innerHTML = `
          <div style="padding: 10px 12px; background: rgba(244,63,94,0.12); border: 1px solid #f43f5e; border-radius: 8px; color: #f43f5e; line-height: 1.4; font-size: 0.8rem;">
            ❌ <strong>Meta API Error:</strong> ${err.message}
          </div>
        `;
        return false;
      } finally {
        btnVerifyMeta.removeAttribute('disabled');
      }
    };

    btnVerifyMeta?.addEventListener('click', runMetaVerification);

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
      submitBtn.textContent = 'Validating & Creating...';
      submitBtn.setAttribute('disabled', 'true');
      errorDiv.style.display = 'none';

      const rawWaId = waIdInput.value.trim();
      if (!rawWaId) {
        errorDiv.textContent = 'Meta WhatsApp Phone Number ID is required to enable bot bookings.';
        errorDiv.style.display = 'block';
        submitBtn.textContent = '⚡ Create Salon Shard →';
        submitBtn.removeAttribute('disabled');
        return;
      }

      if (!isMetaPhoneVerified) {
        const pass = await runMetaVerification();
        if (!pass) {
          errorDiv.textContent = 'Please verify a valid Meta WhatsApp Phone Number ID before creating the salon.';
          errorDiv.style.display = 'block';
          submitBtn.textContent = '⚡ Create Salon Shard →';
          submitBtn.removeAttribute('disabled');
          return;
        }
      }

      const rawPhone = phoneInput.value.trim();
      if (!rawPhone) {
        errorDiv.textContent = 'Please verify your Meta WhatsApp Phone ID above to fetch and populate the mobile number.';
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
        whatsappPhoneNumberId: rawWaId,
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

  showLinkWhatsAppModal(salonId, salonName) {
    const modalContainer = document.getElementById('superadmin-modal-container');
    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content glass-panel" style="max-width: 480px; padding: 24px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
            <h3 style="margin: 0; font-size: 1.15rem; color: #fff;">🔗 Link WhatsApp Bot</h3>
            <button class="btn btn-secondary btn-sm" id="btn-close-link-modal">✕</button>
          </div>

          <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 18px; line-height: 1.5;">
            Connect an active Meta WhatsApp Cloud Phone Number ID to <strong>${salonName}</strong> to enable real-time WhatsApp bot bookings.
          </p>

          <form id="link-wa-form">
            <div class="form-group" style="margin-bottom: 16px;">
              <label for="link-phone-id-input" style="margin-bottom: 6px;">WhatsApp Phone Number or Phone ID *</label>
              <div style="display: flex; gap: 8px; align-items: stretch;">
                <input type="text" class="form-control" id="link-phone-id-input" placeholder="e.g. +91 98XXXXXX00 or 109876543210987" style="flex: 1; min-width: 0;" required />
                <button type="button" id="btn-verify-link-meta" class="btn btn-secondary btn-sm" style="flex-shrink: 0; white-space: nowrap; font-size: 0.8rem; padding: 8px 14px; background: rgba(99,102,241,0.18); border: 1px solid rgba(99,102,241,0.4); color: #a5b4fc; cursor: pointer;">
                  Verify
                </button>
              </div>
              <div id="link-wa-feedback" style="margin-top: 8px; font-size: 0.78rem; display: none;"></div>
            </div>

            <div id="link-wa-error" style="background: rgba(244,63,94,0.15); border: 1px solid var(--danger-border); color: #f43f5e; padding: 10px; border-radius: var(--radius-sm); font-size: 0.82rem; margin-bottom: 16px; display: none;"></div>

            <div style="display: flex; justify-content: flex-end; gap: 10px;">
              <button type="button" class="btn btn-secondary" id="btn-cancel-link-modal">Cancel</button>
              <button type="submit" class="btn btn-primary" id="btn-submit-link-wa" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%);">
                🔗 Save & Connect Bot
              </button>
            </div>
          </form>
        </div>
      </div>
    `;

    document.getElementById('btn-close-link-modal')?.addEventListener('click', () => { modalContainer.innerHTML = ''; });
    document.getElementById('btn-cancel-link-modal')?.addEventListener('click', () => { modalContainer.innerHTML = ''; });

    const phoneInput = document.getElementById('link-phone-id-input');
    const feedbackDiv = document.getElementById('link-wa-feedback');
    const btnVerify = document.getElementById('btn-verify-link-meta');
    let isVerified = false;
    let verifiedPhoneId = null;

    const verifyPhone = async () => {
      const val = phoneInput.value.trim();
      if (!val) return;
      btnVerify.textContent = '⏳ Checking...';
      btnVerify.setAttribute('disabled', 'true');
      feedbackDiv.style.display = 'block';
      feedbackDiv.innerHTML = `<div style="padding: 6px 10px; color: var(--text-muted);">Probing Meta Cloud API...</div>`;

      try {
        let res;
        if (val.startsWith('+') || val.includes(' ') || val.length < 14) {
          res = await ApiClient.verifySalonPhoneNumber(val, false);
        } else {
          res = await ApiClient.verifyMetaPhoneId(val);
        }
        isVerified = true;
        verifiedPhoneId = res.phoneNumberId;
        feedbackDiv.innerHTML = `
          <div style="padding: 8px 10px; background: rgba(16,185,129,0.12); border: 1px solid #10b981; border-radius: 6px; color: #10b981;">
            ✅ <strong>Meta Verified:</strong> ${res.verifiedName} (<code>${res.displayPhoneNumber}</code>)<br />
            <span style="font-size: 0.72rem; color: #6ee7b7;">● Phone ID auto-resolved: <code>${res.phoneNumberId}</code></span>
          </div>
        `;
      } catch (err) {
        isVerified = false;
        verifiedPhoneId = null;
        feedbackDiv.innerHTML = `
          <div style="padding: 8px 10px; background: rgba(244,63,94,0.12); border: 1px solid #f43f5e; border-radius: 6px; color: #f43f5e;">
            ❌ <strong>Meta Error:</strong> ${err.message}
          </div>
        `;
      } finally {
        btnVerify.textContent = 'Verify';
        btnVerify.removeAttribute('disabled');
      }
    };

    btnVerify?.addEventListener('click', verifyPhone);

    document.getElementById('link-wa-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errDiv = document.getElementById('link-wa-error');
      const submitBtn = document.getElementById('btn-submit-link-wa');
      errDiv.style.display = 'none';

      if (!isVerified || !verifiedPhoneId) {
        await verifyPhone();
        if (!isVerified || !verifiedPhoneId) {
          errDiv.textContent = 'Please verify a valid Meta WhatsApp number or Phone ID before connecting.';
          errDiv.style.display = 'block';
          return;
        }
      }

      submitBtn.textContent = 'Linking Bot...';
      submitBtn.setAttribute('disabled', 'true');

      try {
        await ApiClient.linkSalonWhatsAppAccount(salonId, verifiedPhoneId);
        modalContainer.innerHTML = '';
        this.data = await ApiClient.getAllSalonsPlatform();
        this.render();
      } catch (err) {
        errDiv.textContent = err.message || 'Could not link WhatsApp account.';
        errDiv.style.display = 'block';
        submitBtn.textContent = '🔗 Save & Connect Bot';
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
            <div><strong>📱 Login Mobile:</strong> <code style="color: #38bdf8; font-weight: 700; font-size: 0.95rem;">${salon.phone}</code></div>
            <div><strong>🔑 Password:</strong> <code style="color: #10b981; font-weight: 700;">${rawPassword}</code></div>
            <div><strong>📧 Owner Email:</strong> <code style="color: #94a3b8;">${salon.email}</code></div>
            <div><strong>🚀 Salon Admin Portal:</strong> <a href="${loginUrl}" target="_blank" style="color: #818cf8;">${loginUrl}</a></div>
            <div style="margin-top: 10px; padding: 10px 12px; background: rgba(16,185,129,0.12); border: 1px solid rgba(16,185,129,0.3); border-radius: 8px; font-size: 0.78rem; color: #34d399; line-height: 1.5;">
              📲 <strong>WhatsApp Notification Sent:</strong> Login mobile, password, and portal link have been sent directly to <strong>${salon.phone}</strong> on WhatsApp!
            </div>
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
      const msg = `🎉 StyleSlot Salon Portal Ready!\n\n🏢 Salon: ${salon.name}\n📱 Login Mobile: ${salon.phone}\n🔑 Password: ${rawPassword}\n🌐 Login Link: ${window.location.origin}/#login\n\nLogin with your mobile number and password to access your salon operations hub.`;
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
        const salonName = e.currentTarget.getAttribute('data-name');
        const isReady = e.currentTarget.getAttribute('data-ready') === 'true';

        if (btn.textContent.trim().toLowerCase().includes('activate') && !isReady) {
          this.showToast(`⚠️ Cannot activate "${salonName}": A salon requires at least 1 staff member and 1 service before it can become ACTIVE.`, 'warning');
          return;
        }

        const originalText = btn.textContent;
        btn.textContent = 'Updating...';
        btn.setAttribute('disabled', 'true');

        try {
          await ApiClient.toggleSalonStatusPlatform(salonId);
          this.data = await ApiClient.getAllSalonsPlatform();
          this.render();
          this.showToast('Salon status updated successfully.', 'success');
        } catch (err) {
          btn.textContent = originalText;
          btn.removeAttribute('disabled');
          this.showToast(err.message, 'error');
        }
      });
    });

    this.container.querySelectorAll('.btn-open-link-wa').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const salonId = e.currentTarget.getAttribute('data-id');
        const salonName = e.currentTarget.getAttribute('data-name');
        this.showLinkWhatsAppModal(salonId, salonName);
      });
    });

    this.container.querySelectorAll('.btn-delete-salon').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const salonId = e.currentTarget.getAttribute('data-id');
        const salonName = e.currentTarget.getAttribute('data-name');
        const confirmed = window.confirm(
          `⚠️ Are you sure you want to PERMANENTLY DELETE "${salonName}"?\n\nThis will completely erase all salon data, stylists, services, appointments, and owner login from the live database.\n\nThis action CANNOT be undone.`
        );
        if (!confirmed) return;

        try {
          await ApiClient.deleteSalonPlatform(salonId);
          this.data = await ApiClient.getAllSalonsPlatform();
          this.render();
          this.showToast(`Salon "${salonName}" deleted successfully.`, 'success');
        } catch (err) {
          this.showToast('Error deleting salon: ' + err.message, 'error');
        }
      });
    });
  }

  showToast(message, type = 'info') {
    let toastContainer = document.getElementById('platform-toast-container');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'platform-toast-container';
      toastContainer.style.cssText = 'position: fixed; top: calc(env(safe-area-inset-top, 0px) + 16px); right: 16px; left: 16px; max-width: 440px; margin: 0 auto; z-index: 99999; display: flex; flex-direction: column; gap: 10px; pointer-events: none;';
      document.body.appendChild(toastContainer);
    }

    const toast = document.createElement('div');
    const bg = type === 'success' ? '#10b981' : type === 'warning' ? '#f59e0b' : '#f43f5e';
    toast.style.cssText = `background: ${bg}; color: #fff; padding: 12px 18px; border-radius: 8px; font-size: 0.85rem; font-weight: 600; box-shadow: 0 10px 30px rgba(0,0,0,0.5); pointer-events: auto; transition: all 0.3s ease; transform: translateY(-10px); opacity: 0; line-height: 1.4;`;
    toast.textContent = message;

    toastContainer.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.transform = 'translateY(0)';
      toast.style.opacity = '1';
    });

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      setTimeout(() => toast.remove(), 300);
    }, 4500);
  }
}
