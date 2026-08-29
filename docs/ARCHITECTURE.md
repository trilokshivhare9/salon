# System Architecture & Technical Design

**Document Version:** 1.0.0  
**Target Platform:** Multi-Tenant Web & Cloud Platform  
**Backend Framework:** Node.js (NestJS + TypeScript)  
**Database ORM:** PostgreSQL + Prisma  
**Frontend Framework:** Flutter Web / Modern Responsive Web  

---

## 1. High-Level Architecture Overview

The system follows a modular, tenant-isolated layered architecture. All customer-facing and internal channels feed into a single, unified **Core Booking Engine** and **Business Logic Layer**.

```
+-----------------------------------------------------------------------------------+
|                                CLIENT CHANNELS                                    |
|                                                                                   |
|  +--------------------+   +-----------------------+   +------------------------+  |
|  |  Public Web Booking|   |   Salon Admin / Staff |   | WhatsApp Cloud API     |  |
|  |  (/book/:slug)     |   |   Dashboard           |   | (Incoming Webhook)     |  |
|  +--------------------+   +-----------------------+   +------------------------+  |
+-----------------------------------------------------------------------------------+
                                         |
                                         v (HTTPS / TLS 1.3 / JSON REST API)
+-----------------------------------------------------------------------------------+
|                             API GATEWAY & SECURITY LAYER                          |
|                                                                                   |
|  - Rate Limiting (Throttler)             - Helmet Security Headers                |
|  - CORS Policy                           - Global Request ID & Logging Interceptor|
|  - JWT Authentication Guard              - Tenant Context Resolution Interceptor  |
|  - Role-Based Access Control (RBAC Guard)- Global Validation & Exception Filter   |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|                             CORE BACKEND MODULES (NestJS)                         |
|                                                                                   |
|  +--------------+  +--------------+  +--------------+  +----------------------+   |
|  | Auth Module  |  | Salon Module |  | Staff Module |  | Service Module       |   |
|  +--------------+  +--------------+  +--------------+  +----------------------+   |
|                                                                                   |
|  +----------------------------------------------------------------------------+   |
|  |                     CENTRAL BOOKING & AVAILABILITY ENGINE                  |   |
|  |  - Slot Generator (Weekly, Daily, Custom breaks, Holidays, Blocked Slots)  |   |
|  |  - Double-Booking Prevention & Concurrency Transaction Manager             |   |
|  |  - Staff Allocation Heuristic (Preferred vs Any Available)                 |   |
|  +----------------------------------------------------------------------------+   |
|                                                                                   |
|  +--------------+  +--------------+  +--------------+  +----------------------+   |
|  | Appointment  |  | Customer     |  | Notification |  | WhatsApp State       |   |
|  | Module       |  | Module       |  | Module       |  | Machine Module       |   |
|  +--------------+  +--------------+  +--------------+  +----------------------+   |
|                                                                                   |
|  +--------------+  +--------------+  +----------------------------------------+   |
|  | Audit Log    |  | Subscription |  | Reports & Analytics                    |   |
|  | Module       |  | Module       |  | Module                                 |   |
|  +--------------+  +--------------+  +----------------------------------------+   |
+-----------------------------------------------------------------------------------+
                                         |
                                         v (Prisma ORM with Tenant Filters)
+-----------------------------------------------------------------------------------+
|                             PERSISTENCE & STORAGE LAYER                           |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  |                         PostgreSQL Relational Database                      |  |
|  |  - B-Tree & GiST Spatial/Temporal Indexes                                   |  |
|  |  - Explicit Foreign Keys with ON DELETE CASCADE / RESTRICT                  |  |
|  |  - UTC Timestamps with Salon Timezone Projection                            |  |
|  +-----------------------------------------------------------------------------+  |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  |                         Redis Cache & Job Queue (Optional/Phase 2)          |  |
|  |  - WhatsApp Webhook Deduplication                                           |  |
|  |  - Async Reminder Notification Worker                                       |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

---

## 2. Multi-Tenancy Design

### 2.1 Multi-Tenancy Strategy: Shared Database, Shared Process, Row-Level Isolation
* **Why not Database-per-tenant?** Excessive infrastructure cost, connection pool fragmentation, and painful migration complexity for hundreds of small salons.
* **Why not Schema-per-tenant?** Heavy PostgreSQL DDL lock overhead during schema migrations and poor pooling efficiency.
* **Chosen Approach:** Single shared schema with strict row-level `salon_id` columns and programmatic tenant scoping.

### 2.2 Tenant Context Lifecycle in NestJS

```
Incoming Request
       |
       v
