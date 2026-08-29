import { ApiClient } from './api.js';

export class SalonDashboard {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.activeTab = 'calendar';
    this.selectedDate = new Date().toISOString().split('T')[0];
    this.summaryData = null;
    this.staffList = [];
    this.servicesList = [];
    this.customersData = null;
  }

  async init() {
    this.renderLoading();
    try {
      await this.loadData();
      this.render();
    } catch (err) {
      console.error(err);
      this.container.innerHTML = `
        <div class="glass-panel text-center" style="padding: 40px; text-align: center;">
          <h2 style="color: var(--danger); margin-bottom: 12px;">Authentication Required</h2>
          <p style="color: var(--text-secondary); margin-bottom: 20px;">Please login as a salon owner or staff member.</p>
          <button class="btn btn-primary" id="btn-goto-login">Login to Salon Admin</button>
        </div>
      `;
      document.getElementById('btn-goto-login')?.addEventListener('click', () => {
        window.location.hash = '#login';
      });
    }
  }

  async loadData() {
    const [summary, staff, services] = await Promise.all([
      ApiClient.getDashboardSummary(this.selectedDate),
      ApiClient.getStaff(),
      ApiClient.getServices(),
    ]);

    this.summaryData = summary;
    this.staffList = staff;
    this.servicesList = services;
  }

  renderLoading() {
    this.container.innerHTML = `
      <div style="text-align: center; padding: 60px;">
        <div style="font-size: 1.5rem; font-family: var(--font-heading); color: #818cf8;">Loading Salon Operations Dashboard...</div>
      </div>
    `;
  }

  render() {
    const { statusCounts, todayRevenue, todayAppointments } = this.summaryData;

    this.container.innerHTML = `
      <div class="app-container">
        <!-- Top Operations Bar -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; flex-wrap: wrap; gap: 16px;">
          <div>
            <h1 style="font-size: 1.8rem;">Salon Operations Dashboard</h1>
            <p style="color: var(--text-secondary); font-size: 0.9rem;">
              Manage daily schedule, staff, appointments, and client reception.
            </p>
          </div>
          <div style="display: flex; gap: 12px; flex-wrap: wrap;">
            <a href="#whatsapp-simulator" class="btn btn-secondary" style="border-color: rgba(37,211,102,0.4); color: #25D366;">
              💬 Test WhatsApp Bot
            </a>
            <button class="btn btn-secondary" id="btn-open-qr">
              📱 Booking QR
            </button>
            <button class="btn btn-primary" id="btn-open-create-modal">
              + New Appointment
            </button>
          </div>
        </div>

        <!-- Navigation Tabs -->
        <div style="display: flex; gap: 8px; margin-bottom: 24px; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; overflow-x: auto;">
          <button class="nav-tab ${this.activeTab === 'calendar' ? 'active' : ''}" data-tab="calendar">📅 Schedule & Calendar</button>
          <button class="nav-tab ${this.activeTab === 'staff' ? 'active' : ''}" data-tab="staff">👥 Staff Roster (${this.staffList.length})</button>
          <button class="nav-tab ${this.activeTab === 'services' ? 'active' : ''}" data-tab="services">✂️ Services Menu (${this.servicesList.length})</button>
          <button class="nav-tab ${this.activeTab === 'customers' ? 'active' : ''}" data-tab="customers">👤 Client CRM</button>
          <button class="nav-tab ${this.activeTab === 'whatsapp' ? 'active' : ''}" data-tab="whatsapp">💬 WhatsApp Integration</button>
        </div>

        <!-- Tab Content -->
        <div id="tab-content">
          ${this.getTabHtml()}
        </div>
      </div>

      <!-- Modal Container -->
      <div id="modal-container"></div>
    `;

    this.attachEventListeners();
  }

  getTabHtml() {
    switch (this.activeTab) {
      case 'calendar':
        return this.renderCalendarTab();
      case 'staff':
        return this.renderStaffTab();
      case 'services':
        return this.renderServicesTab();
      case 'customers':
        return this.renderCustomersTab();
      case 'whatsapp':
        return this.renderWhatsAppTab();
      default:
        return '';
    }
  }

  renderCalendarTab() {
    const { statusCounts, todayRevenue, todayAppointments } = this.summaryData;

    return `
      <!-- KPI Stats Grid -->
      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-label">TODAY'S BOOKINGS</div>
          <div class="stat-value">${statusCounts.total}</div>
          <div class="stat-sub">Confirmed: ${statusCounts.confirmed} • In Service: ${statusCounts.inService}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">COMPLETED SERVICES</div>
          <div class="stat-value" style="color: var(--success);">${statusCounts.completed}</div>
          <div class="stat-sub">Checked-in: ${statusCounts.checkedIn}</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">TODAY'S REVENUE</div>
          <div class="stat-value" style="color: #10b981;">₹${todayRevenue.toLocaleString()}</div>
          <div class="stat-sub">From completed bookings</div>
        </div>
        <div class="stat-card">
          <div class="stat-label">CANCELLATIONS / NO-SHOW</div>
          <div class="stat-value" style="color: var(--danger);">${statusCounts.cancelled + statusCounts.noShow}</div>
          <div class="stat-sub">Cancelled: ${statusCounts.cancelled} • No Show: ${statusCounts.noShow}</div>
        </div>
      </div>

      <!-- Calendar Controls & Schedule -->
      <div class="glass-panel">
        <div class="calendar-header">
          <div class="date-selector">
            <h3 style="margin-right: 8px;">Appointments Schedule</h3>
            <input type="date" class="form-control" id="dashboard-date-picker" value="${this.selectedDate}" style="width: auto; padding: 6px 12px;" />
          </div>
          <div style="font-size: 0.85rem; color: var(--text-muted);">
            Timezone: <strong>${this.summaryData.timezone}</strong>
          </div>
        </div>

        <div class="appointments-list">
          ${todayAppointments.length === 0 ? `
            <div style="text-align: center; padding: 40px; color: var(--text-muted);">
              No appointments scheduled for this date.
            </div>
          ` : todayAppointments.map(appt => `
            <div class="appointment-card">
              <div class="appt-time">
                ${new Date(appt.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>

              <div class="appt-client">
                <h4>${appt.customer.name}</h4>
                <span>📞 ${appt.customer.phone}</span>
              </div>

              <div class="appt-service">
                <div style="font-weight: 600;">${appt.service.name}</div>
                <div style="font-size: 0.8rem; color: var(--text-secondary);">₹${appt.price} • ${appt.service.durationMinutes} mins • <span class="badge" style="font-size: 0.65rem;">${appt.source}</span></div>
              </div>

              <div class="appt-staff">
                <img src="${appt.staff.profileImageUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150'}" class="avatar-sm" />
                <span>${appt.staff.name}</span>
              </div>

              <div class="appt-actions">
                <span class="badge badge-${appt.status.toLowerCase()}">${appt.status}</span>
                
                ${appt.status === 'CONFIRMED' ? `
                  <button class="btn btn-secondary btn-sm btn-status" data-id="${appt.id}" data-status="CHECKED_IN">Check In</button>
                ` : ''}

                ${appt.status === 'CHECKED_IN' ? `
                  <button class="btn btn-primary btn-sm btn-status" data-id="${appt.id}" data-status="IN_SERVICE">Start Service</button>
                ` : ''}

                ${appt.status === 'IN_SERVICE' ? `
                  <button class="btn btn-primary btn-sm btn-status" style="background: var(--success); border-color: var(--success);" data-id="${appt.id}" data-status="COMPLETED">Complete</button>
                ` : ''}

                ${appt.status === 'CONFIRMED' || appt.status === 'CHECKED_IN' ? `
                  <button class="btn btn-secondary btn-sm btn-status" style="color: var(--danger);" data-id="${appt.id}" data-status="CANCELLED">Cancel</button>
                ` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  renderStaffTab() {
    return `
      <div class="glass-panel">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px;">
          <h3>Staff Roster & Service Capabilities</h3>
          <button class="btn btn-primary btn-sm" id="btn-add-staff">+ Add Staff Member</button>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px;">
          ${this.staffList.map(st => `
            <div style="background: var(--bg-input); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 20px;">
              <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                <img src="${st.profileImageUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150'}" class="avatar-sm" style="width: 48px; height: 48px;" />
                <div>
                  <div style="font-weight: 700; font-size: 1.05rem;">${st.name}</div>
                  <div style="font-size: 0.8rem; color: var(--text-secondary);">${st.phone || 'No phone'}</div>
                </div>
              </div>
              <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 8px;">Qualified Services:</div>
              <div style="display: flex; flex-wrap: wrap; gap: 6px;">
                ${st.services && st.services.length > 0 ? st.services.map(svc => `
                  <span class="badge" style="background: rgba(99,102,241,0.15); color: #818cf8;">${svc.service?.name}</span>
                `).join('') : '<span style="font-size: 0.8rem; color: var(--text-muted);">No services assigned</span>'}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  renderServicesTab() {
    return `
      <div class="glass-panel">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px;">
          <h3>Service Catalog</h3>
          <button class="btn btn-primary btn-sm" id="btn-add-service">+ Add New Service</button>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px;">
          ${this.servicesList.map(s => `
            <div style="background: var(--bg-input); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 20px;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                <div style="font-weight: 700; font-size: 1.05rem;">${s.name}</div>
                <div style="font-weight: 700; color: #10b981; font-size: 1.1rem;">₹${s.price}</div>
              </div>
              <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 12px;">${s.description || 'No description'}</div>
              <div style="display: flex; justify-content: space-between; font-size: 0.8rem; color: var(--text-muted);">
                <span>⏱️ ${s.durationMinutes} minutes</span>
                <span class="badge badge-confirmed">${s.category || 'General'}</span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  renderCustomersTab() {
    return `
      <div class="glass-panel">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 12px;">
          <h3>Client CRM & Visit History</h3>
          <input type="text" class="form-control" id="customer-search-input" placeholder="Search by name or phone..." style="max-width: 280px;" />
        </div>
        <div id="customers-table-container">
          <div style="text-align: center; padding: 20px; color: var(--text-muted);">Loading client records...</div>
        </div>
      </div>
    `;
  }

  async loadCustomersTable(searchTerm = '') {
    const tableContainer = document.getElementById('customers-table-container');
    if (!tableContainer) return;

    try {
      const res = await ApiClient.getCustomers(searchTerm);
      const customers = res.data || [];

      if (customers.length === 0) {
        tableContainer.innerHTML = `<div style="text-align: center; padding: 30px; color: var(--text-muted);">No client records found.</div>`;
        return;
      }

      tableContainer.innerHTML = `
        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem;">
            <thead>
              <tr style="border-bottom: 1px solid var(--border-color); color: var(--text-secondary);">
                <th style="padding: 12px;">CLIENT</th>
                <th style="padding: 12px;">PHONE</th>
                <th style="padding: 12px;">TOTAL VISITS</th>
                <th style="padding: 12px;">TOTAL SPEND</th>
                <th style="padding: 12px;">LAST VISIT</th>
              </tr>
            </thead>
            <tbody>
              ${customers.map(c => `
                <tr style="border-bottom: 1px solid rgba(255,255,255,0.04);">
                  <td style="padding: 12px; font-weight: 600;">${c.name}</td>
                  <td style="padding: 12px; color: var(--text-secondary);">${c.phone}</td>
                  <td style="padding: 12px;"><span class="badge" style="background: rgba(99,102,241,0.15); color: #818cf8;">${c.totalVisits} visits</span></td>
                  <td style="padding: 12px; font-weight: 700; color: #10b981;">₹${Number(c.totalSpend).toLocaleString()}</td>
                  <td style="padding: 12px; color: var(--text-muted);">${c.lastVisitAt ? new Date(c.lastVisitAt).toLocaleDateString() : 'New Client'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (err) {
      tableContainer.innerHTML = `<div style="color: var(--danger);">${err.message}</div>`;
    }
  }

  showAddStaffModal() {
    const modalContainer = document.getElementById('modal-container');
    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Add Staff Member</h3>
            <button class="close-btn" id="btn-close-staff-modal">&times;</button>
          </div>

          <form id="add-staff-form">
            <div class="form-group">
              <label>Staff Member Name *</label>
              <input type="text" class="form-control" id="new-staff-name" placeholder="e.g. Neha Kapoor" required />
            </div>

            <div class="form-group">
              <label>Phone Number *</label>
              <input type="tel" class="form-control" id="new-staff-phone" placeholder="+91 98123 45678" required />
            </div>

            <div class="form-group">
              <label>Email Address</label>
              <input type="email" class="form-control" id="new-staff-email" placeholder="neha@example.com" />
            </div>

            <div class="form-group">
              <label>Assign Services (Select Services Qualified to Perform)</label>
              <div style="max-height: 140px; overflow-y: auto; background: var(--bg-input); border: 1px solid var(--border-color); border-radius: var(--radius-sm); padding: 10px;">
                ${this.servicesList.map(s => `
                  <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; cursor: pointer; color: var(--text-primary);">
                    <input type="checkbox" class="staff-svc-cb" value="${s.id}" checked />
                    <span>${s.name} (₹${s.price})</span>
                  </label>
                `).join('')}
              </div>
            </div>

            <div id="staff-error-msg" style="color: var(--danger); font-size: 0.85rem; margin-bottom: 12px; display: none;"></div>

            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
              <button type="button" class="btn btn-secondary" id="btn-cancel-staff-modal">Cancel</button>
              <button type="submit" class="btn btn-primary" id="btn-submit-staff">Save Staff</button>
            </div>
          </form>
        </div>
      </div>
    `;

    document.getElementById('btn-close-staff-modal')?.addEventListener('click', () => { modalContainer.innerHTML = ''; });
    document.getElementById('btn-cancel-staff-modal')?.addEventListener('click', () => { modalContainer.innerHTML = ''; });

    document.getElementById('add-staff-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('new-staff-name').value.trim();
      const phone = document.getElementById('new-staff-phone').value.trim();
      const email = document.getElementById('new-staff-email').value.trim();
      const selectedServiceIds = Array.from(document.querySelectorAll('.staff-svc-cb:checked')).map(cb => cb.value);

      try {
        await ApiClient.request('/staff', {
          method: 'POST',
          body: JSON.stringify({
            name,
            phone,
            email: email || undefined,
            serviceIds: selectedServiceIds,
          }),
        });

        modalContainer.innerHTML = '';
        await this.loadData();
        this.render();
      } catch (err) {
        const errorMsg = document.getElementById('staff-error-msg');
        errorMsg.textContent = err.message;
        errorMsg.style.display = 'block';
      }
    });
  }

  showAddServiceModal() {
    const modalContainer = document.getElementById('modal-container');
    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content">
          <div class="modal-header">
            <h3>Add New Service</h3>
            <button class="close-btn" id="btn-close-svc-modal">&times;</button>
          </div>

          <form id="add-svc-form">
            <div class="form-group">
              <label>Service Name *</label>
              <input type="text" class="form-control" id="new-svc-name" placeholder="e.g. Keratin Hair Treatment" required />
            </div>

            <div class="form-group">
              <label>Description</label>
              <textarea class="form-control" id="new-svc-desc" rows="2" placeholder="Brief service details..."></textarea>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div class="form-group">
                <label>Price (₹) *</label>
                <input type="number" class="form-control" id="new-svc-price" min="0" placeholder="1000" required />
              </div>
              <div class="form-group">
                <label>Duration (Minutes) *</label>
                <select class="form-control" id="new-svc-duration" required>
                  <option value="15">15 mins</option>
                  <option value="30" selected>30 mins</option>
                  <option value="45">45 mins</option>
                  <option value="60">60 mins</option>
                  <option value="90">90 mins</option>
                  <option value="120">120 mins</option>
                </select>
              </div>
            </div>

            <div class="form-group">
              <label>Category</label>
              <input type="text" class="form-control" id="new-svc-category" placeholder="Hair, Skin, Spa, Nails" />
            </div>

            <div id="svc-error-msg" style="color: var(--danger); font-size: 0.85rem; margin-bottom: 12px; display: none;"></div>

            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
              <button type="button" class="btn btn-secondary" id="btn-cancel-svc-modal">Cancel</button>
              <button type="submit" class="btn btn-primary" id="btn-submit-svc">Save Service</button>
            </div>
          </form>
        </div>
      </div>
    `;

    document.getElementById('btn-close-svc-modal')?.addEventListener('click', () => { modalContainer.innerHTML = ''; });
    document.getElementById('btn-cancel-svc-modal')?.addEventListener('click', () => { modalContainer.innerHTML = ''; });

    document.getElementById('add-svc-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await ApiClient.request('/services', {
          method: 'POST',
          body: JSON.stringify({
            name: document.getElementById('new-svc-name').value.trim(),
            description: document.getElementById('new-svc-desc').value.trim() || undefined,
            price: parseFloat(document.getElementById('new-svc-price').value),
            durationMinutes: parseInt(document.getElementById('new-svc-duration').value, 10),
            category: document.getElementById('new-svc-category').value.trim() || 'General',
          }),
        });

        modalContainer.innerHTML = '';
        await this.loadData();
        this.render();
      } catch (err) {
        const errorMsg = document.getElementById('svc-error-msg');
        errorMsg.textContent = err.message;
        errorMsg.style.display = 'block';
      }
    });
  }

  showCreateAppointmentModal() {
    const modalContainer = document.getElementById('modal-container');
    modalContainer.innerHTML = `
      <div class="modal-backdrop show" id="create-appt-modal">
        <div class="modal-content">
          <div class="modal-header">
            <h3>New Appointment (Walk-in / Phone)</h3>
            <button class="close-btn" id="btn-close-modal">&times;</button>
          </div>

          <form id="create-appt-form">
            <div class="form-group">
              <label>Client Name *</label>
              <input type="text" class="form-control" id="modal-cust-name" placeholder="Full name" required />
            </div>

            <div class="form-group">
              <label>Client Phone *</label>
              <input type="tel" class="form-control" id="modal-cust-phone" placeholder="Phone number" required />
            </div>

            <div class="form-group">
              <label>Service *</label>
              <select class="form-control" id="modal-service-id" required>
                ${this.servicesList.map(s => `<option value="${s.id}">${s.name} (₹${s.price} • ${s.durationMinutes}m)</option>`).join('')}
              </select>
            </div>

            <div class="form-group">
              <label>Staff Specialist *</label>
              <select class="form-control" id="modal-staff-id" required>
                ${this.staffList.map(st => `<option value="${st.id}">${st.name}</option>`).join('')}
              </select>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div class="form-group">
                <label>Date *</label>
                <input type="date" class="form-control" id="modal-date" value="${this.selectedDate}" required />
              </div>
              <div class="form-group">
                <label>Time (HH:mm) *</label>
                <input type="time" class="form-control" id="modal-time" value="12:00" required />
              </div>
            </div>

            <div class="form-group">
              <label>Booking Source</label>
              <select class="form-control" id="modal-source">
                <option value="WALK_IN">Walk-in Reception</option>
                <option value="PHONE">Phone Call</option>
                <option value="MANUAL">Manual Entry</option>
              </select>
            </div>

            <div id="modal-error-msg" style="color: var(--danger); font-size: 0.85rem; margin-bottom: 12px; display: none;"></div>

            <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
              <button type="button" class="btn btn-secondary" id="btn-cancel-modal">Cancel</button>
              <button type="submit" class="btn btn-primary" id="btn-submit-modal">Create Booking</button>
            </div>
          </form>
        </div>
      </div>
    `;

    document.getElementById('btn-close-modal')?.addEventListener('click', () => { modalContainer.innerHTML = ''; });
    document.getElementById('btn-cancel-modal')?.addEventListener('click', () => { modalContainer.innerHTML = ''; });

    document.getElementById('create-appt-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorMsg = document.getElementById('modal-error-msg');
      const submitBtn = document.getElementById('btn-submit-modal');
      submitBtn.textContent = 'Saving...';
      submitBtn.setAttribute('disabled', 'true');

      try {
        await ApiClient.createAppointment({
          customerName: document.getElementById('modal-cust-name').value,
          customerPhone: document.getElementById('modal-cust-phone').value,
          serviceId: document.getElementById('modal-service-id').value,
          staffId: document.getElementById('modal-staff-id').value,
          date: document.getElementById('modal-date').value,
          startTime: document.getElementById('modal-time').value,
          source: document.getElementById('modal-source').value,
        });

        modalContainer.innerHTML = '';
        await this.loadData();
        this.render();
      } catch (err) {
        errorMsg.textContent = err.message;
        errorMsg.style.display = 'block';
        submitBtn.textContent = 'Create Booking';
        submitBtn.removeAttribute('disabled');
      }
    });
  }

  renderWhatsAppTab() {
    const salon = this.summaryData?.salon || {};
    const salonSlug = salon.slug || 'glamour-studio';
    const salonName = salon.name || 'Salon';
    const cleanPhone = salon.phone ? salon.phone.replace(/[^\d]/g, '') : '';
    const hasOfficialNumber = !!(cleanPhone && !cleanPhone.includes('5556749314') && cleanPhone.length >= 10);
    const waChatUrl = hasOfficialNumber
      ? `https://wa.me/${cleanPhone}`
      : `https://wa.me/15556749314?text=${encodeURIComponent(`BOOK ${salonSlug}`)}`;

    return `
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start;">
        <!-- Left: Official WhatsApp Connection Card -->
        <div class="glass-panel" style="padding: 24px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <div style="display: flex; align-items: center; gap: 10px;">
              <div style="font-size: 1.8rem;">💬</div>
              <div>
                <h3 style="margin: 0; font-size: 1.2rem;">Official WhatsApp Connection</h3>
                <div style="font-size: 0.8rem; color: var(--text-secondary);">Meta Cloud API Integration</div>
              </div>
            </div>
            <span class="badge ${hasOfficialNumber ? 'badge-completed' : 'badge-confirmed'}" style="font-size: 0.75rem;">
              ${hasOfficialNumber ? '🟢 LIVE CONNECTED' : '🟡 SANDBOX READY'}
            </span>
          </div>

          <p style="color: var(--text-secondary); font-size: 0.85rem; line-height: 1.5; margin-bottom: 20px;">
            Connect your salon's official WhatsApp Business number. Customers will message this number directly to book appointments 24/7.
          </p>

          <div style="background: var(--bg-input); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 16px; margin-bottom: 20px;">
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 4px;">ACTIVE WHATSAPP NUMBER</div>
            <div style="font-size: 1.1rem; font-weight: 700; color: #25D366;">
              ${salon.phone || '+1 (555) 674-9314'}
            </div>
            <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 4px;">
              ${hasOfficialNumber ? 'Direct dedicated number connected for this salon.' : 'Using shared Meta test sandbox router.'}
            </div>
          </div>

          <!-- 1. Official Meta Embedded Signup (Automated Popup) -->
          <div style="margin-bottom: 20px;">
            <button type="button" class="btn btn-primary" style="width: 100%; background: #25D366; border-color: #25D366; font-size: 0.95rem; font-weight: 700; padding: 12px;" id="btn-meta-popup-connect">
              🟢 Connect WhatsApp via Meta Popup (Automated)
            </button>
            <div style="font-size: 0.75rem; color: var(--text-muted); text-align: center; margin-top: 6px;">
              Opens official Meta popup • No developer portal needed
            </div>
          </div>

          <!-- 2. Or Direct Phone Number Connect Form -->
          <div style="border-top: 1px solid var(--border-color); padding-top: 16px; margin-top: 16px;">
            <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">Or Enter Phone Details Directly</div>
            <form id="form-connect-whatsapp">
              <div class="form-group">
                <label style="font-size: 0.8rem;">Meta Phone Number ID *</label>
                <input type="text" class="form-control" id="wa-phone-id" placeholder="e.g. 1266237649907696" required />
              </div>
              <div class="form-group">
                <label style="font-size: 0.8rem;">Official Salon WhatsApp Number *</label>
                <input type="tel" class="form-control" id="wa-display-phone" placeholder="e.g. +91 98111 22334" required />
              </div>
              <div id="wa-connect-msg" style="font-size: 0.85rem; margin-bottom: 12px; display: none;"></div>
              <div style="display: flex; gap: 10px;">
                <button type="submit" class="btn btn-secondary" style="width: 100%; font-size: 0.85rem;" id="btn-save-wa">
                  Save Direct Phone ID →
                </button>
              </div>
            </form>
          </div>
        </div>

        <!-- Right: Tabletop Standee & QR Code Poster -->
        <div class="glass-panel" style="padding: 24px; text-align: center;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h3 style="margin: 0; font-size: 1.2rem;">📱 Reception Desk Standee</h3>
            <span class="badge" style="background: rgba(37,211,102,0.15); color: #25D366;">Ready To Print</span>
          </div>

          <!-- Branded Table Stand Preview -->
          <div style="background: linear-gradient(135deg, #111827 0%, #1e1b4b 100%); border: 2px solid rgba(99,102,241,0.4); border-radius: var(--radius-lg); padding: 24px 20px; margin-bottom: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
            <div style="font-size: 1.4rem; font-weight: 800; font-family: var(--font-heading); color: #fff; margin-bottom: 4px;">
              ${salonName}
            </div>
            <div style="font-size: 0.85rem; color: #818cf8; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px;">
              Instant WhatsApp Booking
            </div>

            <div style="background: #fff; padding: 12px; border-radius: var(--radius-md); display: inline-block; margin-bottom: 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
              <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(waChatUrl)}" style="width: 160px; height: 160px; display: block;" alt="WhatsApp Booking QR" />
            </div>

            <div style="font-size: 0.9rem; font-weight: 700; color: #25D366; margin-bottom: 4px;">
              Scan Camera to Book in 30 Secs
            </div>
            <div style="font-size: 0.75rem; color: #94a3b8;">
              No App Download • 24/7 Live Confirmation
            </div>
          </div>

          <div style="display: flex; gap: 10px; justify-content: center;">
            <button class="btn btn-primary" onclick="window.print()" style="flex: 1;">
              🖨️ Print Reception Standee
            </button>
            <a href="${waChatUrl}" target="_blank" class="btn btn-secondary" style="border-color: rgba(37,211,102,0.4); color: #25D366;">
              Test Link ↗
            </a>
          </div>
        </div>
      </div>
    `;
  }

  showQrModal() {
    const modalContainer = document.getElementById('modal-container');
    const salonSlug = this.summaryData?.salon?.slug || 'glamour-studio';
    const salonName = this.summaryData?.salon?.name || 'Glamour Studio & Lounge';
    
    const salon = this.summaryData?.salon || {};
    const cleanPhone = salon.phone ? salon.phone.replace(/[^\d]/g, '') : '';
    const hasOfficialNumber = !!(cleanPhone && !cleanPhone.includes('5556749314') && cleanPhone.length >= 10);
    const waChatUrl = hasOfficialNumber
      ? `https://wa.me/${cleanPhone}`
      : `https://wa.me/15556749314?text=${encodeURIComponent(`BOOK ${salonSlug}`)}`;

    // Reachable Web URL (using Cloudflare Tunnel for phone accessibility)
    const webBookingUrl = `https://accepts-mate-conflicts-excuse.trycloudflare.com/#book/${salonSlug}`;

    modalContainer.innerHTML = `
      <div class="modal-backdrop show">
        <div class="modal-content text-center" style="max-width: 520px; text-align: center;">
          <div class="modal-header">
            <h3>📱 ${salonName} QR Codes</h3>
            <button class="close-btn" id="btn-close-qr-modal">&times;</button>
          </div>

          <p style="color: var(--text-secondary); font-size: 0.85rem; margin-bottom: 20px;">
            Scan with your phone camera to start instant 24/7 booking!
          </p>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 20px;">
            <!-- 1. WHATSAPP QR CODE (Scan to open WhatsApp Chat) -->
            <div style="background: rgba(37,211,102,0.08); border: 1px solid rgba(37,211,102,0.3); border-radius: var(--radius-md); padding: 16px;">
              <div style="font-weight: 700; color: #25D366; font-size: 0.9rem; margin-bottom: 8px;">💬 WhatsApp Direct QR</div>
              <div style="background: #fff; padding: 10px; border-radius: var(--radius-sm); display: inline-block; margin-bottom: 8px;">
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(waChatUrl)}" style="width: 130px; height: 130px; display: block;" alt="WhatsApp Booking QR" />
              </div>
              <div style="font-size: 0.75rem; color: #e9edef; margin-bottom: 10px; font-weight: 600;">Scan with Phone Camera</div>
              <a href="${waChatUrl}" target="_blank" class="btn btn-secondary btn-sm" style="width: 100%; border-color: rgba(37,211,102,0.4); color: #25D366; font-size: 0.75rem;">
                Open WhatsApp Link ↗
              </a>
            </div>

            <!-- 2. WEB BOOKING QR CODE (Scan to open Web Wizard) -->
            <div style="background: rgba(99,102,241,0.08); border: 1px solid rgba(99,102,241,0.3); border-radius: var(--radius-md); padding: 16px;">
              <div style="font-weight: 700; color: #818cf8; font-size: 0.9rem; margin-bottom: 8px;">🌐 Web Booking QR</div>
              <div style="background: #fff; padding: 10px; border-radius: var(--radius-sm); display: inline-block; margin-bottom: 8px;">
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(webBookingUrl)}" style="width: 130px; height: 130px; display: block;" alt="Web Booking QR" />
              </div>
              <div style="font-size: 0.75rem; color: #e9edef; margin-bottom: 10px; font-weight: 600;">Opens Web Booking</div>
              <a href="${webBookingUrl}" target="_blank" class="btn btn-secondary btn-sm" style="width: 100%; font-size: 0.75rem;">
                Open Web Link ↗
              </a>
            </div>
          </div>

          <div style="display: flex; gap: 12px; justify-content: center;">
            <button class="btn btn-primary btn-sm" onclick="window.print()">
              🖨️ Print Standee for Reception
            </button>
            <button class="btn btn-secondary btn-sm" id="btn-close-qr-bottom">Close</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-close-qr-modal')?.addEventListener('click', () => { modalContainer.innerHTML = ''; });
    document.getElementById('btn-close-qr-bottom')?.addEventListener('click', () => { modalContainer.innerHTML = ''; });
  }

  attachEventListeners() {
    this.container.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        this.activeTab = e.currentTarget.dataset.tab;
        this.render();
        if (this.activeTab === 'customers') {
          this.loadCustomersTable();
        }
      });
    });

    const datePicker = document.getElementById('dashboard-date-picker');
    datePicker?.addEventListener('change', async (e) => {
      this.selectedDate = e.target.value;
      this.renderLoading();
      await this.loadData();
      this.render();
    });

    this.container.querySelectorAll('.btn-status').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const apptId = e.currentTarget.dataset.id;
        const newStatus = e.currentTarget.dataset.status;
        try {
          await ApiClient.updateAppointmentStatus(apptId, newStatus);
          await this.loadData();
          this.render();
        } catch (err) {
          alert(`Status update failed: ${err.message}`);
        }
      });
    });

    document.getElementById('customer-search-input')?.addEventListener('input', (e) => {
      this.loadCustomersTable(e.target.value);
    });

    document.getElementById('btn-open-create-modal')?.addEventListener('click', () => {
      this.showCreateAppointmentModal();
    });

    document.getElementById('btn-open-qr')?.addEventListener('click', () => {
      this.showQrModal();
    });

    document.getElementById('btn-add-staff')?.addEventListener('click', () => {
      this.showAddStaffModal();
    });

    document.getElementById('btn-add-service')?.addEventListener('click', () => {
      this.showAddServiceModal();
    });

    document.getElementById('form-connect-whatsapp')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const phoneId = document.getElementById('wa-phone-id').value.trim();
      const displayPhone = document.getElementById('wa-display-phone').value.trim();
      const btn = document.getElementById('btn-save-wa');
      const msgDiv = document.getElementById('wa-connect-msg');

      btn.textContent = 'Connecting...';
      btn.setAttribute('disabled', 'true');

      try {
        await ApiClient.request('/whatsapp/embedded-signup/connect', {
          method: 'POST',
          body: JSON.stringify({
            salonId: this.summaryData.salon.id,
            phoneNumberId: phoneId,
            displayPhoneNumber: displayPhone,
          }),
        });

        msgDiv.style.color = 'var(--success)';
        setTimeout(async () => {
          await this.loadData();
          this.render();
        }, 1200);
      } catch (err) {
        msgDiv.style.color = 'var(--danger)';
        msgDiv.textContent = `❌ ${err.message}`;
        msgDiv.style.display = 'block';
        btn.textContent = 'Save Direct Phone ID →';
        btn.removeAttribute('disabled');
      }
    });

    document.getElementById('btn-meta-popup-connect')?.addEventListener('click', () => {
      if (typeof window.FB === 'undefined') {
        alert('Meta Facebook SDK is loading, please try again in 2 seconds.');
        return;
      }

      window.FB.init({
        appId: '4157743837690470',
        cookie: true,
        xfbml: true,
        version: 'v20.0',
      });

      // Listen for message from Meta Embedded Signup popup
      const messageListener = async (event) => {
        if (event.origin && (event.origin.includes('facebook.com') || event.origin.includes('meta.com'))) {
          try {
            const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
            if (data.type === 'WA_EMBEDDED_SIGNUP') {
              const { phone_number_id, waba_id } = data.data;
              await ApiClient.request('/whatsapp/embedded-signup/connect', {
                method: 'POST',
                body: JSON.stringify({
                  salonId: this.summaryData.salon.id,
                  phoneNumberId: phone_number_id,
                  wabaId: waba_id,
                }),
              });
              alert('🎉 Your Official WhatsApp Number is connected successfully!');
              await this.loadData();
              this.render();
            }
          } catch (e) {}
        }
      };

      window.removeEventListener('message', messageListener);
      window.addEventListener('message', messageListener);

      window.FB.login(
        (response) => {
          if (response.authResponse) {
            console.log('Meta OAuth code received:', response.authResponse.code);
          }
        },
        {
          scope: 'whatsapp_business_management,whatsapp_business_messaging',
          response_type: 'code',
          override_default_response_type: true,
          extras: {
            feature: 'whatsapp_embedded_signup',
            version: 2,
          },
        },
      );
    });
  }
}
