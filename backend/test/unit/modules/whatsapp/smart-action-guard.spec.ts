/**
 * Smart Action Guard & Lifecycle Intelligence (Edge Case Audits)
 *
 * Ported from the real development database onto the shared in-memory harness.
 * Previously this spec wrote real appointments/conversations into the first ACTIVE salon
 * of the dev DB, and the cases polluted each other (EC-3 left a CONFIRMED appointment that
 * changed EC-6's lifecycle). Each case now seeds its own isolated world.
 *
 * All original assertions are kept unchanged.
 */
import { AppointmentStatus, ConversationState } from '@prisma/client';
import { createWhatsAppHarness, STYLIST_ALICE, SVC_HAIRCUT } from './harness/whatsapp-harness';

jest.setTimeout(30000);

const appointment = (overrides: Record<string, any>) => ({
  id: `appt-audit-${Math.random().toString(36).slice(2, 8)}`,
  appointmentNumber: `AUDIT-${Date.now()}`,
  stylistId: STYLIST_ALICE,
  serviceId: SVC_HAIRCUT,
  serviceNameSnapshot: 'Men Haircut',
  durationMinutes: 30,
  price: 350,
  createdAt: new Date(Date.now() - 3600 * 1000),
  ...overrides,
});

describe('Smart Action Guard & Lifecycle Intelligence (Edge Case Audits)', () => {
  // ---------------------------------------------------------------------------
  // EDGE CASE 1: Tapping remind_confirm on Auto-Canceled Appointment
  // ---------------------------------------------------------------------------
  it('EC-1: Tapping remind_confirm on Auto-Canceled appointment gives clear cancellation reason & offers New Booking (NEVER Continue Booking)', async () => {
    const canceled = appointment({
      status: AppointmentStatus.CANCELLED,
      cancellationReason: 'GHOSTED_2H_REMINDER',
      cancelledBy: 'SYSTEM',
      startAt: new Date(Date.now() + 3600000),
      endAt: new Date(Date.now() + 5400000),
    });
    const h = await createWhatsAppHarness({
      conversation: { state: ConversationState.START, activeAppointmentId: canceled.id },
      appointments: [canceled],
    });

    const { result, messages } = await h.tap('remind_confirm');

    expect(result.replyMessage).toContain('APPOINTMENT ALREADY CANCELED');
    expect(result.replyMessage).toContain('automatically canceled');
    expect(result.replyMessage).not.toContain('Continue Booking');
    expect(messages).toHaveLength(1);
    expect(messages[0].buttons).toEqual([
      { id: 'btn_book_now', title: '📅 Book New Slot' },
      { id: 'btn_start', title: '🏠 Main Menu' },
    ]);
  });

  // ---------------------------------------------------------------------------
  // EDGE CASE 2: Tapping remind_confirm on Completed Appointment
  // ---------------------------------------------------------------------------
  it('EC-2: Tapping remind_confirm on Completed appointment gives friendly visit completed notice', async () => {
    const completed = appointment({
      status: AppointmentStatus.COMPLETED,
      startAt: new Date(Date.now() - 3600000),
      endAt: new Date(Date.now() - 1800000),
    });
    const h = await createWhatsAppHarness({
      conversation: { state: ConversationState.START, activeAppointmentId: completed.id },
      appointments: [completed],
    });

    const { result, messages } = await h.tap('remind_confirm');

    expect(result.replyMessage).toContain('VISIT COMPLETED');
    expect(result.replyMessage).not.toContain('Continue Booking');
    expect(messages).toHaveLength(1);
    expect(messages[0].buttons).toEqual([
      { id: 'btn_book_now', title: '📅 Book Again' },
      { id: 'btn_start', title: '🏠 Main Menu' },
    ]);
  });

  // ---------------------------------------------------------------------------
  // EDGE CASE 3: Idempotent Confirmation (Already Confirmed)
  // ---------------------------------------------------------------------------
  it('EC-3: Tapping remind_confirm on Already Confirmed appointment confirms without errors', async () => {
    const confirmed = appointment({
      status: AppointmentStatus.CONFIRMED,
      startAt: new Date(Date.now() + 7200000),
      endAt: new Date(Date.now() + 9000000),
    });
    const h = await createWhatsAppHarness({
      conversation: { state: ConversationState.START, activeAppointmentId: confirmed.id },
      appointments: [confirmed],
    });

    const { result, error } = await h.tap('remind_confirm');

    expect(error).toBeUndefined();
    expect(result.replyMessage).toContain('APPOINTMENT ALREADY CONFIRMED');
  });

  // ---------------------------------------------------------------------------
  // EDGE CASE 4: 2-Hour Reminder Prompt Wording & Warning Notice
  // ---------------------------------------------------------------------------
  it('EC-4: build2HourReminderPrompt includes "✅ Confirm Booking" button and 1-hour auto-cancel warning', async () => {
    const h = await createWhatsAppHarness();
    const templateService = (h.whatsAppService as any).templateService ?? (h.whatsAppService as any).whatsAppTemplateService;
    expect(templateService).toBeDefined();

    const prompt = templateService.build2HourReminderPrompt(
      'Glamour Salon',
      'Trilok',
      'Haircut',
      350,
      'Rahul',
      'Today, Oct 1',
      '04:00 PM',
      'Main Street',
    );

    expect(prompt.bodyText).toContain('Action Required within 1 Hour:');
    expect(prompt.bodyText).toContain('automatically canceled with a penalty strike');
    const confirmBtn = prompt.buttons.find((b: any) => b.id === 'remind_confirm');
    expect(confirmBtn).toBeDefined();
    expect(confirmBtn?.title).toBe('✅ Confirm Booking');
  });

  // ---------------------------------------------------------------------------
  // EDGE CASE 5: Tapping Funnel Action on Stale Draft (> 30 mins)
  // ---------------------------------------------------------------------------
  it('EC-5: Tapping funnel action after 35 mins resets cleanly with SESSION EXPIRED and clears dirty columns', async () => {
    const staleDate = new Date(Date.now() - 35 * 60 * 1000);
    const h = await createWhatsAppHarness({
      conversation: {
        state: ConversationState.SELECT_TIME,
        selectedServiceId: SVC_HAIRCUT,
        selectedDate: staleDate,
        updatedAt: staleDate,
        activeAppointmentId: null,
      },
    });

    const { result } = await h.tap('slot_14:00');

    expect(result.replyMessage).toContain('SESSION EXPIRED');
    expect(h.conversation.selectedServiceId).toBeNull();
    expect(h.conversation.selectedDate).toBeNull();
    expect(h.conversation.state).toBe(ConversationState.START);
  });

  // ---------------------------------------------------------------------------
  // EDGE CASE 6: Tapping Resume Booking on Stale Draft
  // ---------------------------------------------------------------------------
  const staleDraft = () => {
    const staleDate = new Date(Date.now() - 40 * 60 * 1000);
    return {
      state: ConversationState.SELECT_TIME,
      selectedServiceId: SVC_HAIRCUT,
      selectedDate: staleDate,
      updatedAt: staleDate,
      activeAppointmentId: null,
    };
  };

  // Path the original (real-DB) test actually exercised: the customer has a past booking.
  it('EC-6a: Tapping btn_resume_booking on stale draft (customer has a past booking) resets cleanly', async () => {
    const past = appointment({
      status: AppointmentStatus.COMPLETED,
      startAt: new Date(Date.now() - 3 * 24 * 3600 * 1000),
      endAt: new Date(Date.now() - 3 * 24 * 3600 * 1000 + 1800000),
    });
    const h = await createWhatsAppHarness({ conversation: staleDraft(), appointments: [past] });

    const { result } = await h.tap('btn_resume_booking');

    expect(result.replyMessage).not.toContain('Please pick an available time slot');
    expect(h.conversation.selectedServiceId).toBeNull();
    expect(h.conversation.state).toBe(ConversationState.START);
  });

  // FIXED in Phase 1: the "no bookings" branch of handleCheckLastBooking now resets
  // START + clears the draft, same as its "has bookings" branch.
  it('EC-6b: Tapping btn_resume_booking on stale draft (customer has NO bookings) resets cleanly', async () => {
    const h = await createWhatsAppHarness({ conversation: staleDraft() });

    const { result } = await h.tap('btn_resume_booking');

    expect(result.replyMessage).not.toContain('Please pick an available time slot');
    expect(h.conversation.selectedServiceId).toBeNull();
    expect(h.conversation.state).toBe(ConversationState.START);
  });
});
