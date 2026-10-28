/**
 * Conversation Integrity Suite (WhatsApp booking flow)
 *
 * Encodes the architecture invariants from the WhatsApp Flow Architecture Fix Plan:
 *
 *   I1  After every reply with a funnel menu, the persisted state matches that menu.
 *   I2  Every input in every state gets a reply that offers a way forward (no dead end).
 *   I3  "Continue Booking" converges: the menu it shows is immediately usable.
 *   I4  After "New Booking", no old draft field survives.
 *   I5  No write uses a stale conversation snapshot.
 *   I6  A customer with an active appointment can still add a service / book again.
 *   I7  Typed free text never produces an "Expired option" reply.
 *
 * RATCHET POLICY
 * --------------
 * Cases that the CURRENT code violates are registered as `it.failing(...)`.
 * `it.failing` PASSES while the bug exists and FAILS the moment the bug is fixed,
 * forcing whoever fixed it to promote the case to a normal `it(...)`.
 * => Bugs can only go down, never silently come back.
 */
import { AppointmentStatus, ConversationState } from '@prisma/client';
import { DateTime } from 'luxon';
import {
  createWhatsAppHarness,
  WhatsAppHarness,
  CAT_HAIR,
  SVC_HAIRCUT,
  SVC_SPA,
  STYLIST_ALICE,
  TZ,
} from './harness/whatsapp-harness';

jest.setTimeout(30000);

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const EXPIRED_PATTERN = /expired option|older action|option has expired/i;

/** Funnel menu option prefix -> states in which that menu may legitimately be open. */
const MENU_STATE_RULES: Array<{ prefix: RegExp; states: ConversationState[] }> = [
  { prefix: /^svc_/, states: [ConversationState.SELECT_SERVICE] },
  { prefix: /^staff_/, states: [ConversationState.SELECT_STAFF] },
  { prefix: /^date_/, states: [ConversationState.SELECT_DATE] },
  { prefix: /^(slot_|window_)/, states: [ConversationState.SELECT_TIME, ConversationState.CONFIRMATION] },
  { prefix: /^rdate_/, states: [ConversationState.SELECT_RESCHEDULE_DATE] },
  { prefix: /^(rslot_|rwindow_)/, states: [ConversationState.SELECT_RESCHEDULE_TIME] },
  { prefix: /^(cat_(?!back$)|gender_select_)/, states: [ConversationState.SELECT_CATEGORY] },
];

/** Returns the states a menu implies, or null if the message is not a funnel menu. */
function statesImpliedByMenu(h: WhatsAppHarness, payload: any): ConversationState[] | null {
  const ids = h.optionIds(payload);
  for (const rule of MENU_STATE_RULES) {
    if (ids.some((id) => rule.prefix.test(id))) return rule.states;
  }
  return null;
}

/** I1: persisted state must match the menu the customer is looking at. */
function expectStateMatchesLastMenu(h: WhatsAppHarness) {
  const implied = statesImpliedByMenu(h, h.lastMessage);
  if (!implied) return;
  if (!implied.includes(h.conversation.state as ConversationState)) {
    throw new Error(
      `I1 violated: menu ${JSON.stringify(h.optionIds(h.lastMessage))} implies state ${implied.join('|')} ` +
        `but persisted state is ${h.conversation.state}`,
    );
  }
}

const dbDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const slotInstant = (iso: string, hhmm: string) => DateTime.fromISO(`${iso}T${hhmm}`, { zone: TZ }).toJSDate();

const firstFunnelOption = (h: WhatsAppHarness, payload: any) =>
  h.optionIds(payload).find((id) => MENU_STATE_RULES.some((r) => r.prefix.test(id)));

/**
 * I3: follows the customer's real path out of the current screen and asserts it converges.
 *  - If a funnel menu is on screen, tapping its first option must not be "Expired".
 *  - If an "Expired" prompt is on screen, tapping "Continue Booking" must lead to a menu
 *    whose first option is accepted (this is exactly the loop in the customer screenshot).
 */
async function expectConverges(h: WhatsAppHarness) {
  for (let hop = 0; hop < 3; hop++) {
    const funnel = firstFunnelOption(h, h.lastMessage);
    if (funnel) {
      const follow = await h.tap(funnel);
      expect(follow.messages).toHaveLength(1);
      expect(h.bodyOf(follow.messages[0])).not.toMatch(EXPIRED_PATTERN);
      return;
    }
    if (h.optionIds(h.lastMessage).includes('btn_resume_booking')) {
      await h.tap('btn_resume_booking');
      continue;
    }
    return;
  }
  throw new Error('I3 violated: conversation did not converge to a usable menu within 3 taps');
}

