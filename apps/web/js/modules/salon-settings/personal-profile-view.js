import { ApiClient, SalonAuth } from '../../api.js';
import { UniversalLoader } from '../shared/universal-loader.js';

/**
 * PersonalProfileView
 * Minimal, modern, and compact settings view for Salon Information & Owner Credentials.
 * - Symmetrical 100% full-width segmented tab switcher
 * - Space-saving layout: Shop/Street, Landmark, City & PIN Code (2-column)
 * - 1-Click "Auto-fill GPS" in header (zero wasted vertical space)
 * - Full-width Save Changes button with ample bottom clearance
 */
export class PersonalProfileView {
  constructor(container, app) {
    this.container = container;
    this.app = app;
    this.profileData = null;
    this.activeTab = 'salon'; // 'salon' | 'owner'

    // Salon Information State
    this.salonName = '';
    this.salonStreet = '';
    this.salonLandmark = '';
    this.salonCity = '';
    this.salonPincode = '';
    this.latitude = null;
    this.longitude = null;
    this.googleMapsUrl = '';
    this.locationType = 'MANUAL';

    // Owner Information State
    this.ownerName = '';
    this.ownerPhone = '';
    this.ownerEmail = '';

    // GPS Status Tracking
    this.isLocating = false;
  }

  /**
   * Factory initializer.
   * @param {HTMLElement} container
   * @param {Object} app
   */
  static async init(container, app) {
    const view = new PersonalProfileView(container, app);
    await view.loadAndRender();
    return view;
  }

  /**
   * Loads profile data and parses address into clean street, landmark & pincode.
   */
  async loadAndRender() {
    this.renderLoading();
    try {
      this.profileData = await ApiClient.getPersonalProfile(true);
    } catch (err) {
      console.warn('[PersonalProfileView] Falling back to app state:', err);
      const salon = this.app?.salonProfile || {};
      const owner = this.app?.currentUser || SalonAuth.getUser() || {};
      this.profileData = { salon, owner };
    }

    const salon = this.profileData?.salon || {};
    const owner = this.profileData?.owner || {};

    this.salonName = salon.name || '';
    this.salonCity = salon.city || (salon.address ? salon.address.split(',')[0].trim() : 'Indore');

    // Extract PIN Code if present (6 digits)
    const rawAddress = salon.address || '';
    const pinMatch = rawAddress.match(/\b(\d{6})\b/);
    if (pinMatch) {
      this.salonPincode = pinMatch[1];
    } else {
      this.salonPincode = '';
    }

    // Clean address parts without raw pincode tag
    let cleanedAddr = rawAddress.replace(/\s*-\s*\d{6}\b/, '').replace(/\bPIN:\s*\d{6}\b/i, '').trim();
    if (cleanedAddr.includes(',')) {
      const parts = cleanedAddr.split(',').map((p) => p.trim()).filter(Boolean);
      this.salonStreet = parts[0] || '';
      this.salonLandmark = parts.slice(1).join(', ') || '';
    } else {
      this.salonStreet = cleanedAddr;
      this.salonLandmark = '';
    }

    this.latitude = typeof salon.latitude === 'number' && !isNaN(salon.latitude) ? salon.latitude : null;
    this.longitude = typeof salon.longitude === 'number' && !isNaN(salon.longitude) ? salon.longitude : null;
    this.googleMapsUrl = salon.googleMapsUrl || (this.hasCoordinates() ? `https://www.google.com/maps?q=${this.latitude},${this.longitude}` : '');
    this.locationType = salon.locationType || 'MANUAL';

    this.ownerName = owner.name || '';
    this.ownerPhone = owner.phone || salon.phone || '';
    this.ownerEmail = owner.email || '';

    this.render();
  }

  hasCoordinates() {
    return typeof this.latitude === 'number' && typeof this.longitude === 'number' && !isNaN(this.latitude) && !isNaN(this.longitude);
  }

