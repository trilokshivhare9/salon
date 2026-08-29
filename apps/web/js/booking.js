import { ApiClient } from './api.js';

export class BookingWizard {
  constructor(containerId, salonSlug) {
    this.container = document.getElementById(containerId);
    this.slug = salonSlug;
    this.currentStep = 1;
    
    this.state = {
      salon: null,
      selectedService: null,
      selectedStaff: null,
      selectedDate: null,
      selectedTime: null,
      customerName: '',
      customerPhone: '',
      customerEmail: '',
      notes: '',
      availableSlots: [],
      confirmedAppointment: null,
    };
  }

  async init() {
    this.renderLoading();
    try {
      this.state.salon = await ApiClient.getPublicSalon(this.slug);
      this.render();
    } catch (err) {
      this.container.innerHTML = `
        <div class="glass-panel text-center" style="text-align: center; padding: 40px;">
          <h2 style="color: var(--danger); margin-bottom: 12px;">Salon Not Found</h2>
          <p style="color: var(--text-secondary);">The requested salon booking link is invalid or inactive.</p>
        </div>
      `;
    }
  }

  renderLoading() {
    this.container.innerHTML = `
      <div style="text-align: center; padding: 60px;">
        <div style="font-size: 1.5rem; font-family: var(--font-heading); color: #818cf8;">Loading Salon Booking Portal...</div>
      </div>
    `;
  }

  render() {
    const { salon } = this.state;

    this.container.innerHTML = `
      <div class="booking-wizard-container">
        <div class="salon-hero">
          <h1 class="gradient-text">${salon.name}</h1>
          <p>${salon.description || 'Welcome to our online appointment booking portal.'}</p>
          <div style="font-size: 0.85rem; color: var(--text-muted); margin-top: 6px;">
            📍 ${salon.address || salon.city || 'India'} &nbsp;•&nbsp; 📞 ${salon.phone}
          </div>
        </div>

        <!-- Wizard Step Indicators -->
        <div class="wizard-steps">
          <div class="step-indicator ${this.currentStep === 1 ? 'active' : ''} ${this.currentStep > 1 ? 'completed' : ''}">1</div>
          <div class="step-indicator ${this.currentStep === 2 ? 'active' : ''} ${this.currentStep > 2 ? 'completed' : ''}">2</div>
          <div class="step-indicator ${this.currentStep === 3 ? 'active' : ''} ${this.currentStep > 3 ? 'completed' : ''}">3</div>
          <div class="step-indicator ${this.currentStep === 4 ? 'active' : ''} ${this.currentStep > 4 ? 'completed' : ''}">4</div>
        </div>

        <div class="glass-panel" id="wizard-step-content">
          ${this.getStepHtml()}
        </div>
      </div>
    `;

    this.attachEventListeners();
  }

  getStepHtml() {
    switch (this.currentStep) {
      case 1:
        return this.renderStep1Services();
      case 2:
        return this.renderStep2Staff();
      case 3:
        return this.renderStep3DateTime();
      case 4:
        return this.renderStep4Details();
      case 5:
        return this.renderStep5Confirmation();
      default:
        return '';
    }
  }

  renderStep1Services() {
    const services = this.state.salon.services || [];
    return `
      <h3 style="margin-bottom: 6px;">1. Choose a Service</h3>
      <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 20px;">Select the beauty or hair treatment you would like to book.</p>

      <div class="services-list">
        ${services.map(s => `
          <div class="service-card ${this.state.selectedService?.id === s.id ? 'selected' : ''}" data-service-id="${s.id}">
            <div>
              <div style="font-weight: 700; font-size: 1.05rem;">${s.name}</div>
              <div style="color: var(--text-muted); font-size: 0.85rem; margin-top: 4px;">${s.description || ''}</div>
              <div style="display: flex; gap: 12px; margin-top: 8px; font-size: 0.85rem;">
                <span style="color: #818cf8;">⏱️ ${s.durationMinutes} mins</span>
                <span class="badge" style="background: rgba(255,255,255,0.05); color: #cbd5e1;">${s.category || 'General'}</span>
              </div>
            </div>
            <div style="text-align: right;">
              <div style="font-family: var(--font-heading); font-size: 1.25rem; font-weight: 700; color: #10b981;">₹${s.price}</div>
            </div>
          </div>
        `).join('')}
      </div>

      <div style="margin-top: 24px; display: flex; justify-content: flex-end;">
        <button class="btn btn-primary" id="btn-next-to-staff" ${!this.state.selectedService ? 'disabled' : ''}>
          Continue to Staff Selection →
        </button>
      </div>
    `;
  }

