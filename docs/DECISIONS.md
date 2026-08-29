# Architecture Decision Records (ADR)

**Document Version:** 1.0.0  
**Status:** Approved  
**Purpose:** Formally document key technical and architectural decisions, trade-offs, and historical context.

---

## ADR-001: Multi-Tenancy Isolation Model

### Status
Accepted

### Context
We are building a B2B SaaS platform serving hundreds of independent salons. We needed to choose between:
1. Database-per-tenant (separate PostgreSQL database for each salon).
2. Schema-per-tenant (separate PostgreSQL schema inside one database).
3. Shared Database with Row-Level Isolation (single schema with mandatory `salon_id` column).

### Decision
Adopt **Shared Database with Row-Level Isolation** utilizing NestJS Tenant Context Interceptors and Prisma query filters.

### Rationale & Trade-offs
* **Pros:** Minimal hosting overhead, simplified connection pooling, instantaneous tenant onboarding (inserting a row in `salons`), frictionless schema migrations.
* **Cons:** Requires rigorous code-level and test-level discipline to guarantee `salon_id` is never omitted from queries.
* **Mitigation:** Enforce tenant-scoped queries at the ORM extension level and maintain automated cross-tenant security penetration tests in CI/CD.

---

## ADR-002: Primary Key & Identifier Strategy

### Status
Accepted

### Context
Database identifiers must be globally unique, resistant to URL enumeration attacks (preventing competitors from guessing appointment numbers or customer counts), and optimized for relational indexing.

### Decision
Use **UUIDv7** (time-ordered 128-bit identifiers) for all internal primary and foreign keys, paired with a short human-readable identifier (e.g., `SAL-1001`) for user-facing receipts.

### Rationale & Trade-offs
* **Pros:** Unlike random UUIDv4, UUIDv7 embeds a millisecond timestamp prefix, preserving sequential B-Tree index insertion locality and preventing page fragmentation. Immune to ID enumeration attacks compared to sequential integers.
* **Cons:** Slightly larger storage footprint (16 bytes vs 4/8 bytes for integer). Acceptable trade-off for security and scale.

---

## ADR-003: Concurrency & Double-Booking Prevention

### Status
Accepted

### Context
Simultaneous customer submissions (via Web, WhatsApp, or Walk-in) for the same staff member and time slot could result in double-booking if only checked at the application read phase.

### Decision
Implement a multi-tier defense:
1. **Interactive Database Transactions:** Enclose availability verification and insertion inside a PostgreSQL serializable transaction or row lock.
2. **PostgreSQL GiST Temporal Range Exclusion Constraint:** Add a database engine-level constraint prohibiting overlapping active time ranges for the same `staff_id`.

### Rationale & Trade-offs
* **Pros:** Mathematically guarantees zero double bookings even under heavy concurrent load or multi-instance clustering.
* **Cons:** Requires `btree_gist` extension in PostgreSQL. Highly standard in all modern managed database providers.

---

## ADR-004: Decoupled WhatsApp Architecture

### Status
Accepted

### Context
WhatsApp is a critical customer booking channel. A common architectural antipattern is tightly coupling WhatsApp webhook payloads with core booking logic.

### Decision
WhatsApp is designed strictly as a **Channel Adapter**. The WhatsApp module receives webhooks, manages conversation states, and communicates with the same central `AvailabilityService` and `AppointmentService` used by the Web interface.

### Rationale & Trade-offs
* **Pros:** Single source of truth for business rules, slot generation, and validations. Eliminates duplicated code. Allows easy addition of future channels (SMS, Telegram, Instagram DMs).
* **Cons:** Requires maintaining a persistent conversation state machine table in PostgreSQL.

---

## ADR-005: Unified Web Application Architecture

### Status
Accepted

### Context
The platform requires both an administrative management portal for salon staff and a frictionless public booking interface (`/book/:slug`) for clients.

### Decision
Build a single responsive Web codebase with route-based splitting:
* `/book/:salonSlug` $\rightarrow$ Lightweight, mobile-first, public booking flow.
* `/admin/*` $\rightarrow$ Secure dashboard with calendar, analytics, staff, and service management.

### Rationale & Trade-offs
* **Pros:** Single build pipeline, shared design system, unified API client, and rapid feature iteration.
* **Cons:** Must ensure public booking bundle remains lightweight.
