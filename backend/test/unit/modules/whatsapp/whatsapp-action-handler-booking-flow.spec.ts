/**
 * WhatsApp Action Handler - Real Availability & Booking Journey
 *
 * Ported onto the shared stateful harness (./harness/whatsapp-harness.ts) so that:
 *  - every outbound message is observed at the lowest send point (no missed sends),
 *  - conversation writes are persisted and re-read like the real database,
 *  - no test touches a real database.
 *
 * Each test keeps its ORIGINAL intent. Where production intentionally changed a
 * contract since the test was written, the adaptation is documented inline with
 * a "CONTRACT:" note. No expectation was weakened to hide a bug.
 */
import { AppointmentStatus, ConversationState } from '@prisma/client';
import { DateTime } from 'luxon';
import { WhatsAppButtonId } from '../../../../src/modules/channels/whatsapp/services/whatsapp-sender.service';
import { BookingSource } from '@prisma/client';
import {
  createWhatsAppHarness,
  buildSalonFixture,
  CAT_HAIR,
  CUSTOMER_PHONE,
  SALON_ID,
  STYLIST_ALICE,
  SVC_HAIRCUT,
  TZ,
} from './harness/whatsapp-harness';

jest.setTimeout(30000);

const fresh = (state: ConversationState, extra: Record<string, any> = {}) => ({
  state,
  updatedAt: new Date(),
  ...extra,
});
const dbDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const slotInstant = (iso: string, hhmm: string) => DateTime.fromISO(`${iso}T${hhmm}`, { zone: TZ }).toJSDate();

