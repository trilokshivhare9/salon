/**
 * 📍 ZERO-COST 4-IN-1 SALON LOCATION & GOOGLE DIRECTIONS COMPONENT
 * 
 * Provides 4 unified capture modes with 100% free external services:
 * 1. Live GPS: 1-click browser geolocation + free reverse geocoding
 * 2. Search Landmark: City-scoped autocomplete powered by OpenStreetMap Nominatim with India countrycode lock
 * 3. Google Maps Link: Parses Google Maps share link, place URL, or coordinates
 * 4. Manual Entry: Standard text input fallback
 * 
 * Free Google Maps Turn-by-Turn Navigation preview button included.
 */

export class LocationPicker {
  constructor(containerId, options = {}) {
    this.container = typeof containerId === 'string' ? document.getElementById(containerId) : containerId;
    this.options = {
      defaultMode: 'search', // Default to search as requested by user
      initialData: {},
      getCity: null,
      onChange: () => {},
      hideHeader: false,
      hideCityInput: false,
      syncCityInputId: null,
      ...options,
    };

    this.activeMode = this.options.defaultMode || 'search';
    this.state = {
      address: this.options.initialData?.address || '',
      city: this.options.initialData?.city || '',
      state: this.options.initialData?.state || '',
      latitude: this.options.initialData?.latitude || null,
      longitude: this.options.initialData?.longitude || null,
      googleMapsUrl: this.options.initialData?.googleMapsUrl || '',
      locationType: this.options.initialData?.locationType || 'MANUAL',
      gpsStatus: null, // { type: 'success' | 'error' | 'loading', message: '' }
      isDetectingGps: false,
      searchQuery: '',
      searchResults: [],
      isSearching: false,
    };

    this.searchDebounceTimer = null;
    this.init();
  }

  init() {
    if (!this.container) return;
    this.render();
  }

  getActiveCity() {
    if (typeof this.options.getCity === 'function') {
      const c = this.options.getCity();
      if (c && typeof c === 'string' && c.trim()) return c.trim();
    }
    const provCity = document.getElementById('prov-city')?.value?.trim();
    if (provCity) return provCity;
    const locCity = document.getElementById('loc-city-input')?.value?.trim();
    if (locCity) return locCity;
    return (this.state.city || '').trim();
  }

  setMode(mode) {
    this.activeMode = mode;
    this.render();
  }

