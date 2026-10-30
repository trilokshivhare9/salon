import { ApiClient } from '../../api.js';
import { ScheduleDayOffDialog } from '../salon-settings/schedule-day-off-dialog.js';
import { CalendarState } from '../calendar/calendar-state.js';

/**
 * StaffApplyLeaveDialog
 * Dedicated, production-grade dialog component for recording Specialist / Stylist Leaves.
 * 
 * Supports:
 * - Dual Context: Salon View (with stylist dropdown & Whole Salon tab switch) vs
 *                 Staff Workspace (pre-locked to specific stylist).
 * - Compact top-date range selector (From ➔ To).
 * - Full Day or Partial Hours Window (no confusing "first/second half" domain mismatch).
 * - 5 Sleek Category Chips (Sick, Casual, Emergency, Unpaid, Other).
 * - WhatsApp booking protection & real-time calendar synchronization.
 */
export class StaffApplyLeaveDialog {
  /**
   * Opens the Specialist Leave modal.
   * @param {Object} options
   * @param {string} [options.staffId] - Preselected staff ID (locks dropdown if provided)
   * @param {string} [options.staffName] - Preselected staff name
   * @param {string} [options.initialDate] - YYYY-MM-DD
   * @param {boolean} [options.showModeSwitch=false] - Whether to show Whole Salon vs Specialist toggle
   * @param {Array} [options.salonWorkingHours] - Salon schedule array
   * @param {Array} [options.staffList] - Active stylists list
   * @param {Function} [options.onSuccess] - Callback when leave is recorded
   */
  static async open(options = {}) {
    const modalContainer = document.getElementById('modal-container');
    if (!modalContainer) return;

    const initialDate = options.initialDate || new Date().toISOString().split('T')[0];
    const todayStr = new Date().toISOString().split('T')[0];
    const fixedStaffId = options.staffId || null;
    const fixedStaffName = options.staffName || null;
    const showModeSwitch = options.showModeSwitch ?? !fixedStaffId;
    const salonWorkingHours = options.salonWorkingHours || window.salonDashboard?.salonWorkingHours || window.dashboardApp?.salonWorkingHours || [];
    let staffList = options.staffList || window.salonDashboard?.staffList || window.dashboardApp?.staffList || [];
    const onSuccess = options.onSuccess || (() => {});

    // Friendly date header
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const dtInit = new Date(initialDate + 'T00:00:00');
    const friendlyDate = !isNaN(dtInit.getTime())
      ? `${days[dtInit.getDay()]}, ${dtInit.getDate()} ${months[dtInit.getMonth()]} ${dtInit.getFullYear()}`
      : initialDate;

    // Determine default stylist ID (locks to fixed staff or defaults to first available stylist)
    const defaultStaffId = fixedStaffId || (Array.isArray(staffList) && staffList.length > 0 ? staffList[0].id : null);

    // Helper: format 24-hr string ("18:00") to 12-hr string ("06:00 PM")
    const formatTimeTo12Hour = (time24) => {
      if (!time24 || typeof time24 !== 'string') return '';
      const [hStr, mStr] = time24.split(':');
      let hours = parseInt(hStr, 10);
      const minutes = mStr ? mStr.padStart(2, '0') : '00';
      if (isNaN(hours)) return time24;
      const ampm = hours >= 12 ? 'PM' : 'AM';
      hours = hours % 12;
      hours = hours ? hours : 12;
      return `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
    };

    // Helper: timezone-safe day of week extraction from YYYY-MM-DD
    const getDayOfWeekFromDate = (dateStr) => {
      const dayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
      if (!dateStr) return 'MONDAY';
      const parts = dateStr.split('-');
      if (parts.length !== 3) return 'MONDAY';
      const [y, m, d] = parts.map(Number);
      const dt = new Date(y, m - 1, d);
      return !isNaN(dt.getTime()) ? dayNames[dt.getDay()] : 'MONDAY';
    };

    // Helper: parse "HH:mm" to minutes
    const timeToMinutes = (timeStr) => {
      if (!timeStr) return 0;
      const [h, m] = timeStr.split(':').map(Number);
      return (h || 0) * 60 + (m || 0);
    };

    // Calculate initial shift display synchronously to eliminate "Loading..." flash
    const initialDayOfWeek = getDayOfWeekFromDate(initialDate);
    const initialSalonWh = salonWorkingHours.find((h) => String(h.dayOfWeek).toUpperCase() === initialDayOfWeek);
    const initialIsClosed = initialSalonWh ? Boolean(initialSalonWh.isClosed) : false;
    const initialStart12 = formatTimeTo12Hour(initialSalonWh?.startTime || '09:00');
    const initialEnd12 = formatTimeTo12Hour(initialSalonWh?.endTime || '21:00');
    const initialDayCap = initialDayOfWeek.charAt(0) + initialDayOfWeek.slice(1).toLowerCase();
    const initialShiftLabelText = initialIsClosed
      ? `💤 Weekly Off (${initialDayCap})`
      : `🕒 Working Shift: ${initialStart12} - ${initialEnd12}`;
    const initialShiftLabelColor = initialIsClosed ? '#f59e0b' : '#c084fc';

    // Helper: build staff options for select with guaranteed active selection
    const buildStaffOptions = (list, selectedId) => {
      if (!list || list.length === 0) {
        return '<option value="" disabled selected>-- Loading Specialists... --</option>';
      }
      const targetId = selectedId || list[0].id;
      return list.map((s) => {
        const isSel = s.id === targetId ? 'selected' : '';
        const roleLabel = s.role ? ` (${s.role})` : (s.phone ? ` (${s.phone})` : '');
        return `<option value="${s.id}" ${isSel}>${s.name}${roleLabel}</option>`;
      }).join('');
    };

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content modal-content-sheet" style="max-width: 480px; width: 100%; margin: auto; padding: 18px 20px; border: 1px solid rgba(168, 85, 247, 0.25); border-radius: 16px; background: #0f172a; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.85);">
          <div class="sheet-grab-handle"></div>
          
          <!-- Header -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <div>
              <h3 style="font-size: 1.1rem; font-weight: 800; color: #fff; margin: 0; display: flex; align-items: center; gap: 8px;">
                <span>👤 Record Specialist Leave</span>
              </h3>
              <p style="color: #94a3b8; font-size: 0.74rem; margin: 2px 0 0 0;">${friendlyDate} • Stylist Leave & Protection</p>
            </div>
            <button class="close-btn" id="btn-close-leave-dialog" style="width: 28px; height: 28px; font-size: 1.1rem; background: rgba(255,255,255,0.06); border: none; border-radius: 50%; color: #94a3b8; cursor: pointer; display: flex; align-items: center; justify-content: center;">&times;</button>
          </div>

          <!-- Segmented Tab: Only visible if opened in salon context -->
          ${showModeSwitch ? `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; background: rgba(15, 23, 42, 0.6); padding: 3px; border-radius: 999px; border: 1px solid rgba(255, 255, 255, 0.08); margin-bottom: 12px;">
              <button type="button" class="btn btn-sm" id="btn-switch-to-salon-off" style="border: none; border-radius: 999px; font-size: 0.75rem; font-weight: 700; background: transparent; color: #94a3b8; padding: 6px; cursor: pointer; transition: all 0.15s ease;">
                🌴 Whole Salon Off
              </button>
              <button type="button" class="btn btn-sm" style="border: none; border-radius: 999px; font-size: 0.75rem; font-weight: 700; background: rgba(139, 61, 255, 0.35); color: #fff; padding: 6px; cursor: default;">
                👤 Specialist Leave
              </button>
            </div>
          ` : ''}

          <!-- Form -->
          <form id="form-apply-specialist-leave" style="display: flex; flex-direction: column; gap: 10px;">
            
            <!-- 1. SPECIALIST SELECTION (TOP) -->
            ${fixedStaffId ? `
              <input type="hidden" id="leave-staff-select" value="${fixedStaffId}" />
              <div style="background: rgba(168, 85, 247, 0.1); border: 1px solid rgba(168, 85, 247, 0.25); border-radius: 8px; padding: 7px 10px; display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 1rem;">👤</span>
                <div>
                  <div style="font-size: 0.78rem; font-weight: 700; color: #d8b4fe;">${fixedStaffName || 'Specialist'}</div>
                  <div style="font-size: 0.68rem; color: #94a3b8;">Applying absence for this specialist</div>
                </div>
              </div>
            ` : `
              <div style="display: flex; flex-direction: column; gap: 3px;">
                <label style="font-size: 0.67rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.4px;">Select Specialist / Stylist *</label>
                <div class="custom-select-container" id="leave-staff-select-container" style="position: relative;">
                  <button type="button" class="custom-select-trigger" id="leave-staff-trigger" style="width: 100%; height: 34px; background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(168, 85, 247, 0.35); border-radius: 7px; padding: 0 10px; color: #fff; font-size: 0.74rem; font-weight: 600; display: flex; align-items: center; justify-content: space-between; cursor: pointer; user-select: none;">
                    <span id="leave-staff-selected-label" style="display: flex; align-items: center; gap: 7px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                      <span id="leave-staff-name-text">Select specialist...</span>
                    </span>
                    <span class="custom-select-chevron" style="font-size: 0.65rem; color: #94a3b8;">▼</span>
                  </button>
                  <div class="custom-select-menu" id="leave-staff-menu">
                    <!-- Stylist options rendered dynamically -->
                  </div>
                  <select id="leave-staff-select" required style="display: none;">
                    ${buildStaffOptions(staffList, defaultStaffId)}
                  </select>
                </div>
              </div>
            `}

            <!-- Scoped styling for sleek professional inputs -->
            <style>
              .leave-modern-input {
                width: 100% !important;
                height: 32px !important;
                background: rgba(15, 23, 42, 0.75) !important;
                border: 1px solid rgba(255, 255, 255, 0.12) !important;
                border-radius: 7px !important;
                padding: 0 10px !important;
                color: #f1f5f9 !important;
                font-size: 0.73rem !important;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
                box-sizing: border-box !important;
                outline: none !important;
                transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
              }
              .leave-modern-input:focus {
                border-color: rgba(168, 85, 247, 0.7) !important;
                box-shadow: 0 0 0 2px rgba(168, 85, 247, 0.16) !important;
                background: rgba(15, 23, 42, 0.95) !important;
              }
              .leave-modern-input::placeholder {
                color: #64748b !important;
                font-size: 0.70rem !important;
                font-weight: 400 !important;
              }
              .leave-type-chip:hover {
                filter: brightness(1.12);
              }
              .leave-ideas-select {
                appearance: none !important;
                -webkit-appearance: none !important;
                -moz-appearance: none !important;
                background-color: rgba(15, 23, 42, 0.75) !important;
                background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%2394a3b8'%3E%3Cpath fill-rule='evenodd' d='M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z' clip-rule='evenodd'/%3E%3C/svg%3E") !important;
                background-repeat: no-repeat !important;
                background-position: right 10px center !important;
                background-size: 14px 14px !important;
                padding-right: 28px !important;
                padding-left: 10px !important;
              }
            </style>

            <!-- 2. DATE SELECTION + SHIFT CARD (SECOND) -->
            <div style="background: rgba(255, 255, 255, 0.025); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 9px 11px; display: flex; flex-direction: column; gap: 7px;">
              <div style="display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px;">
                <div style="display: flex; flex-direction: column; gap: 2px;">
                  <label for="leave-input-start-date" style="font-size: 0.68rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.4px;">From Date</label>
                  <input type="date" id="leave-input-start-date" value="${initialDate}" min="${todayStr}" required style="height: 32px !important; background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 7px; padding: 0 8px; color: #fff; font-size: 0.74rem !important; font-weight: 600;" />
                </div>
                <div style="color: #64748b; font-size: 0.85rem; font-weight: bold; margin-top: 14px; text-align: center;">➔</div>
                <div style="display: flex; flex-direction: column; gap: 2px;">
                  <label for="leave-input-end-date" style="font-size: 0.68rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.4px;">To Date</label>
                  <input type="date" id="leave-input-end-date" value="${initialDate}" min="${initialDate}" required style="height: 32px !important; background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 7px; padding: 0 8px; color: #fff; font-size: 0.74rem !important; font-weight: 600;" />
                </div>
              </div>

              <!-- Single-Day Operating Shift & Partial Day Toggle -->
              <div id="leave-single-day-section" style="display: flex; justify-content: space-between; align-items: center; gap: 8px; padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.06); flex-wrap: nowrap;">
                <div style="font-size: 0.72rem; font-weight: 600; color: ${initialShiftLabelColor}; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;" id="leave-day-shift-label">
                  ${initialShiftLabelText}
                </div>
                <label id="leave-toggle-partial-wrapper" style="display: inline-flex; align-items: center; gap: 5px; font-size: 0.71rem; color: #cbd5e1; cursor: pointer; user-select: none; white-space: nowrap; flex-shrink: 0;">
                  <input type="checkbox" id="leave-toggle-partial" style="accent-color: #a855f7; cursor: pointer; margin: 0;" />
                  <span>Partial hours</span>
                </label>
              </div>

              <!-- Multi-Day Notice (visible when From !== To) -->
              <div id="leave-multi-day-section" style="display: none; align-items: center; gap: 6px; padding-top: 6px; border-top: 1px solid rgba(255, 255, 255, 0.06); font-size: 0.72rem; color: #94a3b8;">
                <span>📅</span>
                <span id="leave-multi-day-text">Multi-Day Leave (Full Day Absence)</span>
              </div>

              <!-- Collapsible Partial Hours inputs -->
              <div id="leave-partial-hours-inputs" style="display: none; flex-direction: column; gap: 6px; padding-top: 6px; border-top: 1px dashed rgba(255, 255, 255, 0.1);">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <div style="flex: 1;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                      <label style="font-size: 0.66rem; color: #94a3b8;">Leave From</label>
                      <span id="leave-start-12h-badge" style="font-size: 0.66rem; font-weight: 700; color: #c084fc;"></span>
                    </div>
                    <input type="time" id="leave-custom-start" style="width: 100%; height: 30px; background: rgba(15,23,42,0.9); border: 1px solid rgba(168,85,247,0.4); border-radius: 6px; color: #fff; padding: 0 8px; font-size: 0.76rem; transition: border-color 0.2s ease;" />
                  </div>
                  <span style="color: #64748b; font-size: 0.74rem; margin-top: 14px;">to</span>
                  <div style="flex: 1;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                      <label style="font-size: 0.66rem; color: #94a3b8;">Leave Until</label>
                      <span id="leave-end-12h-badge" style="font-size: 0.66rem; font-weight: 700; color: #c084fc;"></span>
                    </div>
                    <input type="time" id="leave-custom-end" style="width: 100%; height: 30px; background: rgba(15,23,42,0.9); border: 1px solid rgba(168,85,247,0.4); border-radius: 6px; color: #fff; padding: 0 8px; font-size: 0.76rem; transition: border-color 0.2s ease;" />
                  </div>
                </div>
                <div id="leave-partial-validation-error" style="display: none; font-size: 0.7rem; color: #f87171; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px; padding: 4px 8px; align-items: center; gap: 6px;">
                  <span>⚠️</span>
                  <span id="leave-partial-validation-text"></span>
                </div>
              </div>
            </div>

            <!-- Weekly Off Warning Container -->
            <div id="leave-weekly-off-warning" style="display: none;"></div>

            <!-- Leave Type (Proportional flex row: Emergency gets 1.35x width so it never overflows) -->
            <div>
              <label style="font-size: 0.67rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.4px; display: block; margin-bottom: 4px;">Leave Type</label>
              <div style="display: flex; gap: 4px; width: 100%;">
                <label class="leave-type-chip" data-value="SICK_LEAVE" data-color="#f87171" style="flex: 1; border: 1px solid #ef4444; background: rgba(239, 68, 68, 0.16); color: #f87171; border-radius: 7px; height: 30px; display: flex; align-items: center; justify-content: center; gap: 3px; cursor: pointer; font-size: 0.67rem; font-weight: 600; padding: 0 3px; white-space: nowrap; user-select: none; box-sizing: border-box;">
                  <input type="radio" name="staffLeaveType" value="SICK_LEAVE" checked style="display: none;" />
                  <span style="font-size: 0.76rem; line-height: 1; flex-shrink: 0;">🤒</span>
                  <span>Sick</span>
                </label>
                <label class="leave-type-chip" data-value="CASUAL_LEAVE" data-color="#34d399" style="flex: 1; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); color: #94a3b8; border-radius: 7px; height: 30px; display: flex; align-items: center; justify-content: center; gap: 3px; cursor: pointer; font-size: 0.67rem; font-weight: 600; padding: 0 3px; white-space: nowrap; user-select: none; box-sizing: border-box;">
                  <input type="radio" name="staffLeaveType" value="CASUAL_LEAVE" style="display: none;" />
                  <span style="font-size: 0.76rem; line-height: 1; flex-shrink: 0;">🌴</span>
                  <span>Casual</span>
                </label>
                <label class="leave-type-chip" data-value="EMERGENCY_LEAVE" data-color="#fbbf24" style="flex: 1.35; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); color: #94a3b8; border-radius: 7px; height: 30px; display: flex; align-items: center; justify-content: center; gap: 3px; cursor: pointer; font-size: 0.67rem; font-weight: 600; padding: 0 3px; white-space: nowrap; user-select: none; box-sizing: border-box;">
                  <input type="radio" name="staffLeaveType" value="EMERGENCY_LEAVE" style="display: none;" />
                  <span style="font-size: 0.76rem; line-height: 1; flex-shrink: 0;">🚨</span>
                  <span>Emergency</span>
                </label>
                <label class="leave-type-chip" data-value="UNPAID_LEAVE" data-color="#a78bfa" style="flex: 1; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); color: #94a3b8; border-radius: 7px; height: 30px; display: flex; align-items: center; justify-content: center; gap: 3px; cursor: pointer; font-size: 0.67rem; font-weight: 600; padding: 0 3px; white-space: nowrap; user-select: none; box-sizing: border-box;">
                  <input type="radio" name="staffLeaveType" value="UNPAID_LEAVE" style="display: none;" />
                  <span style="font-size: 0.76rem; line-height: 1; flex-shrink: 0;">📄</span>
                  <span>Unpaid</span>
                </label>
                <label class="leave-type-chip" data-value="OTHER" data-color="#cbd5e1" style="flex: 0.85; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); color: #94a3b8; border-radius: 7px; height: 30px; display: flex; align-items: center; justify-content: center; gap: 3px; cursor: pointer; font-size: 0.67rem; font-weight: 600; padding: 0 3px; white-space: nowrap; user-select: none; box-sizing: border-box;">
                  <input type="radio" name="staffLeaveType" value="OTHER" style="display: none;" />
                  <span style="font-size: 0.76rem; line-height: 1; flex-shrink: 0;">📝</span>
                  <span>Other</span>
                </label>
              </div>
            </div>

            <!-- Reason / Notes Input -->
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <label for="leave-input-reason" style="font-size: 0.68rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.4px;">Reason / Notes (Optional)</label>
              <input type="text" id="leave-input-reason" class="leave-modern-input" placeholder="e.g. Medical emergency, personal travel" style="height: 32px !important; font-size: 0.74rem !important;" />
            </div>

            <!-- Quick Ideas Dropdown -->
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 0.66rem; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.4px; white-space: nowrap;">Ideas:</span>
              <div class="custom-select-container custom-select-dropup" id="leave-ideas-container" style="flex: 1; position: relative;">
                <button type="button" class="custom-select-trigger" id="leave-ideas-trigger" style="width: 100%; height: 28px; font-size: 0.71rem; padding: 0 10px; background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 7px; color: #cbd5e1; display: flex; align-items: center; justify-content: space-between; cursor: pointer; user-select: none;">
                  <span id="leave-ideas-selected-text" style="display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    <span>💡 Select a preset</span>
                  </span>
                  <span class="custom-select-chevron" style="font-size: 0.65rem; color: #94a3b8;">▼</span>
                </button>
                <div class="custom-select-menu" id="leave-ideas-menu" style="max-height: 190px;">
                  <!-- Populated dynamically based on leave type -->
                </div>
                <select id="leave-ideas-dropdown" style="display: none;">
                  <!-- Kept for compatibility -->
                </select>
              </div>
            </div>

            <!-- Automated Roster Protection Notice -->
            <div style="display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 6px; background: rgba(168, 85, 247, 0.05); border: 1px solid rgba(168, 85, 247, 0.16); font-size: 0.68rem; color: #cbd5e1; line-height: 1.35;">
              <span style="font-size: 0.78rem; color: #a855f7; flex-shrink: 0;">⚡</span>
              <span>Roster blocked immediately. Overlapping bookings auto-rescheduled with 0 penalty.</span>
            </div>

            <!-- Submit Button -->
            <button type="submit" id="btn-submit-staff-leave" style="width: 100%; height: 36px; font-weight: 700; background: linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%); border: none; border-radius: 8px; color: #fff; font-size: 0.80rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 12px rgba(139, 92, 246, 0.25); margin-top: 2px;">
              <span>👤 Record Specialist Leave</span>
            </button>
          </form>
        </div>
      </div>
    `;

    // DOM References
    const closeModal = () => { modalContainer.innerHTML = ''; };
    document.getElementById('btn-close-leave-dialog')?.addEventListener('click', closeModal);

    const staffSelect = document.getElementById('leave-staff-select');
    const startInput = document.getElementById('leave-input-start-date');
    const endInput = document.getElementById('leave-input-end-date');
    const singleDaySection = document.getElementById('leave-single-day-section');
    const shiftLabel = document.getElementById('leave-day-shift-label');
    const toggleWrapper = document.getElementById('leave-toggle-partial-wrapper');
    const togglePartial = document.getElementById('leave-toggle-partial');
    const multiDaySection = document.getElementById('leave-multi-day-section');
    const multiDayText = document.getElementById('leave-multi-day-text');
    const partialInputs = document.getElementById('leave-partial-hours-inputs');
    const customStartInput = document.getElementById('leave-custom-start');
    const customEndInput = document.getElementById('leave-custom-end');
    const validationErrorEl = document.getElementById('leave-partial-validation-error');
    const validationTextEl = document.getElementById('leave-partial-validation-text');
    const reasonInput = document.getElementById('leave-input-reason');
    const submitBtn = document.getElementById('btn-submit-staff-leave');
    const weeklyOffWarning = document.getElementById('leave-weekly-off-warning');

    // Stylist Schedule State & In-memory Cache
    const stylistHoursCache = new Map();

    if (Array.isArray(staffList)) {
      staffList.forEach((s) => {
        if (s.id && Array.isArray(s.workingHours) && s.workingHours.length > 0) {
          stylistHoursCache.set(s.id, s.workingHours);
        }
      });
    }

    const initialTargetStaffId = fixedStaffId || defaultStaffId;
    let activeStylistHours = options.stylistHours || options.workingHours || (initialTargetStaffId ? stylistHoursCache.get(initialTargetStaffId) : null);

    // Fetch hours for the initially selected stylist if not in cache
    if (initialTargetStaffId && !activeStylistHours) {
      ApiClient.getStaffWorkingHours(initialTargetStaffId)
        .then((res) => {
          activeStylistHours = res?.data?.hours || res?.hours || (Array.isArray(res) ? res : null);
          if (activeStylistHours) {
            stylistHoursCache.set(initialTargetStaffId, activeStylistHours);
          }
          syncModalState();
        })
        .catch((err) => {
          console.warn('[StaffApplyLeaveDialog] Could not fetch stylist hours:', err);
          syncModalState();
        });
    }

    // Lazy load salon working hours if empty
    if (!salonWorkingHours || salonWorkingHours.length === 0) {
      ApiClient.getSalonWorkingHours()
        .then((whRes) => {
          const hours = whRes?.data || whRes || [];
          if (Array.isArray(hours) && hours.length > 0) {
            salonWorkingHours.push(...hours);
            syncModalState();
          }
        })
        .catch((e) => console.warn('[StaffApplyLeaveDialog] Could not fetch salon working hours:', e));
    }

    // Switch back to Whole Salon Off
    document.getElementById('btn-switch-to-salon-off')?.addEventListener('click', () => {
      closeModal();
      ScheduleDayOffDialog.open({
        initialDate: startInput?.value || initialDate,
        salonWorkingHours,
        staffList,
        onSuccess,
      });
    });

    // Helper: Shift lookup dynamically resolving Stylist or Salon Schedule
    const getShiftForDate = (dateStr) => {
      const dayName = getDayOfWeekFromDate(dateStr);
      const currentStaffId = staffSelect?.value || fixedStaffId;

      // 1. If we have activeStylistHours or cached hours for this stylist
      const staffHours = activeStylistHours || (currentStaffId ? stylistHoursCache.get(currentStaffId) : null);
      if (staffHours && Array.isArray(staffHours) && staffHours.length > 0) {
        const sHour = staffHours.find((h) => String(h.dayOfWeek).toUpperCase() === dayName);
        if (sHour) {
          return {
            dayName,
            isWeeklyOff: !sHour.isWorking,
            startTime: sHour.startTime || '09:00',
            endTime: sHour.endTime || '21:00',
            isCustomized: Boolean(sHour.isCustomized),
          };
        }
      }

      // 2. Fallback to Salon Working Hours
      const wh = salonWorkingHours.find((h) => String(h.dayOfWeek).toUpperCase() === dayName);
      return {
        dayName,
        isWeeklyOff: wh ? Boolean(wh.isClosed) : false,
        startTime: wh?.startTime || '09:00',
        endTime: wh?.endTime || '21:00',
        isCustomized: false,
      };
    };

    // Live validation for partial leave times against staff shift
    const validatePartialTimes = () => {
      // Live update 12-hour AM/PM conversion badges
      const startBadge = document.getElementById('leave-start-12h-badge');
      const endBadge = document.getElementById('leave-end-12h-badge');
      if (startBadge && customStartInput?.value) {
        startBadge.textContent = formatTimeTo12Hour(customStartInput.value);
      }
      if (endBadge && customEndInput?.value) {
        endBadge.textContent = formatTimeTo12Hour(customEndInput.value);
      }

      if (!togglePartial?.checked || startInput?.value !== endInput?.value) {
        if (validationErrorEl) validationErrorEl.style.display = 'none';
        if (customStartInput) customStartInput.style.borderColor = 'rgba(168,85,247,0.4)';
        if (customEndInput) customEndInput.style.borderColor = 'rgba(168,85,247,0.4)';
        return true;
      }

      const sVal = startInput?.value;
      const hours = getShiftForDate(sVal);
      const cStart = customStartInput?.value;
      const cEnd = customEndInput?.value;

      const showTimeError = (msg) => {
        if (validationErrorEl && validationTextEl) {
          validationTextEl.textContent = msg;
          validationErrorEl.style.display = 'flex';
        }
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.style.opacity = '0.5';
          submitBtn.style.cursor = 'not-allowed';
        }
      };

      if (!cStart || !cEnd) {
        showTimeError('Please specify both start and end times for partial leave.');
        return false;
      }

      const startMin = timeToMinutes(cStart);
      const endMin = timeToMinutes(cEnd);
      const shiftStartMin = timeToMinutes(hours.startTime);
      const shiftEndMin = timeToMinutes(hours.endTime);

      if (startMin >= endMin) {
        showTimeError('Leave end time must be strictly after start time.');
        if (customEndInput) customEndInput.style.borderColor = '#ef4444';
        return false;
      }

      if (endMin - startMin < 15) {
        showTimeError('Partial leave must be at least 15 minutes.');
        return false;
      }

      // Shift containment validation
      if (startMin < shiftStartMin) {
        showTimeError(`Please select a start time within specialist shift (from ${formatTimeTo12Hour(hours.startTime)}).`);
        if (customStartInput) customStartInput.style.borderColor = '#ef4444';
        return false;
      }

      if (endMin > shiftEndMin) {
        showTimeError(`Please select an end time within specialist shift (up to ${formatTimeTo12Hour(hours.endTime)}).`);
        if (customEndInput) customEndInput.style.borderColor = '#ef4444';
        return false;
      }

      // Valid state
      if (validationErrorEl) validationErrorEl.style.display = 'none';
      if (customStartInput) customStartInput.style.borderColor = 'rgba(168,85,247,0.4)';
      if (customEndInput) customEndInput.style.borderColor = 'rgba(168,85,247,0.4)';
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
        submitBtn.style.cursor = 'pointer';
      }
      return true;
    };

