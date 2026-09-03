// PWA Service Worker Registration & In-App Install Prompt Controller

export class PwaManager {
  static init() {
    this.registerServiceWorker();
    // Intrusive install banners removed per user directive
    const existingBanner = document.getElementById('pwa-install-banner');
    if (existingBanner) existingBanner.remove();
    const existingIos = document.getElementById('pwa-ios-banner');
    if (existingIos) existingIos.remove();
  }

  static registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker
          .register('/sw.js')
          .then((reg) => {
            console.log('[PWA] Service Worker registered with scope:', reg.scope);
          })
          .catch((err) => {
            console.warn('[PWA] Service Worker registration failed:', err);
          });
      });
    }
  }

  static setupInstallPrompt() {
    // Disabled: users install via browser menu if desired
  }


  static showInstallBanner(onInstallClick) {
    if (document.getElementById('pwa-install-banner') || localStorage.getItem('pwa_prompt_dismissed')) {
      return;
    }

    const banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
    banner.className = 'pwa-banner';
    banner.innerHTML = `
      <div class="pwa-banner-content">
        <div class="pwa-banner-icon">📱</div>
        <div style="flex: 1;">
          <div style="font-weight: 700; font-size: 0.95rem; color: #fff;">Install SalonFlow App</div>
          <div style="font-size: 0.78rem; color: var(--text-secondary);">Fast 1-tap chair queue & offline access on your device.</div>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <button class="btn btn-primary btn-sm" id="btn-pwa-install" style="padding: 6px 14px; font-size: 0.8rem;">Install</button>
          <button class="close-btn" id="btn-pwa-dismiss" style="width: 28px; height: 28px; font-size: 1rem;">✕</button>
        </div>
      </div>
    `;

    document.body.appendChild(banner);

    document.getElementById('btn-pwa-install')?.addEventListener('click', () => {
      onInstallClick();
      banner.remove();
    });

    document.getElementById('btn-pwa-dismiss')?.addEventListener('click', () => {
      localStorage.setItem('pwa_prompt_dismissed', 'true');
      banner.remove();
    });
  }

  static showIOSPrompt() {
    if (document.getElementById('pwa-ios-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'pwa-ios-banner';
    banner.className = 'pwa-banner';
    banner.innerHTML = `
      <div class="pwa-banner-content">
        <div class="pwa-banner-icon">✂️</div>
        <div style="flex: 1;">
          <div style="font-weight: 700; font-size: 0.95rem; color: #fff;">Add SalonFlow to Home Screen</div>
          <div style="font-size: 0.78rem; color: var(--text-secondary);">Tap <strong>Share (⬆️)</strong> then select <strong>'Add to Home Screen'</strong> for the full native app experience.</div>
        </div>
        <button class="close-btn" id="btn-ios-pwa-dismiss" style="width: 28px; height: 28px; font-size: 1rem;">✕</button>
      </div>
    `;

    document.body.appendChild(banner);

    document.getElementById('btn-ios-pwa-dismiss')?.addEventListener('click', () => {
      localStorage.setItem('pwa_ios_dismissed', 'true');
      banner.remove();
    });
  }
}
