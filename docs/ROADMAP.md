# Phased Development Roadmap & Execution Plan

**Document Version:** 1.0.0  
**Methodology:** Iterative Milestone-Driven Delivery  
**Primary Pilot Goal:** 1 Real Salon operational for 2-4 weeks with real staff and customers.

---

## 1. Phase Overview & Timeline

```
+-----------------------------------------------------------------------------------------------+
| PHASE 0: Discovery & Architecture (COMPLETE)                                                  |
| - Requirements, System Design, Schema, API Specs, Security Model, ADRs, Documentation        |
+-----------------------------------------------------------------------------------------------+
                                                |
                                                v
+-----------------------------------------------------------------------------------------------+
| PHASE 1: Backend Foundation & Multi-Tenant Core (Sprint 1)                                    |
| - NestJS scaffolding, Prisma schema, PostgreSQL DB, JWT Auth, RBAC, Tenant Context Middleware |
+-----------------------------------------------------------------------------------------------+
                                                |
                                                v
+-----------------------------------------------------------------------------------------------+
| PHASE 2: Salon, Staff & Service Catalog Management (Sprint 2)                                 |
| - Salon profile, Staff roster, Service definitions, Staff-Service mappings, Working hours DB  |
+-----------------------------------------------------------------------------------------------+
                                                |
                                                v
+-----------------------------------------------------------------------------------------------+
| PHASE 3: Central Availability Calculation Engine (Sprint 3)                                   |
| - Deterministic slot math, breaks, holidays, blocked slots, advance rules, exhaustive tests   |
+-----------------------------------------------------------------------------------------------+
                                                |
                                                v
+-----------------------------------------------------------------------------------------------+
| PHASE 4: Appointment Engine & Concurrency Safety (Sprint 4)                                   |
| - Atomic booking creation, state machine transitions, GiST exclusion locks, 409 conflict test |
+-----------------------------------------------------------------------------------------------+
                                                |
                                                v
+-----------------------------------------------------------------------------------------------+
| PHASE 5: Salon Web Dashboard & Daily Calendar (Sprint 5)                                      |
| - Day & Week calendar view, staff filters, check-in/completion actions, walk-in/phone booking  |
+-----------------------------------------------------------------------------------------------+
                                                |
                                                v
+-----------------------------------------------------------------------------------------------+
| PHASE 6: Public Web Booking Experience (/book/:slug) (Sprint 6)                               |
| - Mobile-first client flow: service -> staff -> date/slot -> confirmation card + QR code      |
+-----------------------------------------------------------------------------------------------+
                                                |
                                                v
+-----------------------------------------------------------------------------------------------+
| PHASE 7: Single-Salon Production Pilot (2–4 Weeks Field Validation)                           |
| - Real salon deployment, live booking links on Instagram/reception QR, feedback collection    |
+-----------------------------------------------------------------------------------------------+
                                                |
                                                v
+-----------------------------------------------------------------------------------------------+
| PHASE 8: WhatsApp Cloud API Bot & State Machine (Sprint 7)                                    |
| - Meta webhook integration, conversational booking state machine, automated confirmations     |
+-----------------------------------------------------------------------------------------------+
                                                |
                                                v
+-----------------------------------------------------------------------------------------------+
| PHASE 9: Retention Engine, Automated Reminders & Customer CRM (Sprint 8)                      |
| - 24-hr reminder scheduler, quick rebooking links, customer visit ledger and spend metrics    |
+-----------------------------------------------------------------------------------------------+
                                                |
                                                v
+-----------------------------------------------------------------------------------------------+
| PHASE 10: Multi-Salon SaaS Scaling & Automated Onboarding (Sprint 9+)                          |
| - Self-service registration, subscription billing (Stripe/Razorpay), multi-branch support     |
+-----------------------------------------------------------------------------------------------+
```

---

## 2. Detailed Phase Breakdown