  getDirectionsUrl() {
    if (this.state.latitude && this.state.longitude) {
      return `https://www.google.com/maps/dir/?api=1&destination=${this.state.latitude},${this.state.longitude}`;
    }
    if (this.state.googleMapsUrl && this.state.googleMapsUrl.startsWith('http')) {
      return this.state.googleMapsUrl;
    }
    const q = [this.state.address, this.state.city || this.getActiveCity()].filter(Boolean).join(', ');
    if (q) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
    }
    return '';
  }

  getValue() {
    const activeCity = this.getActiveCity();
    return {
      address: this.state.address.trim(),
      city: (this.state.city || activeCity).trim(),
      state: this.state.state.trim(),
      latitude: this.state.latitude !== null && !isNaN(this.state.latitude) ? Number(this.state.latitude) : null,
      longitude: this.state.longitude !== null && !isNaN(this.state.longitude) ? Number(this.state.longitude) : null,
      googleMapsUrl: this.state.googleMapsUrl.trim() || null,
      locationType: this.state.locationType || 'MANUAL',
      directionsUrl: this.getDirectionsUrl(),
    };
  }

  setValue(data = {}) {
    this.state = {
      ...this.state,
      address: data.address || '',
      city: data.city || '',
      state: data.state || '',
      latitude: data.latitude !== undefined ? data.latitude : null,
      longitude: data.longitude !== undefined ? data.longitude : null,
      googleMapsUrl: data.googleMapsUrl || '',
      locationType: data.locationType || 'MANUAL',
    };
    this.render();
  }

  notifyChange() {
    if (this.options.syncCityInputId && this.state.city) {
      const syncEl = document.getElementById(this.options.syncCityInputId);
      if (syncEl && syncEl.value !== this.state.city) {
        syncEl.value = this.state.city;
      }
    }
    if (typeof this.options.onChange === 'function') {
      this.options.onChange(this.getValue());
    }
  }

  // =========================================================================
  // MODE 1: LIVE GPS + FREE CLIENT REVERSE GEOCODING
  // =========================================================================
  async detectLiveGps() {
    if (!navigator.geolocation) {
      this.state.gpsStatus = { type: 'error', message: 'Geolocation is not supported by your browser.' };
      this.render();
      return;
    }

    this.state.isDetectingGps = true;
    this.state.gpsStatus = { type: 'loading', message: '🛰️ Querying device GPS satellite coordinates...' };
    this.render();

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = Number(position.coords.latitude.toFixed(6));
        const lng = Number(position.coords.longitude.toFixed(6));
        const accuracy = Math.round(position.coords.accuracy);

        this.state.latitude = lat;
        this.state.longitude = lng;
        this.state.locationType = 'GPS';
        this.state.gpsStatus = {
          type: 'loading',
          message: `🛰️ GPS fixed (${lat}, ${lng} ±${accuracy}m). Fetching street address...`,
        };
        this.render();

        try {
          const res = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`
          );
          if (res.ok) {
            const geo = await res.json();
            const parts = [
              geo.locality || geo.principalSubdivisionCode || '',
              geo.localityInfo?.administrative?.[3]?.name || '',
              geo.localityInfo?.administrative?.[2]?.name || '',
            ].filter(Boolean);

            const street = parts.join(', ') || geo.locality || 'Shop Location';
            const city = geo.city || geo.principalSubdivision || 'City';
            const state = geo.principalSubdivision || '';

            if (!this.state.address || this.state.locationType === 'GPS') {
              this.state.address = street;
            }
            if (city) this.state.city = city;
            if (state) this.state.state = state;
          }
        } catch {
          // Keep coordinates intact on network error
        }

        this.state.isDetectingGps = false;
        this.state.gpsStatus = {
          type: 'success',
          message: `✅ GPS Locked: ${lat}, ${lng} (Accurate to ±${accuracy}m). Turn-by-turn route ready!`,
        };
        this.notifyChange();
        this.render();
      },
      (err) => {
        this.state.isDetectingGps = false;
        let errMsg = 'Could not access location.';
        if (err.code === 1) errMsg = 'Permission denied. Please allow location access or use Search/Manual mode.';
        else if (err.code === 2) errMsg = 'Position unavailable. Please try Search or Google Maps link.';
        else if (err.code === 3) errMsg = 'GPS request timed out. Please try again or use Search mode.';
        this.state.gpsStatus = { type: 'error', message: errMsg };
        this.render();
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  }

  // =========================================================================
  // MODE 2: CITY-SCOPED SEARCH AUTOCOMPLETE (OPENSTREETMAP NOMINATIM INDIA)
  // =========================================================================
  handleSearchInput(query) {
    this.state.searchQuery = query;
    clearTimeout(this.searchDebounceTimer);

    if (!query || query.trim().length < 2) {
      this.state.searchResults = [];
      this.state.isSearching = false;
      this.renderSearchResults();
      return;
    }

    this.state.isSearching = true;
    this.renderSearchResults();

    this.searchDebounceTimer = setTimeout(async () => {
      const activeCity = this.getActiveCity();
      const rawQ = query.trim();

      // Clean vehicle codes like mp09, mh12, dl01, etc.
      let cleaned = rawQ.replace(/\b(mp|mh|dl|ka|gj|hr|up|rj|ch|ap|ts|kl|tn|wb|br|pb)\s*0?\d+\b/gi, '').trim();
      if (!cleaned) cleaned = rawQ;

      // Build city-scoped search target
      const searchTarget = activeCity
        ? (cleaned.toLowerCase().includes(activeCity.toLowerCase()) ? `${cleaned}, India` : `${cleaned}, ${activeCity}, India`)
        : `${cleaned}, India`;

      try {
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchTarget)}&countrycodes=in&format=json&addressdetails=1&limit=6`;
        const res = await fetch(url, {
          headers: { 'User-Agent': 'SalonSaaS-Platform/1.0 (admin@salonsaas.com)' },
        });

        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list) && list.length > 0) {
            this.state.searchResults = list.map((item) => {
              const addr = item.address || {};
              const mainName = item.name || item.display_name.split(',')[0].trim();
              const locality = addr.suburb || addr.neighbourhood || addr.road || addr.quarter || '';
              const city = addr.city || addr.town || addr.municipality || activeCity || '';
              const state = addr.state || '';
              const postal = addr.postcode || '';

              const titleParts = [mainName, locality, city, state].filter(Boolean);
              const formattedTitle = [...new Set(titleParts)].join(', ');

              return {
                title: formattedTitle,
                mainName,
                city: city || activeCity,
                state,
                postal,
                latitude: parseFloat(item.lat),
                longitude: parseFloat(item.lon),
              };
            });
          } else {
            // Secondary fallback: query without city if no direct match
            if (activeCity) {
              const fallbackUrl = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cleaned + ', India')}&countrycodes=in&format=json&addressdetails=1&limit=4`;
              const fallbackRes = await fetch(fallbackUrl, {
                headers: { 'User-Agent': 'SalonSaaS-Platform/1.0 (admin@salonsaas.com)' },
              });
              if (fallbackRes.ok) {
                const fbList = await fallbackRes.json();
                if (Array.isArray(fbList) && fbList.length > 0) {
                  this.state.searchResults = fbList.map((item) => {
                    const addr = item.address || {};
                    const mainName = item.name || item.display_name.split(',')[0].trim();
                    const locality = addr.suburb || addr.neighbourhood || addr.road || '';
                    const city = addr.city || addr.town || activeCity || '';
                    const state = addr.state || '';
                    const titleParts = [mainName, locality, city, state].filter(Boolean);
                    return {
                      title: [...new Set(titleParts)].join(', '),
                      mainName,
                      city: city || activeCity,
                      state,
                      latitude: parseFloat(item.lat),
                      longitude: parseFloat(item.lon),
                    };
                  });
                } else {
                  this.state.searchResults = [];
                }
              }
            } else {
              this.state.searchResults = [];
            }
          }
        }
      } catch {
        this.state.searchResults = [];
      } finally {
        this.state.isSearching = false;
        this.renderSearchResults();
      }
    }, 300);
  }

  selectSearchResult(item) {
    this.state.address = item.title;
    if (item.city) this.state.city = item.city;
    if (item.state) this.state.state = item.state;
    this.state.latitude = item.latitude;
    this.state.longitude = item.longitude;
    this.state.locationType = 'SEARCH';
    this.state.searchResults = [];
    this.notifyChange();
    this.render();
  }

  selectCustomSearchFallback(customText) {
    const activeCity = this.getActiveCity();
    this.state.address = customText;
    if (activeCity) this.state.city = activeCity;
    this.state.latitude = null;
    this.state.longitude = null;
    this.state.locationType = 'SEARCH';
    this.state.searchResults = [];
    this.notifyChange();
    this.render();
  }

  // =========================================================================
  // MODE 3: GOOGLE MAPS SHARE LINK PARSER
  // =========================================================================
  handleMapsUrlChange(val) {
    const raw = (val || '').trim();
    this.state.googleMapsUrl = raw;
    this.state.locationType = 'MAPS_PIN';

    const coordRegex = /@(-?\d+\.\d+),(-?\d+\.\d+)|[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)|^(-?\d+\.\d+)[,\s]+(-?\d+\.\d+)$/;
    const match = raw.match(coordRegex);
    if (match) {
      const lat = parseFloat(match[1] || match[3] || match[5]);
      const lng = parseFloat(match[2] || match[4] || match[6]);
      if (!isNaN(lat) && !isNaN(lng)) {
        this.state.latitude = lat;
        this.state.longitude = lng;
      }
    }

    this.notifyChange();
    this.render();
  }

  // =========================================================================
  // RENDER & DOM BINDING
  // =========================================================================
  render() {
    const directionsUrl = this.getDirectionsUrl();
    const hasCoordinates = this.state.latitude && this.state.longitude;
    const activeCity = this.getActiveCity();
    const isCompact = !!this.options.hideHeader;

    this.container.innerHTML = `
      <div class="location-picker-card" style="${isCompact ? 'margin-bottom: 0;' : 'background: rgba(255,255,255,0.025); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 12px; margin-bottom: 12px;'}">
        
        ${!isCompact ? `
          <!-- Header & Mode Description (Only shown when not compact/embedded) -->
          <div style="margin-bottom: 10px;">
            <div style="font-weight: 700; font-size: 0.85rem; color: #fff; display: flex; align-items: center; gap: 6px;">
              <span>📍</span> Shop Address & GPS Navigation
            </div>
            <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 1px;">
              Powers free Google turn-by-turn navigation for clients.
            </div>
          </div>
        ` : ''}

        <!-- Mode Selector Tabs (4-Segment Responsive Grid: Never Overflows) -->
        <div class="loc-tab-grid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 9px; padding: 3px; margin-bottom: 8px;">
          <button type="button" class="loc-tab-btn ${this.activeMode === 'search' ? 'active' : ''}" data-mode="search" style="${this.getTabStyle('search')}">
            <span style="font-size: 0.8rem;">🔍</span>
            <span>Search</span>
          </button>
          <button type="button" class="loc-tab-btn ${this.activeMode === 'gps' ? 'active' : ''}" data-mode="gps" style="${this.getTabStyle('gps')}">
            <span style="font-size: 0.8rem;">📍</span>
            <span>Live GPS</span>
          </button>
          <button type="button" class="loc-tab-btn ${this.activeMode === 'maps_pin' ? 'active' : ''}" data-mode="maps_pin" style="${this.getTabStyle('maps_pin')}">
            <span style="font-size: 0.8rem;">🔗</span>
            <span>Maps Link</span>
          </button>
          <button type="button" class="loc-tab-btn ${this.activeMode === 'manual' ? 'active' : ''}" data-mode="manual" style="${this.getTabStyle('manual')}">
            <span style="font-size: 0.8rem;">✏️</span>
            <span>Manual</span>
          </button>
        </div>

        <!-- Mode 1: Search Autocomplete (City Scoped) -->
        <div id="loc-panel-search" style="display: ${this.activeMode === 'search' ? 'block' : 'none'}; position: relative; margin-bottom: 8px;">
          <div style="font-size: 0.72rem; color: #a5b4fc; margin-bottom: 5px; display: flex; align-items: center; justify-content: space-between; gap: 6px;">
            <span style="display: inline-flex; align-items: center; gap: 4px;">
              <span style="color: #A855F7;">🎯</span> Target City: <strong style="color: #f1f5f9;">${activeCity || 'India'}</strong>
            </span>
            <span style="font-size: 0.68rem; color: var(--text-muted);">Scoped search</span>
          </div>
          <div style="position: relative;">
            <input type="text" class="form-control" id="loc-search-input" value="${(this.state.searchQuery || '').replace(/"/g, '&quot;')}" placeholder="${activeCity ? `Search landmark, market, or mall in ${activeCity}...` : 'Type area, landmark, or market...'}" style="font-size: 0.82rem; padding-left: 32px; height: 38px;" autocomplete="off" />
            <span style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); font-size: 0.85rem; color: var(--text-muted); pointer-events: none;">🔍</span>
          </div>
          <div id="loc-search-dropdown" style="display: none; position: absolute; top: 100%; left: 0; right: 0; background: #182234; border: 1px solid rgba(139, 61, 255,0.4); border-radius: 8px; z-index: 999; margin-top: 4px; box-shadow: 0 10px 25px rgba(0,0,0,0.7); max-height: 240px; overflow-y: auto;"></div>
        </div>

        <!-- Mode 2: Live GPS -->
        <div id="loc-panel-gps" style="display: ${this.activeMode === 'gps' ? 'block' : 'none'}; margin-bottom: 8px;">
          <div style="background: rgba(16,185,129,0.06); border: 1px dashed rgba(16,185,129,0.3); border-radius: 8px; padding: 10px 12px; text-align: center;">
            <button type="button" id="btn-loc-detect-gps" class="btn" style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: #fff; font-size: 0.8rem; font-weight: 700; padding: 7px 16px; border-radius: 8px; border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; box-shadow: 0 4px 12px rgba(16,185,129,0.3);">
              ${this.state.isDetectingGps ? '⏳ Accessing Device Satellite GPS...' : '📍 Detect Live Shop GPS'}
            </button>
            <div style="font-size: 0.7rem; color: #a7f3d0; margin-top: 5px;">
              Tap while present at the salon to lock satellite precision coordinates.
            </div>
            ${this.renderGpsStatus()}
          </div>
        </div>

        <!-- Mode 3: Google Maps Link -->
        <div id="loc-panel-maps-pin" style="display: ${this.activeMode === 'maps_pin' ? 'block' : 'none'}; margin-bottom: 8px;">
          <input type="url" class="form-control" id="loc-maps-url-input" value="${(this.state.googleMapsUrl || '').replace(/"/g, '&quot;')}" placeholder="Paste Google Maps Share Link (e.g. https://maps.app.goo.gl/...)" style="font-size: 0.82rem; height: 38px;" />
          <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 4px;">
            Open Google Maps → Tap "Share" on your salon → Tap "Copy Link" and paste here.
          </div>
        </div>

        <!-- Unified Address & City Form Fields -->
        ${this.options.hideCityInput ? `
          <div style="margin-top: 6px;">
            <label style="font-size: 0.72rem; color: #94a3b8; display: block; margin-bottom: 4px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;">
              STORE ADDRESS / STREET / LANDMARK *
            </label>
            <input type="text" class="form-control" id="loc-address-input" value="${(this.state.address || '').replace(/"/g, '&quot;')}" placeholder="e.g. Shop 12, Main Market, Near Rajwada" style="font-size: 0.82rem; height: 38px;" />
          </div>
        ` : `
          <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 10px; margin-top: 6px;">
            <div>
              <label style="font-size: 0.72rem; color: #94a3b8; display: block; margin-bottom: 4px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;">
                SHOP ADDRESS / LANDMARK *
              </label>
              <input type="text" class="form-control" id="loc-address-input" value="${(this.state.address || '').replace(/"/g, '&quot;')}" placeholder="e.g. Shop 12, Main Market, Near Rajwada" style="font-size: 0.82rem; height: 38px;" />
            </div>
            <div>
              <label style="font-size: 0.72rem; color: #94a3b8; display: block; margin-bottom: 4px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;">
                CITY *
              </label>
              <input type="text" class="form-control" id="loc-city-input" value="${(this.state.city || activeCity || '').replace(/"/g, '&quot;')}" placeholder="e.g. Indore" style="font-size: 0.82rem; height: 38px;" />
            </div>
          </div>
        `}

        <!-- Live Google Directions Route Preview Chip -->
        ${directionsUrl ? `
          <div style="margin-top: 8px; padding: 7px 10px; background: rgba(139, 61, 255,0.08); border: 1px solid rgba(139, 61, 255,0.22); border-radius: 8px; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 6px; font-size: 0.74rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              <span>📍</span>
              <span style="color: #c7d2fe; font-weight: 600;">
                ${hasCoordinates ? `GPS Active (${this.state.latitude ? this.state.latitude.toFixed(4) : ''}, ${this.state.longitude ? this.state.longitude.toFixed(4) : ''})` : 'Search Navigation Active'}
              </span>
            </div>
            <a href="${directionsUrl}" target="_blank" rel="noopener noreferrer" style="font-size: 0.72rem; padding: 4px 10px; background: rgba(139, 61, 255,0.2); border: 1px solid rgba(139, 61, 255,0.38); color: #c7d2fe; text-decoration: none; border-radius: 6px; font-weight: 600; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0;">
              🗺️ Test Route ↗
            </a>
          </div>
        ` : ''}

      </div>
    `;

    this.attachEventListeners();
  }

  getTabStyle(mode) {
    const isActive = this.activeMode === mode;
    return `
      background: ${isActive ? 'rgba(139, 61, 255, 0.28)' : 'transparent'};
      color: ${isActive ? '#ffffff' : '#94a3b8'};
      border: ${isActive ? '1px solid rgba(139, 61, 255, 0.55)' : '1px solid transparent'};
      box-shadow: ${isActive ? '0 1px 4px rgba(0, 0, 0, 0.25)' : 'none'};
      font-size: 0.72rem;
      font-weight: ${isActive ? '700' : '600'};
      padding: 6px 2px;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      transition: all 0.15s ease;
      white-space: nowrap;
      min-width: 0;
      width: 100%;
    `;
  }

  renderGpsStatus() {
    if (!this.state.gpsStatus) return '';
    const isErr = this.state.gpsStatus.type === 'error';
    const isSuccess = this.state.gpsStatus.type === 'success';

    return `
      <div style="margin-top: 8px; font-size: 0.75rem; color: ${isErr ? '#f87171' : isSuccess ? '#34d399' : '#a5b4fc'}; font-weight: 500;">
        ${this.state.gpsStatus.message}
      </div>
    `;
  }

  renderSearchResults() {
    const drop = document.getElementById('loc-search-dropdown');
    if (!drop) return;

    const activeCity = this.getActiveCity();
    const query = (this.state.searchQuery || '').trim();

    if (this.state.isSearching) {
      drop.innerHTML = `
        <div style="padding: 12px; font-size: 0.78rem; color: var(--text-muted); text-align: center;">
          🔍 Searching ${activeCity ? `places in <strong>${activeCity}</strong>...` : 'places in India...'}
        </div>
      `;
      drop.style.display = 'block';
      return;
    }

    let itemsHtml = '';

    if (this.state.searchResults && this.state.searchResults.length > 0) {
      itemsHtml = this.state.searchResults
        .map(
          (item, idx) => `
          <div class="loc-search-item" data-idx="${idx}" style="padding: 10px 12px; font-size: 0.78rem; color: #fff; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.06); transition: background 0.1s ease;">
            <div style="font-weight: 600; color: #e2e8f0;">📍 ${item.title}</div>
            <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px;">
              ${item.city ? `City: <span style="color:#a5b4fc;">${item.city}</span>` : ''} 
              ${item.postal ? `• PIN: ${item.postal}` : ''}
              ${item.latitude ? `• GPS (${item.latitude.toFixed(4)}, ${item.longitude.toFixed(4)})` : ''}
            </div>
          </div>
        `
        )
        .join('');
    } else if (query.length >= 2) {
      itemsHtml = `
        <div style="padding: 10px 12px; font-size: 0.75rem; color: var(--text-muted); text-align: center;">
          No exact map pin indexed for "${query}" in ${activeCity || 'India'}.
        </div>
      `;
    }

    // Always include a 1-click fallback to use the typed query directly
    if (query.length >= 2) {
      itemsHtml += `
        <div id="btn-loc-custom-fallback" style="padding: 10px 14px; background: rgba(139, 61, 255,0.15); border-top: 1px solid rgba(139, 61, 255,0.3); cursor: pointer; display: flex; align-items: center; justify-content: space-between;">
          <div>
            <div style="font-weight: 700; color: #a5b4fc; font-size: 0.78rem;">✨ Use "${query}" as shop address</div>
            <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px;">City: ${activeCity || 'Selected City'} • Will generate Google Directions link</div>
          </div>
          <span style="font-size: 0.72rem; padding: 4px 8px; background: rgba(139, 61, 255,0.35); border-radius: 4px; color: #fff; font-weight: 600;">Select ↵</span>
        </div>
      `;
    }

    drop.innerHTML = itemsHtml;
    drop.style.display = itemsHtml ? 'block' : 'none';

    // Click handlers for search results
    drop.querySelectorAll('.loc-search-item').forEach((el) => {
      el.addEventListener('mouseenter', () => (el.style.background = 'rgba(139, 61, 255,0.2)'));
      el.addEventListener('mouseleave', () => (el.style.background = 'transparent'));
      el.addEventListener('click', () => {
        const idx = parseInt(el.getAttribute('data-idx'), 10);
        const item = this.state.searchResults[idx];
        if (item) this.selectSearchResult(item);
      });
    });

    // Click handler for custom fallback
    document.getElementById('btn-loc-custom-fallback')?.addEventListener('click', () => {
      this.selectCustomSearchFallback(query);
    });
  }

  attachEventListeners() {
    // Mode tabs
    this.container.querySelectorAll('.loc-tab-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const mode = btn.getAttribute('data-mode');
        if (mode) this.setMode(mode);
      });
    });

    // Mode 1: Search input
    const searchInput = document.getElementById('loc-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => this.handleSearchInput(e.target.value));
      searchInput.addEventListener('focus', () => {
        if (this.state.searchQuery && this.state.searchQuery.length >= 2) {
          this.renderSearchResults();
        }
      });
    }

    // Mode 2: GPS button
    const gpsBtn = document.getElementById('btn-loc-detect-gps');
    if (gpsBtn) {
      gpsBtn.addEventListener('click', () => this.detectLiveGps());
    }

    // Mode 3: Maps URL input
    const mapsInput = document.getElementById('loc-maps-url-input');
    if (mapsInput) {
      mapsInput.addEventListener('input', (e) => this.handleMapsUrlChange(e.target.value));
    }

    // Unified address input
    const addrInput = document.getElementById('loc-address-input');
    if (addrInput) {
      addrInput.addEventListener('input', (e) => {
        this.state.address = e.target.value;
        this.notifyChange();
      });
    }

    // Unified city input
    const cityInput = document.getElementById('loc-city-input');
    if (cityInput) {
      cityInput.addEventListener('input', (e) => {
        this.state.city = e.target.value;
        this.notifyChange();
      });
    }

    // Close search dropdown on click outside
    document.addEventListener('click', (e) => {
      const drop = document.getElementById('loc-search-dropdown');
      const searchBox = document.getElementById('loc-search-input');
      if (drop && searchBox && !drop.contains(e.target) && e.target !== searchBox) {
        drop.style.display = 'none';
      }
    });
  }
}
