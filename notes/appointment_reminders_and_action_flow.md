# Complete Appointment Reminders & Action Flow Guide

A unified, human-readable specification and technical architecture for appointment reminders, automated cutoffs, and lifecycle actions in the Salon SaaS platform across all booking types.

---

## 1. Executive Summary: The Business Rules

The goal of this system is simple: **Zero empty chairs for salons, zero spam for customers, and 100% automated reliability.**

The platform categorizes every appointment into **3 distinct booking scenarios** based on remaining lead time when the booking is created:

1. **Advance Bookings (Lead Time > 2 Hours)**:
   * Gets the 2-Hour WhatsApp confirmation message ($T - 2\text{h}$).
   * Has the 60-Minute ghost cutoff ($T - 60\text{m}$).
   * Gets the 15-Minute arrival alert ($T - 15\text{m}$).
   * Has the 10-Minute response cutoff ($T - 5\text{m}$).
   * Auto-completes at service end (`endAt`).
2. **Same-Day Bookings with Less Than 2 Hours (15m to 120m Lead Time)**:
   * **Bypasses** the 2-Hour reminder and 60-Minute cutoff completely (starts directly as `CONFIRMED`).
   * **The very first scheduled action is set directly to the 15-Minute Arrival Alert** at $T - 15\text{m}$.
   * Has the 10-Minute response cutoff ($T - 5\text{m}$).
   * Auto-completes at service end (`endAt`).
3. **Quick Bookings (Express Walk-in / Under 15 Minutes Lead Time)**:
   * Starts as `PENDING_ACCEPTANCE`.
   * **ZERO advance reminders are sent** during the visit (no 2h, no 60m, no 15m).
   * **The ONLY automated action in its entire lifecycle is `AUTO_COMPLETE`** when service finishes at `endAt`!

---

## 2. Database & Redis Architecture (Dual-Layer Engine)

Instead of running heavy 60-second table scans across multiple queries, the system uses a dual-layer architecture:

### A. The PostgreSQL Persistent State of Truth
```prisma
nextActionAt     DateTime?         @map("next_action_at") @db.Timestamptz
nextActionType   String?           @map("next_action_type")
@@index([nextActionAt])
```

* **`nextActionAt`**: The exact timestamp when the system must wake up and execute the next action for this booking.
* **`nextActionType`**: Which action to perform (`REMINDER_2H`, `CUTOFF_60M`, `ARRIVAL_15M`, `CUTOFF_10M`, `AUTO_COMPLETE`, `PROPOSAL_EXPIRY`).
* **Database Index**: Fast indexed lookup (`WHERE next_action_at <= NOW()`) running in $< 1\text{ms}$. Only active appointments with a pending alarm are touched.

### B. Redis In-Memory Scheduling
* **Active Queue**: Redis sorted set (`reminders:schedule`) holds `(timestamp, appointmentId)` for sub-millisecond timer triggering.
* **Self-Healing Sync**: If Redis is flushed or restarts, it instantly repopulates in milliseconds from PostgreSQL:
  ```sql
  SELECT id, next_action_at, next_action_type 
  FROM appointments 
  WHERE next_action_at IS NOT NULL;
  ```

### C. The Permanent Audit & History Columns
* `reminder2hSentAt` (`DateTime?`): Timestamp when the 2-hour reminder was delivered.
* `reminder10mSentAt` (`DateTime?`): Timestamp when the 15-minute arrival alert was delivered.
* `clientEtaStatus` (`ClientEtaStatus?`): Customer status (`ON_THE_WAY`, `ARRIVED`).
* `expiresAt` (`DateTime?`): Expiry deadline if a reschedule proposal is pending.
* `cancelledAt`, `cancelledBy`, `cancellationReason`: Audit history for cancellations.

---

## 3. The 6 Automated Action Types

| Action Type | Scheduled At | What the System Does | Customer / Salon Impact |
| :--- | :--- | :--- | :--- |
| **`REMINDER_2H`** | `startAt - 2 hours` | Sends WhatsApp confirmation prompt | Customer given 60 mins to confirm. Sets next action to `CUTOFF_60M`. |
| **`CUTOFF_60M`** | `startAt - 60 mins` | Checks if customer confirmed | If unconfirmed: **Auto-cancel (+1 strike)** & free chair immediately for walk-ins. |
| **`ARRIVAL_15M`** | `startAt - 15 mins` | Sends WhatsApp arrival check | Buttons: `[On My Way]` / `[I'm Here]`. Sets next action to `CUTOFF_10M`. |
| **`CUTOFF_10M`** | `startAt - 5 mins` | Checks if customer responded | If no response: **Auto-cancel (+1 strike)**. Front desk seats walk-in. *(No 2nd message sent)*. |
| **`AUTO_COMPLETE`** | `endAt` | Service concludes | Marks status `COMPLETED` if salon desk hasn't already closed it. |
| **`PROPOSAL_EXPIRY`**| `expiresAt` | Reschedule offer deadline | Auto-cancels unaccepted proposal (**0 penalty**, salon fault) & unlocks chair. |

