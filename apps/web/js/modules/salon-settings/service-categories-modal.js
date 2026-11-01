import { Icons } from '../../icons.js';
import { ApiClient } from '../../api.js';
import { AppSnackbar } from '../shared/app-snackbar.js';
import { CalendarState } from '../calendar/calendar-state.js';
import { UniversalLoader } from '../shared/universal-loader.js';

export const SALON_CATEGORY_ICONS = [
  '✂️', '💈', '💇', '💆', '💅', '🧖', '🧔', '💄',
  '🧴', '🧼', '✨', '🌿', '🎨', '👁️', '🪒', '🌸',
  '🎀', '👑', '⭐', '💎', '💖', '🔥', '🏷️', '📂'
];

export function guessCategoryIcon(name) {
  if (!name) return '✂️';
  const n = String(name).toLowerCase();
  if (/hair|cut|barber|style|blowdry|color|dye|keratin|straight|curl/i.test(n)) return '✂️';
  if (/skin|facial|cleanup|face|glow|derma|peel|hydra/i.test(n)) return '🧴';
  if (/massage|spa|reflexology|relax|aromatherapy/i.test(n)) return '💆';
  if (/nail|manicure|pedicure|polish|gel/i.test(n)) return '💅';
  if (/beard|shave|mustache|trim/i.test(n)) return '🧔';
  if (/makeup|bridal|cosmetics|lip|glam/i.test(n)) return '💄';
  if (/wax|waxing|threading|laser/i.test(n)) return '✨';
  if (/tattoo|piercing|art|mehendi|henna/i.test(n)) return '🎨';
  if (/eye|lash|brow/i.test(n)) return '👁️';
  if (/package|combo|special|vip|offer/i.test(n)) return '👑';
  if (/wash|shampoo|soap/i.test(n)) return '🧼';
  return '✂️';
}

export function formatCategoryIcon(icon) {
  if (!icon) return '✂️';
  const str = String(icon).trim();
  if (str.startsWith('<svg') || str.startsWith('<span')) return str;
  const normalized = str.toLowerCase();
  const map = {
    scissors: '✂️',
    scissor: '✂️',
    cut: '✂️',
    barber: '💈',
    hair: '💇',
    massage: '💆',
    nails: '💅',
    nail: '💅',
    spa: '🧖',
    beard: '🧔',
    shave: '🪒',
    makeup: '💄',
    skin: '🧴',
    skincare: '🧴',
    facial: '🧖',
    sparkles: '✨',
    sparkle: '✨',
    star: '⭐',
    crown: '👑',
    diamond: '💎',
    heart: '💖',
    eye: '👁️',
    art: '🎨',
    zap: '⚡',
    tag: '🏷️',
    folder: '📂',
  };
  return map[normalized] || str;
}

/**
 * ServiceCategoriesModal
 * Dedicated modular component for creating, editing, and organizing service categories.
 * Features:
 * - Zero unwanted horizontal padding (overrides default CSS 28px modal padding)
 * - Seamless inline creation row without extra bulky card wrapper
 * - Centered screen modal icon picker with zero edge-clipping
 * - Full visible category titles with balanced padding
 * - Smart auto-suggest icons based on category name
 */
export class ServiceCategoriesModal {
  constructor(app) {
    this.app = app;
    this.categories = [];
    this.editingCategoryId = null;
    this.editNameValue = '';
    this.editIconValue = '✂️';
    this.isCreating = false;
    this.isUpdating = false;
  }

  static async show(app) {
    const modal = new ServiceCategoriesModal(app);
    await modal.init();
    return modal;
  }

