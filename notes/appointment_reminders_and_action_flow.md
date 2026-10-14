# Appointment Table & Full Reminder Lifecycle Flow

This document details the exact database fields required in the `appointments` table and explains the complete, step-by-step lifecycle of reminders and automated actions.

---

## 1. What Needs to be in the `appointments` Table?

To handle all reminders and auto-actions cleanly without needing extra tables or risking orphaned ghost messages, the `appointments` table uses **two operational columns** alongside its permanent history timestamps:

### A. The 2 Active Scheduler Columns
```prisma
nextActionAt     DateTime?         @map("next_action_at") @db.Timestamptz
nextActionType   String?           @map("next_action_type") // e.g. REMINDER_2H, CUTOFF_60M, ARRIVAL_15M, CUTOFF_5M, PROPOSAL_EXPIRY, AUTO_COMPLETE
```

* **`nextActionAt`**: The exact future timestamp when the system must wake up and do something for this appointment.
* **`nextActionType`**: What action to perform when that timestamp arrives.
* **Database Index**: `@@index([nextActionAt])` ensures instant lookups in under 1 millisecond.

### B. The Audit / History Columns (Already present)
These columns keep a permanent record of what happened, so the system never repeats an action and salon owners have full visibility:
* `reminder2hSentAt` (`DateTime?`): Timestamp when the 2-hour reminder was delivered.
* `reminder10mSentAt` (`DateTime?`): Timestamp when the 15-minute arrival alert was delivered.
* `clientEtaStatus` (`ClientEtaStatus?`): Current customer response (`ON_THE_WAY`, `ARRIVED`, etc.).
* `expiresAt` (`DateTime?`): Expiry deadline if a reschedule proposal is pending.
* `cancelledAt`, `cancelledBy`, `cancellationReason`: Audit data for cancellations.

---

## 2. The 6 Action Types (`nextActionType`)

| Action Type | When It Fires | What It Does |
| :--- | :--- | :--- |
| `REMINDER_2H` | `startAt - 2 hours` | Sends WhatsApp: *"Your appointment is in 2 hours. Please confirm or reschedule."* |
| `CUTOFF_60M` | `startAt - 1 hour` | Auto-cancels unconfirmed booking (`CLIENT_UNRESPONSIVE`) & frees slot for walk-ins. |
| `ARRIVAL_15M` | `startAt - 15 minutes` | Sends friendly WhatsApp: *"Your appointment is in 15 mins. Are you on the way?"* |
| `PROPOSAL_EXPIRY`| Cutoff deadline | Auto-cancels unanswered reschedule proposal with 0 penalty, freeing proposed slot. |
| `AUTO_COMPLETE` | `endAt` | Automatically marks attended appointment as `COMPLETED`. |

> **Note on Short-Notice Bookings (< 15 Minutes):**  
> Any appointment created with less than 15 minutes lead time is handled by the **Quick Booking Engine** (`bookingType: QUICK`, `status: PENDING_ACCEPTANCE`). It skips advance reminders and requires express salon desk acceptance.

---

## 3. Full Step-by-Step Lifecycle (Real-World Timeline Example)

Let's follow a real booking made for **Tomorrow at 3:00 PM - 3:45 PM**:

### Step 1: Customer Books Tomorrow at 3:00 PM (Lead time > 2 hours)
* **Status**: `BOOKED`
* **Table set to**:
  * `nextActionType` = `'REMINDER_2H'`
  * `nextActionAt` = **Tomorrow 1:00 PM** (`startAt - 2 hours`)
* **Redis**: Booking ID added with timestamp `Tomorrow 1:00 PM`.

---

### Step 2: Tomorrow at 1:00 PM arrives (`REMINDER_2H`)
* **Trigger**: Redis wakes worker at 1:00 PM.
* **Worker Action**:
  1. Sends interactive WhatsApp message:
     > *"Hi Sarah! You have a Haircut booked at 3:00 PM with John. Please confirm your visit:"*  
     > **[Confirm Appointment]**  
     > **[Reschedule / Cancel]**
  2. Updates `appointments` table:
     * `reminder2hSentAt = 1:00 PM`
     * `nextActionType` = `'CUTOFF_60M'` (now waiting for response!)
     * `nextActionAt` = **Tomorrow 2:00 PM** (`startAt - 1 hour`)
  3. Updates Redis with the new 2:00 PM alarm.

---

### Step 3: The Fork in the Road (Customer Response vs Ghost)

