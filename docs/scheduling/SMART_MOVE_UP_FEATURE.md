# Smart Move-Up (Early Slot Re-allocation) Feature Specification

> **Document Type**: Architecture & Implementation Specification  
> **Status**: Feature Draft / Backlog  
> **Module**: `backend/src/modules/salon-admin/appointments/cancellation` & `backend/src/modules/channels/whatsapp`  
> **Author**: Senior Systems Architect  
> **Created**: October 2026  

---

## 1. Executive Summary & Business Objective

In high-volume salon operations, late cancellations leave stylists idle and result in unrecoverable revenue loss. **Smart Move-Up** transforms freed time into revenue by automatically notifying customers with *later* confirmed bookings on the same day that an earlier slot has just become available, allowing them to shift earlier with a single click in WhatsApp.

```
┌─────────────────────────────────┐
│ Customer A cancels at 1:30 PM   │
│ (2:30 PM - 3:00 PM freed up)    │
└────────────────┬────────────────┘
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ Algorithm finds Customer B (booked at 5:30 PM same stylist) │
│ & sends WhatsApp Interactive Button Message                 │
└────────────────┬────────────────────────────────────────────┘
                 ▼
┌─────────────────────────────────────────────────────────────┐
│ Customer B taps [⚡ Move to 2:30 PM] in WhatsApp            │
│ ➔ 1-Click Atomic Shift: 5:30 PM booking moves to 2:30 PM   │
│ ➔ Reception Dashboard Queue updates in Real-Time (SSE)      │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Current State & Technical Gap Analysis

A prototype of this feature was drafted in the codebase, but is currently **completely inactive**.

### 2.1 The Silent Blocker in `CancellationService`
In [`cancellation.service.ts`](file:///Users/trilokshivhare/Documents/Development/sall/salon/backend/src/modules/salon-admin/appointments/cancellation/cancellation.service.ts#L424-L430):
```typescript
const salon: any = await this.prisma.salon.findUnique({
  where: { id: freedAppointment.salonId },
  include: { whatsappAccount: true },
});

if (!salon || !salon.isSmartMoveUpEnabled) return 0; // ⚠️ SILENT EXIT
```
* **Root Cause**: `isSmartMoveUpEnabled` does **not exist** in `backend/prisma/schema.prisma` under `model Salon`.
* **Effect**: `salon.isSmartMoveUpEnabled` evaluates to `undefined`, causing the function to silently exit without sending any messages.

### 2.2 Missing WhatsApp Button Action Handler
When the candidate receives the interactive WhatsApp message:
* Button 1 ID: `move_up_accept_${candidate.id}_${freedAppointment.id}`
* Button 2 ID: `move_up_decline_${candidate.id}`

In [`whatsapp-action-handler.service.ts`](file:///Users/trilokshivhare/Documents/Development/sall/salon/backend/src/modules/channels/whatsapp/services/whatsapp-action-handler.service.ts):
* There is **zero routing** for `move_up_accept_` or `move_up_decline_`.
* If a customer taps the button, WhatsApp Gateway drops it into fallback with no response.

---

## 3. End-to-End Architecture & Workflow

### 3.1 Candidate Selection Algorithm
When an appointment is cancelled (and start time is in the future `startAt > NOW()`):

1. **Date & Stylist Matching**:
   * Filter for appointments where:
     * `salonId == freedAppointment.salonId`
     * `appointmentDate == freedAppointment.appointmentDate`
     * `stylistId == freedAppointment.stylistId` (or any qualified stylist if salon settings allow)
     * `status == 'CONFIRMED'`
     * `startAt > freedAppointment.endAt` (appointment is scheduled later than the freed slot)
2. **Duration Fit Guard**:
   * `candidate.durationMinutes <= freedAppointment.durationMinutes` (candidate's service must fit completely inside the freed window).
3. **Rate Limiting & Spam Prevention**:
   * Broadcast to a maximum of **3 candidates**, sorted ascending by `startAt` (earliest candidates get first priority).
   * Candidate must not have been sent a move-up message in the last 60 minutes.

### 3.2 WhatsApp Interactive Message Template
```text
⚡ *EARLY SLOT AVAILABLE TODAY!*

