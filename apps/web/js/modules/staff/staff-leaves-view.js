import { WorkspaceHeader } from '../shared/workspace-header.js';
import { CalendarView } from '../calendar/calendar-view.js';
import { UniversalLoader } from '../shared/universal-loader.js';

/**
 * StaffLeavesView
 * Dedicated Workspace for Leaves & Time Off.
 * Powered by unified CalendarView in STAFF mode.
 */
export class StaffLeavesView {
  static render(ctx, staff) {
    const headerHtml = WorkspaceHeader.render({
      backLabel: 'Back',
      backActionId: 'btn-back-to-profile',
      breadcrumbs: [],
      statusText: '<span class="status-autosave-dot">●</span> Live Calendar',
    });

    return `
      <div class="staff-workspace-shell staff-leaves-workspace">
        ${headerHtml}
        <div class="workspace-body-content" id="staff-leaves-calendar-root">
          ${UniversalLoader.render({
            title: `Loading leaves for ${staff?.name || 'specialist'}...`,
            subtitle: 'Syncing specialist schedule & time off...',
            minHeight: '360px',
          })}
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
