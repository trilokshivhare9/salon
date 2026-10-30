/**
 * StaffServicesView
 * Modern & Space-Efficient Workspace for Qualified Services.
 * 
 * Features:
 * - Sleek top bar (Back to Stylist + Live Auto-saved status + Live tally)
 * - Modern Search Bar with real-time service filtering & clear button
 * - Filter Button that opens a slide-out Side Drawer (Status, Category, Sort)
 * - Single "Select All" / "Deselect All" master toggle button
 * - Compact horizontal round pill chips (border-radius: 999px) for services
 * - Debounced background auto-save via ApiClient without full page reloads
 */
import { ApiClient, SalonRepository } from '../../api.js';
import { LoadingOverlay } from '../shared/loading-overlay.js';
import { AppSnackbar } from '../shared/app-snackbar.js';
import { CalendarState } from '../calendar/index.js';

export class StaffServicesView {
  static render(ctx, staff) {
    const allServices = ctx.servicesList || [];
    const categories = ctx.categoriesList || [];
    const assignedIds = new Set(
      (staff.services || [])
        .map((s) => (typeof s === 'string' ? s : s.serviceId || s.id || s.service?.id))
        .filter(Boolean)
    );
    const totalServices = allServices.length;
    const totalAssigned = allServices.filter((s) => assignedIds.has(s.id)).length;

    return `
      <div class="staff-workspace-shell staff-services-workspace">
        <!-- 1. Sleek Minimal Top Navigation (Back on left, Tally & Save on right) -->
        <div class="services-minimal-nav">
          <button type="button" class="btn-staff-back" id="btn-back-to-profile" aria-label="Back to ${staff.name}" title="Back to ${staff.name}">
            <span class="back-chevron">‹</span>
            <span class="back-text">Back</span>
          </button>

          <div class="services-nav-right">
            <div class="workspace-tally-pill" id="services-tally-pill">
              ${totalAssigned}/${totalServices} Assigned
            </div>
            <button type="button" class="btn-save-staff-services" id="btn-save-staff-services" disabled title="Save service assignments">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                <polyline points="17 21 17 13 7 13 7 21"></polyline>
                <polyline points="7 3 7 8 15 8"></polyline>
              </svg>
              <span>Save</span>
            </button>
          </div>
        </div>

        <!-- 2. Search Bar + Filter Button Toolbar -->
        <div class="services-search-filter-toolbar">
          <div class="services-search-box">
            <span class="search-icon">🔍</span>
            <input type="text" 
                   id="input-services-search" 
                   class="services-search-input" 
                   placeholder="Search services..." 
                   autocomplete="off" />
            <button type="button" id="btn-clear-services-search" class="btn-clear-search" style="display:none;" title="Clear search">✕</button>
          </div>

          <button type="button" id="btn-open-services-filter" class="btn-services-filter" title="Filter services">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon>
            </svg>
            <span>Filter</span>
            <span class="filter-active-dot" id="filter-active-dot" style="display:none;"></span>
          </button>
        </div>

        <!-- 3. Flattened Category Sections with Modern Round Pill Chips -->
        <div class="workspace-body-content">
          ${totalServices === 0 ? `
            <div class="services-empty-state">
              <div class="empty-icon">✂️</div>
              <h4>No Services in Catalog Yet</h4>
              <p>Create services in the <strong>Service Menu</strong> tab first to assign them to ${staff.name}.</p>
            </div>
          ` : `
            <div class="stylist-cat-flat-list" id="stylist-services-list-container">
              ${(categories.length === 0 ? [{ id: 'general', name: 'All Services' }] : categories).map((cat) => {
                const catServices = categories.length === 0
                  ? allServices
                  : allServices.filter((s) => (s.categoryId || s.category?.id) === cat.id);
                if (catServices.length === 0) return '';
                const catAssignedCount = catServices.filter((s) => assignedIds.has(s.id)).length;

                return `
                  <div class="stylist-cat-section" data-category-id="${cat.id}">
                    <div class="stylist-cat-heading">
                      <span class="cat-heading-name">${cat.name}</span>
                      <span class="cat-heading-count" id="cat-tally-${cat.id}">${catAssignedCount}/${catServices.length}</span>
                    </div>

                    <div class="stylist-cat-pills-list" id="cat-pills-${cat.id}">
                      ${catServices.map((srv) => {
                        const isAssigned = assignedIds.has(srv.id);
                        const duration = srv.durationMins || srv.durationMinutes || srv.duration || 30;
                        const price = srv.price || 0;

                        return `
                          <div class="stylist-service-pill ${isAssigned ? 'is-assigned' : ''}" 
                               data-service-id="${srv.id}" 
                               data-category-id="${cat.id}"
                               data-service-name="${(srv.name || '').toLowerCase()}"
                               data-price="${price}"
                               data-duration="${duration}"
                               data-is-assigned="${isAssigned ? 'true' : 'false'}"
                               role="button"
                               tabindex="0"
                               title="Click to ${isAssigned ? 'unassign' : 'assign'} ${srv.name}">
                            <span class="custom-chk-visual">${isAssigned ? '✓' : ''}</span>
                            <span class="pill-srv-name">${srv.name}</span>
                            <span class="pill-meta-text">⏱ ${duration}m · ₹${price}</span>
                            <input type="checkbox" 
                                   class="stylist-service-checkbox" 
                                   data-service-id="${srv.id}" 
                                   data-category-id="${cat.id}" 
                                   ${isAssigned ? 'checked' : ''} 
                                   style="display:none;" />
                          </div>
                        `;
                      }).join('')}
                    </div>
                  </div>
                `;
              }).join('')}
            </div>

            <!-- Empty search/filter results state -->
            <div class="services-empty-search-state" id="services-empty-search" style="display:none;">
              <div class="empty-search-icon">🔍</div>
              <p class="empty-search-text">No services match your search or filter</p>
              <button type="button" class="btn-reset-search-state" id="btn-clear-all-filters">Clear Search & Filters</button>
            </div>
          `}
        </div>

        <!-- 4. Filter Side Drawer Backdrop Overlay -->
        <div class="services-filter-drawer-backdrop" id="services-filter-backdrop"></div>

        <!-- 5. Filter Side Drawer (Slide-out from Right) -->
        <div class="services-filter-drawer" id="services-filter-drawer" role="dialog" aria-modal="true" aria-label="Filter Services">
          <div class="drawer-header">
            <div class="drawer-header-left">
              <span class="drawer-title">Filter Services</span>
              <span class="drawer-tally-sub" id="drawer-filtered-count">${totalServices} Total in Catalog</span>
            </div>
            <button type="button" class="drawer-close-btn" id="btn-close-services-filter" aria-label="Close filters">✕</button>
          </div>

          <!-- Drawer Body Content: Scrollable -->
          <div class="drawer-body">
            <!-- Filter Group 1: Assignment Status -->
            <div class="filter-group">
              <label class="filter-group-label">Assignment Status</label>
              <div class="filter-chips-row" id="filter-status-chips">
                <button type="button" class="filter-chip-btn is-active" data-status-filter="ALL">All Services</button>
                <button type="button" class="filter-chip-btn" data-status-filter="ASSIGNED">Assigned Only (✓)</button>
                <button type="button" class="filter-chip-btn" data-status-filter="UNASSIGNED">Unassigned Only</button>
              </div>
            </div>

            <!-- Filter Group 2: Category Filter -->
            <div class="filter-group">
              <label class="filter-group-label">Category</label>
              <div class="filter-chips-row" id="filter-category-chips">
                <button type="button" class="filter-chip-btn is-active" data-category-filter="ALL">All Categories</button>
                ${categories.map((cat) => `
                  <button type="button" class="filter-chip-btn" data-category-filter="${cat.id}">${cat.name}</button>
                `).join('')}
              </div>
            </div>

            <!-- Filter Group 3: Sort Options -->
            <div class="filter-group">
              <label class="filter-group-label">Sort By</label>
              <div class="filter-chips-row" id="filter-sort-chips">
                <button type="button" class="filter-chip-btn is-active" data-sort-filter="DEFAULT">Default</button>
                <button type="button" class="filter-chip-btn" data-sort-filter="PRICE_ASC">Price: Low to High</button>
                <button type="button" class="filter-chip-btn" data-sort-filter="PRICE_DESC">Price: High to Low</button>
                <button type="button" class="filter-chip-btn" data-sort-filter="DURATION_ASC">Duration: Shortest</button>
              </div>
            </div>
          </div>

          <!-- Drawer Footer Actions: Pinned to Bottom -->
          <div class="drawer-footer-actions">
            <button type="button" class="btn-reset-filters" id="btn-reset-services-filters">Reset</button>
            <button type="button" class="btn-apply-filters" id="btn-apply-services-filters">Apply Filters</button>
          </div>
        </div>
      </div>
    `;
  }