Hi *{{customerName}}*, a *{{freedSlotTime}}* slot just freed up today with *{{stylistName}}*!

Would you like to move your *{{currentSlotTime}}* appointment earlier to *{{freedSlotTime}}*?

[⚡ Move to {{freedSlotTime}}]  [⏰ Keep My Time]
```

### 3.3 Concurrency & Race Condition Protection (First-Come, First-Served)
Because up to 3 customers receive the alert:
1. Customer A clicks `[⚡ Move to 2:30 PM]`.
2. Backend acquires an atomic Redis lock: `lock:slot:${freedSlotId}`.
3. Backend checks if the freed slot is still unoccupied.
4. If available:
   * Candidate A's `startAt` and `endAt` are shifted to the freed time.
   * Redis reminders schedule is refreshed.
   * SSE event `STATUS_UPDATED` and `QUEUE_MUTATED` are emitted to Reception Dashboard.
   * Bot sends Customer A: *"✅ Great! Your appointment has been moved earlier to 2:30 PM today."*
5. If Customer B clicks 5 minutes later:
   * Lock acquired $\rightarrow$ Slot is already taken.
   * Bot sends Customer B: *"⚡ Sorry! That early slot was just claimed by another customer. Your original appointment at 5:30 PM remains confirmed."*

---

## 4. Implementation Roadmap (Step-by-Step)

### Phase 1: Database Schema (`prisma/schema.prisma`)
Add configuration toggle to the `Salon` model:
```prisma
model Salon {
  // ... existing fields
  isSmartMoveUpEnabled Boolean @default(true) @map("is_smart_move_up_enabled")
  smartMoveUpMaxOffers Int     @default(3)    @map("smart_move_up_max_offers")
}
```
Run `npx prisma migrate dev --name add_smart_move_up_to_salon`.

### Phase 2: Service Layer & Atomic Shift Method
In `cancellation.service.ts` or a dedicated `move-up.service.ts`:
```typescript
async applyMoveUpShift(candidateApptId: string, freedSlotId: string): Promise<MoveUpResult> {
  // 1. Fetch candidate and target slot boundary
  // 2. Atomic transaction to ensure slot not re-booked
  // 3. Shift startAt / endAt
  // 4. Update operational scheduler columns (nextActionAt, nextActionType)
  // 5. Broadcast SSE event to live queue
}
```

### Phase 3: WhatsApp Action Handler Integration
In `whatsapp-action-handler.service.ts`:
```typescript
if (input.startsWith('move_up_accept_')) {
  return this.appointmentAction.handleMoveUpAccept(ctx);
}
if (input.startsWith('move_up_decline_')) {
  return this.appointmentAction.handleMoveUpDecline(ctx);
}
```

In `appointment.action.ts`:
* Parse `candidateId` and `freedSlotId`.
* Invoke `applyMoveUpShift`.
* Reply with interactive confirmation message.

### Phase 4: Reception Dashboard Settings Toggle
In `apps/web/js/modules/salon-settings/` or Salon Profile:
* Add toggle switch: **"Smart Move-Up: Auto-fill cancelled slots via WhatsApp"**
* Enables or disables `salon.isSmartMoveUpEnabled`.

---

## 5. Summary Checklist for Future Implementation

- [ ] Add `is_smart_move_up_enabled` column to `Salon` table in `schema.prisma`.
- [ ] Connect `triggerSmartMoveUpBroadcast` in `cancellation.service.ts` without dead checks.
- [ ] Implement `handleMoveUpAccept` in `appointment.action.ts`.
- [ ] Implement `handleMoveUpDecline` in `appointment.action.ts`.
- [ ] Add Redis/Database concurrency guard so multiple candidates cannot double-book.
- [ ] Trigger real-time queue SSE update when an appointment shifts earlier.
- [ ] Add unit & integration tests in `scripts/test-smart-move-up.ts`.
