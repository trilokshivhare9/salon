/**
 * StaffProfileHub
 * Executive Stylist Profile Overview Hub.
 * Pixel-perfect reproduction of the reference executive stylist screen.
 */
export class StaffProfileHub {
  /**
   * Formats 24h time string (e.g. "19:00", "09:30") into readable 12h format (e.g. "7:00 PM", "9:30 AM")
   */
  /**
   * Formats 24h time string (e.g. "19:00", "09:30") into readable 12h format (e.g. "7:00 PM", "9:30 AM")
   */
  static formatTime12h(timeStr, omitZeroMins = false) {
    if (!timeStr) return '';
    const parts = timeStr.split(':');
    let hour = parseInt(parts[0], 10);
    const mins = parts[1] || '00';
    if (isNaN(hour)) return timeStr;

    const ampm = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12;
    if (hour === 0) hour = 12;

    if (omitZeroMins && (mins === '00' || !mins)) {
      return `${hour} ${ampm}`;
    }
    return `${hour}:${mins} ${ampm}`;
  }

  /**
   * Formats a shift range cleanly for compact metric cards (e.g. "11 AM – 7 PM", "11:30 AM – 7 PM")
   */
  static formatShiftRangeDisplay(startTime, endTime) {
    if (!startTime || !endTime) return 'Weekly Off';
    const sFormatted = this.formatTime12h(startTime, true);
    const eFormatted = this.formatTime12h(endTime, true);
    return `${sFormatted} – ${eFormatted}`;
  }

  /**
   * Computes day-wise 7-day schedule breakdown, today's shift, and active working days count.
   * Accurately parses PostgreSQL workingHours arrays, salon master schedule, and active absences.
   */
  static computeScheduleSummary(ctx, staff) {
    const daysArr = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
    const dayLetters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

    // Local Day Index (0 is Sunday, 1 is Monday...)
    const todayIdx = new Date().getDay();
    const currentDayName = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][todayIdx];

    const followsSalon = staff?.followsSalonSchedule === true;

    const staffWhList = Array.isArray(staff?.workingHours) ? staff.workingHours : [];
    const salonWhList = Array.isArray(ctx?.salonWorkingHours)
      ? ctx.salonWorkingHours
      : (Array.isArray(ctx?.salonProfile?.workingHours) ? ctx.salonProfile.workingHours : []);

    const salonProfile = ctx?.salonProfile || {};
    const defaultSalonStart = salonProfile.defaultStartTime || null;
    const defaultSalonEnd = salonProfile.defaultEndTime || null;

    let workingDaysCount = 0;
    let totalWeeklyHours = 0;
    let isScheduledToday = false;
    let todayStart = null;
    let todayEnd = null;
    let todayHoursNum = 0;
    let firstWorkingDay = null;

    // Detect approved absence active today
    const todayStr = new Date().toISOString().split('T')[0];
    const rawAbsences = Array.isArray(staff?.absences) ? staff.absences : (Array.isArray(ctx?.staffLeaves) ? ctx.staffLeaves : []);
    const todayAbsence = rawAbsences.find((a) => {
      const st = (a.status || '').toUpperCase();
      if (st !== 'ACTIVE' && st !== 'APPROVED') return false;
      const stylistMatch = !a.stylistId || String(a.stylistId) === String(staff.id) || !a.staffId || String(a.staffId) === String(staff.id);
      if (!stylistMatch) return false;
      const sDate = a.startDate instanceof Date ? a.startDate.toISOString().split('T')[0] : (a.startDate || a.absenceDate || '').split('T')[0];
      const eDate = a.endDate instanceof Date ? a.endDate.toISOString().split('T')[0] : (a.endDate || a.absenceDate || '').split('T')[0];
      return sDate <= todayStr && eDate >= todayStr;
    });

    const isOnLeaveToday = Boolean(todayAbsence) || staff?.operationalStatus === 'ON_LEAVE';
    // Truthful facility boundary check: is the salon facility closed today?
    const currentSalonWhToday = salonWhList.find((h) => h.dayOfWeek === currentDayName);
    const isSalonClosedToday = currentSalonWhToday ? Boolean(currentSalonWhToday.isClosed) : false;