1. Extract JWT Bearer Token / Route Parameter (:salonSlug)
       |
       v
2. TenantContextMiddleware / AuthGuard:
   - For Authenticated Routes: Extract `user.salon_id` and `user.role` from verified JWT.
   - For Public Booking Routes: Resolve `salonSlug` to `salon.id` and cache salon metadata.
       |
       v
3. Set Request Context: Attach `req.tenant = { salonId, timezone, role }`
       |
       v
4. Service / Repository Layer:
   - Every Prisma query MUST inject `where: { salonId: req.tenant.salonId, ... }`
   - Prisma Client Extensions automatically enforce tenant scope on all tenant-specific entities.
       |
       v
5. Data Returned (Guaranteed zero cross-tenant contamination)
```

---

## 3. Central Booking & Availability Engine

The availability engine is the mathematical core of the entire platform. No client interface (Web, WhatsApp, Dashboard) ever calculates available time slots independently.

### 3.1 Slot Generation Algorithm (`getAvailableSlots`)

Given: `salonId`, `serviceId`, `staffId?` (optional), `date` (YYYY-MM-DD)

```
                       Start: getAvailableSlots()
                                  |
                                  v
           1. Load Salon Metadata, Timezone & Booking Rules
                                  |
                                  v
             Is Salon Active & Open on given Date?
               /                             \
             No                              Yes
             /                                 \
      Return Empty Slots                        v
                                   2. Load Service Duration
                                                |
                                                v
                               3. Resolve Eligible Active Staff
                        (If staffId provided, verify qualified)
                                                |
                                                v
                        4. For Each Eligible Staff Member:
                           a. Fetch Staff Working Hours for Day
                           b. Generate Candidate Slots: [start, end)
                              with slot_interval steps
                           c. Subtract Staff Breaks
                           d. Subtract Salon & Staff Blocked Times
                           e. Subtract Existing Active Appointments
                              (PENDING, CONFIRMED, CHECKED_IN, IN_SERVICE)
                           f. Filter by Advance Booking Constraints:
                              - min advance notice (e.g. now + 30 mins)
                              - max booking horizon (e.g. today + 30 days)
                                                |
                                                v
                         5. Merge / Union Valid Staff Slots
                        (Aggregate slots if "Any Available" selected)
                                                |
                                                v
                          Return Formatted Available Slots:
                         [ { time: "10:00", staffIds: [...] }, ... ]
```

---

## 4. Double-Booking Prevention & Concurrency Architecture

### 4.1 The Race Condition Problem
When two customers attempt to book the exact same staff member at `17:00` simultaneously, both may observe the slot as available during the read phase.

### 4.2 Three-Tier Concurrency Defense

1. **Tier 1: Application Transaction with Row Locking**
   * Inside a Prisma interactive transaction `$transaction(async (tx) => { ... })`:
   * Acquire a PostgreSQL advisory lock or lock the staff member's day schedule row:
     ```sql
     SELECT pg_advisory_xact_lock(hashtext(concat(salon_id, staff_id, date_str)));
     ```
   * Re-evaluate availability within the locked transaction boundary.
   * If available, insert the appointment and commit. If unavailable, abort and throw `ConflictException(409)`.

2. **Tier 2: PostgreSQL Temporal Range Exclusion Constraint (GiST)**
   * At the database engine level, an appointment time interval cannot overlap with another active appointment for the same staff member:
     ```sql
     CREATE EXTENSION IF NOT EXISTS btree_gist;
     ALTER TABLE appointments 
     ADD CONSTRAINT no_overlapping_staff_appointments 
     EXCLUDE USING gist (
       staff_id WITH =,
       tstzrange(start_time, end_time) WITH &&
     ) WHERE (status NOT IN ('CANCELLED', 'NO_SHOW', 'RESCHEDULED'));
     ```
   * If any race condition ever bypasses application logic, the database immediately aborts the insertion with constraint violation code `23P01`.

3. **Tier 3: Graceful Client Recovery**
   * Frontend receives `409 Conflict` with a payload containing updated available alternative slots for immediate one-tap selection.

---

## 5. Timezone Management Architecture

* **Database Standard:** Every timestamp is stored in PostgreSQL as `TIMESTAMPTZ` (UTC).
* **Salon Configuration:** Every salon profile has a mandatory `timezone` column (e.g., `Asia/Kolkata`, `America/New_York`, `Europe/London`).
* **Time Calculation Rule:** 
  * Day start, day end, breaks, and working hours are expressed in local salon wall-clock time (`10:00` to `20:00`).
  * The availability engine parses the requested date in the salon's local timezone using `Luxon` / `date-fns-tz`, maps candidate slots to UTC boundaries, and evaluates overlaps against stored UTC appointment timestamps.
  * This guarantees 100% accuracy regardless of server location or Daylight Saving Time (DST) transitions.

---

## 6. WhatsApp Cloud API Architecture

```
+------------------+
| Customer Device  |
+------------------+
         |
         | (Sends "Hi" or replies to menu)
         v