  static attachListeners(container, ctx, staff) {
    // Filter & Search State
    const filterState = {
      search: '',
      status: 'ALL',
      category: 'ALL',
      sort: 'DEFAULT',
    };

    const searchInput = container.querySelector('#input-services-search');
    const clearSearchBtn = container.querySelector('#btn-clear-services-search');
    const filterDrawer = container.querySelector('#services-filter-drawer');
    const filterBackdrop = container.querySelector('#services-filter-backdrop');
    const openFilterBtn = container.querySelector('#btn-open-services-filter');
    const closeFilterBtn = container.querySelector('#btn-close-services-filter');
    const applyFilterBtn = container.querySelector('#btn-apply-services-filters');
    const resetFilterBtn = container.querySelector('#btn-reset-services-filters');
    const clearAllFiltersBtn = container.querySelector('#btn-clear-all-filters');
    const activeFilterDot = container.querySelector('#filter-active-dot');
    const emptySearchState = container.querySelector('#services-empty-search');

    // Drawer Open/Close (Smooth Side Drawer Transition)
    const openDrawer = () => {
      if (filterDrawer && filterBackdrop) {
        filterBackdrop.classList.add('is-open');
        filterDrawer.classList.add('is-open');
      }
    };

    const closeDrawer = () => {
      if (filterDrawer && filterBackdrop) {
        filterBackdrop.classList.remove('is-open');
        filterDrawer.classList.remove('is-open');
      }
    };

    if (openFilterBtn) openFilterBtn.onclick = openDrawer;
    if (closeFilterBtn) closeFilterBtn.onclick = closeDrawer;
    if (filterBackdrop) filterBackdrop.onclick = closeDrawer;

    // 0. Authoritative in-memory State: Single Source of Truth
    const assignedServiceIds = new Set(
      (staff.services || [])
        .map((s) => (typeof s === 'string' ? s : s.serviceId || s.id || s.service?.id))
        .filter(Boolean)
    );
    let initialAssignedIds = new Set(assignedServiceIds);

    const isDirty = () => {
      if (assignedServiceIds.size !== initialAssignedIds.size) return true;
      for (const id of assignedServiceIds) {
        if (!initialAssignedIds.has(id)) return true;
      }
      return false;
    };

    const saveBtn = container.querySelector('#btn-save-staff-services');

    const updateSaveBtnState = () => {
      if (!saveBtn) return;
      const dirty = isDirty();
      saveBtn.disabled = !dirty;
      saveBtn.classList.toggle('is-active', dirty);

      let diffCount = 0;
      assignedServiceIds.forEach((id) => {
        if (!initialAssignedIds.has(id)) diffCount++;
      });
      initialAssignedIds.forEach((id) => {
        if (!assignedServiceIds.has(id)) diffCount++;
      });

      const label = dirty && diffCount > 0 ? `Save (${diffCount})` : 'Save';
      saveBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
          <polyline points="17 21 17 13 7 13 7 21"></polyline>
          <polyline points="7 3 7 8 15 8"></polyline>
        </svg>
        <span>${label}</span>
      `;
    };

    // Recalculate and update tallies dynamically from the authoritative Set
    const updateCountsAndTally = () => {
      let totalAssigned = 0;
      let totalServices = 0;

      container.querySelectorAll('.stylist-cat-section').forEach((catSec) => {
        const catId = catSec.getAttribute('data-category-id');
        const pills = catSec.querySelectorAll('.stylist-service-pill');
        let catAssigned = 0;

        pills.forEach((pill) => {
          totalServices++;
          const sId = pill.getAttribute('data-service-id');
          if (assignedServiceIds.has(sId)) {
            catAssigned++;
            totalAssigned++;
          }
        });

        const catTally = catSec.querySelector(`#cat-tally-${catId}`);
        if (catTally) catTally.textContent = `${catAssigned}/${pills.length}`;
      });