#### Path A: Customer Taps [Confirm Appointment] at 1:15 PM
* **Status**: Updates from `BOOKED` ➔ `CONFIRMED`.
* **WhatsApp**: Sends confirmation receipt with Google Maps directions.
* **Scheduler Advancement**:
  * The 2:00 PM cutoff is **immediately discarded**.
  * `nextActionType` = `'ARRIVAL_15M'`
  * `nextActionAt` = **Tomorrow 2:45 PM** (`startAt - 15 minutes`)
* **Redis**: Alarm updated to 2:45 PM.

#### Path B: Customer Ghosts (Never responds by 2:00 PM)
* **Trigger**: 2:00 PM arrives (`CUTOFF_60M`).
* **Worker Action**:
  1. Detects customer never confirmed.
  2. Calls `cancelBooking()`:
     * Status ➔ `CANCELLED`
     * Fault: `CLIENT` (+1 penalty strike)
     * Reason: `GHOSTED_2H_REMINDER`
  3. **Slot Freed**: John's 3:00 PM chair is released immediately so walk-ins can take it.
  4. WhatsApp sent: *"Your unconfirmed appointment was cancelled to release the slot."*
  5. `nextActionAt` = `NULL` (Booking lifecycle ends).

---

### Step 4: Tomorrow at 2:45 PM arrives (`ARRIVAL_15M`)
*(Only reached by confirmed appointments from Path A)*

* **Trigger**: Redis wakes worker at 2:45 PM.
* **Worker Action**:
  1. Sends friendly arrival alert on WhatsApp:
     > *"Hi Sarah, your service starts in 15 minutes! Please let us know your status:"*  
     > **[On My Way]**  
     > **[I'm Here / Checked In]**
  2. Updates `appointments` table:
     * `reminder10mSentAt = 2:45 PM`
     * `nextActionType` = `'AUTO_COMPLETE'`
     * `nextActionAt` = **Tomorrow 3:45 PM** (`endAt`)
  3. Updates Redis alarm to 3:45 PM.
  *(Customer is NOT auto-cancelled if they don't tap—they already confirmed and may be driving/parking).*

---

### Step 5: Service Finishes at 3:45 PM (`AUTO_COMPLETE`)
* **Trigger**: 3:45 PM arrives (`endAt`).
* **Worker Action**:
  * If client checked in and service concluded: Status ➔ `COMPLETED`.
  * `nextActionAt` = `NULL`.
  * WhatsApp optional: Sends thank-you message / Google Review link.

---

## 4. What Happens During a Reschedule? (`PROPOSAL_EXPIRY`)

If a salon conflict occurs (e.g., stylist leave or admin changes the time):

1. **Admin sends Reschedule Proposal** (e.g., for Friday at 11:00 AM).
2. **Old Slot**: Freed immediately.
3. **Proposed Slot**: Temporarily locked.
4. **Status**: Changes to `PENDING_RESCHEDULE`.
5. **Scheduler set to**:
   * `nextActionType` = `'PROPOSAL_EXPIRY'`
   * `nextActionAt` = Friday 10:00 AM (1 hour before proposed time, or 2 hours after creation).
6. **Outcomes**:
   * **If Customer Taps [Accept]**:
     * Status ➔ `CONFIRMED`.
     * New slot becomes official.
     * `nextActionType` ➔ `'ARRIVAL_15M'` at Friday 10:45 AM.
   * **If Customer Taps [Decline]**:
     * Status ➔ `CANCELLED` (0 penalty).
     * Proposed slot unlocked immediately.
     * `nextActionAt` = `NULL`.
   * **If Customer Does Not Respond (Friday 10:00 AM arrives)**:
     * System auto-cancels proposal (0 penalty, `fault: SALON`).
     * Proposed slot unlocked immediately.
     * WhatsApp notice sent: *"Reschedule proposal expired."*
     * `nextActionAt` = `NULL`.

---

## 5. Why This Design is 100% Reliable

1. **Zero Duplicate or Ghost Messages**: Because there is only **one** `nextActionAt` per appointment, it is physically impossible for an old reminder to trigger after a cancellation or reschedule.
2. **Self-Healing on Server Restart**: If the server crashes or restarts, it simply runs:
   ```sql
   SELECT id, next_action_at FROM appointments WHERE next_action_at IS NOT NULL;
   ```
   and repopulates Redis in milliseconds.
3. **Blazing Fast**: The worker only queries appointments where `next_action_at <= NOW()` using an indexed timestamp lookup. No heavy 60-second table scans.