  async init() {
    const modalContainer = document.getElementById('modal-container');
    if (!modalContainer) return;

    modalContainer.innerHTML = `
      <style>
        .cat-icon-center-opt:hover {
          transform: scale(1.12);
          background: rgba(139, 61, 255, 0.35) !important;
          border-color: #c084fc !important;
        }
        .cat-icon-center-opt:active {
          transform: scale(0.94);
        }
        .cat-item-hover:hover {
          background: rgba(255, 255, 255, 0.05) !important;
          border-color: rgba(139, 61, 255, 0.25) !important;
        }
      </style>

      <div class="modal-backdrop show" id="cat-modal-backdrop" style="position: fixed; inset: 0; background: rgba(0,0,0,0.82); backdrop-filter: blur(5px); z-index: 1050; display: flex; align-items: center; justify-content: center; padding: 12px; box-sizing: border-box;">
        <div class="modal-content" style="max-width: 480px; width: 100%; max-height: 88vh; padding: 0 !important; display: flex; flex-direction: column; background: #13131c; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 16px; box-shadow: 0 24px 60px rgba(0, 0, 0, 0.9); overflow: hidden; position: relative;">
          
          <!-- Header -->
          <div class="modal-header" style="display: flex; align-items: center; justify-content: space-between; padding: 16px 18px 12px 18px; border-bottom: 1px solid rgba(255, 255, 255, 0.08); background: rgba(255, 255, 255, 0.02);">
            <div style="display: flex; align-items: center; gap: 10px; min-width: 0;">
              <div style="width: 36px; height: 36px; border-radius: 9px; background: rgba(139, 61, 255, 0.16); border: 1px solid rgba(139, 61, 255, 0.3); display: flex; align-items: center; justify-content: center; font-size: 1.2rem; flex-shrink: 0;">
                📂
              </div>
              <div style="min-width: 0;">
                <h3 style="font-size: 1.05rem; font-family: var(--font-heading); font-weight: 700; margin: 0; color: #fff; line-height: 1.2;">
                  Manage Categories
                </h3>
                <p style="margin: 2px 0 0 0; font-size: 0.72rem; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                  Organize services for WhatsApp & storefront menu
                </p>
              </div>
            </div>
            <button class="close-btn" id="btn-close-cat-modal" style="width: 30px; height: 30px; font-size: 1.15rem; display: flex; align-items: center; justify-content: center; border-radius: 8px; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.1); color: #cbd5e1; cursor: pointer; flex-shrink: 0; transition: all 0.2s ease;">&times;</button>
          </div>

          <!-- Body -->
          <div class="modal-body" id="cat-modal-body" style="padding: 16px 18px; overflow-y: auto; overflow-x: hidden; flex: 1;">
            ${UniversalLoader.render({ title: 'Loading categories...', minHeight: '160px', variant: 'compact' })}
          </div>
        </div>
      </div>

      <!-- Centered Icon Picker Dialog (Mounted at root modal level so it NEVER overflows) -->
      <div id="cat-icon-center-backdrop" style="display: none; position: fixed; inset: 0; background: rgba(0, 0, 0, 0.75); backdrop-filter: blur(4px); z-index: 1200; align-items: center; justify-content: center; padding: 16px;">
        <div id="cat-icon-center-card" style="width: 100%; max-width: 340px; background: #1a1a28; border: 1px solid rgba(168, 85, 247, 0.45); border-radius: 16px; padding: 18px; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.9), 0 0 0 1px rgba(255, 255, 255, 0.08);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; padding-bottom: 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.08);">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 1.1rem;">🎨</span>
              <span style="font-size: 0.85rem; font-weight: 700; color: #fff; text-transform: uppercase; letter-spacing: 0.04em;">Select Category Icon</span>
            </div>
            <button type="button" id="btn-close-icon-center" style="width: 28px; height: 28px; border-radius: 6px; background: rgba(255, 255, 255, 0.08); border: none; color: #cbd5e1; font-size: 1rem; cursor: pointer; display: flex; align-items: center; justify-content: center; line-height: 1;">✕</button>
          </div>
          
          <div id="cat-icon-center-grid" style="display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px;">
            <!-- Populated dynamically -->
          </div>

          <div style="margin-top: 12px; text-align: center; font-size: 0.72rem; color: #94a3b8;">
            Tap any icon to select
          </div>
        </div>
      </div>
    `;

    const closeModal = () => (modalContainer.innerHTML = '');
    document.getElementById('btn-close-cat-modal')?.addEventListener('click', closeModal);
    document.getElementById('cat-modal-backdrop')?.addEventListener('click', (e) => {
      if (e.target.id === 'cat-modal-backdrop') closeModal();
    });

    const iconCenterBackdrop = document.getElementById('cat-icon-center-backdrop');
    document.getElementById('btn-close-icon-center')?.addEventListener('click', () => {
      if (iconCenterBackdrop) iconCenterBackdrop.style.display = 'none';
    });
    iconCenterBackdrop?.addEventListener('click', (e) => {
      if (e.target.id === 'cat-icon-center-backdrop') {
        iconCenterBackdrop.style.display = 'none';
      }
    });

    await this.loadData();
  }

