import { ApiClient, PlatformAuth, SalonAuth, PlatformRealm, SalonRealm } from './api.js';
import { BookingWizard } from './booking.js';
import { SalonDashboard } from './dashboard.js';
import { PlatformAdminPortal } from './platform-admin.js';
import { PwaManager } from './pwa.js';
import { Icons } from './icons.js';

class App {
  constructor() {
    this.init();
  }

  async init() {
    PwaManager.init();
    window.addEventListener('hashchange', () => this.handleRoute());

    // Register global auth failure handler for In-Place Re-Authentication
    window.onAuthFailure = () => this.showInPlaceReAuthModal();

    // Multi-Tab Synchronization via BroadcastChannel (Realm-Isolated)
    if (typeof BroadcastChannel !== 'undefined') {
      const authChannel = new BroadcastChannel('salon_auth_sync');
      authChannel.onmessage = (event) => {
        const type = event.data?.type;
        const currentHash = (window.location.hash || '').replace(/^#\/?/, '');
        const isPlatformRoute = currentHash === 'super-admin' || currentHash === 'superadmin-login';

        if (type === 'PLATFORM_LOGOUT') {
          PlatformRealm.clear();
          if (isPlatformRoute) this.handleRoute();
        } else if (type === 'SALON_LOGOUT') {
          SalonRealm.clear();
          if (!isPlatformRoute && !currentHash.startsWith('book')) this.handleRoute();
        } else if (type === 'PLATFORM_LOGIN') {
          if (isPlatformRoute) this.handleRoute();
        } else if (type === 'SALON_LOGIN') {
          if (!isPlatformRoute && !currentHash.startsWith('book')) this.handleRoute();
        }
      };
    }

    // Initialize session and hydrate authentication state
    await this.initSession();

    // Handle mobile wake-up from screen lock gracefully per realm
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        const currentHash = (window.location.hash || '').replace(/^#\/?/, '');
        if (currentHash === 'super-admin') {
          if (!PlatformAuth.isAuthenticated()) {
            this.handleRoute();
          }
        } else if (currentHash === 'admin') {
          if (SalonAuth.getToken()) {
            ApiClient.getMe().catch(() => {});
          }
        }
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

  async initSession() {
    // 1. Hydrate Salon Realm if active token exists
    const salonToken = SalonAuth.getToken();
    if (salonToken && !ApiClient.isTokenExpired(salonToken)) {
      try {
        const user = await ApiClient.getMe();
        if (user) SalonRealm.setUser(user);
      } catch (err) {
        if (err.status === 401 || err.status === 403) {
          SalonRealm.clear();
        }
      }
    }

    // 2. Hydrate Platform Realm if active token exists
    const platformToken = PlatformAuth.getToken();
    if (platformToken && ApiClient.isTokenExpired(platformToken)) {
      PlatformRealm.clear();
    }
  }

  showInPlaceReAuthModal() {
    const rawHash = (window.location.hash || '').replace(/^#\/?/, '');
    const isPlatform = rawHash === 'super-admin' || rawHash === 'superadmin-login';

    if (isPlatform) {
      PlatformRealm.clear();
      window.location.hash = '#superadmin-login';
      return;
    }

    const salonUser = SalonAuth.getUser();
    if (!salonUser) {
      SalonRealm.clear();
      window.location.hash = '#login';
      return;
    }

    if (document.getElementById('reauth-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'reauth-modal';
    modal.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.85); backdrop-filter:blur(10px); z-index:9999999; display:flex; align-items:center; justify-content:center; padding:20px;';
    
    const initialIdentifier = salonUser?.phone || salonUser?.email || localStorage.getItem('last_user_identifier') || '';

    modal.innerHTML = `
      <div style="background:#131927; border:1px solid rgba(99,102,241,0.3); border-radius:20px; width:100%; max-width:420px; padding:32px; box-shadow:0 25px 50px -12px rgba(0,0,0,0.7); text-align:center; color:#fff; font-family:sans-serif;">
        <div style="font-size:2.5rem; margin-bottom:12px;">🔒</div>
        <h3 style="margin:0 0 8px 0; font-size:1.25rem; font-weight:700;">Session Expired</h3>
        <p style="color:#94a3b8; font-size:0.85rem; margin-bottom:20px; line-height:1.4;">
          Your session timed out. Re-enter your password to resume without losing your work.
        </p>
        <form id="reauth-form" style="text-align:left;">
          <label style="display:block; font-size:0.75rem; color:#94a3b8; margin-bottom:6px; font-weight:600;">OWNER MOBILE NUMBER / WHATSAPP</label>
          <input type="tel" id="reauth-identifier" value="${initialIdentifier}" placeholder="Enter 10-digit mobile number" required style="width:100%; padding:12px 16px; background:#1e293b; border:1px solid #334155; border-radius:10px; color:#fff; font-size:0.95rem; margin-bottom:14px; box-sizing:border-box; outline:none;" />
          
          <label style="display:block; font-size:0.75rem; color:#94a3b8; margin-bottom:6px; font-weight:600;">Password</label>
          <input type="password" id="reauth-password" placeholder="Enter password" required style="width:100%; padding:12px 16px; background:#1e293b; border:1px solid #334155; border-radius:10px; color:#fff; font-size:0.95rem; margin-bottom:16px; box-sizing:border-box; outline:none;" />
          
          <div id="reauth-error" style="color:#f87171; font-size:0.8rem; margin-bottom:12px; display:none; text-align:center;"></div>
          <button type="submit" id="reauth-submit-btn" style="width:100%; padding:12px; background:#4f46e5; border:none; border-radius:10px; color:#fff; font-weight:600; font-size:0.95rem; cursor:pointer;">Resume Session</button>
          <button type="button" id="reauth-full-login-btn" style="width:100%; margin-top:10px; padding:10px; background:transparent; border:1px solid #475569; border-radius:10px; color:#94a3b8; font-weight:500; font-size:0.85rem; cursor:pointer;">Log In with Different Account</button>
        </form>
      </div>
    `;

    document.body.appendChild(modal);

    const form = document.getElementById('reauth-form');
    const fullLoginBtn = document.getElementById('reauth-full-login-btn');

    fullLoginBtn.addEventListener('click', () => {
      SalonRealm.clear();
      modal.remove();
      window.location.hash = '#login';
      this.handleRoute();
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const identifier = document.getElementById('reauth-identifier').value.trim();
      const password = document.getElementById('reauth-password').value;
      const errEl = document.getElementById('reauth-error');
      const submitBtn = document.getElementById('reauth-submit-btn');
      
      errEl.style.display = 'none';
      submitBtn.disabled = true;
      submitBtn.textContent = 'Resuming...';

      try {
        const loginRes = await SalonAuth.login(identifier, password);
        if (loginRes?.user) {
          modal.remove();
          console.log('✅ In-Place Re-Authentication successful! Re-hydrating view...');
          await this.handleRoute();
        }
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Resume Session';
        errEl.textContent = err.message || 'Invalid credentials. Please try again.';
        errEl.style.display = 'block';
      }
    });
  }

  openForgotPasswordModal(prefilledMobile = '') {
    if (document.getElementById('forgot-password-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'forgot-password-modal';
    modal.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.85); backdrop-filter:blur(12px); z-index:9999999; display:flex; align-items:center; justify-content:center; padding:16px; box-sizing:border-box;';

    modal.innerHTML = `
      <div style="background:#111827; border:1px solid rgba(99,102,241,0.3); border-radius:20px; width:100%; max-width:440px; padding:32px 28px; box-shadow:0 25px 50px -12px rgba(0,0,0,0.8); color:#fff; font-family:sans-serif; position:relative;">
        <button id="btn-close-fp-modal" style="position:absolute; top:16px; right:16px; background:transparent; border:none; color:#94a3b8; font-size:1.5rem; cursor:pointer; line-height:1; padding:4px 8px; border-radius:8px;">&times;</button>

        <!-- STEP 1: Enter Registered Mobile Number & Show Saved Salon Email -->
        <div id="fp-step-1">
          <div style="text-align:center; margin-bottom:20px;">
            <div style="display:inline-flex; align-items:center; justify-content:center; width:52px; height:52px; border-radius:16px; background:rgba(99,102,241,0.2); border:1px solid rgba(99,102,241,0.35); font-size:24px; margin-bottom:12px;">🔑</div>
            <h3 style="margin:0 0 6px 0; font-size:1.3rem; font-weight:800; letter-spacing:-0.02em;">Reset Salon Password</h3>
            <p style="color:#94a3b8; font-size:0.85rem; margin:0; line-height:1.45;">
              Enter your salon's registered mobile number. We will look up your salon and send a 6-digit OTP code to your registered email address saved during salon creation.
            </p>
          </div>

          <form id="fp-form-lookup">
            <div style="margin-bottom:16px;">
              <label style="display:block; font-size:0.75rem; color:#94a3b8; margin-bottom:6px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em;">Owner Registered Mobile Number</label>
              <input type="tel" id="fp-mobile" value="${prefilledMobile}" placeholder="e.g. 7999817743" required style="width:100%; padding:12px 14px; background:#1f2937; border:1px solid #374151; border-radius:10px; color:#fff; font-size:0.95rem; box-sizing:border-box; outline:none;" />
            </div>

            <div id="fp-error-1" style="color:#f87171; background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.25); border-radius:8px; padding:10px 12px; font-size:0.8rem; margin-bottom:14px; display:none;"></div>

            <button type="submit" id="btn-fp-lookup" style="width:100%; padding:12px; background:rgba(99,102,241,0.2); border:1px solid rgba(99,102,241,0.4); border-radius:10px; color:#c7d2fe; font-weight:700; font-size:0.9rem; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px;">
              <span>Find Salon Account</span> &rarr;
            </button>
          </form>

          <!-- Revealed Verified Salon & Saved Email Card -->
          <div id="fp-salon-preview" style="display:none; margin-top:20px; padding:18px; background:rgba(30,41,59,0.7); border:1px solid rgba(52,211,153,0.3); border-radius:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
              <span style="font-size:0.72rem; color:#94a3b8; font-weight:700; text-transform:uppercase; letter-spacing:0.05em;">Salon Account Found</span>
              <span style="font-size:0.68rem; font-weight:700; background:rgba(16,185,129,0.2); color:#34d399; border:1px solid rgba(16,185,129,0.35); padding:2px 8px; border-radius:12px;">SAVED AT SALON CREATION</span>
            </div>
            
            <div style="font-size:1.05rem; font-weight:800; color:#fff; margin-bottom:4px;" id="fp-preview-salon-name">Salon Store</div>
            <div style="font-size:0.82rem; color:#94a3b8; margin-bottom:14px;">
              Saved Email: <strong id="fp-preview-saved-email" style="color:#34d399; font-size:0.92rem;">owner@domain.com</strong>
            </div>

            <div style="font-size:0.78rem; color:#cbd5e1; line-height:1.45; background:rgba(15,23,42,0.6); padding:10px 12px; border-radius:8px; margin-bottom:16px;">
              🔒 <strong>Security Policy:</strong> The 6-digit OTP will be dispatched strictly to this saved email address. No alternate email can be used.
            </div>

            <button type="button" id="btn-fp-send-otp" style="width:100%; padding:13px; background:linear-gradient(135deg, #10b981 0%, #059669 100%); border:none; border-radius:10px; color:#fff; font-weight:700; font-size:0.95rem; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 4px 14px rgba(16,185,129,0.35);">
              <span>Send 6-Digit OTP to Saved Email</span> &rarr;
            </button>
          </div>
        </div>

        <!-- STEP 2: Enter OTP & New Password -->
        <div id="fp-step-2" style="display:none;">
          <div style="text-align:center; margin-bottom:20px;">
            <div style="display:inline-flex; align-items:center; justify-content:center; width:52px; height:52px; border-radius:16px; background:rgba(16,185,129,0.2); border:1px solid rgba(16,185,129,0.35); font-size:24px; margin-bottom:12px;">🔐</div>
            <h3 style="margin:0 0 6px 0; font-size:1.3rem; font-weight:800; letter-spacing:-0.02em;">Enter Verification Code</h3>
            <p style="color:#94a3b8; font-size:0.85rem; margin:0; line-height:1.45;">
              Enter the 6-digit OTP sent to your salon's saved email: <strong id="fp-masked-email" style="color:#34d399;">your email</strong>.
            </p>
          </div>

          <form id="fp-form-2">
            <div style="margin-bottom:14px;">
              <label style="display:block; font-size:0.75rem; color:#94a3b8; margin-bottom:6px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em;">6-Digit OTP Code</label>
              <input type="text" id="fp-otp" placeholder="••••••" maxlength="6" inputmode="numeric" required style="width:100%; padding:12px 14px; background:#1f2937; border:1px solid #4f46e5; border-radius:10px; color:#fff; font-size:1.4rem; letter-spacing:0.35em; text-align:center; font-family:monospace; font-weight:800; box-sizing:border-box; outline:none;" />
            </div>

            <div style="margin-bottom:14px;">
              <label style="display:block; font-size:0.75rem; color:#94a3b8; margin-bottom:6px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em;">New Password (Min 8 Chars)</label>
              <input type="password" id="fp-new-password" placeholder="Enter new secure password" required minlength="8" style="width:100%; padding:12px 14px; background:#1f2937; border:1px solid #374151; border-radius:10px; color:#fff; font-size:0.95rem; box-sizing:border-box; outline:none;" />
            </div>

            <div style="margin-bottom:16px;">
              <label style="display:block; font-size:0.75rem; color:#94a3b8; margin-bottom:6px; font-weight:700; text-transform:uppercase; letter-spacing:0.05em;">Confirm New Password</label>
              <input type="password" id="fp-confirm-password" placeholder="Confirm new password" required minlength="8" style="width:100%; padding:12px 14px; background:#1f2937; border:1px solid #374151; border-radius:10px; color:#fff; font-size:0.95rem; box-sizing:border-box; outline:none;" />
            </div>

            <div id="fp-error-2" style="color:#f87171; background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.25); border-radius:8px; padding:10px 12px; font-size:0.8rem; margin-bottom:14px; display:none;"></div>

            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; font-size:0.8rem;">
              <span id="fp-timer-label" style="color:#94a3b8;">Resend code in <strong id="fp-timer-count" style="color:#e2e8f0;">60s</strong></span>
              <a href="#" id="fp-resend-link" style="color:#818cf8; text-decoration:none; font-weight:600; display:none;">Resend Code</a>
            </div>

            <button type="submit" id="btn-fp-submit-reset" style="width:100%; padding:13px; background:linear-gradient(135deg, #4f46e5 0%, #6366f1 100%); border:none; border-radius:10px; color:#fff; font-weight:700; font-size:0.95rem; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; box-shadow:0 4px 14px rgba(79,70,229,0.35);">
              <span>Reset Password & Log In</span>
            </button>

            <button type="button" id="btn-fp-back-step1" style="width:100%; margin-top:10px; padding:10px; background:transparent; border:none; color:#94a3b8; font-size:0.82rem; cursor:pointer;">
              &larr; Use a different mobile number
            </button>
          </form>
        </div>

        <!-- STEP 3: Success Confirmation -->
        <div id="fp-step-3" style="display:none; text-align:center; padding:12px 0;">
          <div style="display:inline-flex; align-items:center; justify-content:center; width:64px; height:64px; border-radius:50%; background:rgba(16,185,129,0.2); border:2px solid #10b981; font-size:32px; margin-bottom:16px; color:#34d399;">✓</div>
          <h3 style="margin:0 0 8px 0; font-size:1.35rem; font-weight:800; color:#fff;">Password Reset Successful!</h3>
          <p style="color:#94a3b8; font-size:0.88rem; line-height:1.5; margin:0 0 24px 0;">
            Your password has been securely updated. You can now log into your salon operations hub.
          </p>
          <button type="button" id="btn-fp-done" style="width:100%; padding:13px; background:#4f46e5; border:none; border-radius:10px; color:#fff; font-weight:700; font-size:0.95rem; cursor:pointer;">
            Back to Sign In
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    let activeMobile = (prefilledMobile || '').trim();
    let currentSavedEmail = '';
    let countdownInterval = null;

    const startCountdown = (duration = 5) => {
      let remaining = duration;
      const countEl = document.getElementById('fp-timer-count');
      const labelEl = document.getElementById('fp-timer-label');
      const resendLink = document.getElementById('fp-resend-link');
      if (!countEl || !labelEl || !resendLink) return;

      labelEl.style.display = 'inline';
      resendLink.style.display = 'none';
      countEl.textContent = `${remaining}s`;

      if (countdownInterval) clearInterval(countdownInterval);

      countdownInterval = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          clearInterval(countdownInterval);
          labelEl.style.display = 'none';
          resendLink.style.display = 'inline';
        } else {
          countEl.textContent = `${remaining}s`;
        }
      }, 1000);
    };

    const closeModal = () => {
      if (countdownInterval) clearInterval(countdownInterval);
      modal.remove();
    };

    document.getElementById('btn-close-fp-modal')?.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    const performLookup = async (mobileToLookup) => {
      const errEl = document.getElementById('fp-error-1');
      const lookupBtn = document.getElementById('btn-fp-lookup');
      const previewCard = document.getElementById('fp-salon-preview');
      const salonNameEl = document.getElementById('fp-preview-salon-name');
      const savedEmailEl = document.getElementById('fp-preview-saved-email');

      if (!mobileToLookup) return;
      if (errEl) errEl.style.display = 'none';
      if (lookupBtn) {
        lookupBtn.disabled = true;
        lookupBtn.innerHTML = '<span>Searching registered salon...</span>';
      }

      try {
        const res = await SalonAuth.lookupSalonForReset(mobileToLookup);
        activeMobile = mobileToLookup;
        currentSavedEmail = res.maskedEmail || '';

        if (salonNameEl) salonNameEl.textContent = res.salonName || 'Salon Store';
        if (savedEmailEl) savedEmailEl.textContent = res.maskedEmail || '';
        if (previewCard) previewCard.style.display = 'block';
      } catch (err) {
        if (errEl) {
          errEl.textContent = err.message || 'No registered salon found with this mobile number.';
          errEl.style.display = 'block';
        }
        if (previewCard) previewCard.style.display = 'none';
      } finally {
        if (lookupBtn) {
          lookupBtn.disabled = false;
          lookupBtn.innerHTML = '<span>Find Salon Account</span> &rarr;';
        }
      }
    };

    // Auto-trigger lookup if prefilledMobile has valid length (>= 10 digits)
    if (prefilledMobile && prefilledMobile.replace(/\D/g, '').length >= 10) {
      performLookup(prefilledMobile);
    }

    // Step 1 Form Handler (Lookup)
    document.getElementById('fp-form-lookup')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const mobileVal = (document.getElementById('fp-mobile')?.value || '').trim();
      await performLookup(mobileVal);
    });

    // Step 1 Trigger Send OTP to Saved Email
    document.getElementById('btn-fp-send-otp')?.addEventListener('click', async () => {
      const errEl = document.getElementById('fp-error-1');
      const sendBtn = document.getElementById('btn-fp-send-otp');
      if (!activeMobile) return;

      if (errEl) errEl.style.display = 'none';
      if (sendBtn) {
        sendBtn.disabled = true;
        sendBtn.innerHTML = '<span>Sending OTP to saved email...</span>';
      }

      try {
        const res = await SalonAuth.forgotPassword(activeMobile);
        document.getElementById('fp-step-1').style.display = 'none';
        document.getElementById('fp-step-2').style.display = 'block';
        const maskedEl = document.getElementById('fp-masked-email');
        if (maskedEl) maskedEl.textContent = res.maskedEmail || currentSavedEmail || 'your saved email';
        startCountdown(5);
        setTimeout(() => document.getElementById('fp-otp')?.focus(), 100);
      } catch (err) {
        if (errEl) {
          errEl.textContent = err.message || 'Could not send OTP to saved email. Please try again.';
          errEl.style.display = 'block';
        }
        if (sendBtn) {
          sendBtn.disabled = false;
          sendBtn.innerHTML = '<span>Send 6-Digit OTP to Saved Email</span> &rarr;';
        }
      }
    });

    // Resend Link Handler
    document.getElementById('fp-resend-link')?.addEventListener('click', async (e) => {
      e.preventDefault();
      const errEl = document.getElementById('fp-error-2');
      errEl.style.display = 'none';
      try {
        await SalonAuth.forgotPassword(activeMobile);
        startCountdown(5);
      } catch (err) {
        errEl.textContent = err.message || 'Could not resend code. Please wait.';
        errEl.style.display = 'block';
      }
    });

    // Back to Step 1 Button
    document.getElementById('btn-fp-back-step1')?.addEventListener('click', () => {
      document.getElementById('fp-step-2').style.display = 'none';
      document.getElementById('fp-step-1').style.display = 'block';
      const sendBtn = document.getElementById('btn-fp-send-otp');
      if (sendBtn) {
        sendBtn.disabled = false;
        sendBtn.innerHTML = '<span>Send 6-Digit OTP to Saved Email</span> &rarr;';
      }
    });

    // Step 2 Form Handler (Submit OTP + New Password)
    document.getElementById('fp-form-2')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const otp = (document.getElementById('fp-otp')?.value || '').trim();
      const newPassword = document.getElementById('fp-new-password')?.value;
      const confirmPassword = document.getElementById('fp-confirm-password')?.value;
      const errEl = document.getElementById('fp-error-2');
      const submitBtn = document.getElementById('btn-fp-submit-reset');

      errEl.style.display = 'none';

      if (newPassword !== confirmPassword) {
        errEl.textContent = 'New passwords do not match. Please verify.';
        errEl.style.display = 'block';
        return;
      }

      if (newPassword.length < 8) {
        errEl.textContent = 'Password must be at least 8 characters long.';
        errEl.style.display = 'block';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Verifying & Updating...</span>';

      try {
        await SalonAuth.resetPasswordWithOtp(activeMobile, otp, newPassword);
        document.getElementById('fp-step-2').style.display = 'none';
        document.getElementById('fp-step-3').style.display = 'block';

        // Pre-fill the login form
        const loginMobileInput = document.getElementById('salon-mobile');
        const loginPassInput = document.getElementById('salon-password');
        if (loginMobileInput && activeMobile) loginMobileInput.value = activeMobile;
        if (loginPassInput) loginPassInput.value = newPassword;
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Reset Password & Log In</span>';
        errEl.textContent = err.message || 'Invalid or expired code. Please try again.';
        errEl.style.display = 'block';
      }
    });

    // Step 3 Done Handler
    document.getElementById('btn-fp-done')?.addEventListener('click', () => {
      closeModal();
      document.getElementById('salon-password')?.focus();
    });
  }

  startKeepAlive() {
    // Ping backend every 3.5 minutes to keep cloud server warm while tab/PWA is active
    setInterval(() => {
      if (document.visibilityState === 'visible') {
        if (SalonAuth.getToken()) {
          ApiClient.getMe().catch(() => {});
        }
      }
    }, 210000);
  }

  async handleRoute() {
    const rawHash = (window.location.hash || '').replace(/^#\/?/, '') || 'admin';
    const appRoot = document.getElementById('app-root');

    // 1. PUBLIC REALM: Client Booking Route (e.g. #book/:slug or #booking/:slug)
    if (rawHash.startsWith('book/') || rawHash.startsWith('booking/')) {
      const slug = rawHash.split('/')[1] || 'luxury-salon';
      const wizard = new BookingWizard('app-root', slug);
      wizard.init();
      return;
    }

    // 2. PLATFORM REALM: Super Admin Platform
    if (rawHash === 'super-admin' || rawHash === 'superadmin-login') {
      if (rawHash === 'superadmin-login') {
        this.renderSuperAdminLogin(appRoot);
        return;
      }
      const platformUser = PlatformAuth.getUser();
      if (platformUser && (platformUser.role === 'SUPER_ADMIN' || platformUser.role === 'PLATFORM_ADMIN')) {
        const portal = new PlatformAdminPortal('app-root', platformUser);
        portal.init();
      } else {
        window.location.hash = '#superadmin-login';
        this.renderSuperAdminLogin(appRoot);
      }
      return;
    }

    // 3. SALON REALM: Salon Operations Dashboard
    if (rawHash === 'admin' || rawHash === 'login' || rawHash === 'salon-login') {
      if (rawHash === 'login' || rawHash === 'salon-login') {
        this.renderSalonOwnerLogin(appRoot);
        return;
      }
      const salonUser = SalonAuth.getUser();
      if (salonUser) {
        const dashboard = new SalonDashboard('app-root', salonUser);
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
                  ${Icons.phone ? Icons.phone({ size: 14, color: '#94a3b8' }) : Icons.user({ size: 14, color: '#94a3b8' })}
                  <span>Owner Mobile Number / WhatsApp</span>
                </label>
                <input type="tel" class="form-control" id="salon-mobile" placeholder="e.g. 98XXXXXX00" autocomplete="tel" required />
                <div style="font-size: 0.73rem; color: var(--text-muted); margin-top: 4px;">
                  Enter your WhatsApp registered 10-digit mobile number.
                </div>
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
                <div style="display: flex; justify-content: flex-end; margin-top: 6px;">
                  <a href="#" id="link-forgot-password" style="font-size: 0.78rem; color: #818cf8; text-decoration: none; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; transition: color 0.15s ease;">
                    <span>Forgot password?</span>
                  </a>
                </div>
              </div>

              <div id="salon-login-error" style="background: rgba(244,63,94,0.12); border: 1px solid rgba(244,63,94,0.3); border-radius: 10px; padding: 10px 14px; color: #fb7185; font-size: 0.82rem; font-weight: 600; margin-bottom: 16px; display: none;"></div>

              <button type="submit" class="btn btn-primary" style="width: 100%; padding: 13px; font-size: 0.95rem; font-weight: 700; gap: 10px;" id="btn-salon-submit">
                <span>Access Operations Hub</span>
                ${Icons.arrowRight({ size: 16 })}
              </button>
            </form>

            <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border-subtle); text-align: center; font-size: 0.76rem; color: var(--text-muted); display: flex; align-items: center; justify-content: center; gap: 6px;">
              ${Icons.lock({ size: 12, color: '#64748b' })}
              <span>End-to-End Encrypted Salon Operations</span>
            </div>
          </div>

        </div>
      </div>
    `;

    // Real-time numeric filtering for Salon Owner Mobile field (strip letters/symbols as user types)
    const mobileInput = document.getElementById('salon-mobile');
    mobileInput?.addEventListener('input', (e) => {
      let val = e.target.value;
      if (val.startsWith('+')) {
        val = '+' + val.slice(1).replace(/\D/g, '');
      } else {
        val = val.replace(/\D/g, '');
      }
      if (val.length > 13) val = val.slice(0, 13);
      e.target.value = val;
    });

    // Forgot Password Click Handler
    document.getElementById('link-forgot-password')?.addEventListener('click', (e) => {
      e.preventDefault();
      const currentInput = (document.getElementById('salon-mobile')?.value || '').trim();
      this.openForgotPasswordModal(currentInput);
    });

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
      const rawInput = (document.getElementById('salon-mobile').value || '').trim();
      const password = document.getElementById('salon-password').value;
      const errorDiv = document.getElementById('salon-login-error');
      const submitBtn = document.getElementById('btn-salon-submit');

      errorDiv.style.display = 'none';

      // Strict Mobile Number Validation (Digits only, 10 to 12 digits, no alphabets/symbols)
      const digitsOnly = rawInput.replace(/\D/g, '');
      const isValidMobileFormat = /^\+?[0-9]{10,12}$/.test(rawInput) && (digitsOnly.length >= 10 && digitsOnly.length <= 12);

      if (!isValidMobileFormat) {
        errorDiv.textContent = 'Please enter a valid 10-digit mobile number.';
        errorDiv.style.display = 'block';
        return;
      }

      if (!password) {
        errorDiv.textContent = 'Please enter your password.';
        errorDiv.style.display = 'block';
        return;
      }

      submitBtn.innerHTML = `<span>Authenticating Store...</span>`;
      submitBtn.setAttribute('disabled', 'true');

      // Inform user if cloud server is spinning up from cold sleep (>2.5s)
      const wakeUpTimer = setTimeout(() => {
        submitBtn.innerHTML = `<span>Waking up cloud server (~30s)...</span>`;
      }, 2500);

      try {
        const res = await SalonAuth.login(rawInput, password);
        clearTimeout(wakeUpTimer);
        window.location.hash = '#admin';
        this.handleRoute();
      } catch (err) {
        clearTimeout(wakeUpTimer);
        errorDiv.textContent = err.message || 'Login failed. Please check your credentials.';
        errorDiv.style.display = 'block';
        submitBtn.innerHTML = `<span>Access Operations Hub</span> ${Icons.arrowRight({ size: 16 })}`;
        submitBtn.removeAttribute('disabled');
      }
    });

    // Discreet Hotkey: Cmd/Ctrl + Shift + S allows platform administrators to switch directly to Master Portal
    if (!window.__superAdminHotkeyRegistered) {
      window.__superAdminHotkeyRegistered = true;
      window.addEventListener('keydown', (e) => {
        if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'S' || e.key === 's')) {
          e.preventDefault();
          window.location.hash = '#super-admin';
        }
      });
    }
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

            <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border-subtle); text-align: center; font-size: 0.76rem; color: var(--text-muted); display: flex; align-items: center; justify-content: center; gap: 6px;">
              ${Icons.shield({ size: 12, color: '#f59e0b' })}
              <span>Platform Security · Isolated Root Operations</span>
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

      const wakeUpTimer = setTimeout(() => {
        submitBtn.innerHTML = `<span>Waking up cloud server (~30s)...</span>`;
      }, 2500);

      try {
        const res = await PlatformAuth.login(email, password);
        clearTimeout(wakeUpTimer);
        window.location.hash = '#super-admin';
        this.handleRoute();
      } catch (err) {
        clearTimeout(wakeUpTimer);
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
