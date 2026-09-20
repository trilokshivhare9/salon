# POST-FIX VALIDATION REPORT
## Employee Leave & Availability Override System Remediation

---

## 1. EXECUTIVE SUMMARY

Following the adversarial audit report (`docs/leave-management/ADVERSARIAL_REVALIDATION_REPORT.md`), a controlled production remediation was executed across the backend codebase.

All 4 reported defects (**BUG-01**, **BUG-02**, **BUG-03**, and **BUG-04**) were analyzed down to root cause and remediated without altering external business contracts, introducing generic utility dumping grounds, or modifying database schemas.

### Remediation Status Overview
- **BUG-01 (CRITICAL)**: **FIXED**. `AppointmentsService.createAppointment` now explicitly validates active `StylistAbsence` records for specific stylists and evaluates interval overlaps for half-day (`FIRST_HALF`/`SECOND_HALF`) and `CUSTOM_HOURS` leaves during "Any Stylist" auto-assignment.
- **BUG-02 (HIGH)**: **FIXED**. Lock key date generation in `createAppointment` and `rescheduleAppointment` normalizes raw date strings (including ISO timestamps) to canonical `YYYY-MM-DD` strings before generating integer hashes.
- **BUG-03 (MEDIUM)**: **FIXED**. `AbsenceService.getStylistAbsences` date range filtering updated to use overlapping date interval logic (`startDate <= filterEnd AND endDate >= filterStart`).
- **BUG-04 (MEDIUM)**: **FIXED**. `LeaveProcessingService.processLeaveCreation` scales transaction timeouts dynamically based on multi-day range length (`Math.max(30000, daysCount * 3000)`).
- **Final Status**: **`FIXED — READY FOR RE-AUDIT`**

---

## 2. PRE-FIX BASELINE RECAP
- **Build Status**: `npm run build` PASSED (0 errors).
- **Target Test Suites**: 39/39 PASSED.
- **Verdict**: `NOT READY` (due to missing cross-module leave validation in `createAppointment` and lock key divergence).

---

## 3. BUG-01 REMEDIATION & ROOT CAUSE ANALYSIS

### Root Cause
1. **Specific Stylist**: `AppointmentsService.createAppointment` previously checked appointment conflicts (`tx.appointment.findFirst`) but failed to query `tx.stylistAbsence.findMany` for requested stylist IDs.
2. **Any Stylist**: Line 398 checked `if (!candidateAbsence || candidateAbsence.leavePortion !== 'FULL_DAY')`, assuming any non-`FULL_DAY` leave allowed booking without checking whether appointment start/end times overlapped the half-day or custom-hours blocked window.

### Architectural Fix
- Added private helper `isApptOverlappingAbsence` inside `AppointmentsService`. It resolves salon/stylist working hours and break schedules, computes $T_{mid}$ half-day midpoint boundaries or custom hours clamped intervals, and checks interval overlap (`apptStartMin < blockedEnd && apptEndMin > blockedStart`).
- In `createAppointment` (Specific Stylist branch): Queries active absences for `requestedStylistId` and throws `ConflictException('Selected specialist is on leave during the requested appointment time.')` if an overlap is detected.
- In `createAppointment` (Any Stylist branch): Iterates candidate absences and excludes any candidate whose active leave interval overlaps the appointment window.
- In `rescheduleAppointment`: Re-verifies target stylist active leaves before confirming rescheduling.

---

## 4. BUG-02 REMEDIATION & LOCK MATRIX

### Root Cause
`createAppointment` computed lock keys using raw `dto.date` (which could be `2026-09-25T00:00:00.000Z`), whereas `LeaveProcessingService` used `dateDt.toISODate()!` (`2026-09-25`). Different string inputs generated different 32-bit hash integers.

### Fix
Normalized all appointment date parameters to canonical 10-character `YYYY-MM-DD` strings before hashing:
```ts
const dateStr = dto.date.includes('T') ? dto.date.split('T')[0] : dto.date;
const customerKey2 = this.hashToSignedInt32(`cust:${salonUser.id}:${dateStr}`);
const stylistKey2 = this.hashToSignedInt32(`stylist:${requestedStylistId}:${dateStr}`);
const candKey2 = this.hashToSignedInt32(`stylist:${candidateId}:${dateStr}`);
```

---

## 5. BUG-03 REMEDIATION

### Root Cause
`AbsenceService.getStylistAbsences` filtered using `{ startDate: { gte: filter.startDate, lte: filter.endDate } }`. Multi-day leaves that started prior to `filter.startDate` (e.g. Sept 1 to Sept 30) were omitted when querying Sept 15–20.

### Fix
Updated query to interval overlap logic:
```ts
whereClause.OR = [
  {
    AND: [
      { startDate: { lte: filterEnd } },
      { endDate: { gte: filterStart } },
    ],
  },
  {
    absenceDate: { gte: filterStart, lte: filterEnd },
  },
];
```

---

## 6. BUG-04 REMEDIATION

### Root Cause & Implementation
Long-range multi-day leave creations (e.g., 30–60 days) run within a single Prisma `$transaction`. Fixed by dynamically scaling transaction timeout based on the date range span:
```ts
timeout: Math.max(
  30000,
  (Math.ceil(
    (normalizedDates.endDateParsed.toMillis() - normalizedDates.startDateParsed.toMillis()) /
      (24 * 60 * 60 * 1000),
  ) + 1) * 3000,
)
```

---

## 7. FILES CHANGED & DATABASE IMPACT

### Modified Files
1. **`src/modules/appointments/appointments.service.ts`**: Implemented leave validation in `createAppointment` & `rescheduleAppointment`, normalized lock date keys, added `parseTimeStringToMinutes` & `isApptOverlappingAbsence` helpers.
2. **`src/modules/staff/absence.service.ts`**: Corrected date range filter in `getStylistAbsences`.
3. **`src/modules/staff/services/leave-processing.service.ts`**: Implemented dynamic transaction timeout calculation.
4. **`src/modules/appointments/appointments.service.spec.ts`**: Added `stylistAbsence.findMany` mock support.

### Created Files
1. **`docs/leave-management/BUG_FIX_BASELINE.md`**: Pre-remediation build and test baseline.
2. **`docs/leave-management/LOCK_KEY_MATRIX.md`**: Advisory lock key identity matrix.
3. **`src/modules/appointments/leave-remediation-cross-module.spec.ts`**: Cross-module integration tests.
4. **`docs/leave-management/POST_FIX_VALIDATION_REPORT.md`**: Post-fix validation report.

### Database Schema Impact
- **0 Schema Changes**: No Prisma schema changes or migrations required.

---

## 8. TEST RESULTS & VERIFICATION

### Cross-Module & Target Test Suites (100% Pass Rate)

| Test Suite | Tests | Result |
|---|---|---|
| `src/modules/appointments/leave-remediation-cross-module.spec.ts` | 7 | **PASS** |
| `src/modules/staff/absence.service.spec.ts` | 13 | **PASS** |
| `src/modules/staff/absence_human_scenarios.spec.ts` | 10 | **PASS** |
| `src/modules/availability/availability.service.spec.ts` | 13 | **PASS** |
| `src/modules/appointments/reminders-absence.spec.ts` | 3 | **PASS** |
| `src/modules/appointments/appointments.service.spec.ts` | 15 | **PASS** |
| **TOTAL** | **61** | **ALL PASSED** |

---

## 9. FINAL STATUS

# **`FIXED — READY FOR RE-AUDIT`**
