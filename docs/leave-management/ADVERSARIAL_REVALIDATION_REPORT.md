# ADVERSARIAL RE-VALIDATION REPORT
## Employee Leave & Availability Override System

---

## 1. EXECUTIVE SUMMARY

An adversarial re-validation was conducted to challenge the previous `READY` verdict for the **Employee Leave & Availability Override System**.

Rather than assuming the system is production-safe based on passing unit tests or previous audit reports, this evaluation actively sought to disprove the previous claims by inspecting actual execution paths across:
1. `AppointmentsService.createAppointment`
2. `AbsenceService` & `LeaveProcessingService`
3. `RemindersService` & background cron jobs
4. PostgreSQL advisory lock key formulations
5. Multi-day date boundary and timezone queries

### Key Findings Summary
The adversarial review uncovered **2 confirmed defects** that challenge the previous `READY` verdict:
1. **CRITICAL**: `AppointmentsService.createAppointment` bypasses leave checking when a specific `requestedStylistId` is provided, and incorrectly handles half-day (`FIRST_HALF`/`SECOND_HALF`) and `CUSTOM_HOURS` leaves during "Any Stylist" auto-assignment.
2. **HIGH**: Advisory lock key string format divergence between `createAppointment` (`dto.date` raw string) and `LeaveProcessingService` (`toISODate()` formatted string), causing lock integer mismatches if ISO timestamps are submitted.
3. **MEDIUM**: `AbsenceService.getStylistAbsences` date-range filtering uses `startDate >= filter.startDate` instead of an overlapping interval condition, omitting leaves that started prior to the filter start date.

---

## 2. PREVIOUS VERDICT ASSESSMENT

| Previous Claim | Audit Status | Code Evidence / Finding |
|---|---|---|
| *"Appointments cannot be created on stylists during active leave"* | **DISPROVED** | `AppointmentsService.createAppointment` does not query `StylistAbsence` when `requestedStylistId` is specified, allowing direct API bookings on absent stylists. |
| *"Half-day leaves block appointment creation during blocked intervals"* | **DISPROVED** | `createAppointment` line 398 checks `if (!candidateAbsence \|\| candidateAbsence.leavePortion !== 'FULL_DAY')`, accepting candidate stylists for "Any Stylist" bookings without checking if the appointment time overlaps the half-day interval. |
| *"Advisory locks prevent concurrent booking and leave creation"* | **PARTIALLY DISPROVED** | If `dto.date` in `createAppointment` is an ISO timestamp (e.g. `2026-09-25T00:00:00.000Z`), its lock hash differs from `LeaveProcessingService`'s `2026-09-25` lock hash, bypassing concurrency protection. |
| *"No-replacement appointments are handled safely by workers"* | **VERIFIED** | `RemindersService` correctly skips 2h/15m reminders for `NO_REPLACEMENT` appointments and auto-cancels expired visits as `SALON_EMERGENCY` with zero customer penalty strikes. |
| *"Tenant isolation is 100% enforced"* | **VERIFIED** | All database queries include `salonId` filters derived from authenticated JWT tokens. |

---

## 3. DISCOVERED DEFECTS & BUGS

### BUG-01: Direct Appointment Creation Bypasses Leave Validation & Half-Day Checks
- **Severity**: **CRITICAL**
- **File**: `src/modules/appointments/appointments.service.ts`
- **Class / Function**: `AppointmentsService.createAppointment` (lines 335–404)
- **Root Cause**:
  1. When `requestedStylistId` is provided by an API caller, `createAppointment` checks for existing appointment overlaps (`tx.appointment.findFirst`), but **never queries `tx.stylistAbsence.findFirst`**. A direct API request specifying a stylist ID bypasses leave validation entirely.
  2. When evaluating candidate stylists for "Any Stylist" bookings (line 398), the code checks `if (!candidateAbsence || (candidateAbsence.leavePortion && candidateAbsence.leavePortion !== 'FULL_DAY'))`. It assumes any non-`FULL_DAY` leave (`FIRST_HALF`, `SECOND_HALF`, `CUSTOM_HOURS`) makes the stylist eligible for the entire day, without checking whether the appointment's start/end time overlaps with the leave portion interval.
- **Actual Behavior**: Appointments can be booked during a stylist's half-day leave via "Any Stylist", or directly booked on a stylist on full-day leave via API calls.
- **Expected Behavior**: All appointment creation paths must validate appointment start/end times against `StylistAbsence` blocked intervals using `LeaveIntervalEngine`.
- **Recommended Fix**: Add explicit `tx.stylistAbsence` validation for `requestedStylistId`, and use `LeaveIntervalEngine.isAppointmentOverlappingLeave` inside the "Any Stylist" candidate loop.

---

### BUG-02: Advisory Lock Key Format Divergence Between Booking & Leave Processing
- **Severity**: **HIGH**
- **Files**: `src/modules/appointments/appointments.service.ts` (line 337), `src/modules/staff/services/leave-processing.service.ts` (line 157)
- **Class / Function**: `AppointmentsService.createAppointment` vs `LeaveProcessingService.processLeaveCreation`
- **Root Cause**: `createAppointment` computes the stylist advisory lock key using `dto.date` (which may be formatted as `2026-09-25T00:00:00.000Z` or `2026-09-25`), whereas `LeaveProcessingService` computes it using `dateDt.toISODate()!` (always `2026-09-25`). Hash generation (`hashToSignedInt32`) produces different integer values for different string inputs.
- **Actual Behavior**: When `dto.date` contains an ISO timestamp, the lock keys generated by `createAppointment` and `processLeaveCreation` do not match, failing to block concurrent execution.
- **Expected Behavior**: Both services must normalize date strings to standard ISO date format (`YYYY-MM-DD`) prior to generating 32-bit advisory lock hashes.
- **Recommended Fix**: Normalize `dto.date` to `YYYY-MM-DD` before generating `stylistKey2` in `createAppointment`.

