import { WorkspaceHeader } from '../shared/workspace-header.js';
import { CalendarState } from '../calendar/index.js';

/**
 * StaffScheduleView
 * Dedicated Workspace for Working Schedule & Shifts.
 * Encapsulates the WorkspaceHeader and delegates the 7-day grid,
 * master shifts, and routine breaks modal to dashboard context.
 */
export class StaffScheduleView {
  static render(ctx, staff) {
    const headerHtml = WorkspaceHeader.render({
      backLabel: 'Back',
      backActionId: 'btn-back-to-profile',
      breadcrumbs: [],
      extraActionHtml: `
        <button type="button" class="btn-save-schedule" id="btn-save-staff-schedule" disabled onclick="window.salonDashboard?.saveStaffSchedule?.()" title="Save shift schedule">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
            <polyline points="17 21 17 13 7 13 7 21"></polyline>
            <polyline points="7 3 7 8 15 8"></polyline>
          </svg>
          <span>Save</span>
        </button>
      `,
    });

    const scheduleContentHtml = ctx.renderStaffHoursSubtab(staff);

    return `
      <div class="staff-workspace-shell staff-schedule-workspace">
        ${headerHtml}
        <div class="workspace-body-content">
          ${scheduleContentHtml}
        </div>
      </div>
    `;
  }

  static attachListeners(container, ctx, staff) {
    ctx.attachStaffSubtabSpecificListeners(container, staff, 'hours');

    // Unsaved changes guard on Back button
    const backBtn = container.querySelector('#btn-back-to-profile');
    if (backBtn) {
      backBtn.addEventListener('click', async (e) => {
        if (ctx && typeof ctx.isStaffScheduleDirty === 'function' && ctx.isStaffScheduleDirty()) {
          e.preventDefault();
          e.stopPropagation();
          const leave = await CalendarState.confirm({
            title: 'Unsaved Shift Changes',
            message: `You have unsaved changes to working hours for ${staff.name}. Leave without saving?`,
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

