import { ApiClient } from '../../api.js';

/**
 * ServicesAiScannerModal
 * Dedicated modular component for scanning salon menu cards/rate cards via Google Gemini Vision AI.
 * Supports native camera capture, gallery file picker, client-side canvas optimization,
 * and an interactive editable review modal before bulk-importing into the salon catalog.
 */
export class ServicesAiScannerModal {
  constructor(app) {
    this.app = app;
    this.extractedServices = [];
    this.collapsedCategories = new Set();
    this.modalEl = null;
    this.cameraInput = null;
    this.galleryInput = null;
    this.existingCategories = [];
    this.isScanning = false;
    this.isImporting = false;
  }

  /**
   * Initializes hidden file inputs and binds triggers
   */
  init() {
    this.ensureInputsExist();
  }

  ensureInputsExist() {
    let container = document.getElementById('ai-scanner-hidden-inputs');
    if (!container) {
      container = document.createElement('div');
      container.id = 'ai-scanner-hidden-inputs';
      container.style.display = 'none';

      // 1. Camera input with environment capture
      this.cameraInput = document.createElement('input');
      this.cameraInput.type = 'file';
      this.cameraInput.accept = 'image/*';
      this.cameraInput.capture = 'environment';
      this.cameraInput.addEventListener('change', (e) => this.handleFileSelected(e));

      // 2. Gallery input
      this.galleryInput = document.createElement('input');
      this.galleryInput.type = 'file';
      this.galleryInput.accept = 'image/png,image/jpeg,image/webp,image/heic,image/jpg';
      this.galleryInput.addEventListener('change', (e) => this.handleFileSelected(e));

      container.appendChild(this.cameraInput);
      container.appendChild(this.galleryInput);
      document.body.appendChild(container);
    }
  }

  /**
   * Opens the capture options sheet (Camera vs Gallery)
   */
  openCapturePrompt() {
    this.ensureInputsExist();

    // Remove any existing prompt
    const existing = document.getElementById('ai-scan-action-sheet');
    if (existing) existing.remove();

    const sheet = document.createElement('div');
    sheet.id = 'ai-scan-action-sheet';
    sheet.className = 'ai-scan-sheet-overlay';
    sheet.innerHTML = `
      <div class="ai-scan-sheet-backdrop"></div>
      <div class="ai-scan-sheet-card animate-slide-up">
        <div class="ai-scan-sheet-handle"></div>
        <div class="ai-scan-sheet-header">
          <div class="ai-scan-header-icon">📸</div>
          <div>
            <h3 class="ai-scan-sheet-title">Scan Salon Rate Card</h3>
            <p class="ai-scan-sheet-desc">Use AI to automatically extract services, categories & prices</p>
          </div>
        </div>
        
        <div class="ai-scan-sheet-actions">
          <button type="button" class="ai-scan-action-btn btn-camera" id="btn-ai-take-photo">
            <span class="action-icon">📷</span>
            <div class="action-details">
              <strong>Take Photo with Camera</strong>
              <span>Snap a clear picture of your physical menu card</span>
            </div>
            <span class="action-arrow">→</span>
          </button>

          <button type="button" class="ai-scan-action-btn btn-gallery" id="btn-ai-choose-gallery">
            <span class="action-icon">🖼️</span>
            <div class="action-details">
              <strong>Choose from Gallery or Files</strong>
              <span>Select an existing photo, rate card, or screenshot</span>
            </div>
            <span class="action-arrow">→</span>
          </button>
        </div>

        <button type="button" class="btn-cancel-sheet" id="btn-ai-cancel-sheet">Cancel</button>
      </div>
    `;

    document.body.appendChild(sheet);

    // Event listeners
    const closeSheet = () => sheet.remove();

    sheet.querySelector('.ai-scan-sheet-backdrop').addEventListener('click', closeSheet);
    sheet.querySelector('#btn-ai-cancel-sheet').addEventListener('click', closeSheet);

    sheet.querySelector('#btn-ai-take-photo').addEventListener('click', () => {
      closeSheet();
      this.cameraInput.value = '';
      this.cameraInput.click();
    });

    sheet.querySelector('#btn-ai-choose-gallery').addEventListener('click', () => {
      closeSheet();
      this.galleryInput.value = '';
      this.galleryInput.click();
    });
  }