+-----------------------------------+
| Meta WhatsApp Cloud API           |
+-----------------------------------+
         |
         | (HTTPS POST Webhook Payload)
         v
+--------------------------------------------------------------------+
| Backend: /api/v1/whatsapp/webhook                                  |
|                                                                    |
| 1. Verify Meta Signature (X-Hub-Signature-256)                     |
| 2. Extract Sender Phone & Salon WhatsApp Phone Number ID           |
| 3. Retrieve Conversation State from Database (`conversations`)     |
| 4. Pass Message to Conversation State Machine                      |
|                                                                    |
|    State Machine:                                                  |
|    - START -> Send Main Menu (Interactive Buttons / List)          |
|    - SELECT_SERVICE -> Fetch Services from Service Module          |
|    - SELECT_STAFF -> Fetch Staff from Staff Module                 |
|    - SELECT_DATE -> Query Booking Engine for valid days            |
|    - SELECT_TIME -> Query Booking Engine getAvailableSlots()       |
|    - COLLECT_NAME -> Save Customer Details                         |
|    - CONFIRMATION -> Call Booking Engine to create Appointment     |
|                                                                    |
| 5. Dispatch Interactive WhatsApp Reply via Meta Graph API          |
+--------------------------------------------------------------------+
```

---

## 7. Monorepo & Directory Structure

```
sall/
├── apps/
│   └── web/                            # Flutter Web Client (Admin Dashboard + Public Booking)
│       ├── lib/
│       │   ├── core/                   # Design system, networking, routing, state base
│       │   ├── features/
│       │   │   ├── auth/               # Login, session management
│       │   │   ├── dashboard/          # Daily calendar, stats counters
│       │   │   ├── booking/            # Public customer booking flow (/book/:slug)
│       │   │   ├── appointments/       # Appointment CRUD, status updates
│       │   │   ├── staff/              # Staff management & hours
│       │   │   ├── services/           # Service catalog management
│       │   │   ├── customers/          # Customer profiles & history
│       │   │   └── settings/           # Salon settings & QR code
│       │   └── main.dart
│       ├── pubspec.yaml
│       └── web/
│
├── backend/                            # NestJS Core Server
│   ├── src/
│   │   ├── common/                     # Filters, guards, interceptors, decorators, pipes
│   │   ├── config/                     # Environment configuration & validation
│   │   ├── database/                   # Prisma service, tenant extensions
│   │   ├── modules/
│   │   │   ├── auth/                   # Authentication & JWT issuance
│   │   │   ├── users/                  # User accounts & RBAC
│   │   │   ├── salons/                 # Salon profiles & settings
│   │   │   ├── staff/                  # Staff & working hours
│   │   │   ├── services/               # Service definitions & categories
│   │   │   ├── availability/           # Central availability calculation engine
│   │   │   ├── appointments/           # Appointment lifecycle & concurrency engine
│   │   │   ├── booking/                # Public booking endpoints
│   │   │   ├── customers/              # Customer CRM ledger
│   │   │   ├── notifications/          # Notification dispatcher
│   │   │   ├── whatsapp/               # WhatsApp Cloud API & State Machine
│   │   │   ├── audit/                  # Audit trail logging
│   │   │   └── reports/                # Salon analytics & summaries
│   │   ├── app.module.ts
│   │   └── main.ts
│   ├── prisma/
│   │   ├── schema.prisma               # Complete database schema
│   │   └── migrations/                 # PostgreSQL versioned migrations
│   ├── test/                           # Unit, integration, concurrency & security tests
│   ├── package.json
│   ├── tsconfig.json
│   └── Dockerfile
│
├── docs/                               # Complete project documentation package
│   ├── REQUIREMENTS.md
│   ├── ARCHITECTURE.md
│   ├── DATABASE.md
│   ├── API.md
│   ├── SECURITY.md
│   ├── TESTING.md
│   ├── DEPLOYMENT.md
│   ├── WHATSAPP.md
│   ├── DECISIONS.md
│   └── ROADMAP.md
│
├── infrastructure/                     # Docker Compose & local dev environment
│   ├── docker-compose.yml
│   └── postgres/
│       └── init.sql
│
├── README.md
└── .gitignore
```
