# Hierarchical Salon Operating Schedule & Availability Implementation Report

**Status:** `READY`  
**Date:** September 16, 2026  
**Module:** Salon Scheduling & Availability Subsystem  

---

## Executive Summary

Phase 1 implementation of the **Hierarchical Salon Operating Schedule & Availability System** is complete. The system enforces the fundamental business rule: **The Salon Operating Schedule defines the absolute outer boundary of availability. A stylist can be less available than the salon, but can NEVER be more available than the salon.**

All requirements have been met, backward compatibility has been preserved for legacy single-break records, multi-break structures have been added via validated JSON arrays, single-source calculation is unified in `AvailabilityEngineService`, advisory locks are fully normalized, and all 12 test suites (67 tests) in the backend repository pass cleanly.

---

## 1. Files Changed

### Database & Schema
- `backend/prisma/schema.prisma`
  - Added `breaks Json?` to `SalonWorkingHours`.
  - Added `hasBreakOverride Boolean @default(false)` and `breaks Json?` to `StylistWorkingHours`.
- `backend/prisma/migrations/20260916140000_add_hierarchical_multi_break_schedule/migration.sql`
  - Safe, non-destructive migration that adds new JSON columns and populates `breaks` from existing `breakStartTime`/`breakEndTime` values.

### Domain Engine & Core Modules
- `backend/src/modules/availability/availability-engine.service.ts` *(NEW)*
  - Pure, deterministic calculation engine for working windows, breaks, interval subtractions, and slot generation.
- `backend/src/modules/availability/availability.module.ts`
  - Exported `AvailabilityEngineService` for consumption across modules.
- `backend/src/modules/availability/availability.service.ts`
  - Refactored `getAvailableSlots()` to utilize `AvailabilityEngineService`.
- `backend/src/modules/appointments/appointments.service.ts`
  - Refactored `createAppointment()` and `rescheduleAppointment()` validation using `AvailabilityEngineService`.
- `backend/src/modules/salons/salons.service.ts`
  - Enforced write-time schedule conflict checks and multi-break updates.
- `backend/src/modules/staff/staff.service.ts`
  - Enforced write-time boundary checks rejecting custom stylist hours outside salon bounds.
- `backend/src/modules/staff/services/leave-processing.service.ts` & `backend/src/modules/staff/engines/leave-reassignment.engine.ts`
  - Updated leave processing to base `FIRST_HALF` and `SECOND_HALF` calculations on effective stylist working windows derived from `AvailabilityEngineService`.

### DTOs & Validation
- `backend/src/modules/salons/dto/working-hours.dto.ts`
  - Added `BreakItemDto` and `breaks` array validation.
- `backend/src/modules/staff/dto/create-staff.dto.ts` & `working-hours.dto`
  - Added `hasBreakOverride` and `breaks` multi-break DTO validation.

### Tests
- `backend/src/modules/availability/availability.service.spec.ts`
- `backend/src/modules/services/services.service.spec.ts`
- `backend/src/modules/appointments/reminders-flow.spec.ts`

---

## 2. Database & Data Migration

- **Migration Strategy:** Standard Prisma SQL Migration (`20260916140000_add_hierarchical_multi_break_schedule`).
- **Data Integrity:** `breakStartTime` and `breakEndTime` were left intact on existing schema tables for zero downtime. Existing records with single breaks were automatically converted into JSON arrays:
  ```json
  [
    {
      "id": "legacy-break-<id>",
      "startTime": "13:00",
      "endTime": "14:00",
      "title": "Lunch Break"
    }
  ]
  ```
- **Execution Verification:** Verified via `npx prisma migrate deploy` and direct PostgreSQL table inspection (`salon_working_hours` & `stylist_working_hours`).

---

## 3. API Contracts

Existing endpoints were updated to seamlessly support multi-breaks and break overrides without breaking front-end contracts:
- `PUT /salons/:salonId/working-hours`
  - Accepts `breaks: [{ id, startTime, endTime, title }]`.
- `POST /staff` & `PUT /staff/:id/working-hours`
  - Accepts `followsSalonSchedule`, `hasBreakOverride`, and `breaks: [...]`.

---

## 4. Availability Engine Architecture (`AvailabilityEngineService`)

The architecture follows a unidirectional dependency model:
```
SalonsModule / StaffModule / AppointmentsModule / StaffAbsenceModule
                          ↓
              AvailabilityEngineService
```
The `AvailabilityEngineService` provides pure functions:
1. `calculateEffectiveSalonWindow(salonSchedule, dateStr)`
2. `calculateEffectiveStylistWindow(salonWindow, stylistSchedule)`
3. `calculateEffectiveBreaks(salonSchedule, stylistSchedule)`
4. `computeFreeIntervals(workingWindow, breaks, leaveIntervals, appointments)`
5. `generateSlots(freeIntervals, durationMinutes)`

---

