# MASTER FEATURE TESTING GUIDE & STANDARD TESTING PROTOCOL

**Document Version:** 1.0.0  
**Target System:** Multi-Tenant Salon SaaS Backend, Booking API & WhatsApp Automation Engine  
**File Location:** `docs/testing/FEATURE_TESTING_GUIDE.md`  
**Classification:** Mandatory Engineering Testing Protocol

---

## 1. PURPOSE & APPLICABILITY

This document is the **standard testing protocol** for all feature testing across the salon platform.

Whenever instructed to:
```text
"Test <Feature Name>"
```
*(e.g., "Test Add Stylist feature", "Test salon working hours", "Test appointment booking", "Test customer profile", "Test WhatsApp cancellation")*

**YOU MUST NOT JUMP DIRECTLY INTO CALLING RANDOM APIS OR GENERATING SIMPLE UNIT TESTS.**

Instead, you are required to open and follow this guide step-by-step:
1. Conduct the codebase implementation inspection.
2. Build the exhaustive test matrix across all applicable brutal categories.
3. Execute tests via real HTTP requests simulating human user interaction.
4. Verify the database state, relational integrity, tenant isolation, and side effects.
5. Provide a comprehensive, evidence-based final audit report.

---

## 2. THE CORE TESTING PHILOSOPHY

> **"Test the feature as a real user would use it, then verify what the system actually did internally."**

Testing must validate the complete lifecycle of each interaction:

```
Human Action / WhatsApp Message
               ↓
Real API Request (Direct HTTP / Webhook)
               ↓
Wait for Actual HTTP Response
               ↓
Inspect HTTP Status & Complete Response Body
               ↓
Independent Business Rule Validation (Do NOT reuse production logic)
               ↓
Direct Database State Query (Affected & Unaffected Tables)
               ↓
Relational & Foreign Key Integrity Verification
               ↓
Multi-Tenant Salon Isolation Check
               ↓
Side Effects & WhatsApp Logs Verification
               ↓
Negative / Boundary / Concurrency Stress Test
               ↓
Make Objective PASS / FAIL Verdict
               ↓
Preserve Complete Evidence & Trace
```

### The "Zero False Positive" Law
- An API returning `200 OK` or `201 Created` **does not constitute a pass**.
- A test **FAILS** if:
  - The HTTP status is correct, but a database column has the wrong value.
  - The API succeeds, but an unexpected duplicate row is created.
  - The booking succeeds, but violates working hours, breaks, or overlaps an active appointment.
  - The API rejects invalid input, but leaves partial or orphan records in the database.
  - WhatsApp reports success, but the appointment was not committed in PostgreSQL.
  - A resource belonging to Salon A can be viewed, mutated, or associated with Salon B.

---

## 3. SYSTEM ARCHITECTURE & CODEBASE SOURCE OF TRUTH

Before testing any feature, ground your expectations in the actual architecture of this repository:

### 3.1 Backend & API Architecture
- **Framework:** NestJS on Node.js (TypeScript) with Fastify/Express HTTP server.
- **Global API Prefix:** `/api/v1`
- **Global Pipes:** `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })`. Any unwhitelisted payload field triggers `400 Bad Request`.
- **Global Response Envelope:** `TransformInterceptor` standardizes responses into:
  ```json
  {
    "success": true,
    "data": { ... },
    "message": "Optional message",
    "meta": { ... }
  }
  ```
- **Global Error Envelope:** `AllExceptionsFilter` standardizes error responses into:
  ```json
  {
    "statusCode": 400,
    "error": "Bad Request",
    "message": "Detailed validation or business failure",
    "timestamp": "2026-09-08T00:00:00.000Z",
    "path": "/api/v1/..."
  }
  ```
- **Authentication & RBAC:**
  - Global `JwtAuthGuard` and `RolesGuard`.
  - Roles: `SUPER_ADMIN`, `SALON_OWNER`.
  - Public routes decorated with `@Public()` (e.g. `/api/v1/booking/:salonSlug/...`, `/api/v1/whatsapp/webhook`, `/api/v1/whatsapp/simulate`, `/api/v1/auth/login`).

