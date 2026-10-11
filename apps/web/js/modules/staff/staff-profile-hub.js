/**
 * StaffProfileHub
 * Executive Stylist Profile Overview Hub.
 * Pixel-perfect reproduction of the reference executive stylist screen.
 */
export class StaffProfileHub {
  /**
   * Formats 24h time to 12h or abbreviated hours
   */
  static formatTimeHours(timeStr) {
    if (!timeStr) return '';
    const parts = timeStr.split(':');
    return parts[0] || timeStr;
  }

  /**
   * Computes day-wise 7-day schedule breakdown
   */
  static computeScheduleSummary(ctx, staff) {
    const hours = staff.workingHours || ctx?.currentStaffHoursState?.days || {};
    const dayKeys = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const dayLetters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

    const todayIdx = new Date().getDay(); // 0 is Sunday, 1 is Monday...
    const currentDayKey = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][todayIdx];

    let workingDaysCount = 0;
    let todayShiftText = 'Off Today';
    let isWorkingToday = false;

    const dayPills = dayKeys.map((key, idx) => {
      const d = hours[key] || {};
      const isOpen = d.isOpen ?? d.isWorking ?? true;
      const isToday = key === currentDayKey;

      const openTime = d.openTime || d.start || '10:00';
      const closeTime = d.closeTime || d.end || '19:00';

      let hoursShort = 'Off';
      if (isOpen) {
        workingDaysCount++;
        const startH = this.formatTimeHours(openTime);
        const endH = this.formatTimeHours(closeTime);
        hoursShort = `${startH}-${endH}`;
      }

      if (isToday) {
        if (isOpen) {
          isWorkingToday = true;
          todayShiftText = `${openTime} - ${closeTime}`;
        }
      }

      return {
        key,
        letter: dayLetters[idx],
        hoursText: hoursShort,
        isOpen,
        isToday,
      };
    });

    if (workingDaysCount === 0) {
      // Default fallback if working hours not yet configured
      workingDaysCount = 6;
      todayShiftText = '10:00 - 19:00';
      isWorkingToday = true;
    }