  renderStep2Staff() {
    const allStaff = this.state.salon.staff || [];
    // Filter staff qualified for this service
    const qualifiedStaff = allStaff.filter(st => 
      st.services && st.services.some(svc => svc.serviceId === this.state.selectedService.id)
    );

    return `
      <h3 style="margin-bottom: 6px;">2. Select Specialist</h3>
      <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 20px;">Choose a preferred stylist or pick any available specialist.</p>

      <div class="staff-list">
        <!-- Any Available Option -->
        <div class="staff-card ${this.state.selectedStaff === null ? 'selected' : ''}" data-staff-id="ANY">
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="width: 44px; height: 44px; border-radius: 50%; background: linear-gradient(135deg, var(--primary), var(--accent)); display: flex; align-items: center; justify-content: center; font-size: 1.2rem;">
              ✨
            </div>
            <div>
              <div style="font-weight: 700; font-size: 1rem;">Any Available Specialist</div>
              <div style="color: var(--text-secondary); font-size: 0.8rem;">Fastest available appointment booking</div>
            </div>
          </div>
        </div>

        ${qualifiedStaff.map(st => `
          <div class="staff-card ${this.state.selectedStaff?.id === st.id ? 'selected' : ''}" data-staff-id="${st.id}">
            <div style="display: flex; align-items: center; gap: 12px;">
              <img src="${st.profileImageUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150'}" class="avatar-sm" style="width: 44px; height: 44px;" />
              <div>
                <div style="font-weight: 700; font-size: 1rem;">${st.name}</div>
                <div style="color: var(--text-muted); font-size: 0.8rem;">Qualified Stylist</div>
              </div>
            </div>
          </div>
        `).join('')}
      </div>

      <div style="margin-top: 24px; display: flex; justify-content: space-between;">
        <button class="btn btn-secondary" id="btn-back-to-services">← Back</button>
        <button class="btn btn-primary" id="btn-next-to-date">Continue to Date & Time →</button>
      </div>
    `;
  }

  renderStep3DateTime() {
    // Generate next 10 dates
    const dates = [];
    const today = new Date();
    for (let i = 0; i < 10; i++) {
      const d = new Date();
      d.setDate(today.getDate() + i);
      const isoStr = d.toISOString().split('T')[0];
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
      const dayNum = d.getDate();
      const monthName = d.toLocaleDateString('en-US', { month: 'short' });
      dates.push({ iso: isoStr, dayName, dayNum, monthName });
    }

    if (!this.state.selectedDate) {
      this.state.selectedDate = dates[0].iso;
    }

    return `
      <h3 style="margin-bottom: 6px;">3. Select Date & Time</h3>
      <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 20px;">Pick your preferred appointment slot.</p>

      <!-- Date Pills -->
      <div class="date-pill-container">
        ${dates.map(d => `
          <div class="date-pill ${this.state.selectedDate === d.iso ? 'selected' : ''}" data-date="${d.iso}">
            <div class="day-name">${d.dayName}</div>
            <div class="day-number">${d.dayNum}</div>
            <div style="font-size: 0.7rem; color: var(--text-muted);">${d.monthName}</div>
          </div>
        `).join('')}
      </div>

      <!-- Slots Grid -->
      <div id="slots-container">
        <div style="text-align: center; padding: 20px; color: var(--text-muted);">
          Calculating real-time available slots...
        </div>
      </div>

      <div style="margin-top: 24px; display: flex; justify-content: space-between;">
        <button class="btn btn-secondary" id="btn-back-to-staff">← Back</button>
        <button class="btn btn-primary" id="btn-next-to-details" ${!this.state.selectedTime ? 'disabled' : ''}>
          Enter Details →
        </button>
      </div>
    `;
  }

  renderStep4Details() {
    const { selectedService, selectedStaff, selectedDate, selectedTime } = this.state;

    return `
      <h3 style="margin-bottom: 6px;">4. Customer Information</h3>
      <p style="color: var(--text-secondary); font-size: 0.9rem; margin-bottom: 20px;">Enter your contact information for instant booking confirmation.</p>

      <div style="background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.2); border-radius: var(--radius-md); padding: 16px; margin-bottom: 20px;">
        <div style="font-size: 0.85rem; color: var(--text-secondary); text-transform: uppercase; font-weight: 700; margin-bottom: 8px;">Booking Summary</div>
        <div style="font-size: 1.1rem; font-weight: 700; color: #fff;">${selectedService.name} (₹${selectedService.price})</div>
        <div style="font-size: 0.9rem; color: var(--text-secondary); margin-top: 4px;">
          📅 ${selectedDate} at ${selectedTime} &nbsp;•&nbsp; 👤 ${selectedStaff ? selectedStaff.name : 'Any Available Specialist'}
        </div>
      </div>

      <div class="form-group">
        <label>Your Full Name *</label>
        <input type="text" class="form-control" id="cust-name" placeholder="e.g. Aarav Sharma" value="${this.state.customerName}" required />
      </div>

      <div class="form-group">
        <label>Phone Number (WhatsApp) *</label>
        <input type="tel" class="form-control" id="cust-phone" placeholder="e.g. +91 98765 43210" value="${this.state.customerPhone}" required />
      </div>

      <div class="form-group">
        <label>Email Address (Optional)</label>
        <input type="email" class="form-control" id="cust-email" placeholder="e.g. aarav@example.com" value="${this.state.customerEmail}" />
      </div>

      <div class="form-group">
        <label>Notes / Special Requests (Optional)</label>
        <textarea class="form-control" id="cust-notes" rows="2" placeholder="Any specific requirements...">${this.state.notes}</textarea>
      </div>

      <div id="booking-error-msg" style="color: var(--danger); font-size: 0.9rem; margin-bottom: 12px; display: none;"></div>

      <div style="margin-top: 24px; display: flex; justify-content: space-between;">
        <button class="btn btn-secondary" id="btn-back-to-datetime">← Back</button>
        <button class="btn btn-primary" id="btn-confirm-booking">
          Confirm Appointment 🎉
        </button>
      </div>
    `;
  }

