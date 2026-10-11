/**
 * StaffServicesView
 * Ultra-Clean, Modern & Compact Workspace for Qualified Services.
 * 
 * Design Principles:
 * - Zero extra sections or clunky filter toolbars: single minimal top row with Back button + Auto-save indicator + single "Select All" toggle button.
 * - Modern, round pill-shaped chips (border-radius: 999px) for services: minimum vertical height, maximum readability.
 * - Instant debounced background auto-save via ApiClient without full page reload or layout shift.
 */
export class StaffServicesView {
  static render(ctx, staff) {
    const allServices = ctx.servicesList || [];
    const categories = ctx.categoriesList || [];
    const assignedIds = new Set(
      (staff.services || []).map((s) => (typeof s === 'string' ? s : s.serviceId || s.id))
    );
    const totalServices = allServices.length;
    const totalAssigned = allServices.filter((s) => assignedIds.has(s.id)).length;
    const allAssigned = totalServices > 0 && totalAssigned === totalServices;

    return `
      <div class="staff-workspace-shell staff-services-workspace">
        <!-- Single Sleek Top Bar: Back Link + Live Auto-Saved Status + Live Tally + Single "Select All" Button -->
        <div class="services-minimal-nav">
          <button type="button" class="btn-staff-back" id="btn-back-to-profile" aria-label="Back to ${staff.name}">
            <span class="back-chevron">‹</span>
            <span>Back to ${staff.name}</span>
          </button>

          <div class="services-nav-right">
            <span class="services-live-autosave" title="All changes auto-save automatically">
              <span class="status-autosave-dot">●</span>
              <span>Auto-saved</span>
            </span>

            <div class="workspace-tally-pill" id="services-tally-pill">
              ${totalAssigned}/${totalServices} Assigned
            </div>

            <button type="button" 
                    class="btn-services-toggle-all ${allAssigned ? 'is-all-selected' : ''}" 
                    id="btn-services-toggle-all"
                    title="${allAssigned ? 'Deselect all services' : 'Select all services'}">
              ${allAssigned ? 'Deselect All' : 'Select All'}
            </button>
          </div>
        </div>

        <!-- Body Content: Minimal Category Headings & Horizontal Round Pill Chips -->
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
          `}
        </div>
      </div>
    `;
  }

  static attachListeners(container, ctx, staff) {
    let autoSaveTimeout = null;

    // Recalculate and update tallies dynamically
    const updateCountsAndTally = () => {
      let totalAssigned = 0;
      let totalServices = 0;

      container.querySelectorAll('.stylist-cat-section').forEach((catSec) => {
        const catId = catSec.getAttribute('data-category-id');
        const pills = catSec.querySelectorAll('.stylist-service-pill');
        let catAssigned = 0;

        pills.forEach((pill) => {
          totalServices++;
          if (pill.classList.contains('is-assigned')) {
            catAssigned++;
            totalAssigned++;
          }
        });

        const catTally = catSec.querySelector(`#cat-tally-${catId}`);
        if (catTally) catTally.textContent = `${catAssigned}/${pills.length}`;
      });

      const tallyPill = container.querySelector('#services-tally-pill');
      if (tallyPill) tallyPill.textContent = `${totalAssigned}/${totalServices} Assigned`;

      const toggleAllBtn = container.querySelector('#btn-services-toggle-all');
      if (toggleAllBtn) {
        const isAll = totalServices > 0 && totalAssigned === totalServices;
        toggleAllBtn.textContent = isAll ? 'Deselect All' : 'Select All';
        toggleAllBtn.classList.toggle('is-all-selected', isAll);
      }
    };

    // Auto-save via ApiClient without page reload
    const performAutoSave = async () => {
      const selectedServiceIds = Array.from(
        container.querySelectorAll('.stylist-service-pill.is-assigned')
      ).map((pill) => pill.getAttribute('data-service-id')).filter(Boolean);

      try {
        if (ctx.ApiClient?.assignStaffServices) {
          await ctx.ApiClient.assignStaffServices(staff.id, selectedServiceIds);
        }
        staff.services = selectedServiceIds.map((id) => ({ id }));
      } catch (err) {
        console.error('[StaffServicesView] Auto-save error:', err);
        if (ctx.showToast) {
          ctx.showToast(err.message || 'Failed to auto-save services', 'error');
        }
      }
    };

    // Toggle a single pill
    const togglePill = (pill) => {
      const chk = pill.querySelector('.stylist-service-checkbox');
      if (!chk) return;

      const nextChecked = !chk.checked;
      chk.checked = nextChecked;
      pill.classList.toggle('is-assigned', nextChecked);
      pill.setAttribute('data-is-assigned', nextChecked ? 'true' : 'false');

      const visual = pill.querySelector('.custom-chk-visual');
      if (visual) visual.textContent = nextChecked ? '✓' : '';

      updateCountsAndTally();
      clearTimeout(autoSaveTimeout);
      autoSaveTimeout = setTimeout(() => performAutoSave(), 200);
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

    // 2. Single "Select All" / "Deselect All" Toggle Button
    const toggleAllBtn = container.querySelector('#btn-services-toggle-all');
    if (toggleAllBtn) {
      toggleAllBtn.onclick = (e) => {
        e.preventDefault();
        const allPills = Array.from(container.querySelectorAll('.stylist-service-pill'));
        const totalServices = allPills.length;
        const assignedCount = allPills.filter((p) => p.classList.contains('is-assigned')).length;
        const shouldSelectAll = assignedCount < totalServices;

        allPills.forEach((pill) => {
          const chk = pill.querySelector('.stylist-service-checkbox');
          if (chk) {
            chk.checked = shouldSelectAll;
          }
          pill.classList.toggle('is-assigned', shouldSelectAll);
          pill.setAttribute('data-is-assigned', shouldSelectAll ? 'true' : 'false');
          const visual = pill.querySelector('.custom-chk-visual');
          if (visual) visual.textContent = shouldSelectAll ? '✓' : '';
        });

        toggleAllBtn.textContent = shouldSelectAll ? 'Deselect All' : 'Select All';
        toggleAllBtn.classList.toggle('is-all-selected', shouldSelectAll);

        updateCountsAndTally();
        clearTimeout(autoSaveTimeout);
        performAutoSave();
      };
    }
  }
}