### 3.2 Database Engine & PostgreSQL Constraints
- **ORM:** Prisma Client with raw PostgreSQL queries for locks and constraints.
- **PostgreSQL GiST Exclusion Constraints (`btree_gist`):**
  1. `no_overlapping_stylist_appointments`:
     ```sql
     EXCLUDE USING gist (
       salon_id WITH =,
       stylist_id WITH =,
       tstzrange(start_at, end_at, '[)') WITH &&
     ) WHERE (status IN ('CONFIRMED', 'CHECKED_IN', 'IN_SERVICE'));
     ```
  2. `no_overlapping_customer_appointments`:
     ```sql
     EXCLUDE USING gist (
       salon_id WITH =,
       salon_user_id WITH =,
       tstzrange(start_at, end_at, '[)') WITH &&
     ) WHERE (status IN ('CONFIRMED', 'CHECKED_IN', 'IN_SERVICE'));
     ```
  > **Documentation Discrepancy Note:** Older architecture documents refer to `no_overlapping_staff_appointments` and `staff_id`. The actual schema and active migration use `no_overlapping_stylist_appointments` and `stylist_id`. Always verify constraints in `schema.prisma` and database metadata.

### 3.3 Concurrency & Advisory Locking
- **3-Level Hierarchical Advisory Locking in `appointments.service.ts`:**
  - Level 1: Tenant Lock (`pg_advisory_xact_lock(key1, hash('salon:<salonId>'))`)
  - Level 2: Customer Resource Lock (`pg_advisory_xact_lock(key1, hash('cust:<salonUserId>:<date>'))`)
  - Level 3: Stylist Resource Lock (`pg_advisory_xact_lock(key1, hash('stylist:<stylistId>:<date>'))`)
- Concurrent conflicting requests must return `409 Conflict` cleanly without deadlocks or unhandled 500 errors.

### 3.4 Multi-Tenant Model
- **Tenants are Salons (`Salon` model).**
- Every administrative resource (`Stylist`, `Service`, `Appointment`, `SalonWorkingHours`, `SalonUser`, `Conversation`, `WhatsAppAccount`) is scoped by `salon_id`.
- `User` records are global (keyed by `phone`), but their salon membership is strictly scoped via `SalonUser` (`salon_id + user_id`).

### 3.5 Customer Booking & WhatsApp Architecture
- **Customer Booking Flow:**
  $$\text{Customer} \xrightarrow{\text{WhatsApp}} \text{Meta Webhook} \xrightarrow{\text{NestJS}} \text{State Machine} \xrightarrow{\text{Availability/Appointments}} \text{PostgreSQL} \xrightarrow{\text{Meta Cloud API}} \text{Customer}$$
- **Conversation State Machine (`ConversationState` enum):**
  `START` $\to$ `ACTIVE_HUB` $\to$ `SELECT_SERVICE` $\to$ `SELECT_STAFF` $\to$ `SELECT_DATE` $\to$ `SELECT_TIME` $\to$ `COLLECT_NAME` $\to$ `CONFIRMATION` $\to$ `COMPLETED`.
- **Dynamic Service Duration Slots:**
  Slot intervals are calculated based on `totalServiceDuration` (e.g. 30m, 45m, 60m, 90m), not fixed 15-minute intervals.

---

## 4. STANDARD WORKFLOW: WHEN INSTRUCTED TO "TEST <FEATURE>"

Whenever you receive a prompt to test a feature, you must execute these sequential phases:

```
┌────────────────────────────────────────────────────────┐
│ PHASE 1: Feature Identification & Codebase Audit       │
├────────────────────────────────────────────────────────┤
│ PHASE 2: Database & Side-Effect Map Generation         │
├────────────────────────────────────────────────────────┤
│ PHASE 3: 46-Category Brutal Test Matrix Design         │
├────────────────────────────────────────────────────────┤
│ PHASE 4: Safe QA Environment & Data Seeding            │
├────────────────────────────────────────────────────────┤
│ PHASE 5: Pre-State Baseline Capture                    │
├────────────────────────────────────────────────────────┤
│ PHASE 6: Human-Simulation HTTP API Execution           │
├────────────────────────────────────────────────────────┤
│ PHASE 7: Direct Database & Relationship Verification   │
├────────────────────────────────────────────────────────┤
│ PHASE 8: Tenant Isolation & Security Verification      │
├────────────────────────────────────────────────────────┤
│ PHASE 9: Concurrency & Invariant Stress Testing        │
├────────────────────────────────────────────────────────┤
│ PHASE 10: Regression & Cleanup Audit                   │
├────────────────────────────────────────────────────────┤
│ PHASE 11: Final Evidence-Based Audit Report            │
└────────────────────────────────────────────────────────┘
```