### Phase 1: Backend Foundation & Multi-Tenant Core
* **Tasks:**
  * Initialize NestJS project with TypeScript, strict linting, and Docker Compose environment.
  * Setup Prisma ORM with PostgreSQL and execute initial schema migration.
  * Implement `AuthModule`: User registration, Argon2 password hashing, JWT access/refresh token generation.
  * Implement `TenantInterceptor` & `JwtAuthGuard` to isolate tenant context.
  * Global exception filter and standard API response envelope.
* **Definition of Done:** User can log in, receive a valid JWT, and endpoints properly enforce `UserRole` and `salon_id` boundaries.

---

### Phase 2: Salon, Staff & Service Catalog Management
* **Tasks:**
  * Implement `SalonsModule`: Profile CRUD, slug generation, timezone configuration.
  * Implement `StaffModule`: Staff profiles, active status, staff-service mapping.
  * Implement `ServicesModule`: Category, price, duration in minutes, status.
  * Implement `WorkingHoursModule`: Weekly salon opening hours, staff working hours, breaks, and holiday closures.
* **Definition of Done:** Salon owner can configure full salon roster, working hours, and service menu via authenticated API.

---

### Phase 3: Central Availability Calculation Engine
* **Tasks:**
  * Implement `AvailabilityModule` and core `AvailabilityService.getAvailableSlots()`.
  * Incorporate salon hours, staff hours, service duration, breaks, holidays, and blocked times.
  * Implement "Any Available Staff" aggregate slot calculation.
  * Unit test suite covering all 8 boundary conditions.
* **Definition of Done:** `GET /booking/:slug/availability` accurately returns valid 30-min start slots with zero leakage during breaks or holidays.

---

### Phase 4: Appointment Engine & Concurrency Safety
* **Tasks:**
  * Implement `AppointmentsModule`: Create, read, reschedule, cancel, check-in, complete, no-show.
  * Integrate database transactions and PostgreSQL GiST exclusion lock to prevent double booking.
  * Implement `AppointmentStatusHistory` auditing.
  * Write automated concurrency test simulating 10 parallel booking requests on 1 slot.
* **Definition of Done:** Exactly 1 concurrent request succeeds with `201 Created` while 9 receive `409 Conflict`.

---

### Phase 5: Salon Web Dashboard & Daily Calendar
* **Tasks:**
  * Build responsive Dashboard UI: Today's appointment overview, Day view, Week view.
  * Filter by staff member and status.
  * Modal for creating manual / walk-in bookings with source tracking.
  * Fast status toggle buttons (Check In, Start Service, Complete, Cancel, No-Show).
* **Definition of Done:** Salon receptionist can manage the daily flow of appointments on a tablet or desktop browser without bugs.

---

### Phase 6: Public Web Booking Experience (`/book/:slug`)
* **Tasks:**
  * Build frictionless mobile-first public booking flow at `/book/:salonSlug`.
  * Steps: Service Selection $\rightarrow$ Staff Selection ("Specific" / "Any Available") $\rightarrow$ Date & Time Slot Selection $\rightarrow$ Customer Name & Phone $\rightarrow$ Confirmation screen.
  * Generate downloadable / printable QR Code for the salon's reception counter.
* **Definition of Done:** An end customer can complete an appointment booking from their mobile browser in under 45 seconds.

---

### Phase 7: Real Single-Salon Pilot
* **Tasks:**
  * Provision production database and backend deployment.
  * Onboard Pilot Salon (staff, services, hours, booking rules).
  * Print reception QR code and update salon Instagram bio link.
  * Run 2-4 weeks of live pilot operations; capture all operational issues.
* **Definition of Done:** Salon processes real daily client bookings exclusively through the platform with positive feedback.

---

### Phase 8: WhatsApp Cloud API Bot & State Machine
* **Tasks:**
  * Implement `WhatsAppModule` with Meta Cloud API webhook receiver.
  * Implement 8-step conversation state machine in PostgreSQL.
  * Route WhatsApp selections directly to `AvailabilityService` and `AppointmentService`.
  * Dispatch instant booking confirmation message via WhatsApp.
* **Definition of Done:** Customer texting "Hi" to the salon's WhatsApp number can complete an appointment reservation end-to-end.