## 5. Matrix of Behavior & Verification

| Behavior Area | Expected Behavior | Actual Behavior | Status |
| :--- | :--- | :--- | :--- |
| **Rule 1: Salon Hard Boundary (Closed Salon)** | If salon is closed, ALL stylists are unavailable (0 slots), even if `followsSalonSchedule = false` and custom shift is set. | Returns 0 available slots; rejects attempts to book. | `EXPECTED = ACTUAL` (**PASS**) |
| **Rule 1: Salon Hard Boundary (Write-Time)** | Reject custom stylist hours starting before salon open or ending after salon close. | Rejects write/update requests with `400 BadRequestException`. | `EXPECTED = ACTUAL` (**PASS**) |
| **Rule 2: Custom Hours Inside Salon** | Custom stylist shift strictly inside salon bounds (e.g. Salon 09:00–19:00, Stylist 11:00–17:00) is accepted. | Successfully saved and enforced in slot calculations. | `EXPECTED = ACTUAL` (**PASS**) |
| **Rule 3: Break Inheritance** | Stylist with `hasBreakOverride = false` inherits salon default breaks. | Returns slots excluding salon breaks. | `EXPECTED = ACTUAL` (**PASS**) |
| **Rule 3: Break Override** | Stylist with `hasBreakOverride = true` uses custom breaks. Salon breaks are NOT applied. | Salon breaks disappear; custom breaks subtract cleanly. | `EXPECTED = ACTUAL` (**PASS**) |
| **Rule 4: Multiple Breaks** | Supports multiple break intervals per day for salon and stylist (e.g., Lunch + Tea break). | Both break windows are removed from available free intervals. | `EXPECTED = ACTUAL` (**PASS**) |
| **Rule 5: Break Validation** | Require `startTime < endTime` inside effective shift window. | Throws `BadRequestException` if break is outside shift or malformed. | `EXPECTED = ACTUAL` (**PASS**) |
| **Day-Off Handling** | Stylist marked non-working on a day returns 0 available slots. | Correctly evaluates shift `isWorking = false` as unavailable. | `EXPECTED = ACTUAL` (**PASS**) |
| **Leave Integration** | `FIRST_HALF` / `SECOND_HALF` leaves calculate mid-point based on effective stylist shift, not salon hours. | Splitting uses stylist effective start and end times. | `EXPECTED = ACTUAL` (**PASS**) |
| **Appointment Creation & Rescheduling** | Rejects booking/rescheduling into salon closed time, stylist off-hours, breaks, or leave. | Intersects requested interval with free intervals in `AppointmentsService`. | `EXPECTED = ACTUAL` (**PASS**) |
| **Any Stylist Selection** | Evaluates candidate stylists against full scheduling hierarchy. | Only stylists passing full boundary checks are assigned/returned. | `EXPECTED = ACTUAL` (**PASS**) |
| **Concurrency & Locks** | Date strings are normalized (`YYYY-MM-DD`) before generating PostgreSQL advisory locks. | Prevents deadlocks and race conditions on schedule mutations. | `EXPECTED = ACTUAL` (**PASS**) |
| **Tenant Isolation** | All schedule queries and updates scope strictly by `salonId` via `TenantContext`. | Cross-tenant schedule access is blocked with `403/404`. | `EXPECTED = ACTUAL` (**PASS**) |

---

## 6. Concurrency & Lock Key Matrix

To ensure thread safety and prevent double-booking during concurrent bookings, leaves, or schedule mutations, PostgreSQL advisory lock keys are generated using normalized UTC date components:

| Action | Lock Key Format | Lock Scope |
| :--- | :--- | :--- |
| **Appointment Creation** | `salon:<salonId>:stylist:<stylistId>:date:<YYYY-MM-DD>` | Per Stylist Per Day |
| **Appointment Rescheduling** | `salon:<salonId>:stylist:<stylistId>:date:<YYYY-MM-DD>` | Per Stylist Per Day |
| **Leave Creation / Cancellation** | `salon:<salonId>:stylist:<stylistId>:date:<YYYY-MM-DD>` | Per Stylist Per Day |
| **Salon Schedule Update** | `salon:<salonId>:schedule` | Salon Wide |
| **Stylist Schedule Update** | `salon:<salonId>:stylist:<stylistId>:schedule` | Per Stylist |

---

## 7. Test Results Summary

Ran full backend test suite:
- **Test Suites:** 12 passed, 12 total.
- **Tests:** 67 passed, 67 total.
- **Regression Check:** All existing WhatsApp webhook, service management, absence, and appointment reminder flow tests passed with 0 failures.

---

## 8. Known Limitations & Next Steps

1. **Frontend UI Parity:** Phase 1 focused strictly on backend integrity, database migration, and domain availability engine. The Web App frontend UI for managing multi-breaks and break overrides will be connected in Phase 2.

---

## Final Status

**READY**