  getDirectionsUrl() {
    if (this.hasCoordinates()) {
      return `https://www.google.com/maps/dir/?api=1&destination=${this.latitude},${this.longitude}`;
    }
    if (this.googleMapsUrl && this.googleMapsUrl.startsWith('http')) {
      return this.googleMapsUrl;
    }
    const fullAddr = [this.salonStreet, this.salonLandmark, this.salonCity, this.salonPincode].filter(Boolean).join(', ');
    return fullAddr ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fullAddr)}` : '';
  }

  /**
   * Loading skeleton.
   */
  renderLoading() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="stylist-routine-card" style="min-height: 260px; margin-bottom: 120px;">
        ${UniversalLoader.render({
          title: 'Loading profile details...',
          subtitle: 'Fetching salon settings & account credentials...',
          minHeight: '220px',
        })}
      </div>
    `;
  }

  /**
   * Main render method.
   */
  render() {
    if (!this.container) return;

    const hasCoords = this.hasCoordinates();
    const directionsUrl = this.getDirectionsUrl();

    this.container.innerHTML = `
      <div class="stylist-routine-card" style="margin-bottom: 120px; padding: 14px;">
        
        <!-- Symmetrical Full-Width Segmented Tab Switcher -->
        <div class="stylist-schedule-segmented-tabs" id="pp-tabs" style="width: 100%; display: flex; padding: 3px; gap: 4px; border-radius: 10px; background: rgba(0, 0, 0, 0.45); border: 1px solid rgba(255, 255, 255, 0.08); margin-bottom: 14px;">
          <button type="button" class="schedule-tab-btn ${this.activeTab === 'salon' ? 'active' : ''}" data-tab="salon" id="pp-tab-btn-salon" style="flex: 1; height: 38px; font-size: 0.84rem; font-weight: 700; border-radius: 7px; display: flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer;">
            <span>Salon Information</span>
          </button>
          <button type="button" class="schedule-tab-btn ${this.activeTab === 'owner' ? 'active' : ''}" data-tab="owner" id="pp-tab-btn-owner" style="flex: 1; height: 38px; font-size: 0.84rem; font-weight: 700; border-radius: 7px; display: flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer;">
            <span>Owner Information</span>
          </button>
        </div>

        <form id="form-personal-profile" onsubmit="return false;">
          <div id="pp-alert-box"></div>

          <!-- SECTION 1: SALON INFORMATION TAB -->
          <div id="pp-tab-content-salon" style="display: ${this.activeTab === 'salon' ? 'block' : 'none'};">
            <div class="stylist-roster-card" style="padding: 16px; display: flex; flex-direction: column; gap: 12px;">
              
              <!-- Header with Compact Inline GPS Auto-fill Button (Saves Vertical Space) -->
              <div class="stylist-roster-header" style="padding-bottom: 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); display: flex; align-items: center; justify-content: space-between;">
                <span class="stylist-roster-title" style="font-size: 0.85rem; font-weight: 700; color: #f8fafc;">Salon Brand & Address</span>
                <button type="button" id="pp-btn-gps-detect" class="btn btn-sm" style="font-size: 0.72rem; font-weight: 600; padding: 4px 10px; border-radius: 6px; background: rgba(139, 61, 255, 0.18); border: 1px solid rgba(139, 61, 255, 0.35); color: #c084fc; display: inline-flex; align-items: center; gap: 5px; cursor: pointer; transition: all 0.2s ease;">
                  <span>📍</span>
                  <span id="pp-gps-btn-text">${this.isLocating ? 'Locating...' : (hasCoords ? '✓ GPS Active' : 'Auto-detect GPS')}</span>
                </button>
              </div>

              <!-- Salon Brand Name -->
              <div class="form-group" style="margin-bottom: 0;">
                <label class="form-label" for="pp-salon-name" style="font-size: 0.74rem; font-weight: 700; color: #cbd5e1; margin-bottom: 4px; display: block; text-transform: uppercase; letter-spacing: 0.5px;">
                  Salon Brand Name *
                </label>
                <input type="text" class="form-control" id="pp-salon-name" value="${(this.salonName || '').replace(/"/g, '&quot;')}" placeholder="e.g. Developer Bazaar Salon" required style="height: 38px; border-radius: 8px; font-size: 0.86rem;" />
              </div>

              <!-- Shop / Building / Street -->
              <div class="form-group" style="margin-bottom: 0;">
                <label class="form-label" for="pp-salon-street" style="font-size: 0.74rem; font-weight: 700; color: #cbd5e1; margin-bottom: 4px; display: block; text-transform: uppercase; letter-spacing: 0.5px;">
                  Shop No / Building / Floor / Street *
                </label>
                <input type="text" class="form-control" id="pp-salon-street" value="${(this.salonStreet || '').replace(/"/g, '&quot;')}" placeholder="e.g. Shop 12, 1st Floor, Royal Arcade" required style="height: 38px; border-radius: 8px; font-size: 0.86rem;" />
              </div>

              <!-- Landmark / Area -->
              <div class="form-group" style="margin-bottom: 0;">
                <label class="form-label" for="pp-salon-landmark" style="font-size: 0.74rem; font-weight: 700; color: #cbd5e1; margin-bottom: 4px; display: block; text-transform: uppercase; letter-spacing: 0.5px;">
                  Landmark / Area
                </label>
                <input type="text" class="form-control" id="pp-salon-landmark" value="${(this.salonLandmark || '').replace(/"/g, '&quot;')}" placeholder="e.g. Near 56 Dukan, MG Road" style="height: 38px; border-radius: 8px; font-size: 0.86rem;" />
              </div>

              <!-- 2-Column: City & PIN Code -->
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div class="form-group" style="margin-bottom: 0;">
                  <label class="form-label" for="pp-salon-city" style="font-size: 0.74rem; font-weight: 700; color: #cbd5e1; margin-bottom: 4px; display: block; text-transform: uppercase; letter-spacing: 0.5px;">
                    City *
                  </label>
                  <input type="text" class="form-control" id="pp-salon-city" value="${(this.salonCity || '').replace(/"/g, '&quot;')}" placeholder="e.g. Indore" required style="height: 38px; border-radius: 8px; font-size: 0.86rem;" />
                </div>

                <div class="form-group" style="margin-bottom: 0;">
                  <label class="form-label" for="pp-salon-pincode" style="font-size: 0.74rem; font-weight: 700; color: #cbd5e1; margin-bottom: 4px; display: block; text-transform: uppercase; letter-spacing: 0.5px;">
                    PIN Code
                  </label>
                  <input type="text" class="form-control" id="pp-salon-pincode" value="${(this.salonPincode || '').replace(/"/g, '&quot;')}" placeholder="e.g. 452001" maxlength="6" pattern="[0-9]{6}" style="height: 38px; border-radius: 8px; font-size: 0.86rem;" />
                </div>
              </div>

              <!-- Minimal Google Maps Directions Link (if coordinates are locked) -->
              ${hasCoords ? `
                <div style="display: flex; align-items: center; justify-content: space-between; padding-top: 4px; font-size: 0.72rem;">
                  <span style="color: #34d399; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">
                    <span>✓</span> GPS Linked (${this.latitude.toFixed(4)}, ${this.longitude.toFixed(4)})
                  </span>
                  <a href="${directionsUrl}" target="_blank" rel="noopener noreferrer" style="color: #a5b4fc; text-decoration: none; font-weight: 600;">
                    Test Route on Maps ↗
                  </a>
                </div>
              ` : ''}

            </div>
          </div>

          <!-- SECTION 2: OWNER INFORMATION TAB -->
          <div id="pp-tab-content-owner" style="display: ${this.activeTab === 'owner' ? 'block' : 'none'};">
            <div class="stylist-roster-card" style="padding: 16px; display: flex; flex-direction: column; gap: 12px;">
              
              <!-- Header -->
              <div class="stylist-roster-header" style="padding-bottom: 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); display: flex; align-items: center; justify-content: space-between;">
                <span class="stylist-roster-title" style="font-size: 0.85rem; font-weight: 700; color: #f8fafc;">Owner Credentials</span>
                <span style="font-size: 0.7rem; color: #94a3b8;">Account & Access</span>
              </div>

              <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
                <div class="form-group" style="margin-bottom: 0;">
                  <label class="form-label" for="pp-owner-name" style="font-size: 0.74rem; font-weight: 700; color: #cbd5e1; margin-bottom: 4px; display: block; text-transform: uppercase; letter-spacing: 0.5px;">
                    Owner Full Name *
                  </label>
                  <input type="text" class="form-control" id="pp-owner-name" value="${(this.ownerName || '').replace(/"/g, '&quot;')}" placeholder="e.g. Trilok Shivhare" required style="height: 38px; border-radius: 8px; font-size: 0.86rem;" />
                </div>

                <div class="form-group" style="margin-bottom: 0;">
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <label class="form-label" for="pp-owner-phone" style="font-size: 0.74rem; font-weight: 700; color: #cbd5e1; margin-bottom: 0; text-transform: uppercase; letter-spacing: 0.5px;">
                      Registered Phone
                    </label>
                    <span style="font-size: 0.65rem; color: #34d399; font-weight: 600;">Verified Login</span>
                  </div>
                  <input type="tel" class="form-control" id="pp-owner-phone" value="${(this.ownerPhone || '').replace(/"/g, '&quot;')}" readonly disabled style="height: 38px; border-radius: 8px; font-size: 0.86rem; cursor: not-allowed; opacity: 0.75; background: rgba(0, 0, 0, 0.25);" />
                </div>
              </div>

              <div class="form-group" style="margin-bottom: 0;">
                <label class="form-label" for="pp-owner-email" style="font-size: 0.74rem; font-weight: 700; color: #cbd5e1; margin-bottom: 4px; display: block; text-transform: uppercase; letter-spacing: 0.5px;">
                  Recovery Email *
                </label>
                <input type="email" class="form-control" id="pp-owner-email" value="${(this.ownerEmail || '').replace(/"/g, '&quot;')}" placeholder="owner@gmail.com" required style="height: 38px; border-radius: 8px; font-size: 0.86rem;" />
              </div>

            </div>
          </div>

          <!-- Symmetrical Full-Width Save Changes Action Button -->
          <div style="margin-top: 16px; margin-bottom: 6px;">
            <button type="submit" class="btn btn-primary" id="btn-pp-save" style="width: 100%; min-height: 44px; height: 44px; font-weight: 700; font-size: 0.92rem; border-radius: 10px; background: linear-gradient(135deg, #8B3DFF 0%, #A855F7 100%); box-shadow: 0 4px 14px rgba(139, 61, 255, 0.35); display: flex; align-items: center; justify-content: center; gap: 8px; cursor: pointer; border: none; color: #ffffff;">
              <span>Save Changes</span>
            </button>
          </div>

        </form>
      </div>
    `;

    this.attachEvents();
  }

  /**
   * Attaches event handlers for tabs, GPS detection, and form saving.
   */
  attachEvents() {
    // 1. Tab Switching (Preserves in-memory input values)
    const salonTabBtn = document.getElementById('pp-tab-btn-salon');
    const ownerTabBtn = document.getElementById('pp-tab-btn-owner');
    const salonContent = document.getElementById('pp-tab-content-salon');
    const ownerContent = document.getElementById('pp-tab-content-owner');

    const switchTab = (tab) => {
      this.syncInputsToState();
      this.activeTab = tab;
      if (tab === 'salon') {
        salonTabBtn?.classList.add('active');
        ownerTabBtn?.classList.remove('active');
        if (salonContent) salonContent.style.display = 'block';
        if (ownerContent) ownerContent.style.display = 'none';
      } else {
        ownerTabBtn?.classList.add('active');
        salonTabBtn?.classList.remove('active');
        if (ownerContent) ownerContent.style.display = 'block';
        if (salonContent) salonContent.style.display = 'none';
      }
    };

    salonTabBtn?.addEventListener('click', () => switchTab('salon'));
    ownerTabBtn?.addEventListener('click', () => switchTab('owner'));

    // 2. Compact Inline GPS Detection
    document.getElementById('pp-btn-gps-detect')?.addEventListener('click', () => {
      this.detectCurrentLocation();
    });

    // 3. Form Submission
    const form = document.getElementById('form-personal-profile');
    if (form) {
      form.onsubmit = async (e) => {
        e.preventDefault();
        await this.saveProfile();
      };
    }
  }

  /**
   * Syncs DOM inputs into memory state before switching tabs or submitting.
   */
  syncInputsToState() {
    const sName = document.getElementById('pp-salon-name')?.value;
    const sStreet = document.getElementById('pp-salon-street')?.value;
    const sLandmark = document.getElementById('pp-salon-landmark')?.value;
    const sCity = document.getElementById('pp-salon-city')?.value;
    const sPin = document.getElementById('pp-salon-pincode')?.value;
    const oName = document.getElementById('pp-owner-name')?.value;
    const oEmail = document.getElementById('pp-owner-email')?.value;

    if (sName !== undefined) this.salonName = sName.trim();
    if (sStreet !== undefined) this.salonStreet = sStreet.trim();
    if (sLandmark !== undefined) this.salonLandmark = sLandmark.trim();
    if (sCity !== undefined) this.salonCity = sCity.trim();
    if (sPin !== undefined) this.salonPincode = sPin.trim();
    if (oName !== undefined) this.ownerName = oName.trim();
    if (oEmail !== undefined) this.ownerEmail = oEmail.trim();
  }

  /**
   * Helper to perform high-precision reverse geocoding (Colony, Street, Landmark, PIN).
   * Combines Photon (OSM Komoot) and Nominatim OpenStreetMap for Indian addresses.
   */
  async reverseGeocodeCoordinates(lat, lng) {
    let street = '';
    let landmark = '';
    let city = '';
    let pincode = '';

    // 1. High-precision Colony & Street via Photon
    try {
      const pRes = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}`);
      if (pRes.ok) {
        const pData = await pRes.json();
        const props = pData.features?.[0]?.properties || {};
        street = props.street || props.name || '';
        city = props.city || props.district || '';
        const areaParts = [props.county, props.district].filter(Boolean).filter((x) => x !== city);
        landmark = areaParts.join(', ');
        if (props.postcode && /^\d{6}$/.test(props.postcode.trim())) {
          pincode = props.postcode.trim();
        }
      }
    } catch (_) {}

    // 2. OpenStreetMap Nominatim for exact PIN code, Suburb and District details
    try {
      const nRes = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`,
        { headers: { 'User-Agent': 'Styleslot/1.0' } }
      );
      if (nRes.ok) {
        const nData = await nRes.json();
        const addr = nData.address || {};
        if (!pincode && addr.postcode && /^\d{6}$/.test(addr.postcode.trim())) {
          pincode = addr.postcode.trim();
        }
        if (!city && (addr.city || addr.town || addr.village)) {
          city = addr.city || addr.town || addr.village;
        }
        if (!street) {
          const sParts = [addr.road, addr.suburb || addr.neighbourhood].filter(Boolean);
          street = sParts.join(', ');
        }
        if (!landmark) {
          const lParts = [addr.suburb || addr.neighbourhood, addr.county || addr.city_district]
            .filter(Boolean)
            .filter((x) => x !== city);
          landmark = [...new Set(lParts)].join(', ');
        }
      }
    } catch (_) {}

    return { street, landmark, city, pincode };
  }

  /**
   * Auto-detects GPS coordinates with automatic multi-tier fallback:
   * Tier 1: Hardware satellite GPS (navigator.geolocation)
   * Tier 2: Network IP Geolocation (https://ipwho.is/)
   */
  async detectCurrentLocation() {
    const btnText = document.getElementById('pp-gps-btn-text');

    this.isLocating = true;
    if (btnText) btnText.textContent = 'Locating...';

    // Helper: Execute Tier 2 IP Geolocation fallback
    const runIpFallback = async (reasonMsg = '') => {
      try {
        const res = await fetch('https://ipwho.is/');
        if (res.ok) {
          const data = await res.json();
          if (data.success !== false && data.latitude && data.longitude) {
            this.latitude = Number(data.latitude);
            this.longitude = Number(data.longitude);
            this.googleMapsUrl = `https://www.google.com/maps?q=${this.latitude},${this.longitude}`;
            this.locationType = 'NETWORK_IP';

            const geo = await this.reverseGeocodeCoordinates(this.latitude, this.longitude);
            if (geo.street) this.salonStreet = geo.street;
            if (geo.landmark) this.salonLandmark = geo.landmark;
            this.salonCity = geo.city || data.city || this.salonCity || 'Indore';
            this.salonPincode = geo.pincode || (data.postal && /^\d{6}$/.test(data.postal.trim()) ? data.postal.trim() : this.salonPincode);

            this.isLocating = false;
            if (btnText) btnText.textContent = '✓ GPS Active';

            const successNote = reasonMsg
              ? `📍 ${this.salonCity} (${this.latitude.toFixed(4)}, ${this.longitude.toFixed(4)}) locked via network.`
              : `📍 Location detected: ${this.salonCity} (${this.latitude.toFixed(4)}, ${this.longitude.toFixed(4)})`;

            this.showAlert(successNote, 'success');
            if (this.app?.showToast) {
              this.app.showToast('Location coordinates detected and locked!', 'success');
            }
            this.render();
            return true;
          }
        }
      } catch (_) {}

      this.isLocating = false;
      if (btnText) btnText.textContent = 'Auto-detect GPS';
      this.showAlert(reasonMsg || 'Could not determine location. Please enter your address manually.', 'error');
      return false;
    };

    // If browser lacks geolocation API or page is in insecure non-HTTPS context
    if (!navigator.geolocation) {
      return runIpFallback('Geolocation API not supported.');
    }

    // Try Tier 1 Satellite / Device GPS first
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        this.latitude = lat;
        this.longitude = lng;
        this.googleMapsUrl = `https://www.google.com/maps?q=${lat},${lng}`;
        this.locationType = 'GPS';
        this.isLocating = false;

        // Perform deep reverse geocoding to resolve Colony, Road & Landmark
        const geo = await this.reverseGeocodeCoordinates(lat, lng);

        if (geo.street) this.salonStreet = geo.street;
        if (geo.landmark) this.salonLandmark = geo.landmark;
        if (geo.city) this.salonCity = geo.city;
        if (geo.pincode) this.salonPincode = geo.pincode;

        if (btnText) btnText.textContent = '✓ GPS Active';

        if (this.app?.showToast) {
          this.app.showToast('Current GPS coordinates & street address locked!', 'success');
        }

        this.render();
      },
      async (err) => {
        await runIpFallback('Browser GPS permission restricted. Location estimated via network.');
      },
      { timeout: 8000, enableHighAccuracy: true }
    );
  }

  /**
   * Shows user feedback alerts.
   */
  showAlert(message, type = 'error') {
    const alertBox = document.getElementById('pp-alert-box');
    if (!alertBox) return;

    const isSuccess = type === 'success';
    const bg = isSuccess ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)';
    const border = isSuccess ? 'rgba(16, 185, 129, 0.25)' : 'rgba(239, 68, 68, 0.25)';
    const color = isSuccess ? '#34d399' : '#f87171';
    const icon = isSuccess ? '✓' : '✕';

    alertBox.innerHTML = `
      <div style="background: ${bg}; border: 1px solid ${border}; color: ${color}; padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; font-size: 0.82rem; display: flex; align-items: center; gap: 8px;">
        <span>${icon}</span>
        <span>${message}</span>
      </div>
    `;

    if (isSuccess) {
      setTimeout(() => {
        if (alertBox) alertBox.innerHTML = '';
      }, 4000);
    }
  }

  /**
   * Submits updated profile data to the unified backend API.
   */
  async saveProfile() {
    this.syncInputsToState();
    const btnSave = document.getElementById('btn-pp-save');

    if (!this.salonName) {
      this.activeTab = 'salon';
      this.render();
      this.showAlert('Salon Brand Name is required.');
      return;
    }

    if (!this.salonStreet) {
      this.activeTab = 'salon';
      this.render();
      this.showAlert('Shop / Building / Street address is required.');
      return;
    }

    if (!this.ownerName || !this.ownerEmail) {
      this.activeTab = 'owner';
      this.render();
      this.showAlert('Owner Full Name and Recovery Email are required.');
      return;
    }

    const originalBtnHtml = btnSave ? btnSave.innerHTML : '';
    if (btnSave) {
      btnSave.disabled = true;
      btnSave.innerHTML = `
        <span class="spinner-border" style="width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.4); border-top-color: #fff; border-radius: 50%; animation: spin 0.8s linear infinite; display: inline-block;"></span>
        <span>Saving Changes...</span>
      `;
    }

    // Format combined address cleanly (Street + Landmark)
    const combinedAddress = [this.salonStreet, this.salonLandmark].filter(Boolean).join(', ');

    const payload = {
      owner: {
        name: this.ownerName,
        email: this.ownerEmail,
      },
      salon: {
        name: this.salonName,
        city: this.salonCity || 'Indore',
        address: combinedAddress,
        pincode: this.salonPincode || undefined,
        locationType: this.locationType,
      },
    };

    if (this.hasCoordinates()) {
      payload.salon.latitude = this.latitude;
      payload.salon.longitude = this.longitude;
      payload.salon.googleMapsUrl = this.googleMapsUrl || `https://www.google.com/maps?q=${this.latitude},${this.longitude}`;
    }

    try {
      const response = await ApiClient.updatePersonalProfile(payload);
      this.profileData = response;

      // Update app global references
      if (this.app) {
        if (response.salon) {
          this.app.salonProfile = { ...this.app.salonProfile, ...response.salon };
        }
        if (response.owner) {
          this.app.currentUser = { ...this.app.currentUser, ...response.owner };
          try {
            if (typeof SalonAuth.setUser === 'function') {
              SalonAuth.setUser({ ...(SalonAuth.getUser() || {}), ...response.owner });
            }
          } catch (authErr) {
            console.warn('[PersonalProfileView] Failed to persist user in SalonAuth:', authErr);
          }
        }
      }

      // Live update DOM header text
      document.querySelectorAll('.header-salon-name').forEach((el) => {
        el.textContent = this.salonName;
      });
      document.querySelectorAll('.settings-identity-name').forEach((el) => {
        el.textContent = this.ownerName;
      });
      document.querySelectorAll('.settings-identity-sub').forEach((el) => {
        el.textContent = `${this.salonName} · ${this.salonCity || 'Indore'}`;
      });

      this.showAlert('Profile and salon changes saved successfully!', 'success');
      if (this.app?.showToast) {
        this.app.showToast('Profile and salon changes saved successfully!', 'success');
      }
    } catch (err) {
      this.showAlert(err.message || 'Failed to update personal profile.', 'error');
      if (this.app?.showToast) {
        this.app.showToast(err.message || 'Failed to update personal profile.', 'error');
      }
    } finally {
      if (btnSave) {
        btnSave.disabled = false;
        btnSave.innerHTML = originalBtnHtml;
      }
    }
  }
}
