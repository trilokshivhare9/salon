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
        tempId: `item_${Date.now()}_${idx}`,
        selected: true,
      }));

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
  showReviewDialog() {
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
            <div class="ai-badge-chip">✨ AI Extracted</div>
            <h2>Review & Edit Services</h2>
            <p>Verify detected services or tweak pricing before adding to your menu.</p>
          </div>
          <button type="button" class="btn-ai-modal-close" id="btn-close-ai-review">✕</button>
        </div>

        <!-- Toolbar -->
        <div class="ai-review-toolbar">
          <label class="ai-select-all-label">
            <input type="checkbox" id="ai-chk-select-all" checked>
            <span>Select All (<strong id="ai-selected-tally">${this.extractedServices.length}</strong>/${this.extractedServices.length})</span>
          </label>

          <button type="button" class="btn-add-manual-ai-row" id="btn-add-manual-row">
            + Add Another Service
          </button>
        </div>

        <!-- Scrollable Services Table / List -->
        <div class="ai-review-list" id="ai-review-list-items">
          ${this.renderReviewItemsHtml()}
        </div>

        <!-- Footer -->
        <div class="ai-review-footer">
          <button type="button" class="btn-ai-discard" id="btn-discard-ai-review">Discard</button>
          <button type="button" class="btn-ai-confirm-import" id="btn-confirm-ai-import">
            ✨ Import <span id="ai-import-count">${this.extractedServices.length}</span> Services
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    this.modalEl = modal;

    this.attachReviewEvents();
  }

  renderReviewItemsHtml() {
    if (!this.extractedServices || this.extractedServices.length === 0) {
      return `
        <div class="ai-empty-review text-center" style="padding: 40px; color: var(--text-secondary);">
          <p>No services selected. Click "+ Add Another Service" to create one.</p>
        </div>
      `;
    }

    const durationOptions = [30, 45, 60, 75, 90, 105, 120, 150, 180];
    const genderOptions = [
      { val: 'UNISEX', label: '👥 Unisex' },
      { val: 'MALE', label: '👤 Men' },
      { val: 'FEMALE', label: '👩 Women' },
      { val: 'KIDS', label: '👶 Kids' },
    ];

    return this.extractedServices.map((item, idx) => `
      <div class="ai-review-row ${item.selected ? 'is-selected' : 'is-unselected'}" data-temp-id="${item.tempId}">
        <div class="ai-row-col-chk">
          <input type="checkbox" class="ai-item-chk" data-temp-id="${item.tempId}" ${item.selected ? 'checked' : ''}>
        </div>

        <div class="ai-row-main-grid">
          <!-- 1. Service Name -->
          <div class="ai-field-group field-name">
            <label>Service Name</label>
            <input type="text" class="ai-input ai-input-name" data-temp-id="${item.tempId}" value="${(item.name || '').replace(/"/g, '&quot;')}" placeholder="e.g. Haircut">
          </div>

          <!-- 2. Category -->
          <div class="ai-field-group field-category">
            <label>Category</label>
            <input type="text" class="ai-input ai-input-category" data-temp-id="${item.tempId}" value="${(item.category || 'General').replace(/"/g, '&quot;')}" list="ai-category-suggestions" placeholder="Category">
          </div>

          <!-- 3. Target Gender -->
          <div class="ai-field-group field-gender">
            <label>Audience</label>
            <select class="ai-input ai-select-gender" data-temp-id="${item.tempId}">
              ${genderOptions.map((g) => `
                <option value="${g.val}" ${item.targetGender === g.val ? 'selected' : ''}>${g.label}</option>
              `).join('')}
            </select>
          </div>

          <!-- 4. Duration (15m increments) -->
          <div class="ai-field-group field-duration">
            <label>Duration</label>
            <select class="ai-input ai-select-duration" data-temp-id="${item.tempId}">
              ${durationOptions.map((d) => `
                <option value="${d}" ${item.durationMinutes === d ? 'selected' : ''}>${d} mins</option>
              `).join('')}
            </select>
          </div>

          <!-- 5. Price -->
          <div class="ai-field-group field-price">
            <label>Price (₹)</label>
            <div class="ai-price-input-wrap">
              <span class="ai-currency-symbol">₹</span>
              <input type="number" class="ai-input ai-input-price" data-temp-id="${item.tempId}" value="${item.price || 0}" min="0" step="10">
            </div>
          </div>

          <!-- 6. Delete Action -->
          <div class="ai-field-group field-delete">
            <button type="button" class="btn-ai-row-delete" data-temp-id="${item.tempId}" title="Remove this item">✕</button>
          </div>
        </div>
      </div>
    `).join('') + `
      <datalist id="ai-category-suggestions">
        <option value="Hair & Styling"></option>
        <option value="Beard & Shave"></option>
        <option value="Facial & Skin"></option>
        <option value="Nails & Pedicure"></option>
        <option value="Waxing & Threading"></option>
        <option value="Massage & Spa"></option>
        ${this.existingCategories.map((c) => `<option value="${c}"></option>`).join('')}
      </datalist>
    `;
  }

  attachReviewEvents() {
    if (!this.modalEl) return;

    const modal = this.modalEl;
    const closeModal = () => modal.remove();

    modal.querySelector('.ai-review-backdrop').addEventListener('click', closeModal);
    modal.querySelector('#btn-close-ai-review').addEventListener('click', closeModal);
    modal.querySelector('#btn-discard-ai-review').addEventListener('click', closeModal);

    // Select All Toggle
    const selectAllChk = modal.querySelector('#ai-chk-select-all');
    selectAllChk?.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      this.extractedServices.forEach((s) => (s.selected = isChecked));
      modal.querySelectorAll('.ai-item-chk').forEach((chk) => (chk.checked = isChecked));
      modal.querySelectorAll('.ai-review-row').forEach((row) => {
        row.classList.toggle('is-selected', isChecked);
        row.classList.toggle('is-unselected', !isChecked);
      });
      this.updateTally();
    });

    // Row Checkboxes
    modal.addEventListener('change', (e) => {
      if (e.target.classList.contains('ai-item-chk')) {
        const tempId = e.target.getAttribute('data-temp-id');
        const item = this.extractedServices.find((s) => s.tempId === tempId);
        if (item) item.selected = e.target.checked;
        const row = modal.querySelector(`.ai-review-row[data-temp-id="${tempId}"]`);
        row?.classList.toggle('is-selected', e.target.checked);
        row?.classList.toggle('is-unselected', !e.target.checked);
        this.updateTally();
      }
    });

    // Input changes (sync to in-memory array)
    modal.addEventListener('input', (e) => {
      const tempId = e.target.getAttribute('data-temp-id');
      if (!tempId) return;
      const item = this.extractedServices.find((s) => s.tempId === tempId);
      if (!item) return;

      if (e.target.classList.contains('ai-input-name')) item.name = e.target.value;
      if (e.target.classList.contains('ai-input-category')) item.category = e.target.value;
      if (e.target.classList.contains('ai-input-price')) item.price = Math.max(0, parseInt(e.target.value, 10) || 0);
    });

    modal.addEventListener('change', (e) => {
      const tempId = e.target.getAttribute('data-temp-id');
      if (!tempId) return;
      const item = this.extractedServices.find((s) => s.tempId === tempId);
      if (!item) return;

      if (e.target.classList.contains('ai-select-gender')) item.targetGender = e.target.value;
      if (e.target.classList.contains('ai-select-duration')) item.durationMinutes = parseInt(e.target.value, 10) || 30;
    });

    // Delete Row
    modal.addEventListener('click', (e) => {
      const delBtn = e.target.closest('.btn-ai-row-delete');
      if (delBtn) {
        const tempId = delBtn.getAttribute('data-temp-id');
        this.extractedServices = this.extractedServices.filter((s) => s.tempId !== tempId);
        const row = modal.querySelector(`.ai-review-row[data-temp-id="${tempId}"]`);
        row?.remove();
        this.updateTally();
      }
    });

    // Add Manual Row
    modal.querySelector('#btn-add-manual-row')?.addEventListener('click', () => {
      const newRow = {
        name: '',
        category: this.existingCategories[0] || 'Hair & Styling',
        price: 250,
        durationMinutes: 30,
        targetGender: 'UNISEX',
        tempId: `manual_${Date.now()}`,
        selected: true,
      };
      this.extractedServices.unshift(newRow);
      const listContainer = modal.querySelector('#ai-review-list-items');
      if (listContainer) {
        listContainer.innerHTML = this.renderReviewItemsHtml();
      }
      this.updateTally();
    });

    // Confirm & Import All
    modal.querySelector('#btn-confirm-ai-import')?.addEventListener('click', () => this.executeImport());
  }

  updateTally() {
    if (!this.modalEl) return;
    const selectedCount = this.extractedServices.filter((s) => s.selected).length;
    const totalCount = this.extractedServices.length;

    const tallyEl = this.modalEl.querySelector('#ai-selected-tally');
    if (tallyEl) tallyEl.textContent = selectedCount;

    const importCountEl = this.modalEl.querySelector('#ai-import-count');
    if (importCountEl) importCountEl.textContent = selectedCount;

    const importBtn = this.modalEl.querySelector('#btn-confirm-ai-import');
    if (importBtn) {
      importBtn.disabled = selectedCount === 0;
      importBtn.style.opacity = selectedCount === 0 ? '0.5' : '1';
    }
  }

  /**
   * Submits selected services to backend /api/v1/services/bulk-import
   */
  async executeImport() {
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
          price: Math.max(0, s.price || 0),
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
