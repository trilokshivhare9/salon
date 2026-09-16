# Phase 0 — Current Architecture & Compatibility Analysis

**Project**: Salon ERP & Booking Management System  
**Feature**: Employee Leave & Availability Override System  
**Date**: September 16, 2026  

---

## A. CURRENT ARCHITECTURE

Currently, the stylist absence system is implemented as a single-date full-day absence recorder.

### Current Execution Flow:

1. **Marking Absence (`POST /staff/:id/absence`)**:
   - Controller (`StaffController.markAbsent`) delegates to [`AbsenceService.markStylistAbsent`](file:///Users/trilokshivhare/Documents/Development/sall/salon/backend/src/modules/staff/absence.service.ts#L184).
   - Validates stylist belongs to salon and date format (`YYYY-MM-DD`). Rejects past dates.
   - Starts Prisma `$transaction` (timeout 30s) and acquires PostgreSQL advisory lock `pg_advisory_xact_lock(hash('salon:ID'), hash('stylist:ID:YYYY-MM-DD'))`.
   - Upserts `StylistAbsence` record with status `ACTIVE`, `absenceDate = Date("YYYY-MM-DDT00:00:00.000Z")`.
   - Finds affected bookings: `Appointment` records matching `salonId`, `stylistId`, `appointmentDate = absenceDate`, status IN (`CONFIRMED`, `CHECKED_IN`).
   - For each affected booking, calls [`findReplacementStylistCandidate`](file:///Users/trilokshivhare/Documents/Development/sall/salon/backend/src/modules/staff/absence.service.ts#L60):
     - Searches for candidate stylists offering all required services with `status = ACTIVE` and `absences.none { absenceDate, status: ACTIVE }`.
     - Validates working hours (salon schedule or custom stylist working hours & breaks).
     - Checks appointment conflicts under advisory lock `pg_advisory_xact_lock(hash('salon:ID'), hash('stylist:CANDIDATE_ID:YYYY-MM-DD'))`.
   - If candidate found: updates `appointment.stylistId = replacementId`, creates `BookingReassignment` with outcome `AUTO_ASSIGNED`.
   - If no candidate: creates `BookingReassignment` with outcome `NO_REPLACEMENT`.
   - Updates `StylistAbsence` counters (`affectedBookingsCount`, `reassignedCount`, `unresolvableCount`) and creates `AuditLog`.
   - Emits WebSocket events (`STAFF_UPDATED`, `APPOINTMENT_UPDATED`) and asynchronously triggers WhatsApp notifications (`sendAbsenceNotification`).

2. **Availability Slot Engine ([`AvailabilityService.getAvailableSlots`](file:///Users/trilokshivhare/Documents/Development/sall/salon/backend/src/modules/availability/availability.service.ts#L170))**:
   - Queries stylists with `absences: { none: { absenceDate: absenceDateObj, status: 'ACTIVE' } }`.
   - Completely filters out any stylist marked absent for that entire date.

3. **Appointment Booking & Rescheduling Protection ([`AppointmentsService`](file:///Users/trilokshivhare/Documents/Development/sall/salon/backend/src/modules/appointments/appointments.service.ts))**:
   - Line 386 & 424: Under advisory lock, performs direct `StylistAbsence.findFirst({ absenceDate, status: ACTIVE })` queries to reject booking if stylist is absent.
   - Line 954: In `rescheduleAppointment`, performs same `StylistAbsence` check for new date.

4. **Absence Cancellation (`DELETE /staff/:id/absence/:absenceId`)**:
   - Sets `StylistAbsence.status = CANCELLED`. Emits WebSocket event. Reassignments remain unchanged.

---

## B. DEPENDENCY MAP

```
[Web Dashboard / REST API]
       │
       ├──> StaffController (staff.controller.ts:L145)
       │         │
       │         └──> AbsenceService (absence.service.ts:L184)
       │                   ├──> PrismaService (prisma.service.ts)
       │                   ├──> AppointmentsService (appointments.service.ts)
       │                   └──> WhatsAppService (whatsapp.service.ts)
       │
       ├──> AvailabilityService (availability.service.ts:L170)
       │         └──> PrismaService (prisma.service.ts)
       │
       └──> AppointmentsService (appointments.service.ts:L386, L954)
                 └──> PrismaService (prisma.service.ts)
```

### Key Files Involved:
- **Prisma Schema**: [`backend/prisma/schema.prisma`](file:///Users/trilokshivhare/Documents/Development/sall/salon/backend/prisma/schema.prisma#L727-L788)
- **Controller**: [`backend/src/modules/staff/staff.controller.ts`](file:///Users/trilokshivhare/Documents/Development/sall/salon/backend/src/modules/staff/staff.controller.ts#L145-L185)
- **Absence Service**: [`backend/src/modules/staff/absence.service.ts`](file:///Users/trilokshivhare/Documents/Development/sall/salon/backend/src/modules/staff/absence.service.ts)
- **Absence DTO**: [`backend/src/modules/staff/dto/absence.dto.ts`](file:///Users/trilokshivhare/Documents/Development/sall/salon/backend/src/modules/staff/dto/absence.dto.ts)
- **Availability Service**: [`backend/src/modules/availability/availability.service.ts`](file:///Users/trilokshivhare/Documents/Development/sall/salon/backend/src/modules/availability/availability.service.ts)
- **Appointments Service**: [`backend/src/modules/appointments/appointments.service.ts`](file:///Users/trilokshivhare/Documents/Development/sall/salon/backend/src/modules/appointments/appointments.service.ts)
- **Reminders Service**: [`backend/src/modules/appointments/reminders.service.ts`](file:///Users/trilokshivhare/Documents/Development/sall/salon/backend/src/modules/appointments/reminders.service.ts)
- **Web Frontend**: [`apps/web/js/dashboard.js`](file:///Users/trilokshivhare/Documents/Development/sall/salon/apps/web/js/dashboard.js#L3317-L3493), [`apps/web/js/api.js`](file:///Users/trilokshivhare/Documents/Development/sall/salon/apps/web/js/api.js)

---

## C. CURRENT DATA MODEL

```prisma
model StylistAbsence {
  id                    String         @id @default(uuid())
  salonId               String         @map("salon_id")
  stylistId             String         @map("stylist_id")
  absenceDate           DateTime       @map("absence_date") @db.Date
  reason                String?
  notes                 String?
  status                AbsenceStatus  @default(ACTIVE)

  createdByAdminId      String?        @map("created_by_admin_id")

  affectedBookingsCount Int            @default(0) @map("affected_bookings_count")
  reassignedCount       Int            @default(0) @map("reassigned_count")
  unresolvableCount     Int            @default(0) @map("unresolvable_count")

  createdAt             DateTime       @default(now()) @map("created_at")
  updatedAt             DateTime       @updatedAt @map("updated_at")

  salon                 Salon          @relation(fields: [salonId], references: [id], onDelete: Cascade)
  stylist               Stylist        @relation(fields: [stylistId], references: [id], onDelete: Cascade)
  createdByAdmin        Admin?         @relation("AdminCreatedAbsences", fields: [createdByAdminId], references: [id], onDelete: SetNull)
  reassignments         BookingReassignment[]

  @@unique([salonId, stylistId, absenceDate])
  @@index([salonId, absenceDate])
  @@index([stylistId, absenceDate])
  @@map("stylist_absences")
}
```

---

## D. BREAKING CHANGES

1. **Prisma Model Extension**: `StylistAbsence` fields evolve:
   - `absenceDate` (single date) $\rightarrow$ replaced/mapped to `startDate` and `endDate`.
   - Added: `leaveType` (`SICK_LEAVE`, `CASUAL_LEAVE`, `EMERGENCY_LEAVE`, `UNPAID_LEAVE`, `OTHER`).
   - Added: `leavePortion` (`FULL_DAY`, `FIRST_HALF`, `SECOND_HALF`, `CUSTOM_HOURS`).
   - Added: `customStartTime` (`String?`), `customEndTime` (`String?`).
   - Added: `processingStatus` (`PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`).
   - Dropped Unique Constraint: `@@unique([salonId, stylistId, absenceDate])` removed in favor of `[salonId, stylistId, startDate, endDate]` indexes.
2. **Availability Engine Shift**:
   - `AvailabilityService` will no longer discard a stylist for an entire day upon finding an active leave unless `leavePortion == FULL_DAY`.
   - Partial/half-day leaves (`FIRST_HALF`, `SECOND_HALF`, `CUSTOM_HOURS`) will calculate specific blocked intervals and inject them into `busyIntervals`.
3. **Appointment Service Absence Check**:
   - Direct `findFirst({ absenceDate })` calls in `AppointmentsService` must be updated to check whether the requested appointment start/end overlaps with an active leave interval on `startDate <= apptDate <= endDate`.

---

## E. MIGRATION STRATEGY

To safely migrate existing production data without loss or downtime:

1. **Schema Migration Step**:
   - Add new nullable columns (`startDate`, `endDate`, `leaveType`, `leavePortion`, `customStartTime`, `customEndTime`, `processingStatus`) with default values.
   - Run SQL data backfill:
     ```sql
     UPDATE stylist_absences
     SET start_date = absence_date,
         end_date = absence_date,
         leave_type = 'SICK_LEAVE',
         leave_portion = 'FULL_DAY',
         processing_status = 'COMPLETED'
     WHERE start_date IS NULL;
     ```
   - Make `startDate`, `endDate`, `leaveType`, `leavePortion`, `processingStatus` NOT NULL.
   - Drop old unique constraint `@@unique([salonId, stylistId, absenceDate])`.

---

## F. COMPATIBILITY RISKS

1. **Timezone Boundary Risk**: `startDate` and `endDate` must be stored as `@db.Date` normalized in the salon's configured timezone (`salon.timezone || 'Asia/Kolkata'`), matching the pattern used across `SalonWorkingHours` and `Appointment.appointmentDate`.
2. **Double Booking on Cancellation**: If an absence is cancelled or shortened, availability must only be unblocked if the stylist has no new appointments assigned during those hours. Existing `BookingReassignment` records must remain intact.
3. **Advisory Lock Key Harmonization**: Ensure the advisory lock hash formula `hash('stylist:ID:YYYY-MM-DD')` is applied consistently per date in multi-day range loops to prevent deadlock or race conditions with incoming booking transactions.
4. **WhatsApp & Reminders Worker Integration**: Reminders service checks appointment status and assigned stylist. Since reassigned appointments update `appointment.stylistId`, reminders continue working seamlessly.

---

## G. IMPLEMENTATION PLAN FILE MAP

| Phase | Files to Modify / Create | Purpose |
| :--- | :--- | :--- |
| **Phase 1** | `backend/prisma/schema.prisma`, Prisma Migration | Schema update & backfill |
| **Phase 2** | `backend/src/modules/staff/dto/absence.dto.ts`<br>`backend/src/modules/staff/absence.service.ts` | Multi-day, half-day, $T_{mid}$ boundaries, lifecycle, extensions |
| **Phase 3** | `backend/src/modules/availability/availability.service.ts` | Partial-day blocked interval injection into `busyIntervals` |
| **Phase 4** | `backend/src/modules/appointments/appointments.service.ts` | Interval overlap checks for appointment creation/reschedule |
| **Phase 5** | `backend/src/modules/staff/staff.controller.ts` | New REST endpoints (`POST /staff/:id/leave`, etc.) |
| **Phase 6** | `apps/web/js/dashboard.js`, `apps/web/js/api.js` | UI redesign for Leave modal, range pickers, extension |
| **Phase 7** | `backend/src/modules/staff/absence.service.spec.ts`<br>`backend/src/modules/availability/availability.service.spec.ts`<br>`backend/test/qa_production_suite/` | Unit, integration & regression test suites |

---

## H. TEST IMPACT

### Existing Tests Requiring Updates:
- `backend/src/modules/staff/absence.service.spec.ts`: Update single-date DTO mocks to range DTO (`startDate`, `endDate`, `leavePortion`).
- `backend/src/modules/staff/absence_human_scenarios.spec.ts`: Update test payloads to use `startDate`/`endDate`.
- `backend/test/qa_production_suite/test-absence-all-fixes.ts`: Update test runner inputs.

### New Required Test Coverage:
1. **Multi-Day Leave & Extension**: Multi-date range creation, incremental extension (`Sep 20–25` $\rightarrow$ `Sep 20–28`).
2. **Half-Day Boundaries ($T_{mid}$)**: `FIRST_HALF` and `SECOND_HALF` with explicit breaks and without explicit breaks.
3. **Schedule OFF Days**: Multi-day leave over weekly OFF days producing no leave blocks.
4. **Availability Slots**: Slot generation for half-day leaves verifying non-leave shift hours remain bookable.
5. **Concurrency & Advisory Locks**: Concurrent extension vs booking creation.

---

## I. BLOCKERS / UNKNOWNS

None. The existing codebase architecture cleanly supports all required invariants and separation of concerns. Phase 0 discovery is complete.
