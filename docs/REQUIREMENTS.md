# Salon Appointment & Customer Management SaaS — Product Requirements Document (PRD)

**Document Version:** 1.0.0  
**Status:** Approved for Architecture & Planning  
**Target Audience:** Engineering, Product, QA, Business Stakeholders  

---

## 1. Executive Summary & Vision

The **Salon Appointment & Customer Management SaaS** is a multi-tenant B2B SaaS platform engineered specifically for independent salons, barbershops, and beauty studios. 

### The Problem
Small and mid-sized salons predominantly manage bookings and operations through fragmented channels: paper diaries, direct phone calls, WhatsApp messages, walk-ins, and manual paper customer records. This causes:
* Double bookings and scheduling chaos during peak hours.
* High customer no-show rates due to lack of automated reminders.
* Severe loss of business when phones are busy or staff is in service.
* Zero visibility into customer retention, staff utilization, or booking source ROI.

### The Solution
A unified, single-engine operations platform where:
1. **Salon Admins & Staff** manage working hours, staff capabilities, services, breaks, holidays, and appointments from a desktop & mobile-responsive dashboard.
2. **Customers** book online seamlessly via a public, frictionless web link (`/book/:salon-slug`) with real-time slot calculation and instant confirmation—no mobile app install required.
3. **Automated WhatsApp Channel** connects directly to the same central booking engine via official Meta Cloud APIs for chat-based conversational bookings, reminders, and confirmations.
4. **Platform Admins** manage salon subscriptions, platform health, tenant activations, and system-wide telemetry.

---

## 2. Business Model & Multi-Tenant Philosophy

* **B2B SaaS Model:** The salon is the paying customer. The salon's clients are end-users who consume booking links or WhatsApp flows.
* **Non-Marketplace:** This is not a consumer directory or discovery marketplace in MVP. Salons drive their own traffic via existing Instagram bios, Google Maps links, WhatsApp status, reception QR codes, and visiting cards.
* **Single-Engine Multi-Tenancy:** One unified codebase, one backend cluster, one relational database. Every tenant's data is strictly isolated using `salon_id` and enforced by tenant-aware queries and backend authorization filters.

```
+-------------------------------------------------------------+
|                     PLATFORM ADMIN                          |
|         (Tenant provisioning, subscriptions, metrics)       |
+-------------------------------------------------------------+
                              |
                              v
+-------------------------------------------------------------+
|                     SaaS BACKEND ENGINE                     |
|           (Unified Multi-Tenant Core Architecture)          |
+-------------------------------------------------------------+
         |                        |                       |
         v                        v                       v
+------------------+    +------------------+    +------------------+
|     Salon A      |    |     Salon B      |    |     Salon C      |
| (salon_id: 101)  |    | (salon_id: 102)  |    | (salon_id: 103)  |
| - Staff          |    | - Staff          |    | - Staff          |
| - Services       |    | - Services       |    | - Services       |
| - Appointments   |    | - Appointments   |    | - Appointments   |
| - Customers      |    | - Customers      |    | - Customers      |
+------------------+    +------------------+    +------------------+
```

---

## 3. User Personas & Roles

| Persona | Description | Primary Interfaces | Key Permissions & Constraints |
| :--- | :--- | :--- | :--- |
| **Platform Admin** | SaaS Operator / Super Admin | Platform Admin Web Dashboard | View all salons, activate/suspend accounts, manage subscription plans, inspect system telemetry & WhatsApp connection statuses. Cannot view client PII without explicit audit logging. |
| **Salon Owner / Admin** | Salon Business Owner or General Manager | Salon Admin Web Dashboard | Full administrative control over their specific salon: manage profile, staff roster, service catalog, working hours, breaks, holidays, blocked slots, appointments, customers, and integration keys. Strictly isolated to their own `salon_id`. |
| **Salon Staff** | Stylist, Barber, Esthetician, Receptionist | Salon Staff Web Dashboard | View daily schedule, create appointments (phone/walk-in), check-in clients, mark services in-progress, completed, or no-show. Restricted from billing, salon settings, and staff salary/financial configs. |
| **End Customer** | Salon Client | Public Web Booking (`/book/:slug`) & WhatsApp | Browse services, select preferred or any available staff, choose available time slots, input name and phone number, confirm appointments, reschedule, or cancel within allowed cancellation windows. No password-based account required for MVP. |

---

## 4. Requirements Categorization (MoSCoW Matrix)

