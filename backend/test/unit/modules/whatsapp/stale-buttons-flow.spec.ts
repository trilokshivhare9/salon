/**
 * Smart WhatsApp Stale Button Fallbacks (Flow Matrix Tests)
 *
 * Ported from the real development database onto the shared in-memory harness.
 * Messages are now captured at the lowest send point, so replies sent directly by the
 * session layer (e.g. the lifecycle "expired" reply) are observed too — the old spy on
 * WhatsAppService.sendMetaMessage missed them.
 */
import { ConversationState } from '@prisma/client';
import { createWhatsAppHarness } from './harness/whatsapp-harness';

jest.setTimeout(30000);

describe('Smart WhatsApp Stale Button Fallbacks (Flow Matrix Tests)', () => {
  // ---------------------------------------------------------------------------
  // SCENARIO 1: Mid-Booking Flow Stale Button Tap
  // ---------------------------------------------------------------------------
  it('TC-STALE-001: User taps old button while mid-booking -> Sends "continue booking or start new"', async () => {
    const h = await createWhatsAppHarness({
      conversation: { state: ConversationState.SELECT_SERVICE, updatedAt: new Date() },
    });

    // Customer taps a stale button that does not belong to SELECT_SERVICE
    const { result, messages } = await h.tap('date_old_2026');

    expect(result.replyMessage).toContain('Expired option');
    expect(messages).toHaveLength(1);
    expect(messages[0].buttons).toEqual([
      { id: 'btn_resume_booking', title: '▶️ Continue Booking' },
      { id: 'btn_new_booking', title: '📅 New Booking' },
    ]);
  });

  // ---------------------------------------------------------------------------
  // SCENARIO 2: Idle / Completed / Post-Booking Stale Button Tap
  // ---------------------------------------------------------------------------
  it('TC-STALE-002: User taps old button after booking is done/idle -> Sends "check last booking or start new"', async () => {
    const h = await createWhatsAppHarness({
      conversation: { state: ConversationState.START, updatedAt: new Date() },
    });

    // Customer taps an old reminder button when NO active appointment exists
    const { result, messages } = await h.tap('remind_confirm');

    expect(result.replyMessage).toContain('This option has expired. You can check your last booking or start a new one.');
    expect(messages).toHaveLength(1);
    // CONTRACT: the "check last booking" button got its own dedicated ID
    // (WhatsAppButtonId.CHECK_LAST_BOOKING = 'btn_last_booking') instead of reusing
    // 'btn_resume_booking', so it can no longer be confused with resuming a draft.
    expect(messages[0].buttons).toEqual([
      { id: 'btn_last_booking', title: '📋 Check Booking' },
      { id: 'btn_new_booking', title: '📅 New Booking' },
    ]);
  });
});
