import { WorkspaceHeader } from '../shared/workspace-header.js';

/**
 * StaffScheduleView
 * Dedicated Workspace for Working Schedule & Shifts.
 * Encapsulates the WorkspaceHeader and delegates the 7-day grid,
 * master shifts, and routine breaks modal to dashboard context.
 */
export class StaffScheduleView {
  static render(ctx, staff) {
    const headerHtml = WorkspaceHeader.render({
      backLabel: `Back to ${staff.name}`,
      backActionId: 'btn-back-to-profile',
      breadcrumbs: [],
      statusText: '<span id="stylist-schedule-autosave-status"><span class="autosave-dot"></span><span class="autosave-text">Auto-saved</span></span>',
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
  }
}