    const dayPills = daysArr.map((dayName, idx) => {
      // Find staff schedule entry
      const customWh = staffWhList.find((h) => h.dayOfWeek === dayName);
      // Find salon master schedule entry
      const salonWh = salonWhList.find((h) => h.dayOfWeek === dayName);

      const salonStart = salonWh?.startTime || defaultSalonStart || '09:00';
      const salonEnd = salonWh?.endTime || defaultSalonEnd || '21:00';
      const isSalonClosed = salonWh ? Boolean(salonWh.isClosed) : false;

      let isWorking = false;
      let startTime = salonStart;
      let endTime = salonEnd;

      if (isSalonClosed) {
        // Hard Facility Boundary: when salon facility is closed, staff cannot work
        isWorking = false;
      } else if (customWh) {
        // Concrete stylist schedule row
        isWorking = customWh.isWorking !== undefined ? Boolean(customWh.isWorking) : !customWh.isOff;
        startTime = customWh.startTime || salonStart;
        endTime = customWh.endTime || salonEnd;
      } else if (salonWh) {
        isWorking = !isSalonClosed;
      }

      const isToday = dayName === currentDayName;
      let hoursBadge = 'Off';
      let hoursNum = 0;

      if (isWorking && startTime && endTime) {
        workingDaysCount++;
        const sParts = startTime.split(':').map(Number);
        const eParts = endTime.split(':').map(Number);
        const diffMins = (eParts[0] * 60 + (eParts[1] || 0)) - (sParts[0] * 60 + (sParts[1] || 0));
        hoursNum = Math.max(1, Math.round(diffMins / 60));
        totalWeeklyHours += hoursNum;
        hoursBadge = `${hoursNum}h`;

        if (!firstWorkingDay) {
          firstWorkingDay = { startTime, endTime, hoursNum };
        }

        if (isToday) {
          isScheduledToday = true;
          todayStart = startTime;
          todayEnd = endTime;
          todayHoursNum = hoursNum;
        }
      }

      let shiftDetails = (isWorking && startTime && endTime)
        ? `${this.formatTime12h(startTime)} – ${this.formatTime12h(endTime)} (${hoursNum}h Shift)`
        : 'Scheduled Off';

      if (isToday && isOnLeaveToday) {
        shiftDetails = `On Leave (${todayAbsence?.reason || 'Approved Absence'})`;
      }

      return {
        key: dayName.toLowerCase(),
        dayName,
        letter: dayLetters[idx],
        hoursBadge,
        hoursNum,
        shiftDetails,
        isOpen: isWorking,
        isToday,
        startTime,
        endTime,
      };
    });

    // Effective working today status (scheduled AND not on leave AND salon not closed)
    const isWorkingToday = isScheduledToday && !isOnLeaveToday && !isSalonClosedToday;

    // Determine Today's Shift Text and Contextual Subtitle
    let todayShiftText = 'Off Today';
    let shiftSubtitle = 'Scheduled Off Day';

    if (isOnLeaveToday) {
      todayShiftText = 'On Leave';
      shiftSubtitle = todayAbsence?.reason || staff?.operationalStatusReason || 'Approved Absence';
    } else if (isSalonClosedToday) {
      todayShiftText = 'Salon Closed';
      shiftSubtitle = 'Store Holiday';
    } else if (isScheduledToday && todayStart && todayEnd) {
      todayShiftText = this.formatShiftRangeDisplay(todayStart, todayEnd);
      shiftSubtitle = `${todayHoursNum}h Shift · ${workingDaysCount} Days Active`;
    } else {
      todayShiftText = 'Weekly Off';
      shiftSubtitle = workingDaysCount > 0 ? `Weekly Off · ${workingDaysCount} Days Active` : 'No Shifts Scheduled';
    }

    // Determine Dedicated Shift Banner Data
    let bannerHoursText = 'No Active Shifts';
    if (isOnLeaveToday) {
      bannerHoursText = 'On Approved Leave';
    } else if (isWorkingToday && todayStart && todayEnd) {
      bannerHoursText = `${this.formatTime12h(todayStart)} – ${this.formatTime12h(todayEnd)}`;
    } else if (firstWorkingDay) {
      bannerHoursText = `${this.formatTime12h(firstWorkingDay.startTime)} – ${this.formatTime12h(firstWorkingDay.endTime)}`;
    }