describe('WhatsApp Action Handler - Real Availability & Booking Journey', () => {
  // ---------------------------------------------------------------------------
  // 1. Gender Selection & Category Filtering
  // ---------------------------------------------------------------------------
  it('TC-FLOW-001: Gender selection filters service categories accordingly', async () => {
    const h = await createWhatsAppHarness({ conversation: fresh(ConversationState.SELECT_CATEGORY) });

    const { result, messages } = await h.tap('gender_select_MALE');

    expect(result.state).toBe(ConversationState.SELECT_CATEGORY);
    expect(messages).toHaveLength(1);
    expect(messages[0].interactiveType).toBe('list');
    expect(h.optionIds(messages[0])).toContain(`cat_${CAT_HAIR}`);
  });

  // ---------------------------------------------------------------------------
  // 2. Service Selection & Qualified Specialist Filtering
  // ---------------------------------------------------------------------------
  it('TC-FLOW-002: Service selection only shows stylists qualified for that specific service', async () => {
    const h = await createWhatsAppHarness({
      conversation: fresh(ConversationState.SELECT_SERVICE, { selectedCategoryId: CAT_HAIR }),
    });

    // Only Alice is qualified for the haircut; Bob is not.
    const { result, messages } = await h.tap(`svc_${SVC_HAIRCUT}`);

    expect(result.state).toBe(ConversationState.SELECT_STAFF);
    expect(messages).toHaveLength(1);
    expect(messages[0].interactiveType).toBe('list');
    const ids = h.optionIds(messages[0]);
    expect(ids).toContain(WhatsAppButtonId.STAFF_ANY);
    expect(ids).toContain(`staff_${STYLIST_ALICE}`);
    expect(ids).not.toContain('staff_stylist-bob');
  });

  // ---------------------------------------------------------------------------
  // 3. Staff Selection & Real Dynamic Date Scanning
  // ---------------------------------------------------------------------------
  it('TC-FLOW-003: Staff selection queries AvailabilityService across dates and offers bookable dates', async () => {
    const h = await createWhatsAppHarness({
      conversation: fresh(ConversationState.SELECT_STAFF, { selectedCategoryId: CAT_HAIR, selectedServiceId: SVC_HAIRCUT }),
    });

    const { result, messages } = await h.tap(`staff_${STYLIST_ALICE}`);

    expect(result.state).toBe(ConversationState.SELECT_DATE);
    // CONTRACT: the date scan limit was intentionally raised from 2 to 3 dates.
    expect(h.mocks.availability.findAvailableDates).toHaveBeenCalledWith(SALON_ID, SVC_HAIRCUT, STYLIST_ALICE, 3);
    expect(messages).toHaveLength(1);
    expect(messages[0].interactiveType).toBe('button');
    const dateIds = h.optionIds(messages[0]).filter((id) => id.startsWith('date_'));
    expect(dateIds.length).toBeGreaterThanOrEqual(2);
    expect(h.optionIds(messages[0])[0]).toMatch(/^date_/);
  });

  // ---------------------------------------------------------------------------
  // 4. Date Selection & Real Slot Generation
  // ---------------------------------------------------------------------------
  it('TC-FLOW-004: Date selection queries AvailabilityService and displays real slot options', async () => {
    const h = await createWhatsAppHarness({
      conversation: fresh(ConversationState.SELECT_DATE, {
        selectedCategoryId: CAT_HAIR,
        selectedServiceId: SVC_HAIRCUT,
        selectedStaffId: STYLIST_ALICE,
      }),
    });

    const { result, messages } = await h.tap(`date_${h.dates.tomorrow}`);

    expect(result.state).toBe(ConversationState.SELECT_TIME);
    expect(h.mocks.availability.getAvailableSlots).toHaveBeenCalledWith(
      SALON_ID,
      SVC_HAIRCUT,
      h.dates.tomorrow,
      STYLIST_ALICE,
    );
    expect(messages).toHaveLength(1);
    const ids = h.optionIds(messages[0]);
    expect(ids).toContain('slot_10:00');
    expect(ids).toContain('slot_11:00');
  });

  // ---------------------------------------------------------------------------
  // 5. Slot Selection & Confirmation Prompt
  // ---------------------------------------------------------------------------
  it('TC-FLOW-005: Slot selection prepares summary and presents Confirm Booking button', async () => {
    const h = await createWhatsAppHarness({
      conversation: fresh(ConversationState.SELECT_TIME, {
        selectedCategoryId: CAT_HAIR,
        selectedServiceId: SVC_HAIRCUT,
        selectedStaffId: STYLIST_ALICE,
        selectedDate: dbDate(createDates().tomorrow),
      }),
    });

    const { result, messages } = await h.tap('slot_10:00');

    expect(result.state).toBe(ConversationState.CONFIRMATION);
    expect(messages).toHaveLength(1);
    expect(messages[0].interactiveType).toBe('button');
    expect(h.bodyOf(messages[0])).toContain('Men Haircut');
    expect(h.bodyOf(messages[0])).toContain('Alice');
    expect(h.optionIds(messages[0])).toContain(WhatsAppButtonId.CONFIRM_YES);
  });

  // ---------------------------------------------------------------------------
  // 6. Booking Confirmation & AppointmentsService Delegation
  // ---------------------------------------------------------------------------
  it('TC-FLOW-006: Confirm booking triggers createAppointment with exact slot and date', async () => {
    const { tomorrow } = createDates();
    const h = await createWhatsAppHarness({
      conversation: fresh(ConversationState.CONFIRMATION, {
        selectedCategoryId: CAT_HAIR,
        selectedServiceId: SVC_HAIRCUT,
        selectedStaffId: STYLIST_ALICE,
        selectedDate: dbDate(tomorrow),
        selectedStartTime: slotInstant(tomorrow, '10:00'),
      }),
    });

    const { result, messages } = await h.tap(WhatsAppButtonId.CONFIRM_YES);

    expect(h.mocks.appointments.createAppointment).toHaveBeenCalledWith(
      SALON_ID,
      expect.objectContaining({
        serviceIds: [SVC_HAIRCUT],
        stylistId: STYLIST_ALICE,
        date: tomorrow,
        startTime: '10:00',
      }),
      ...anyTrailingArgs(h.mocks.appointments.createAppointment, 2),
    );
    expect(String(h.mocks.appointments.createAppointment.mock.calls[0][1].customerPhone)).toContain(
      CUSTOMER_PHONE.slice(-10),
    );
    expect(result.state).toBe(ConversationState.START);
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(h.bodyOf(messages[0])).toContain('Booking Confirmed');
  });

  // ---------------------------------------------------------------------------
  // 7. Reschedule Flow Delegation
  // ---------------------------------------------------------------------------
  it('TC-FLOW-007: Reschedule button scans real availability and rslot_ invokes RescheduleService', async () => {
    const activeAppt = {
      id: 'appt-exist-1',
      appointmentNumber: 'APT-EXIST-1',
      serviceId: SVC_HAIRCUT,
      stylistId: STYLIST_ALICE,
      startAt: new Date(Date.now() + 5 * 3600 * 1000),
      createdAt: new Date(Date.now() - 3600 * 1000),
      status: AppointmentStatus.CONFIRMED,
      price: 500,
    };
    const h = await createWhatsAppHarness({
      conversation: fresh(ConversationState.ACTIVE_HUB, { activeAppointmentId: activeAppt.id }),
      appointments: [activeAppt],
    });

    // Step 1: request reschedule
    const step1 = await h.tap(WhatsAppButtonId.RESCHEDULE);
    expect(step1.result.state).toBe(ConversationState.SELECT_RESCHEDULE_DATE);
    expect(h.conversation.state).toBe(ConversationState.SELECT_RESCHEDULE_DATE);
    const rdate = h.optionIds(step1.messages[0]).find((id) => id.startsWith('rdate_'));
    expect(rdate).toBeDefined();

    // Step 2: choose the offered reschedule date
    const step2 = await h.tap(rdate!);
    expect(step2.result.state).toBe(ConversationState.SELECT_RESCHEDULE_TIME);
    expect(h.optionIds(step2.messages[0])).toContain('rslot_11:00');

    // Step 3: choose the reschedule slot
    const step3 = await h.tap('rslot_11:00');
    expect(step3.result.state).toBe(ConversationState.START);
    expect(h.mocks.reschedule.rescheduleAppointment).toHaveBeenCalledWith(
      SALON_ID,
      activeAppt.id,
      expect.objectContaining({ newDate: rdate!.replace('rdate_', ''), newStartTime: '11:00' }),
      ...anyTrailingArgs(h.mocks.reschedule.rescheduleAppointment, 3),
    );
  });

  // ---------------------------------------------------------------------------
  // 8. Cancellation Penalty Delegation Check
  // ---------------------------------------------------------------------------
  it('TC-FLOW-008: Cancellation button checks penalty via CancellationService.checkCancellationPenalty', async () => {
    const activeAppt = {
      id: 'appt-exist-cancel',
      appointmentNumber: 'APT-EXIST-CANCEL',
      serviceId: SVC_HAIRCUT,
      stylistId: STYLIST_ALICE,
      startAt: new Date(Date.now() + 1 * 3600 * 1000), // inside the 2h window
      createdAt: new Date(Date.now() - 3600 * 1000),
      status: AppointmentStatus.CONFIRMED,
      price: 500,
    };
    const h = await createWhatsAppHarness({
      conversation: fresh(ConversationState.ACTIVE_HUB, { activeAppointmentId: activeAppt.id }),
      appointments: [activeAppt],
    });
    h.mocks.cancellation.checkCancellationPenalty.mockResolvedValue({
      willIncurPenalty: true,
      hoursUntil: 1,
      cancelWindowHours: 2,
      apptStart: activeAppt.startAt,
    });

    const { result, messages } = await h.tap(WhatsAppButtonId.CANCEL_APPT);

    expect(result.state).toBe(ConversationState.CONFIRM_CANCEL);
    expect(h.mocks.cancellation.checkCancellationPenalty).toHaveBeenCalledWith(SALON_ID, activeAppt.id);
    expect(messages).toHaveLength(1);
    expect(h.bodyOf(messages[0])).toContain('Cancellation Warning');
    expect(h.bodyOf(messages[0])).toContain('Penalty Strike');
  });

  // ---------------------------------------------------------------------------
  // 9. Reschedule Cutoff Delegation Check (Blocked Flow)
  // ---------------------------------------------------------------------------
  it('TC-FLOW-009: Reschedule button respects cutoff when RescheduleService reports allowed=false', async () => {
    const activeAppt = {
      id: 'appt-exist-late',
      appointmentNumber: 'APT-EXIST-LATE',
      serviceId: SVC_HAIRCUT,
      stylistId: STYLIST_ALICE,
      startAt: new Date(Date.now() + 30 * 60 * 1000),
      createdAt: new Date(Date.now() - 3600 * 1000),
      status: AppointmentStatus.CONFIRMED,
      price: 500,
    };
    const h = await createWhatsAppHarness({
      conversation: fresh(ConversationState.ACTIVE_HUB, { activeAppointmentId: activeAppt.id }),
      appointments: [activeAppt],
    });
    h.mocks.reschedule.validateRescheduleEligibility.mockResolvedValue({
      allowed: false,
      reason: 'Appointment is within the 2h cutoff window',
      hoursUntil: 0.5,
      cancelWindowHours: 2,
    } as any);

    const { result, messages } = await h.tap(WhatsAppButtonId.RESCHEDULE);

    expect(h.mocks.reschedule.validateRescheduleEligibility).toHaveBeenCalledWith(SALON_ID, activeAppt.id);
    expect(messages).toHaveLength(1);
    expect(h.bodyOf(messages[0])).toContain('Reschedule Cutoff Passed');
    expect(h.bodyOf(messages[0])).toContain('You cannot reschedule because the time cutoff has passed');
    expect(result.state).not.toBe(ConversationState.SELECT_RESCHEDULE_DATE);
    expect(h.conversation.state).not.toBe(ConversationState.SELECT_RESCHEDULE_DATE);
  });

  // ---------------------------------------------------------------------------
  // 10. handleServiceChosen Staff Delegation
  // ---------------------------------------------------------------------------
  it('TC-FLOW-010: handleServiceChosen delegates qualified staff lookup to AvailabilityService.getQualifiedStylists', async () => {
    const h = await createWhatsAppHarness({
      conversation: fresh(ConversationState.SELECT_SERVICE, { id: 'conv-flow-010', selectedCategoryId: CAT_HAIR }),
    });
    const salon = buildSalonFixture();

    const result = await h.whatsAppService.handleServiceChosen('conv-flow-010', CUSTOMER_PHONE, salon, salon.services[0]);

    expect(h.mocks.availability.getQualifiedStylists).toHaveBeenCalledWith(SALON_ID, salon.services[0].id);
    expect(result.state).toBe(ConversationState.SELECT_STAFF);
    expect(h.sent.length).toBeGreaterThanOrEqual(1);
  });

  // ---------------------------------------------------------------------------
  // 11. Quick Booking flow - Service Selection resolves earliest slot today
  // ---------------------------------------------------------------------------
  it('TC-FLOW-011: When in QUICK booking mode, selecting service resolves earliest slot today and prompts QUICK_BOOK_CONFIRM', async () => {
    const { today } = createDates();
    const h = await createWhatsAppHarness({
      conversation: fresh(ConversationState.SELECT_SERVICE, {
        selectedCategoryId: CAT_HAIR,
        quickCodeVerifiedAt: new Date(), // marks QUICK booking mode
      }),
    });
    // CONTRACT: earliest-slot resolution moved from AvailabilityService.findEarliestAvailableSlotToday
    // to QuickBookingService.findNextAvailableSlot (single owner of quick-booking rules).
    h.mocks.quickBooking.findNextAvailableSlot.mockResolvedValue({
      isAvailable: true,
      isImmediateWindow: true,
      leadTimeMinutes: 5,
      dateStr: today,
      dateIso: dbDate(today),
      startTime: '11:00',
      startDt: slotInstant(today, '11:00'),
      displayTime: '11:00 AM',
      assignedStylistId: STYLIST_ALICE,
      stylistName: 'Alice',
    } as any);

    const { result, messages } = await h.tap(`svc_${SVC_HAIRCUT}`);

    expect(h.mocks.quickBooking.findNextAvailableSlot).toHaveBeenCalledWith(SALON_ID, SVC_HAIRCUT, null, TZ);
    expect(result.state).toBe(ConversationState.QUICK_BOOK_CONFIRM);
    expect(h.conversation.state).toBe(ConversationState.QUICK_BOOK_CONFIRM);
    expect(messages).toHaveLength(1);
    expect(h.bodyOf(messages[0])).toContain('QUICK BOOKING DETAILS');
    expect(h.bodyOf(messages[0])).toContain('Men Haircut');
    expect(h.bodyOf(messages[0])).toContain('11:00 AM');
    expect(h.optionIds(messages[0])).toContain(WhatsAppButtonId.CONFIRM_QUICK);
  });

  // ---------------------------------------------------------------------------
  // 12. Quick Booking confirmation creates PENDING_ACCEPTANCE appointment
  // ---------------------------------------------------------------------------
  it('TC-FLOW-012: Confirming quick booking delegates a QUICK_BOOK request and ends COMPLETED', async () => {
    const { today } = createDates();
    const h = await createWhatsAppHarness({
      conversation: fresh(ConversationState.QUICK_BOOK_CONFIRM, {
        selectedCategoryId: CAT_HAIR,
        selectedServiceId: SVC_HAIRCUT,
        selectedDate: dbDate(today),
        selectedStartTime: slotInstant(today, '11:00'),
        selectedStaffId: STYLIST_ALICE,
        quickCodeVerifiedAt: new Date(),
      }),
    });
    // CONTRACT: appointment creation with PENDING_ACCEPTANCE moved into
    // QuickBookingService.confirmQuickBooking; the WhatsApp layer only delegates.
    h.mocks.quickBooking.confirmQuickBooking.mockResolvedValue({
      success: true,
      appointment: { id: 'appt-quick-1', serviceNameSnapshot: 'Men Haircut', status: AppointmentStatus.PENDING_ACCEPTANCE },
    });

    const { result, messages } = await h.tap(WhatsAppButtonId.CONFIRM_QUICK);

    expect(h.mocks.quickBooking.confirmQuickBooking).toHaveBeenCalledWith(
      SALON_ID,
      expect.objectContaining({
        serviceId: SVC_HAIRCUT,
        stylistId: STYLIST_ALICE,
        startTime: '11:00',
        source: BookingSource.QUICK_BOOK,
      }),
    );
    expect(result.state).toBe(ConversationState.COMPLETED);
    expect(h.conversation.state).toBe(ConversationState.COMPLETED);
    expect(h.conversation.activeAppointmentId).toBe('appt-quick-1');
    expect(messages).toHaveLength(1);
    expect(h.bodyOf(messages[0])).toContain('Quick Booking Request Sent');
  });
});

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function createDates() {
  const now = DateTime.now().setZone(TZ);
  return {
    today: now.toISODate() as string,
    tomorrow: now.plus({ days: 1 }).toISODate() as string,
  };
}

/**
 * Matches whatever trailing arguments the production call passes (tx client, options...),
 * so assertions pin the business payload without coupling to plumbing parameters.
 */
function anyTrailingArgs(fn: jest.Mock, explicitCount: number): any[] {
  const call = fn.mock.calls[0] || [];
  return call.slice(explicitCount).map((arg: unknown) => (arg === undefined ? undefined : expect.anything()));
}