/** Fresh (non-stale) draft seeds for every pre-booking funnel state. */
function funnelSeed(state: ConversationState, tomorrow: string): Record<string, any> {
  const base = { state, updatedAt: new Date() };
  switch (state) {
    case ConversationState.SELECT_CATEGORY:
      return base;
    case ConversationState.SELECT_SERVICE:
      return { ...base, selectedCategoryId: CAT_HAIR };
    case ConversationState.SELECT_STAFF:
      return { ...base, selectedCategoryId: CAT_HAIR, selectedServiceId: SVC_HAIRCUT };
    case ConversationState.SELECT_DATE:
      return { ...base, selectedCategoryId: CAT_HAIR, selectedServiceId: SVC_HAIRCUT, selectedStaffId: STYLIST_ALICE };
    case ConversationState.SELECT_TIME:
      return {
        ...base,
        selectedCategoryId: CAT_HAIR,
        selectedServiceId: SVC_HAIRCUT,
        selectedStaffId: STYLIST_ALICE,
        selectedDate: dbDate(tomorrow),
      };
    case ConversationState.CONFIRMATION:
      return {
        ...base,
        selectedCategoryId: CAT_HAIR,
        selectedServiceId: SVC_HAIRCUT,
        selectedStaffId: STYLIST_ALICE,
        selectedDate: dbDate(tomorrow),
        selectedStartTime: slotInstant(tomorrow, '10:00'),
      };
    default:
      return base;
  }
}

const TOMORROW = DateTime.now().setZone(TZ).plus({ days: 1 }).toISODate() as string;

const activeAppointment = () => ({
  id: 'appt-active-1',
  appointmentNumber: 'APT-ACTIVE-1',
  serviceId: SVC_HAIRCUT,
  stylistId: STYLIST_ALICE,
  status: AppointmentStatus.BOOKED,
  startAt: new Date(Date.now() + 26 * 3600 * 1000),
  createdAt: new Date(Date.now() - 3600 * 1000),
  price: 500,
});

// -----------------------------------------------------------------------------
// A. Baseline behaviour that MUST keep working through every refactor phase
// -----------------------------------------------------------------------------

describe('A. Baseline (must always pass)', () => {
  it('BASE-1: full happy path books an appointment', async () => {
    const h = await createWhatsAppHarness();
    await h.type('hi');
    await h.tap('btn_book');
    await h.tap(`cat_${CAT_HAIR}`);
    await h.tap(`svc_${SVC_HAIRCUT}`);
    expect(h.conversation.state).toBe(ConversationState.SELECT_STAFF);
    await h.tap('staff_any');
    expect(h.conversation.state).toBe(ConversationState.SELECT_DATE);
    await h.tap(`date_${h.dates.tomorrow}`);
    expect(h.conversation.state).toBe(ConversationState.SELECT_TIME);
    await h.tap('slot_10:00');
    expect([ConversationState.CONFIRMATION, ConversationState.COLLECT_NAME]).toContain(h.conversation.state);
    if (h.conversation.state === ConversationState.COLLECT_NAME) await h.type('Harness Customer');
    await h.tap('btn_confirm_yes');
    expect(h.mocks.appointments.createAppointment).toHaveBeenCalledTimes(1);
  });

  it('BASE-2: greeting always resets to the welcome menu', async () => {
    const h = await createWhatsAppHarness({ conversation: funnelSeed(ConversationState.SELECT_DATE, TOMORROW) });
    const { messages } = await h.type('hi');
    expect(messages).toHaveLength(1);
    expect(h.conversation.state).toBe(ConversationState.START);
    expect(h.optionIds(h.lastMessage)).toContain('btn_book');
  });

  it('BASE-3: funnel tap on a draft idle > 30 min resets with SESSION EXPIRED and clears draft', async () => {
    const h = await createWhatsAppHarness({
      conversation: { ...funnelSeed(ConversationState.SELECT_TIME, TOMORROW), updatedAt: new Date(Date.now() - 35 * 60 * 1000) },
    });
    const { result } = await h.tap('slot_10:00');
    expect(result.replyMessage).toContain('SESSION EXPIRED');
    expect(h.conversation.state).toBe(ConversationState.START);
    expect(h.conversation.selectedServiceId).toBeNull();
    expect(h.conversation.selectedDate).toBeNull();
  });

  it('BASE-4: each forward funnel step persists the matching state (I1 on the happy path)', async () => {
    const h = await createWhatsAppHarness();
    for (const input of ['btn_book', `cat_${CAT_HAIR}`, `svc_${SVC_HAIRCUT}`, 'staff_any', `date_${TOMORROW}`]) {
      await h.tap(input);
      expectStateMatchesLastMenu(h);
    }
  });
});

// -----------------------------------------------------------------------------
// B. Named regression scenarios (each maps to a root cause in the plan)
// -----------------------------------------------------------------------------

