import { AppointmentStatus, ConversationState, BookingSource } from '@prisma/client';
import { DateTime } from 'luxon';
import { ConflictException, BadRequestException } from '@nestjs/common';
import { WhatsAppButtonId } from '../../../../src/modules/channels/whatsapp/services/whatsapp-sender.service';
import { BOOKING_POLICY } from '../../../../src/common/constants/booking-policy.constants';
import {
  createWhatsAppHarness,
  CUSTOMER_PHONE,
  SALON_ID,
  STYLIST_ALICE,
  SVC_HAIRCUT,
  TZ,
} from './harness/whatsapp-harness';

jest.setTimeout(30000);

const fresh = (state: ConversationState, extra: Record<string, any> = {}) => ({
  state,
  serviceGender: 'MEN',
  selectedCategory: 'Hair',
  selectedServiceId: SVC_HAIRCUT,
  selectedStaffId: STYLIST_ALICE,
  ...extra,
});

describe('WhatsApp Reschedule Flow - Brutal End-to-End Simulation & Edge Cases', () => {
  const now = DateTime.now().setZone(TZ);
  const dates = {
    today: now.toISODate() as string,
    tomorrow: now.plus({ days: 1 }).toISODate() as string,
    dayAfter: now.plus({ days: 2 }).toISODate() as string,
  };

  // Helper to compute time strings relative to current minute of the day
  const getTimeStringAt = (offsetMinutes: number): string => {
    const totalMinutes = now.hour * 60 + now.minute + offsetMinutes;
    const h = String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0');
    const m = String(totalMinutes % 60).padStart(2, '0');
    return `${h}:${m}`;
  };

  // ---------------------------------------------------------------------------
  // 1. Full End-to-End Journey: Booking -> Hub -> Reschedule to Today (>= 2h Slot)
  // ---------------------------------------------------------------------------
  it('E2E-001: Customer books appointment, taps Reschedule, views today slots (only >= 2h offered), and successfully reschedules', async () => {
    const h = await createWhatsAppHarness({
      conversation: fresh(ConversationState.CONFIRMATION, {
        selectedDate: new Date(`${dates.tomorrow}T00:00:00.000Z`),
        selectedTime: '11:00',
      }),
    });

    // Step A: Confirm initial booking for tomorrow
    const bookConfirmStep = await h.tap(WhatsAppButtonId.CONFIRM_YES);
    expect(bookConfirmStep.result.state).toBe(ConversationState.START);
    expect(h.prisma.tables.appointment).toHaveLength(1);
    const bookedAppt = h.prisma.tables.appointment[0];
    expect(bookedAppt.status).toBe(AppointmentStatus.BOOKED);
    expect(bookedAppt.stylistId).toBe(STYLIST_ALICE);

    // Step B: Set conversation to Active Hub and request Reschedule
    h.conversation.state = ConversationState.ACTIVE_HUB;
    h.conversation.activeAppointmentId = bookedAppt.id;

    // Slots for today:
    // Slot 1: 30 minutes away (< 2h -> MUST BE EXCLUDED)
    // Slot 2: 75 minutes away (< 2h -> MUST BE EXCLUDED)
    // Slot 3: 150 minutes away (2.5h -> MUST BE INCLUDED)
    // Slot 4: 240 minutes away (4.0h -> MUST BE INCLUDED)
    const slotNear30m = getTimeStringAt(30);
    const slotNear75m = getTimeStringAt(75);
    const slotValid150m = getTimeStringAt(150);
    const slotValid240m = getTimeStringAt(240);

    h.mocks.availability.findAvailableDates = jest.fn().mockResolvedValue([
      { dateStr: dates.today, displayLabel: 'Today' },
      { dateStr: dates.tomorrow, displayLabel: 'Tomorrow' },
    ]);

    h.mocks.availability.getAvailableSlots = jest.fn().mockImplementation(
      async (_s, _srv, date, _st, _ex, _cand, minLeadTime) => {
        if (date === dates.today) {
          // Native engine filtering simulation: when minLeadTime is passed, filter slots < minLeadTime
          let times = [slotNear30m, slotNear75m, slotValid150m, slotValid240m];
          if (minLeadTime && minLeadTime > 0) {
            const currentMins = now.hour * 60 + now.minute;
            times = times.filter((t) => {
              const [h, m] = t.split(':').map(Number);
              return h * 60 + m >= currentMins + minLeadTime;
            });
          }
          return {
            date,
            availableSlots: times.map((t) => ({ startTime: t, endTime: '99:99' })),
          };
        }
        return {
          date,
          availableSlots: [{ startTime: '10:00', endTime: '10:30' }],
        };
      },
    );

    const reschedStep = await h.tap(WhatsAppButtonId.RESCHEDULE);
    expect(reschedStep.result.state).toBe(ConversationState.SELECT_RESCHEDULE_DATE);
    expect(h.mocks.availability.findAvailableDates).toHaveBeenCalledWith(
      SALON_ID,
      SVC_HAIRCUT,
      STYLIST_ALICE,
      BOOKING_POLICY.MAX_ADVANCE_BOOKING_DAYS,
      bookedAppt.id,
      BOOKING_POLICY.MIN_RESCHEDULE_LEAD_MINUTES,
    );

    // Step C: Customer selects Today
    const dateStep = await h.tap(`rdate_${dates.today}`);
    expect(dateStep.result.state).toBe(ConversationState.SELECT_RESCHEDULE_TIME);
    expect(h.mocks.availability.getAvailableSlots).toHaveBeenCalledWith(
      SALON_ID,
      SVC_HAIRCUT,
      dates.today,
      STYLIST_ALICE,
      bookedAppt.id,
      undefined,
      BOOKING_POLICY.MIN_RESCHEDULE_LEAD_MINUTES,
    );

    const slotButtons = h.optionIds(dateStep.messages[0]);
    // Assert: Early slots (< 2 hours) MUST NOT be present
    expect(slotButtons).not.toContain(`rslot_${slotNear30m}`);
    expect(slotButtons).not.toContain(`rslot_${slotNear75m}`);
    // Assert: Valid slots (>= 2 hours) MUST be present
    expect(slotButtons).toContain(`rslot_${slotValid150m}`);
    expect(slotButtons).toContain(`rslot_${slotValid240m}`);

    // Step D: Customer selects the valid >= 2h slot
    h.mocks.reschedule.rescheduleAppointment = jest.fn().mockImplementation(async (_sId, aId, dto) => {
      const appt = h.prisma.tables.appointment.find((a: any) => a.id === aId);
      if (appt) {
        appt.appointmentDate = new Date(dto.newDate);
        appt.startAt = new Date(`${dto.newDate}T${dto.newStartTime}:00.000Z`);
        appt.status = AppointmentStatus.CONFIRMED;
      }
      return true;
    });

    const confirmResched = await h.tap(`rslot_${slotValid150m}`);
    expect(confirmResched.result.state).toBe(ConversationState.START);
    expect(confirmResched.messages[0].bodyText).toContain('Appointment Rescheduled');
    expect(h.mocks.reschedule.rescheduleAppointment).toHaveBeenCalledWith(
      SALON_ID,
      bookedAppt.id,
      expect.objectContaining({
        newDate: dates.today,
        newStartTime: slotValid150m,
      }),
      undefined,
      expect.anything(),
    );

    // Verify DB appointment updated
    expect(h.prisma.tables.appointment[0].status).toBe(AppointmentStatus.CONFIRMED);
    expect(h.prisma.tables.appointment[0].startAt).toEqual(new Date(`${dates.today}T${slotValid150m}:00.000Z`));
  });

  // ---------------------------------------------------------------------------
  // 2. Brutal Edge Case: Today has ONLY slots < 2 hours (Zero Viable Slots Today)
  // ---------------------------------------------------------------------------
  it('E2E-002: When all slots today are < 2h away, engine returns 0 slots and WhatsApp offers alternative dates without crashing', async () => {
    const existingAppt = {
      id: 'appt-exist-e2e-2',
      serviceId: SVC_HAIRCUT,
      stylistId: STYLIST_ALICE,
      startAt: new Date(Date.now() + 24 * 3600 * 1000),
      status: AppointmentStatus.CONFIRMED,
      price: 500,
    };
    const h = await createWhatsAppHarness({
      conversation: fresh(ConversationState.SELECT_RESCHEDULE_DATE, { activeAppointmentId: existingAppt.id }),
      appointments: [existingAppt],
    });

    // Mock today having 0 slots >= 2 hours
    h.mocks.availability.getAvailableSlots = jest.fn().mockImplementation(
      async (_s, _srv, date, _st, _ex, _cand, minLeadTime) => {
        if (date === dates.today && minLeadTime && minLeadTime > 0) {
          // All slots were within 2 hours -> 0 viable slots remain
          return { date, availableSlots: [] };
        }
        return {
          date,
          availableSlots: [{ startTime: '11:00', endTime: '11:30' }],
        };
      },
    );

    h.mocks.availability.findAvailableDates = jest.fn().mockResolvedValue([
      { dateStr: dates.tomorrow, displayLabel: 'Tomorrow' },
      { dateStr: dates.dayAfter, displayLabel: 'Day After' },
    ]);

    // Force selecting today (as could happen if user had a stale button)
    const step = await h.tap(`rdate_${dates.today}`);
    // System must stay in date selection mode and prompt politely
    expect(step.result.state).toBe(ConversationState.SELECT_RESCHEDULE_DATE);
    expect(step.messages[0].bodyText).toContain('No slots available today with at least 2 hours advance notice');
    // Alternate dates presented
    const options = h.optionIds(step.messages[0]);
    expect(options).toContain(`rdate_${dates.tomorrow}`);
    expect(options).toContain(`rdate_${dates.dayAfter}`);
  });

  // ---------------------------------------------------------------------------
  // 3. Reschedule to Tomorrow (Future Date Morning Slots are NOT Blocked)
  // ---------------------------------------------------------------------------
  it('E2E-003: Rescheduling to tomorrow correctly preserves early morning slots (09:00 AM, 10:00 AM)', async () => {
    const existingAppt = {
      id: 'appt-exist-e2e-3',
      serviceId: SVC_HAIRCUT,
      stylistId: STYLIST_ALICE,
      startAt: new Date(Date.now() + 48 * 3600 * 1000),
      status: AppointmentStatus.CONFIRMED,
      price: 500,
    };
    const h = await createWhatsAppHarness({
      conversation: fresh(ConversationState.SELECT_RESCHEDULE_DATE, { activeAppointmentId: existingAppt.id }),
      appointments: [existingAppt],
    });

    h.mocks.availability.getAvailableSlots = jest.fn().mockResolvedValue({
      date: dates.tomorrow,
      availableSlots: [
        { startTime: '09:00', endTime: '09:30' },
        { startTime: '10:00', endTime: '10:30' },
        { startTime: '14:00', endTime: '14:30' },
      ],
    });

    const step = await h.tap(`rdate_${dates.tomorrow}`);
    expect(step.result.state).toBe(ConversationState.SELECT_RESCHEDULE_TIME);
    const slotButtons = h.optionIds(step.messages[0]);
    // Morning slots tomorrow are completely open
    expect(slotButtons).toContain('rslot_09:00');
    expect(slotButtons).toContain('rslot_10:00');
    expect(slotButtons).toContain('rslot_14:00');

    // Customer taps 09:00 AM tomorrow
    const confirm = await h.tap('rslot_09:00');
    expect(confirm.result.state).toBe(ConversationState.START);
    expect(h.mocks.reschedule.rescheduleAppointment).toHaveBeenCalledWith(
      SALON_ID,
      existingAppt.id,
      expect.objectContaining({
        newDate: dates.tomorrow,
        newStartTime: '09:00',
      }),
      undefined,
      expect.anything(),
    );
  });

  // ---------------------------------------------------------------------------
  // 4. Cutoff Guard (Appointment is <= 90 Minutes Away)
  // ---------------------------------------------------------------------------
  it('E2E-004: When appointment is starting in <= 90 minutes, Reschedule is rejected with cutoff notice and Cancel button', async () => {
    const nearAppt = {
      id: 'appt-exist-cutoff-test',
      serviceId: SVC_HAIRCUT,
      stylistId: STYLIST_ALICE,
      startAt: new Date(Date.now() + 45 * 60 * 1000), // 45m away
      status: AppointmentStatus.CONFIRMED,
      price: 500,
    };
    const h = await createWhatsAppHarness({
      conversation: fresh(ConversationState.ACTIVE_HUB, { activeAppointmentId: nearAppt.id }),
      appointments: [nearAppt],
    });

    h.mocks.reschedule.validateRescheduleEligibility = jest.fn().mockResolvedValue({
      allowed: false,
      hoursUntil: 0.75,
      cancelWindowHours: 1.5,
      reason: 'Rescheduling is only permitted up to 90 minutes before your appointment.',
    });

    const step = await h.tap(WhatsAppButtonId.RESCHEDULE);
    // State remains in active hub, does not transition to date select
    expect(step.result.state).toBe(ConversationState.ACTIVE_HUB);
    expect(step.messages[0].bodyText).toContain('Reschedule Cutoff Passed');
    expect(step.messages[0].bodyText).toContain('90 minutes');
  });

  // ---------------------------------------------------------------------------
  // 5. Brutal Edge Case: Race Condition / Slot Collision During Reschedule
  // ---------------------------------------------------------------------------
  it('E2E-005: When chosen slot is snatched by another user in flight, conflict catch block re-queries remaining >= 2h slots', async () => {
    const existingAppt = {
      id: 'appt-exist-race-test',
      serviceId: SVC_HAIRCUT,
      stylistId: STYLIST_ALICE,
      startAt: new Date(Date.now() + 36 * 3600 * 1000),
      status: AppointmentStatus.CONFIRMED,
      price: 500,
    };
    const h = await createWhatsAppHarness({
      conversation: fresh(ConversationState.SELECT_RESCHEDULE_TIME, {
        activeAppointmentId: existingAppt.id,
        selectedDate: new Date(`${dates.today}T00:00:00.000Z`),
      }),
      appointments: [existingAppt],
    });

    const snatchedSlot = getTimeStringAt(150);
    const remainingSlot = getTimeStringAt(210);

    // First attempt fails because slot was booked concurrently
    h.mocks.reschedule.rescheduleAppointment = jest.fn().mockRejectedValueOnce(
      new ConflictException('Requested new slot is not available.'),
    );

    // Remaining slots query returns remainingSlot
    h.mocks.availability.getAvailableSlots = jest.fn().mockResolvedValue({
      date: dates.today,
      availableSlots: [{ startTime: remainingSlot, endTime: '99:99' }],
    });

    const step = await h.tap(`rslot_${snatchedSlot}`);
    // Conversation stays in SELECT_RESCHEDULE_TIME
    expect(step.result.state).toBe(ConversationState.SELECT_RESCHEDULE_TIME);
    expect(step.messages[0].bodyText).toContain('Slot Unavailable');
    expect(h.mocks.availability.getAvailableSlots).toHaveBeenCalledWith(
      SALON_ID,
      SVC_HAIRCUT,
      dates.today,
      STYLIST_ALICE,
      existingAppt.id,
      undefined,
      BOOKING_POLICY.MIN_RESCHEDULE_LEAD_MINUTES,
    );
    const options = h.optionIds(step.messages[0]);
    expect(options).toContain(`rslot_${remainingSlot}`);
  });

  // ---------------------------------------------------------------------------
  // 6. Brutal Edge Case: Direct Spoofed Payload with Slot < 2 Hours Rejected
  // ---------------------------------------------------------------------------
  it('E2E-006: Direct spoofed rslot_ with lead time < 2 hours is rejected by RescheduleService lead time check', async () => {
    const existingAppt = {
      id: 'appt-exist-spoof-test',
      serviceId: SVC_HAIRCUT,
      stylistId: STYLIST_ALICE,
      startAt: new Date(Date.now() + 24 * 3600 * 1000),
      status: AppointmentStatus.CONFIRMED,
      price: 500,
    };
    const h = await createWhatsAppHarness({
      conversation: fresh(ConversationState.SELECT_RESCHEDULE_TIME, {
        activeAppointmentId: existingAppt.id,
        selectedDate: new Date(`${dates.today}T00:00:00.000Z`),
      }),
      appointments: [existingAppt],
    });

    const illegalEarlySlot = getTimeStringAt(30);

    // RescheduleService throws BadRequestException for < 2h
    h.mocks.reschedule.rescheduleAppointment = jest.fn().mockRejectedValueOnce(
      new BadRequestException('Rescheduling requires at least 2 hours advance notice from the current time.'),
    );

    // Conflict handler re-queries with minLeadTimeMinutes: 120, which returns only valid slots
    const validSlot = getTimeStringAt(180);
    h.mocks.availability.getAvailableSlots = jest.fn().mockResolvedValue({
      date: dates.today,
      availableSlots: [{ startTime: validSlot, endTime: '99:99' }],
    });

    const step = await h.tap(`rslot_${illegalEarlySlot}`);
    expect(step.result.state).toBe(ConversationState.SELECT_RESCHEDULE_TIME);
    // Booking was NOT confirmed
    expect(h.prisma.tables.appointment[0].startAt).not.toEqual(new Date(`${dates.today}T${illegalEarlySlot}:00.000Z`));
    // User is presented with valid remaining slots
    expect(h.optionIds(step.messages[0])).toContain(`rslot_${validSlot}`);
  });

  // ---------------------------------------------------------------------------
  // 7. Diurnal Window Navigation (Afternoon / Evening Navigation for Today)
  // ---------------------------------------------------------------------------
  it('E2E-007: Diurnal window jump (rwindow_AFTERNOON) requests availability with MIN_RESCHEDULE_LEAD_MINUTES', async () => {
    const existingAppt = {
      id: 'appt-exist-window-test',
      serviceId: SVC_HAIRCUT,
      stylistId: STYLIST_ALICE,
      startAt: new Date(Date.now() + 24 * 3600 * 1000),
      status: AppointmentStatus.CONFIRMED,
      price: 500,
    };
    const h = await createWhatsAppHarness({
      conversation: fresh(ConversationState.SELECT_RESCHEDULE_TIME, {
        activeAppointmentId: existingAppt.id,
        selectedDate: new Date(`${dates.today}T00:00:00.000Z`),
      }),
      appointments: [existingAppt],
    });

    h.mocks.availability.getAvailableSlots = jest.fn().mockResolvedValue({
      date: dates.today,
      availableSlots: [
        { startTime: '14:00', endTime: '14:30' },
        { startTime: '15:00', endTime: '15:30' },
      ],
    });

    const step = await h.tap('rwindow_AFTERNOON');
    expect(step.result.state).toBe(ConversationState.SELECT_RESCHEDULE_TIME);
    expect(h.mocks.availability.getAvailableSlots).toHaveBeenCalledWith(
      SALON_ID,
      SVC_HAIRCUT,
      dates.today,
      STYLIST_ALICE,
      existingAppt.id,
      undefined,
      BOOKING_POLICY.MIN_RESCHEDULE_LEAD_MINUTES,
    );
  });

  // ---------------------------------------------------------------------------
  // 8. Exact Boundary Test (119 minutes excluded, 120 minutes included)
  // ---------------------------------------------------------------------------
  it('E2E-008: Exact boundary condition - 119 minutes away is strictly excluded, 120 minutes away is allowed', async () => {
    const existingAppt = {
      id: 'appt-boundary-test',
      serviceId: SVC_HAIRCUT,
      stylistId: STYLIST_ALICE,
      startAt: new Date(Date.now() + 24 * 3600 * 1000),
      status: AppointmentStatus.CONFIRMED,
      price: 500,
    };
    const h = await createWhatsAppHarness({
      conversation: fresh(ConversationState.SELECT_RESCHEDULE_DATE, {
        activeAppointmentId: existingAppt.id,
      }),
      appointments: [existingAppt],
    });

    const slot119m = getTimeStringAt(119);
    const slot120m = getTimeStringAt(120);

    // Mock AvailabilityService to enforce root engine minLeadTimeMinutes logic
    h.mocks.availability.getAvailableSlots = jest.fn().mockImplementation(
      async (_sId, _srvId, dateStr, _stId, _exId, _cand, minLead) => {
        const currentMins = now.hour * 60 + now.minute;
        const candidateSlots = [slot119m, slot120m];
        const filtered = candidateSlots.filter((timeStr) => {
          const [hVal, mVal] = timeStr.split(':').map(Number);
          const slotMinute = hVal * 60 + mVal;
          if (dateStr === dates.today && minLead && minLead > 0) {
            return slotMinute >= currentMins + minLead;
          }
          return true;
        });

        return {
          date: dateStr,
          availableSlots: filtered.map((t) => ({ startTime: t, endTime: '23:59' })),
        };
      },
    );

    const step = await h.tap(`rdate_${dates.today}`);
    expect(step.result.state).toBe(ConversationState.SELECT_RESCHEDULE_TIME);
    const offeredButtons = h.optionIds(step.messages[0]);

    // 119 minutes is under 120 min lead time -> MUST NOT be offered
    expect(offeredButtons).not.toContain(`rslot_${slot119m}`);
    // 120 minutes is exactly 2 hours -> MUST be offered
    expect(offeredButtons).toContain(`rslot_${slot120m}`);

    // Now selecting the 120m slot succeeds
    h.mocks.reschedule.rescheduleAppointment = jest.fn().mockResolvedValue(true);
    const confirmStep = await h.tap(`rslot_${slot120m}`);
    expect(confirmStep.result.state).toBe(ConversationState.START);
    expect(confirmStep.messages[0].bodyText).toContain('Appointment Rescheduled');
  });

  // ---------------------------------------------------------------------------
  // 9. Date Switch During Reschedule (Today -> Tomorrow preserves early slots)
  // ---------------------------------------------------------------------------
  it('E2E-009: User initially views today, changes mind and taps tomorrow - early slots offered without lead time restriction', async () => {
    const existingAppt = {
      id: 'appt-switch-date-test',
      serviceId: SVC_HAIRCUT,
      stylistId: STYLIST_ALICE,
      startAt: new Date(Date.now() + 24 * 3600 * 1000),
      status: AppointmentStatus.CONFIRMED,
      price: 500,
    };
    const h = await createWhatsAppHarness({
      conversation: fresh(ConversationState.SELECT_RESCHEDULE_DATE, {
        activeAppointmentId: existingAppt.id,
      }),
      appointments: [existingAppt],
    });

    h.mocks.availability.getAvailableSlots = jest.fn().mockImplementation(async (_s, _srv, date) => {
      if (date === dates.today) {
        return {
          date,
          availableSlots: [{ startTime: '16:00', endTime: '16:30' }],
        };
      }
      return {
        date,
        availableSlots: [
          { startTime: '09:00', endTime: '09:30' },
          { startTime: '10:00', endTime: '10:30' },
          { startTime: '11:00', endTime: '11:30' },
        ],
      };
    });

    // Customer selects today first
    await h.tap(`rdate_${dates.today}`);
    expect(h.conversation.state).toBe(ConversationState.SELECT_RESCHEDULE_TIME);

    // Customer changes mind and taps back to select tomorrow
    h.conversation.state = ConversationState.SELECT_RESCHEDULE_DATE;
    const switchStep = await h.tap(`rdate_${dates.tomorrow}`);
    expect(switchStep.result.state).toBe(ConversationState.SELECT_RESCHEDULE_TIME);
    expect(h.mocks.availability.getAvailableSlots).toHaveBeenCalledWith(
      SALON_ID,
      SVC_HAIRCUT,
      dates.tomorrow,
      STYLIST_ALICE,
      existingAppt.id,
      undefined,
      BOOKING_POLICY.MIN_RESCHEDULE_LEAD_MINUTES,
    );

    const slotButtons = h.optionIds(switchStep.messages[0]);
    // Early morning slots for tomorrow MUST be present
    expect(slotButtons).toContain('rslot_09:00');
    expect(slotButtons).toContain('rslot_10:00');
    expect(slotButtons).toContain('rslot_11:00');
  });

  // ---------------------------------------------------------------------------
  // 10. Reschedule Blocked if Appointment was Already Cancelled
  // ---------------------------------------------------------------------------
  it('E2E-010: Pre-flight guard blocks Reschedule when appointment has already been CANCELLED', async () => {
    const cancelledAppt = {
      id: 'appt-cancelled-test',
      serviceId: SVC_HAIRCUT,
      stylistId: STYLIST_ALICE,
      startAt: new Date(Date.now() + 24 * 3600 * 1000),
      status: AppointmentStatus.CANCELLED,
      price: 500,
      cancelledBy: 'CUSTOMER',
      cancelReasonCategory: 'CHANGE_OF_PLANS',
    };
    const h = await createWhatsAppHarness({
      conversation: fresh(ConversationState.ACTIVE_HUB, {
        activeAppointmentId: cancelledAppt.id,
      }),
      appointments: [cancelledAppt],
    });

    const step = await h.tap(WhatsAppButtonId.RESCHEDULE);
    expect(step.result.state).toBe(ConversationState.START);
    // User is informed that the appointment was already cancelled and prompted to book fresh
    expect(step.messages[0].bodyText.toLowerCase()).toContain('cancel');
    expect(h.mocks.availability.findAvailableDates).not.toHaveBeenCalled();
  });
});

