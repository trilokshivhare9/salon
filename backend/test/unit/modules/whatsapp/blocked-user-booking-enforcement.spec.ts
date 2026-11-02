/**
 * Blocked User Booking Enforcement - Unit & Integration Test Suite
 *
 * Verifies that when a customer accumulates 3 penalty strikes or is marked blocked:
 * 1. WhatsApp Front-Door Invariant intercepts ALL booking attempts, greetings, quick bookings, and category/service/slot selections.
 * 2. Front-door gatekeeper responds with the clear, polite unblock message directing to salon desk.
 * 3. Salon Info remains accessible without offering a "Book Slot" button.
 * 4. Existing appointment fulfillment (ETA, Arrived) remains accessible.
 * 5. Restoring strikes unblocks the customer completely.
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

describe('Blocked User Booking Enforcement - Architecture Verification', () => {
  it('TC-BLOCK-001: Blocked customer sending "Hi" receives the blocked notice and no booking buttons', async () => {
    const h = await createWhatsAppHarness({
      salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
    });

    const { result, messages } = await h.type('Hi');

    expect(result.state).toBe(ConversationState.START);
    expect(messages).toHaveLength(1);
    expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
    expect(messages[0].bodyText).toContain('3 penalty strikes');
    expect(messages[0].bodyText).toContain('Please contact the salon directly to unblock');

    // Only Salon Info button should be shown, never Book Slot or Quick Book
    const buttonIds = h.optionIds(messages[0]);
    expect(buttonIds).toEqual([WhatsAppButtonId.INFO]);
    expect(buttonIds).not.toContain(WhatsAppButtonId.BOOK);
    expect(buttonIds).not.toContain(WhatsAppButtonId.QUICK_BOOK);
  });

  it('TC-BLOCK-002: Blocked customer tapping "⚡ Quick Book" is stopped immediately', async () => {
    const h = await createWhatsAppHarness({
      salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
    });

    const { result, messages } = await h.tap(WhatsAppButtonId.QUICK_BOOK);

    expect(result.state).toBe(ConversationState.START);
    expect(messages).toHaveLength(1);
    expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
    expect(messages[0].bodyText).toContain('3 penalty strikes');
    expect(h.optionIds(messages[0])).toEqual([WhatsAppButtonId.INFO]);
  });

  it('TC-BLOCK-003: Blocked customer attempting quick book confirmation is rejected', async () => {
    const h = await createWhatsAppHarness({
      salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
      conversation: { state: ConversationState.QUICK_BOOK_CONFIRM, selectedServiceId: SVC_HAIRCUT },
    });

    const { result, messages } = await h.tap(WhatsAppButtonId.CONFIRM_QUICK);

    expect(result.state).toBe(ConversationState.START);
    expect(messages).toHaveLength(1);
    expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
  });

  it('TC-BLOCK-004: Blocked customer tapping "📅 Book Slot" is stopped immediately', async () => {
    const h = await createWhatsAppHarness({
      salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
    });

    const { result, messages } = await h.tap(WhatsAppButtonId.BOOK);

    expect(result.state).toBe(ConversationState.START);
    expect(messages).toHaveLength(1);
    expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
  });

  it('TC-BLOCK-005: Blocked customer sending category selection is stopped', async () => {
    const h = await createWhatsAppHarness({
      salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
      conversation: { state: ConversationState.SELECT_CATEGORY },
    });

    const { result, messages } = await h.tap(`cat_${CAT_HAIR}`);

    expect(result.state).toBe(ConversationState.START);
    expect(messages).toHaveLength(1);
    expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
  });

  it('TC-BLOCK-006: Blocked customer sending service selection is stopped', async () => {
    const h = await createWhatsAppHarness({
      salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
      conversation: { state: ConversationState.SELECT_SERVICE, selectedCategoryId: CAT_HAIR },
    });

    const { result, messages } = await h.tap(`svc_${SVC_HAIRCUT}`);

    expect(result.state).toBe(ConversationState.START);
    expect(messages).toHaveLength(1);
    expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
  });

  it('TC-BLOCK-007: Blocked customer sending freeform text like "book" is stopped', async () => {
    const h = await createWhatsAppHarness({
      salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
    });

    const { result, messages } = await h.type('I want to book an appointment');

    expect(result.state).toBe(ConversationState.START);
    expect(messages).toHaveLength(1);
    expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
  });

  it('TC-BLOCK-008: Customer with yearlyNoShowCount >= 3 is automatically blocked even if isBookingBlocked was false', async () => {
    const h = await createWhatsAppHarness({
      salonUser: { isBookingBlocked: false, yearlyNoShowCount: 3 },
    });

    const { result, messages } = await h.tap(WhatsAppButtonId.BOOK);

    expect(result.state).toBe(ConversationState.START);
    expect(messages).toHaveLength(1);
    expect(messages[0].bodyText).toContain('ACCOUNT BLOCKED');
  });

  it('TC-BLOCK-009: Blocked customer CAN view Salon Info, but buttons omit "Book Slot"', async () => {
    const h = await createWhatsAppHarness({
      salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
    });

    const { messages } = await h.tap(WhatsAppButtonId.INFO);

    expect(messages).toHaveLength(1);
    expect(messages[0].bodyText).toContain('Info');
    const buttonIds = h.optionIds(messages[0]);
    expect(buttonIds).not.toContain(WhatsAppButtonId.BOOK);
    expect(buttonIds).not.toContain(WhatsAppButtonId.START);
    expect(buttonIds).toContain(WhatsAppButtonId.INFO);
  });

  it('TC-BLOCK-010: Blocked customer CAN update ETA on an already existing confirmed appointment', async () => {
    const existingApptId = 'appt-pre-existing-1';
    const h = await createWhatsAppHarness({
      salonUser: { isBookingBlocked: true, yearlyNoShowCount: 3 },
      appointments: [
        {
          id: existingApptId,
          status: AppointmentStatus.CONFIRMED,
          startAt: new Date(),
          endAt: new Date(Date.now() + 30 * 60 * 1000),
          serviceId: SVC_HAIRCUT,
          stylistId: STYLIST_ALICE,
          appointmentDate: new Date(),
        },
      ],
      conversation: { activeAppointmentId: existingApptId },
    });

    const { messages } = await h.tap(WhatsAppButtonId.ETA_ON_THE_WAY);

    expect(messages).toHaveLength(1);
    // Should successfully acknowledge ETA without throwing or returning blocked notice
    expect(messages[0].bodyText).not.toContain('ACCOUNT BLOCKED');
    expect(messages[0].bodyText).toContain('way');
  });

  it('TC-BLOCK-011: Unblocked customer (isBookingBlocked: false, strikes: 0) can book normally', async () => {
    const h = await createWhatsAppHarness({
      salonUser: { isBookingBlocked: false, yearlyNoShowCount: 0 },
    });

    const { result, messages } = await h.tap(WhatsAppButtonId.BOOK);

    expect(result.state).toBe(ConversationState.SELECT_CATEGORY);
    expect(messages).toHaveLength(1);
    expect(messages[0].bodyText).not.toContain('ACCOUNT BLOCKED');
  });
});
