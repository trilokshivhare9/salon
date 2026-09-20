# Quick Booking Implementation Report

## Overview
In-Salon Quick Booking allows walk-in physical customers at a salon to scan a QR code / initiate WhatsApp booking using a daily 4-digit numeric code (`SalonQuickCode`). The customer is immediately assigned the earliest available slot today and an eligible stylist via `AppointmentsService.createAppointment()`, creating the appointment directly with `status = CHECKED_IN` and `source = QUICK_BOOK`.

---

## 1. Files Changed & Created

### Created Files
1. [`backend/src/modules/quick-booking/quick-code.service.ts`](file:///Users/trilokshivhare/Documents/New%20project/sall/backend/src/modules/quick-booking/quick-code.service.ts)
   - Handles 4-digit cryptographic random code generation (`crypto.randomInt`), local date tracking, per-salon/per-phone rate limiting (5 failed attempts trigger 10-minute lockouts), and code verification.
2. [`backend/src/modules/quick-booking/quick-booking.controller.ts`](file:///Users/trilokshivhare/Documents/New%20project/sall/backend/src/modules/quick-booking/quick-booking.controller.ts)
   - Exposes `GET /salons/:salonId/quick-code` and `POST /salons/:salonId/quick-code` for `SALON_OWNER` (own tenant) and `SUPER_ADMIN` (any tenant).
3. [`backend/src/modules/quick-booking/quick-booking.module.ts`](file:///Users/trilokshivhare/Documents/New%20project/sall/backend/src/modules/quick-booking/quick-booking.module.ts)
   - Encapsulates Quick Booking services and controllers.
4. [`backend/src/modules/quick-booking/quick-code.service.spec.ts`](file:///Users/trilokshivhare/Documents/New%20project/sall/backend/src/modules/quick-booking/quick-code.service.spec.ts)
   - Comprehensive unit test suite for code generation, 5-attempt threshold, 10-min lockout, regeneration, and timezone safety.

### Modified Files
1. [`backend/prisma/schema.prisma`](file:///Users/trilokshivhare/Documents/New%20project/sall/backend/prisma/schema.prisma)
   - Added `BookingSource.QUICK_BOOK`, `ConversationState.QUICK_BOOK_CODE`, `ConversationState.QUICK_BOOK_CONFIRM`, `Conversation` fields (`quickCodeVerifiedAt`, `quickCodeAttempts`, `quickCodeLockedUntil`), and `SalonQuickCode` model.
2. [`backend/src/app.module.ts`](file:///Users/trilokshivhare/Documents/New%20project/sall/backend/src/app.module.ts)
   - Imported `QuickBookingModule`.
3. [`backend/src/modules/appointments/appointments.service.ts`](file:///Users/trilokshivhare/Documents/New%20project/sall/backend/src/modules/appointments/appointments.service.ts)
   - Added `InternalCreateAppointmentOptions` export (`initialStatus?: AppointmentStatus`).
   - Standardized `createAppointment()` past slot validation, universal salon closed/operating hours boundary, dynamic initial status (`CONFIRMED` by default, `CHECKED_IN` for internal Quick Book caller).
   - Exempted `QUICK_BOOK` appointments from customer penalty strikes upon cancellation before service start.
   - Updated `formatAppointment` mapping to preserve `appt.salonUser?.user` structure.
4. [`backend/src/modules/availability/availability.service.ts`](file:///Users/trilokshivhare/Documents/New%20project/sall/backend/src/modules/availability/availability.service.ts)
   - Enforced hard salon operating boundary for custom-schedule stylists (custom schedule cannot expand beyond salon operating window).
5. [`backend/src/modules/whatsapp/whatsapp.module.ts`](file:///Users/trilokshivhare/Documents/New%20project/sall/backend/src/modules/whatsapp/whatsapp.module.ts)
   - Imported `QuickBookingModule`.
6. [`backend/src/modules/whatsapp/whatsapp.service.ts`](file:///Users/trilokshivhare/Documents/New%20project/sall/backend/src/modules/whatsapp/whatsapp.service.ts)
   - Added `⚡ Quick Book` button to main welcome menu.
   - Handled `btn_quick_book` action transitioning to `QUICK_BOOK_CODE`.
   - Implemented `QUICK_BOOK_CODE` input validation via `QuickCodeService.verifyCode()`.
   - Updated `handleServiceChosen` to check for active `quickCodeVerifiedAt` proof, fetching the earliest slot today and transitioning to `QUICK_BOOK_CONFIRM`.
   - Handled `QUICK_BOOK_CONFIRM` user response by calling `createAppointment()` with `initialStatus: CHECKED_IN`.
   - Handled context reset on `"hi"` message, normal booking path, or timeout.

---

## 2. Database Changes
- Migration `20260920150000_add_quick_booking_support` executed via `prisma migrate dev`.
- Added Enum Value: `BookingSource.QUICK_BOOK`
- Added Enum Values: `ConversationState.QUICK_BOOK_CODE`, `ConversationState.QUICK_BOOK_CONFIRM`
- Added `Conversation` columns:
  - `quickCodeVerifiedAt DateTime?`
  - `quickCodeAttempts Int @default(0)`
  - `quickCodeLockedUntil DateTime?`
- Created Table `SalonQuickCode`:
  - `id String @id @default(uuid())`
  - `salonId String @unique`
  - `code String`
  - `validDate String`
  - `createdAt DateTime @default(now())`
  - `updatedAt DateTime @updatedAt`
  - FK to `Salon(id)` on delete cascade.

---

## 3. API Changes
- `GET /salons/:salonId/quick-code`: Returns existing code or generates a new 4-digit code for today. Restricted to `SALON_OWNER` (matching salon ID) or `SUPER_ADMIN`.
- `POST /salons/:salonId/quick-code`: Forces immediate code regeneration, rendering any prior code invalid.

---

## 4. WhatsApp Flow Architecture
- Welcome menu displays two options: `📅 Book Slot` and `⚡ Quick Book`.
- When `⚡ Quick Book` is selected, state moves to `QUICK_BOOK_CODE`. Customer prompts for code.
- If code is invalid <5 times, user receives retry prompt. Upon 5th failure, a 10-minute lockout is enforced for `(salonId + customerPhone)`.
- If code is valid, `quickCodeVerifiedAt` is stored on `Conversation` and state transitions to standard category/service selection.
- Upon service choice, `handleServiceChosen` checks for active `quickCodeVerifiedAt` (valid within 30 min). It calculates the earliest available slot today using `AvailabilityService.getAvailableSlots()`, displays TIME ONLY, and sets state to `QUICK_BOOK_CONFIRM`.
- On user confirmation, `AppointmentsService.createAppointment()` is invoked with `{ initialStatus: CHECKED_IN }`.
- Returned appointment details (`bookingNumber`, `service`, `startAt`, `stylist.name`, `status`) are dispatched to customer. Context is cleared.

---

## 5. Dashboard Real-Time Integration
- Quick Booking appointments are created directly as `status: CHECKED_IN`, `source: QUICK_BOOK`.
- Emits standard `NEW_BOOKING` SSE event to connected dashboard clients.
- Triggers existing audio notification chime and adds appointment directly to the Checked-In queue.

---

## 6. Shared Scheduling & Boundary Fixes
- `AvailabilityService` and `AppointmentsService` enforce hard salon open/closed operating hours for all stylists. Custom stylist hours can only narrow, never expand beyond salon open window. Salon closed = 0 available slots.

---

## 7. Reused Core Abstractions
- `AppointmentsService.createAppointment()`: Used for single-transaction appointment creation, advisory locks, customer overlap checks, blocked customer checks, service validation, stylist eligibility.
- `AvailabilityService.getAvailableSlots()`: Used for slot calculations.
- `PrismaService` & PostgreSQL advisory locks (`pg_advisory_xact_lock`): Used for concurrency protection.