---

## 5. THE 46-CATEGORY BRUTAL TEST GENERATION FRAMEWORK

For every feature, you must review all 46 test categories. Determine which apply to the feature, explain your reasoning, and derive concrete test cases:

| ID | Category | Objective & What to Test |
| :--- | :--- | :--- |
| **A** | **Happy Path** | Standard user flow with complete valid data; verify HTTP 200/201 and exact database mutation. |
| **B** | **Required-Field Validation** | Omit each required field one by one; verify HTTP 400 with specific class-validator error messages. |
| **C** | **Optional-Field Validation** | Send request with optional fields populated, then omitted; verify correct default values in DB. |
| **D** | **Empty Values** | Send empty strings (`""`) or empty arrays (`[]`) for strings/collections; verify rejection or handling. |
| **E** | **Null Values** | Send explicit `null` for nullable vs non-nullable fields. |
| **F** | **Wrong Data Types** | Send string where integer/boolean expected, array where object expected; verify 400 Bad Request. |
| **G** | **Invalid Formats** | Send malformed emails, invalid E.164 phone numbers (`"123"`), invalid date strings (`"2026-13-45"`), invalid UUIDs. |
| **H** | **Boundary Values** | Test exact upper and lower bounds (e.g. 0 min duration, salon opening minute, closing minute). |
| **I** | **Minimum Values** | Smallest allowable value (e.g. 1 min duration, price ₹0.00). |
| **J** | **Maximum Values** | Largest allowable value (e.g. 480 min duration, price ₹999,999.00, 255-char names). |
| **K** | **Just Below Minimum** | Value just below threshold (e.g. -1 min duration, -₹1.00 price) -> must reject. |
| **L** | **Just Above Maximum** | Value just above limit (e.g. 31 days advance booking when max is 30) -> must reject. |
| **M** | **Duplicate Records** | Create resource with duplicate unique field (e.g. unique slug, email, duplicate appointment slot). |
| **N** | **Non-Existent IDs** | Pass random/unseeded UUIDs for foreign keys (`serviceId`, `staffId`, `salonId`) -> expect 404 or 400. |
| **O** | **Deleted Records** | Attempt to link, update, or book a soft-deleted or deleted entity. |
| **P** | **Inactive Records** | Attempt actions using resources with `status: INACTIVE` or `SUSPENDED` (e.g. inactive stylist or service). |
| **Q** | **Wrong Tenant / Salon** | Provide valid resource ID that belongs to a different salon -> must be rejected (404/403/400). |
| **R** | **Unauthorized Access** | Call protected endpoint with no token -> expect 401 Unauthorized. |
| **S** | **Authentication Failure**| Call with expired token, malformed signature, or corrupted JWT -> expect 401 Unauthorized. |
| **T** | **Cross-User Access** | Salon Owner A attempts to inspect or mutate Salon Owner B's profile or appointments. |
| **U** | **Cross-Salon Mutation** | Admin of Salon A attempts to mutate staff, service, or appointment belonging to Salon B. |
| **V** | **Relationship Violations** | Attempt to assign a service belonging to Salon B to a stylist belonging to Salon A. |
| **W** | **Foreign-Key Violations** | Direct insertion or mutation referencing non-existent parent IDs. |
| **X** | **State-Transition Violations** | Construct state-transition matrix; attempt illegal transitions (e.g. `COMPLETED` $\to$ `CANCELLED`). |
| **Y** | **Transaction Rollback** | Force failure midway through multi-table mutation (e.g. bundle booking); verify zero orphan rows. |
| **Z** | **Partial Failure** | Ensure no half-created entities exist if external dependency or secondary query fails. |
| **AA**| **Database Consistency** | Audit database constraints, enum types, timestamps (`createdAt <= updatedAt`), snapshots. |
| **AB**| **Response Correctness** | Verify returned JSON envelope, fields, types, and that IDs match database records. |
| **AC**| **Side Effects** | Verify audit logs, notifications, WhatsApp logs, and conversation state updates. |
| **AD**| **Existing-Data Compatibility** | Verify existing salon, stylist, and customer records remain completely intact and unmodified. |
| **AE**| **Regression Scenarios** | Verify related endpoints (e.g. public availability) continue to work after mutating feature data. |
| **AF**| **Concurrent Requests** | Send simultaneous parallel HTTP requests for the exact same resource; verify locks & exclusion. |
| **AG**| **Race Conditions** | Two users attempting to claim the last available appointment slot or edit the same schedule. |
| **AH**| **Duplicate Requests** | Exact same payload sent twice rapidly (network replay). |
| **AI**| **Retry Behavior** | Verify retry logic on transient errors does not produce duplicate state. |
| **AJ**| **Idempotency** | Webhooks, state changes, or status updates repeated multiple times must produce identical end state. |
| **AK**| **Stale Data** | Attempt booking or updating using a slot or record that was occupied seconds earlier. |
| **AL**| **Cache Consistency** | If caching exists, verify cache invalidation upon create/update/delete. |
| **AM**| **Notification Failure** | Verify system resilience when WhatsApp / SMS notification delivery fails (must not rollback booking). |
| **AN**| **External Integration Failure** | Meta Cloud API returning 400/500 -> verify conversation state handling. |
| **AO**| **Timeout Behavior** | Slow queries or external calls handled gracefully without hanging connections. |
| **AP**| **Unexpected Database State**| Manually check system response if DB has unusual data (e.g. zero working hours seeded). |
| **AQ**| **Large / Realistic Data** | Performance & correctness with 50+ services, 20+ stylists, and hundreds of appointments. |
| **AR**| **Security & Injection** | XSS payloads in names/notes (`<script>`), SQL injection strings (`' OR 1=1 --`). |
| **AS**| **Data Integrity Risks** | Check numeric precision for `price` (Decimal 10,2), timezones (`Timestamptz`), date truncation. |
| **AT**| **Feature-Specific Edge Cases**| Edge cases derived specifically from inspecting the feature's source code. |