### 4.1 MUST HAVE (MVP Release)
* **Multi-Tenant Foundation:** Tenant isolation via `salon_id`, JWT authentication with salon-scoped RBAC (`PLATFORM_ADMIN`, `SALON_ADMIN`, `STAFF`).
* **Salon Management:** Salon profile, contact details, slug generation, logo, timezone configuration (`Asia/Kolkata`, etc.).
* **Staff Roster:** Staff profile, role, active status, and many-to-many service capability assignment (`StaffService`).
* **Service Catalog:** Service name, duration in minutes, price in local currency, category, and active status.
* **Working Hours & Availability Rules:** Weekly salon working hours, per-staff working hours, scheduled breaks, full-day holidays/closures, and dynamic blocked time slots.
* **Central Availability Engine:** Deterministic calculation of available slots taking into account all 8 constraints (Salon Hours + Staff Hours + Service Capability + Duration + Breaks + Existing Bookings + Blocked Time + Holidays).
* **Double Booking Prevention:** Database-level concurrency control ensuring simultaneous bookings for the same staff member and time slot are safely rejected.
* **Public Web Booking App:** Frictionless mobile-first booking interface at `/book/:salon-slug` with service, staff, date, slot selection, and instant confirmation.
* **Salon Dashboard & Calendar:** Real-time day view, week view, staff filters, today's appointment counter (Confirmed, Completed, Cancelled, No-Show), and quick status updates.
* **Manual & Walk-in Booking:** Staff interface to manually register phone or walk-in appointments with source tracking (`WEB`, `WHATSAPP`, `PHONE`, `WALK_IN`, `MANUAL`).
* **Customer Record Ledger:** Automatic customer creation/lookup by phone number per salon, tracking visit counts, total revenue, cancellations, and appointment history.
* **QR Code Generator:** Public booking URL QR code rendering inside the salon dashboard for printing and reception display.

### 4.2 SHOULD HAVE (Phase 2 — Immediate Post-Pilot)
* **WhatsApp Cloud API Integration:** Webhook receiver, 2-way conversation state machine (`START` $\rightarrow$ `SELECT_SERVICE` $\rightarrow$ `SELECT_STAFF` $\rightarrow$ `SELECT_DATE` $\rightarrow$ `SELECT_TIME` $\rightarrow$ `CONFIRMATION`), and booking creation via the core booking engine.
* **Automated Notifications:** Instant WhatsApp/SMS booking confirmations, cancellation notices, and 24-hour reminder triggers.
* **Customer Rebooking / Quick Rebook:** One-click rebooking interface pre-selecting past services and favorite staff.
* **Booking Rules Customization:** Configurable minimum advance notice (e.g., min 30 mins), maximum booking horizon (e.g., max 30 days), slot intervals (15, 30, 45, 60 mins), and cancellation windows.

### 4.3 NICE TO HAVE (Phase 3)
* **Advanced Analytics & Reports:** Revenue by staff, service popularity breakdown, customer retention cohort rate, no-show rate analytics.
* **Self-Service Salon Onboarding & Subscriptions:** Automated signup flow with Stripe/Razorpay subscription checkout, trial lifecycle management, and tiered plan enforcement.
* **Multi-Branch Support:** Single business owner managing multiple physical salon locations under one billing profile.

### 4.4 NOT NOW (Out of Scope for MVP & Early Phases)
* Marketplace / salon discovery directory.
* Customer native mobile applications (iOS/Android app store downloads).
* AI natural language conversational receptionist.
* Point of Sale (POS) hardware integration and cash drawers.
* Inventory tracking, product sales, supplier orders.
* Staff payroll, commissions, and tip distribution.
* Complex loyalty points, reward vouchers, and customer memberships.
* Facial recognition check-ins and video consultations.

---

## 5. Detailed Feature Specifications

### 5.1 Service & Staff Capability Management
* Each staff member is mapped to one or more services via `StaffService`.
* When a customer or staff creates a booking for "Haircut", only staff members capable of performing "Haircut" and working on that day/time can be selected.
* If "Any Available Staff" is selected, the availability engine unions all eligible staff slots and assigns the first available staff member using round-robin or least-loaded heuristics.

### 5.2 Availability & Booking Engine Constraints
Availability for a given `(salon_id, service_id, staff_id?, date)` query must execute the following deterministic evaluation:
1. **Salon Status:** If the salon is suspended or inactive $\rightarrow$ 0 slots.
2. **Holiday Check:** If the given date matches a `Holiday` record for the salon $\rightarrow$ 0 slots.
3. **Staff Eligibility:** Determine eligible staff IDs who are active and linked to `service_id`. If `staff_id` is supplied, verify it exists within eligible staff.
4. **Working Hours Intersection:** For each eligible staff member, retrieve their working hours for that day of week. If not defined, fallback to salon working hours.
5. **Slot Generation:** Generate time slices starting from opening time to closing time, spaced by `slot_interval` (default 30 mins), where `slot_start + service_duration <= closing_time`.
6. **Break Subtraction:** Exclude any time slice overlapping with staff/salon `Break` intervals.
7. **Blocked Time Subtraction:** Exclude any time slice overlapping with active `BlockedTime` records.
8. **Existing Appointment Conflict:** Exclude any time slice overlapping with non-cancelled appointments (`PENDING`, `CONFIRMED`, `CHECKED_IN`, `IN_SERVICE`).
9. **Advance Booking Constraints:** If date is today, exclude slots where `slot_start < now() + minimum_advance_booking_minutes`. Exclude dates beyond `maximum_advance_booking_days`.