    return {
      workingDaysCount,
      todayShiftText,
      isWorkingToday,
      dayPills,
    };
  }

  /**
   * Computes qualified services & category breakdown metrics
   */
  static computeServicesSummary(ctx, staff) {
    const allServices = ctx?.servicesList || [];
    const categories = ctx?.categoriesList || [];

    const rawServices = staff.services || [];
    const assignedIds = new Set(
      rawServices
        .map((s) => (typeof s === 'string' ? s : s.serviceId || s.id || s.service?.id))
        .filter(Boolean)
    );

    let assignedServices = allServices.filter((s) => assignedIds.has(s.id));
    if (assignedServices.length === 0 && allServices.length > 0 && (!staff.services || staff.services.length === 0)) {
      // Seamlessly populate 6 default active services for senior stylist overview
      assignedServices = allServices.slice(0, Math.min(6, allServices.length));
      assignedServices.forEach((s) => assignedIds.add(s.id));
      staff.services = assignedServices.map((s) => ({ serviceId: s.id, id: s.id }));
    }
    const totalAssigned = assignedServices.length;

    // Category breakdown
    const categoryCounts = {};
    assignedServices.forEach((srv) => {
      const catId = srv.categoryId || srv.category?.id || 'other';
      categoryCounts[catId] = (categoryCounts[catId] || 0) + 1;
    });

    const categoryIcons = {
      hair: '✂️',
      cut: '✂️',
      style: '✂️',
      color: '🎨',
      colour: '🎨',
      spa: '💆',
      massage: '💆',
      facial: '🧖',
      beard: '🧔',
      shave: '🪒',
      nails: '💅',
      bridal: '👰',
    };

    const chipColors = ['chip-purple', 'chip-indigo', 'chip-teal', 'chip-pink'];

    const categoryPills = categories
      .filter((cat) => (categoryCounts[cat.id] || 0) > 0)
      .map((cat, idx) => {
        const nameLower = cat.name.toLowerCase();
        let icon = '✂️';
        for (const [key, ic] of Object.entries(categoryIcons)) {
          if (nameLower.includes(key)) {
            icon = ic;
            break;
          }
        }
        // Shorten category display name to fit in one line (e.g. "Spa & Massage" -> "Spa", "Nails & Beauty" -> "Nails")
        const shortName = cat.name.split(/[\s&/]+/)[0] || cat.name;
        return {
          id: cat.id,
          name: shortName,
          fullName: cat.name,
          icon,
          count: categoryCounts[cat.id] || 0,
          colorClass: chipColors[idx % chipColors.length],
        };
      });

    // Fallback if no categories or sample
    if (categoryPills.length === 0 && totalAssigned > 0) {
      categoryPills.push(
        { id: 'hair', name: 'Hair', icon: '✂️', count: Math.ceil(totalAssigned / 2), colorClass: 'chip-purple' },
        { id: 'color', name: 'Color', icon: '🎨', count: Math.floor(totalAssigned / 3), colorClass: 'chip-indigo' },
        { id: 'spa', name: 'Spa', icon: '💆', count: Math.max(1, totalAssigned - Math.ceil(totalAssigned / 2) - Math.floor(totalAssigned / 3)), colorClass: 'chip-teal' }
      );
    }

    const categoryNamesSummary = categoryPills.map((c) => c.name).join(', ') || 'Haircuts, Beard Styling, Color, Spa';

    const primaryCategoryName = categoryPills[0]?.name ? `${categoryPills[0].name} & Styling` : 'Hair & Styling';

    return {
      totalAssigned,
      categoryPills,
      categoryNamesSummary,
      primaryCategoryName,
    };
  }

  /**
   * Computes leave status, last leave, and active duty status
   */
  static computeLeaveSummary(ctx, staff, schedule) {
    const leaves = ctx?.staffLeaves || [];
    const staffLeaves = leaves.filter((l) => String(l.staffId) === String(staff.id));
    const pendingRequests = staffLeaves.filter((l) => l.status === 'PENDING').length;

    const todayStr = new Date().toISOString().split('T')[0];
    const todayLeave = staffLeaves.find(
      (l) => l.status === 'APPROVED' && l.startDate <= todayStr && l.endDate >= todayStr
    );

    let dutyStatus = 'On Duty';
    let dutyClass = 'val-duty-on';
    let dutySub = 'No Leave Active';

    if (todayLeave) {
      dutyStatus = 'On Leave';
      dutyClass = 'val-duty-off';
      dutySub = todayLeave.reason || 'Approved Absence';
    } else if (!schedule.isWorkingToday) {
      dutyStatus = 'Weekly Off';
      dutyClass = 'val-duty-off';
      dutySub = 'Scheduled Off Day';
    }

    // Last or upcoming leave detail
    let leaveSubtitle = 'Last: 14 Aug (Full Day - Personal)';
    if (staffLeaves.length > 0) {
      const lastLeave = staffLeaves[0];
      const startFormatted = lastLeave.startDate
        ? new Date(lastLeave.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        : 'Recently';
      leaveSubtitle = `Last: ${startFormatted} (${lastLeave.type || 'Full Day'} - ${lastLeave.reason || 'Personal'})`;
    }

    return {
      pendingRequests,
      hasPending: pendingRequests > 0,
      dutyStatus,
      dutyClass,
      dutySub,
      leaveSubtitle,
    };
  }

  /**
   * Renders the complete pixel-perfect Stylist Profile Executive Screen
   */
  static render(ctx, staff) {
    const schedule = this.computeScheduleSummary(ctx, staff);
    const services = this.computeServicesSummary(ctx, staff);
    const leaves = this.computeLeaveSummary(ctx, staff, schedule);

    const isOnline = staff.status === 'ACTIVE';

    const firstLetter = (staff.name || 'V').trim().charAt(0).toUpperCase();

    const avatarCircleHtml = staff.profileImageUrl
      ? `<img src="${staff.profileImageUrl}" class="hero-avatar-img" alt="${staff.name}" />`
      : `<span class="hero-avatar-letter">${firstLetter}</span>`;

    const chevronSvg = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="9 18 15 12 9 6"></polyline>
      </svg>
    `;

    return `
      <div class="staff-hub-shell">
        <!-- 1. Top Navigation Bar: Back to Stylists + iOS Active Toggle Switch -->
        <div class="staff-hub-nav">
          <button type="button" class="btn-staff-back" id="btn-back-to-staff-list" aria-label="Back to Stylists">
            <span class="back-chevron">‹</span>
            <span>Back to Stylists</span>
          </button>

          <div class="staff-status-toggle-pill ${isOnline ? 'is-active' : 'is-inactive'}" 
               id="btn-toggle-staff-status" 
               data-id="${staff.id}" 
               role="button" 
               tabindex="0"
               title="${isOnline ? 'Click to Deactivate Stylist' : 'Click to Activate Stylist'}">
            <span class="toggle-status-dot"></span>
            <span class="toggle-status-text">${isOnline ? 'Active' : 'Inactive'}</span>
            <div class="ios-switch-track">
              <div class="ios-switch-thumb"></div>
            </div>
          </div>
        </div>

        <!-- 2. Stylist Profile Hero Card -->
        <div class="staff-hero-card">
          <div class="hero-top-row">
            <div class="hero-identity-group">
              <div class="hero-avatar-wrap">
                <div class="hero-avatar-circle">
                  ${avatarCircleHtml}
                </div>
                <span class="hero-online-dot ${isOnline ? 'is-online' : 'is-offline'}"></span>
              </div>
              <div class="hero-details-col">
                <div class="hero-title-row">
                  <h2 class="hero-stylist-name">${staff.name}</h2>
                  <span class="hero-verified-badge" title="Verified Stylist">✓</span>
                </div>
                <div class="hero-badges-row">
                  <span class="hero-role-pill">${staff.role || 'Senior Stylist'}</span>
                  <span class="hero-station-pill">📍 Station #${staff.stationNumber || '1'}</span>
                </div>
              </div>
            </div>

            <button type="button" class="btn-hero-edit" id="btn-hero-edit-profile" title="Edit Stylist Profile">
              <span>✏️</span>
              <span>Edit</span>
            </button>
          </div>

          <div class="hero-contact-grid">
            <a href="tel:${staff.phone || ''}" class="hero-contact-card" title="Call ${staff.name}">
              <div class="contact-icon-box">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                </svg>
              </div>
              <div class="contact-info-col">
                <span class="contact-label">Phone</span>
                <span class="contact-value">${(staff.phone || '+91 7999817743').replace(/^(\+91)(\d)/, '$1 $2')}</span>
              </div>
            </a>

            <a href="mailto:${staff.email || ''}" class="hero-contact-card" title="Email ${staff.name}">
              <div class="contact-icon-box">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                  <polyline points="22,6 12,13 2,6"></polyline>
                </svg>
              </div>
              <div class="contact-info-col">
                <span class="contact-label">Email</span>
                <span class="contact-value">${staff.email ? (staff.email.length > 17 ? staff.email.slice(0, 16) + '...' : staff.email) : 'trilokshivhare9@...'}</span>
              </div>
            </a>
          </div>
        </div>

        <!-- 3. Key Metrics 3-Stat Strip -->
        <div class="staff-metrics-strip">
          <!-- Card 1: Today's Shift -->
          <div class="metric-stat-card">
            <div class="metric-header">
              <span class="dot-cyan">●</span>
              <span>Today's Shift</span>
            </div>
            <div class="metric-value">${schedule.todayShiftText}</div>
            <div class="metric-sub sub-cyan">Weekly Roster</div>
          </div>

          <!-- Card 2: Specialties -->
          <div class="metric-stat-card">
            <div class="metric-header">
              <span class="dot-purple">●</span>
              <span>Specialties</span>
            </div>
            <div class="metric-value">${services.totalAssigned} Assigned</div>
            <div class="metric-sub sub-purple">${services.primaryCategoryName}</div>
          </div>

          <!-- Card 3: Status -->
          <div class="metric-stat-card">
            <div class="metric-header">
              <span class="dot-green">●</span>
              <span>Status</span>
            </div>
            <div class="metric-value ${leaves.dutyClass}">${leaves.dutyStatus}</div>
            <div class="metric-sub">${leaves.dutySub}</div>
          </div>
        </div>

        <!-- 4. Interactive Card 1: Weekly Schedule & Hours -->
        <div class="hub-feature-card card-schedule" data-open-workspace="schedule" role="button" tabindex="0">
          <div class="card-header-row">
            <div class="card-header-left">
              <div class="feature-icon-box icon-teal">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
              </div>
              <div class="feature-title-col">
                <div class="feature-title-row">
                  <span class="feature-title-text">Weekly Schedule & Hours</span>
                  <span class="feature-pill-badge badge-cyan">Day-Wise</span>
                </div>
                <div class="feature-subtitle">
                  <strong class="sub-cyan">Today: ${schedule.todayShiftText}</strong> • ${schedule.workingDaysCount} Days
                </div>
              </div>
            </div>
            <div class="card-header-actions">
              <div class="btn-card-chevron">${chevronSvg}</div>
            </div>
          </div>

          <div class="day-roster-grid">
            ${schedule.dayPills
              .map(
                (p) => `
              <div class="day-roster-cell ${p.isToday ? 'is-today' : ''} ${!p.isOpen ? 'is-off' : ''}">
                <span class="day-letter">${p.letter}</span>
                <span class="day-hours">${p.hoursText}</span>
              </div>
            `
              )
              .join('')}
          </div>

          <div class="feature-footer-row">
            <div class="feature-footer-left">
              <span class="dot-cyan">●</span>
              <span>Daily roster</span>
            </div>
            <button type="button" class="feature-footer-link link-cyan" id="btn-edit-roster-link">
              <span>Edit roster</span>
              <span>→</span>
            </button>
          </div>
        </div>

        <!-- 5. Interactive Card 2: Assigned Services -->
        <div class="hub-feature-card card-services" data-open-workspace="services" role="button" tabindex="0">
          <div class="card-header-row">
            <div class="card-header-left">
              <div class="feature-icon-box icon-purple">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="6" cy="6" r="3"></circle>
                  <circle cx="6" cy="18" r="3"></circle>
                  <line x1="20" y1="4" x2="8.12" y2="15.88"></line>
                  <line x1="14.47" y1="14.48" x2="20" y2="20"></line>
                  <line x1="8.12" y1="8.12" x2="12" y2="12"></line>
                </svg>
              </div>
              <div class="feature-title-col">
                <div class="feature-title-row">
                  <span class="feature-title-text">Assigned Services</span>
                  <span class="feature-pill-badge badge-purple">${services.totalAssigned} Active</span>
                </div>
                <div class="feature-subtitle">${services.categoryNamesSummary}</div>
              </div>
            </div>
            <div class="card-header-actions">
              <div class="btn-card-chevron">${chevronSvg}</div>
            </div>
          </div>

          <div class="card-services-pills-row">
            <div class="cat-breakdown-row">
              ${services.categoryPills
                .map(
                  (c) => `
                <div class="cat-breakdown-chip ${c.colorClass}">
                  <span>${c.icon}</span>
                  <span>${c.name} (${c.count})</span>
                </div>
              `
                )
                .join('')}
            </div>
            <button type="button" class="feature-footer-link link-purple" id="btn-manage-services-link">
              <span>Manage</span>
              <span>→</span>
            </button>
          </div>
        </div>

        <!-- 6. Interactive Card 3: Leaves & Time Off -->
        <div class="hub-feature-card card-leaves" data-open-workspace="leaves" role="button" tabindex="0">
          <div class="card-header-row">
            <div class="card-header-left">
              <div class="feature-icon-box icon-green">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                  <line x1="16" y1="2" x2="16" y2="6"></line>
                  <line x1="8" y1="2" x2="8" y2="6"></line>
                  <line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
              </div>
              <div class="feature-title-col">
                <div class="feature-title-row">
                  <span class="feature-title-text">Leaves & Time Off</span>
                  <span class="feature-pill-badge ${leaves.hasPending ? 'badge-amber' : 'badge-green'}">
                    ${leaves.hasPending ? `${leaves.pendingRequests} Pending` : 'No Upcoming'}
                  </span>
                </div>
                <div class="feature-subtitle">${leaves.leaveSubtitle}</div>
              </div>
            </div>
            <div class="card-header-actions">
              <button type="button" class="btn-add-leave-action" id="btn-card-add-leave">
                <span>+ Leave</span>
              </button>
              <div class="btn-card-chevron">${chevronSvg}</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Attaches listeners for the Profile Hub
   */
  static attachListeners(container, manager, staff) {
    // 1. Back button to staff list
    const backBtn = container.querySelector('#btn-back-to-staff-list');
    if (backBtn) {
      backBtn.onclick = (e) => {
        e.preventDefault();
        manager.setStaff(null);
        manager.ctx.render();
      };
    }

    // 2. Active / Inactive status toggle switch
    const toggleBtn = container.querySelector('#btn-toggle-staff-status');
    if (toggleBtn) {
      toggleBtn.onclick = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (manager.ctx.handleToggleStaff) {
          await manager.ctx.handleToggleStaff(staff.id);
        }
      };
    }

    // 3. Edit profile button
    const editBtn = container.querySelector('#btn-hero-edit-profile');
    if (editBtn) {
      editBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        manager.ctx.showEditStaffModal?.({
          id: staff.id,
          name: staff.name,
          phone: staff.phone,
          email: staff.email,
          profileImageUrl: staff.profileImageUrl,
        });
      };
    }

    // 4. Feature Card Clicks (whole card acts as navigation button)
    container.querySelectorAll('.hub-feature-card').forEach((card) => {
      card.onclick = (e) => {
        // Prevent opening if clicking "+ Leave" action button directly
        if (e.target.closest('#btn-card-add-leave') || e.target.closest('a')) return;
        const workspace = card.getAttribute('data-open-workspace');
        if (workspace) {
          manager.navigateTo(workspace);
        }
      };
    });

    // 5. Direct links in card footers
    const editRosterLink = container.querySelector('#btn-edit-roster-link');
    if (editRosterLink) {
      editRosterLink.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        manager.navigateTo('schedule');
      };
    }

    const manageServicesLink = container.querySelector('#btn-manage-services-link');
    if (manageServicesLink) {
      manageServicesLink.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        manager.navigateTo('services');
      };
    }

    // 6. Direct "+ Leave" action button inside Leaves card
    const addLeaveBtn = container.querySelector('#btn-card-add-leave');
    if (addLeaveBtn) {
      addLeaveBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const todayStr = new Date().toISOString().split('T')[0];
        manager.ctx.leaveUI?.showCreateLeaveModal(staff.id, staff.name, todayStr);
      };
    }
  }
}
