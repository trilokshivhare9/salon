import { ApiClient } from '../../api.js';
import { StaffApplyLeaveDialog } from '../staff/staff-apply-leave-dialog.js';
import { CalendarState } from '../calendar/calendar-state.js';

/**
 * ScheduleDayOffDialog
 * Autonomous, production-grade dialog component for scheduling Whole Salon Closures & Holidays.
 * Handles single-day partial closures, dynamic weekday shift resolution, weekly off alerts,
 * and automated customer WhatsApp rescheduling.
 * 
 * When user clicks "Specialist Leave" tab, it delegates to StaffApplyLeaveDialog in modules/staff/.
 */
export class ScheduleDayOffDialog {
  /**
   * Opens the Salon Day Off / Closure modal.
   * @param {Object} options
   * @param {string} [options.initialDate] - YYYY-MM-DD
   * @param {Object} [options.festivalInfo] - Auto-detected festival metadata
   * @param {Array} [options.salonWorkingHours] - Salon 7-day schedule array
   * @param {Array} [options.existingClosures] - Current active closures array
   * @param {Array} [options.staffList] - Active stylists list
   * @param {Function} [options.onSuccess] - Callback when closure is successfully saved
   */
  static open(options = {}) {
    const modalContainer = document.getElementById('modal-container');
    if (!modalContainer) return;

    const initialDate = options.initialDate || new Date().toISOString().split('T')[0];
    const todayStr = new Date().toISOString().split('T')[0];
    const festivalInfo = options.festivalInfo || null;
    const salonWorkingHours = options.salonWorkingHours || window.salonDashboard?.salonWorkingHours || window.dashboardApp?.salonWorkingHours || [];
    const existingClosures = options.existingClosures || window.salonDashboard?.closuresList || window.dashboardApp?.closuresList || [];
    const staffList = options.staffList || window.salonDashboard?.staffList || window.dashboardApp?.staffList || [];
    const onSuccess = options.onSuccess || (() => {});

    // Friendly date header
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const dtInit = new Date(initialDate + 'T00:00:00');
    const friendlyDate = !isNaN(dtInit.getTime())
      ? `${days[dtInit.getDay()]}, ${dtInit.getDate()} ${months[dtInit.getMonth()]} ${dtInit.getFullYear()}`
      : initialDate;

    const targetType = options.closureType || (festivalInfo ? 'FESTIVAL' : 'FESTIVAL');
    const defaultReason = options.reason || (festivalInfo ? `${festivalInfo.name}` : '');

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content modal-content-sheet" style="max-width: 480px; width: 100%; margin: auto; padding: 18px 20px; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 16px; background: #0f172a; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.75);">
          <div class="sheet-grab-handle"></div>
          
          <!-- Header -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
            <div>
              <h3 style="font-size: 1.1rem; font-weight: 800; color: #fff; margin: 0; display: flex; align-items: center; gap: 8px;">
                <span>🗓️ Schedule Day Off</span>
              </h3>
              <p style="color: #94a3b8; font-size: 0.74rem; margin: 2px 0 0 0;">${friendlyDate}</p>
            </div>
            <button class="close-btn" id="btn-close-closure-modal" style="width: 28px; height: 28px; font-size: 1.1rem; background: rgba(255,255,255,0.06); border: none; border-radius: 50%; color: #94a3b8; cursor: pointer; display: flex; align-items: center; justify-content: center;">&times;</button>
          </div>

          <!-- Festival Banner if auto-detected -->
          ${festivalInfo ? `
            <div style="background: rgba(168, 85, 247, 0.12); border: 1px solid rgba(168, 85, 247, 0.35); border-radius: 8px; padding: 6px 10px; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px;">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 1.1rem;">${festivalInfo.icon || '🪔'}</span>
                <span style="font-size: 0.78rem; font-weight: 700; color: #d8b4fe;">${festivalInfo.name}</span>
              </div>
              <span class="badge" style="background: rgba(168, 85, 247, 0.25); color: #d8b4fe; font-size: 0.65rem; font-weight: 800; padding: 2px 6px; border-radius: 4px;">FESTIVAL</span>
            </div>
          ` : ''}

          <!-- Segmented Tab: Whole Salon Off vs Specialist Leave -->
          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; background: rgba(15, 23, 42, 0.6); padding: 3px; border-radius: 999px; border: 1px solid rgba(255, 255, 255, 0.08); margin-bottom: 12px;">
            <button type="button" class="btn btn-sm" id="tab-mode-whole-salon" style="border: none; border-radius: 999px; font-size: 0.75rem; font-weight: 700; background: rgba(139, 61, 255, 0.35); color: #fff; padding: 6px; cursor: default;">
              🌴 Whole Salon Off
            </button>
            <button type="button" class="btn btn-sm" id="tab-mode-specialist-leave" style="border: none; border-radius: 999px; font-size: 0.75rem; font-weight: 700; background: transparent; color: #94a3b8; padding: 6px; cursor: pointer; transition: all 0.15s ease;">
              👤 Specialist Leave
            </button>
          </div>

          <!-- Form: Whole Salon Closure -->
          <form id="form-salon-closure-modal" style="display: flex; flex-direction: column; gap: 10px;">
            
            <!-- TOP CARD: Date Selection (From -> To) + Shift info -->
            <div style="background: rgba(255, 255, 255, 0.025); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 12px; padding: 9px 11px; display: flex; flex-direction: column; gap: 7px;">
              <div style="display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px;">
                <div style="display: flex; flex-direction: column; gap: 2px;">
                  <label for="closure-start-date" style="font-size: 0.68rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.4px;">From Date</label>
                  <input type="date" id="closure-start-date" value="${initialDate}" min="${todayStr}" required style="height: 34px; background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 7px; padding: 0 8px; color: #fff; font-size: 0.78rem; font-weight: 600;" />
                </div>
                <div style="color: #64748b; font-size: 0.85rem; font-weight: bold; margin-top: 14px; text-align: center;">➔</div>
                <div style="display: flex; flex-direction: column; gap: 2px;">
                  <label for="closure-end-date" style="font-size: 0.68rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.4px;">To Date</label>
                  <input type="date" id="closure-end-date" value="${initialDate}" min="${initialDate}" required style="height: 34px; background: rgba(15, 23, 42, 0.8); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 7px; padding: 0 8px; color: #fff; font-size: 0.78rem; font-weight: 600;" />
                </div>
              </div>

              <!-- Single-Day Operating Shift & Partial Day Toggle -->
              <div id="closure-single-day-section" style="display: flex; justify-content: space-between; align-items: center; gap: 8px; padding-top: 8px; border-top: 1px solid rgba(255, 255, 255, 0.06); flex-wrap: nowrap;">
                <div style="font-size: 0.72rem; font-weight: 600; color: #c084fc; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap;" id="closure-day-schedule-label">
                  🕒 Shift: 09:00 AM - 09:00 PM
                </div>
                <label id="closure-toggle-partial-wrapper" style="display: inline-flex; align-items: center; gap: 5px; font-size: 0.71rem; color: #cbd5e1; cursor: pointer; user-select: none; white-space: nowrap; flex-shrink: 0;">
                  <input type="checkbox" id="closure-toggle-partial" style="accent-color: #a855f7; cursor: pointer; margin: 0;" />
                  <span>Partial hours</span>
                </label>
              </div>

              <!-- Multi-Day Notice (visible when From !== To) -->
              <div id="closure-multi-day-section" style="display: none; align-items: center; gap: 6px; padding-top: 6px; border-top: 1px solid rgba(255, 255, 255, 0.06); font-size: 0.72rem; color: #94a3b8;">
                <span>📅</span>
                <span id="closure-multi-day-text">Multi-Day Closure (Full Salon Shutdown)</span>
              </div>

              <!-- Collapsible Partial Hours inputs -->
              <div id="closure-partial-hours-inputs" style="display: none; flex-direction: column; gap: 6px; padding-top: 6px; border-top: 1px dashed rgba(255, 255, 255, 0.1);">
                <div style="display: flex; align-items: center; gap: 8px;">
                  <div style="flex: 1;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                      <label style="font-size: 0.66rem; color: #94a3b8;">Closed From</label>
                      <span id="closure-start-12h-badge" style="font-size: 0.66rem; font-weight: 700; color: #c084fc;"></span>
                    </div>
                    <input type="time" id="closure-custom-start" style="width: 100%; height: 30px; background: rgba(15,23,42,0.9); border: 1px solid rgba(168,85,247,0.4); border-radius: 6px; color: #fff; padding: 0 8px; font-size: 0.76rem; transition: border-color 0.2s ease;" />
                  </div>
                  <span style="color: #64748b; font-size: 0.74rem; margin-top: 14px;">to</span>
                  <div style="flex: 1;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
                      <label style="font-size: 0.66rem; color: #94a3b8;">Closed Until</label>
                      <span id="closure-end-12h-badge" style="font-size: 0.66rem; font-weight: 700; color: #c084fc;"></span>
                    </div>
                    <input type="time" id="closure-custom-end" style="width: 100%; height: 30px; background: rgba(15,23,42,0.9); border: 1px solid rgba(168,85,247,0.4); border-radius: 6px; color: #fff; padding: 0 8px; font-size: 0.76rem; transition: border-color 0.2s ease;" />
                  </div>
                </div>
                <div id="closure-partial-validation-error" style="display: none; font-size: 0.7rem; color: #f87171; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 6px; padding: 4px 8px; align-items: center; gap: 6px;">
                  <span>⚠️</span>
                  <span id="closure-partial-validation-text"></span>
                </div>
              </div>
            </div>

            <!-- Weekly Off Notice (Dynamic) -->
            <div id="closure-weekly-off-warning" style="display: none;"></div>

            <!-- Scoped styling for sleek professional inputs & dropdowns -->
            <style>
              .closure-modern-input {
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
              .closure-modern-input:focus {
                border-color: rgba(245, 158, 11, 0.7) !important;
                box-shadow: 0 0 0 2px rgba(245, 158, 11, 0.15) !important;
                background: rgba(15, 23, 42, 0.95) !important;
              }
              .closure-modern-input::placeholder {
                color: #64748b !important;
                font-size: 0.70rem !important;
                font-weight: 400 !important;
              }
              .closure-cat-chip:hover {
                filter: brightness(1.12);
              }
              .closure-ideas-select {
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

            <!-- Category Selector (Proportional flex row: Emergency gets 1.35x width so it never overflows) -->
            <div>
              <div style="display: flex; gap: 4px; width: 100%;">
                <label class="closure-cat-chip" data-value="FESTIVAL" data-active-border="#f59e0b" data-active-bg="rgba(245, 158, 11, 0.16)" data-active-color="#fbbf24" style="flex: 1; border: 1px solid #f59e0b; background: rgba(245, 158, 11, 0.16); color: #fbbf24; border-radius: 7px; height: 30px; display: flex; align-items: center; justify-content: center; gap: 3px; cursor: pointer; font-size: 0.67rem; font-weight: 600; padding: 0 4px; white-space: nowrap; user-select: none; box-sizing: border-box;">
                  <input type="radio" name="closureType" value="FESTIVAL" ${targetType === 'FESTIVAL' ? 'checked' : ''} style="display: none;" />
                  <span style="font-size: 0.76rem; line-height: 1; flex-shrink: 0;">🪔</span>
                  <span>Festival</span>
                </label>
                <label class="closure-cat-chip" data-value="HOLIDAY" data-active-border="#3b82f6" data-active-bg="rgba(59, 130, 246, 0.16)" data-active-color="#60a5fa" style="flex: 1; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); color: #94a3b8; border-radius: 7px; height: 30px; display: flex; align-items: center; justify-content: center; gap: 3px; cursor: pointer; font-size: 0.67rem; font-weight: 600; padding: 0 4px; white-space: nowrap; user-select: none; box-sizing: border-box;">
                  <input type="radio" name="closureType" value="HOLIDAY" ${targetType === 'HOLIDAY' ? 'checked' : ''} style="display: none;" />
                  <span style="font-size: 0.76rem; line-height: 1; flex-shrink: 0;">🌴</span>
                  <span>Holiday</span>
                </label>
                <label class="closure-cat-chip" data-value="EMERGENCY_CLOSURE" data-active-border="#ef4444" data-active-bg="rgba(239, 68, 68, 0.16)" data-active-color="#f87171" style="flex: 1.35; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); color: #94a3b8; border-radius: 7px; height: 30px; display: flex; align-items: center; justify-content: center; gap: 3px; cursor: pointer; font-size: 0.67rem; font-weight: 600; padding: 0 4px; white-space: nowrap; user-select: none; box-sizing: border-box;">
                  <input type="radio" name="closureType" value="EMERGENCY_CLOSURE" ${targetType === 'EMERGENCY_CLOSURE' ? 'checked' : ''} style="display: none;" />
                  <span style="font-size: 0.76rem; line-height: 1; flex-shrink: 0;">🚨</span>
                  <span>Emergency</span>
                </label>
                <label class="closure-cat-chip" data-value="OTHER" data-active-border="#94a3b8" data-active-bg="rgba(148, 163, 184, 0.16)" data-active-color="#e2e8f0" style="flex: 0.85; border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); color: #94a3b8; border-radius: 7px; height: 30px; display: flex; align-items: center; justify-content: center; gap: 3px; cursor: pointer; font-size: 0.67rem; font-weight: 600; padding: 0 4px; white-space: nowrap; user-select: none; box-sizing: border-box;">
                  <input type="radio" name="closureType" value="OTHER" ${targetType === 'OTHER' ? 'checked' : ''} style="display: none;" />
                  <span style="font-size: 0.76rem; line-height: 1; flex-shrink: 0;">📝</span>
                  <span>Other</span>
                </label>
              </div>
            </div>

            <!-- Reason / Title Input -->
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <label for="closure-input-reason" style="font-size: 0.68rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.4px;">Reason / Title *</label>
              <input type="text" id="closure-input-reason" class="closure-modern-input" value="${defaultReason.replace(/"/g, '&quot;')}" placeholder="e.g. Diwali Festival Break, Store Maintenance" required style="height: 32px !important; font-size: 0.74rem !important;" />
            </div>

            <!-- Quick Ideas Dropdown -->
            <div style="display: flex; align-items: center; gap: 8px;">
              <span style="font-size: 0.66rem; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.4px; white-space: nowrap;">Ideas:</span>
              <div class="custom-select-container custom-select-dropup" id="closure-ideas-container" style="flex: 1; position: relative;">
                <button type="button" class="custom-select-trigger" id="closure-ideas-trigger" style="width: 100%; height: 28px; font-size: 0.71rem; padding: 0 10px; background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 7px; color: #cbd5e1; display: flex; align-items: center; justify-content: space-between; cursor: pointer; user-select: none;">
                  <span id="closure-ideas-selected-text" style="display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    <span>💡 Select a preset</span>
                  </span>
                  <span class="custom-select-chevron" style="font-size: 0.65rem; color: #94a3b8;">▼</span>
                </button>
                <div class="custom-select-menu" id="closure-ideas-menu" style="max-height: 190px;">
                  <!-- Populated dynamically based on category -->
                </div>
                <select id="closure-ideas-dropdown" style="display: none;">
                  <!-- Kept for compatibility -->
                </select>
              </div>
            </div>

            <!-- Notes / Notice Input (Optional) -->
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <label for="closure-input-notes" style="font-size: 0.68rem; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.4px;">Notes / Customer Notice (Optional)</label>
              <input type="text" id="closure-input-notes" class="closure-modern-input" placeholder="e.g. Salon reopens Monday morning at 9 AM" style="height: 32px !important; font-size: 0.73rem !important;" />
            </div>

            <!-- Zero-Penalty Guarantee Reassurance (Integrated 1-Line Badge) -->
            <div style="display: flex; align-items: center; gap: 6px; padding: 5px 8px; border-radius: 6px; background: rgba(16, 185, 129, 0.05); border: 1px solid rgba(16, 185, 129, 0.14); font-size: 0.68rem; color: #94a3b8; line-height: 1.35;">
              <span style="font-size: 0.78rem; color: #34d399; flex-shrink: 0;">🛡️</span>
              <span>Overlapping bookings auto-rescheduled via WhatsApp with 0 penalty.</span>
            </div>

            <!-- Submit Button -->
            <button type="submit" id="btn-submit-closure-modal" style="width: 100%; height: 36px; font-weight: 700; background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%); border: none; border-radius: 8px; color: #fff; font-size: 0.80rem; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 8px; box-shadow: 0 4px 12px rgba(245, 158, 11, 0.25); margin-top: 2px;">
              <span>🌴 Mark Salon Closed</span>
            </button>
          </form>
        </div>
      </div>
    `;

    // DOM Elements
    const closeModal = () => { modalContainer.innerHTML = ''; };
    document.getElementById('btn-close-closure-modal')?.addEventListener('click', closeModal);

    const startInput = document.getElementById('closure-start-date');
    const endInput = document.getElementById('closure-end-date');
    const reasonInput = document.getElementById('closure-input-reason');
    const singleDaySection = document.getElementById('closure-single-day-section');
    const shiftLabel = document.getElementById('closure-day-schedule-label');
    const togglePartial = document.getElementById('closure-toggle-partial');
    const partialInputs = document.getElementById('closure-partial-hours-inputs');
    const customStartInput = document.getElementById('closure-custom-start');
    const customEndInput = document.getElementById('closure-custom-end');
    const weeklyOffWarning = document.getElementById('closure-weekly-off-warning');
    const submitBtn = document.getElementById('btn-submit-closure-modal');
    const toggleWrapper = document.getElementById('closure-toggle-partial-wrapper');
    const multiDaySection = document.getElementById('closure-multi-day-section');
    const multiDayText = document.getElementById('closure-multi-day-text');
    const notesInput = document.getElementById('closure-input-notes');
    const validationErrorEl = document.getElementById('closure-partial-validation-error');
    const validationTextEl = document.getElementById('closure-partial-validation-text');

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

    // Switch to Specialist Leave Dialog
    document.getElementById('tab-mode-specialist-leave')?.addEventListener('click', () => {
      closeModal();
      StaffApplyLeaveDialog.open({
        initialDate: startInput?.value || initialDate,
        showModeSwitch: true,
        salonWorkingHours,
        staffList,
        onSuccess,
      });
    });

    // Helper: Client-side Working Hours & Weekly Off Lookup
    const getHoursForDate = (dateStr) => {
      const dayName = getDayOfWeekFromDate(dateStr);
      const wh = salonWorkingHours.find((h) => String(h.dayOfWeek).toUpperCase() === dayName);

      return {
        dayOfWeek: dayName,
        isWeeklyOff: wh ? Boolean(wh.isClosed) : false,
        startTime: wh?.startTime || '09:00',
        endTime: wh?.endTime || '21:00',
      };
    };

    // Live validation for partial closure times against operating shift
    const validatePartialTimes = () => {
      // Live update 12-hour AM/PM conversion badges
      const startBadge = document.getElementById('closure-start-12h-badge');
      const endBadge = document.getElementById('closure-end-12h-badge');
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
      const hours = getHoursForDate(sVal);
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
        showTimeError('Please specify both start and end times for partial closure.');
        return false;
      }

      const startMin = timeToMinutes(cStart);
      const endMin = timeToMinutes(cEnd);
      const shiftStartMin = timeToMinutes(hours.startTime);
      const shiftEndMin = timeToMinutes(hours.endTime);

      if (startMin >= endMin) {
        showTimeError('Closure end time must be strictly after start time.');
        if (customEndInput) customEndInput.style.borderColor = '#ef4444';
        return false;
      }

      if (endMin - startMin < 15) {
        showTimeError('Partial closure must be at least 15 minutes.');
        return false;
      }

      // Shift containment validation
      if (startMin < shiftStartMin) {
        showTimeError(`Please select a start time within operating shift (from ${formatTimeTo12Hour(hours.startTime)}).`);
        if (customStartInput) customStartInput.style.borderColor = '#ef4444';
        return false;
      }

      if (endMin > shiftEndMin) {
        showTimeError(`Please select an end time within operating shift (up to ${formatTimeTo12Hour(hours.endTime)}).`);
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

    // Helper to find next and previous operating days
    const getNextOpenDayName = (dateStr) => {
      const dt = new Date(dateStr + 'T00:00:00');
      for (let i = 1; i <= 7; i++) {
        dt.setDate(dt.getDate() + 1);
        const iso = dt.toISOString().split('T')[0];
        const h = getHoursForDate(iso);
        if (!h.isWeeklyOff) {
          return h.dayOfWeek ? h.dayOfWeek.charAt(0) + h.dayOfWeek.slice(1).toLowerCase() : 'next open day';
        }
      }
      return 'the next operating day';
    };

    const getPrevOpenDayName = (dateStr) => {
      const dt = new Date(dateStr + 'T00:00:00');
      for (let i = 1; i <= 7; i++) {
        dt.setDate(dt.getDate() - 1);
        const iso = dt.toISOString().split('T')[0];
        const h = getHoursForDate(iso);
        if (!h.isWeeklyOff) {
          return h.dayOfWeek ? h.dayOfWeek.charAt(0) + h.dayOfWeek.slice(1).toLowerCase() : 'last open day';
        }
      }
      return 'the last operating day';
    };

    // Reactive State Synchronizer
    const syncModalState = () => {
      const sVal = startInput?.value;
      const eVal = endInput?.value;
      if (!sVal || !eVal) return;

      const isSingleDay = sVal === eVal;
      const startHours = getHoursForDate(sVal);
      const endHours = getHoursForDate(eVal);

      const start12 = formatTimeTo12Hour(startHours.startTime);
      const end12 = formatTimeTo12Hour(startHours.endTime);
      const startDayLabel = startHours.dayOfWeek ? startHours.dayOfWeek.charAt(0) + startHours.dayOfWeek.slice(1).toLowerCase() : '';
      const endDayLabel = endHours.dayOfWeek ? endHours.dayOfWeek.charAt(0) + endHours.dayOfWeek.slice(1).toLowerCase() : '';

      let dateValidationError = null;

      if (isSingleDay) {
        if (shiftLabel) {
          shiftLabel.textContent = startHours.isWeeklyOff
            ? `💤 Weekly Off (${startDayLabel})`
            : `🕒 Shift: ${start12} - ${end12}`;
          shiftLabel.style.color = startHours.isWeeklyOff ? '#f59e0b' : '#c084fc';
        }

        if (startHours.isWeeklyOff) {
          dateValidationError = `💡 ${startDayLabel} is already a scheduled weekly off for the salon (already closed).`;
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
            if (!customStartInput.value || customStartInput.value < startHours.startTime || customStartInput.value > startHours.endTime) {
              customStartInput.value = startHours.startTime || '09:00';
            }
          }
          if (customEndInput) {
            customEndInput.removeAttribute('min');
            customEndInput.removeAttribute('max');
            if (!customEndInput.value || customEndInput.value > startHours.endTime || customEndInput.value <= startHours.startTime) {
              customEndInput.value = startHours.endTime || '12:00';
            }
          }
        }

        if (singleDaySection) singleDaySection.style.display = 'flex';
        if (multiDaySection) multiDaySection.style.display = 'none';
      } else {
        if (singleDaySection) singleDaySection.style.display = 'none';
        if (togglePartial) togglePartial.checked = false;
        if (partialInputs) partialInputs.style.display = 'none';

        const dt1 = new Date(sVal + 'T00:00:00');
        const dt2 = new Date(eVal + 'T00:00:00');
        const diffDays = Math.round((dt2 - dt1) / (1000 * 60 * 60 * 24)) + 1;

        if (multiDaySection) {
          multiDaySection.style.display = 'flex';
          if (multiDayText) {
            multiDayText.textContent = `📅 Multi-Day Closure: ${diffDays} Days (Full Salon Closure)`;
          }
        }

        // Multi-Day Range Boundary Validations:
        if (startHours.isWeeklyOff) {
          const nextOpen = getNextOpenDayName(sVal);
          dateValidationError = `💡 ${startDayLabel} is already a weekly off day. Since the salon is closed anyway, please start your closure from ${nextOpen}.`;
        } else if (endHours.isWeeklyOff) {
          const prevOpen = getPrevOpenDayName(eVal);
          dateValidationError = `💡 ${endDayLabel} is already a weekly off day. Since the salon is closed anyway, please end your closure on ${prevOpen}.`;
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

      // Check Weekly Off falling IN BETWEEN date range (which is fully allowed)
      const dayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
      const closedDays = salonWorkingHours.filter((h) => h.isClosed).map((h) => String(h.dayOfWeek).toUpperCase());
      const matchedOffs = new Set();

      const curr = new Date(sVal + 'T00:00:00');
      const end = new Date(eVal + 'T00:00:00');
      while (curr <= end) {
        const dName = dayNames[curr.getDay()];
        if (closedDays.includes(dName)) {
          matchedOffs.add(dName.charAt(0) + dName.slice(1).toLowerCase());
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

    // Time input validation listeners
    customStartInput?.addEventListener('input', validatePartialTimes);
    customStartInput?.addEventListener('change', validatePartialTimes);
    customEndInput?.addEventListener('input', validatePartialTimes);
    customEndInput?.addEventListener('change', validatePartialTimes);

    // Date listeners
    startInput?.addEventListener('change', () => {
      if (startInput.value && endInput) {
        endInput.min = startInput.value;
        if (endInput.value && endInput.value < startInput.value) {
          endInput.value = startInput.value;
        }
      }
      const sVal = startInput?.value;
      const hours = getHoursForDate(sVal);
      if (customStartInput && hours?.startTime) customStartInput.value = hours.startTime;
      if (customEndInput && hours?.endTime) customEndInput.value = hours.endTime;
      syncModalState();
    });

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
        const hours = getHoursForDate(sVal);
        if (customStartInput && hours?.startTime) customStartInput.value = hours.startTime;
        if (customEndInput && hours?.endTime) customEndInput.value = hours.endTime;
      }
      syncModalState();
    });

    // Preset titles organized contextually per category (Dropdown navigation, 0 overflow)
    const CATEGORY_PRESETS = {
      FESTIVAL: [
        { label: '🪔 Diwali Festival Break', reason: 'Diwali Festival Break' },
        { label: '🌙 Eid al-Fitr Holiday', reason: 'Eid al-Fitr Holiday' },
        { label: '🎨 Holi Celebration', reason: 'Holi Celebration' },
        { label: '🎄 Christmas Holiday', reason: 'Christmas Holiday' },
        { label: '🎉 New Year’s Day Celebration', reason: 'New Year’s Day Celebration' },
        { label: '✨ Dussehra Festival Holiday', reason: 'Dussehra Festival Holiday' },
        { label: '🪔 Dhanteras Break', reason: 'Dhanteras Festival Break' },
      ],
      HOLIDAY: [
        { label: '🌴 National Holiday', reason: 'National Holiday' },
        { label: '🎉 New Year Holiday', reason: 'New Year Holiday' },
        { label: '🏖️ Annual Vacation Break', reason: 'Annual Vacation Break' },
        { label: '☀️ Summer Holiday Break', reason: 'Summer Holiday Break' },
        { label: '🍂 Autumn Break', reason: 'Autumn Break' },
      ],
      EMERGENCY_CLOSURE: [
        { label: '🛠️ Store Renovation & Maintenance', reason: 'Store Renovation & Maintenance' },
        { label: '⚡ Power & Infrastructure Outage', reason: 'Power & Infrastructure Outage' },
        { label: '🔧 Urgent Facility Repairs', reason: 'Urgent Facility Repairs' },
        { label: '🚰 Plumbing & Water Pipe Leakage', reason: 'Plumbing & Water Leakage Repairs' },
        { label: '❄️ HVAC / AC System Breakdown', reason: 'HVAC / AC System Breakdown' },
        { label: '🚨 Deep Sanitization & Safety Audit', reason: 'Deep Sanitization & Safety Audit' },
      ],
      OTHER: [
        { label: '👥 Staff Training & Skill Workshop', reason: 'Staff Training & Skill Workshop' },
        { label: '✨ Private VIP Booking / Shoot', reason: 'Private VIP Booking / Photo Shoot' },
        { label: '📦 Annual Stock & Inventory Audit', reason: 'Annual Stock & Inventory Audit' },
        { label: '🎉 Salon Anniversary Celebration', reason: 'Salon Anniversary Celebration' },
      ],
    };

    const CATEGORY_PLACEHOLDERS = {
      FESTIVAL: 'e.g. Diwali Festival Break, Eid Holiday',
      HOLIDAY: 'e.g. National Holiday, Annual Vacation',
      EMERGENCY_CLOSURE: 'e.g. Store Renovation, Urgent Facility Repairs',
      OTHER: 'e.g. Staff Training Workshop, Private Event',
    };

    const ideasDropdown = document.getElementById('closure-ideas-dropdown');
    const ideasTrigger = document.getElementById('closure-ideas-trigger');
    const ideasMenu = document.getElementById('closure-ideas-menu');
    const ideasSelectedText = document.getElementById('closure-ideas-selected-text');

    const updateIdeasDropdown = (catType) => {
      const presets = CATEGORY_PRESETS[catType] || CATEGORY_PRESETS.FESTIVAL;
      const catNames = {
        FESTIVAL: 'Festival',
        HOLIDAY: 'Holiday',
        EMERGENCY_CLOSURE: 'Emergency',
        OTHER: 'Other',
      };
      const name = catNames[catType] || 'Preset';
      const placeholderText = `💡 Select a ${name.toLowerCase()} preset`;

      if (ideasSelectedText) {
        ideasSelectedText.innerHTML = `<span>${placeholderText}</span>`;
      }

      if (ideasDropdown) {
        ideasDropdown.innerHTML = `
          <option value="">${placeholderText}</option>
          ${presets.map((p) => `<option value="${p.reason.replace(/"/g, '&quot;')}">${p.label}</option>`).join('')}
        `;
        ideasDropdown.value = '';
      }

      if (ideasMenu) {
        ideasMenu.innerHTML = presets.map((p) => `
          <div class="custom-select-option closure-idea-opt" data-value="${p.reason.replace(/"/g, '&quot;')}" style="padding: 6px 10px; font-size: 0.73rem;">
            <span>${p.label}</span>
          </div>
        `).join('');

        ideasMenu.querySelectorAll('.closure-idea-opt').forEach((opt) => {
          opt.addEventListener('click', (e) => {
            e.stopPropagation();
            const selectedReason = opt.getAttribute('data-value');
            if (selectedReason && reasonInput) {
              reasonInput.value = selectedReason;
              reasonInput.focus();
              if (ideasSelectedText) {
                ideasSelectedText.innerHTML = `<span>${opt.textContent.trim()}</span>`;
              }
            }
            if (ideasDropdown) {
              ideasDropdown.value = selectedReason || '';
              ideasDropdown.dispatchEvent(new Event('change'));
            }
            ideasMenu.classList.remove('open');
            ideasMenu.style.display = 'none';
            ideasTrigger?.classList.remove('active');
            ideasTrigger?.querySelector('.custom-select-chevron')?.classList.remove('open');
          });
        });
      }
    };

    const toggleIdeasMenu = (forceOpen) => {
      if (!ideasMenu) return;
      const isOpen = forceOpen !== undefined ? forceOpen : !ideasMenu.classList.contains('open');
      ideasMenu.classList.toggle('open', isOpen);
      ideasMenu.style.display = isOpen ? 'flex' : 'none';
      ideasTrigger?.classList.toggle('active', isOpen);
      ideasTrigger?.querySelector('.custom-select-chevron')?.classList.toggle('open', isOpen);
    };

    ideasTrigger?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleIdeasMenu();
    });

    modalContainer.addEventListener('click', (e) => {
      if (!e.target.closest('#closure-ideas-container')) {
        toggleIdeasMenu(false);
      }
    });

    // Synchronize Category Chips visual state & ideas dropdown
    const updateCategoryChips = () => {
      const selectedType = modalContainer.querySelector('input[name="closureType"]:checked')?.value || 'FESTIVAL';
      modalContainer.querySelectorAll('.closure-cat-chip').forEach((chip) => {
        const val = chip.getAttribute('data-value');
        const isSelected = val === selectedType;
        if (isSelected) {
          chip.style.borderColor = chip.getAttribute('data-active-border');
          chip.style.background = chip.getAttribute('data-active-bg');
          chip.style.color = chip.getAttribute('data-active-color');
          chip.style.boxShadow = `0 2px 8px ${chip.getAttribute('data-active-bg')}`;
        } else {
          chip.style.borderColor = 'rgba(255, 255, 255, 0.08)';
          chip.style.background = 'rgba(255, 255, 255, 0.03)';
          chip.style.color = '#94a3b8';
          chip.style.boxShadow = 'none';
        }
      });
      if (reasonInput) {
        reasonInput.placeholder = CATEGORY_PLACEHOLDERS[selectedType] || 'e.g. Salon Closure Reason...';
      }
      updateIdeasDropdown(selectedType);
    };

    modalContainer.querySelectorAll('input[name="closureType"]').forEach((radio) => {
      radio.addEventListener('change', updateCategoryChips);
    });

    // Initial render of category visual state & contextual suggestions
    updateCategoryChips();
    syncModalState();

    // Form Submission
    document.getElementById('form-salon-closure-modal')?.addEventListener('submit', async (e) => {
      e.preventDefault();

      const reason = reasonInput?.value.trim();
      const startDate = startInput?.value;
      const endDate = endInput?.value;
      const closureType = modalContainer.querySelector('input[name="closureType"]:checked')?.value || 'FESTIVAL';
      const isPartialDay = Boolean(togglePartial?.checked && startDate === endDate);

      if (!reason || !startDate || !endDate) {
        CalendarState.notify('Please provide a reason and valid date range.', 'warning');
        return;
      }

      if (startDate < todayStr) {
        CalendarState.notify('Cannot schedule closures or holidays for dates that have already passed.', 'warning');
        return;
      }

      if (endDate < startDate) {
        CalendarState.notify('End date cannot be earlier than start date.', 'warning');
        return;
      }

      // Check client-side collision
      const overlapping = existingClosures.find((c) => {
        const cs = String(c.startDate).split('T')[0];
        const ce = String(c.endDate).split('T')[0];
        return (startDate <= ce && endDate >= cs);
      });
      if (overlapping) {
        CalendarState.notify(`A salon closure already exists overlapping these dates: "${overlapping.reason || 'Store Closure'}".`, 'warning');
        return;
      }

      const notes = notesInput?.value?.trim() || undefined;

      const payload = {
        closureType,
        startDate,
        endDate,
        reason,
        notes,
        isPartialDay,
      };

      if (isPartialDay) {
        if (!validatePartialTimes()) {
          return;
        }
        payload.startTime = customStartInput?.value || '09:00';
        payload.endTime = customEndInput?.value || '21:00';
      } else {
        const hours = getHoursForDate(startDate);
        payload.startTime = hours.startTime || '09:00';
        payload.endTime = hours.endTime || '21:00';
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<span>⏳ Processing Closure & Rescheduling...</span>`;
      }
      CalendarState.showLoading('Scheduling salon closure & rescheduling...');

      try {
        const res = await ApiClient.createSalonClosure(payload);
        const msg = res?.data?.message || res?.message || 'Salon closure scheduled successfully!';
        closeModal();
        CalendarState.hideLoading(0);
        CalendarState.notify(msg, 'success');
        if (typeof onSuccess === 'function') {
          try { onSuccess(); } catch (e) { console.warn(e); }
        }
        await CalendarState.refreshAll();
      } catch (err) {
        CalendarState.hideLoading(0);
        const isOverlapOrExists = err.message && (
          err.message.toLowerCase().includes('already exists') ||
          err.message.toLowerCase().includes('overlapping')
        );

        if (isOverlapOrExists) {
          CalendarState.notify(err.message, 'warning');
          closeModal();
          await CalendarState.refreshAll();
        } else {
          CalendarState.notify(err.message || 'Failed to schedule salon closure.', 'error');
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<span>🌴 Mark Salon Closed</span>`;
          }
        }
      }
    });

    // Run initial state calculation
    syncModalState();
    updateCategoryChips();
  }
}

// Expose globally for legacy script compatibility
if (typeof window !== 'undefined') {
  window.ScheduleDayOffDialog = ScheduleDayOffDialog;
}

// Backward compatibility alias
export { ScheduleDayOffDialog as SalonClosuresModal };
if (typeof window !== 'undefined') {
  window.SalonClosuresModal = ScheduleDayOffDialog;
}