### 5.3 Appointment State Machine
Transitions between appointment statuses must be strictly validated:

```
                  +------------+
                  |  PENDING   |
                  +------------+
                        |
                        v
                  +------------+
                  | CONFIRMED  | <-------------------+
                  +------------+                     |
                   /     |      \                    |
                  /      |       \                   | (Reschedule)
                 v       v        v                  |
        +------------+ +-------+ +-----------+       |
        | CHECKED_IN | |CANCEL | |  NO_SHOW  |       |
        +------------+ +-------+ +-----------+       |
               |                                     |
               v                                     |
        +------------+                               |
        | IN_SERVICE |                               |
        +------------+                               |
               |                                     |
               v                                     |
        +------------+                               |
        | COMPLETED  |                               |
        +------------+                               |
               |                                     |
               +-------------------------------------+
```

* **Valid Transitions:**
  * `PENDING` $\rightarrow$ `CONFIRMED`, `CANCELLED`
  * `CONFIRMED` $\rightarrow$ `CHECKED_IN`, `CANCELLED`, `NO_SHOW`, `RESCHEDULED`
  * `CHECKED_IN` $\rightarrow$ `IN_SERVICE`, `CANCELLED`
  * `IN_SERVICE` $\rightarrow$ `COMPLETED`
  * `RESCHEDULED` $\rightarrow$ creates a new appointment linked to the prior ID and marks old record as `RESCHEDULED`.
* Status modifications record an immutable audit entry in `AppointmentStatusHistory`.

### 5.4 Double Booking Prevention Strategy
Frontend checks alone are vulnerable to race conditions when two customers submit the same slot simultaneously. The backend must enforce:
1. **Database Transaction:** Execute the booking insertion inside an `ISOLATION LEVEL SERIALIZABLE` or `READ COMMITTED` with row-level locks.
2. **Atomic Verification:** Re-verify slot availability inside the active transaction immediately before insert.
3. **Database GiST Exclusion or Unique Slot Lock:** Leverage PostgreSQL constraints or an atomic advisory lock key `(salon_id, staff_id, date, start_time)` to reject concurrent overlapping appointments with a friendly `409 Conflict` error.

---

## 6. Ambiguities & Missing Requirements Analysis

| Identified Item | Ambiguity in Raw Requirement | Architectural Resolution for Production |
| :--- | :--- | :--- |
| **Customer Identification** | How is a customer identified if there are no passwords or app logins? | Customer is uniquely identified per salon by **E.164 formatted Phone Number** (`salon_id + phone`). Name updates merge under the same customer record. |
| **"Any Available Staff" Assignment** | When a customer picks "Any Available", which staff gets booked? | Deterministic selection: pick the eligible staff member with the lowest appointment count on that date (balanced workload). |
| **Service Duration vs Slot Interval** | If a service is 45 minutes and slot interval is 30 minutes, how is the calendar blocked? | The slot starts at `10:00` and occupies `10:00 - 10:45`. The next valid slot for that staff member is `11:00` (next 30-min boundary after end time). |
| **Walk-in Time Handling** | Walk-ins arrive immediately without advance notice. | Walk-in creation bypasses the `minimum_advance_booking` rule but strictly validates that the staff member is not currently occupied. |
| **Timezone Storage** | How are dates and times stored across different global salons? | All database timestamps are stored in UTC (`TIMESTAMPTZ`). Each salon stores its IANA Timezone string (`Asia/Kolkata`). Slot generation renders in the salon's local timezone. |

---

## 7. Definition of Done (MVP Acceptance Criteria)

1. [x] **Tenant Setup:** Platform Admin can provision a new salon, admin user, and initial booking slug.
2. [x] **Catalog & Roster:** Salon Admin can configure working hours, add staff, add services, and link staff to services.
3. [x] **Availability Calculation:** Availability API accurately returns available 30-min slots respecting breaks, holidays, blocked times, and existing bookings.
4. [x] **Public Web Booking:** Customers can visit `/book/:salon-slug` on mobile/desktop, pick service, staff, slot, and complete a confirmed booking.
5. [x] **Dashboard Synchronization:** Newly created booking appears immediately in the Salon Admin calendar without page refresh.
6. [x] **Concurrency Safety:** Simulated concurrent booking test on the same slot allows exactly 1 booking and returns a polite conflict message to the other.
7. [x] **Manual & Walk-in Bookings:** Receptionist can create phone and walk-in appointments from the dashboard.
8. [x] **Customer History:** Salon Admin can view customer profiles with total visits, lifetime spend, and past appointment history.
9. [x] **Zero Cross-Tenant Leakage:** Automated security tests verify that Salon A user receives `403 Forbidden` or `404 Not Found` when requesting Salon B resources.
