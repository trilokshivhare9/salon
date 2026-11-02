/**
 * Brutal QA Matrix - Blocked User WhatsApp Simulation Test Suite
 *
 * Exhaustive edge-case verification for blocked customer policies:
 * - Entry-point greeting & menu attacks
 * - Mid-funnel direct button & payload injections (category, service, staff, date, slot, window, confirm)
 * - Freeform conversational text & numeric traps
 * - Stale and active draft recovery attempts
 * - 0, 1, 2, 3, 4 strike boundary conditions
 * - Active appointment management (ETA / Arrival / Cancellation) vs new booking restrictions
 * - Real-time dynamic unblock transition simulation
 * - Salon Info template safety (omission of booking buttons)
 */
import { AppointmentStatus, ConversationState } from '@prisma/client';
import { WhatsAppButtonId } from '../../../../src/modules/channels/whatsapp/services/whatsapp-sender.service';
import {
  createWhatsAppHarness,
  CAT_HAIR,
  CUSTOMER_PHONE,
  SALON_ID,
  STYLIST_ALICE,
  SVC_HAIRCUT,
} from './harness/whatsapp-harness';

jest.setTimeout(30000);

describe('Brutal QA Matrix: Blocked User Booking Enforcement Simulation', () => {
  // =========================================================================
  // CATEGORY 1: GREETINGS & MENU ENTRY-POINT ATTACKS
  // =========================================================================
  describe('Category 1: Greeting & Menu Attacks', () => {
    const greetings = ['hi', 'hello', 'hey', 'Hi', 'HELLO', 'Menu', 'start', 'namaste'];

    greetings.forEach((greet) => {
      it(`TC-BRUTAL-001: Casual greeting "${greet}" is intercepted with single blocked notice`, async () => {
        const h = await createWhatsAppHarness({
          salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
        });

        const { result, messages } = await h.type(greet);

        expect(result.state).toBe(ConversationState.START);
        expect(messages).toHaveLength(1);
        expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
        expect(messages[0].bodyText).toContain('3 penalty strikes');
        expect(messages[0].bodyText).toContain('Please contact the salon directly to unblock');

        // Critical UX Invariant: NEVER show "Book Slot" or "Quick Book"
        const buttonIds = h.optionIds(messages[0]);
        expect(buttonIds).toEqual([WhatsAppButtonId.INFO]);
        expect(buttonIds).not.toContain(WhatsAppButtonId.BOOK);
        expect(buttonIds).not.toContain(WhatsAppButtonId.QUICK_BOOK);
        expect(buttonIds).not.toContain(WhatsAppButtonId.START);
      });
    });

    it('TC-BRUTAL-002: WhatsAppButtonId.START payload does not present booking buttons', async () => {
      const h = await createWhatsAppHarness({
        salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
      });

      const { result, messages } = await h.tap(WhatsAppButtonId.START);

      expect(result.state).toBe(ConversationState.START);
      expect(messages).toHaveLength(1);
      expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
      expect(h.optionIds(messages[0])).toEqual([WhatsAppButtonId.INFO]);
    });

    it('TC-BRUTAL-003: Direct booking entry buttons are all rejected', async () => {
      const entryButtons = [
        WhatsAppButtonId.BOOK,
        'btn_book',
        WhatsAppButtonId.BOOK_NOW,
        'btn_book_now',
        WhatsAppButtonId.SERVICES,
        'btn_services',
        'btn_new_booking',
      ];

      for (const btn of entryButtons) {
        const h = await createWhatsAppHarness({
          salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
        });

        const { result, messages } = await h.tap(btn);
        expect(result.state).toBe(ConversationState.START);
        expect(messages).toHaveLength(1);
        expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
      }
    });

    it('TC-BRUTAL-004: Direct Quick Book button (btn_quick_book) is stopped at the front door', async () => {
      const h = await createWhatsAppHarness({
        salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
      });

      const { result, messages } = await h.tap(WhatsAppButtonId.QUICK_BOOK);

      expect(result.state).toBe(ConversationState.START);
      expect(messages).toHaveLength(1);
      expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
      expect(h.optionIds(messages[0])).toEqual([WhatsAppButtonId.INFO]);
    });
  });

  // =========================================================================
  // CATEGORY 2: IN-FUNNEL DEEP PAYLOAD INJECTIONS
  // =========================================================================
  describe('Category 2: In-Funnel Direct Payload Injections', () => {
    it('TC-BRUTAL-005: Direct category injection (cat_<id>) is rejected', async () => {
      const h = await createWhatsAppHarness({
        salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
        conversation: { state: ConversationState.SELECT_CATEGORY },
      });

      const { result, messages } = await h.tap(`cat_${CAT_HAIR}`);

      expect(result.state).toBe(ConversationState.START);
      expect(messages).toHaveLength(1);
      expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
    });

    it('TC-BRUTAL-006: Direct service injection (svc_<id>) is rejected', async () => {
      const h = await createWhatsAppHarness({
        salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
        conversation: { state: ConversationState.SELECT_SERVICE, selectedCategoryId: CAT_HAIR },
      });

      const { result, messages } = await h.tap(`svc_${SVC_HAIRCUT}`);

      expect(result.state).toBe(ConversationState.START);
      expect(messages).toHaveLength(1);
      expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
    });

    it('TC-BRUTAL-007: Direct staff injection (staff_<id>) is rejected', async () => {
      const h = await createWhatsAppHarness({
        salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
        conversation: { state: ConversationState.SELECT_STAFF, selectedServiceId: SVC_HAIRCUT },
      });

      const { result, messages } = await h.tap(`staff_${STYLIST_ALICE}`);

      expect(result.state).toBe(ConversationState.START);
      expect(messages).toHaveLength(1);
      expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
    });

    it('TC-BRUTAL-008: Direct date injection (date_2026-11-03) is rejected', async () => {
      const h = await createWhatsAppHarness({
        salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
        conversation: { state: ConversationState.SELECT_DATE, selectedServiceId: SVC_HAIRCUT },
      });

      const { result, messages } = await h.tap('date_2026-11-03');

      expect(result.state).toBe(ConversationState.START);
      expect(messages).toHaveLength(1);
      expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
    });

    it('TC-BRUTAL-009: Direct time slot injection (slot_11:00) is rejected', async () => {
      const h = await createWhatsAppHarness({
        salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
        conversation: { state: ConversationState.SELECT_TIME, selectedServiceId: SVC_HAIRCUT },
      });

      const { result, messages } = await h.tap('slot_11:00');

      expect(result.state).toBe(ConversationState.START);
      expect(messages).toHaveLength(1);
      expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
    });

    it('TC-BRUTAL-010: Direct time window switch injection (window_EVENING) is rejected', async () => {
      const h = await createWhatsAppHarness({
        salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
        conversation: { state: ConversationState.SELECT_TIME, selectedServiceId: SVC_HAIRCUT },
      });

      const { result, messages } = await h.tap('window_EVENING');

      expect(result.state).toBe(ConversationState.START);
      expect(messages).toHaveLength(1);
      expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
    });

    it('TC-BRUTAL-011: Direct gender selection injection (gender_select_FEMALE) is rejected', async () => {
      const h = await createWhatsAppHarness({
        salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
      });

      const { result, messages } = await h.tap('gender_select_FEMALE');

      expect(result.state).toBe(ConversationState.START);
      expect(messages).toHaveLength(1);
      expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
    });

    it('TC-BRUTAL-012: Direct add-on injection (addon_svc_...) is rejected', async () => {
      const h = await createWhatsAppHarness({
        salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
        conversation: { state: ConversationState.SELECT_ADDON },
      });

      const { result, messages } = await h.tap('addon_svc_spa');

      expect(result.state).toBe(ConversationState.START);
      expect(messages).toHaveLength(1);
      expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
    });

    it('TC-BRUTAL-013: Direct booking confirmation injection (btn_confirm) is rejected', async () => {
      const h = await createWhatsAppHarness({
        salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
        conversation: {
          state: ConversationState.CONFIRMATION,
          selectedServiceId: SVC_HAIRCUT,
          selectedDate: '2026-11-03',
          selectedStartTime: '11:00',
        },
      });

      const { result, messages } = await h.tap('btn_confirm');

      expect(result.state).toBe(ConversationState.START);
      expect(messages).toHaveLength(1);
      expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
    });

    it('TC-BRUTAL-014: Direct quick book confirmation injection (btn_confirm_quick) is rejected', async () => {
      const h = await createWhatsAppHarness({
        salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
        conversation: {
          state: ConversationState.QUICK_BOOK_CONFIRM,
          selectedServiceId: SVC_HAIRCUT,
          selectedDate: '2026-11-02',
          selectedStartTime: '11:00',
        },
      });

      const { result, messages } = await h.tap(WhatsAppButtonId.CONFIRM_QUICK);

      expect(result.state).toBe(ConversationState.START);
      expect(messages).toHaveLength(1);
      expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
    });
  });

  // =========================================================================
  // CATEGORY 3: FREEFORM TEXT & NATURAL LANGUAGE
  // =========================================================================
  describe('Category 3: Freeform Conversational Text', () => {
    it('TC-BRUTAL-015: Freeform text "book haircut tomorrow" is rejected', async () => {
      const h = await createWhatsAppHarness({
        salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
      });

      const { result, messages } = await h.type('book haircut tomorrow at 5pm');

      expect(result.state).toBe(ConversationState.START);
      expect(messages).toHaveLength(1);
      expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
    });

    it('TC-BRUTAL-016: Numeric digits like "1", "2" are rejected', async () => {
      const h = await createWhatsAppHarness({
        salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
      });

      const { result, messages } = await h.type('1');

      expect(result.state).toBe(ConversationState.START);
      expect(messages).toHaveLength(1);
      expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
    });

    it('TC-BRUTAL-017: Text "yes" or "ok" is rejected', async () => {
      const h = await createWhatsAppHarness({
        salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
      });

      const { result, messages } = await h.type('yes please confirm');

      expect(result.state).toBe(ConversationState.START);
      expect(messages).toHaveLength(1);
      expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
    });
  });

  // =========================================================================
  // CATEGORY 4: STALE DRAFT & RECOVERY HIJACK ATTEMPTS
  // =========================================================================
  describe('Category 4: Stale Draft Recovery Attempts', () => {
    it('TC-BRUTAL-018: Customer with pre-existing in-flight draft is wiped when attempting to resume', async () => {
      const h = await createWhatsAppHarness({
        salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
        conversation: {
          state: ConversationState.SELECT_TIME,
          selectedCategoryId: CAT_HAIR,
          selectedServiceId: SVC_HAIRCUT,
          updatedAt: new Date(Date.now() - 5 * 60 * 1000), // fresh 5-min draft
        },
      });

      const { result, messages } = await h.tap(WhatsAppButtonId.RESUME_BOOKING);

      expect(result.state).toBe(ConversationState.START);
      expect(messages).toHaveLength(1);
      expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');

      // Verify conversation draft was completely wiped
      expect(h.conversation.selectedServiceId).toBeNull();
      expect(h.conversation.selectedCategoryId).toBeNull();
      expect(h.conversation.state).toBe(ConversationState.START);
    });

    it('TC-BRUTAL-019: CHECK_LAST_BOOKING button click is halted', async () => {
      const h = await createWhatsAppHarness({
        salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
      });

      const { result, messages } = await h.tap(WhatsAppButtonId.CHECK_LAST_BOOKING);

      expect(result.state).toBe(ConversationState.START);
      expect(messages).toHaveLength(1);
      expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
    });
  });

  // =========================================================================
  // CATEGORY 5: STRIKE BOUNDARY CONDITIONS (0, 1, 2, 3, 4)
  // =========================================================================
  describe('Category 5: Strike Boundary Conditions', () => {
    it('TC-BRUTAL-020: 0 strikes, isBookingBlocked: false -> Allowed', async () => {
      const h = await createWhatsAppHarness({
        salonUser: { isBookingBlocked: false, yearlyNoShowCount: 0 },
      });

      const { result, messages } = await h.tap(WhatsAppButtonId.BOOK);
      expect(result.state).toBe(ConversationState.SELECT_CATEGORY);
      expect(messages[0].bodyText).not.toContain('ACCOUNT BLOCKED');
    });

    it('TC-BRUTAL-021: 1 strike, isBookingBlocked: false -> Allowed', async () => {
      const h = await createWhatsAppHarness({
        salonUser: { isBookingBlocked: false, yearlyNoShowCount: 1 },
      });

      const { result, messages } = await h.tap(WhatsAppButtonId.BOOK);
      expect(result.state).toBe(ConversationState.SELECT_CATEGORY);
      expect(messages[0].bodyText).not.toContain('ACCOUNT BLOCKED');
    });

    it('TC-BRUTAL-022: 2 strikes, isBookingBlocked: false -> Allowed', async () => {
      const h = await createWhatsAppHarness({
        salonUser: { isBookingBlocked: false, yearlyNoShowCount: 2 },
      });

      const { result, messages } = await h.tap(WhatsAppButtonId.BOOK);
      expect(result.state).toBe(ConversationState.SELECT_CATEGORY);
      expect(messages[0].bodyText).not.toContain('ACCOUNT BLOCKED');
    });

    it('TC-BRUTAL-023: 3 strikes, isBookingBlocked: false -> BLOCKED AUTOMATICALLY', async () => {
      const h = await createWhatsAppHarness({
        salonUser: { isBookingBlocked: false, yearlyNoShowCount: 3 },
      });

      const { result, messages } = await h.tap(WhatsAppButtonId.BOOK);
      expect(result.state).toBe(ConversationState.START);
      expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
    });

    it('TC-BRUTAL-024: 4 strikes (overflow) -> BLOCKED AUTOMATICALLY', async () => {
      const h = await createWhatsAppHarness({
        salonUser: { isBookingBlocked: false, yearlyNoShowCount: 4 },
      });

      const { result, messages } = await h.tap(WhatsAppButtonId.BOOK);
      expect(result.state).toBe(ConversationState.START);
      expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
    });

    it('TC-BRUTAL-025: 0 strikes, but isBookingBlocked: true (admin manual lock) -> BLOCKED', async () => {
      const h = await createWhatsAppHarness({
        salonUser: { isBookingBlocked: true, yearlyNoShowCount: 0 },
      });

      const { result, messages } = await h.tap(WhatsAppButtonId.BOOK);
      expect(result.state).toBe(ConversationState.START);
      expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
    });
  });

  // =========================================================================
  // CATEGORY 6: ACTIVE APPOINTMENT FULFILLMENT (LEGITIMATE ACTIONS)
  // =========================================================================
  describe('Category 6: Active Appointment Operations for Blocked User', () => {
    const existingApptId = 'appt-pre-existing-confirmed';

    const buildActiveApptHarness = (status = AppointmentStatus.CONFIRMED) =>
      createWhatsAppHarness({
        salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
        appointments: [
          {
            id: existingApptId,
            status,
            startAt: new Date(Date.now() + 60 * 60 * 1000),
            endAt: new Date(Date.now() + 90 * 60 * 1000),
            serviceId: SVC_HAIRCUT,
            stylistId: STYLIST_ALICE,
            appointmentDate: new Date(),
          },
        ],
        conversation: { activeAppointmentId: existingApptId },
      });

    it('TC-BRUTAL-026: Blocked user can send ETA "On the way" for an existing booking', async () => {
      const h = await buildActiveApptHarness();

      const { messages } = await h.tap(WhatsAppButtonId.ETA_ON_THE_WAY);

      expect(messages).toHaveLength(1);
      expect(messages[0].bodyText).not.toContain('ACCOUNT BLOCKED');
      expect(messages[0].bodyText).toContain('way');
    });

    it('TC-BRUTAL-027: Blocked user can confirm arrival ("Arrived") for an existing booking', async () => {
      const h = await buildActiveApptHarness();

      const { messages } = await h.tap(WhatsAppButtonId.ETA_ARRIVED);

      expect(messages).toHaveLength(1);
      expect(messages[0].bodyText).not.toContain('ACCOUNT BLOCKED');
      expect(messages[0].bodyText).toContain('Checked In');
    });

    it('TC-BRUTAL-028: Blocked user can report "Running Late" for an existing booking', async () => {
      const h = await buildActiveApptHarness();

      const { messages } = await h.tap(WhatsAppButtonId.ETA_LATE_15);

      expect(messages).toHaveLength(1);
      expect(messages[0].bodyText).not.toContain('ACCOUNT BLOCKED');
    });

    it('TC-BRUTAL-029: Blocked user can cancel an existing booking to prevent another no-show penalty', async () => {
      const h = await buildActiveApptHarness();

      const { messages } = await h.tap(WhatsAppButtonId.CANCEL_APPT);

      expect(messages).toHaveLength(1);
      expect(messages[0].bodyText).not.toContain('ACCOUNT BLOCKED');
      // Should ask for confirmation or confirm cancellation
      expect(messages[0].bodyText.toLowerCase()).toMatch(/cancel/);
    });

    it('TC-BRUTAL-030: Blocked user with existing booking CANNOT create another new booking', async () => {
      const h = await buildActiveApptHarness();

      const { result, messages } = await h.tap(WhatsAppButtonId.BOOK);

      expect(result.state).toBe(ConversationState.START);
      expect(messages).toHaveLength(1);
      expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
    });
  });

  // =========================================================================
  // CATEGORY 7: REAL-TIME DYNAMIC UNBLOCK SIMULATION
  // =========================================================================
  describe('Category 7: Dynamic Unblock Lifecycle Simulation', () => {
    it('TC-BRUTAL-031: Blocked customer immediately regains booking access when unblocked by admin', async () => {
      // 1. Customer starts BLOCKED
      const h = await createWhatsAppHarness({
        salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
      });

      // Attempt 1: Blocked
      const attempt1 = await h.type('Hi');
      expect(attempt1.result.state).toBe(ConversationState.START);
      expect(attempt1.messages[0].bodyText).toContain('ACCOUNT BLOCKED');
      expect(h.optionIds(attempt1.messages[0])).not.toContain(WhatsAppButtonId.BOOK);

      // Attempt 2: Direct button tap -> Blocked
      const attempt2 = await h.tap(WhatsAppButtonId.BOOK);
      expect(attempt2.messages[0].bodyText).toContain('ACCOUNT BLOCKED');

      // 2. SIMULATE SALON ADMIN UNBLOCKING CUSTOMER FROM DASHBOARD
      h.prisma.tables.salonUser[0].isBookingBlocked = false;
      h.prisma.tables.salonUser[0].yearlyNoShowCount = 0;
      h.invalidateUserCache();

      // Attempt 3: Customer taps Book Slot again -> GRANTED IMMEDIATE ACCESS!
      const attempt3 = await h.tap(WhatsAppButtonId.BOOK);
      expect(attempt3.messages[0].bodyText).not.toContain('ACCOUNT BLOCKED');
      expect(attempt3.messages[0].interactiveType).toBe('list');
      expect(h.optionIds(attempt3.messages[0])).toContain('gender_select_MALE');

      // Attempt 4: Customer selects gender -> Categories listed!
      const attempt4 = await h.tap('gender_select_MALE');
      expect(attempt4.result.state).toBe(ConversationState.SELECT_CATEGORY);
      expect(attempt4.messages[0].bodyText).not.toContain('ACCOUNT BLOCKED');
      expect(h.optionIds(attempt4.messages[0])).toContain(`cat_${CAT_HAIR}`);
    });
  });

  // =========================================================================
  // CATEGORY 8: SALON INFO SAFETY INVARIANTS
  // =========================================================================
  describe('Category 8: Salon Info Safety Invariants', () => {
    it('TC-BRUTAL-032: Blocked customer tapping Salon Info receives salon details without Book button', async () => {
      const h = await createWhatsAppHarness({
        salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
      });

      const { messages } = await h.tap(WhatsAppButtonId.INFO);

      expect(messages).toHaveLength(1);
      expect(messages[0].bodyText).toContain('Info');
      expect(messages[0].bodyText).toContain('Address');
      expect(messages[0].bodyText).toContain('Phone');

      const buttons = h.optionIds(messages[0]);
      expect(buttons).toContain(WhatsAppButtonId.INFO);
      expect(buttons).not.toContain(WhatsAppButtonId.BOOK);
      expect(buttons).not.toContain(WhatsAppButtonId.START);
      expect(buttons).not.toContain(WhatsAppButtonId.QUICK_BOOK);
    });
  });
});