  renderStep5Confirmation() {
    const appt = this.state.confirmedAppointment;
    return `
      <div style="text-align: center; padding: 20px 0;">
        <div style="width: 64px; height: 64px; border-radius: 50%; background: var(--success-bg); color: var(--success); border: 2px solid var(--success); display: flex; align-items: center; justify-content: center; font-size: 2rem; margin: 0 auto 16px;">
          ✓
        </div>
        <h2 style="color: #fff; margin-bottom: 4px;">Appointment Confirmed!</h2>
        <p style="color: var(--text-secondary); margin-bottom: 24px;">Your booking receipt has been generated.</p>

        <div style="background: rgba(18, 25, 39, 0.9); border: 1px solid var(--border-color); border-radius: var(--radius-lg); padding: 24px; text-align: left; max-width: 440px; margin: 0 auto 24px;">
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; margin-bottom: 12px;">
            <span style="font-size: 0.85rem; color: var(--text-muted);">Appointment ID</span>
            <span class="badge badge-confirmed">${appt.appointmentNumber}</span>
          </div>

          <div style="margin-bottom: 12px;">
            <div style="font-size: 0.85rem; color: var(--text-muted);">Service</div>
            <div style="font-size: 1.05rem; font-weight: 700; color: #fff;">${appt.serviceName}</div>
          </div>

          <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px;">
            <div>
              <div style="font-size: 0.85rem; color: var(--text-muted);">Date & Time</div>
              <div style="font-weight: 600; color: #818cf8;">${appt.date.split('T')[0]} at ${new Date(appt.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
            <div>
              <div style="font-size: 0.85rem; color: var(--text-muted);">Specialist</div>
              <div style="font-weight: 600; color: #fff;">${appt.staffName}</div>
            </div>
          </div>

          <div>
            <div style="font-size: 0.85rem; color: var(--text-muted);">Location</div>
            <div style="font-size: 0.9rem; color: var(--text-secondary);">${appt.salon.name}, ${appt.salon.address || ''}</div>
          </div>
        </div>

        <button class="btn btn-secondary" id="btn-book-another">Book Another Appointment</button>
      </div>
    `;
  }

