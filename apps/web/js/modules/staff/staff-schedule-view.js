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
      breadcrumbs: [
        { label: 'Staff', actionId: 'nav-staff-list' },
        { label: staff.name, actionId: 'nav-staff-profile' },
        { label: 'Working Schedule & Shifts', isCurrent: true },
      ],
      statusText: '<span class="status-autosave-dot">●</span> Auto-saved',
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