    // Helper to find next and previous operating days for specialist
    const getNextStaffWorkingDayName = (dateStr) => {
      const dt = new Date(dateStr + 'T00:00:00');
      for (let i = 1; i <= 7; i++) {
        dt.setDate(dt.getDate() + 1);
        const iso = dt.toISOString().split('T')[0];
        const s = getShiftForDate(iso);
        if (!s.isWeeklyOff) {
          return s.dayName ? s.dayName.charAt(0) + s.dayName.slice(1).toLowerCase() : 'next working day';
        }
      }
      return 'the next working day';
    };

    const getPrevStaffWorkingDayName = (dateStr) => {
      const dt = new Date(dateStr + 'T00:00:00');
      for (let i = 1; i <= 7; i++) {
        dt.setDate(dt.getDate() - 1);
        const iso = dt.toISOString().split('T')[0];
        const s = getShiftForDate(iso);
        if (!s.isWeeklyOff) {
          return s.dayName ? s.dayName.charAt(0) + s.dayName.slice(1).toLowerCase() : 'last working day';
        }
      }
      return 'the last working day';
    };

    const syncModalState = () => {
      const sVal = startInput?.value;
      const eVal = endInput?.value;
      if (!sVal || !eVal) return;

      const isSingleDay = sVal === eVal;
      const startShift = getShiftForDate(sVal);
      const endShift = getShiftForDate(eVal);

      const start12 = formatTimeTo12Hour(startShift.startTime);
      const end12 = formatTimeTo12Hour(startShift.endTime);
      const startDayLabel = startShift.dayName ? startShift.dayName.charAt(0) + startShift.dayName.slice(1).toLowerCase() : '';
      const endDayLabel = endShift.dayName ? endShift.dayName.charAt(0) + endShift.dayName.slice(1).toLowerCase() : '';

      const staffName = staffSelect?.options?.[staffSelect.selectedIndex]?.text?.replace(/^[👤\s]+/, '') || fixedStaffName || 'Specialist';

      let dateValidationError = null;

      if (isSingleDay) {
        if (multiDaySection) multiDaySection.style.display = 'none';

        if (shiftLabel) {
          shiftLabel.textContent = startShift.isWeeklyOff
            ? `💤 Weekly Off (${startDayLabel})`
            : `🕒 Shift: ${start12} - ${end12}`;
          shiftLabel.style.color = startShift.isWeeklyOff ? '#f59e0b' : '#c084fc';
        }

        if (startShift.isWeeklyOff) {
          dateValidationError = `💡 ${startDayLabel} is already a scheduled weekly off for ${staffName} (already off).`;
          if (togglePartial) {
            togglePartial.checked = false;
            togglePartial.disabled = true;
          }
          if (toggleWrapper) {
            toggleWrapper.style.opacity = '0.4';
            toggleWrapper.style.cursor = 'not-allowed';
          }
          if (partialInputs) partialInputs.style.display = 'none';
        } else {
          if (togglePartial) {
            togglePartial.disabled = false;
          }
          if (toggleWrapper) {
            toggleWrapper.style.opacity = '1';
            toggleWrapper.style.cursor = 'pointer';
          }

          if (customStartInput) {
            customStartInput.removeAttribute('min');
            customStartInput.removeAttribute('max');
            if (!customStartInput.value || customStartInput.value < startShift.startTime || customStartInput.value > startShift.endTime) {
              customStartInput.value = startShift.startTime || '09:00';
            }
          }
          if (customEndInput) {
            customEndInput.removeAttribute('min');
            customEndInput.removeAttribute('max');
            if (!customEndInput.value || customEndInput.value > startShift.endTime || customEndInput.value <= startShift.startTime) {
              customEndInput.value = startShift.endTime || '12:00';
            }
          }
        }

        if (singleDaySection) singleDaySection.style.display = 'flex';
      } else {
        // Multi-Day leave
        if (singleDaySection) singleDaySection.style.display = 'none';
        if (togglePartial) togglePartial.checked = false;
        if (partialInputs) partialInputs.style.display = 'none';

        const dt1 = new Date(sVal + 'T00:00:00');
        const dt2 = new Date(eVal + 'T00:00:00');
        const diffDays = Math.round((dt2 - dt1) / (1000 * 60 * 60 * 24)) + 1;

        if (multiDaySection) {
          multiDaySection.style.display = 'flex';
          if (multiDayText) {
            multiDayText.textContent = `📅 Multi-Day Leave: ${diffDays} Days (Full-Day Absence)`;
          }
        }

        // Multi-Day Range Boundary Validations:
        if (startShift.isWeeklyOff) {
          const nextOpen = getNextStaffWorkingDayName(sVal);
          dateValidationError = `💡 ${startDayLabel} is already a weekly off for ${staffName}. Please start their leave from ${nextOpen}.`;
        } else if (endShift.isWeeklyOff) {
          const prevOpen = getPrevStaffWorkingDayName(eVal);
          dateValidationError = `💡 ${endDayLabel} is already a weekly off for ${staffName}. Please end their leave on ${prevOpen}.`;
        }
      }

      // Render Weekly Off Error Banner or Between-Span Notice
      if (dateValidationError) {
        if (weeklyOffWarning) {
          weeklyOffWarning.style.display = 'block';
          weeklyOffWarning.innerHTML = `
            <div style="background: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 8px; padding: 7px 11px; font-size: 0.73rem; color: #fde68a; display: flex; align-items: flex-start; gap: 8px; line-height: 1.45;">
              <span style="font-size: 0.95rem; line-height: 1;">💡</span>
              <span style="flex: 1;">${dateValidationError}</span>
            </div>
          `;
        }
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.style.opacity = '0.5';
          submitBtn.style.cursor = 'not-allowed';
        }
        return;
      }