---

## 4. The 3 Complete Real-World Lifecycle Flows

---

### Flow 1: Advance Booking (Lead Time > 2 Hours)
*Example: **Sarah** books tomorrow at 3:00 PM – 3:45 PM with John.*

```text
 1:00 PM (T - 2h)              2:00 PM (T - 60m)             2:45 PM (T - 15m)           2:55 PM (T - 5m)            3:00 PM          3:45 PM (endAt)
       │                              │                             │                           │                       │                │
       ▼                              ▼                             ▼                           ▼                       ▼                ▼
[2-Hour Reminder]               [60-Min Cutoff]               [15-Min Alert]              [10-Min Cutoff]          [Service Starts] [Service Ends]
WhatsApp Prompt Sent            Unconfirmed?                  WhatsApp Prompt Sent        No Response?             John begins cut  Auto-Completed
"Please confirm visit"          Auto-Cancel (+1 strike)       "Are you on the way?"       Auto-Cancel (+1 strike)  Sarah in chair   Bill closed
                                Or Confirmed? Continue.                                   Or Responded? Continue.
```

#### Step 1: Sarah Books for Tomorrow at 3:00 PM
* **Status**: `BOOKED`.
* **John's Chair**: Reserved for Sarah.
* **Next Action**:
  * `nextActionType` = `REMINDER_2H`
  * `nextActionAt` = **1:00 PM** (`startAt - 2h`)

#### Step 2: 1:00 PM arrives (`REMINDER_2H`)
* Sarah receives WhatsApp confirmation prompt:
  > *"Hi Sarah! You have a Haircut booked today at 3:00 PM with John. Please confirm your visit:"*  
  > **[✅ Confirm Appointment]**  
  > **[📅 Reschedule / Cancel]**
* Records `reminder2hSentAt = 1:00 PM`.
* Arms the 60-minute cutoff:
  * `nextActionType` = `CUTOFF_60M`
  * `nextActionAt` = **2:00 PM** (`startAt - 60m`)

#### Step 3: Between 1:00 PM and 2:00 PM
* **Path A (Sarah taps [Confirm])**:
  * Status ➔ `CONFIRMED`. Cutoff cancelled.
  * Next action set: `nextActionType = ARRIVAL_15M` at **2:45 PM** (`startAt - 15m`).
* **Path B (Sarah ghosts until 2:00 PM)**:
  * `CUTOFF_60M` triggers at 2:00 PM.
  * Status ➔ `CANCELLED`. Fault: `CLIENT` (+1 penalty strike).
  * **John's chair is freed immediately** for walk-ins. Next action = `NULL`.

