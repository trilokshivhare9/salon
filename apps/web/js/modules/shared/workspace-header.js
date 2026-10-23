/**
 * WorkspaceHeader
 * Reusable navigation bar with back button, breadcrumb trail, and live status badge.
 * Used across dedicated sub-screens (Schedule, Services, Leaves).
 */
export class WorkspaceHeader {
  /**
   * @param {Object} config
   * @param {string} config.backLabel - Text for the back button (e.g. "Back to Rahul's Profile")
   * @param {string} config.backActionId - ID for the back button (e.g. "btn-back-to-profile")
   * @param {Array<{label: string, actionId?: string, isCurrent?: boolean}>} config.breadcrumbs - Breadcrumb trail
   * @param {string} [config.statusText] - Optional status badge text (e.g. "⚡ Auto-saved")
   * @param {string} [config.extraActionHtml] - Optional extra action button HTML on the right
   * @returns {string} HTML string
   */
  static render(config) {
    const {
      backLabel = 'Back to Profile',
      backActionId = 'btn-back-to-profile',
      breadcrumbs = [],
      statusText = '',
      extraActionHtml = '',
    } = config;

    const breadcrumbsHtml = breadcrumbs.map((crumb, idx) => {
      const isLast = idx === breadcrumbs.length - 1;
      const isCurrent = crumb.isCurrent || isLast;
      return `
        <span class="crumb-item ${isCurrent ? 'is-current' : ''}" 
              ${crumb.actionId ? `data-breadcrumb-action="${crumb.actionId}"` : ''}>
          ${crumb.label}
        </span>
        ${!isLast ? '<span class="crumb-separator">/</span>' : ''}
      `;
    }).join('');

    return `
      <div class="workspace-header-shell">
        <div class="workspace-header-left">
          <button type="button" class="btn-workspace-back" id="${backActionId}" aria-label="${backLabel}">
            <span class="back-chevron">‹</span>
            <span class="back-text">${backLabel}</span>
          </button>
          ${breadcrumbsHtml ? `
          <nav class="workspace-breadcrumbs" aria-label="Breadcrumb navigation">
            ${breadcrumbsHtml}
          </nav>
          ` : ''}
        </div>
        <div class="workspace-header-right">
          ${statusText ? `<span class="workspace-live-status">${statusText}</span>` : ''}
          ${extraActionHtml}
        </div>
      </div>
    `;
  }
}
