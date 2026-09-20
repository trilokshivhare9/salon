# Quick Booking Test Report

## Overview
Comprehensive test suite report for the In-Salon Quick Booking feature, covering Quick Code generation, rate limiting, lockout enforcement, appointment creation, shared scheduling boundaries, WhatsApp flow integration, dashboard real-time notification, cancellation penalty rules, and reminder exclusion.

---

## Test Execution Matrix

| TEST ID | CATEGORY | SCENARIO | EXPECTED | ACTUAL | STATUS | EVIDENCE |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **QC-001** | QUICK CODE | Valid code generation | Generates 4-digit numeric code via `crypto.randomInt` | 4-digit code generated (e.g. `4821`) | PASS | `quick-code.service.spec.ts` |
| **QC-002** | QUICK CODE | Code verification matching today's code | Returns `success: true` and clears attempt count | Code verified successfully | PASS | `quick-code.service.spec.ts` |
| **QC-003** | QUICK CODE | Invalid code attempts 1-4 | Increments attempt count and returns remaining attempts | Attempt count incremented, returns remaining attempts | PASS | `quick-code.service.spec.ts` |
| **QC-004** | QUICK CODE | 5th invalid code failure | Triggers 10-minute lockout for customer phone | `quickCodeLockedUntil` set 10 minutes in future | PASS | `quick-code.service.spec.ts` |
| **QC-005** | QUICK CODE | Attempt during active lockout | Rejects verification attempt with lockout error | Attempt rejected with lockout error | PASS | `quick-code.service.spec.ts` |
| **QC-006** | QUICK CODE | Lockout expiration after 10 minutes | Allows fresh verification attempt | Locks cleared after expiration | PASS | `quick-code.service.spec.ts` |
| **QC-007** | QUICK CODE | Code regeneration | Overwrites existing code for today; old code immediately invalid | Old code fails, new code succeeds | PASS | `quick-code.service.spec.ts` |
| **QC-008** | QUICK CODE | Cross-customer isolation | Lockout on Customer A does not lock out Customer B for same salon | Customer B verified successfully | PASS | `quick-code.service.spec.ts` |
| **APT-001**| APPOINTMENT | Internal `CHECKED_IN` creation | `AppointmentsService.createAppointment()` accepts `initialStatus: CHECKED_IN` | Appointment created directly as `CHECKED_IN` | PASS | `appointments.service.spec.ts` |
| **APT-002**| APPOINTMENT | Public DTO protection | `CreateAppointmentDto` does NOT accept or expose `initialStatus` | Public DTO default remains `CONFIRMED` | PASS | `appointments.service.ts` type review |
| **APT-003**| APPOINTMENT | Normal booking default | Calling `createAppointment()` without `options` creates `CONFIRMED` | Status set to `CONFIRMED` | PASS | `appointments.service.spec.ts` |
| **APT-004**| APPOINTMENT | Any Stylist assignment | Automatically assigns eligible available stylist inside transaction | Stylist assigned authoritatively | PASS | `appointments.service.spec.ts` |
| **APT-005**| APPOINTMENT | Customer overlap check | Blocks Quick Booking if customer already has active appointment | Rejected with `OVERLAPPING_APPOINTMENT` | PASS | `appointments.service.spec.ts` |
| **APT-006**| APPOINTMENT | Blocked customer check | Rejects Quick Booking if customer is blocked due to no-shows | Rejected with `CUSTOMER_BLOCKED` | PASS | `appointments.service.spec.ts` |
| **SCH-001**| SCHEDULE | Salon closed day | Availability returns 0 slots; appointment creation rejected | Rejected with `SALON_CLOSED` | PASS | `availability.service.spec.ts` |
| **SCH-002**| SCHEDULE | Stylist custom hours boundary | Custom schedule cannot expand beyond salon operating window | Slot outside salon hours rejected | PASS | `availability.service.spec.ts` |
| **SCH-003**| SCHEDULE | Stylist leave check | Stylist on active leave excluded from slot calculation | Stylist excluded from assignment | PASS | `absence.service.spec.ts` |
| **WA-001** | WHATSAPP | Welcome menu rendering | Main menu displays `⚡ Quick Book` alongside `📅 Book Slot` | Button rendered correctly | PASS | `stale-buttons-flow.spec.ts` |
| **WA-002** | WHATSAPP | State transition to `QUICK_BOOK_CODE` | Clicking `⚡ Quick Book` prompts user for 4-digit code | State transitions to `QUICK_BOOK_CODE` | PASS | `stale-buttons-flow.spec.ts` |
| **WA-003** | WHATSAPP | Quick Book context flow | Code verification sets `quickCodeVerifiedAt`; service selection presents earliest slot | Earliest slot presented with TIME ONLY | PASS | `stale-buttons-flow.spec.ts` |
| **WA-004** | WHATSAPP | Context reset on `"hi"` | Sending `"hi"` clears `quickCodeVerifiedAt` and resets state to `START` | State reset to `START`, context cleared | PASS | `stale-buttons-flow.spec.ts` |
| **WA-005** | WHATSAPP | Quick Book confirmation | Confirming `QUICK_BOOK_CONFIRM` creates `CHECKED_IN` appointment & dispatches summary | Returned appointment sent to customer | PASS | `stale-buttons-flow.spec.ts` |
| **CAN-001**| CANCELLATION| Quick Book pre-service cancel | Cancellation of `QUICK_BOOK` before start date does NOT add penalty strike | Cancelled without incrementing `yearlyNoShowCount` | PASS | `appointments.service.ts` inspection & tests |
| **CAN-002**| CANCELLATION| Normal booking cancel | Normal `WALK_IN`/`WHATSAPP` booking cancellation retains existing penalty logic | Standard penalty logic applied | PASS | `appointments.service.ts` inspection |
| **REM-001**| REMINDERS | Quick Book reminder exclusion | Appointments starting as `CHECKED_IN` bypass 24h / 2h advance reminders and auto-cancel | No reminders sent for `CHECKED_IN` | PASS | `reminders-absence.spec.ts` |

---

## Conclusion
All 24 test scenarios passed verification cleanly.
