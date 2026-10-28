import { ApiClient } from '../../api.js';
import { Icons } from '../../icons.js';

/**
 * PasswordSecurityView
 * Clean, minimal, and modern view for changing account password.
 * - Exactly 3 fields: Current Password, New Password, Confirm New Password.
 * - Interactive show/hide eye toggles.
 * - Subtle live strength meter & confirmation matcher.
 * - Zero developer jargon or fake security clutter.
 */
export class PasswordSecurityView {
  constructor(container, app) {
    this.container = container;
    this.app = app;
    this.isSubmitting = false;
  }

  /**
   * Factory mount initializer.
   * @param {HTMLElement} container
   * @param {Object} app
   */
  static init(container, app) {
    const view = new PasswordSecurityView(container, app);
    view.render();
    view.attachListeners();
    return view;
  }

  /**
   * Renders the minimal, 3-field password change card.
   */
  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div class="settings-panel-card password-security-card">
        <div class="settings-panel-header">
          <div class="settings-header-left">
            <div class="settings-header-icon" style="background: rgba(139, 92, 246, 0.15); color: #a855f7;">
              ${Icons.lock({ size: 20 })}
            </div>
            <div>
              <h3 class="settings-panel-title">Change Password</h3>
              <p class="settings-panel-subtitle">Update your account login password to keep your salon dashboard secure.</p>
            </div>
          </div>
        </div>

        <div id="pwd-alert-box" class="pwd-alert-container"></div>

        <form id="form-password-security" class="pwd-clean-form" onsubmit="return false;">
          <!-- 1. Current Password -->
          <div class="form-group">
            <label class="form-label" for="pwd-current">Current Password <span class="required-star">*</span></label>
            <div class="pwd-field-wrap">
              <input type="password" 
                     class="form-control pwd-input" 
                     id="pwd-current" 
                     placeholder="Enter your existing password" 
                     required 
                     autocomplete="current-password" />
              <button type="button" class="pwd-toggle-btn" data-target="pwd-current" title="Toggle visibility" tabindex="-1">
                ${Icons.eye({ size: 16 })}
              </button>
            </div>
          </div>

          <!-- 2. New Password -->
          <div class="form-group">
            <label class="form-label" for="pwd-new">New Password <span class="required-star">*</span></label>
            <div class="pwd-field-wrap">
              <input type="password" 
                     class="form-control pwd-input" 
                     id="pwd-new" 
                     placeholder="Create new password (min. 8 characters)" 
                     required 
                     autocomplete="new-password" />
              <button type="button" class="pwd-toggle-btn" data-target="pwd-new" title="Toggle visibility" tabindex="-1">
                ${Icons.eye({ size: 16 })}
              </button>
            </div>

            <!-- Sleek Live Strength Indicator -->
            <div class="pwd-strength-wrap" id="pwd-strength-wrap" style="display: none;">
              <div class="pwd-strength-bar-track">
                <div class="pwd-strength-bar-fill" id="pwd-strength-fill"></div>
              </div>
              <div class="pwd-strength-meta">
                <span class="pwd-strength-label" id="pwd-strength-label">Password strength</span>
                <span class="pwd-strength-hint">Min. 8 characters</span>
              </div>
            </div>
          </div>

          <!-- 3. Confirm New Password -->
          <div class="form-group">
            <label class="form-label" for="pwd-confirm">Confirm New Password <span class="required-star">*</span></label>
            <div class="pwd-field-wrap">
              <input type="password" 
                     class="form-control pwd-input" 
                     id="pwd-confirm" 
                     placeholder="Re-type your new password" 
                     required 
                     autocomplete="new-password" />
              <button type="button" class="pwd-toggle-btn" data-target="pwd-confirm" title="Toggle visibility" tabindex="-1">
                ${Icons.eye({ size: 16 })}
              </button>
            </div>
            <div class="pwd-match-hint" id="pwd-match-hint" style="display: none;"></div>
          </div>