      const tallyPill = container.querySelector('#services-tally-pill');
      if (tallyPill) tallyPill.textContent = `${totalAssigned}/${totalServices} Assigned`;
    };

    // Apply Search and Filters in Real-time
    const runFilterAndSearch = () => {
      const q = filterState.search.trim().toLowerCase();
      let visiblePillCount = 0;

      const isFilteredActive =
        filterState.status !== 'ALL' ||
        filterState.category !== 'ALL' ||
        filterState.sort !== 'DEFAULT';

      if (activeFilterDot) {
        activeFilterDot.style.display = isFilteredActive ? 'inline-block' : 'none';
      }
      if (openFilterBtn) {
        openFilterBtn.classList.toggle('is-filtered', isFilteredActive);
      }

      container.querySelectorAll('.stylist-cat-section').forEach((catSec) => {
        const catId = catSec.getAttribute('data-category-id');
        const isCategoryMatch = filterState.category === 'ALL' || filterState.category === catId;

        if (!isCategoryMatch) {
          catSec.style.display = 'none';
          return;
        }

        let catVisibleCount = 0;
        const pillsList = catSec.querySelectorAll('.stylist-service-pill');

        pillsList.forEach((pill) => {
          const srvName = pill.getAttribute('data-service-name') || '';
          const sId = pill.getAttribute('data-service-id');
          const isAssigned = assignedServiceIds.has(sId);

          // Search match
          const matchesSearch = !q || srvName.includes(q);

          // Status match
          let matchesStatus = true;
          if (filterState.status === 'ASSIGNED') matchesStatus = isAssigned;
          if (filterState.status === 'UNASSIGNED') matchesStatus = !isAssigned;

          const isVisible = matchesSearch && matchesStatus;
          pill.style.display = isVisible ? 'inline-flex' : 'none';

          if (isVisible) {
            catVisibleCount++;
            visiblePillCount++;
          }
        });

        // Hide entire category section if 0 pills match
        catSec.style.display = catVisibleCount > 0 ? 'flex' : 'none';

        // Apply sorting to visible pills if specified
        if (catVisibleCount > 1 && filterState.sort !== 'DEFAULT') {
          const pillsContainer = catSec.querySelector('.stylist-cat-pills-list');
          if (pillsContainer) {
            const pillsArray = Array.from(pillsList);
            pillsArray.sort((a, b) => {
              const priceA = parseFloat(a.getAttribute('data-price') || '0');
              const priceB = parseFloat(b.getAttribute('data-price') || '0');
              const durA = parseInt(a.getAttribute('data-duration') || '0', 10);
              const durB = parseInt(b.getAttribute('data-duration') || '0', 10);

              if (filterState.sort === 'PRICE_ASC') return priceA - priceB;
              if (filterState.sort === 'PRICE_DESC') return priceB - priceA;
              if (filterState.sort === 'DURATION_ASC') return durA - durB;
              return 0;
            });
            pillsArray.forEach((p) => pillsContainer.appendChild(p));
          }
        }
      });

      if (emptySearchState) {
        emptySearchState.style.display = visiblePillCount === 0 ? 'flex' : 'none';
      }
    };

    // Live search input handler
    if (searchInput) {
      searchInput.oninput = () => {
        filterState.search = searchInput.value;
        if (clearSearchBtn) {
          clearSearchBtn.style.display = filterState.search ? 'flex' : 'none';
        }
        runFilterAndSearch();
      };
    }

    if (clearSearchBtn) {
      clearSearchBtn.onclick = () => {
        searchInput.value = '';
        filterState.search = '';
        clearSearchBtn.style.display = 'none';
        runFilterAndSearch();
      };
    }

    // Filter Drawer chips selection
    const setupChipGroup = (containerId, stateKey) => {
      const chipContainer = container.querySelector(containerId);
      if (!chipContainer) return;
      chipContainer.querySelectorAll('.filter-chip-btn').forEach((chip) => {
        chip.onclick = () => {
          chipContainer.querySelectorAll('.filter-chip-btn').forEach((c) => c.classList.remove('is-active'));
          chip.classList.add('is-active');
          const filterVal =
            chip.getAttribute('data-status-filter') ||
            chip.getAttribute('data-category-filter') ||
            chip.getAttribute('data-sort-filter');
          filterState[stateKey] = filterVal;
        };
      });
    };

    setupChipGroup('#filter-status-chips', 'status');
    setupChipGroup('#filter-category-chips', 'category');
    setupChipGroup('#filter-sort-chips', 'sort');

    // Apply filters from drawer
    if (applyFilterBtn) {
      applyFilterBtn.onclick = () => {
        closeDrawer();
        runFilterAndSearch();
      };
    }

    // Reset filters
    const resetFilters = () => {
      filterState.status = 'ALL';
      filterState.category = 'ALL';
      filterState.sort = 'DEFAULT';

      container.querySelectorAll('.filter-chips-row').forEach((row) => {
        row.querySelectorAll('.filter-chip-btn').forEach((c, idx) => {
          c.classList.toggle('is-active', idx === 0);
        });
      });

      runFilterAndSearch();
    };

    if (resetFilterBtn) resetFilterBtn.onclick = resetFilters;

    if (clearAllFiltersBtn) {
      clearAllFiltersBtn.onclick = () => {
        if (searchInput) searchInput.value = '';
        filterState.search = '';
        if (clearSearchBtn) clearSearchBtn.style.display = 'none';
        resetFilters();
      };
    }

    // Toggle a single pill with immediate optimistic visual update (no auto-save)
    const togglePill = (pill) => {
      const serviceId = pill.getAttribute('data-service-id');
      if (!serviceId) return;

      const isAssigned = assignedServiceIds.has(serviceId);
      const nextAssigned = !isAssigned;

      if (nextAssigned) {
        assignedServiceIds.add(serviceId);
      } else {
        assignedServiceIds.delete(serviceId);
      }

      pill.classList.toggle('is-assigned', nextAssigned);
      pill.setAttribute('data-is-assigned', nextAssigned ? 'true' : 'false');

      const chk = pill.querySelector('.stylist-service-checkbox');
      if (chk) chk.checked = nextAssigned;

      const visual = pill.querySelector('.custom-chk-visual');
      if (visual) visual.textContent = nextAssigned ? '✓' : '';

      updateCountsAndTally();
      updateSaveBtnState();
    };

    // 1. Pill Click and Keyboard (Enter/Space) handlers
    container.querySelectorAll('.stylist-service-pill').forEach((pill) => {
      pill.onclick = (e) => {
        e.preventDefault();
        togglePill(pill);
      };
      pill.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          togglePill(pill);
        }
      };
    });

    // 2. Explicit Batch Save Handler with Universal Loading Overlay
    if (saveBtn) {
      saveBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (saveBtn.disabled || !isDirty()) return;

        const payloadServiceIds = Array.from(assignedServiceIds);

        saveBtn.disabled = true;
        saveBtn.innerHTML = `
          <span style="display:inline-block; width:12px; height:12px; border:2px solid rgba(255,255,255,0.3); border-top-color:#fff; border-radius:50%; animation:schedule-clean-spin 0.65s linear infinite; vertical-align:middle; margin-right:4px;"></span>
          <span>Saving...</span>
        `;

        LoadingOverlay.show('Saving qualified services...');

        try {
          const updated = await ApiClient.assignStaffServices(staff.id, payloadServiceIds);

          const savedServices = (updated && Array.isArray(updated.services))
            ? updated.services
            : payloadServiceIds.map((id) => ({ id, serviceId: id }));

          staff.services = savedServices;

          if (ctx && Array.isArray(ctx.staffList)) {
            const idx = ctx.staffList.findIndex((s) => String(s.id) === String(staff.id));
            if (idx !== -1) {
              ctx.staffList[idx] = {
                ...ctx.staffList[idx],
                ...(updated || {}),
                services: savedServices,
              };
            }
          }

          SalonRepository.invalidate('staff');
          SalonRepository.invalidate('services');

          // Reset baseline to current state
          initialAssignedIds = new Set(assignedServiceIds);
          updateSaveBtnState();

          if (ctx && typeof ctx.showToast === 'function') {
            ctx.showToast(`Services for ${staff.name} saved successfully!`, 'success');
          }
        } catch (err) {
          console.error('[StaffServicesView] Save error:', err);
          updateSaveBtnState();
          if (ctx && typeof ctx.showToast === 'function') {
            ctx.showToast(err.message || 'Failed to save services. Please try again.', 'error');
          }
        } finally {
          LoadingOverlay.hide(150);
        }
      };
    }

    // 3. Unsaved changes guard on Back button
    const backBtn = container.querySelector('#btn-back-to-profile');
    if (backBtn) {
      backBtn.addEventListener('click', async (e) => {
        if (isDirty()) {
          e.preventDefault();
          e.stopPropagation();
          const leave = await CalendarState.confirm({
            title: 'Unsaved Service Changes',
            message: `You have unsaved changes to assigned services for ${staff.name}. Leave without saving?`,
            confirmText: 'Leave Without Saving',
            cancelText: 'Stay & Save',
            icon: '⚠️',
            type: 'warning',
          });
          if (leave) {
            if (ctx && typeof ctx.renderStaffWorkingHours === 'function') {
              ctx.renderStaffWorkingHours(staff.id);
            } else if (ctx && typeof ctx.render === 'function') {
              ctx.render();
            }
          }
        }
      }, true);
    }

  }
}
