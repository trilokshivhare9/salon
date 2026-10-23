import { StaffProfileHub } from './staff-profile-hub.js';
import { StaffScheduleView } from './staff-schedule-view.js';
import { StaffServicesView } from './staff-services-view.js';
import { StaffLeavesView } from './staff-leaves-view.js';

/**
 * StaffManager
 * Domain orchestrator & sub-route state manager for the Staff subsystem.
 * Coordinates transitions between:
 * - Staff Profile Overview Hub ('overview')
 * - Dedicated Schedule & Shifts Workspace ('schedule')
 * - Dedicated Qualified Services Workspace ('services')
 * - Dedicated Leaves & Time Off Workspace ('leaves')
 */
export class StaffManager {
  constructor(dashboardContext) {
    this.ctx = dashboardContext;
    this.selectedStaffId = null;
    this.currentView = 'overview'; // 'overview' | 'schedule' | 'services' | 'leaves'
  }

  setStaff(staffId, initialView = 'overview') {
    this.selectedStaffId = staffId;
    this.currentView = initialView;
    this.ctx.selectedStaffId = staffId;
    try {
      if (staffId) {
        sessionStorage.setItem('active_staff_workspace', JSON.stringify({ staffId, view: initialView }));
      } else {
        sessionStorage.removeItem('active_staff_workspace');
      }
    } catch (_) {}
  }

  navigateTo(viewName) {
    this.currentView = viewName;
    try {
      if (this.selectedStaffId) {
        sessionStorage.setItem('active_staff_workspace', JSON.stringify({ staffId: this.selectedStaffId, view: viewName }));
      }
    } catch (_) {}
    this.ctx.render();
  }

  render() {
    const staff = (this.ctx.staffList || []).find((s) => s.id === this.selectedStaffId);
    if (!staff) {
      this.selectedStaffId = null;
      this.ctx.selectedStaffId = null;
      return this.ctx.renderStaffListView();
    }

    switch (this.currentView) {
      case 'schedule':
        return StaffScheduleView.render(this.ctx, staff);
      case 'services':
        return StaffServicesView.render(this.ctx, staff);
      case 'leaves':
        return StaffLeavesView.render(this.ctx, staff);
      case 'overview':
      default:
        return StaffProfileHub.render(this.ctx, staff);
    }
  }

  attachListeners(container) {
    const staff = (this.ctx.staffList || []).find((s) => s.id === this.selectedStaffId);
    if (!staff) return;

    // 1. Universal "Back to Profile" Link
    const backToProfileBtn = container.querySelector('#btn-back-to-profile');
    if (backToProfileBtn) {
      backToProfileBtn.onclick = (e) => {
        e.preventDefault();
        this.navigateTo('overview');
      };
    }

    // 2. Interactive Breadcrumb Navigation
    container.querySelectorAll('[data-breadcrumb-action]').forEach((crumb) => {
      crumb.onclick = (e) => {
        e.preventDefault();
        const action = crumb.getAttribute('data-breadcrumb-action');
        if (action === 'nav-staff-list') {
          this.setStaff(null);
          this.ctx.render();
        } else if (action === 'nav-staff-profile') {
          this.navigateTo('overview');
        }
      };
    });

    // 3. Delegate to the active view
    switch (this.currentView) {
      case 'schedule':
        StaffScheduleView.attachListeners(container, this.ctx, staff);
        break;
      case 'services':
        StaffServicesView.attachListeners(container, this.ctx, staff);
        break;
      case 'leaves':
        StaffLeavesView.attachListeners(container, this.ctx, staff);
        break;
      case 'overview':
      default:
        StaffProfileHub.attachListeners(container, this, staff);
        break;
    }
  }
}