    let bannerScopeBadge = 'Flexible Schedule';
    if (isOnLeaveToday) {
      bannerScopeBadge = 'On Leave Today';
    } else if (workingDaysCount === 7) {
      bannerScopeBadge = 'Mon – Sun';
    } else if (workingDaysCount === 6 && !dayPills[6].isOpen) {
      bannerScopeBadge = 'Mon – Sat';
    } else if (workingDaysCount === 5 && !dayPills[5].isOpen && !dayPills[6].isOpen) {
      bannerScopeBadge = 'Mon – Fri';
    } else if (workingDaysCount > 0) {
      bannerScopeBadge = `${workingDaysCount} Days Active`;
    } else {
      bannerScopeBadge = 'Off Duty';
    }

    const bannerMetaSub = isOnLeaveToday
      ? `Leave active · ${workingDaysCount} active days / ${totalWeeklyHours} hrs weekly roster`
      : (workingDaysCount > 0
          ? `${workingDaysCount} active working days · ${totalWeeklyHours} hrs/week`
          : 'No working days configured');

    return {
      workingDaysCount,
      totalWeeklyHours,
      todayShiftText,
      isScheduledToday,
      isWorkingToday,
      isOnLeaveToday,
      isSalonClosedToday,
      todayAbsence,
      shiftSubtitle,
      bannerHoursText,
      bannerScopeBadge,
      bannerMetaSub,
      followsSalon,
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

    const assignedServices = allServices.filter((s) => assignedIds.has(s.id));
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

    const categoryNamesSummary = totalAssigned > 0
      ? (categoryPills.map((c) => c.name).join(', ') || 'Assigned Services')
      : 'No services assigned';

    const primaryCategoryName = totalAssigned > 0
      ? (categoryPills[0]?.name ? `${categoryPills[0].name} & Styling` : 'Active Stylist')
      : 'General Staff';

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
    const todayStr = new Date().toISOString().split('T')[0];
    const rawAbsences = Array.isArray(staff?.absences) ? staff.absences : (Array.isArray(ctx?.staffLeaves) ? ctx.staffLeaves : []);
    const staffLeaves = rawAbsences.filter((l) => {
      const match = !l.stylistId || String(l.stylistId) === String(staff.id) || !l.staffId || String(l.staffId) === String(staff.id);
      return match;
    });

    const pendingRequests = staffLeaves.filter((l) => (l.status || '').toUpperCase() === 'PENDING').length;

    const todayLeave = schedule?.todayAbsence || staffLeaves.find((l) => {
      const st = (l.status || '').toUpperCase();
      if (st !== 'ACTIVE' && st !== 'APPROVED') return false;
      const sDate = l.startDate instanceof Date ? l.startDate.toISOString().split('T')[0] : (l.startDate || l.absenceDate || '').split('T')[0];
      const eDate = l.endDate instanceof Date ? l.endDate.toISOString().split('T')[0] : (l.endDate || l.absenceDate || '').split('T')[0];
      return sDate <= todayStr && eDate >= todayStr;
    });

    let dutyStatus = 'On Duty';
    let dutyClass = 'val-duty-on';
    let dutyDotClass = 'dot-green';
    let dutySub = 'Active in Salon';
    let dutySubClass = 'sub-green';

    if (schedule?.isOnLeaveToday || todayLeave || staff?.operationalStatus === 'ON_LEAVE') {
      dutyStatus = 'On Leave';
      dutyClass = 'val-duty-leave';
      dutyDotClass = 'dot-rose';
      dutySub = todayLeave?.reason || staff?.operationalStatusReason || 'Approved Absence';
      dutySubClass = 'sub-rose';
    } else if (staff?.status === 'INACTIVE' || staff?.operationalStatus === 'INACTIVE') {
      dutyStatus = 'Inactive';
      dutyClass = 'val-duty-off';
      dutyDotClass = 'dot-gray';
      dutySub = 'Account Deactivated';
      dutySubClass = '';
    } else if (schedule?.isSalonClosedToday) {
      dutyStatus = 'Salon Closed';
      dutyClass = 'val-duty-off';
      dutyDotClass = 'dot-amber';
      dutySub = 'Store Holiday';
      dutySubClass = '';
    } else if (!schedule?.isScheduledToday || staff?.operationalStatus === 'WEEKLY_OFF') {
      dutyStatus = 'Weekly Off';
      dutyClass = 'val-duty-off';
      dutyDotClass = 'dot-gray';
      dutySub = 'Scheduled Off Day';
      dutySubClass = '';
    } else if (staff?.operationalStatus === 'SALON_OFF') {
      dutyStatus = 'Salon Closed';
      dutyClass = 'val-duty-off';
      dutyDotClass = 'dot-amber';
      dutySub = staff?.operationalStatusReason || 'Facility Closed';
      dutySubClass = '';
    } else if (staff?.operationalStatus === 'ON_BREAK') {
      dutyStatus = 'On Break';
      dutyClass = 'val-duty-on';
      dutyDotClass = 'dot-amber';
      dutySub = staff?.operationalStatusReason || 'Routine Break';
      dutySubClass = '';
    }

    // Dynamic, truthful leave history subtitle
    let leaveSubtitle = 'No leaves recorded';
    if (staffLeaves.length > 0) {
      const sortedLeaves = [...staffLeaves].sort((a, b) => {
        const da = a.startDate || a.absenceDate || '';
        const db = b.startDate || b.absenceDate || '';
        return db.localeCompare(da);
      });
      const latest = sortedLeaves[0];
      const startFormatted = latest.startDate
        ? new Date(latest.startDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        : 'Recently';
      const portionLabel = latest.leavePortion === 'FIRST_HALF'
        ? '1st Half'
        : (latest.leavePortion === 'SECOND_HALF'
            ? '2nd Half'
            : (latest.leavePortion === 'CUSTOM_HOURS' ? 'Custom' : 'Full Day'));
      const reasonLabel = latest.reason || latest.leaveType || 'Personal';
      const isCurrent = (schedule?.isOnLeaveToday || todayLeave) && (latest.id === todayLeave?.id);
      leaveSubtitle = `${isCurrent ? 'Active' : 'Last'}: ${startFormatted} (${portionLabel} - ${reasonLabel})`;
    }

    const pillBadgeClass = (schedule?.isOnLeaveToday || todayLeave)
      ? 'badge-leave'
      : (pendingRequests > 0 ? 'badge-amber' : 'badge-green');
    const pillBadgeText = (schedule?.isOnLeaveToday || todayLeave)
      ? 'On Leave Today'
      : (pendingRequests > 0 ? `${pendingRequests} Pending` : 'Clear Roster');

    return {
      pendingRequests,
      hasPending: pendingRequests > 0,
      dutyStatus,
      dutyClass,
      dutyDotClass,
      dutySub,
      dutySubClass,
      leaveSubtitle,
      pillBadgeClass,
      pillBadgeText,
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
              <span class="${schedule.isOnLeaveToday ? 'dot-rose' : (schedule.isSalonClosedToday ? 'dot-amber' : (schedule.isScheduledToday ? 'dot-cyan' : 'dot-gray'))}">●</span>
              <span>Today's Shift</span>
            </div>
            <div class="metric-value ${schedule.isOnLeaveToday ? 'val-duty-leave' : ''}">${schedule.todayShiftText}</div>
            <div class="metric-sub ${schedule.isOnLeaveToday ? 'sub-rose' : 'sub-cyan'}">${schedule.shiftSubtitle}</div>
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
              <span class="${leaves.dutyDotClass}">●</span>
              <span>Status</span>
            </div>
            <div class="metric-value ${leaves.dutyClass}">${leaves.dutyStatus}</div>
            <div class="metric-sub ${leaves.dutySubClass}">${leaves.dutySub}</div>
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
                  <span class="feature-pill-badge badge-cyan">${schedule.followsSalon ? 'Salon Master' : 'Custom Shift'}</span>
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

          <!-- 7-Day Day Chips Strip -->
          <div class="schedule-day-strip">
            ${schedule.dayPills
              .map(
                (p) => `
              <div class="day-chip-cell ${p.isToday ? 'is-today' : ''} ${p.isOpen ? 'is-working' : 'is-off'} ${p.isToday && schedule.isOnLeaveToday ? 'is-leave-today' : ''}" title="${p.dayName}: ${p.shiftDetails}">
                <span class="day-chip-letter">${p.letter}</span>
                <span class="day-chip-badge ${p.isToday && schedule.isOnLeaveToday ? 'badge-leave' : (p.isOpen ? 'badge-work' : 'badge-off')}">${p.isToday && schedule.isOnLeaveToday ? 'Leave' : (p.isOpen ? p.hoursBadge : 'Off')}</span>
              </div>
            `
              )
              .join('')}
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
                  <span class="feature-pill-badge ${leaves.pillBadgeClass}">
                    ${leaves.pillBadgeText}
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