---

### BUG-03: `getStylistAbsences` Misses Multi-Day Leaves Spanning Across Filter Start Date
- **Severity**: **MEDIUM**
- **File**: `src/modules/staff/absence.service.ts`
- **Class / Function**: `AbsenceService.getStylistAbsences` (lines 504–511)
- **Root Cause**: The filter query uses:
  ```ts
  whereClause.OR = [
    { startDate: { gte: parseFilterDate(filters.startDate), lte: parseFilterDate(filters.endDate) } },
    { absenceDate: { gte: parseFilterDate(filters.startDate), lte: parseFilterDate(filters.endDate) } },
  ];
  ```
- **Actual Behavior**: A leave with `startDate = 2026-09-01` and `endDate = 2026-09-30` is omitted when querying for `2026-09-15` to `2026-09-20`, because `startDate` (`2026-09-01`) is not `>= 2026-09-15`.
- **Expected Behavior**: Date range filtering must query for overlapping intervals: `startDate <= filter.endDate AND endDate >= filter.startDate`.
- **Recommended Fix**: Update `whereClause` to use overlapping date range logic.

---

### BUG-04: Unbounded Multi-Day Leave Processing Risks Transaction Timeout
- **Severity**: **MEDIUM**
- **File**: `src/modules/staff/services/leave-processing.service.ts`
- **Class / Function**: `LeaveProcessingService.processLeaveCreation`
- **Root Cause**: All dates in a multi-day leave range (e.g. 30 to 90 days) are processed synchronously within a single Prisma transaction (`$transaction({ timeout: 30000 })`).
- **Actual Behavior**: For high-volume salons, processing 60+ dates with multiple appointments per date requires hundreds of nested DB queries, risking Prisma 30-second transaction timeout.
- **Expected Behavior**: Multi-day leaves exceeding a threshold (e.g., > 14 days) should chunk processing or execute outside a single long-running transaction block.

---

## 4. NO-REPLACEMENT SAFETY AUDIT

An in-depth trace of appointments with `ReassignmentOutcome.NO_REPLACEMENT` verified downstream worker safety:
- **Stage 1 (2h Advance Reminder)**: Query filter `reassignments: { none: { outcome: NO_REPLACEMENT, absence: { status: ACTIVE } } }` prevents sending reminders.
- **Stage 2 (15m Arrival Alert)**: Query filter prevents sending arrival alerts.
- **Stage 4 (Grace Period Worker)**: Inspects `hasUnresolvedAbsence`. If true, auto-cancels the appointment as `SALON_EMERGENCY` with **zero customer penalty strikes** recorded on `SalonUser`.

---

## 5. LOCK KEY CONSISTENCY MATRIX

| Component / Operation | Lock Key Formulation | Transaction Type | Lock Collision Status |
|---|---|---|---|
| `createAppointment` (Specific Stylist) | `stylist:${requestedStylistId}:${dto.date}` | Exclusive | **MISMATCH** if `dto.date` has ISO timestamp |
| `createAppointment` (Any Stylist) | `stylist:${candidateId}:${dto.date}` | Try-Lock Exclusive | **MISMATCH** if `dto.date` has ISO timestamp |
| `processLeaveCreation` | `stylist:${stylistId}:${dateStr}` | Exclusive | Standard `YYYY-MM-DD` string |
| `extendStylistLeave` | `stylist:${stylistId}:${dateStr}` | Exclusive | Standard `YYYY-MM-DD` string |

---

## 6. TEST QUALITY EVALUATION

| Test Suite | Coverage & Value | Omissions / Weaknesses | Quality Grade |
|---|---|---|---|
| `absence.service.spec.ts` | Validates `AbsenceService` parameter parsing, Luxon date normalization, and NestJS service orchestration. | Mocks `AppointmentsService` & `PrismaService`, masking `AppointmentsService.createAppointment` leave bypass bug. | **MEDIUM** |
| `absence_human_scenarios.spec.ts` | Integration test simulating full-day, multi-day, half-day, and extension flows. | Does not execute direct `AppointmentsService.createAppointment` calls against active half-day leaves. | **STRONG** |
| `availability.service.spec.ts` | Tests `AvailabilityService` slot generation and slot subtraction for active leaves. | Verifies `AvailabilityService` UI slot generation, but cannot test direct API creation calls bypassing availability. | **STRONG** |
| `reminders-absence.spec.ts` | Verifies `RemindersService` handling of `NO_REPLACEMENT` appointments. | None. Accurately tests worker penalty exclusion. | **STRONG** |

---

## 7. RECOMMENDED FIXES

1. **Fix `createAppointment` Leave Validation**:
   - In `AppointmentsService.createAppointment`, add an explicit `stylistAbsence` check for `requestedStylistId`.
   - In the "Any Stylist" candidate evaluation loop, invoke `LeaveIntervalEngine.isAppointmentOverlappingLeave` to ensure candidates on half-day or custom-hours leave are not booked during their leave interval.
2. **Normalize Lock Key Dates**:
   - Normalize `dto.date` to `YYYY-MM-DD` prior to generating `stylistKey2` in `createAppointment`.
3. **Correct `getStylistAbsences` Query**:
   - Update `getStylistAbsences` date filtering to `startDate <= filter.endDate AND endDate >= filter.startDate`.

---

## FINAL VERDICT

# **`NOT READY`**

The implementation **cannot be marked READY for production** until **BUG-01** (direct appointment creation bypassing leave validation and half-day checks) and **BUG-02** (advisory lock key date format mismatch) are resolved in `AppointmentsService`.