---

## 6. PRE-STATE AND POST-STATE CONTRACT

Every test case executed must be formally documented with explicit preconditions and postconditions:

```markdown
### Scenario: TC-STYL-001 — Create Stylist with Custom Schedule (Happy Path)

**Precondition:**
- Salon A (`id: "salon-alpha-uuid"`, status: `ACTIVE`) exists.
- Salon Owner A is authenticated (`Bearer <valid_jwt>`).
- Stylist with name "Priya Sharma" does NOT exist in Salon A.
- Baseline row count in `stylists` for Salon A is `N`.

**Action / Request:**
- **Method:** `POST`
- **Endpoint:** `/api/v1/staff`
- **Headers:** `Authorization: Bearer <token>`, `Content-Type: application/json`
- **Payload:**
  ```json
  {
    "name": "Priya Sharma",
    "phone": "+919876543210",
    "followsSalonSchedule": false
  }
  ```

**Expected API Response:**
- **Status:** `201 Created`
- **Body Envelope:**
  ```json
  {
    "success": true,
    "data": {
      "id": "<new_uuid>",
      "salonId": "salon-alpha-uuid",
      "name": "Priya Sharma",
      "phone": "+919876543210",
      "status": "ACTIVE",
      "followsSalonSchedule": false,
      "createdAt": "<iso_timestamp>"
    }
  }
  ```

**Expected Database State (Postcondition):**
- Table `stylists`: Row count for Salon A increases from `N` to `N + 1`.
- Row `stylists.id`: Equals returned `data.id`.
- Column `stylists.salon_id`: Equals `"salon-alpha-uuid"`.
- Column `stylists.status`: Equals `"ACTIVE"`.
- Column `stylists.follows_salon_schedule`: Equals `false`.
- Table `audit_logs`: 1 row created with `action: "CREATE_STYLIST"`, `entityId: <new_uuid>`, `adminId: <admin_uuid>`.
- Other Salons: Stylist count for Salon B remains unchanged.
```

---

## 7. DATABASE VERIFICATION PROTOCOL

Never rely on the API response alone. Query the database directly before and after operations:

### Verification Checklist:
1. **Primary Table Check:**
   - Verify inserted, updated, or deleted rows.
   - Verify non-empty primary keys (`id`).
   - Verify default values (`status: 'ACTIVE'`, `followsSalonSchedule: true`).
2. **Related Tables Check:**
   - If adding a stylist $\to$ verify `stylist_services` and `stylist_working_hours`.
   - If booking an appointment $\to$ verify `appointments`, `appointment_services`, and `salon_users`.
3. **Foreign Key & Tenant Scoping:**
   - Verify that all child records reference the correct `salon_id`.
   - Verify composite foreign keys: `@@unique([salonId, id])`.
