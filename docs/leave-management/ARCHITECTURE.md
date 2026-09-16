# Employee Leave & Availability Override System — Production Architecture

This document describes the refactored, modular architecture of the **Leave / Mark Absent** feature in the Salon SaaS Platform.

---

## 1. Folder & File Structure

The leave management system is scoped strictly within `src/modules/staff/`:

```
src/modules/staff/
├── dto/
│   └── absence.dto.ts                  # DTOs: MarkAbsentDto, ExtendLeaveDto, CancelLeaveDto, etc.
│
├── engines/
│   ├── leave-interval.engine.ts        # Pure calculation engine: T_mid, portion bounds, minute conversion
│   └── leave-reassignment.engine.ts    # Reassignment candidate selection & booking reassignment logic
│
├── services/
│   ├── leave-validation.service.ts     # Business validation rules: date parsing, portion checks, extension rules
│   └── leave-processing.service.ts     # DB transactions, advisory locks, date iteration & lifecycle state
│
├── absence.service.ts                  # High-level application orchestrator (~150 LOC)
├── staff.controller.ts                 # HTTP route handlers (REST endpoints & validation guards)
├── staff.module.ts                     # NestJS DI Module registering & exporting all staff services/engines
├── absence.service.spec.ts             # Unit tests for AbsenceService & leave handling
└── absence_human_scenarios.spec.ts     # Real-world scenario integration tests
```

---

## 2. File Responsibilities Matrix

| File / Component | Architectural Role | Responsibilities |
|---|---|---|
| `staff.controller.ts` | **HTTP Layer** | Request extraction, DTO validation parsing, authorization/tenant guards, delegating to `AbsenceService`. No business math or DB logic. |
| `absence.service.ts` | **Application Orchestrator** | High-level application coordinator. Entry point for HTTP controller. Coordinates validation, processing, websocket event broadcasting (`STAFF_UPDATED`, `APPOINTMENT_UPDATED`), and WhatsApp notification dispatches. |
| `leave-validation.service.ts` | **Domain Validator** | Pure validation service for date normalization (Luxon ISO parse), leave portion checks (`FULL_DAY`, `FIRST_HALF`, `SECOND_HALF`, `CUSTOM_HOURS`), overlapping leave validation, and extension bounds verification. |
| `leave-interval.engine.ts` | **Domain Calculation Engine** | Pure functional calculation of blocked minutes given working hours and breaks. Handles $T_{mid}$ half-day midpoint splitting ($T_{mid} = T_{start} + \lfloor (T_{end} - T_{start})/2 \rfloor$), break overlaps, and custom hours. |
| `leave-reassignment.engine.ts` | **Reassignment Engine** | Evaluation of replacement candidate stylists, checking working hours, service qualifications, existing booking overlaps, and generating `BookingReassignment` records or `NO_REPLACEMENT` flags. |
| `leave-processing.service.ts` | **Processing & Lifecycle Service**| Executes database transactions (`$transaction`), manages PostgreSQL advisory locks (`pg_advisory_xact_lock`), updates `StylistAbsence` processing status (`PENDING` → `PROCESSING` → `COMPLETED`/`FAILED`), records audit logs, and handles date iteration. |

---

## 3. Dependency Graph & Direction

```
                      [ HTTP Request ]
                             │
                             ▼
                    StaffController
                             │
                             ▼
                      AbsenceService
                     /       │       \
                    /        │        \
                   ▼         ▼         ▼
    LeaveValidationService  LeaveIntervalEngine  LeaveProcessingService
                                                       │        │
                                                       ▼        ▼
                                          LeaveReassignmentEngine  Prisma/DB
```

- **Unidirectional flow**: Controllers call `AbsenceService`. `AbsenceService` delegates domain validation, interval calculation, and processing to specialized services/engines.
- **Zero Circular Dependencies**: `AvailabilityService` consumes `StylistAbsence` records from DB directly or via engine helper without importing `AbsenceService`.

---

## 4. Main Execution Flows

### A. Mark Absent / Create Leave Flow
1. **HTTP Layer**: `POST /salons/:salonId/staff/:stylistId/absence` or `POST /salons/:salonId/staff/absence/leave` received by `StaffController`.
2. **Orchestration**: `AbsenceService.markStylistAbsent` is invoked.
3. **Validation**: `LeaveValidationService` parses Luxon ISO dates in salon timezone, validates portion parameters, and checks for overlapping active leaves.
4. **Processing & Locks**: `LeaveProcessingService.processLeaveCreation` executes inside a Prisma `$transaction`:
   - Acquires PostgreSQL advisory locks: `pg_advisory_xact_lock(salonHash, stylistDateHash)`.
   - Creates/updates `StylistAbsence` record with status `PROCESSING`.
   - Iterates through dates in range:
     - Resolves day's working schedule using `LeaveIntervalEngine`.
     - Finds conflicting appointments for the stylist during blocked minutes.
     - Calls `LeaveReassignmentEngine` to reassign affected bookings or mark `NO_REPLACEMENT`.
   - Updates `StylistAbsence` to `COMPLETED` with final counts (`affectedBookingsCount`, `reassignedCount`, `unresolvableCount`).
5. **Events & Notifications**: `AbsenceService` emits real-time WebSocket events (`STAFF_UPDATED`, `APPOINTMENT_UPDATED`) and triggers async WhatsApp notifications to affected customers/stylists.

---

### B. Leave Extension Flow
1. **Validation**: `LeaveValidationService.validateLeaveExtension` verifies the existing leave is `ACTIVE` and `newEndDate > oldEndDate`.
2. **Incremental Processing**: `LeaveProcessingService` processes ONLY newly added dates (`oldEndDate + 1 day` to `newEndDate`), avoiding redundant re-evaluations of historical dates.
3. **Persistence**: `StylistAbsence` record `endDate` is updated, and counts are incremented.

---

### C. Cancellation Flow
1. **State Update**: `StylistAbsence` status is updated to `CANCELLED`.
2. **Reassignment Cleanup**: `BookingReassignment` records linked to the leave are cancelled (`REASSIGNMENT_CANCELLED`).
3. **Availability Restoration**: Stylist availability is unblocked for future slots where no replacement was assigned.

---

## 5. Availability Integration Architecture

- `AvailabilityService` checks `StylistAbsence` records for active leave overrides.
- `LeaveIntervalEngine.getLeaveBlockedMinutes` calculates exact start/end minute offsets for `FULL_DAY`, `FIRST_HALF`, `SECOND_HALF`, or `CUSTOM_HOURS` based on the stylist's daily schedule.
- Multi-day leaves spanning working and OFF days automatically skip calculation for OFF days while preserving blocked time on working days.

---

## 6. Testing Strategy & Verification

- **Unit Tests (`absence.service.spec.ts`)**: Tests `AbsenceService` orchestration, input validation error handling, and parameter passing.
- **Human Real-World Scenario Tests (`absence_human_scenarios.spec.ts`)**: End-to-end simulation of real salon scenarios (same-day leave, multi-day vacation, leave extension, customer auto-reassignment, customer notification triggers).
- **Availability Unit Tests (`availability.service.spec.ts`)**: Verifies slot availability calculation when stylist has full-day or half-day leave overrides.