  async loadSlotsForSelectedDate() {
    const slotsContainer = document.getElementById('slots-container');
    if (!slotsContainer) return;

    slotsContainer.innerHTML = `
      <div style="text-align: center; padding: 20px; color: var(--text-muted);">
        Calculating real-time slots for ${this.state.selectedDate}...
      </div>
    `;

    try {
      const data = await ApiClient.getPublicAvailability(
        this.slug,
        this.state.selectedService.id,
        this.state.selectedDate,
        this.state.selectedStaff?.id || null
      );

      this.state.availableSlots = data.availableSlots || [];

      if (this.state.availableSlots.length === 0) {
        slotsContainer.innerHTML = `
          <div style="text-align: center; padding: 30px; background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239,68,68,0.2); border-radius: var(--radius-md);">
            <div style="color: #f87171; font-weight: 600; margin-bottom: 4px;">No Available Slots on this Date</div>
            <div style="color: var(--text-muted); font-size: 0.85rem;">Please choose another date or specialist.</div>
          </div>
        `;
        return;
      }

      slotsContainer.innerHTML = `
        <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 8px;">Available Times (${this.state.availableSlots.length} slots)</div>
        <div class="slots-grid">
          ${this.state.availableSlots.map(s => `
            <button class="slot-btn ${this.state.selectedTime === s.startTime ? 'selected' : ''}" data-time="${s.startTime}">
              ${s.startTime}
            </button>
          `).join('')}
        </div>
      `;

      // Attach slot click events
      slotsContainer.querySelectorAll('.slot-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          this.state.selectedTime = e.currentTarget.dataset.time;
          slotsContainer.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
          e.currentTarget.classList.add('selected');
          document.getElementById('btn-next-to-details').removeAttribute('disabled');
        });
      });
    } catch (err) {
      slotsContainer.innerHTML = `<div style="color: var(--danger); text-align: center; padding: 20px;">${err.message}</div>`;
    }
  }

  attachEventListeners() {
    // Step 1: Service Selection
    const serviceCards = this.container.querySelectorAll('.service-card');
    serviceCards.forEach(card => {
      card.addEventListener('click', (e) => {
        const serviceId = e.currentTarget.dataset.serviceId;
        this.state.selectedService = this.state.salon.services.find(s => s.id === serviceId);
        serviceCards.forEach(c => c.classList.remove('selected'));
        e.currentTarget.classList.add('selected');
        document.getElementById('btn-next-to-staff')?.removeAttribute('disabled');
      });
    });

    document.getElementById('btn-next-to-staff')?.addEventListener('click', () => {
      this.currentStep = 2;
      this.render();
    });

    // Step 2: Staff Selection
    const staffCards = this.container.querySelectorAll('.staff-card');
    staffCards.forEach(card => {
      card.addEventListener('click', (e) => {
        const staffId = e.currentTarget.dataset.staffId;
        if (staffId === 'ANY') {
          this.state.selectedStaff = null;
        } else {
          this.state.selectedStaff = this.state.salon.staff.find(st => st.id === staffId);
        }
        staffCards.forEach(c => c.classList.remove('selected'));
        e.currentTarget.classList.add('selected');
      });
    });

    document.getElementById('btn-back-to-services')?.addEventListener('click', () => {
      this.currentStep = 1;
      this.render();
    });

    document.getElementById('btn-next-to-date')?.addEventListener('click', () => {
      this.currentStep = 3;
      this.render();
      this.loadSlotsForSelectedDate();
    });

    // Step 3: Date Pills & Slots
    const datePills = this.container.querySelectorAll('.date-pill');
    datePills.forEach(pill => {
      pill.addEventListener('click', (e) => {
        this.state.selectedDate = e.currentTarget.dataset.date;
        this.state.selectedTime = null;
        datePills.forEach(p => p.classList.remove('selected'));
        e.currentTarget.classList.add('selected');
        document.getElementById('btn-next-to-details')?.setAttribute('disabled', 'true');
        this.loadSlotsForSelectedDate();
      });
    });

    document.getElementById('btn-back-to-staff')?.addEventListener('click', () => {
      this.currentStep = 2;
      this.render();
    });

    document.getElementById('btn-next-to-details')?.addEventListener('click', () => {
      this.currentStep = 4;
      this.render();
    });

    // Step 4: Details & Confirm
    document.getElementById('btn-back-to-datetime')?.addEventListener('click', () => {
      this.currentStep = 3;
      this.render();
      this.loadSlotsForSelectedDate();
    });

    document.getElementById('btn-confirm-booking')?.addEventListener('click', async () => {
      const nameInput = document.getElementById('cust-name');
      const phoneInput = document.getElementById('cust-phone');
      const emailInput = document.getElementById('cust-email');
      const notesInput = document.getElementById('cust-notes');
      const errorMsg = document.getElementById('booking-error-msg');

      if (!nameInput.value.trim() || !phoneInput.value.trim()) {
        errorMsg.textContent = 'Please enter your name and phone number.';
        errorMsg.style.display = 'block';
        return;
      }

      const btn = document.getElementById('btn-confirm-booking');
      btn.textContent = 'Booking Slot...';
      btn.setAttribute('disabled', 'true');
      errorMsg.style.display = 'none';

      try {
        const appointment = await ApiClient.createPublicAppointment(this.slug, {
          serviceId: this.state.selectedService.id,
          staffId: this.state.selectedStaff?.id || undefined,
          date: this.state.selectedDate,
          startTime: this.state.selectedTime,
          customerName: nameInput.value.trim(),
          customerPhone: phoneInput.value.trim(),
          customerEmail: emailInput.value.trim() || undefined,
          notes: notesInput.value.trim() || undefined,
        });

        this.state.confirmedAppointment = appointment;
        this.currentStep = 5;
        this.render();
      } catch (err) {
        errorMsg.textContent = err.message;
        errorMsg.style.display = 'block';
        btn.textContent = 'Confirm Appointment 🎉';
        btn.removeAttribute('disabled');
      }
    });

    // Step 5: Book Another
    document.getElementById('btn-book-another')?.addEventListener('click', () => {
      this.currentStep = 1;
      this.state.selectedService = null;
      this.state.selectedStaff = null;
      this.state.selectedTime = null;
      this.state.confirmedAppointment = null;
      this.render();
    });
  }
}