4. **Immutability Snapshots:**
   - For appointments, verify `serviceNameSnapshot`, `durationMinutes`, and `price` are copied at booking time and decoupled from subsequent service edits.
5. **Orphan & Leak Check:**
   - Ensure deleting or cancelling a parent record does not leave orphan child rows.

---

## 8. MULTI-TENANT SALON ISOLATION PROTOCOL

In every feature test involving salon data, you must execute explicit **cross-tenant penetration attempts**:

```
Tenant A (Salon Alpha)                    Tenant B (Salon Beta)
  Admin A (Token A)                        Admin B (Token B)
        │                                        │
        ├── Attempt 1: Admin A requests GET /api/v1/resource/:id_of_B ──► Expect 404/403
        ├── Attempt 2: Admin A sends PATCH /api/v1/resource/:id_of_B ──► Expect 404/403
        ├── Attempt 3: Admin A sends DELETE /api/v1/resource/:id_of_B ──► Expect 404/403
        ├── Attempt 4: Admin A POST payload { salonId: "id_of_B" } ────► Expect Ignored or 400
        └── Attempt 5: Public booking for Salon A with Stylist of B ────► Expect 400/404
```

Any leak of Salon B data to Salon A is a **CRITICAL SYSTEM FAILURE**.

---

## 9. CONCURRENCY & RACE CONDITION PROTOCOL

For any feature that modifies shared state, availability, inventory, or booking capacity:

1. **Test Concurrency with Real HTTP Requests:**
   - Do NOT simulate concurrency with sequential loop iterations.
   - Dispatch parallel asynchronous HTTP requests using `Promise.all([request1, request2, ...])`.
2. **Verify Invariants:**
   - If 2 requests compete for 1 slot: **Exactly 1 must return 201, exactly 1 must return 409 Conflict**.
   - Total database records created must equal **1**.
   - Verify zero unhandled `500 Internal Server Error` exceptions.
   - Verify zero database deadlocks (`40P01`).
   - Verify database GiST exclusion constraints are active and enforced.

---

## 10. INDEPENDENT BUSINESS-RULE CALCULATION (NO FALSE POSITIVES)

When verifying algorithmic features (e.g. availability slots, pricing math, duration bundling):

- **DO NOT CALL THE PRODUCTION SERVICE FUNCTION TO GENERATE EXPECTED TEST RESULTS.**
- If you call `availabilityService.getAvailableSlots()` to determine what `GET /availability` should return, a bug in `availabilityService` will produce a false positive.
- **Write an independent validator in the test script:**
  - Parse shift hours (`09:00 - 18:00`).
  - Subtract breaks (`13:00 - 14:00`).
  - Subtract existing booked appointments.
  - Apply the requested service duration step.
  - Independently construct the expected set of slots.
  - Compare the API response against this independently derived set.

---

## 11. 16-PHASE TEST EXECUTION LIFECYCLE

When executing a feature test run, follow this strict 16-phase lifecycle:

```
PHASE 1:  Feature Identification & Code Inspection
PHASE 2:  Database Model & Relational Mapping
PHASE 3:  Brutal Test Matrix Formulation (Categories A-AT)
PHASE 4:  Isolated QA Environment & Database Confirmation
PHASE 5:  Seed Minimal Baseline QA Data (Salons A & B, Admin A & B)
PHASE 6:  Capture Pre-State Database Metrics
PHASE 7:  Execute Happy-Path Scenarios
PHASE 8:  Execute Input & Boundary Validation Scenarios
PHASE 9:  Execute Authentication, RBAC & Tenant-Isolation Scenarios
PHASE 10: Execute Relational Integrity & Cascade Scenarios
PHASE 11: Execute State-Transition Matrix Scenarios
PHASE 12: Execute Concurrency & Race-Condition Scenarios
PHASE 13: Execute External Integration & WhatsApp Scenarios (where applicable)
PHASE 14: Direct Post-State Database Integrity Audit
PHASE 15: Safe Cleanup of Ephemeral Test Records
PHASE 16: Compilation of Evidence-Based Final Audit Report
```

---

## 12. STANDARD FINAL TEST REPORT TEMPLATE

Every feature test run must conclude with a structured markdown report following this exact format:

