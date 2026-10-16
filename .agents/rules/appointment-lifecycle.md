# Appointment Table Modification & Lifecycle Invariant

## Architectural Invariants (Strict & Mandatory)

### Rule 1: Centralized Appointment Mutation
1. **NEVER** write or execute direct updates on the `Appointment` table for status, alarms, notes, ETA, cancellations, or reschedules (e.g. `prisma.appointment.update({ data: { status: ... } })`) outside `AppointmentModifierService`.
2. **ALL** status changes, cancellations, reschedules, check-ins, completions, and auto-expirations **MUST** go through `AppointmentModifierService.modifyStatus()`.
3. Initial booking creation must arm its alarms via `AppointmentModifierService.syncAlarm()`.

### Rule 2: Private Next-Action Calculation Engine
1. **`AppointmentNextActionService`** is private and internal to `AppointmentModifierService`.
2. **NO OTHER FILE OR SERVICE** is permitted to import, inject, export, or call `AppointmentNextActionService`.
3. Any service needing alarms or state changes simply calls `AppointmentModifierService.modifyStatus()` or `AppointmentModifierService.syncAlarm()`, and `AppointmentModifierService` handles the Next Action calculation internally.

## Two Core Files
- **`AppointmentNextActionService` (`src/modules/salon-admin/appointments/next-action/appointment-next-action.service.ts`):**
  - Pure calculation engine.
  - Given appointment status, timestamps, and clientEtaStatus, returns `{ nextActionAt, nextActionType }`.
  - Zero database queries, zero Redis calls.
  - **Exclusively consumed by `AppointmentModifierService`.**

- **`AppointmentModifierService` (`src/modules/salon-admin/appointments/modifier/appointment-modifier.service.ts`):**
  - Sole authorized writer for updating records in `model Appointment`.
  - Enforces state transition matrix (`VALID_STATUS_TRANSITIONS`).
  - Calls `AppointmentNextActionService` internally to compute the next lifecycle action.
  - Updates PostgreSQL in a single atomic SQL write.
  - Updates / clears Redis alarms (`redisService.setAlarm` or `redisService.clearAlarm`).
  - Emits real-time `STATUS_UPDATED` events via SSE/WebSockets.

## Enforcement
These architectural invariants are enforced via automated static analysis tests:
- `test/unit/architecture/appointment-mutation-guard.spec.ts` (verifies that ONLY `AppointmentModifierService` executes appointment status updates in Prisma).
- `test/unit/architecture/appointment-next-action-guard.spec.ts` (verifies that ONLY `AppointmentModifierService` imports or uses `AppointmentNextActionService`).
Any violation will fail CI immediately.
