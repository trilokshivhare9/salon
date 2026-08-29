import { ApiClient } from './api.js';
import { BookingWizard } from './booking.js';
import { SalonDashboard } from './dashboard.js';
import { PlatformAdminPortal } from './platform-admin.js';
import { WhatsAppSimulator } from './whatsapp-simulator.js';

class App {
  constructor() {
    this.currentUser = null;
    this.init();
  }

  async init() {
    this.setupNavbar();
    window.addEventListener('hashchange', () => this.handleRoute());
    
    // Auto check session
    if (ApiClient.getToken()) {
      try {
        this.currentUser = await ApiClient.getMe();
      } catch (err) {
        ApiClient.removeToken();
        this.currentUser = null;
      }
    }

    if (!window.location.hash) {
      window.location.hash = '#book/glamour-studio';
    } else {
      this.handleRoute();
    }
  }

  setupNavbar() {
    const navRight = document.getElementById('nav-right');
    const navLinks = document.getElementById('nav-links-list');
    if (!navRight || !navLinks) return;

    if (this.currentUser) {
      const isSuperAdmin = this.currentUser.role === 'PLATFORM_ADMIN';

      navLinks.innerHTML = `
        <a href="#book/glamour-studio" class="nav-tab">🌐 Public Booking</a>
        <a href="#whatsapp-simulator" class="nav-tab">💬 WhatsApp Bot</a>
        <a href="#admin" class="nav-tab">📅 Salon Dashboard</a>
        ${isSuperAdmin ? '<a href="#platform-admin" class="nav-tab" style="color: var(--accent);">⚡ Super Admin</a>' : ''}
      `;

      navRight.innerHTML = `
        <span style="font-size: 0.85rem; color: var(--text-secondary);">👤 ${this.currentUser.name} (${this.currentUser.role})</span>
        <button class="btn btn-secondary btn-sm" id="btn-logout">Logout</button>
      `;

      document.getElementById('btn-logout')?.addEventListener('click', () => {
        ApiClient.removeToken();
        this.currentUser = null;
        this.setupNavbar();
        window.location.hash = '#login';
      });
    } else {
      navLinks.innerHTML = `
        <a href="#book/glamour-studio" class="nav-tab">🌐 Public Booking</a>
        <a href="#whatsapp-simulator" class="nav-tab">💬 WhatsApp Simulator</a>
        <a href="#admin" class="nav-tab">📅 Salon Dashboard</a>
        <a href="#platform-admin" class="nav-tab">⚡ Super Admin</a>
      `;

      navRight.innerHTML = `
        <a href="#login" class="btn btn-primary btn-sm">Sign In</a>
      `;
    }
  }

  handleRoute() {
    const hash = window.location.hash.slice(1);
    const appRoot = document.getElementById('app-root');
    this.setupNavbar();

    if (hash.startsWith('book/')) {
      const slug = hash.split('/')[1] || 'glamour-studio';
      const wizard = new BookingWizard('app-root', slug);
      wizard.init();
    } else if (hash === 'admin') {
      const dashboard = new SalonDashboard('app-root');
      dashboard.init();
    } else if (hash === 'platform-admin') {
      const platformAdmin = new PlatformAdminPortal('app-root');
      platformAdmin.init();
    } else if (hash === 'whatsapp-simulator') {
      const simulator = new WhatsAppSimulator('app-root');
      simulator.init();
    } else if (hash === 'login') {
      this.renderLoginPage(appRoot);
    } else {
      window.location.hash = '#book/glamour-studio';
    }
  }

  renderLoginPage(container) {
    container.innerHTML = `
      <div style="max-width: 440px; margin: 50px auto; padding: 0 16px;">
        <div class="glass-panel">
          <div style="text-align: center; margin-bottom: 24px;">
            <div class="brand-icon" style="margin: 0 auto 12px; width: 48px; height: 48px; font-size: 1.5rem;">✂️</div>
            <h2 class="gradient-text">Salon SaaS Portal Login</h2>
            <p style="color: var(--text-secondary); font-size: 0.85rem; margin-top: 4px;">Sign in as Salon Owner or Platform Super Admin</p>
          </div>

          <form id="login-form">
            <div class="form-group">
              <label>Email Address</label>
              <input type="email" class="form-control" id="login-email" value="owner@glamourstudio.com" required />
            </div>

            <div class="form-group">
              <label>Password</label>
              <input type="password" class="form-control" id="login-password" value="Password123!" required />
            </div>

            <div id="login-error" style="color: var(--danger); font-size: 0.85rem; margin-bottom: 12px; display: none;"></div>

            <button type="submit" class="btn btn-primary" style="width: 100%;" id="btn-login-submit">
              Sign In →
            </button>
          </form>

          <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border-color); font-size: 0.8rem; color: var(--text-muted); line-height: 1.6;">
            <strong>Quick Fill Credentials:</strong><br />
            • <a href="#" id="fill-owner" style="color: #818cf8;">Salon Owner (Pooja Verma)</a>: owner@glamourstudio.com<br />
            • <a href="#" id="fill-superadmin" style="color: var(--accent);">Super Admin</a>: admin@salonsaas.com
          </div>
        </div>
      </div>
    `;

    document.getElementById('fill-owner')?.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('login-email').value = 'owner@glamourstudio.com';
      document.getElementById('login-password').value = 'Password123!';
    });

    document.getElementById('fill-superadmin')?.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('login-email').value = 'admin@salonsaas.com';
      document.getElementById('login-password').value = 'Password123!';
    });

    document.getElementById('login-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('login-email').value;
      const password = document.getElementById('login-password').value;
      const errorDiv = document.getElementById('login-error');
      const submitBtn = document.getElementById('btn-login-submit');

      submitBtn.textContent = 'Authenticating...';
      submitBtn.setAttribute('disabled', 'true');
      errorDiv.style.display = 'none';

      try {
        const res = await ApiClient.login(email, password);
        this.currentUser = res.user;

        if (res.user.role === 'PLATFORM_ADMIN') {
          window.location.hash = '#platform-admin';
        } else {
          window.location.hash = '#admin';
        }
      } catch (err) {
        errorDiv.textContent = err.message || 'Login failed. Please check credentials.';
        errorDiv.style.display = 'block';
        submitBtn.textContent = 'Sign In →';
        submitBtn.removeAttribute('disabled');
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new App();
});