```markdown
# QA AUDIT REPORT: [FEATURE NAME]

**Execution Date:** YYYY-MM-DD  
**Target Environment:** Isolated QA Environment (`salon_test_qa`)  
**Tested Endpoints:** `METHOD /api/v1/...`  
**Database Tables Inspected:** `table_name_1`, `table_name_2`  

---

## 1. Executive Summary
Brief summary of feature behavior, overall stability, and verdict.

---

## 2. Audit Metrics

| Metric | Result | Target / Standard |
| :--- | :--- | :--- |
| **Total Tests Executed** | N | Complete Test Matrix |
| **Passed** | N | 100% of Critical & High |
| **Failed** | N | 0 Tolerated for Release |
| **Blocked** | N | 0 Unjustified |
| **HTTP 500 Count** | 0 | Zero Unhandled Errors |
| **Database Integrity Failures** | 0 | Zero Invariant Violations |
| **Cross-Tenant Leaks** | 0 | Absolute Zero |
| **Duplicate Bookings / Entities**| 0 | Absolute Zero |

---

## 3. Test Execution Matrix & Results

| ID | Category | Scenario Description | Expected Result | Actual Result | API Status | DB Verified | Result | Severity |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| TC-001 | Happy Path | Create valid entity with required fields | 201 Created, DB row added | Matches expected | 201 | PASS | ✅ PASS | HIGH |
| TC-002 | Validation | Missing required field `name` | 400 Bad Request, no DB row | 400 Bad Request | 400 | PASS | ✅ PASS | HIGH |
| TC-003 | Tenant Iso | Admin A updates Admin B resource | 404 Not Found, no mutation | 404 Not Found | 404 | PASS | ✅ PASS | CRITICAL |
| TC-004 | Concurrency| 2 parallel creations of same unique slot| 1 Created (201), 1 Conflict (409)| 1x201, 1x409 | PASS | ✅ PASS | CRITICAL |

---

## 4. Failed Tests & Defect Root-Cause Analysis (If Any)

### [Defect ID] Scenario Name
- **Customer Action / Request:** Payload and endpoint called.
- **Actual API Response:** HTTP status and response body.
- **Expected Behavior:** What the business rule requires.
- **Database State:** State of tables observed.
- **Root Cause Analysis:** Specific file, line of code, and architectural defect.
- **Recommended Fix:** Drop-in code or schema patch.
- **Required Regression Test:** Follow-up verification step.

---

## 5. Database & Relational Integrity Verification
- **Foreign Key Consistency:** Verified all child records belong to correct parent.
- **Tenant Integrity:** Verified no cross-salon contamination.
- **Orphan Rows Audit:** Verified zero orphan records.
- **Invariant Audit:** Results of 17-point invariant check.

---

## 6. Final Verdict
**VERDICT:** [ PASS | PASS WITH WARNINGS | FAIL | BLOCKED ]
*(A feature can only PASS if all CRITICAL and HIGH severity tests pass and database integrity is verified.)*
```

---

## 13. KNOWN SYSTEM GOTCHAS & TEST PITFALLS IN THIS CODEBASE

When writing and executing tests against this project, keep these verified quirks in mind:

1. **PostgreSQL GiST Exclusion Constraints Require Clean State:**
   Direct database inserts that overlap existing bookings will throw a raw PostgreSQL `23P01 (exclusion_violation)` error. Tests must account for this when seeding overlapping fixtures.
2. **Advisory Locks are Transaction-Scoped:**
   Advisory locks (`pg_advisory_xact_lock`) automatically release when the transaction commits or rolls back. They do not persist across separate connection sessions.
3. **Meta Cloud API Sandbox Phone Number Restrictions:**
   The Meta WhatsApp sandbox strictly enforces an allowed recipient phone number list (`OAuthException code 131030`). In automated E2E testing, use the dedicated `/api/v1/whatsapp/simulate` route to test the state machine and booking pipeline without hitting external Meta API rate limits or recipient blocks.
4. **Dynamic Duration Slot Alignments:**
   Slots are generated on multiples of the service duration. Attempting to book off-grid slots (e.g. `17:15` for a 30m service starting on hour/half-hour) will be rejected with 409 Conflict because off-grid candidate slots are not generated by the availability engine.
5. **Customer Overlap is Salon-Scoped:**
   A customer cannot have overlapping appointments in the **same salon** (rejected with 409 Conflict). However, multi-tenant independence allows the same customer to have simultaneous bookings in **different salons** (both return 201 Created).