      // Check Weekly Off falling IN BETWEEN date range (allowed)
      const matchedOffs = new Set();
      const curr = new Date(sVal + 'T00:00:00');
      const end = new Date(eVal + 'T00:00:00');
      while (curr <= end) {
        const curIso = curr.toISOString().split('T')[0];
        const s = getShiftForDate(curIso);
        if (s.isWeeklyOff) {
          matchedOffs.add(s.dayName ? s.dayName.charAt(0) + s.dayName.slice(1).toLowerCase() : 'Weekly off');
        }
        curr.setDate(curr.getDate() + 1);
      }

      if (matchedOffs.size > 0 && weeklyOffWarning) {
        weeklyOffWarning.style.display = 'block';
        weeklyOffWarning.innerHTML = `
          <div style="background: rgba(148, 163, 184, 0.08); border: 1px solid rgba(148, 163, 184, 0.2); border-radius: 8px; padding: 6px 10px; font-size: 0.72rem; color: #cbd5e1; display: flex; align-items: center; gap: 6px;">
            <span>💤</span>
            <span>Range spans across regular weekly off (${Array.from(matchedOffs).join(', ')}).</span>
          </div>
        `;
      } else if (weeklyOffWarning) {
        weeklyOffWarning.style.display = 'none';
      }

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.style.opacity = '1';
        submitBtn.style.cursor = 'pointer';
      }

      validatePartialTimes();
    };

    // Dynamically switch stylist working hours when specialist dropdown changes
    staffSelect?.addEventListener('change', async () => {
      const selectedId = staffSelect?.value;
      if (typeof renderCustomStaffSelect === 'function' && Array.isArray(staffList)) {
        renderCustomStaffSelect(staffList, selectedId);
      }
      if (!selectedId) {
        activeStylistHours = null;
        syncModalState();
        return;
      }

      if (stylistHoursCache.has(selectedId)) {
        activeStylistHours = stylistHoursCache.get(selectedId);
        syncModalState();
      } else {
        try {
          const res = await ApiClient.getStaffWorkingHours(selectedId);
          const hours = res?.data?.hours || res?.hours || (Array.isArray(res) ? res : null);
          if (hours) {
            stylistHoursCache.set(selectedId, hours);
            if (staffSelect.value === selectedId) {
              activeStylistHours = hours;
              syncModalState();
            }
          }
        } catch (e) {
          console.warn('[StaffApplyLeaveDialog] Failed to fetch staff hours on change:', e);
          activeStylistHours = null;
          syncModalState();
        }
      }
    });

    // Time input validation listeners
    customStartInput?.addEventListener('input', validatePartialTimes);
    customStartInput?.addEventListener('change', validatePartialTimes);
    customEndInput?.addEventListener('input', validatePartialTimes);
    customEndInput?.addEventListener('change', validatePartialTimes);

    startInput?.addEventListener('input', syncModalState);
    startInput?.addEventListener('change', () => {
      if (startInput.value && endInput) {
        endInput.min = startInput.value;
        if (endInput.value && endInput.value < startInput.value) {
          endInput.value = startInput.value;
        }
      }
      const sVal = startInput?.value;
      const hours = getShiftForDate(sVal);
      if (customStartInput && hours?.startTime) customStartInput.value = hours.startTime;
      if (customEndInput && hours?.endTime) customEndInput.value = hours.endTime;
      syncModalState();
    });

    endInput?.addEventListener('input', syncModalState);
    endInput?.addEventListener('change', () => {
      if (endInput?.value && startInput?.value && endInput.value < startInput.value) {
        startInput.value = endInput.value;
      }
      syncModalState();
    });

    togglePartial?.addEventListener('change', () => {
      if (partialInputs) {
        partialInputs.style.display = togglePartial.checked ? 'flex' : 'none';
      }
      if (togglePartial?.checked) {
        const sVal = startInput?.value;
        const hours = getShiftForDate(sVal);
        if (customStartInput && hours?.startTime) customStartInput.value = hours.startTime;
        if (customEndInput && hours?.endTime) customEndInput.value = hours.endTime;
      }
      syncModalState();
    });

    // Preset ideas organized contextually per leave type (Dropdown navigation, 0 overflow)
    const STAFF_LEAVE_PRESETS = {
      SICK_LEAVE: [
        { label: '🤒 Fever / Flu Recovery', reason: 'Fever and viral flu recovery' },
        { label: '🏥 Doctor Appointment', reason: 'Medical doctor appointment' },
        { label: '🤕 Dental Treatment', reason: 'Dental treatment & procedure' },
        { label: '🩺 Routine Health Checkup', reason: 'Annual health checkup' },
      ],
      CASUAL_LEAVE: [
        { label: '🌴 Family Vacation Break', reason: 'Family vacation break' },
        { label: '✈️ Personal Travel', reason: 'Personal outstation travel' },
        { label: '🎉 Family Wedding Function', reason: 'Family wedding celebration' },
        { label: '🏡 Urgent Personal Work', reason: 'Urgent personal work' },
      ],
      EMERGENCY_LEAVE: [
        { label: '🚨 Family Medical Emergency', reason: 'Family medical emergency' },
        { label: '⚡ Urgent Home Maintenance', reason: 'Urgent residential repairs' },
        { label: '🚑 Personal Emergency', reason: 'Unforeseen personal emergency' },
      ],
      UNPAID_LEAVE: [
        { label: '📄 Extended Study Leave', reason: 'Educational workshop / study leave' },
        { label: '✈️ Extended Sabbatical', reason: 'Personal sabbatical' },
        { label: '🧘 Personal Time Off', reason: 'Personal time off' },
      ],
      OTHER: [
        { label: '📝 Official Documentation', reason: 'Government documentation work' },
        { label: '🚗 Relocation & House Shift', reason: 'House moving / relocation' },
        { label: '✨ Personal Appointment', reason: 'Personal appointment' },
      ],
    };

    const LEAVE_PLACEHOLDERS = {
      SICK_LEAVE: 'e.g. Fever recovery, Doctor appointment',
      CASUAL_LEAVE: 'e.g. Family vacation, Personal travel',
      EMERGENCY_LEAVE: 'e.g. Family medical emergency, Urgent repairs',
      UNPAID_LEAVE: 'e.g. Extended study leave, Personal sabbatical',
      OTHER: 'e.g. Documentation work, Personal relocation',
    };

    // Custom Specialist Dropdown Integration
    const leaveStaffTrigger = document.getElementById('leave-staff-trigger');
    const leaveStaffMenu = document.getElementById('leave-staff-menu');
    const leaveStaffNameText = document.getElementById('leave-staff-name-text');

    const renderCustomStaffSelect = (list, activeId) => {
      if (!leaveStaffMenu) return;
      if (!Array.isArray(list) || list.length === 0) {
        leaveStaffMenu.innerHTML = `<div style="padding: 10px; font-size: 0.74rem; color: #94a3b8; text-align: center;">No specialists available</div>`;
        if (leaveStaffNameText) leaveStaffNameText.textContent = 'No specialists';
        return;
      }

      const currentId = activeId || (staffSelect ? staffSelect.value : list[0].id);
      const currentStaff = list.find((s) => s.id === currentId) || list[0];

      if (currentStaff && leaveStaffNameText) {
        const roleOrPhone = currentStaff.role || currentStaff.phone || '';
        leaveStaffNameText.innerHTML = `
          <span style="font-weight: 700; color: #fff;">${currentStaff.name}</span>
          ${roleOrPhone ? `<span style="color: #c084fc; font-size: 0.7rem; font-weight: 500; margin-left: 4px;">(${roleOrPhone})</span>` : ''}
        `;
      }

      leaveStaffMenu.innerHTML = list.map((s) => {
        const isSel = s.id === currentId;
        const roleOrPhone = s.role || s.phone || '';
        const initials = (s.name || 'S').trim().charAt(0).toUpperCase();
        return `
          <div class="custom-select-option custom-staff-option ${isSel ? 'selected' : ''}" data-id="${s.id}" style="padding: 7px 10px; font-size: 0.74rem; display: flex; align-items: center; justify-content: space-between; border-radius: 6px;">
            <div style="display: flex; align-items: center; gap: 8px; min-width: 0;">
              <div style="width: 24px; height: 24px; border-radius: 50%; background: linear-gradient(135deg, #8b5cf6, #6366f1); display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 700; color: #fff; flex-shrink: 0; box-shadow: 0 1px 3px rgba(0,0,0,0.3);">
                ${initials}
              </div>
              <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                <span style="font-weight: 600; color: #fff;">${s.name}</span>
                ${roleOrPhone ? `<span style="font-size: 0.68rem; color: #94a3b8; margin-left: 5px;">(${roleOrPhone})</span>` : ''}
              </div>
            </div>
            ${isSel ? `<span class="custom-select-opt-check" style="color: #c084fc; font-weight: 700;">✓</span>` : ''}
          </div>
        `;
      }).join('');

      leaveStaffMenu.querySelectorAll('.custom-staff-option').forEach((opt) => {
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          const staffId = opt.getAttribute('data-id');
          if (staffSelect) {
            staffSelect.value = staffId;
            staffSelect.dispatchEvent(new Event('change'));
          }
          renderCustomStaffSelect(list, staffId);
          toggleStaffMenu(false);
        });
      });
    };

    const toggleStaffMenu = (forceOpen) => {
      if (!leaveStaffMenu) return;
      const isOpen = forceOpen !== undefined ? forceOpen : !leaveStaffMenu.classList.contains('open');
      if (isOpen && typeof toggleLeaveIdeasMenu === 'function') toggleLeaveIdeasMenu(false);
      leaveStaffMenu.classList.toggle('open', isOpen);
      leaveStaffMenu.style.display = isOpen ? 'flex' : 'none';
      leaveStaffTrigger?.classList.toggle('active', isOpen);
      leaveStaffTrigger?.querySelector('.custom-select-chevron')?.classList.toggle('open', isOpen);
    };

    leaveStaffTrigger?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleStaffMenu();
    });

    // Custom Leave Ideas Dropdown Integration
    const leaveIdeasDropdown = document.getElementById('leave-ideas-dropdown');
    const leaveIdeasTrigger = document.getElementById('leave-ideas-trigger');
    const leaveIdeasMenu = document.getElementById('leave-ideas-menu');
    const leaveIdeasSelectedText = document.getElementById('leave-ideas-selected-text');

    const updateLeaveIdeasDropdown = (leaveType) => {
      const presets = STAFF_LEAVE_PRESETS[leaveType] || STAFF_LEAVE_PRESETS.SICK_LEAVE;
      const leaveNames = {
        SICK_LEAVE: 'Sick Leave',
        CASUAL_LEAVE: 'Casual Leave',
        EMERGENCY_LEAVE: 'Emergency',
        UNPAID_LEAVE: 'Unpaid Leave',
        OTHER: 'Other',
      };
      const name = leaveNames[leaveType] || 'Leave';
      const placeholderText = `💡 Select a ${name.toLowerCase()} preset`;

      if (leaveIdeasSelectedText) {
        leaveIdeasSelectedText.innerHTML = `<span>${placeholderText}</span>`;
      }

      if (leaveIdeasDropdown) {
        leaveIdeasDropdown.innerHTML = `
          <option value="">${placeholderText}</option>
          ${presets.map((p) => `<option value="${p.reason.replace(/"/g, '&quot;')}">${p.label}</option>`).join('')}
        `;
        leaveIdeasDropdown.value = '';
      }

      if (leaveIdeasMenu) {
        leaveIdeasMenu.innerHTML = presets.map((p) => `
          <div class="custom-select-option leave-idea-opt" data-value="${p.reason.replace(/"/g, '&quot;')}" style="padding: 6px 10px; font-size: 0.73rem;">
            <span>${p.label}</span>
          </div>
        `).join('');

        leaveIdeasMenu.querySelectorAll('.leave-idea-opt').forEach((opt) => {
          opt.addEventListener('click', (e) => {
            e.stopPropagation();
            const selectedReason = opt.getAttribute('data-value');
            if (selectedReason && reasonInput) {
              reasonInput.value = selectedReason;
              reasonInput.focus();
              if (leaveIdeasSelectedText) {
                leaveIdeasSelectedText.innerHTML = `<span>${opt.textContent.trim()}</span>`;
              }
            }
            if (leaveIdeasDropdown) {
              leaveIdeasDropdown.value = selectedReason || '';
              leaveIdeasDropdown.dispatchEvent(new Event('change'));
            }
            toggleLeaveIdeasMenu(false);
          });
        });
      }
    };

    const toggleLeaveIdeasMenu = (forceOpen) => {
      if (!leaveIdeasMenu) return;
      const isOpen = forceOpen !== undefined ? forceOpen : !leaveIdeasMenu.classList.contains('open');
      if (isOpen && typeof toggleStaffMenu === 'function') toggleStaffMenu(false);
      leaveIdeasMenu.classList.toggle('open', isOpen);
      leaveIdeasMenu.style.display = isOpen ? 'flex' : 'none';
      leaveIdeasTrigger?.classList.toggle('active', isOpen);
      leaveIdeasTrigger?.querySelector('.custom-select-chevron')?.classList.toggle('open', isOpen);
    };

    leaveIdeasTrigger?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleLeaveIdeasMenu();
    });

    // Close any open custom select menus when clicking outside
    modalContainer.addEventListener('click', (e) => {
      if (!e.target.closest('#leave-staff-select-container')) {
        toggleStaffMenu(false);
      }
      if (!e.target.closest('#leave-ideas-container')) {
        toggleLeaveIdeasMenu(false);
      }
    });

    // Synchronize Leave Type Chips
    const updateLeaveTypeChips = () => {
      const selectedType = modalContainer.querySelector('input[name="staffLeaveType"]:checked')?.value || 'SICK_LEAVE';
      modalContainer.querySelectorAll('.leave-type-chip').forEach((chip) => {
        const val = chip.getAttribute('data-value');
        const color = chip.getAttribute('data-color') || '#8b5cf6';
        const isSelected = val === selectedType;
        if (isSelected) {
          chip.style.borderColor = color;
          chip.style.background = `${color}22`;
          chip.style.color = color;
          chip.style.boxShadow = `0 2px 6px ${color}33`;
        } else {
          chip.style.borderColor = 'rgba(255, 255, 255, 0.08)';
          chip.style.background = 'rgba(255, 255, 255, 0.03)';
          chip.style.color = '#94a3b8';
          chip.style.boxShadow = 'none';
        }
      });
      if (reasonInput) {
        reasonInput.placeholder = LEAVE_PLACEHOLDERS[selectedType] || 'e.g. Leave Reason / Notes...';
      }
      updateLeaveIdeasDropdown(selectedType);
    };

    modalContainer.querySelectorAll('input[name="staffLeaveType"]').forEach((radio) => {
      radio.addEventListener('change', updateLeaveTypeChips);
    });

    // Initial render of staff select, chips, and ideas dropdown
    if (!fixedStaffId && Array.isArray(staffList) && staffList.length > 0) {
      renderCustomStaffSelect(staffList, defaultStaffId);
    }
    updateLeaveTypeChips();

    // Lazy load staff list if empty
    if (!fixedStaffId && (!staffList || staffList.length === 0) && staffSelect) {
      ApiClient.getStaff()
        .then((res) => {
          staffList = res?.data || res || [];
          if (Array.isArray(staffList) && staffList.length > 0) {
            const firstStaff = staffList[0];
            staffList.forEach((s) => {
              if (s.id && Array.isArray(s.workingHours)) {
                stylistHoursCache.set(s.id, s.workingHours);
              }
            });
            staffSelect.innerHTML = buildStaffOptions(staffList, firstStaff.id);
            staffSelect.value = firstStaff.id;
            renderCustomStaffSelect(staffList, firstStaff.id);
            activeStylistHours = stylistHoursCache.get(firstStaff.id) || null;
            if (!activeStylistHours) {
              ApiClient.getStaffWorkingHours(firstStaff.id).then((whRes) => {
                activeStylistHours = whRes?.data?.hours || whRes?.hours || (Array.isArray(whRes) ? whRes : null);
                if (activeStylistHours) stylistHoursCache.set(firstStaff.id, activeStylistHours);
                syncModalState();
              });
            } else {
              syncModalState();
            }
          }
        })
        .catch((e) => console.warn('[StaffApplyLeaveDialog] Could not load staff list:', e));
    }

    // Form Submission
    document.getElementById('form-apply-specialist-leave')?.addEventListener('submit', async (e) => {
      e.preventDefault();

      const targetStaffId = staffSelect?.value || fixedStaffId;
      const startDate = startInput?.value;
      const endDate = endInput?.value;
      const leaveType = modalContainer.querySelector('input[name="staffLeaveType"]:checked')?.value || 'SICK_LEAVE';
      const isPartial = Boolean(togglePartial?.checked && startDate === endDate);
      const reason = reasonInput?.value?.trim() || undefined;

      if (!targetStaffId) {
        CalendarState.notify('Please select a Specialist / Stylist.', 'warning');
        return;
      }

      if (!startDate || !endDate) {
        CalendarState.notify('Please provide valid start and end dates.', 'warning');
        return;
      }

      if (startDate < todayStr) {
        CalendarState.notify('Cannot record leave for dates that have already passed.', 'warning');
        return;
      }

      if (endDate < startDate) {
        CalendarState.notify('End date cannot be earlier than start date.', 'warning');
        return;
      }

      const payload = {
        startDate,
        endDate,
        isPartialDay: isPartial,
        leaveType,
        reason,
        notes: reason,
      };

      if (isPartial) {
        if (!validatePartialTimes()) {
          return;
        }
        payload.startTime = customStartInput?.value || '09:00';
        payload.endTime = customEndInput?.value || '13:00';
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span>⏳ Processing Leave & Rescheduling...</span>`;
      }
      CalendarState.showLoading('Recording specialist leave & updating calendar...');

      try {
        const res = await ApiClient.markStaffAbsent(targetStaffId, payload);
        const selectedStaffObj = staffList.find((s) => s.id === targetStaffId);
        const staffName = selectedStaffObj ? selectedStaffObj.name : (fixedStaffName || 'Specialist');
        const msg = res?.data?.message || res?.message || `Leave recorded successfully for ${staffName}!`;

        closeModal();
        CalendarState.hideLoading(0);
        CalendarState.notify(msg, 'success');
        if (typeof onSuccess === 'function') {
          try { onSuccess(); } catch (e) { console.warn(e); }
        }
        await CalendarState.refreshAll();
      } catch (err) {
        CalendarState.hideLoading(0);
        CalendarState.notify(err.message || 'Failed to record specialist leave.', 'error');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = `<span>👤 Record Specialist Leave</span>`;
        }
      }
    });

    // Run initial state calculation
    syncModalState();
    updateLeaveTypeChips();
  }
}

// Global exposure
if (typeof window !== 'undefined') {
  window.StaffApplyLeaveDialog = StaffApplyLeaveDialog;
}
