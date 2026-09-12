import { ApiClient } from './api.js';

export class PlatformAdminPortal {
  constructor(containerId, currentUser = null) {
    this.container = document.getElementById(containerId);
    this.currentUser = currentUser;
    this.data = null;
    this.activeTab = 'tenants'; // 'tenants' | 'errors'
    this.errorLogFilters = { status: 'UNRESOLVED', severity: '', search: '', page: 1, limit: 20 };
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
      document.getElementById('btn-admin-login')?.addEventListener('click', async () => {
        await ApiClient.logout();
        window.location.hash = '#super-admin';
        window.location.reload();
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
        <!-- Workspace Navigation Tabs -->
        <div style="display: flex; gap: 10px; margin-bottom: 20px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 12px;">
          <button class="btn btn-sm ${this.activeTab === 'tenants' ? 'btn-primary' : 'btn-secondary'}" id="tab-btn-tenants" style="font-weight: 700; ${this.activeTab === 'tenants' ? 'background: linear-gradient(135deg, #ec4899 0%, #be185d 100%);' : ''}">
            🏢 Salon Tenant Shards (${salons.length})
          </button>
          <button class="btn btn-sm ${this.activeTab === 'errors' ? 'btn-primary' : 'btn-secondary'}" id="tab-btn-errors" style="font-weight: 700; ${this.activeTab === 'errors' ? 'background: linear-gradient(135deg, #ef4444 0%, #b91c1c 100%); border-color: #ef4444; color: #fff;' : 'background: rgba(239, 68, 68, 0.15); border-color: rgba(239, 68, 68, 0.3); color: #f87171;'}">
            ⚡ System Error Logs Hub
          </button>
        </div>

        <div id="platform-tab-content">
          ${this.activeTab === 'tenants' ? this.renderTenantsHtml(stats, salons) : `<div id="platform-subview-container"></div>`}
        </div>
      </main>

      <!-- Super Admin Modals -->
      <div id="superadmin-modal-container"></div>
    `;

    this.attachEventListeners();

    if (this.activeTab === 'errors') {
      this.renderErrorLogsView();
    }
  }

  renderTenantsHtml(stats, salons) {
    return `
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
          <div style="display: flex; gap: 8px;">
            <button class="btn btn-secondary btn-sm" id="btn-manage-master-categories" style="background: rgba(99,102,241,0.15); border-color: rgba(99,102,241,0.3); color: #a5b4fc;">🏷️ Master Categories</button>
            <button class="btn btn-secondary btn-sm" id="btn-refresh-platform">🔄 Refresh List</button>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 20px;">
          ${salons.map((s) => {
            const owner = s.admins && s.admins[0] ? s.admins[0] : (s.users && s.users[0] ? s.users[0] : { name: 'Owner', email: s.email });
            const staffCount = s._count?.stylists ?? s._count?.staff ?? 0;
            const serviceCount = s._count?.services ?? 0;
            const hasMinCatalog = staffCount >= 1 && serviceCount >= 1;
            const isOperational = s.status === 'ACTIVE';

            return `
              <div class="glass-panel" style="margin-bottom: 0; padding: 20px; display: flex; flex-direction: column; justify-content: space-between; border-color: ${isOperational ? 'rgba(16,185,129,0.3)' : 'var(--border-subtle)'};">
                <div>
                  <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                    <div>
                      <h4 style="font-size: 1.1rem; font-weight: 800; color: #fff; margin-bottom: 2px;">${s.name}</h4>
                      <div style="font-size: 0.78rem; color: var(--text-muted);">📍 ${s.city || 'Location N/A'} • Slug: <code>${s.slug}</code></div>
                    </div>
                    <span class="badge" style="background: ${isOperational ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}; color: ${isOperational ? '#34d399' : '#f87171'}; border: 1px solid ${isOperational ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'};">
                      ${s.status}
                    </span>
                  </div>

                  <div style="background: rgba(255,255,255,0.03); border-radius: var(--radius-sm); padding: 12px; margin-bottom: 16px;">
                    <div style="font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 4px;">
                      👤 <strong>${owner.name || 'Salon Owner'}</strong> (${owner.email || 'N/A'})
                    </div>
                    <div style="font-size: 0.78rem; color: var(--text-muted); font-family: monospace;">
                      📞 Phone: ${s.phone || 'N/A'}
                    </div>
                    ${s.whatsappAccount ? `
                      <div style="font-size: 0.72rem; color: #34d399; margin-top: 4px; display: flex; align-items: center; gap: 4px;">
                        <span>💬 WhatsApp Connected:</span> <code>${s.whatsappAccount.displayPhoneNumber || s.whatsappAccount.phoneNumberId}</code>
                      </div>
                    ` : `
                      <div style="font-size: 0.72rem; color: var(--warning); margin-top: 4px;">
                        ⚠️ WhatsApp Bot Not Connected
                      </div>
                    `}
                  </div>

                  <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; text-align: center; background: rgba(0,0,0,0.2); padding: 10px; border-radius: var(--radius-sm); margin-bottom: 16px;">
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
    `;
  }

  async renderErrorLogsView() {
    const container = document.getElementById('platform-subview-container');
    if (!container) return;

    container.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--text-muted);">
        Loading Application Error Logs...
      </div>
    `;

    try {
      const res = await ApiClient.getErrorLogs(this.errorLogFilters);
      const logs = res.data || [];
      const meta = res.meta || { total: 0, unresolvedCount: 0, criticalCount: 0, highCount: 0 };

      container.innerHTML = `
        <!-- KPI Summary Stats -->
        <div class="stats-grid" style="margin-bottom: 20px;">
          <div class="stat-card">
            <div class="stat-label">UNRESOLVED ERRORS</div>
            <div class="stat-value" style="color: #ef4444;">${meta.unresolvedCount || 0}</div>
            <div class="stat-sub">Requires Super Admin investigation</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">CRITICAL FAULTS</div>
            <div class="stat-value" style="color: #dc2626;">${meta.criticalCount || 0}</div>
            <div class="stat-sub">Database & System Level Failures</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">HIGH SEVERITY FAULTS</div>
            <div class="stat-value" style="color: #f97316;">${meta.highCount || 0}</div>
            <div class="stat-sub">Unhandled 500 exceptions</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">TOTAL RECORDED ERRORS</div>
            <div class="stat-value" style="color: #818cf8;">${meta.total || 0}</div>
            <div class="stat-sub">Historical system log records</div>
          </div>
        </div>

        <!-- Filters & Search Toolbar -->
        <div class="glass-panel" style="margin-bottom: 20px; padding: 16px;">
          <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap; justify-content: space-between;">
            <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap; flex: 1;">
              <select class="form-control" id="err-filter-status" style="max-width: 170px;">
                <option value="" ${!this.errorLogFilters.status ? 'selected' : ''}>All Statuses</option>
                <option value="UNRESOLVED" ${this.errorLogFilters.status === 'UNRESOLVED' ? 'selected' : ''}>🔴 UNRESOLVED</option>
                <option value="RESOLVED" ${this.errorLogFilters.status === 'RESOLVED' ? 'selected' : ''}>✅ RESOLVED</option>
              </select>

              <select class="form-control" id="err-filter-severity" style="max-width: 170px;">
                <option value="" ${!this.errorLogFilters.severity ? 'selected' : ''}>All Severities</option>
                <option value="CRITICAL" ${this.errorLogFilters.severity === 'CRITICAL' ? 'selected' : ''}>CRITICAL</option>
                <option value="HIGH" ${this.errorLogFilters.severity === 'HIGH' ? 'selected' : ''}>HIGH</option>
                <option value="MEDIUM" ${this.errorLogFilters.severity === 'MEDIUM' ? 'selected' : ''}>MEDIUM</option>
                <option value="LOW" ${this.errorLogFilters.severity === 'LOW' ? 'selected' : ''}>LOW</option>
              </select>

              <input type="text" class="form-control" id="err-filter-search" placeholder="Search error message, endpoint, email, salon..." value="${this.errorLogFilters.search || ''}" style="max-width: 320px; flex: 1;" />
            </div>

            <button class="btn btn-secondary btn-sm" id="btn-refresh-errors">🔄 Refresh Logs</button>
          </div>
        </div>

        <!-- Error Logs Data Table -->
        <div class="glass-panel" style="overflow-x: auto;">
          ${logs.length === 0 ? `
            <div style="text-align: center; padding: 40px; color: var(--text-muted);">
              🎉 No application errors match current filters. System is clean & operational!
            </div>
          ` : `
            <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.85rem;">
              <thead>
                <tr style="border-bottom: 1px solid var(--border-subtle); color: var(--text-secondary); text-transform: uppercase; font-size: 0.7rem; letter-spacing: 0.05em;">
                  <th style="padding: 12px;">SEVERITY</th>
                  <th style="padding: 12px;">ERROR TYPE & MESSAGE</th>
                  <th style="padding: 12px;">ENDPOINT</th>
                  <th style="padding: 12px;">SALON / USER</th>
                  <th style="padding: 12px;">OCCURRENCES</th>
                  <th style="padding: 12px;">LAST SEEN</th>
                  <th style="padding: 12px;">STATUS</th>
                  <th style="padding: 12px; text-align: right;">ACTION</th>
                </tr>
              </thead>
              <tbody>
                ${logs.map((log) => {
                  const isUnresolved = log.status === 'UNRESOLVED';
                  const sevColor = log.severity === 'CRITICAL' ? '#ef4444' : log.severity === 'HIGH' ? '#f97316' : '#eab308';
                  return `
                    <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
                      <td style="padding: 12px;">
                        <span class="badge" style="background: ${sevColor}22; color: ${sevColor}; border: 1px solid ${sevColor}55; font-weight: 800; font-size: 0.68rem;">
                          ${log.severity}
                        </span>
                      </td>
                      <td style="padding: 12px; max-width: 320px;">
                        <div style="font-weight: 700; color: #fff; font-size: 0.88rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${log.errorType}</div>
                        <div style="font-size: 0.78rem; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${log.message}">${log.message}</div>
                      </td>
                      <td style="padding: 12px; font-family: monospace; font-size: 0.8rem; color: #a5b4fc;">
                        <span style="font-weight: 800; color: #fff;">${log.httpMethod}</span> ${log.endpoint}
                      </td>
                      <td style="padding: 12px; font-size: 0.8rem;">
                        <div style="color: #fff; font-weight: 600;">${log.salonName || log.salonId || 'Platform Global'}</div>
                        <div style="color: var(--text-muted); font-size: 0.75rem;">${log.userEmail || log.userId || 'Anonymous'}</div>
                      </td>
                      <td style="padding: 12px; font-weight: 800; color: #38bdf8;">
                        ${log.occurrenceCount}x
                      </td>
                      <td style="padding: 12px; color: var(--text-muted); font-size: 0.78rem;">
                        ${new Date(log.lastSeenAt || log.createdAt).toLocaleString()}
                      </td>
                      <td style="padding: 12px;">
                        ${isUnresolved ? `
                          <span class="badge" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239,68,68,0.4); font-weight: 800; font-size: 0.68rem;">🔴 UNRESOLVED</span>
                        ` : `
                          <span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16,185,129,0.4); font-weight: 800; font-size: 0.68rem;">✅ RESOLVED</span>
                        `}
                      </td>
                      <td style="padding: 12px; text-align: right;">
                        <button class="btn btn-secondary btn-sm btn-inspect-error" data-id="${log.id}" style="font-size: 0.78rem;">
                          🔍 Debug Details
                        </button>
                      </td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          `}
        </div>
      `;

      // Filter Handlers
      document.getElementById('err-filter-status')?.addEventListener('change', (e) => {
        this.errorLogFilters.status = e.target.value;
        this.renderErrorLogsView();
      });

      document.getElementById('err-filter-severity')?.addEventListener('change', (e) => {
        this.errorLogFilters.severity = e.target.value;
        this.renderErrorLogsView();
      });

      let debounceTimer;
      document.getElementById('err-filter-search')?.addEventListener('input', (e) => {
        this.errorLogFilters.search = e.target.value;
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => this.renderErrorLogsView(), 300);
      });

      document.getElementById('btn-refresh-errors')?.addEventListener('click', () => {
        this.renderErrorLogsView();
      });

      // Debug Modal Trigger
      container.querySelectorAll('.btn-inspect-error').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          const id = e.currentTarget.getAttribute('data-id');
          this.showErrorDetailModal(id);
        });
      });
    } catch (err) {
      container.innerHTML = `<div style="color: var(--danger); padding: 20px;">Error loading system error logs: ${err.message}</div>`;
    }
  }

  async showErrorDetailModal(id) {
    const modalContainer = document.getElementById('superadmin-modal-container');
    modalContainer.innerHTML = `<div class="modal-backdrop show"><div class="modal-content glass-panel" style="max-width: 720px; padding: 24px; color: #fff;">Loading debug details...</div></div>`;

    try {
      const log = await ApiClient.getErrorLogById(id);
      const isUnresolved = log.status === 'UNRESOLVED';
      const sevColor = log.severity === 'CRITICAL' ? '#ef4444' : log.severity === 'HIGH' ? '#f97316' : '#eab308';

      modalContainer.innerHTML = `
        <div class="modal-backdrop show">
          <div class="modal-content glass-panel" style="max-width: 840px; max-height: 90vh; overflow-y: auto; padding: 28px;">
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; border-bottom: 1px solid var(--border-subtle); padding-bottom: 14px;">
              <div>
                <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
                  <span class="badge" style="background: ${sevColor}22; color: ${sevColor}; border: 1px solid ${sevColor}55; font-weight: 800; font-size: 0.75rem;">
                    ${log.severity}
                  </span>
                  <h3 style="margin: 0; font-size: 1.25rem; font-weight: 800; color: #fff;">${log.errorType}</h3>
                </div>
                <div style="font-size: 0.8rem; color: var(--text-muted); font-family: monospace;">ID: ${log.id} • Fingerprint: ${log.fingerprint.slice(0, 16)}...</div>
              </div>
              <button class="btn btn-secondary btn-sm" id="btn-close-error-modal">✕</button>
            </div>

            <!-- Error Message Box -->
            <div style="background: rgba(239,68,68,0.12); border: 1px solid rgba(239,68,68,0.3); border-radius: 10px; padding: 14px; margin-bottom: 20px;">
              <div style="font-size: 0.72rem; color: #f87171; font-weight: 800; text-transform: uppercase; margin-bottom: 4px;">ERROR MESSAGE</div>
              <div style="color: #fff; font-size: 0.95rem; font-weight: 700; word-break: break-word;">${log.message}</div>
            </div>

            <!-- Structured Context Grid -->
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px;">
              
              <!-- HTTP & Endpoint Context -->
              <div style="background: rgba(0,0,0,0.25); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 14px;">
                <div style="font-size: 0.72rem; color: #a5b4fc; font-weight: 800; text-transform: uppercase; margin-bottom: 8px;">🌐 HTTP & REQUEST CONTEXT</div>
                <div style="font-size: 0.82rem; color: var(--text-secondary); line-height: 1.6;">
                  <div><strong>Method:</strong> <span style="color: #fff; font-weight: 700;">${log.httpMethod}</span></div>
                  <div><strong>Endpoint:</strong> <code style="color: #818cf8;">${log.endpoint}</code></div>
                  <div><strong>Status Code:</strong> <span style="color: ${log.statusCode >= 500 ? '#ef4444' : '#f59e0b'}; font-weight: 700;">${log.statusCode}</span></div>
                  <div><strong>Correlation ID:</strong> <code>${log.correlationId || 'N/A'}</code></div>
                </div>
              </div>

              <!-- Tenant & User Context -->
              <div style="background: rgba(0,0,0,0.25); border: 1px solid var(--border-subtle); border-radius: 10px; padding: 14px;">
                <div style="font-size: 0.72rem; color: #a5b4fc; font-weight: 800; text-transform: uppercase; margin-bottom: 8px;">👤 USER & TENANT CONTEXT</div>
                <div style="font-size: 0.82rem; color: var(--text-secondary); line-height: 1.6;">
                  <div><strong>Salon Name:</strong> <span style="color: #fff; font-weight: 700;">${log.salonName || log.salonId || 'Platform Global'}</span></div>
                  <div><strong>User Email:</strong> ${log.userEmail || log.userId || 'Anonymous Request'}</div>
                  <div><strong>User Role:</strong> <span class="badge" style="font-size: 0.65rem;">${log.userRole || 'ANONYMOUS'}</span></div>
                  <div><strong>Occurrences:</strong> <strong style="color: #38bdf8;">${log.occurrenceCount} times</strong></div>
                </div>
              </div>

            </div>

            <!-- Code Origin Context -->
            ${log.originFile ? `
              <div style="background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.3); border-radius: 10px; padding: 12px; margin-bottom: 20px; font-size: 0.82rem;">
                <div style="font-size: 0.72rem; color: #a5b4fc; font-weight: 800; text-transform: uppercase; margin-bottom: 4px;">📍 CODE ORIGIN LOCATION</div>
                <code style="color: #e0e7ff; word-break: break-all;">${log.originFile}</code>
              </div>
            ` : ''}

            <!-- Sanitized Request Data (Headers, Query, Body) -->
            <div style="margin-bottom: 20px;">
              <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 800; text-transform: uppercase; margin-bottom: 8px;">🔒 SANITIZED REQUEST PAYLOAD (SENSITIVE CREDENTIALS REDACTED)</div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div>
                  <div style="font-size: 0.7rem; color: var(--text-secondary); margin-bottom: 4px;">Query Parameters:</div>
                  <pre style="background: rgba(0,0,0,0.4); padding: 10px; border-radius: 8px; font-size: 0.75rem; color: #34d399; max-height: 120px; overflow-y: auto; margin: 0;">${JSON.stringify(log.queryParams || {}, null, 2)}</pre>
                </div>
                <div>
                  <div style="font-size: 0.7rem; color: var(--text-secondary); margin-bottom: 4px;">Request Body:</div>
                  <pre style="background: rgba(0,0,0,0.4); padding: 10px; border-radius: 8px; font-size: 0.75rem; color: #34d399; max-height: 120px; overflow-y: auto; margin: 0;">${JSON.stringify(log.requestBody || {}, null, 2)}</pre>
                </div>
              </div>
            </div>

            <!-- Full Stack Trace Container -->
            ${log.stackTrace ? `
              <div style="margin-bottom: 20px;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                  <span style="font-size: 0.75rem; color: var(--text-muted); font-weight: 800; text-transform: uppercase;">💻 FULL EXCEPTION STACK TRACE</span>
                </div>
                <pre style="background: #090d16; border: 1px solid var(--border-subtle); padding: 14px; border-radius: 10px; font-size: 0.75rem; color: #f87171; max-height: 220px; overflow: auto; line-height: 1.5; white-space: pre-wrap; word-break: break-all; margin: 0;">${log.stackTrace}</pre>
              </div>
            ` : ''}

            <!-- Resolution Section -->
            <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--border-subtle); border-radius: 12px; padding: 18px;">
              <div style="font-size: 0.8rem; font-weight: 800; color: #fff; margin-bottom: 10px; text-transform: uppercase;">RESOLUTION WORKFLOW STATUS</div>
              
              ${isUnresolved ? `
                <form id="form-resolve-error">
                  <div class="form-group" style="margin-bottom: 14px;">
                    <label for="err-resolution-notes" style="font-size: 0.8rem;">Resolution Notes (e.g. Fix commit / root cause):</label>
                    <textarea class="form-control" id="err-resolution-notes" rows="2" placeholder="Optional resolution notes (e.g. Fixed null pointer check in booking creation flow)..." style="font-size: 0.82rem;"></textarea>
                  </div>
                  <div style="display: flex; justify-content: flex-end; gap: 10px;">
                    <button type="submit" class="btn btn-primary" id="btn-submit-resolve-error" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-color: #10b981; font-weight: 800;">
                      ✅ Mark as RESOLVED
                    </button>
                  </div>
                </form>
              ` : `
                <div style="background: rgba(16,185,129,0.12); border: 1px solid #10b981; border-radius: 8px; padding: 12px; font-size: 0.82rem; color: #34d399;">
                  <div>✅ <strong>Status: RESOLVED</strong></div>
                  <div><strong>Resolved By:</strong> ${log.resolvedByName || 'Super Admin'}</div>
                  <div><strong>Resolved At:</strong> ${new Date(log.resolvedAt).toLocaleString()}</div>
                  <div style="margin-top: 6px; color: #a7f3d0;"><strong>Notes:</strong> ${log.resolutionNotes || 'No notes specified.'}</div>
                </div>
              `}
            </div>
          </div>
        </div>
      `;

      document.getElementById('btn-close-error-modal')?.addEventListener('click', () => {
        modalContainer.innerHTML = '';
      });

      document.getElementById('form-resolve-error')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById('btn-submit-resolve-error');
        const notes = document.getElementById('err-resolution-notes').value.trim();

        submitBtn.textContent = 'Updating Status...';
        submitBtn.setAttribute('disabled', 'true');

        try {
          await ApiClient.resolveErrorLog(id, notes);
          this.showToast('🎉 Error marked as RESOLVED!', 'success');
          modalContainer.innerHTML = '';
          this.renderErrorLogsView();
        } catch (err) {
          alert(`Error resolving issue: ${err.message}`);
          submitBtn.textContent = '✅ Mark as RESOLVED';
          submitBtn.removeAttribute('disabled');
        }
      });
    } catch (err) {
      modalContainer.innerHTML = `<div class="modal-backdrop show"><div class="modal-content glass-panel" style="max-width: 500px; padding: 24px; color: var(--danger);">Error loading error details: ${err.message}</div></div>`;
    }
  }

  attachEventListeners() {
    // Header Navigation Tabs
    document.getElementById('tab-btn-tenants')?.addEventListener('click', () => {
      this.activeTab = 'tenants';
      this.render();
    });

    document.getElementById('tab-btn-errors')?.addEventListener('click', () => {
      this.activeTab = 'errors';
      this.render();
    });

    // Create Salon Modal
    document.getElementById('btn-open-create-salon')?.addEventListener('click', () => {
      this.showCreateSalonModal();
    });

    // Refresh Platform List
    document.getElementById('btn-refresh-platform')?.addEventListener('click', async () => {
      this.renderLoading();
      this.data = await ApiClient.getAllSalonsPlatform();
      this.render();
    });

    // Logout
    document.getElementById('btn-super-logout')?.addEventListener('click', async () => {
      await ApiClient.logout();
      window.location.hash = '#login';
      window.location.reload();
    });
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
      document.getElementById('btn-admin-login')?.addEventListener('click', async () => {
        await ApiClient.logout();
        window.location.hash = '#super-admin';
        window.location.reload();
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
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-secondary btn-sm" id="btn-manage-master-categories" style="background: rgba(99,102,241,0.15); border-color: rgba(99,102,241,0.3); color: #a5b4fc;">🏷️ Master Categories</button>
              <button class="btn btn-secondary btn-sm" id="btn-refresh-platform">🔄 Refresh List</button>
            </div>
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
    document.getElementById('btn-super-logout')?.addEventListener('click', async () => {
      await ApiClient.logout();
      window.location.hash = '#super-admin';
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

    document.getElementById('btn-manage-master-categories')?.addEventListener('click', () => {
      this.showMasterCategoriesModal();
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
          await ApiClient.toggleSalonStatusPlatform(salonId, false);
          this.data = await ApiClient.getAllSalonsPlatform();
          this.render();
          this.showToast('Salon status updated successfully.', 'success');
        } catch (err) {
          btn.textContent = originalText;
          btn.removeAttribute('disabled');

          // Active/Future Bookings Deactivation Protection Protocol
          if (err.message && (err.message.includes('active/future booking') || err.message.includes('cancelled before deactivation'))) {
            const preview = await ApiClient.getDeactivationPreview(salonId).catch(() => null);
            const count = preview?.activeBookingsCount || 1;
            const inChair = preview?.inServiceCount || 0;

            let warnMsg = `⚠️ DEACTIVATION WARNING: Salon "${salonName}" has ${count} active/future booking(s)`;
            if (inChair > 0) warnMsg += ` (${inChair} currently in chair)`;
            warnMsg += `.\n\nDeactivating this salon will AUTOMATICALLY CANCEL all ${count} active booking(s) and dispatch WhatsApp cancellation notifications to customers.\n\nDo you want to cancel all active bookings and deactivate this salon?`;

            if (window.confirm(warnMsg)) {
              try {
                btn.textContent = 'Cancelling & Deactivating...';
                btn.setAttribute('disabled', 'true');
                await ApiClient.toggleSalonStatusPlatform(salonId, true);
                this.data = await ApiClient.getAllSalonsPlatform();
                this.render();
                this.showToast(`Salon "${salonName}" deactivated successfully. ${count} active booking(s) were cancelled.`, 'success');
              } catch (forceErr) {
                btn.textContent = originalText;
                btn.removeAttribute('disabled');
                this.showToast(forceErr.message, 'error');
              }
            }
          } else {
            this.showToast(err.message, 'error');
          }
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

  async showMasterCategoriesModal() {
    const modalContainer = document.getElementById('superadmin-modal-container');
    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content" style="max-width: 620px; max-height: 90vh; overflow-y: auto;">
          <div class="modal-header">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div class="brand-icon-box" style="width: 38px; height: 38px; font-size: 1.2rem; background: linear-gradient(135deg, rgba(99,102,241,0.3), rgba(236,72,153,0.3));">🏷️</div>
              <div>
                <h3 style="font-size: 1.25rem; font-weight: 800; color: #fff;">Super Admin Master Categories</h3>
                <p style="font-size: 0.78rem; color: var(--text-muted);">Global categories inherited by every newly created salon upon provisioning.</p>
              </div>
            </div>
            <button class="close-btn" id="btn-close-cat-modal">&times;</button>
          </div>

          <!-- Add New Master Category Form -->
          <form id="create-master-cat-form" style="background: rgba(255,255,255,0.03); padding: 16px; border-radius: var(--radius-sm); margin-bottom: 20px; border: 1px solid var(--border-subtle);">
            <div style="font-size: 0.85rem; font-weight: 700; color: #fff; margin-bottom: 10px;">➕ Add Master Category</div>
            <div style="display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 10px; align-items: flex-end;">
              <div class="form-group" style="margin: 0;">
                <label style="font-size: 0.75rem;">Category Name *</label>
                <input type="text" class="form-control" id="mc-name-input" placeholder="e.g. Hair & Beard Services" required />
              </div>
              <div class="form-group" style="margin: 0;">
                <label style="font-size: 0.75rem;">Icon (Emoji)</label>
                <input type="text" class="form-control" id="mc-icon-input" placeholder="✂️" value="✂️" />
              </div>
              <div class="form-group" style="margin: 0;">
                <label style="font-size: 0.75rem;">Sort Order</label>
                <input type="number" class="form-control" id="mc-sort-input" placeholder="0" value="0" min="0" />
              </div>
            </div>
            <button type="submit" class="btn btn-primary btn-sm" style="margin-top: 12px; width: 100%; font-size: 0.82rem;">Create Master Category →</button>
          </form>

          <!-- Active Master Categories List -->
          <div id="master-cats-list-container">
            <div style="text-align: center; color: var(--text-muted); padding: 20px;">Loading master categories...</div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-close-cat-modal')?.addEventListener('click', () => {
      modalContainer.innerHTML = '';
    });

    const loadMasterCategoriesList = async () => {
      const container = document.getElementById('master-cats-list-container');
      try {
        const categories = await ApiClient.getMasterCategories(true);
        if (!categories || categories.length === 0) {
          container.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px;">No master categories found. Create one above!</div>`;
          return;
        }

        container.innerHTML = `
          <div style="font-size: 0.85rem; font-weight: 700; color: #fff; margin-bottom: 10px;">Master Categories (${categories.length})</div>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${categories.map((c) => `
              <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(255,255,255,0.02); border: 1px solid var(--border-subtle); padding: 10px 14px; border-radius: var(--radius-sm);">
                <div style="display: flex; align-items: center; gap: 10px;">
                  <span style="font-size: 1.2rem;">${c.icon || '✂️'}</span>
                  <div>
                    <div style="font-weight: 700; color: #fff; font-size: 0.9rem;">${c.name}</div>
                    <div style="font-size: 0.72rem; color: var(--text-muted);">Sort Order: ${c.sortOrder}</div>
                  </div>
                </div>
                <div style="display: flex; gap: 6px;">
                  <button class="btn btn-secondary btn-sm btn-edit-mc" data-id="${c.id}" data-name="${c.name}" data-icon="${c.icon}" data-sort="${c.sortOrder}" style="padding: 4px 10px; font-size: 0.75rem;">✏️ Edit</button>
                  <button class="btn btn-danger-outline btn-sm btn-delete-mc" data-id="${c.id}" data-name="${c.name}" style="padding: 4px 10px; font-size: 0.75rem;">🗑️</button>
                </div>
              </div>
            `).join('')}
          </div>
        `;

        container.querySelectorAll('.btn-delete-mc').forEach((btn) => {
          btn.addEventListener('click', async (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            const name = e.currentTarget.getAttribute('data-name');
            if (confirm(`Delete master category "${name}"? Future new salons will not receive this category.`)) {
              try {
                await ApiClient.deleteMasterCategory(id);
                this.showToast(`Master category "${name}" deleted`, 'success');
                await loadMasterCategoriesList();
              } catch (err) {
                this.showToast(err.message, 'error');
              }
            }
          });
        });

        container.querySelectorAll('.btn-edit-mc').forEach((btn) => {
          btn.addEventListener('click', async (e) => {
            const id = e.currentTarget.getAttribute('data-id');
            const name = e.currentTarget.getAttribute('data-name');
            const icon = e.currentTarget.getAttribute('data-icon');
            const sort = e.currentTarget.getAttribute('data-sort');

            const newName = prompt('Enter new master category name:', name);
            if (newName === null) return;
            const newIcon = prompt('Enter icon (emoji):', icon || '✂️');
            if (newIcon === null) return;
            const newSortStr = prompt('Enter sort order (number):', sort || '0');
            if (newSortStr === null) return;

            try {
              await ApiClient.updateMasterCategory(id, {
                name: newName.trim(),
                icon: newIcon.trim(),
                sortOrder: parseInt(newSortStr, 10) || 0,
              });
              this.showToast(`Master category updated successfully`, 'success');
              await loadMasterCategoriesList();
            } catch (err) {
              this.showToast(err.message, 'error');
            }
          });
        });
      } catch (err) {
        container.innerHTML = `<div style="color: var(--danger); padding: 14px;">Error loading master categories: ${err.message}</div>`;
      }
    };

    await loadMasterCategoriesList();

    document.getElementById('create-master-cat-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('mc-name-input').value.trim();
      const icon = document.getElementById('mc-icon-input').value.trim() || '✂️';
      const sortOrder = parseInt(document.getElementById('mc-sort-input').value, 10) || 0;
      if (!name) return;

      try {
        await ApiClient.createMasterCategory({ name, icon, sortOrder });
        this.showToast(`Master category "${name}" created!`, 'success');
        document.getElementById('mc-name-input').value = '';
        await loadMasterCategoriesList();
      } catch (err) {
        this.showToast(err.message, 'error');
      }
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