describe('B. Regression scenarios', () => {
  // FIXED in Phase 1 (gateway persists the returned step).
  it('SCN-1 (screenshot): Continue Booking -> tapping the offered date reaches the time menu', async () => {
    const h = await createWhatsAppHarness();
    await h.type('hi');
    await h.tap('btn_book');
    await h.tap(`cat_${CAT_HAIR}`);
    await h.tap(`svc_${SVC_HAIRCUT}`);
    await h.type('Hii');
    await h.tap('btn_resume_booking');
    const offeredDate = h.optionIds(h.lastMessage).find((id) => id.startsWith('date_'));
    expect(offeredDate).toBeDefined();
    const { messages } = await h.tap(offeredDate!);
    expect(h.bodyOf(messages[0])).not.toMatch(EXPIRED_PATTERN);
    expect(h.conversation.state).toBe(ConversationState.SELECT_TIME);
  });

  // R2 — typed text is judged by the button whitelist.
  // Fixed by: Phase 2 (free text never "Expired").
  it('SCN-2 (I7): typing free text mid-booking never says "Expired option"', async () => {
    const h = await createWhatsAppHarness({ conversation: funnelSeed(ConversationState.SELECT_STAFF, TOMORROW) });
    const { messages } = await h.type('Hii');
    expect(messages).toHaveLength(1);
    expect(h.bodyOf(messages[0])).not.toMatch(EXPIRED_PATTERN);
  });

  // R2 — step guard rejects going back to an earlier step of the SAME booking.
  // Fixed by: Phase 2 (step-order guard: earlier step = rewind).
  it('SCN-3 (I2): re-picking a service while choosing a stylist rewinds instead of expiring', async () => {
    const h = await createWhatsAppHarness({ conversation: funnelSeed(ConversationState.SELECT_STAFF, TOMORROW) });
    const { messages } = await h.tap(`svc_${SVC_SPA}`);
    expect(h.bodyOf(messages[0])).not.toMatch(EXPIRED_PATTERN);
    expect(h.conversation.selectedServiceId).toBe(SVC_SPA);
    expect(h.conversation.state).toBe(ConversationState.SELECT_STAFF);
  });

  // R4 — handleStartBooking only clears quickCodeVerifiedAt.
  // Fixed by: Phase 3 (startNewFlow resets every draft field).
  it('SCN-4 (I4): New Booking clears every old draft field', async () => {
    const h = await createWhatsAppHarness({ conversation: funnelSeed(ConversationState.CONFIRMATION, TOMORROW) });
    await h.tap('btn_new_booking');
    expect(h.conversation.selectedServiceId).toBeNull();
    expect(h.conversation.selectedStaffId).toBeNull();
    expect(h.conversation.selectedDate).toBeNull();
    expect(h.conversation.selectedStartTime).toBeNull();
    expect(h.conversation.selectedCategoryId).toBeNull();
  });

  // R2 — POST_BOOKING whitelist omits cat_/staff_/date_/slot_.
  // Fixed by: Phase 2 (appointment buttons routed by appointment ID, funnel by step order).
  it('SCN-5 (I6): customer with an active appointment can Add Service through to the time menu', async () => {
    const h = await createWhatsAppHarness({
      conversation: { state: ConversationState.ACTIVE_HUB, activeAppointmentId: 'appt-active-1' },
      appointments: [activeAppointment()],
    });
    await h.tap('btn_add_service');
    for (const pick of [
      () => h.optionIds(h.lastMessage).find((id) => /^(cat_(?!back)|gender_select_)/.test(id)),
      () => h.optionIds(h.lastMessage).find((id) => /^(cat_(?!back)|svc_)/.test(id)),
      () => h.optionIds(h.lastMessage).find((id) => /^(svc_|staff_)/.test(id)),
      () => h.optionIds(h.lastMessage).find((id) => /^(staff_|date_)/.test(id)),
      () => h.optionIds(h.lastMessage).find((id) => /^date_/.test(id)),
    ]) {
      const next = pick();
      if (!next) break;
      const { messages } = await h.tap(next);
      expect(h.bodyOf(messages[0])).not.toMatch(EXPIRED_PATTERN);
    }
    expect(h.optionIds(h.lastMessage).some((id) => /^(slot_|window_)/.test(id))).toBe(true);
  });

  // R2 — same root cause as SCN-5, via the main "Book" entry.
  it('SCN-6 (I6): customer with an active appointment can complete a second booking flow', async () => {
    const h = await createWhatsAppHarness({
      conversation: { state: ConversationState.START, activeAppointmentId: 'appt-active-1' },
      appointments: [activeAppointment()],
    });
    await h.tap('btn_book');
    await h.tap('gender_select_UNISEX');
    const steps = [`cat_${CAT_HAIR}`, `svc_${SVC_HAIRCUT}`, 'staff_any', `date_${TOMORROW}`];
    for (const step of steps) {
      const { messages } = await h.tap(step);
      expect(h.bodyOf(messages[0])).not.toMatch(EXPIRED_PATTERN);
    }
    expect(h.conversation.state).toBe(ConversationState.SELECT_TIME);
  });

  // FIXED in Phase 1 (stale setImmediate write replaced by an appointment-link-only write).
  it('SCN-7 (I5): no background write rolls the state back after the handler persisted it', async () => {
    const h = await createWhatsAppHarness({
      conversation: { state: ConversationState.START, activeAppointmentId: null },
      appointments: [activeAppointment()],
    });
    await h.tap('btn_reschedule');
    await h.flushBackground();
    expect(h.conversation.state).toBe(ConversationState.SELECT_RESCHEDULE_DATE);
    expectStateMatchesLastMenu(h);
    await expectConverges(h);
  });

  // R4 — dashboard deleted the selected service: selectedServiceId=null but state still SELECT_DATE.
  // The date tap calls availability with a missing service -> NotFoundException -> the webhook
  // queue swallows it -> the customer receives NO reply at all (silent dead end).
  // Fixed by: Phase 3 (deletes reset affected conversations) + Phase 2 (payload validation).
  it('SCN-8 (I2): orphaned draft (service deleted in dashboard) still gets a usable reply', async () => {
    const h = await createWhatsAppHarness({
      conversation: { ...funnelSeed(ConversationState.SELECT_DATE, TOMORROW), selectedServiceId: null },
    });
    const { messages, error } = await h.tap(`date_${TOMORROW}`);
    expect(error).toBeUndefined();
    expect(messages).toHaveLength(1);
    expect(h.optionIds(messages[0]).length).toBeGreaterThan(0);
    expectStateMatchesLastMenu(h);
  });
});

