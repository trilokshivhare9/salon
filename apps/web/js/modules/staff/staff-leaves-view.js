import { WorkspaceHeader } from '../shared/workspace-header.js';

/**
 * StaffLeavesView
 * Dedicated Workspace for Leaves & Time Off.
 * Features:
 * - Clean WorkspaceHeader with back navigation and breadcrumbs
 * - High-contrast modular calendar integration
 * - Leave request history & detail inspection modal bridge
 */
export class StaffLeavesView {
  static render(ctx, staff) {
    const headerHtml = WorkspaceHeader.render({
      backLabel: `Back to ${staff.name}`,
      backActionId: 'btn-back-to-profile',
      breadcrumbs: [],
      statusText: '<span class="status-autosave-dot">●</span> Live Calendar',
    });

    const leavesContentHtml = ctx.renderStaffLeavesSubtab(staff);

    return `
      <div class="staff-workspace-shell staff-leaves-workspace">
        ${headerHtml}
        <div class="workspace-body-content">
          ${leavesContentHtml}
        </div>
      </div>
    `;
  }

  static attachListeners(container, ctx, staff) {
    ctx.attachStaffSubtabSpecificListeners(container, staff, 'leaves');
  }
}
