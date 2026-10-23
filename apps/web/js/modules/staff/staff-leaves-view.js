import { WorkspaceHeader } from '../shared/workspace-header.js';
import { CalendarView } from '../calendar/calendar-view.js';

/**
 * StaffLeavesView
 * Dedicated Workspace for Leaves & Time Off.
 * Powered by unified CalendarView in STAFF mode.
 */
export class StaffLeavesView {
  static render(ctx, staff) {
    const headerHtml = WorkspaceHeader.render({
      backLabel: `Back to ${staff.name}`,
      backActionId: 'btn-back-to-profile',
      breadcrumbs: [],
      statusText: '<span class="status-autosave-dot">●</span> Live Calendar',
    });

    return `
      <div class="staff-workspace-shell staff-leaves-workspace">
        ${headerHtml}
        <div class="workspace-body-content" id="staff-leaves-calendar-root">
          <div style="display:flex;align-items:center;justify-content:center;min-height:360px;color:#a5b4fc;">
            <div style="width:34px;height:34px;border:3px solid rgba(165,180,252,0.2);border-top-color:#818cf8;border-radius:50%;animation:spin .8s linear infinite;"></div>
          </div>
        </div>
      </div>
    `;
  }

  static attachListeners(container, ctx, staff) {
    const calRoot = container.querySelector('#staff-leaves-calendar-root');
    if (calRoot) {
      CalendarView.mount(calRoot, {
        app: ctx,
        calendarFor: 'STAFF',
        staffId: staff.id,
        staffName: staff.name,
      });
    }
    ctx.attachStaffSubtabSpecificListeners(container, staff, 'leaves');
  }
}
