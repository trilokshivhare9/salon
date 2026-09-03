import { ApiClient } from './api.js';
import { BookingWizard } from './booking.js';
import { SalonDashboard } from './dashboard.js';
import { PlatformAdminPortal } from './platform-admin.js';
import { PwaManager } from './pwa.js';
import { Icons } from './icons.js';

class App {
  constructor() {
    this.currentUser = null;
    this.init();
  }

  async init() {
    PwaManager.init();
    window.addEventListener('hashchange', () => this.handleRoute());

    // Restore cached session instantly (prevents accidental logout on phone sleep)
    if (ApiClient.getToken()) {
      this.currentUser = ApiClient.getUser();
      // Validate in background without logging out on temporary network drops
      ApiClient.getMe().then((freshUser) => {
        if (freshUser) {
          this.currentUser = freshUser;
          ApiClient.setUser(freshUser);
        }
      }).catch((err) => {
        if (err?.message?.includes('expired') || err?.message?.includes('unauthorized')) {
          ApiClient.clearSession();
          this.currentUser = null;
          this.handleRoute();
        }
      });
    }

    // Handle mobile wake-up from screen lock gracefully
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && ApiClient.getToken()) {
        ApiClient.getMe().then((user) => {
          if (user) this.currentUser = user;
        }).catch(() => {});
      }
    });

    // Start background keepalive heartbeat to prevent cloud backend sleep
    this.startKeepAlive();

    if (!window.location.hash) {
      window.location.hash = '#admin';
    } else {
      this.handleRoute();
    }
  }

  startKeepAlive() {
    // Ping backend every 3.5 minutes to keep cloud server warm while tab/PWA is active
    setInterval(() => {
      if (document.visibilityState === 'visible') {
        if (ApiClient.getToken()) {
          ApiClient.getMe().catch(() => {});
        }
      }
    }, 210000);
  }

  async handleRoute() {
    const hash = window.location.hash.slice(1) || 'admin';
    const appRoot = document.getElementById('app-root');

    // 1. PUBLIC CLIENT BOOKING ROUTE: /#book/:slug
    if (hash.startsWith('book/')) {
      const slug = hash.split('/')[1] || 'glamour-studio';
      const wizard = new BookingWizard('app-root', slug);
      wizard.init();
      return;
    }

    // 2. SUPER ADMIN PLATFORM ROUTE: /#super-admin
    if (hash === 'super-admin' || hash === 'superadmin-login') {
      if (this.currentUser && this.currentUser.role === 'PLATFORM_ADMIN') {
        const portal = new PlatformAdminPortal('app-root', this.currentUser);
        portal.init();
      } else {
        this.renderSuperAdminLogin(appRoot);
      }
      return;
    }

    // 3. SALON OPERATIONS PORTAL: /#admin or /#login
    if (hash === 'admin' || hash === 'login' || hash === 'salon-login') {
      if (this.currentUser) {
        const dashboard = new SalonDashboard('app-root', this.currentUser);
        dashboard.init();
      } else {
        this.renderSalonOwnerLogin(appRoot);
      }
      return;
    }

    // Default fallback
    window.location.hash = '#admin';
  }

  // =========================================================================
  // DEDICATED SALON OWNER LOGIN (LUXURY EDITORIAL AESTHETIC)
  // =========================================================================
  renderSalonOwnerLogin(container) {
    container.innerHTML = `
      <div style="min-height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 24px; position: relative;">
        <div style="width: 100%; max-width: 420px; position: relative; z-index: 10;">
          
          <!-- Brand Header -->
          <div style="text-align: center; margin-bottom: 32px;">
            <div style="display: inline-flex; align-items: center; justify-content: center; width: 64px; height: 64px; border-radius: 20px; background: linear-gradient(135deg, rgba(99,102,241,0.2) 0%, rgba(245,158,11,0.12) 100%); border: 1px solid rgba(255,255,255,0.12); color: #c7d2fe; margin-bottom: 18px; box-shadow: 0 12px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.2);">
              ${Icons.scissors({ size: 30, color: '#c7d2fe' })}
            </div>
            <h2 style="font-size: 2rem; font-weight: 800; letter-spacing: -0.03em; margin-bottom: 6px;">Salon Command</h2>
            <p style="color: var(--text-secondary); font-size: 0.88rem;">Precision store operations, live chair queue & floor management</p>
          </div>

          <!-- Login Glass Box -->
          <div class="glass-panel-elevated" style="padding: 32px 28px;">
            <form id="salon-login-form">
              <div class="form-group">
                <label style="display: flex; align-items: center; gap: 6px;">
                  ${Icons.user({ size: 14, color: '#94a3b8' })}
                  <span>Store Email Address</span>
                </label>
                <input type="email" class="form-control" id="salon-email" placeholder="owner@glamourstudio.com" autocomplete="email" required />
              </div>

              <div class="form-group">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                  <label style="margin-bottom: 0; display: flex; align-items: center; gap: 6px;">
                    ${Icons.shield({ size: 14, color: '#94a3b8' })}
                    <span>Password</span>
                  </label>
                  <a href="#" id="toggle-salon-pass" style="font-size: 0.76rem; color: #a5b4fc; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">
                    <span id="pass-icon">${Icons.eye({ size: 14 })}</span>
                    <span id="pass-text">Show</span>
                  </a>
                </div>
                <input type="password" class="form-control" id="salon-password" placeholder="••••••••" autocomplete="current-password" required />
              </div>

              <div id="salon-login-error" style="background: rgba(244,63,94,0.12); border: 1px solid rgba(244,63,94,0.3); border-radius: 10px; padding: 10px 14px; color: #fb7185; font-size: 0.82rem; font-weight: 600; margin-bottom: 16px; display: none;"></div>

              <button type="submit" class="btn btn-primary" style="width: 100%; padding: 13px; font-size: 0.95rem; font-weight: 700; gap: 10px;" id="btn-salon-submit">
                <span>Access Operations Hub</span>
                ${Icons.arrowRight({ size: 16 })}
              </button>
            </form>

            <div style="margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem;">
              <span style="color: var(--text-muted);">Platform Super Admin?</span>
              <a href="#super-admin" style="color: #a5b4fc; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">
                ${Icons.shield({ size: 14, color: '#a5b4fc' })}
                <span>Master Portal →</span>
              </a>
            </div>
          </div>

        </div>
      </div>
    `;

    // Password Visibility Toggle
    document.getElementById('toggle-salon-pass')?.addEventListener('click', (e) => {
      e.preventDefault();
      const passInput = document.getElementById('salon-password');
      const passIcon = document.getElementById('pass-icon');
      const passText = document.getElementById('pass-text');
      if (passInput) {
        const isPass = passInput.type === 'password';
        passInput.type = isPass ? 'text' : 'password';
        if (passIcon) passIcon.innerHTML = isPass ? Icons.eyeOff({ size: 14 }) : Icons.eye({ size: 14 });
        if (passText) passText.textContent = isPass ? 'Hide' : 'Show';
      }
    });

    document.getElementById('salon-login-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('salon-email').value;
      const password = document.getElementById('salon-password').value;
      const errorDiv = document.getElementById('salon-login-error');
      const submitBtn = document.getElementById('btn-salon-submit');

      submitBtn.innerHTML = `<span>Authenticating Store...</span>`;
      submitBtn.setAttribute('disabled', 'true');
      errorDiv.style.display = 'none';

      try {
        const res = await ApiClient.login(email, password);
        this.currentUser = res.user;
        window.location.hash = '#admin';
        this.handleRoute();
      } catch (err) {
        errorDiv.textContent = err.message || 'Login failed. Please check store credentials.';
        errorDiv.style.display = 'block';
        submitBtn.innerHTML = `<span>Access Operations Hub</span> ${Icons.arrowRight({ size: 16 })}`;
        submitBtn.removeAttribute('disabled');
      }
    });
  }

  // =========================================================================
  // DEDICATED SUPER ADMIN PLATFORM LOGIN
  // =========================================================================
  renderSuperAdminLogin(container) {
    container.innerHTML = `
      <div style="min-height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 24px;">
        <div style="width: 100%; max-width: 420px; position: relative; z-index: 10;">
          
          <!-- Brand Logo & Header -->
          <div style="text-align: center; margin-bottom: 32px;">
            <div style="display: inline-flex; align-items: center; justify-content: center; width: 64px; height: 64px; border-radius: 20px; background: linear-gradient(135deg, rgba(245,158,11,0.2) 0%, rgba(99,102,241,0.2) 100%); border: 1px solid rgba(245,158,11,0.3); color: #fbbf24; margin-bottom: 18px; box-shadow: 0 12px 32px rgba(0,0,0,0.6);">
              ${Icons.shield({ size: 30, color: '#fbbf24' })}
            </div>
            <h2 style="font-size: 2rem; font-weight: 800; letter-spacing: -0.03em; margin-bottom: 6px;">Super Admin Control</h2>
            <p style="color: var(--text-secondary); font-size: 0.88rem;">Multi-Tenant SaaS Management & Platform Telemetry</p>
          </div>

          <!-- Login Glass Box -->
          <div class="glass-panel-elevated" style="padding: 32px 28px; border-color: rgba(245,158,11,0.2);">
            <form id="superadmin-login-form">
              <div class="form-group">
                <label>Super Admin Email</label>
                <input type="email" class="form-control" id="super-email" placeholder="admin@salonsaas.com" autocomplete="email" required />
              </div>

              <div class="form-group">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                  <label style="margin-bottom: 0;">Master Password</label>
                  <a href="#" id="toggle-super-pass" style="font-size: 0.76rem; color: #fbbf24; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">
                    <span id="super-pass-icon">${Icons.eye({ size: 14 })}</span>
                    <span id="super-pass-text">Show</span>
                  </a>
                </div>
                <input type="password" class="form-control" id="super-password" placeholder="••••••••" autocomplete="current-password" required />
              </div>

              <div id="super-login-error" style="background: rgba(244,63,94,0.12); border: 1px solid rgba(244,63,94,0.3); border-radius: 10px; padding: 10px 14px; color: #fb7185; font-size: 0.82rem; font-weight: 600; margin-bottom: 16px; display: none;"></div>

              <button type="submit" class="btn btn-primary" style="width: 100%; padding: 13px; font-size: 0.95rem; font-weight: 700; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); box-shadow: 0 4px 16px rgba(245,158,11,0.35); border-color: rgba(255,255,255,0.2);" id="btn-super-submit">
                <span>Access Platform Control</span>
                ${Icons.arrowRight({ size: 16 })}
              </button>
            </form>

            <div style="margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center; font-size: 0.8rem;">
              <span style="color: var(--text-muted);">Salon Store Owner?</span>
              <a href="#admin" style="color: #a5b4fc; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">
                ${Icons.scissors({ size: 14, color: '#a5b4fc' })}
                <span>Salon Owner Portal →</span>
              </a>
            </div>
          </div>

        </div>
      </div>
    `;

    document.getElementById('toggle-super-pass')?.addEventListener('click', (e) => {
      e.preventDefault();
      const passInput = document.getElementById('super-password');
      const passIcon = document.getElementById('super-pass-icon');
      const passText = document.getElementById('super-pass-text');
      if (passInput) {
        const isPass = passInput.type === 'password';
        passInput.type = isPass ? 'text' : 'password';
        if (passIcon) passIcon.innerHTML = isPass ? Icons.eyeOff({ size: 14 }) : Icons.eye({ size: 14 });
        if (passText) passText.textContent = isPass ? 'Hide' : 'Show';
      }
    });

    document.getElementById('superadmin-login-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('super-email').value;
      const password = document.getElementById('super-password').value;
      const errorDiv = document.getElementById('super-login-error');
      const submitBtn = document.getElementById('btn-super-submit');

      submitBtn.innerHTML = `<span>Verifying Super Admin...</span>`;
      submitBtn.setAttribute('disabled', 'true');
      errorDiv.style.display = 'none';

      try {
        const res = await ApiClient.login(email, password);
        this.currentUser = res.user;
        if (res.user.role !== 'PLATFORM_ADMIN') {
          throw new Error('Access Denied: Account is not a Platform Super Admin.');
        }
        window.location.hash = '#super-admin';
        this.handleRoute();
      } catch (err) {
        errorDiv.textContent = err.message || 'Authentication failed.';
        errorDiv.style.display = 'block';
        submitBtn.innerHTML = `<span>Access Platform Control</span> ${Icons.arrowRight({ size: 16 })}`;
        submitBtn.removeAttribute('disabled');
      }
    });
  }

}

document.addEventListener('DOMContentLoaded', () => {
  new App();
});