#### Step 4: 2:45 PM arrives (`ARRIVAL_15M`)
*(For confirmed clients)*
* Sarah receives arrival check WhatsApp:
  > *"Hi Sarah! Your haircut with John starts in 15 minutes. Please let us know your status:"*  
  > **[🚗 On My Way]**  
  > **[📍 I'm Here / Checked In]**
* Records `reminder10mSentAt = 2:45 PM`.
* Arms the 10-minute response cutoff:
  * `nextActionType` = `CUTOFF_10M`
  * `nextActionAt` = **2:55 PM** (10 mins after message, 5 mins before start).
* **Crucial Rule**: **No second reminder message is sent.**

#### Step 5: Between 2:45 PM and 2:55 PM
* **Path A (Sarah taps [On My Way] or [I'm Here])**:
  * John's tablet rings: *"Sarah is on her way!"*
  * Front desk / stylist handles her arrival.
  * Cutoff cancelled! Booking is **NOT cancelled**.
  * Next action set: `nextActionType = AUTO_COMPLETE` at **3:45 PM** (`endAt`).
* **Path B (Sarah ignores message by 2:55 PM)**:
  * `CUTOFF_10M` triggers at 2:55 PM ($T - 5\text{m}$).
  * Status ➔ `CANCELLED`. Fault: `CLIENT` (+1 strike as No-Show).
  * **Chair released 5 minutes before start for walk-in clients.** Next action = `NULL`.

#### Step 6: 3:45 PM arrives (`AUTO_COMPLETE`)
* If front desk hasn't already closed the bill, system marks status ➔ `COMPLETED`.
* Next action = `NULL`.

---

### Flow 2: Same-Day Booking with Remaining Time < 2 Hours (15m to 120m Lead Time)
*Example: **Michael** books today at **1:30 PM** for **3:00 PM** (90 mins lead time), or at **2:15 PM** for **3:00 PM** (45 mins lead time).*

```text
 1:30 PM (Booking Made)                                      2:45 PM (T - 15m)           2:55 PM (T - 5m)            3:00 PM          3:45 PM (endAt)
       │                                                            │                           │                       │                │
       ▼                                                            ▼                           ▼                       ▼                ▼
[Booking Confirmed Instantly]                                 [15-Min Alert]              [10-Min Cutoff]          [Service Starts] [Service Ends]
• Status = CONFIRMED                                          WhatsApp Prompt Sent        No Response?             Stylist starts   Auto-Completed
• 2h Reminder & 60m Cutoff BYPASSED                           "Are you on the way?"       Auto-Cancel (+1 strike)  Michael seated   Bill closed
• Next Action set directly to 15m Alert!                                                  Or Responded? Continue.
```

#### Step 1: Michael Books at 1:30 PM for 3:00 PM
* **Lead time is less than 2 hours**: The $T - 2\text{h}$ mark (1:00 PM) has already passed.
* Because Michael literally just booked right now, he is already confirming his visit!
* **Status starts directly as `CONFIRMED`**.
* **The 2-Hour Reminder and 60-Minute Cutoff are completely bypassed.**
* **Next Action is set directly to the 15-Minute Alert**:
  * `nextActionType` = `ARRIVAL_15M`
  * `nextActionAt` = **2:45 PM** (`startAt - 15m`)

#### Step 2: 2:45 PM arrives (`ARRIVAL_15M`)
* Michael receives WhatsApp arrival check:
  > *"Hi Michael! Your appointment starts in 15 minutes: [🚗 On My Way] [📍 I'm Here]"*
* Records `reminder10mSentAt = 2:45 PM`.
* Arms the 10-minute response cutoff:
  * `nextActionType` = `CUTOFF_10M`
  * `nextActionAt` = **2:55 PM** (5 mins before start).

#### Step 3: Between 2:45 PM and 2:55 PM
* **Path A (Michael taps [On My Way])**:
  * Stylist notified. Cutoff cancelled! Booking is **NOT cancelled**.
  * Salon handles his arrival.
  * Next action set: `nextActionType = AUTO_COMPLETE` at **3:45 PM** (`endAt`).
* **Path B (Michael ignores message by 2:55 PM)**:
  * Auto-cancelled as No-Show (+1 strike). Chair released for walk-ins. Next action = `NULL`.

#### Step 4: 3:45 PM arrives (`AUTO_COMPLETE`)
* Attended visit automatically marked `COMPLETED`.

---

### Flow 3: Quick Booking (Express Walk-in / Under 15 Minutes Lead Time)
*Example: **Alex** is standing near the salon and requests an immediate walk-in slot at **2:50 PM** for **3:00 PM** (10 mins lead time).*

```text
 2:50 PM (Quick Request)              2:52 PM (Desk Accepts)                                                         3:00 PM          3:45 PM (endAt)
       │                                     │                                                                      │                │
       ▼                                     ▼                                                                      ▼                ▼
[Pending Quick Booking]               [Desk Accepts Request]                                                 [Service Starts] [Service Ends]
• Status = PENDING_ACCEPTANCE         • Status = CONFIRMED                                                   Alex in chair    [AUTO_COMPLETE]
• ZERO advance reminders sent!        • Customer notified instantly                                                           Status = COMPLETED
• Desk tablet rings loudly            • ONLY automated action = AUTO_COMPLETE!                                                (Only reminder)
```

#### Step 1: Alex Submits Quick Booking at 2:50 PM
* **Status**: `PENDING_ACCEPTANCE` (`bookingType: QUICK`).
* **ZERO Advance Reminders**: Both 2 hours and 15 minutes before have already passed. No reminder messages are scheduled or sent.
* **Customer WhatsApp**:
  > *"⏳ Quick Booking Request Sent! The salon desk is reviewing your request right now."*
* **Salon Desk Tablet**: Rings with a loud walk-in alert.

#### Step 2: Salon Desk Response
* **Case A: Desk Accepts (e.g. at 2:52 PM)**:
  * Status ➔ `CONFIRMED`.
  * Alex receives WhatsApp: *"🎉 Quick Booking Accepted! Your chair is ready. [🚗 On My Way] [📍 I'm Here]"*.
  * **The ONLY automated reminder action in the entire lifecycle is `AUTO_COMPLETE`**:
    * `nextActionType` = `AUTO_COMPLETE`
    * `nextActionAt` = **3:45 PM** (`endAt`)
* **Case B: Desk Declines**:
  * Status ➔ `REJECTED`. Alex notified (0 penalty). Slot released. Next action = `NULL`.
* **Case C: Desk Never Responds (3:00 PM arrives)**:
  * When appointment start time passes (`startAt < NOW()`), the background sweeper automatically declines the request:
    * Status ➔ `CANCELLED` (`SYSTEM_AUTO_EXPIRED`).
    * **Zero penalty (0 strikes)** applied to Alex.
    * WhatsApp notice: *"Quick booking request expired as start time arrived without desk confirmation."*
    * Next action = `NULL`.

#### Step 3: 3:45 PM arrives (`AUTO_COMPLETE`)
* If desk accepted and Alex attended: system automatically marks booking `COMPLETED`.
* Next action = `NULL`.

---

## 5. Dual-Purpose 60-Minute Cutoff: Customer vs Salon

The `CUTOFF_60M` rule protects the salon in both everyday bookings and reschedule conflicts:

```text
                                  ┌─────────────────────────────────────────────────────────────┐
                                  │                     60-Minute Cutoff                        │
                                  └──────────────────────────────┬──────────────────────────────┘
                                                                 │
                                ┌────────────────────────────────┴────────────────────────────────┐
                                ▼                                                                 ▼
               [Scenario 1: Normal Booking Ghost]                                [Scenario 2: Salon Reschedule Offer]
               Customer ignored 2-hour reminder message                          Salon offered new time; customer didn't answer
               ────────────────────────────────────────                          ──────────────────────────────────────────────
               • Action: Auto-Cancel booking                                     • Action: Auto-Cancel reschedule proposal
               • Fault: CLIENT (+1 penalty strike)                               • Fault: SALON (0 strikes - customer is blameless)
               • Chair: John's chair freed for walk-ins                          • Chair: Proposed slot unlocked for others
```

---

## 6. Master Comparison Matrix Across All 3 Booking Types

| Booking Scenario | Lead Time | Initial Status | 2h Reminder ($T - 2\text{h}$)? | 60m Cutoff ($T - 60\text{m}$)? | 15m Arrival Alert ($T - 15\text{m}$)? | 10m Response Cutoff ($T - 5\text{m}$)? | Service End (`endAt`) | First Scheduled Alarm |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Advance Booking** | $> 120\text{ mins}$ | `BOOKED` | **YES** (WhatsApp prompt) | **YES** (+1 strike if ghost) | **YES** (WhatsApp prompt) | **YES** (+1 strike if ghost) | `AUTO_COMPLETE` | `REMINDER_2H` at $T - 2\text{h}$ |
| **2. Same-Day Booking** | $15\text{m} - 120\text{m}$ | `CONFIRMED` | **SKIPPED** | **SKIPPED** | **YES** (WhatsApp prompt) | **YES** (+1 strike if ghost) | `AUTO_COMPLETE` | `ARRIVAL_15M` at $T - 15\text{m}$ |
| **3. Quick Booking** | $< 15\text{ mins}$ | `PENDING_ACCEPTANCE` | **SKIPPED** | **SKIPPED** | **SKIPPED** (Desk pings) | **SKIPPED** | `AUTO_COMPLETE` | Desk accept $\rightarrow$ `AUTO_COMPLETE` at `endAt` |

---

## 7. Edge Cases, Exception Handling & Recovery Architecture

### 7.1 Early Arrival Check-In (Customer Arrives Before $T - 15\text{m}$)
* **The Situation**: Customer arrives at 2:30 PM for a 3:00 PM appointment and front desk checks them in (`status: CHECKED_IN`).
* **The Rule**: **Suppress the 15-Minute Alert!**
* **System Action**: When status transitions to `CHECKED_IN` or `SEATED_IN_CHAIR`:
  * Cancel `ARRIVAL_15M` immediately.
  * Jump `nextActionType` directly to `AUTO_COMPLETE` at `endAt` (3:45 PM).
  * The customer is never bothered with an arrival alert while already sitting in the salon.

### 7.2 Arrival Check Response (No "Running Late" Button)
* **The Rule**: The 15-minute alert only presents two options: **`[🚗 On My Way]`** and **`[📍 I'm Here]`**. There is no separate "running late" button.
* **System Action**:
  * When the customer taps **`[On My Way]`**, the salon desk/stylist is alerted that the client is en route.
  * The salon handles their arrival workflow.
  * The 10-minute auto-cancel cutoff (`CUTOFF_10M`) is **disarmed and cancelled**.
  * The booking is **NOT cancelled**.
  * The next action is set to `AUTO_COMPLETE` at `endAt`.

### 7.3 Smart Lifecycle Status Changes & Alarm Wiping
* **The Rule**: Whenever ANY appointment status change occurs (customer cancel, salon admin cancel, check-in, completion), the system smartly synchronizes the scheduler.
* **On Any Cancellation**:
  ```typescript
  nextActionAt = null;
  nextActionType = null;
  ```
  This immediately removes the alarm from both Redis and PostgreSQL, ensuring **zero ghost reminders** can ever fire after a cancellation.

### 7.4 Reschedule Alarm Overwrite
* **The Rule**: When an appointment is rescheduled to a new date/time:
* **System Action**:
  * The old alarm is overwritten in the same database transaction:
    * If new lead time $> 2\text{ hours}$: `nextActionAt = newStartAt - 2h`, `nextActionType = REMINDER_2H`.
    * If new lead time $< 2\text{ hours}$: `nextActionAt = newStartAt - 15m`, `nextActionType = ARRIVAL_15M`.
  * The old alarm is cleanly purged from Redis and database.

### 7.5 Free-Text Keyword Normalization
* **The Rule**: If a customer types natural language instead of tapping buttons:
  * `"yes"`, `"confirm"`, `"ok"` $\rightarrow$ triggers `REMIND_CONFIRM`.
  * `"on my way"`, `"coming"`, `"on the way"` $\rightarrow$ triggers `ETA_ON_THE_WAY`.
  * `"cancel"`, `"stop"` $\rightarrow$ routes to cancellation confirmation.
* Non-button users are never mistakenly penalized.

### 7.6 Tapping [Confirm] After the 60-Minute Cutoff
* **The Situation**: A customer attempts to confirm at 2:03 PM, after the 2:00 PM cutoff has already auto-cancelled the booking and released the slot.
* **System Action**:
  * System detects status is `CANCELLED`.
  * **Rejects the action** and does NOT resurrect the appointment (the chair may already belong to a walk-in).
  * Sends a polite explanatory notice:
    > *"⚠️ Your appointment was automatically cancelled 1 hour prior to your slot because confirmation was not received. That slot was released. Would you like to book a fresh visit?"*

### 7.7 Server Downtime / Outage Recovery & Stale Catch-Up
* **The Situation**: The backend server crashes or is turned off for maintenance, and boots back up later.
* **The Rule**:
  1. **Unconfirmed Appointments Past Start Time**: If an appointment was in `BOOKED` or `PENDING_ACCEPTANCE`, and while the server was down the start time already passed (`startAt <= NOW()`):
     * **Immediately mark the booking `CANCELLED` (`SYSTEM_AUTO_CUTOFF` / `SYSTEM_AUTO_EXPIRED`)!**
     * **Do NOT send stale, expired reminders** for an appointment that was supposed to take place in the past.
  2. **Attended Appointments Past Finish Time**: If an appointment was `CHECKED_IN`, `ON_THE_WAY`, or `SEATED_IN_CHAIR`, and `endAt <= NOW()`:
     * Mark `COMPLETED` (`AUTO_COMPLETE`).
  3. **Future Active Appointments**: Any appointment where `nextActionAt > NOW()` is re-synced into Redis to continue normal countdown.

---

## 8. Why This Design is 100% Reliable

1. **Zero Message Floods**: Every appointment has at most **one active alarm** in `nextActionAt`. Ghost reminders cannot trigger after cancellations.
2. **Zero Polling Waste**: Instead of scanning thousands of rows every minute, the backend executes:
   ```sql
   SELECT * FROM appointments 
   WHERE next_action_at IS NOT NULL AND next_action_at <= NOW();
   ```
   Thanks to `@@index([nextActionAt])`, this query executes in under 1 millisecond.
3. **Crash & Reboot Resilient**: If the server restarts or pauses, it recovers cleanly: stale past bookings are auto-cancelled without spam, attended visits are completed, and future alarms resume smoothly.