          <!-- Submit Button -->
          <div class="pwd-submit-wrap">
            <button type="submit" class="btn-pwd-submit" id="btn-submit-password">
              <span>Update Password</span>
            </button>
          </div>
        </form>
      </div>
    `;
  }

  /**
   * Attaches event listeners for show/hide, strength calculation, and submission.
   */
  attachListeners() {
    if (!this.container) return;

    const form = this.container.querySelector('#form-password-security');
    if (!form) return;

    // 1. Password eye visibility toggles
    form.querySelectorAll('.pwd-toggle-btn').forEach((btn) => {
      btn.onclick = () => {
        const targetId = btn.getAttribute('data-target');
        const input = this.container.querySelector(`#${targetId}`);
        if (!input) return;

        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        btn.innerHTML = isPassword ? Icons.eyeOff({ size: 16 }) : Icons.eye({ size: 16 });
      };
    });

    // 2. Real-time strength meter for new password
    const newPwdInput = this.container.querySelector('#pwd-new');
    const strengthWrap = this.container.querySelector('#pwd-strength-wrap');
    const strengthFill = this.container.querySelector('#pwd-strength-fill');
    const strengthLabel = this.container.querySelector('#pwd-strength-label');

    const confirmPwdInput = this.container.querySelector('#pwd-confirm');
    const matchHint = this.container.querySelector('#pwd-match-hint');

    const updateMatchHint = () => {
      if (!confirmPwdInput || !matchHint) return;
      const newPass = newPwdInput ? newPwdInput.value : '';
      const confirmPass = confirmPwdInput.value;

      if (!confirmPass) {
        matchHint.style.display = 'none';
        matchHint.textContent = '';
        return;
      }

      matchHint.style.display = 'block';
      if (newPass === confirmPass) {
        matchHint.className = 'pwd-match-hint match';
        matchHint.textContent = '✓ Passwords match';
      } else {
        matchHint.className = 'pwd-match-hint mismatch';
        matchHint.textContent = '✕ Passwords do not match';
      }
    };

    if (newPwdInput) {
      newPwdInput.addEventListener('input', () => {
        const val = newPwdInput.value;

        if (!val) {
          if (strengthWrap) strengthWrap.style.display = 'none';
        } else {
          if (strengthWrap) strengthWrap.style.display = 'flex';
          const evalResult = this.evaluateStrength(val);

          if (strengthFill) {
            strengthFill.style.width = `${evalResult.score}%`;
            strengthFill.style.backgroundColor = evalResult.color;
          }
          if (strengthLabel) {
            strengthLabel.textContent = `Strength: ${evalResult.label}`;
            strengthLabel.style.color = evalResult.color;
          }
        }

        updateMatchHint();
      });
    }

    if (confirmPwdInput) {
      confirmPwdInput.addEventListener('input', updateMatchHint);
    }

    // 3. Form submit handler
    form.onsubmit = async (e) => {
      e.preventDefault();
      await this.handleSubmit();
    };
  }

  /**
   * Evaluates password strength based on length, mixed case, and digits/symbols.
   * @param {string} password
   */
  evaluateStrength(password) {
    if (!password) return { score: 0, label: 'Empty', color: '#64748b' };

    const hasLen = password.length >= 8;
    const hasLong = password.length >= 12;
    const hasMix = /[a-z]/.test(password) && /[A-Z]/.test(password);
    const hasDigit = /[0-9]/.test(password);
    const hasSymbol = /[^a-zA-Z0-9]/.test(password);

    let score = 0;
    if (hasLen) score += 25;
    if (hasLong) score += 15;
    if (hasMix) score += 30;
    if (hasDigit) score += 15;
    if (hasSymbol) score += 15;

    if (score < 40) {
      return { score: Math.max(score, 20), label: 'Weak', color: '#f43f5e' };
    } else if (score < 75) {
      return { score, label: 'Good', color: '#f59e0b' };
    } else {
      return { score: Math.min(score, 100), label: 'Strong', color: '#10b981' };
    }
  }

  /**
   * Handles form submission and calls the backend API.
   */
  async handleSubmit() {
    if (this.isSubmitting) return;

    const currentPwdInput = this.container.querySelector('#pwd-current');
    const newPwdInput = this.container.querySelector('#pwd-new');
    const confirmPwdInput = this.container.querySelector('#pwd-confirm');
    const submitBtn = this.container.querySelector('#btn-submit-password');

    const currentPassword = currentPwdInput?.value?.trim();
    const newPassword = newPwdInput?.value;
    const confirmPassword = confirmPwdInput?.value;

    this.clearAlert();

    // Client-side validations
    if (!currentPassword) {
      this.showAlert('Please enter your current password.', 'error');
      currentPwdInput?.focus();
      return;
    }

    if (!newPassword || newPassword.length < 8) {
      this.showAlert('New password must be at least 8 characters long.', 'error');
      newPwdInput?.focus();
      return;
    }

    if (newPassword !== confirmPassword) {
      this.showAlert('New passwords do not match. Please verify.', 'error');
      confirmPwdInput?.focus();
      return;
    }

    if (currentPassword === newPassword) {
      this.showAlert('New password cannot be the same as your current password.', 'error');
      newPwdInput?.focus();
      return;
    }

    // Set loading state
    this.isSubmitting = true;
    const originalBtnText = submitBtn ? submitBtn.innerHTML : 'Update Password';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = `
        <span class="spinner-border" style="width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color:#fff; border-radius:50%; animation: spin 0.8s linear infinite;"></span>
        <span>Updating Password...</span>
      `;
    }

    try {
      const res = await ApiClient.changePassword(currentPassword, newPassword);

      this.showAlert(res.message || 'Password changed successfully! Use your new password on your next login.', 'success');
      if (this.app?.showToast) {
        this.app.showToast('Password updated successfully!', 'success');
      }

      // Reset form
      const form = this.container.querySelector('#form-password-security');
      if (form) form.reset();

      const strengthWrap = this.container.querySelector('#pwd-strength-wrap');
      if (strengthWrap) strengthWrap.style.display = 'none';

      const matchHint = this.container.querySelector('#pwd-match-hint');
      if (matchHint) {
        matchHint.style.display = 'none';
        matchHint.textContent = '';
      }
    } catch (err) {
      console.error('[PasswordSecurityView] Error changing password:', err);
      const errMsg = err?.message || 'Failed to update password. Please check your current password and try again.';
      this.showAlert(errMsg, 'error');
    } finally {
      this.isSubmitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnText;
      }
    }
  }

  /**
   * Displays an inline message alert.
   * @param {string} message
   * @param {'success'|'error'} type
   */
  showAlert(message, type = 'error') {
    const box = this.container.querySelector('#pwd-alert-box');
    if (!box) return;

    const icon = type === 'success' ? '✓' : '✕';
    box.innerHTML = `
      <div class="pwd-alert-msg ${type}">
        <span>${icon}</span>
        <span>${message}</span>
      </div>
    `;
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /**
   * Clears the alert box.
   */
  clearAlert() {
    const box = this.container.querySelector('#pwd-alert-box');
    if (box) box.innerHTML = '';
  }
}