  /**
   * Handles user-selected image, resizes on canvas, and sends to AI
   */
  async handleFileSelected(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      this.showScanningLoader();
      const base64Data = await this.resizeAndCompressImage(file, 1600, 0.85);

      const response = await ApiClient.scanMenuCardWithAi(base64Data, 'image/jpeg');

      this.hideScanningLoader();

      if (!response || !response.success || !response.services || response.services.length === 0) {
        this.app?.showToast?.('No clear salon services found on this image. Please try a clearer, brighter photo.', 'warning');
        return;
      }

      this.extractedServices = response.services.map((item, idx) => ({
        ...item,
        name: (item.name || '').trim(),
        category: (item.category || 'General').trim() || 'General',
        price: Math.max(0, parseInt(item.price, 10) || 0),
        durationMinutes: Math.max(30, Math.round((parseInt(item.durationMinutes, 10) || 30) / 15) * 15),
        targetGender: item.targetGender || 'UNISEX',
        description: (item.description || '').trim() || this.generateDefaultDescription(item.name, item.category, item.targetGender),
        tempId: `item_${Date.now()}_${idx}`,
        selected: true,
        isEditing: false,
      }));

      this.collapsedCategories = new Set();
      this.renamingCategory = null;

      // Cache existing categories for quick selection
      this.existingCategories = (this.app?.categories || []).map((c) => c.name || c);

      this.showReviewDialog();
    } catch (err) {
      this.hideScanningLoader();
      console.error('Error scanning menu card:', err);
      this.app?.showToast?.(err.message || 'Failed to scan image. Please try again.', 'error');
    }
  }

  /**
   * Resizes image to max dimension while preserving aspect ratio, returns base64
   */
  resizeAndCompressImage(file, maxDimension = 1600, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          const compressed = canvas.toDataURL('image/jpeg', quality);
          resolve(compressed);
        };
        img.onerror = () => reject(new Error('Failed to load image file.'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('Failed to read file.'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Displays full-screen scanning animation
   */
  showScanningLoader() {
    this.isScanning = true;
    let loader = document.getElementById('ai-scan-scanning-overlay');
    if (!loader) {
      loader = document.createElement('div');
      loader.id = 'ai-scan-scanning-overlay';
      loader.className = 'ai-scanning-overlay';
      loader.innerHTML = `
        <div class="ai-scanning-backdrop"></div>
        <div class="ai-scanning-card">
          <div class="ai-scanning-laser-box">
            <span class="ai-scan-icon">📋</span>
            <div class="ai-scan-laser-line"></div>
          </div>
          <h3 class="ai-scanning-title">Scanning Rate Card...</h3>
          <p class="ai-scanning-sub">Gemini Vision AI is analyzing services, durations & prices</p>
          <div class="ai-scan-dots-row">
            <span class="scan-dot"></span>
            <span class="scan-dot"></span>
            <span class="scan-dot"></span>
          </div>
        </div>
      `;
      document.body.appendChild(loader);
    }
  }

  hideScanningLoader() {
    this.isScanning = false;
    const loader = document.getElementById('ai-scan-scanning-overlay');
    if (loader) loader.remove();
  }

  /**
   * Renders the interactive Review & Edit modal
   */
  /**
   * Groups extracted services by category name
   */
  groupServicesByCategory() {
    const caseMap = new Map();
    for (const item of this.extractedServices) {
      const rawCat = (item.category || 'General').trim() || 'General';
      const key = rawCat.toLowerCase();
      if (!caseMap.has(key)) {
        caseMap.set(key, { name: rawCat, items: [] });
      }
      caseMap.get(key).items.push(item);
    }
    const groups = new Map();
    for (const { name, items } of caseMap.values()) {
      groups.set(name, items);
    }
    return groups;
  }

  /**
   * Returns all unique category names detected by AI or stored in app (deduplicated)
   */
  getAllAvailableCategories() {
    const seen = new Map();
    if (Array.isArray(this.extractedServices)) {
      this.extractedServices.forEach((s) => {
        const cat = (s.category || '').trim();
        if (cat && !seen.has(cat.toLowerCase())) {
          seen.set(cat.toLowerCase(), cat);
        }
      });
    }
    if (Array.isArray(this.existingCategories)) {
      this.existingCategories.forEach((c) => {
        const name = (typeof c === 'string' ? c : c?.name || '').trim();
        if (name && !seen.has(name.toLowerCase())) {
          seen.set(name.toLowerCase(), name);
        }
      });
    }
    if (seen.size === 0) {
      ['Hair Styling', 'Hair Coloring', 'Beard & Shave', 'Facial & Skin', 'General'].forEach((c) => {
        seen.set(c.toLowerCase(), c);
      });
    }
    return Array.from(seen.values());
  }

  getGenderLabel(gender) {
    switch (gender) {
      case 'FEMALE': return '👩 Women';
      case 'MALE': return '👤 Men';
      case 'KIDS': return '👶 Kids';
      case 'UNISEX':
      default: return '👥 Unisex';
    }
  }

  escapeHtml(str) {
    if (!str && str !== 0) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Generates a smart, appealing 1-sentence salon service description if not detected.
   */
  generateDefaultDescription(name, category, gender) {
    const lowerName = (name || '').toLowerCase();
    const lowerCat = (category || '').toLowerCase();

    if (lowerName.includes('haircut') || lowerName.includes('cut')) {
      if (gender === 'FEMALE') return 'Professional wash, precision haircut, and custom styled blow-dry finish.';
      if (gender === 'MALE') return 'Precision scissors and clipper cut tailored to your style with a clean finish.';
      if (gender === 'KIDS') return 'Gentle, kid-friendly haircut with quick styling and fun care.';
      return 'Expert precision haircut with consultation and professional styling finish.';
    }
    if (lowerName.includes('shave') || lowerName.includes('beard') || lowerName.includes('trim')) {
      return 'Hot towel prep, precision beard shaping, and soothing aftershave care.';
    }
    if (lowerName.includes('color') || lowerName.includes('highlight') || lowerName.includes('foil')) {
      return 'Custom professional hair coloring with vibrant gloss and conditioning care.';
    }
    if (lowerName.includes('facial') || lowerName.includes('clean') || lowerCat.includes('skin')) {
      return 'Deep pore cleansing, gentle exfoliation, and rejuvenating hydration facial.';
    }
    if (lowerName.includes('straight') || lowerName.includes('perm') || lowerName.includes('relaxer') || lowerName.includes('smoothen')) {
      return 'Professional texturizing treatment for sleek, smooth, and long-lasting results.';
    }
    if (lowerName.includes('spa') || lowerName.includes('massage')) {
      return 'Relaxing therapeutic treatment designed to rejuvenate and relieve stress.';
    }
    if (lowerName.includes('wax') || lowerName.includes('thread')) {
      return 'Smooth and precise hair removal treatment with soothing skin calm lotion.';
    }
    if (lowerName.includes('manicure') || lowerName.includes('pedicure') || lowerName.includes('nail')) {
      return 'Nail shaping, cuticle care, scrub, massage, and professional polish finish.';
    }
    return `Professional ${name || 'salon'} service customized to your preferences with salon-grade care.`;
  }

  /**
   * Renders the interactive Review & Edit modal
   */
  showReviewDialog() {
    // Ensure every single service has a non-empty, professional description
    this.extractedServices.forEach((s) => {
      if (!s.description || !s.description.trim()) {
        s.description = this.generateDefaultDescription(s.name, s.category, s.targetGender);
      }
    });

    const existing = document.getElementById('ai-scan-review-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'ai-scan-review-modal';
    modal.className = 'ai-review-modal-overlay';

    modal.innerHTML = `
      <div class="ai-review-backdrop"></div>
      <div class="ai-review-container animate-scale-in">
        <!-- Header -->
        <div class="ai-review-header">
          <div class="ai-review-title-group">
            <div class="ai-title-row">
              <span class="ai-badge-chip">✨ AI EXTRACTED</span>
            </div>
            <h2>Review Services</h2>
            <p>Verify detected services or tweak pricing before adding to menu.</p>
          </div>
          <button type="button" class="btn-ai-modal-close" id="btn-close-ai-review" aria-label="Close modal">✕</button>
        </div>

        <!-- Toolbar -->
        <div class="ai-review-toolbar">
          <label class="ai-select-all-label">
            <input type="checkbox" id="ai-chk-select-all" checked>
            <span>All (<strong id="ai-selected-tally">${this.extractedServices.length}</strong>/${this.extractedServices.length})</span>
          </label>

          <div class="ai-toolbar-actions">
            <button type="button" class="btn-ai-toggle-all-cats" id="btn-toggle-all-cats">
              <span class="toggle-icon">⌃</span>
              <span class="toggle-text">Collapse All</span>
            </button>
          </div>
        </div>

        <!-- Scrollable Services Table / List -->
        <div class="ai-review-list" id="ai-review-list-items">
          ${this.renderReviewItemsHtml()}
        </div>

        <!-- Footer -->
        <div class="ai-review-footer">
          <button type="button" class="btn-ai-discard" id="btn-discard-ai-review">Discard</button>
          <button type="button" class="btn-ai-confirm-import" id="btn-confirm-ai-import">
            <span class="import-sparkle">✨</span> Import <span id="ai-import-count">${this.extractedServices.length}</span> Services
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    this.modalEl = modal;

    this.attachReviewEvents();
    this.updateTally();
  }

  /**
   * Helper to return clean gender chip HTML matching the reference design
   */
  getGenderChipHtml(gender) {
    const g = (gender || 'UNISEX').toUpperCase();
    if (g === 'FEMALE') {
      return `<span class="gender-icon female">♀</span> Women`;
    }
    if (g === 'MALE') {
      return `<span class="gender-icon male">♂</span> Men`;
    }
    if (g === 'KIDS') {
      return `<span class="gender-icon kids">👶</span> Kids`;
    }
    return `<span class="gender-icon unisex">👥</span> Unisex`;
  }

  /**
   * Helper to return category icon matching the reference design
   */
  getCategoryIcon(categoryName) {
    const cat = (categoryName || '').toLowerCase();
    if (cat.includes('color') || cat.includes('dye') || cat.includes('tint') || cat.includes('highlight') || cat.includes('foil')) {
      return `🧴`;
    }
    if (cat.includes('beard') || cat.includes('shave')) {
      return `🪒`;
    }
    if (cat.includes('face') || cat.includes('skin') || cat.includes('facial')) {
      return `✨`;
    }
    if (cat.includes('nail') || cat.includes('pedi') || cat.includes('mani')) {
      return `💅`;
    }
    if (cat.includes('wax') || cat.includes('thread')) {
      return `🍯`;
    }
    if (cat.includes('massage') || cat.includes('spa')) {
      return `💆`;
    }
    return `✂️`;
  }

  /**
   * Renders grouped categories and their clean service info cards
   */
  renderReviewItemsHtml() {
    if (!this.extractedServices || this.extractedServices.length === 0) {
      return `
        <div class="ai-empty-review text-center" style="padding: 44px 20px; color: #94a3b8;">
          <div style="font-size: 2.2rem; margin-bottom: 10px;">📋</div>
          <h4 style="color: #fff; margin-bottom: 6px; font-weight: 700; font-size: 1.05rem;">No services detected</h4>
          <p style="font-size: 0.85rem; margin: 0; color: #64748b;">Please scan a rate card image to review services.</p>
        </div>
      `;
    }

    const categoriesMap = this.groupServicesByCategory();
    let html = '';

    for (const [categoryName, services] of categoriesMap.entries()) {
      const isCollapsed = this.collapsedCategories.has(categoryName);
      const isRenaming = this.renamingCategory === categoryName;
      const catSelectedCount = services.filter((s) => s.selected).length;
      const allSelected = catSelectedCount === services.length && services.length > 0;
      const isPartial = catSelectedCount > 0 && catSelectedCount < services.length;

      html += `
        <div class="ai-category-group" data-category="${this.escapeHtml(categoryName)}">
          ${isRenaming ? `
            <div class="ai-category-header is-renaming" data-category="${this.escapeHtml(categoryName)}">
              <div class="ai-cat-icon-box">
                <span>${this.getCategoryIcon(categoryName)}</span>
              </div>
              <div class="ai-cat-rename-input-wrap">
                <input type="text" class="ai-input-cat-rename" value="${this.escapeHtml(categoryName)}" data-old-category="${this.escapeHtml(categoryName)}" placeholder="Category title..." maxlength="50" autofocus />
              </div>
              <div class="ai-cat-rename-btns">
                <button type="button" class="btn-ai-cat-rename-cancel" data-old-category="${this.escapeHtml(categoryName)}" title="Cancel (Esc)">✕</button>
                <button type="button" class="btn-ai-cat-rename-save" data-old-category="${this.escapeHtml(categoryName)}" title="Save (Enter)">✓</button>
              </div>
            </div>
          ` : `
            <div class="ai-category-header" data-category="${this.escapeHtml(categoryName)}">
              <div class="ai-category-header-left">
                <svg class="ai-cat-chevron ${isCollapsed ? 'is-collapsed' : ''}" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
                <div class="ai-cat-icon-box">
                  <span>${this.getCategoryIcon(categoryName)}</span>
                </div>
                <span class="ai-cat-title" title="Click pencil or double-click to rename">${this.escapeHtml(categoryName)}</span>
                <span class="ai-cat-count-num">(${services.length})</span>
                <button type="button" class="btn-ai-cat-rename" data-category="${this.escapeHtml(categoryName)}" title="Rename category" aria-label="Rename category">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                  </svg>
                </button>
              </div>

              <div class="ai-category-header-right">
                <span class="ai-cat-tally-pill"><strong class="cat-sel-count">${catSelectedCount}</strong>/${services.length}</span>
                <input type="checkbox" class="ai-cat-chk" data-category="${this.escapeHtml(categoryName)}" ${allSelected ? 'checked' : ''} ${isPartial ? 'data-indeterminate="true"' : ''}>
              </div>
            </div>
          `}

          <div class="ai-category-services-body ${isCollapsed ? 'is-collapsed' : ''}" data-category-body="${this.escapeHtml(categoryName)}">
            ${services.map((item) => this.renderServiceCardHtml(item)).join('')}
          </div>
        </div>
      `;
    }

    return html;
  }

  /**
   * Renders an individual service as a card matching the pixel-perfect reference image
   */
  renderServiceCardHtml(item) {
    const durationOptions = [15, 30, 45, 60, 75, 90, 105, 120, 150, 180];
    const genderOptions = [
      { val: 'UNISEX', label: '👥 Unisex' },
      { val: 'FEMALE', label: '👩 Women' },
      { val: 'MALE', label: '👤 Men' },
      { val: 'KIDS', label: '👶 Kids' },
    ];

    if (item.isEditing) {
      // All AI-detected & available categories for dropdown
      const availableCategories = this.getAllAvailableCategories();
      const currentCat = (item.category || 'General').trim() || 'General';
      if (!availableCategories.some((c) => c.toLowerCase() === currentCat.toLowerCase())) {
        availableCategories.unshift(currentCat);
      }

      // ACTIVE INLINE EDIT FORM
      return `
        <div class="ai-service-card is-editing" data-temp-id="${item.tempId}">
          <div class="ai-edit-inline-panel">
            <div class="ai-edit-top-row">
              <span class="ai-edit-label">✏️ Edit Service: <strong>${this.escapeHtml(item.name || 'New Service')}</strong></span>
              <button type="button" class="btn-ai-card-cancel-x" data-temp-id="${item.tempId}" title="Cancel editing">✕</button>
            </div>

            <div class="ai-edit-fields-grid">
              <!-- 1. Service Name -->
              <div class="ai-field-group field-full">
                <label>Service Name</label>
                <input type="text" class="ai-input ai-input-name" data-temp-id="${item.tempId}" value="${this.escapeHtml(item.name || '')}" placeholder="e.g. Women's Haircut">
              </div>

              <!-- 2. Custom Luxury Category Dropdown -->
              <div class="ai-field-group field-full">
                <label>Category</label>
                <div class="ai-cat-dropdown-wrap" data-temp-id="${item.tempId}">
                  <input type="hidden" class="ai-category-field-val" data-temp-id="${item.tempId}" value="${this.escapeHtml(currentCat)}" />
                  
                  <div class="ai-cat-dropdown-trigger" data-temp-id="${item.tempId}" tabindex="0">
                    <div class="ai-cat-trigger-content">
                      <span class="ai-cat-trigger-icon">${this.getCategoryIcon(currentCat)}</span>
                      <span class="ai-cat-trigger-text">${this.escapeHtml(currentCat)}</span>
                    </div>
                    <span class="ai-cat-trigger-arrow">▾</span>
                  </div>

                  <div class="ai-cat-dropdown-menu" data-temp-id="${item.tempId}" style="display: none;">
                    <div class="ai-cat-options-scroll">
                      ${availableCategories.map((c) => {
                        const isSelected = c.toLowerCase() === currentCat.toLowerCase();
                        return `
                          <div class="ai-cat-opt ${isSelected ? 'is-selected' : ''}" data-value="${this.escapeHtml(c)}" data-temp-id="${item.tempId}">
                            <span class="ai-cat-opt-icon">${this.getCategoryIcon(c)}</span>
                            <span class="ai-cat-opt-name">${this.escapeHtml(c)}</span>
                            ${isSelected ? '<span class="ai-cat-opt-check">✓</span>' : ''}
                          </div>
                        `;
                      }).join('')}
                    </div>
                    <div class="ai-cat-dropdown-divider"></div>
                    <div class="ai-cat-opt opt-new-cat" data-value="__NEW__" data-temp-id="${item.tempId}">
                      <span class="ai-cat-opt-icon">✨</span>
                      <span class="ai-cat-opt-name">+ Create New Category...</span>
                    </div>
                  </div>

                  <input type="text" class="ai-input ai-input-new-category" data-temp-id="${item.tempId}" placeholder="Enter new category title..." style="display: none; margin-top: 6px;">
                </div>
              </div>

              <!-- 3. Audience -->
              <div class="ai-field-group">
                <label>Audience</label>
                <select class="ai-input ai-select-gender" data-temp-id="${item.tempId}">
                  ${genderOptions.map((g) => `
                    <option value="${g.val}" ${item.targetGender === g.val ? 'selected' : ''}>${g.label}</option>
                  `).join('')}
                </select>
              </div>

              <!-- 4. Duration -->
              <div class="ai-field-group">
                <label>Duration</label>
                <select class="ai-input ai-select-duration" data-temp-id="${item.tempId}">
                  ${durationOptions.map((d) => `
                    <option value="${d}" ${item.durationMinutes === d ? 'selected' : ''}>${d}m</option>
                  `).join('')}
                </select>
              </div>

              <!-- 5. Price -->
              <div class="ai-field-group field-full">
                <label>Price (₹)</label>
                <div class="ai-price-input-wrap">
                  <span class="ai-currency-symbol">₹</span>
                  <input type="number" class="ai-input ai-input-price" data-temp-id="${item.tempId}" value="${item.price || 0}" min="0" step="10">
                </div>
              </div>

              <!-- 6. Service Description -->
              <div class="ai-field-group field-full">
                <label>Description (Optional)</label>
                <textarea class="ai-input ai-input-desc" data-temp-id="${item.tempId}" rows="2" placeholder="Add service description, benefits, or details...">${this.escapeHtml(item.description || '')}</textarea>
              </div>
            </div>

            <div class="ai-edit-actions-row">
              <button type="button" class="btn-ai-edit-cancel" data-temp-id="${item.tempId}">Cancel</button>
              <button type="button" class="btn-ai-edit-save" data-temp-id="${item.tempId}">✓ Done</button>
            </div>
          </div>
        </div>
      `;
    }

    // PIXEL-PERFECT SERVICE CARD (Full available width of card with expandable description)
    const hasDesc = Boolean(item.description && item.description.trim().length > 0);
    const isLongDesc = hasDesc && item.description.trim().length > 30;

    return `
      <div class="ai-service-card ${item.selected ? 'is-selected' : 'is-unselected'}" data-temp-id="${item.tempId}">
        <div class="ai-card-top-row">
          <div class="ai-card-col-chk">
            <input type="checkbox" class="ai-item-chk" data-temp-id="${item.tempId}" ${item.selected ? 'checked' : ''} aria-label="Select ${this.escapeHtml(item.name)}">
          </div>

          <div class="ai-card-main-content">
            <div class="ai-card-service-name">${this.escapeHtml(item.name || 'Untitled Service')}</div>
            <div class="ai-card-meta-row">
              <span class="ai-meta-chip">
                ${this.getGenderChipHtml(item.targetGender)}
              </span>
              <span class="meta-dot">·</span>
              <span class="ai-meta-duration"><span class="clock-icon">🕒</span> ${item.durationMinutes || 30}m</span>
            </div>
          </div>

          <div class="ai-card-right">
            <span class="ai-card-price">₹${item.price || 0}</span>
            <button type="button" class="btn-ai-service-edit" data-temp-id="${item.tempId}" title="Edit service">Edit</button>
            <button type="button" class="btn-ai-service-delete" data-temp-id="${item.tempId}" title="Remove service">✕</button>
          </div>
        </div>

        ${hasDesc ? `
          <div class="ai-card-desc-wrap" data-temp-id="${item.tempId}">
            <div class="ai-card-desc-text ${item._expandedDesc ? 'is-expanded' : 'is-clamped'}">${this.escapeHtml(item.description.trim())}</div>
            ${isLongDesc ? `
              <button type="button" class="btn-ai-desc-more" data-temp-id="${item.tempId}">
                ${item._expandedDesc ? 'Show less' : 'Show more'}
              </button>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  /**
   * Refreshes the scrollable review list HTML in place
   */
  refreshReviewList() {
    const listContainer = this.modalEl?.querySelector('#ai-review-list-items');
    if (listContainer) {
      listContainer.innerHTML = this.renderReviewItemsHtml();
      this.updateTally();
    }
  }

  /**
   * Attaches event delegation for review modal interactions
   */
  attachReviewEvents() {
    if (!this.modalEl) return;

    const modal = this.modalEl;
    const closeModal = () => modal.remove();

    modal.querySelector('.ai-review-backdrop').addEventListener('click', closeModal);
    modal.querySelector('#btn-close-ai-review').addEventListener('click', closeModal);
    modal.querySelector('#btn-discard-ai-review').addEventListener('click', closeModal);

    // 1. Overall Select All Toggle
    const selectAllChk = modal.querySelector('#ai-chk-select-all');
    selectAllChk?.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      this.extractedServices.forEach((s) => (s.selected = isChecked));
      modal.querySelectorAll('.ai-item-chk').forEach((chk) => (chk.checked = isChecked));
      modal.querySelectorAll('.ai-cat-chk').forEach((chk) => {
        chk.checked = isChecked;
        chk.indeterminate = false;
      });
      modal.querySelectorAll('.ai-service-row, .ai-service-card').forEach((card) => {
        card.classList.toggle('is-selected', isChecked);
        card.classList.toggle('is-unselected', !isChecked);
      });
      this.updateTally();
    });

    // 2. Category Select-All Checkbox
    modal.addEventListener('change', (e) => {
      if (e.target.classList.contains('ai-cat-chk')) {
        const cat = e.target.getAttribute('data-category');
        const isChecked = e.target.checked;
        this.extractedServices
          .filter((s) => ((s.category || 'General').trim() || 'General') === cat)
          .forEach((s) => (s.selected = isChecked));

        const catGroup = e.target.closest('.ai-category-group');
        if (catGroup) {
          catGroup.querySelectorAll('.ai-item-chk').forEach((chk) => (chk.checked = isChecked));
          catGroup.querySelectorAll('.ai-service-row, .ai-service-card').forEach((card) => {
            card.classList.toggle('is-selected', isChecked);
            card.classList.toggle('is-unselected', !isChecked);
          });
        }
        this.updateTally();
      }
    });

    // 3. Individual Service Checkbox
    modal.addEventListener('change', (e) => {
      if (e.target.classList.contains('ai-item-chk')) {
        const tempId = e.target.getAttribute('data-temp-id');
        const item = this.extractedServices.find((s) => s.tempId === tempId);
        if (item) {
          item.selected = e.target.checked;
          const card = e.target.closest('.ai-service-row, .ai-service-card');
          card?.classList.toggle('is-selected', e.target.checked);
          card?.classList.toggle('is-unselected', !e.target.checked);
          this.updateTally();
        }
      }
    });

    // Custom Category Dropdown Trigger Toggle
    modal.addEventListener('click', (e) => {
      const trigger = e.target.closest('.ai-cat-dropdown-trigger');
      if (trigger) {
        e.stopPropagation();
        const wrap = trigger.closest('.ai-cat-dropdown-wrap');
        const menu = wrap?.querySelector('.ai-cat-dropdown-menu');
        const wasOpen = menu && menu.style.display !== 'none';

        // Close any other open dropdowns first
        modal.querySelectorAll('.ai-cat-dropdown-menu').forEach((m) => (m.style.display = 'none'));
        modal.querySelectorAll('.ai-cat-dropdown-trigger').forEach((t) => t.classList.remove('is-active'));

        if (!wasOpen && menu) {
          menu.style.display = 'block';
          trigger.classList.add('is-active');
        }
        return;
      }

      // Option Selected in Custom Category Dropdown
      const opt = e.target.closest('.ai-cat-opt');
      if (opt) {
        e.stopPropagation();
        const wrap = opt.closest('.ai-cat-dropdown-wrap');
        if (!wrap) return;

        const val = opt.getAttribute('data-value');
        const hiddenVal = wrap.querySelector('.ai-category-field-val');
        const triggerText = wrap.querySelector('.ai-cat-trigger-text');
        const triggerIcon = wrap.querySelector('.ai-cat-trigger-icon');
        const menu = wrap.querySelector('.ai-cat-dropdown-menu');
        const triggerBtn = wrap.querySelector('.ai-cat-dropdown-trigger');
        const newInput = wrap.querySelector('.ai-input-new-category');

        if (val === '__NEW__') {
          if (hiddenVal) hiddenVal.value = '__NEW__';
          if (triggerText) triggerText.textContent = '+ Create New Category...';
          if (triggerIcon) triggerIcon.textContent = '✨';
          if (newInput) {
            newInput.style.display = 'block';
            newInput.focus();
          }
        } else {
          if (hiddenVal) hiddenVal.value = val;
          if (triggerText) triggerText.textContent = val;
          if (triggerIcon) triggerIcon.textContent = this.getCategoryIcon(val);
          if (newInput) newInput.style.display = 'none';
        }

        wrap.querySelectorAll('.ai-cat-opt').forEach((o) => {
          const isCurrent = o.getAttribute('data-value') === val;
          o.classList.toggle('is-selected', isCurrent);
          let check = o.querySelector('.ai-cat-opt-check');
          if (isCurrent && !check && val !== '__NEW__') {
            const chkSpan = document.createElement('span');
            chkSpan.className = 'ai-cat-opt-check';
            chkSpan.textContent = '✓';
            o.appendChild(chkSpan);
          } else if (!isCurrent && check) {
            check.remove();
          }
        });

        if (menu) menu.style.display = 'none';
        if (triggerBtn) triggerBtn.classList.remove('is-active');
        return;
      }

      // Close dropdowns when clicking outside
      if (!e.target.closest('.ai-cat-dropdown-wrap')) {
        modal.querySelectorAll('.ai-cat-dropdown-menu').forEach((m) => (m.style.display = 'none'));
        modal.querySelectorAll('.ai-cat-dropdown-trigger').forEach((t) => t.classList.remove('is-active'));
      }
    });

    // Helper to commit category rename across all services in that category
    const saveCategoryRename = (oldCat) => {
      const input = modal.querySelector(`.ai-input-cat-rename[data-old-category="${oldCat}"]`);
      const newCat = (input?.value || '').trim();
      if (!newCat) {
        this.app?.showToast?.('Category title cannot be empty', 'warning');
        input?.focus();
        return;
      }

      if (newCat.toLowerCase() !== oldCat.toLowerCase()) {
        // Update all services that belong to this category
        this.extractedServices.forEach((s) => {
          const sCat = ((s.category || 'General').trim() || 'General');
          if (sCat.toLowerCase() === oldCat.toLowerCase()) {
            s.category = newCat;
          }
        });

        // Update collapsed categories state
        if (this.collapsedCategories.has(oldCat)) {
          this.collapsedCategories.delete(oldCat);
          this.collapsedCategories.add(newCat);
        }

        // Update existingCategories cache
        if (Array.isArray(this.existingCategories)) {
          const idx = this.existingCategories.findIndex((c) => (c || '').toLowerCase() === oldCat.toLowerCase());
          if (idx !== -1) {
            this.existingCategories[idx] = newCat;
          } else {
            this.existingCategories.push(newCat);
          }
        }

        this.app?.showToast?.(`Category renamed to "${newCat}"`, 'success');
      }

      this.renamingCategory = null;
      this.refreshReviewList();
    };

    // Category Rename Trigger Click / Save / Cancel / Outside Click
    modal.addEventListener('click', (e) => {
      const renameBtn = e.target.closest('.btn-ai-cat-rename');
      if (renameBtn) {
        e.stopPropagation();
        const cat = renameBtn.getAttribute('data-category');
        this.renamingCategory = cat;
        this.refreshReviewList();
        const input = modal.querySelector(`.ai-input-cat-rename[data-old-category="${cat}"]`);
        if (input) {
          input.focus();
          input.select();
        }
        return;
      }

      const saveCatBtn = e.target.closest('.btn-ai-cat-rename-save');
      if (saveCatBtn) {
        e.stopPropagation();
        const oldCat = saveCatBtn.getAttribute('data-old-category');
        saveCategoryRename(oldCat);
        return;
      }

      const cancelCatBtn = e.target.closest('.btn-ai-cat-rename-cancel');
      if (cancelCatBtn) {
        e.stopPropagation();
        this.renamingCategory = null;
        this.refreshReviewList();
        return;
      }

      // If user clicks outside category rename form, cancel rename
      if (this.renamingCategory && !e.target.closest('.ai-category-header.is-renaming, .btn-ai-cat-rename')) {
        this.renamingCategory = null;
        this.refreshReviewList();
      }
    });

    // Double-click category title to trigger rename
    modal.addEventListener('dblclick', (e) => {
      const titleEl = e.target.closest('.ai-cat-title');
      if (titleEl) {
        const header = titleEl.closest('.ai-category-header');
        const cat = header?.getAttribute('data-category');
        if (cat) {
          this.renamingCategory = cat;
          this.refreshReviewList();
          const input = modal.querySelector(`.ai-input-cat-rename[data-old-category="${cat}"]`);
          if (input) {
            input.focus();
            input.select();
          }
        }
      }
    });

    // Enter / Escape in category rename input
    modal.addEventListener('keydown', (e) => {
      if (e.target.classList.contains('ai-input-cat-rename')) {
        if (e.key === 'Enter') {
          e.preventDefault();
          const oldCat = e.target.getAttribute('data-old-category');
          saveCategoryRename(oldCat);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.renamingCategory = null;
          this.refreshReviewList();
        }
      }
    });

    // 4. Category Collapsible Header Click
    modal.addEventListener('click', (e) => {
      const header = e.target.closest('.ai-category-header');
      if (!header) return;

      // Do not collapse if header is in rename mode or clicked on controls
      if (header.classList.contains('is-renaming')) return;
      if (e.target.closest('.ai-cat-select-label, .ai-cat-chk, .ai-cat-tally-pill, .btn-ai-cat-rename, .ai-cat-rename-btns, .ai-input-cat-rename')) return;

      const cat = header.getAttribute('data-category');
      if (!cat) return;

      if (this.collapsedCategories.has(cat)) {
        this.collapsedCategories.delete(cat);
      } else {
        this.collapsedCategories.add(cat);
      }

      const isNowCollapsed = this.collapsedCategories.has(cat);
      const catGroup = header.closest('.ai-category-group');
      const body = catGroup?.querySelector('.ai-category-services-body');
      const chevron = header.querySelector('.ai-cat-chevron');
      const collapseBtn = header.querySelector('.btn-ai-cat-collapse');

      body?.classList.toggle('is-collapsed', isNowCollapsed);
      chevron?.classList.toggle('is-collapsed', isNowCollapsed);
      collapseBtn?.classList.toggle('is-collapsed', isNowCollapsed);

      this.updateToggleAllCatsButton();
    });

    // 5. Toggle All Categories Button
    modal.querySelector('#btn-toggle-all-cats')?.addEventListener('click', () => {
      const categoriesMap = this.groupServicesByCategory();
      const allCats = Array.from(categoriesMap.keys());
      const anyOpen = allCats.some((c) => !this.collapsedCategories.has(c));

      if (anyOpen) {
        // Collapse all
        allCats.forEach((c) => this.collapsedCategories.add(c));
      } else {
        // Expand all
        this.collapsedCategories.clear();
      }

      this.refreshReviewList();
    });

    // 6. Service Edit Button Click / Row Click -> Switches row to Edit Mode
    modal.addEventListener('click', (e) => {
      const editTrigger = e.target.closest('.btn-ai-service-edit, .ai-price-clickable, .ai-row-main');
      if (!editTrigger) return;

      // Do not trigger edit if user clicked a checkbox, delete button, description toggle, or if already editing
      if (e.target.closest('.ai-item-chk, .btn-ai-service-delete, .btn-ai-desc-more')) return;
      const row = editTrigger.closest('.ai-service-row, .ai-service-card');
      if (!row || row.classList.contains('is-editing')) return;

      const tempId = row.getAttribute('data-temp-id') || editTrigger.getAttribute('data-temp-id');
      const item = this.extractedServices.find((s) => s.tempId === tempId);
      if (!item) return;

      // Save draft for cancel
      item._draft = {
        name: item.name,
        category: item.category,
        targetGender: item.targetGender,
        durationMinutes: item.durationMinutes,
        price: item.price,
        description: item.description,
      };
      item.isEditing = true;

      row.outerHTML = this.renderServiceCardHtml(item);
      const newCard = modal.querySelector(`.ai-service-row[data-temp-id="${tempId}"], .ai-service-card[data-temp-id="${tempId}"]`);
      newCard?.querySelector('.ai-input-name')?.focus();
    });

    // 7. Service Edit Cancel Button Click -> Reverts back to Row
    modal.addEventListener('click', (e) => {
      const cancelBtn = e.target.closest('.btn-ai-edit-cancel, .btn-ai-card-cancel-x');
      if (!cancelBtn) return;

      const tempId = cancelBtn.getAttribute('data-temp-id');
      const item = this.extractedServices.find((s) => s.tempId === tempId);
      if (!item) return;

      if (item._draft) {
        item.name = item._draft.name;
        item.category = item._draft.category;
        item.targetGender = item._draft.targetGender;
        item.durationMinutes = item._draft.durationMinutes;
        item.price = item._draft.price;
        item.description = item._draft.description;
        delete item._draft;
      }
      item.isEditing = false;
      this.renamingCategory = null;

      const card = modal.querySelector(`.ai-service-row[data-temp-id="${tempId}"], .ai-service-card[data-temp-id="${tempId}"]`);
      if (card) {
        card.outerHTML = this.renderServiceCardHtml(item);
        this.updateTally();
      }
    });

    // 7b. Description Show More / Show Less Toggle
    modal.addEventListener('click', (e) => {
      const descBtn = e.target.closest('.btn-ai-desc-more');
      if (!descBtn) return;
      e.stopPropagation();

      const tempId = descBtn.getAttribute('data-temp-id');
      const item = this.extractedServices.find((s) => s.tempId === tempId);
      if (!item) return;

      item._expandedDesc = !item._expandedDesc;
      const wrap = descBtn.closest('.ai-card-desc-wrap');
      const textEl = wrap?.querySelector('.ai-card-desc-text');
      if (textEl) {
        textEl.classList.toggle('is-expanded', item._expandedDesc);
        textEl.classList.toggle('is-clamped', !item._expandedDesc);
        descBtn.textContent = item._expandedDesc ? 'Show less' : 'Show more';
      }
    });

    // 8. Service Edit Save Button Click -> Commits changes and moves under selected category
    modal.addEventListener('click', (e) => {
      const saveBtn = e.target.closest('.btn-ai-edit-save');
      if (!saveBtn) return;

      const tempId = saveBtn.getAttribute('data-temp-id');
      const item = this.extractedServices.find((s) => s.tempId === tempId);
      if (!item) return;

      const card = modal.querySelector(`.ai-service-row[data-temp-id="${tempId}"], .ai-service-card[data-temp-id="${tempId}"]`);
      if (!card) return;

      const nameInput = card.querySelector('.ai-input-name');
      const catValInput = card.querySelector('.ai-category-field-val');
      const catNewInput = card.querySelector('.ai-input-new-category');
      const genderInput = card.querySelector('.ai-select-gender');
      const durationInput = card.querySelector('.ai-select-duration');
      const priceInput = card.querySelector('.ai-input-price');
      const descInput = card.querySelector('.ai-input-desc');

      const name = (nameInput?.value || '').trim();
      if (!name) {
        this.app?.showToast?.('Please enter a service name', 'warning');
        nameInput?.focus();
        return;
      }

      let chosenCategory = catValInput?.value;
      if (chosenCategory === '__NEW__') {
        chosenCategory = (catNewInput?.value || '').trim();
        if (!chosenCategory) {
          this.app?.showToast?.('Please enter a category name', 'warning');
          catNewInput?.focus();
          return;
        }
      }
      chosenCategory = (chosenCategory || 'General').trim() || 'General';

      // Match canonical casing against available categories
      const available = this.getAllAvailableCategories();
      const matched = available.find((c) => c.toLowerCase() === chosenCategory.toLowerCase());
      if (matched) {
        chosenCategory = matched;
      }

      const prevCategory = (item.category || 'General').trim() || 'General';

      item.name = name;
      item.category = chosenCategory;
      item.targetGender = genderInput?.value || 'UNISEX';
      item.durationMinutes = parseInt(durationInput?.value, 10) || 30;
      item.price = Math.max(0, parseInt(priceInput?.value, 10) || 0);
      item.description = (descInput?.value || '').trim();
      item.isEditing = false;
      delete item._draft;

      // Ensure destination category is expanded so user sees the moved service
      this.collapsedCategories.delete(chosenCategory);

      // Clear any stale rename state
      this.renamingCategory = null;

      // Re-group and refresh list to place service under the chosen category
      this.refreshReviewList();

      // Visual feedback: highlight and smoothly scroll to moved card
      setTimeout(() => {
        const updatedCard = modal.querySelector(`.ai-service-card[data-temp-id="${tempId}"]`);
        if (updatedCard) {
          updatedCard.classList.add('ai-card-just-moved');
          updatedCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          setTimeout(() => updatedCard.classList.remove('ai-card-just-moved'), 1800);
        }
      }, 50);

      if (prevCategory.toLowerCase() !== chosenCategory.toLowerCase()) {
        this.app?.showToast?.(`Moved "${item.name}" to ${chosenCategory}`, 'success');
      }
    });

    // 9. Delete Service Button Click
    modal.addEventListener('click', (e) => {
      const delBtn = e.target.closest('.btn-ai-service-delete');
      if (!delBtn) return;

      const tempId = delBtn.getAttribute('data-temp-id');
      this.extractedServices = this.extractedServices.filter((s) => s.tempId !== tempId);

      const card = modal.querySelector(`.ai-service-row[data-temp-id="${tempId}"], .ai-service-card[data-temp-id="${tempId}"]`);
      const catGroup = card?.closest('.ai-category-group');
      card?.remove();

      // If category has no services left, remove the category group
      if (catGroup && catGroup.querySelectorAll('.ai-service-row, .ai-service-card').length === 0) {
        catGroup.remove();
      }

      // If no services left in total, show empty state
      if (this.extractedServices.length === 0) {
        this.refreshReviewList();
      }

      this.updateTally();
    });

    // 10. Confirm & Import All
    modal.querySelector('#btn-confirm-ai-import')?.addEventListener('click', () => this.executeImport());
  }

  /**
   * Updates all UI tallies and indeterminate checkbox states
   */
  updateTally() {
    if (!this.modalEl) return;
    const totalCount = this.extractedServices.length;
    const selectedCount = this.extractedServices.filter((s) => s.selected).length;

    // Overall select all checkbox
    const selectAllChk = this.modalEl.querySelector('#ai-chk-select-all');
    if (selectAllChk) {
      if (selectedCount === totalCount && totalCount > 0) {
        selectAllChk.checked = true;
        selectAllChk.indeterminate = false;
      } else if (selectedCount > 0) {
        selectAllChk.checked = false;
        selectAllChk.indeterminate = true;
      } else {
        selectAllChk.checked = false;
        selectAllChk.indeterminate = false;
      }
    }

    const tallyEl = this.modalEl.querySelector('#ai-selected-tally');
    if (tallyEl) tallyEl.textContent = selectedCount;

    const importCountEl = this.modalEl.querySelector('#ai-import-count');
    if (importCountEl) importCountEl.textContent = selectedCount;

    const footerSelCountEl = this.modalEl.querySelector('#ai-footer-sel-count');
    if (footerSelCountEl) footerSelCountEl.textContent = selectedCount;

    const importBtn = this.modalEl.querySelector('#btn-confirm-ai-import');
    if (importBtn) {
      importBtn.disabled = selectedCount === 0;
      importBtn.style.opacity = selectedCount === 0 ? '0.5' : '1';
    }

    // Category tallies
    const categoriesMap = this.groupServicesByCategory();
    const catGroups = this.modalEl.querySelectorAll('.ai-category-group');
    catGroups.forEach((group) => {
      const catName = group.getAttribute('data-category');
      const services = categoriesMap.get(catName) || [];
      const catSelectedCount = services.filter((s) => s.selected).length;
      const catChk = group.querySelector('.ai-cat-chk');
      const countEl = group.querySelector('.cat-sel-count');

      if (countEl) countEl.textContent = catSelectedCount;
      if (catChk) {
        if (catSelectedCount === services.length && services.length > 0) {
          catChk.checked = true;
          catChk.indeterminate = false;
        } else if (catSelectedCount > 0) {
          catChk.checked = false;
          catChk.indeterminate = true;
        } else {
          catChk.checked = false;
          catChk.indeterminate = false;
        }
      }
    });

    this.updateToggleAllCatsButton();
  }

  /**
   * Updates the "Collapse All" / "Expand All" toolbar button text
   */
  updateToggleAllCatsButton() {
    const btn = this.modalEl?.querySelector('#btn-toggle-all-cats');
    if (!btn) return;
    const categoriesMap = this.groupServicesByCategory();
    const allCats = Array.from(categoriesMap.keys());
    if (allCats.length <= 1) {
      btn.style.display = 'none';
      return;
    }
    btn.style.display = 'inline-flex';
    const anyOpen = allCats.some((c) => !this.collapsedCategories.has(c));
    const textEl = btn.querySelector('.toggle-text');
    const iconEl = btn.querySelector('.toggle-icon');
    if (textEl) {
      textEl.textContent = anyOpen ? 'Collapse All' : 'Expand All';
    }
    if (iconEl) {
      iconEl.textContent = anyOpen ? '⌃' : '⌄';
    }
  }

  /**
   * Submits selected services to backend /api/v1/services/bulk-import
   */
  async executeImport() {
    // Auto-commit any currently open edit cards before importing
    if (this.modalEl) {
      const editingCards = this.modalEl.querySelectorAll('.ai-service-row.is-editing, .ai-service-card.is-editing');
      editingCards.forEach((card) => {
        const tempId = card.getAttribute('data-temp-id');
        const item = this.extractedServices.find((s) => s.tempId === tempId);
        if (item) {
          const nameInput = card.querySelector('.ai-input-name');
          const catValInput = card.querySelector('.ai-category-field-val');
          const catNewInput = card.querySelector('.ai-input-new-category');
          const genderInput = card.querySelector('.ai-select-gender');
          const durationInput = card.querySelector('.ai-select-duration');
          const priceInput = card.querySelector('.ai-input-price');
          const descInput = card.querySelector('.ai-input-desc');

          if (nameInput && nameInput.value.trim()) item.name = nameInput.value.trim();
          let catVal = catValInput?.value;
          if (catVal === '__NEW__') {
            catVal = catNewInput?.value?.trim();
          }
          if (catVal) item.category = catVal;
          if (genderInput) item.targetGender = genderInput.value;
          if (durationInput) item.durationMinutes = parseInt(durationInput.value, 10) || 30;
          if (priceInput) item.price = Math.max(1, Math.min(500000, parseInt(priceInput.value, 10) || 1));
          if (descInput) item.description = descInput.value.trim();
          item.isEditing = false;
        }
      });
    }

    const selected = this.extractedServices.filter((s) => s.selected && s.name.trim().length > 0);
    if (selected.length === 0) {
      this.app?.showToast?.('Please select at least one valid service to import.', 'warning');
      return;
    }

    const importBtn = this.modalEl.querySelector('#btn-confirm-ai-import');
    if (importBtn) {
      importBtn.disabled = true;
      importBtn.innerHTML = `
        <span class="ai-btn-spinner"></span>
        Importing ${selected.length} Services...
      `;
    }

    try {
      const payload = {
        services: selected.map((s) => ({
          name: s.name.trim(),
          category: s.category.trim() || 'General',
          price: Math.max(1, Math.min(500000, s.price || 1)),
          durationMinutes: Math.max(30, Math.round((s.durationMinutes || 30) / 15) * 15),
          targetGender: s.targetGender || 'UNISEX',
          description: s.description || undefined,
        })),
      };

      const res = await ApiClient.bulkImportServices(payload.services);

      if (res && res.success) {
        this.modalEl?.remove();
        this.app?.showToast?.(
          `🎉 Successfully imported ${res.importedCount || selected.length} services into your catalog!`,
          'success',
        );

        // Refresh dashboard services view
        if (typeof this.app.loadServicesTab === 'function') {
          await this.app.loadServicesTab();
        } else if (typeof this.app.loadTabContent === 'function') {
          await this.app.loadTabContent('services');
        } else {
          window.location.reload();
        }
      } else {
        throw new Error(res?.message || 'Bulk import did not succeed.');
      }
    } catch (err) {
      console.error('Failed to bulk import services:', err);
      this.app?.showToast?.(`Import failed: ${err.message}`, 'error');
      if (importBtn) {
        importBtn.disabled = false;
        importBtn.innerHTML = `✨ Import ${selected.length} Services`;
      }
    }
  }
}