  async loadData() {
    try {
      const res = await ApiClient.getServiceCategories(true);
      this.categories = Array.isArray(res) ? res : res.data || [];
      if (this.app) {
        this.app.categoriesList = this.categories;
      }
      this.render();
    } catch (err) {
      const body = document.getElementById('cat-modal-body');
      if (body) {
        body.innerHTML = `
          <div style="padding: 24px; text-align: center; color: #f87171;">
            <p style="font-weight: 600;">Failed to load service categories</p>
            <p style="font-size: 0.8rem; color: #94a3b8; margin-bottom: 12px;">${err.message}</p>
            <button type="button" class="btn btn-sm btn-secondary" id="btn-retry-cats">Retry</button>
          </div>
        `;
        document.getElementById('btn-retry-cats')?.addEventListener('click', () => this.loadData());
      }
    }
  }

  getServiceCount(category) {
    if (category._count && typeof category._count.services === 'number') {
      return category._count.services;
    }
    const servicesList = this.app?.servicesList || [];
    return servicesList.filter((s) => s.categoryId === category.id || (s.category && s.category.toLowerCase() === category.name.toLowerCase())).length;
  }

  render() {
    const body = document.getElementById('cat-modal-body');
    if (!body) return;

    body.innerHTML = `
      <!-- Seamless Integrated Add Category Row (No extra bulky card, zero wasted space) -->
      <form id="form-create-category" style="display: flex; gap: 8px; align-items: center; margin-bottom: 16px;">
        <!-- Centered Icon Button -->
        <button type="button" id="btn-new-cat-icon"
          style="width: 44px; height: 42px; padding: 0; font-size: 1.35rem; display: flex; align-items: center; justify-content: center; background: rgba(139, 61, 255, 0.16); border: 1px solid rgba(139, 61, 255, 0.35); border-radius: 10px; cursor: pointer; flex-shrink: 0; transition: all 0.2s ease;"
          title="Click to choose icon in center">
          <span id="preview-new-cat-icon">✂️</span>
        </button>
        <input type="hidden" id="val-new-cat-icon" value="✂️" />

        <!-- Category Name Input -->
        <input type="text" class="form-control" id="inp-new-cat-name" placeholder="Type new category name..." required
          style="flex: 1; min-width: 0; height: 42px; font-size: 0.88rem; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 10px; padding: 0 14px; color: #fff;" />

        <!-- Add Button -->
        <button type="submit" class="btn btn-primary" id="btn-submit-new-cat"
          style="height: 42px; padding: 0 16px; font-size: 0.84rem; font-weight: 700; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; background: linear-gradient(135deg, #7c3aed, #6366f1); border: none; flex-shrink: 0; box-shadow: 0 4px 14px rgba(124, 58, 237, 0.35); cursor: pointer; white-space: nowrap;">
          <span>➕ Add</span>
        </button>
      </form>

      <!-- Categories List Header with Clean Spacing -->
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; padding: 0 2px;">
        <span style="font-size: 0.72rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em;">
          Active Categories (${this.categories.length})
        </span>
        <span style="font-size: 0.68rem; color: #64748b;">
          ${this.categories.length} total
        </span>
      </div>

      <!-- Categories Items Grid -->
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${this.categories.length === 0 ? `
          <div style="text-align: center; padding: 28px 16px; color: #94a3b8; background: rgba(0, 0, 0, 0.2); border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.04); font-size: 0.84rem;">
            No service categories yet. Enter a name above to create your first category!
          </div>
        ` : this.categories.map((c) => this.renderCategoryRow(c)).join('')}
      </div>
    `;

    this.attachEventListeners();
  }

