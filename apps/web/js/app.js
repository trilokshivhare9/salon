import { ApiClient } from './api.js';
import { BookingWizard } from './booking.js';
import { SalonDashboard } from './dashboard.js';
import { PlatformAdminPortal } from './platform-admin.js';
import { PwaManager } from './pwa.js';

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

    if (!window.location.hash) {
      window.location.hash = '#admin';
    } else {
      this.handleRoute();
    }
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
  // DEDICATED SALON OWNER LOGIN
  // =========================================================================
  renderSalonOwnerLogin(container) {
    container.innerHTML = `
      <div style="min-height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 24px;">
        <div style="width: 100%; max-width: 440px;">
          
          <!-- Brand Logo & Header -->
          <div style="text-align: center; margin-bottom: 28px;">
            <div style="display: inline-flex; align-items: center; justify-content: center; width: 60px; height: 60px; border-radius: var(--radius-md); background: linear-gradient(135deg, rgba(99,102,241,0.2), rgba(236,72,153,0.2)); border: 1px solid var(--border-bright); font-size: 1.8rem; margin-bottom: 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.5);">
              ✂️
            </div>
            <h2 style="font-size: 1.8rem; font-weight: 800;" class="gradient-text">Salon Owner Portal</h2>
            <p style="color: var(--text-secondary); font-size: 0.9rem; margin-top: 6px;">Sign in to access your store schedule, queue & staff roster</p>
          </div>

          <!-- Login Glass Box -->
          <div class="glass-panel-elevated">
            <form id="salon-login-form">
              <div class="form-group">
                <label>Store Email Address</label>
                <input type="email" class="form-control" id="salon-email" value="trilok@gmail.com" placeholder="owner@salon.com" required />
              </div>

              <div class="form-group">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                  <label style="margin-bottom: 0;">Password</label>
                  <a href="#" id="toggle-salon-pass" style="font-size: 0.75rem; color: var(--accent); font-weight: 600;">👁️ Show Password</a>
                </div>
                <input type="password" class="form-control" id="salon-password" value="Password123!" placeholder="••••••••" required />
              </div>

              <div id="salon-login-error" style="color: var(--danger); font-size: 0.85rem; margin-bottom: 14px; display: none;"></div>

              <button type="submit" class="btn btn-primary" style="width: 100%; padding: 12px;" id="btn-salon-submit">
                Access Operations Hub →
              </button>
            </form>

            <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem;">
              <span style="color: var(--text-muted);">Platform Owner?</span>
              <a href="#super-admin" style="color: var(--accent); font-weight: 600;">⚡ Super Admin Portal →</a>
            </div>
          </div>

        </div>
      </div>
    `;

    // Password Toggle
    document.getElementById('toggle-salon-pass')?.addEventListener('click', (e) => {
      e.preventDefault();
      const passInput = document.getElementById('salon-password');
      if (passInput) {
        const isPass = passInput.type === 'password';
        passInput.type = isPass ? 'text' : 'password';
        e.target.textContent = isPass ? '🙈 Hide Password' : '👁️ Show Password';
      }
    });

    document.getElementById('salon-login-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('salon-email').value;
      const password = document.getElementById('salon-password').value;
      const errorDiv = document.getElementById('salon-login-error');
      const submitBtn = document.getElementById('btn-salon-submit');

      submitBtn.textContent = 'Authenticating Store...';
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
        submitBtn.textContent = 'Access Operations Hub →';
        submitBtn.removeAttribute('disabled');
      }
    });
  }

  // =========================================================================
  // DEDICATED SUPER ADMIN PLATFORM LOGIN
  // =========================================================================
  renderSuperAdminLogin(container) {
    container.innerHTML = `
      <div style="min-height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; padding: 24px; background: radial-gradient(at 50% 0%, rgba(236,72,153,0.12) 0px, transparent 60%);">
        <div style="width: 100%; max-width: 440px;">
          
          <!-- Brand Logo & Header -->
          <div style="text-align: center; margin-bottom: 28px;">
            <div style="display: inline-flex; align-items: center; justify-content: center; width: 60px; height: 60px; border-radius: var(--radius-md); background: linear-gradient(135deg, rgba(236,72,153,0.25), rgba(99,102,241,0.25)); border: 1px solid rgba(236,72,153,0.3); font-size: 1.8rem; margin-bottom: 16px; box-shadow: 0 8px 24px rgba(236,72,153,0.25);">
              ⚡
            </div>
            <h2 style="font-size: 1.8rem; font-weight: 800;" class="gradient-text">Super Admin Control</h2>
            <p style="color: var(--text-secondary); font-size: 0.9rem; margin-top: 6px;">Multi-Tenant SaaS Management & Telemetry Portal</p>
          </div>

          <!-- Login Glass Box -->
          <div class="glass-panel-elevated" style="border-color: rgba(236,72,153,0.2);">
            <form id="superadmin-login-form">
              <div class="form-group">
                <label>Super Admin Email</label>
                <input type="email" class="form-control" id="super-email" value="admin@salonsaas.com" placeholder="admin@salonsaas.com" required />
              </div>

              <div class="form-group">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                  <label style="margin-bottom: 0;">Master Password</label>
                  <a href="#" id="toggle-super-pass" style="font-size: 0.75rem; color: var(--accent); font-weight: 600;">👁️ Show Password</a>
                </div>
                <input type="password" class="form-control" id="super-password" value="Password123!" placeholder="••••••••" required />
              </div>

              <div id="super-login-error" style="color: var(--danger); font-size: 0.85rem; margin-bottom: 14px; display: none;"></div>

              <button type="submit" class="btn btn-primary" style="width: 100%; padding: 12px; background: linear-gradient(135deg, #ec4899 0%, #be185d 100%); border-color: rgba(255,255,255,0.2); box-shadow: 0 4px 16px rgba(236,72,153,0.35);" id="btn-super-submit">
                Access Platform Control →
              </button>
            </form>

            <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center; font-size: 0.82rem;">
              <span style="color: var(--text-muted);">Salon Store Owner?</span>
              <a href="#admin" style="color: #818cf8; font-weight: 600;">📅 Salon Owner Portal →</a>
            </div>
          </div>

        </div>
      </div>
    `;

    document.getElementById('superadmin-login-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('super-email').value;
      const password = document.getElementById('super-password').value;
      const errorDiv = document.getElementById('super-login-error');
      const submitBtn = document.getElementById('btn-super-submit');

      submitBtn.textContent = 'Verifying Super Admin...';
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
        submitBtn.textContent = 'Access Platform Control →';
        submitBtn.removeAttribute('disabled');
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new App();
});
