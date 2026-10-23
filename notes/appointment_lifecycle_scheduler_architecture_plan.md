# Production Architecture & Implementation Plan: Appointment Lifecycle & Redis Scheduler

**Author:** Principal Architect / Super Senior Backend Engineer  
**Scope:** Automated Reminders, Cutoffs, WhatsApp Action Hooks, Redis Sorted-Set Queue, and Database State Synchronization  
**Related Specification:** [`notes/appointment_reminders_and_action_flow.md`](file:///Users/trilokshivhare/Documents/Development/sall/salon/notes/appointment_reminders_and_action_flow.md)

---

## 1. Architectural Vision & Core Invariant

The fundamental architectural principle of this system is:

> **Every appointment state mutation is an atomic event that MUST synchronously re-evaluate, synchronize, or purge its scheduled alarm in both PostgreSQL and Redis.**

```text
                                  ┌────────────────────────┐
                                  │   LIFECYCLE EVENT      │
                                  │ (Customer / Staff /    │
                                  │  Cutoff / System)      │
                                  └───────────┬────────────┘
                                              │
                                              ▼
                        ┌───────────────────────────────────────────┐
                        │   AppointmentLifecycleSchedulerService    │
                        │   (Central State-Action Resolver)         │
                        └─────────────┬───────────────┬─────────────┘
                                      │               │
                 ┌────────────────────┴───┐       ┌───┴────────────────────┐
                 ▼                        │       │                        ▼
      [PostgreSQL Database]               │       │             [Redis Sorted Set]
      • status updated                    │       │             • ZREM old_timer
      • next_action_at written            │       │             • ZADD new_timer
      • next_action_type written          │       │             (In-Memory sub-ms alarm)
      (Persistent Truth & History)        │       │
                                          ▼       ▼
                            ┌───────────────────────────┐
                            │ AppointmentDispatchWorker │
                            │ (Pops & Executes Actions) │
                            └───────────────────────────┘
```

---

## 2. All 11 Action Touchpoints (Complete Matrix)

Every single place in the codebase where an appointment is touched, created, updated, or cancelled must route its schedule mutation through our centralized scheduler:

| # | Touchpoint Event | Trigger Source | Database State Mutation | Scheduler Mutation (`nextActionType` & `nextActionAt`) | Redis Operation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **Booking Created (> 120m)** | `appointment-creation.service.ts` | `status = BOOKED` | `REMINDER_2H` at `startAt - 2h` | `ZADD reminders:schedule <startAt-2h> <id>:REMINDER_2H` |
| **2** | **Booking Created (15m–120m)** | `appointment-creation.service.ts` | `status = CONFIRMED` | `ARRIVAL_15M` at `startAt - 15m` | `ZADD reminders:schedule <startAt-15m> <id>:ARRIVAL_15M` |
| **3** | **Quick Booking Created (< 15m)** | `appointment-creation.service.ts` | `status = PENDING_ACCEPTANCE` | `AUTO_DECLINE_QUICK` at `startAt` | `ZADD reminders:schedule <startAt> <id>:AUTO_DECLINE_QUICK` |
| **4** | **Customer Taps [Confirm]** | `checkin.action.ts` (`REMIND_CONFIRM`) | `status = CONFIRMED` | `ARRIVAL_15M` at `startAt - 15m` | `ZREM <id>:CUTOFF_60M` + `ZADD <startAt-15m> <id>:ARRIVAL_15M` |
| **5** | **Customer Taps [On My Way]** | `checkin.action.ts` (`ETA_ON_THE_WAY`) | `clientEtaStatus = ON_THE_WAY` | `AUTO_COMPLETE` at `endAt` *(Cutoff disarmed)* | `ZREM <id>:CUTOFF_10M` + `ZADD <endAt> <id>:AUTO_COMPLETE` |
| **6** | **Early Check-In ($< T - 15\text{m}$)** | `appointment-status.service.ts` / WhatsApp | `status = CHECKED_IN` | `AUTO_COMPLETE` at `endAt` *(15m alert suppressed)* | `ZREM <id>:ARRIVAL_15M` + `ZADD <endAt> <id>:AUTO_COMPLETE` |
| **7** | **Stylist Seats Client** | `appointment-status.service.ts` | `status = SEATED_IN_CHAIR` | `AUTO_COMPLETE` at `endAt` | `ZADD <endAt> <id>:AUTO_COMPLETE` |
| **8** | **Service Concluded** | Desk Checkout / `AUTO_COMPLETE` | `status = COMPLETED` | `nextActionAt = null`, `nextActionType = null` | `ZREM <id>:*` (Purged completely) |
| **9** | **Cancellation (Any Source)** | `cancellation.service.ts` (`cancelBooking`) | `status = CANCELLED` | `nextActionAt = null`, `nextActionType = null` | `ZREM <id>:*` (Purged completely) |
| **10**| **Reschedule Appointment** | `reschedule.service.ts` | New `startAt`, `endAt` | Recalculate alarm (`newStartAt - 2h` or `- 15m`) | `ZREM old_timer` + `ZADD new_timer` |
| **11**| **Reschedule Proposal Sent** | `reschedule.service.ts` | `status = PENDING_RESCHEDULE` | `PROPOSAL_EXPIRY` at `expiresAt` | `ZREM old_timer` + `ZADD <expiresAt> <id>:PROPOSAL_EXPIRY` |

---

## 3. Component Architecture & Code Organization

We organize the scheduler into **4 decoupled, single-responsibility modules**:

```text
backend/src/modules/salon-admin/appointments/scheduler/
├── appointment-scheduler.module.ts            # NestJS module definition & dependency provider
├── appointment-lifecycle-scheduler.service.ts # Central state-action resolver & DB sync
├── redis-schedule-store.service.ts            # Redis sorted set manager (ZADD, ZREM, atomic Lua pop)
├── appointment-dispatch.worker.ts             # Autonomous tick worker & action executors
└── dto/
    └── scheduler.types.ts                     # Action types, interfaces & payloads
```

---

## 4. Phase-by-Phase Implementation Plan

### Phase 1: Database Migration & Schema Foundations
* **File:** [`backend/prisma/schema.prisma`](file:///Users/trilokshivhare/Documents/Development/sall/salon/backend/prisma/schema.prisma)
* **Goal:** Add indexed scheduler columns to `Appointment`.
* **Changes:**
  ```prisma
  model Appointment {
    ...
    // Operational Single-Alarm Scheduler
    nextActionAt     DateTime?         @map("next_action_at") @db.Timestamptz
    nextActionType   String?           @map("next_action_type") // REMINDER_2H | CUTOFF_60M | ARRIVAL_15M | CUTOFF_10M | AUTO_COMPLETE | PROPOSAL_EXPIRY | AUTO_DECLINE_QUICK

    @@index([nextActionAt])
    ...
  }
  ```
* **Command:** `npx prisma migrate dev --name add_appointment_scheduler_columns`

---

### Phase 2: Redis Store Service (`redis-schedule-store.service.ts`)
* **Goal:** High-performance, atomic Redis sorted-set interface.
* **Key Redis Commands Implemented:**
  1. `setAlarm(appointmentId, actionType, timestampMs)`:
     ```typescript
     const member = `${appointmentId}:${actionType}`;
     await this.redis.zadd('reminders:schedule', timestampMs, member);
     ```
  2. `clearAlarm(appointmentId)`:
     Removes all matching members for this appointment using atomic pattern cleanup.
  3. `popDueAlarms(maxScoreMs, batchSize)`:
     **Atomic Claim via Lua Script** to eliminate race conditions across multi-worker instances:
     ```lua
     local due = redis.call('zrangebyscore', KEYS[1], '-inf', ARGV[1], 'LIMIT', 0, ARGV[2])
     if #due > 0 then
       redis.call('zrem', KEYS[1], unpack(due))
     end
     return due
     ```
  4. `repopulateFromDatabase(activeAlarms)`:
     Uses Redis pipelines (`redis.pipeline()`) to push thousands of active alarms in $< 30\text{ms}$.

---

### Phase 3: Centralized Scheduler Service (`appointment-lifecycle-scheduler.service.ts`)
* **Goal:** The **Single Source of Truth** for state-action resolution.
* **Public Interface:**
  ```typescript
  @Injectable()
  export class AppointmentLifecycleSchedulerService {
    // 1. Creation Hook
    async onBookingCreated(appointment: Appointment, tx?: PrismaClient): Promise<void>;

    // 2. WhatsApp Customer Confirmation Hook
    async onCustomerConfirmed(appointmentId: string, startAt: Date): Promise<void>;

    // 3. WhatsApp Customer "On My Way" Hook
    async onCustomerOnTheWay(appointmentId: string, endAt: Date): Promise<void>;

    // 4. In-Salon Check-In Hook (Early Arrival Suppression)
    async onCustomerCheckedIn(appointmentId: string, endAt: Date): Promise<void>;

    // 5. Cancellation Hook (Universal Purge)
    async onCancelled(appointmentId: string): Promise<void>;

    // 6. Reschedule Hook
    async onRescheduled(appointmentId: string, newStartAt: Date): Promise<void>;

    // 7. Reschedule Proposal Hook
    async onRescheduleProposalSent(appointmentId: string, expiresAt: Date): Promise<void>;
  }
  ```

---

### Phase 4: Hooking Into Existing Backend Endpoints

We wire the scheduler service into the 5 core application files:

1. **[`appointment-creation.service.ts`](file:///Users/trilokshivhare/Documents/Development/sall/salon/backend/src/modules/salon-admin/appointments/creation/appointment-creation.service.ts)**:
   In `createAppointment()`, right after `tx.appointment.create(...)`:
   `await this.scheduler.onBookingCreated(appointment);`
2. **[`checkin.action.ts`](file:///Users/trilokshivhare/Documents/Development/sall/salon/backend/src/modules/channels/whatsapp/actions/checkin.action.ts)**:
   - On `REMIND_CONFIRM`: `await this.scheduler.onCustomerConfirmed(apptId, appt.startAt);`
   - On `ETA_ON_THE_WAY`: `await this.scheduler.onCustomerOnTheWay(apptId, appt.endAt);`
   - On `ETA_ARRIVED`: `await this.scheduler.onCustomerCheckedIn(apptId, appt.endAt);`
3. **[`cancellation.service.ts`](file:///Users/trilokshivhare/Documents/Development/sall/salon/backend/src/modules/salon-admin/appointments/cancellation/cancellation.service.ts)**:
   In `cancelBooking()`, immediately after status update:
   `await this.scheduler.onCancelled(appointmentId);`
4. **[`reschedule.service.ts`](file:///Users/trilokshivhare/Documents/Development/sall/salon/backend/src/modules/salon-admin/appointments/reschedule/reschedule.service.ts)**:
   - On direct reschedule: `await this.scheduler.onRescheduled(appointmentId, newStartAt);`
   - On proposal sent: `await this.scheduler.onRescheduleProposalSent(appointmentId, expiresAt);`
5. **[`appointment-status.service.ts`](file:///Users/trilokshivhare/Documents/Development/sall/salon/backend/src/modules/salon-admin/appointments/status/appointment-status.service.ts)**:
   In `updateStatus()`:
   - If `CHECKED_IN` / `SEATED_IN_CHAIR`: `await this.scheduler.onCustomerCheckedIn(apptId, appt.endAt);`
   - If `COMPLETED`: `await this.scheduler.onCancelled(apptId);` (Purges alarm).

---

### Phase 5: Autonomous Dispatch Worker & Action Executors (`appointment-dispatch.worker.ts`)
* **Goal:** Replaces the existing polling loop in `RemindersService`.
* **Execution Flow (Runs every 10–30s or on timer trigger):**
  1. Calls `redisStore.popDueAlarms(nowMs, 50)`.
  2. For each due alarm (`appointmentId:actionType`):
     - Fetches appointment under fast lookup.
     - **Idempotency Guard:** Verifies appointment is not already `CANCELLED` or `COMPLETED`.
     - Executes dedicated handler:
       - **`REMINDER_2H`**: Sends WhatsApp 2h prompt $\rightarrow$ schedules `CUTOFF_60M` at `startAt - 60m`.
       - **`CUTOFF_60M`**: If unconfirmed $\rightarrow$ `cancelBooking(..., GHOSTED_2H_REMINDER, fault: CLIENT)`.
       - **`ARRIVAL_15M`**: Sends WhatsApp arrival alert $\rightarrow$ schedules `CUTOFF_10M` at `startAt - 5m`.
       - **`CUTOFF_10M`**: If `clientEtaStatus == null` $\rightarrow$ `cancelBooking(..., SYSTEM_AUTO_NOSHOW, fault: CLIENT)`. *(Chair freed for walk-ins)*.
       - **`AUTO_COMPLETE`**: Calls `autoCompleteElapsedAppointments()`.
       - **`PROPOSAL_EXPIRY`**: Calls `cancelBooking(..., UNRESPONSIVE_RESCHEDULE_PROPOSAL_EXPIRED_1H, fault: SALON)`.

---

### Phase 6: System Recovery & Outage Catch-Up Sweep
* **File:** In worker's `onModuleInit()`:
* **The Rules Executed on Server Boot:**
  1. **Purge Past Unconfirmed Bookings**:
     ```sql
     UPDATE appointments 
     SET status = 'CANCELLED', cancellation_reason = 'SERVER_RECOVERY_STALE_EXPIRED', next_action_at = NULL, next_action_type = NULL 
     WHERE status IN ('BOOKED', 'PENDING_ACCEPTANCE') AND start_at <= NOW();
     ```
  2. **Auto-Complete Past Attended Bookings**:
     ```sql
     UPDATE appointments 
     SET status = 'COMPLETED', next_action_at = NULL, next_action_type = NULL 
     WHERE status IN ('CHECKED_IN', 'ON_THE_WAY', 'SEATED_IN_CHAIR') AND end_at <= NOW();
     ```
  3. **Repopulate Redis for Future Bookings**:
     Reads all appointments with `next_action_at > NOW()` and repopulates Redis sorted set.

---

### Phase 7: Automated E2E Verification & Guardrails

We write a comprehensive, isolated test suite in [`scratch/e2e_scheduler_test.ts`](file:///Users/trilokshivhare/.gemini/antigravity-ide/brain/4bc2bf8a-25cb-48aa-bf14-df13ba2a9122/scratch/e2e_scheduler_test.ts) covering all 6 core test vectors:

1. **Advance Booking (>2h) Happy Path**:
   * Creates appointment 3 hours in advance.
   * Asserts `nextActionType === 'REMINDER_2H'`.
   * Simulates $T - 2\text{h}$ tick: asserts WhatsApp prompt sent, `CUTOFF_60M` armed.
   * Simulates customer confirm: asserts status `CONFIRMED`, `ARRIVAL_15M` armed for $T - 15\text{m}$.
   * Simulates $T - 15\text{m}$ tick: asserts arrival alert sent, `CUTOFF_10M` armed.
   * Simulates customer taps "On My Way": asserts `CUTOFF_10M` disarmed, `AUTO_COMPLETE` armed for `endAt`.
   * Simulates `endAt` tick: asserts status `COMPLETED`.
2. **60-Minute Cutoff Ghost Auto-Cancel**:
   * Creates appointment 3 hours in advance.
   * Simulates $T - 2\text{h}$ reminder sent.
   * Customer never responds $\rightarrow$ simulates clock advancing to $T - 60\text{m}$.
   * Asserts status transitions to `CANCELLED`, `penaltyApplied === true` (+1 strike), chair freed immediately.
3. **10-Minute Response Cutoff Ghost Auto-Cancel**:
   * Confirmed booking reaches $T - 15\text{m}$ arrival alert.
   * Customer ignores message $\rightarrow$ simulates clock advancing 10 minutes ($T - 5\text{m}$).
   * Asserts status transitions to `CANCELLED` (`SYSTEM_AUTO_NOSHOW`), +1 penalty strike, chair released for walk-ins.
4. **Same-Day Booking (<2h)**:
   * Creates booking with 45 minutes lead time.
   * Asserts status starts as `CONFIRMED` immediately.
   * Asserts 2-hour reminder and 60-minute cutoff are **completely bypassed**.
   * Asserts first alarm in DB and Redis is set directly to `ARRIVAL_15M` at $T - 15\text{m}$.
5. **Quick Booking (<15m)**:
   * Creates quick booking with 10 minutes lead time.
   * Asserts status is `PENDING_ACCEPTANCE`.
   * Asserts **zero advance reminders are sent**.
   * When accepted, asserts next alarm jumps directly to `AUTO_COMPLETE` at `endAt`.
6. **Early Check-In Suppression & Cancellation Wiping**:
   * Client arrives 30 mins early $\rightarrow$ receptionist checks them in.
   * Asserts 15-minute arrival alert is cancelled.
   * Client cancels $\rightarrow$ asserts `nextActionAt === null` and Redis sorted set entry is completely purged.

---

### Phase 8: Redis Dependencies & Infrastructure Module

To connect NestJS cleanly to Redis (which is already running locally on port 6379):

1. **Install Dependencies**:
   ```bash
   npm install ioredis
   npm install --save-dev @types/ioredis
   ```
2. **Environment Configuration**:
   Add to [`backend/.env`](file:///Users/trilokshivhare/Documents/Development/sall/salon/backend/.env):
   ```env
   REDIS_HOST="127.0.0.1"
   REDIS_PORT=6379
   REDIS_PASSWORD=""
   ```
3. **`RedisModule` Provider**:
   Provides an `@Inject('REDIS_CLIENT')` instance with auto-reconnect, exponential backoff, and graceful shutdown on NestJS lifecycle hooks (`onModuleDestroy`).

---

### Phase 9: Backfill Migration for Existing Appointments

To ensure zero downtime and prevent existing live appointments from being orphaned when deploying this new architecture:

1. **SQL Backfill Query**:
   Immediately after running the Prisma migration, run a one-time backfill script:
   ```sql
   -- 1. Advance unconfirmed bookings: set nextAction to 2h reminder
   UPDATE appointments 
   SET next_action_type = 'REMINDER_2H', 
       next_action_at = start_at - INTERVAL '2 hours'
   WHERE status = 'BOOKED' 
     AND start_at - INTERVAL '2 hours' > NOW() 
     AND reminder_2h_sent_at IS NULL;

   -- 2. Confirmed future bookings: set nextAction to 15m arrival alert
   UPDATE appointments 
   SET next_action_type = 'ARRIVAL_15M', 
       next_action_at = start_at - INTERVAL '15 minutes'
   WHERE status = 'CONFIRMED' 
     AND start_at - INTERVAL '15 minutes' > NOW() 
     AND reminder_10m_sent_at IS NULL;

   -- 3. In-service / Checked-in bookings: set nextAction to AUTO_COMPLETE
   UPDATE appointments 
   SET next_action_type = 'AUTO_COMPLETE', 
       next_action_at = end_at
   WHERE status IN ('CHECKED_IN', 'ON_THE_WAY', 'SEATED_IN_CHAIR') 
     AND end_at > NOW();
   ```
2. **Redis Warm-Up**:
   On server start, `repopulateFromDatabase()` automatically ingests all backfilled records into Redis.

---

### Phase 10: Step-by-Step Execution Sequence

Here is the exact sequential roadmap for executing this implementation:

```text
[Step 1] Install ioredis & create RedisModule / RedisScheduleStore
   │
[Step 2] Update schema.prisma & run Prisma Migration (add nextActionAt / nextActionType)
   │
[Step 3] Create AppointmentLifecycleSchedulerService (centralized DB + Redis logic)
   │
[Step 4] Wire lifecycle hooks into:
         • appointment-creation.service.ts (Lead time classification)
         • checkin.action.ts (Confirm & On The Way buttons)
         • cancellation.service.ts (Universal alarm wiping)
         • reschedule.service.ts (Alarm recalculation & proposal expiry)
         • appointment-status.service.ts (Early check-in suppression & complete)
   │
[Step 5] Refactor RemindersService / Dispatch Worker to use single indexed query + Redis pop
   │
[Step 6] Implement Server Boot Recovery Sweep in onModuleInit()
   │
[Step 7] Run SQL Backfill for existing database appointments
   │
[Step 8] Execute automated E2E test suite in scratch/e2e_scheduler_test.ts (100% pass verification)
```

---

## 5. Architectural Guarantees & Summary

1. **Zero Ghost Reminders**: Every status change (cancellation, check-in, completion) strictly clears the alarm.
2. **Sub-Millisecond Speed**: Redis checks alarms in memory in $< 0.1\text{ms}$; PostgreSQL indexed lookup runs in $< 1\text{ms}$.
3. **Zero Polling Waste**: Eliminates the previous 5 queries per salon per minute.
4. **Crash Resilient**: Even if the server is off for 2 hours, upon boot all stale past bookings are auto-cancelled without spam, attended visits are completed, and future alarms resume smoothly.
5. **Clean Separation of Concerns**: All Redis sorted-set operations and database alarm updates live in **one centralized service**, ensuring maintainability and reusability across the entire platform.