  renderCategoryRow(c) {
    const isEditing = this.editingCategoryId === c.id;
    const count = this.getServiceCount(c);
    const displayIcon = formatCategoryIcon(c.icon);

    if (isEditing) {
      return `
        <div class="category-item-editing" style="background: rgba(139, 61, 255, 0.12); border: 1px solid rgba(139, 61, 255, 0.4); border-radius: 12px; padding: 12px 14px; margin-bottom: 6px; transition: all 0.2s ease;">
          <div style="font-size: 0.70rem; font-weight: 700; color: #c4b5fd; text-transform: uppercase; margin-bottom: 8px; display: flex; align-items: center; gap: 5px;">
            <span>✏️</span>
            <span>Editing Category: "${c.name}"</span>
          </div>

          <form class="form-edit-category" data-id="${c.id}" style="display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; gap: 8px; align-items: center;">
              <button type="button" class="btn-edit-cat-icon"
                style="width: 44px; height: 40px; padding: 0; font-size: 1.35rem; display: flex; align-items: center; justify-content: center; background: rgba(139, 61, 255, 0.25); border: 1px solid rgba(139, 61, 255, 0.45); border-radius: 10px; cursor: pointer; flex-shrink: 0;"
                title="Click to choose icon in center">
                <span class="preview-edit-cat-icon">${this.editIconValue}</span>
              </button>
              <input type="hidden" class="val-edit-cat-icon" value="${this.editIconValue}" />

              <input type="text" class="form-control inp-edit-cat-name" value="${this.editNameValue}" required
                style="flex: 1; min-width: 0; height: 40px; font-size: 0.88rem; background: rgba(0, 0, 0, 0.5); border: 1px solid rgba(255, 255, 255, 0.22); border-radius: 10px; padding: 0 12px; color: #fff;" />
            </div>

            <div style="display: flex; gap: 8px; margin-top: 2px;">
              <button type="button" class="btn btn-secondary btn-cancel-edit" style="flex: 1; height: 36px; padding: 0 12px; font-size: 0.80rem; font-weight: 600; border-radius: 8px;">
                Cancel
              </button>
              <button type="submit" class="btn btn-primary btn-save-edit" style="flex: 1; height: 36px; padding: 0 14px; font-size: 0.80rem; font-weight: 700; border-radius: 8px; background: linear-gradient(135deg, #10b981, #059669); border: none; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);">
                ✓ Save Changes
              </button>
            </div>
          </form>
        </div>
      `;
    }

    return `
      <div class="category-item-row cat-item-hover" data-id="${c.id}" style="display: flex; justify-content: space-between; align-items: center; gap: 12px; background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.07); padding: 10px 14px; border-radius: 12px; transition: all 0.2s ease;">
        <!-- Left: Icon Box + Category Name + Pill -->
        <div style="display: flex; align-items: center; gap: 12px; min-width: 0; flex: 1;">
          <div style="width: 40px; height: 40px; border-radius: 10px; background: rgba(139, 61, 255, 0.15); border: 1px solid rgba(139, 61, 255, 0.28); display: flex; align-items: center; justify-content: center; font-size: 1.3rem; flex-shrink: 0;">
            ${displayIcon}
          </div>

          <div style="min-width: 0; flex: 1;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <span style="font-size: 0.92rem; font-weight: 700; color: #fff; line-height: 1.25;">
                ${c.name}
              </span>
              <span class="badge" style="font-size: 0.65rem; font-weight: 600; padding: 2px 7px; border-radius: 5px; flex-shrink: 0; ${count > 0 ? 'background: rgba(139, 92, 246, 0.18); color: #c4b5fd; border: 1px solid rgba(139, 92, 246, 0.28);' : 'background: rgba(255, 255, 255, 0.05); color: #94a3b8; border: 1px solid rgba(255, 255, 255, 0.08);'}">
                ${count} ${count === 1 ? 'service' : 'services'}
              </span>
            </div>
          </div>
        </div>

        <!-- Right: Actions (Edit & Delete) -->
        <div style="display: flex; gap: 6px; flex-shrink: 0; align-items: center;">
          <button type="button" class="btn btn-secondary btn-sm btn-edit-category" data-id="${c.id}" data-name="${c.name}" data-icon="${displayIcon}" style="height: 32px; padding: 0 11px; font-size: 0.76rem; font-weight: 600; display: inline-flex; align-items: center; gap: 5px; border-radius: 8px;" title="Edit Category">
            <span>✏️</span>
            <span>Edit</span>
          </button>
          <button type="button" class="btn btn-danger-outline btn-sm btn-delete-category" data-id="${c.id}" data-name="${c.name}" data-count="${count}" style="height: 32px; width: 32px; padding: 0; font-size: 0.82rem; display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; color: #f87171; border: 1px solid rgba(248, 113, 113, 0.22); background: rgba(248, 113, 113, 0.06);" title="Delete Category">
            🗑️
          </button>
        </div>
      </div>
    `;
  }

