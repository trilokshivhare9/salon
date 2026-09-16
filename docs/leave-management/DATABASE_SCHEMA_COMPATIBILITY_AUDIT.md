# DATABASE SCHEMA COMPATIBILITY AUDIT
## Employee Leave & Availability Override System

---

## 1. RUNTIME ERROR OBSERVED

During real browser execution on the Leave Management modal (`http://localhost:8080`), submitting a Leave request triggered the following critical backend exception:

```text
Invalid `tx.stylistAbsence.findFirst()` invocation in 
/Users/trilokshivhare/Documents/Development/sall/salon/backend/src/modules/staff/services/leave-processing.service.ts:109:57

The column `stylist_absences.start_date` does not exist in the current database.
```

---

## 2. PHASE 1 — CONNECTED ENVIRONMENT

Read-only inspection of `backend/.env` confirmed:

- **Environment**: `development` (`NODE_ENV=development`, `APP_ENV=development`)
- **Database Host**: `localhost:5432`
- **Database Name**: `salon_saas_dev`
- **Database Schema**: `public`
- **Connection Source**: `backend/.env` (`DATABASE_URL="postgresql://[REDACTED]@localhost:5432/salon_saas_dev?schema=public"`)

---

## 3. PHASE 2 & 3 — THREE SOURCES OF TRUTH & MIGRATION HISTORY

### A. Prisma Schema (`backend/prisma/schema.prisma`)
The Prisma schema defines `StylistAbsence` with new multi-day and portion fields (`startDate`, `endDate`, `leaveType`, `leavePortion`, `customStartTime`, `customEndTime`, `processingStatus`).

### B. Migration History (`backend/prisma/migrations/`)
Only **1 migration** exists in `prisma/migrations`:
- `20260908060928_init`

Inspection of `20260908060928_init/migration.sql` revealed that `stylist_absences` and `booking_reassignments` were **not included** in the initial migration script.

### C. Actual Database Schema (`salon_saas_dev`)
Direct query of `information_schema.columns` on `salon_saas_dev` revealed:
- `_prisma_migrations` table does **NOT** exist (database was populated via `prisma db push` during early development).
- `stylist_absences` table exists with **legacy schema** (13 columns, containing `absence_date` but missing `start_date`, `end_date`, `leave_type`, `leave_portion`, `custom_start_time`, `custom_end_time`, `processing_status`).

---

## 4. PHASE 5 — SCHEMA DIFFERENCE TABLE

| Item / Column | Prisma Schema | Migration (`init`) | Actual DB (`salon_saas_dev`) | Status |
|---|---|---|---|---|
| `start_date` | `DateTime @db.Date` | Missing | Missing | **BLOCKER** |
| `end_date` | `DateTime @db.Date` | Missing | Missing | **BLOCKER** |
| `absence_date` | `DateTime? @db.Date` | Missing | `date NOT NULL` | **BLOCKER** |
| `leave_type` | `LeaveType enum` | Missing | Missing | **BLOCKER** |
| `leave_portion` | `LeavePortion enum` | Missing | Missing | **BLOCKER** |
| `custom_start_time` | `String?` | Missing | Missing | **BLOCKER** |
| `custom_end_time` | `String?` | Missing | Missing | **BLOCKER** |
| `processing_status` | `LeaveProcessingStatus enum` | Missing | Missing | **BLOCKER** |
| `reason` | `String?` | Missing | `text NULL` | Exists |
| `notes` | `String?` | Missing | `text NULL` | Exists |
| `status` | `AbsenceStatus enum` | Missing | `AbsenceStatus enum NOT NULL` | Exists |
| `created_by_admin_id` | `String?` | Missing | `text NULL` | Exists |
| `affected_bookings_count` | `Int` | Missing | `integer NOT NULL DEFAULT 0` | Exists |
| `reassigned_count` | `Int` | Missing | `integer NOT NULL DEFAULT 0` | Exists |
| `unresolvable_count` | `Int` | Missing | `integer NOT NULL DEFAULT 0` | Exists |
| `booking_reassignments` table | Exists (18 columns) | Missing | Exists (18 columns) | Exists |

---

## 5. PHASE 4 — LEGACY `absenceDate` ANALYSIS

A. **Is `absenceDate` present in Prisma schema?**: Yes (`absenceDate DateTime? @map("absence_date") @db.Date`).
B. **Is it nullable?**: Yes (`DateTime?`).
C. **Is `startDate` / `endDate` authoritative?**: Yes, `startDate` and `endDate` are authoritative for date ranges. `absenceDate` is retained as a legacy/fallback field.
D. **Existing record data loss risk**: Actual DB inspection revealed **0 existing rows** in `stylist_absences`. Zero production or development data will be lost during migration.

---

## 6. PHASE 6 — WHY AUTOMATED TESTS MISSED IT