// -----------------------------------------------------------------------------
// C. State x Input matrix (I1 + I2 + I3 + I7 for every combination)
// -----------------------------------------------------------------------------

const FUNNEL_STATES: ConversationState[] = [
  ConversationState.SELECT_CATEGORY,
  ConversationState.SELECT_SERVICE,
  ConversationState.SELECT_STAFF,
  ConversationState.SELECT_DATE,
  ConversationState.SELECT_TIME,
  ConversationState.CONFIRMATION,
];

type MatrixInput = { label: string; kind: 'tap' | 'type'; value: string };

const MATRIX_INPUTS: MatrixInput[] = [
  { label: 'free text "Hii"', kind: 'type', value: 'Hii' },
  { label: 'free text "ok thanks"', kind: 'type', value: 'ok thanks' },
  { label: 'Continue Booking', kind: 'tap', value: 'btn_resume_booking' },
  { label: 'New Booking', kind: 'tap', value: 'btn_new_booking' },
  { label: 'Book', kind: 'tap', value: 'btn_book' },
  { label: 'category tap', kind: 'tap', value: `cat_${CAT_HAIR}` },
  { label: 'service tap', kind: 'tap', value: `svc_${SVC_HAIRCUT}` },
  { label: 'stylist tap', kind: 'tap', value: 'staff_any' },
  { label: 'date tap', kind: 'tap', value: `date_${TOMORROW}` },
  { label: 'slot tap', kind: 'tap', value: 'slot_10:00' },
];

/**
 * Matrix cases the CURRENT code violates (verified by running the suite).
 * Each entry is a ratchet: when a phase fixes it, the case starts "passing unexpectedly"
 * and MUST be removed from this list.
 */
const KNOWN_MATRIX_VIOLATIONS = new Set<string>([
  // All previous matrix violations (R1 & R2) fixed and passing.
]);

describe('C. State x Input matrix', () => {
  for (const state of FUNNEL_STATES) {
    describe(`state=${state}`, () => {
      for (const input of MATRIX_INPUTS) {
        const name = `${state} + ${input.label}`;
        const register = KNOWN_MATRIX_VIOLATIONS.has(name) ? it.failing : it;
        register(name, async () => {
          const h = await createWhatsAppHarness({ conversation: funnelSeed(state, TOMORROW) });
          const { messages, error } =
            input.kind === 'tap' ? await h.tap(input.value) : await h.type(input.value);

          // I2: no crash, exactly one reply, and it offers a way forward.
          expect(error).toBeUndefined();
          expect(messages).toHaveLength(1);
          expect(h.optionIds(messages[0]).length).toBeGreaterThan(0);

          // I7: typed text is never treated as an expired button.
          if (input.kind === 'type') expect(h.bodyOf(messages[0])).not.toMatch(EXPIRED_PATTERN);

          // I1: persisted state matches the menu on screen.
          expectStateMatchesLastMenu(h);

          // I3: the customer's natural next tap converges (no Expired -> Continue -> Expired loop).
          await expectConverges(h);
        });
      }
    });
  }
});