  openCenteredIconPicker(currentIcon, onSelect) {
    const backdrop = document.getElementById('cat-icon-center-backdrop');
    const grid = document.getElementById('cat-icon-center-grid');
    if (!backdrop || !grid) return;

    grid.innerHTML = SALON_CATEGORY_ICONS.map((icon) => `
      <button type="button" class="cat-icon-center-opt ${icon === currentIcon ? 'selected' : ''}" data-icon="${icon}"
        style="width: 100%; aspect-ratio: 1; font-size: 1.35rem; display: flex; align-items: center; justify-content: center; background: ${icon === currentIcon ? 'rgba(139, 61, 255, 0.45)' : 'rgba(255, 255, 255, 0.06)'}; border: 1px solid ${icon === currentIcon ? '#c084fc' : 'rgba(255, 255, 255, 0.12)'}; border-radius: 10px; cursor: pointer; transition: all 0.15s ease; outline: none;"
        title="${icon}">
        ${icon}
      </button>
    `).join('');

    grid.querySelectorAll('.cat-icon-center-opt').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const selected = btn.getAttribute('data-icon');
        if (typeof onSelect === 'function') {
          onSelect(selected);
        }
        backdrop.style.display = 'none';
      });
    });

    backdrop.style.display = 'flex';
  }

  attachEventListeners() {
    const body = document.getElementById('cat-modal-body');
    if (!body) return;

    // 1. Icon Picker for Create Form (Opens Dead Center)
    let userManuallySelected = false;
    const nameInp = body.querySelector('#inp-new-cat-name');
    const iconInp = body.querySelector('#val-new-cat-icon');
    const previewIcon = body.querySelector('#preview-new-cat-icon');
    const btnNewIcon = body.querySelector('#btn-new-cat-icon');

    btnNewIcon?.addEventListener('click', (e) => {
      e.preventDefault();
      this.openCenteredIconPicker(iconInp?.value || '✂️', (selected) => {
        userManuallySelected = true;
        if (iconInp) iconInp.value = selected;
        if (previewIcon) previewIcon.textContent = selected;
      });
    });

    nameInp?.addEventListener('input', () => {
      if (!userManuallySelected) {
        const guessed = guessCategoryIcon(nameInp.value);
        if (iconInp) iconInp.value = guessed;
        if (previewIcon) previewIcon.textContent = guessed;
      }
    });

    // 2. Create Category Form Submit
    body.querySelector('#form-create-category')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (this.isCreating) return;

      const submitBtn = body.querySelector('#btn-submit-new-cat');
      const name = nameInp?.value?.trim();
      const icon = iconInp?.value?.trim() || '✂️';

      if (!name) return;

      this.isCreating = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span>Adding...</span>`;
      }

      try {
        await ApiClient.createServiceCategory({ name, icon });
        AppSnackbar.success(`Category "${name}" created successfully!`);
        this.isCreating = false;
        await this.loadData();
        if (this.app && typeof this.app.loadData === 'function') {
          this.app.loadData(true);
        }
      } catch (err) {
        this.isCreating = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = `<span>➕ Add</span>`;
        }
        AppSnackbar.error(`Error creating category: ${err.message}`);
      }
    });

    // 3. Edit Category Button Click
    body.querySelectorAll('.btn-edit-category').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name');
        const icon = btn.getAttribute('data-icon') || '✂️';

        this.editingCategoryId = id;
        this.editNameValue = name;
        this.editIconValue = icon;
        this.render();
      });
    });

    // 4. Cancel Edit Button Click
    body.querySelector('.btn-cancel-edit')?.addEventListener('click', () => {
      this.editingCategoryId = null;
      this.render();
    });

    // 5. Edit Form & Centered Icon Picker
    const editForm = body.querySelector('.form-edit-category');
    if (editForm) {
      const btnEditIcon = editForm.querySelector('.btn-edit-cat-icon');
      const previewEditIcon = editForm.querySelector('.preview-edit-cat-icon');
      const valEditIcon = editForm.querySelector('.val-edit-cat-icon');

      btnEditIcon?.addEventListener('click', (e) => {
        e.preventDefault();
        this.openCenteredIconPicker(valEditIcon?.value || '✂️', (selected) => {
          this.editIconValue = selected;
          if (valEditIcon) valEditIcon.value = selected;
          if (previewEditIcon) previewEditIcon.textContent = selected;
        });
      });

      // Save Edit Form Submit
      editForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (this.isUpdating) return;

        const id = editForm.getAttribute('data-id');
        const nameInpEdit = editForm.querySelector('.inp-edit-cat-name');
        const iconInpEdit = editForm.querySelector('.val-edit-cat-icon');
        const saveBtn = editForm.querySelector('.btn-save-edit');
        const name = nameInpEdit?.value?.trim();
        const icon = iconInpEdit?.value?.trim() || '✂️';

        if (!name) return;

        this.isUpdating = true;
        if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.innerHTML = `<span>Saving...</span>`;
        }

        try {
          await ApiClient.updateServiceCategory(id, { name, icon });
          AppSnackbar.success(`Category "${name}" updated!`);
          this.editingCategoryId = null;
          this.isUpdating = false;
          await this.loadData();
          if (this.app && typeof this.app.loadData === 'function') {
            this.app.loadData(true);
          }
        } catch (err) {
          this.isUpdating = false;
          if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<span>✓ Save</span>`;
          }
          AppSnackbar.error(`Error updating category: ${err.message}`);
        }
      });
    }

    // 6. Delete Category Button Click
    body.querySelectorAll('.btn-delete-category').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        const name = btn.getAttribute('data-name');
        const count = parseInt(btn.getAttribute('data-count') || '0', 10);

        const warningMsg = count > 0
          ? `Category "${name}" currently contains ${count} service(s). Deleting it will keep the services, but unassign them from this category. Continue?`
          : `Are you sure you want to delete category "${name}"?`;

        const ok = await CalendarState.confirm({
          title: 'Delete Service Category',
          message: warningMsg,
          confirmText: 'Delete Category',
          cancelText: 'Cancel',
          icon: '🗑️',
          type: 'danger',
        });

        if (!ok) return;

        btn.disabled = true;
        btn.innerHTML = `<span>⏳</span>`;

        try {
          await ApiClient.deleteServiceCategory(id);
          AppSnackbar.success(`Category "${name}" deleted.`);
          await this.loadData();
          if (this.app && typeof this.app.loadData === 'function') {
            this.app.loadData(true);
          }
        } catch (err) {
          btn.disabled = false;
          btn.innerHTML = `🗑️`;
          AppSnackbar.error(`Error deleting category: ${err.message}`);
        }
      });
    });
  }
}