The 13 Jest backend unit tests (`absence_human_scenarios.spec.ts` & `leave-remediation-cross-module.spec.ts`) passed because they used **in-memory mocked Prisma objects** (`mockPrisma = { stylistAbsence: { findFirst: jest.fn(), ... } }`).

Because the tests mocked Prisma's client methods rather than executing queries against the real PostgreSQL database, the missing database columns (`start_date`, `end_date`, etc.) were completely bypassed during Jest test runs.

---

## 7. PHASE 7 — AFFECTED MODULES

Every backend module executing runtime queries against `stylistAbsence` is affected:
- `AbsenceService` (`markStylistAbsent`, `previewAbsenceImpact`, `extendStylistLeave`, `getStylistAbsences`, `cancelAbsence`)
- `LeaveProcessingService` (`processLeaveCreation`, `resolveDaySchedule`)
- `LeaveValidationService` (`validateNoActiveLeaveConflict`)
- `AvailabilityService` (`getStylistAvailableSlots`)
- `AppointmentsService` (Availability checks during booking creation & reschedule)

All runtime queries attempt `SELECT ... FROM stylist_absences`, failing immediately due to missing `start_date` column.

---

## 8. PHASE 8 — SAFE REMEDIATION PLAN

### Step 1: Migration Generation (Read-Only Planning)
Generate a structured migration file using Prisma:
```bash
cd backend
npx prisma migrate dev --name add_leave_management_schema --create-only
```

### Step 2: SQL Migration Contents (`prisma/migrations/20260916XXXXXX_add_leave_management_schema/migration.sql`)
The migration SQL will safely alter `stylist_absences`:
```sql
-- Create Enums if missing
CREATE TYPE "LeaveType" AS ENUM ('SICK_LEAVE', 'CASUAL_LEAVE', 'EMERGENCY_LEAVE', 'UNPAID_LEAVE', 'OTHER');
CREATE TYPE "LeavePortion" AS ENUM ('FULL_DAY', 'FIRST_HALF', 'SECOND_HALF', 'CUSTOM_HOURS');
CREATE TYPE "LeaveProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "ReassignmentOutcome" AS ENUM ('PENDING', 'AUTO_ASSIGNED', 'CUSTOMER_ACCEPTED', 'CUSTOMER_DECLINED', 'CUSTOMER_RESCHEDULED', 'CUSTOMER_CANCELLED', 'NO_REPLACEMENT', 'ADMIN_RESOLVED', 'EXPIRED');
CREATE TYPE "CustomerResponse" AS ENUM ('ACCEPTED', 'DECLINED', 'RESCHEDULED', 'CANCELLED', 'NO_RESPONSE');

-- Alter Table stylist_absences
ALTER TABLE "stylist_absences" ADD COLUMN IF NOT EXISTS "start_date" DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE "stylist_absences" ADD COLUMN IF NOT EXISTS "end_date" DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE "stylist_absences" ALTER COLUMN "absence_date" DROP NOT NULL;
ALTER TABLE "stylist_absences" ADD COLUMN IF NOT EXISTS "leave_type" "LeaveType" NOT NULL DEFAULT 'SICK_LEAVE';
ALTER TABLE "stylist_absences" ADD COLUMN IF NOT EXISTS "leave_portion" "LeavePortion" NOT NULL DEFAULT 'FULL_DAY';
ALTER TABLE "stylist_absences" ADD COLUMN IF NOT EXISTS "custom_start_time" TEXT;
ALTER TABLE "stylist_absences" ADD COLUMN IF NOT EXISTS "custom_end_time" TEXT;
ALTER TABLE "stylist_absences" ADD COLUMN IF NOT EXISTS "processing_status" "LeaveProcessingStatus" NOT NULL DEFAULT 'COMPLETED';

-- Backfill legacy records if any exist
UPDATE "stylist_absences" SET "start_date" = "absence_date", "end_date" = "absence_date" WHERE "absence_date" IS NOT NULL AND "start_date" = CURRENT_DATE;

-- Add Indexes
CREATE INDEX IF NOT EXISTS "stylist_absences_salon_id_start_date_end_date_idx" ON "stylist_absences"("salon_id", "start_date", "end_date");
CREATE INDEX IF NOT EXISTS "stylist_absences_stylist_id_start_date_end_date_idx" ON "stylist_absences"("stylist_id", "start_date", "end_date");
```

### Step 3: Execution Command
```bash
cd backend
npx prisma migrate dev
```

---

## 9. APPROVAL & ENVIRONMENT COMPLIANCE

The connected database is confirmed to be local development (`salon_saas_dev` on `localhost:5432`). However, per mandatory audit guidelines:

**No database changes or migrations have been executed.**
**Migration execution requires explicit approval.**

---

## 10. FINAL STATUS

FINAL STATUS: SCHEMA MISMATCH — MIGRATION REQUIRED
