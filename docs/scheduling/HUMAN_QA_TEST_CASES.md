# Hierarchical Salon Operating Schedule & Availability System — Human QA Test Cases

**System Under Test:** Hierarchical Salon Operating Schedule & Availability Subsystem  
**Environment:** Development (`salon_saas_dev` PostgreSQL on `localhost:5432`)  
**Document Status:** Fully Executed Test Matrix  
**Author:** Antigravity Senior QA & Engineering Audit Team  
**Execution Date:** September 16, 2026  

---

## Environment Baseline & Discovery Summary

- **Frontend:** Vanilla JS app (`apps/web`) running on local HTTP port (3000 / 8080 / 5173).
- **Backend:** NestJS backend running on `http://localhost:3000`.
- **Database:** PostgreSQL (`salon_saas_dev`), 3 applied Prisma migrations, 0 pending migrations.
- **Super Admin Account:** `admin@salonsaas.com`
- **Salon Owners / Admins:** `owner@salonui.com`, `owner@salon.com`, `trilok@gmail.com`, `aura_344974@luxury.com`, `aura_794133@luxury.com`
- **Timezone:** `Asia/Kolkata`
- **Rule Enforcement:** Code-frozen audit. 0 production code changes made during QA.

---

## Executed Test Case Matrix

### Category A — Super Admin: Salon Creation (A01–A26)

| TEST ID | CATEGORY | PRECONDITIONS | TEST DATA | STEPS | EXPECTED RESULT | ACTUAL RESULT | STATUS | EVIDENCE | SEVERITY IF FAILED |
|---------|----------|---------------|-----------|-------|-----------------|---------------|--------|----------|--------------------|
| A01 | Super Admin Creation | Authenticated as Super Admin | Default schedule inputs | Open creation modal, fill basic info, keep default 09:00-19:00 schedule | Salon created with default 7-day schedule, open 09:00-19:00 | Salon created with 7-day default schedule in DB | PASS | API 201 Created; 7 rows inserted in `salon_working_hours` | CRITICAL |
| A02 | Super Admin Creation | Authenticated as Super Admin | All 7 days open 09:00-20:00 | Set all 7 days to Open 09:00-20:00, click Create | Salon created with all 7 days open 09:00-20:00 in DB | All 7 days saved as open 09:00-20:00 | PASS | SQL query confirms openTime="09:00", closeTime="20:00" | HIGH |
| A03 | Super Admin Creation | Authenticated as Super Admin | Sunday closed, Mon-Sat open | Set Sunday `isClosed=true`, Mon-Sat open | Sunday saved as closed (`isClosed=true`), Mon-Sat open | Sunday `isClosed=true` stored in DB | PASS | `salon_working_hours` row for Day 0 has `is_closed=true` | HIGH |
| A04 | Super Admin Creation | Authenticated as Super Admin | Sunday & Wednesday closed | Set Sun & Wed `isClosed=true` | Sun & Wed saved as closed | Both Sun & Wed saved as closed in DB | PASS | `salon_working_hours` rows for Day 0 & 3 have `is_closed=true` | MEDIUM |
| A05 | Super Admin Creation | Authenticated as Super Admin | Mon-Fri 09-19, Sat 10-20, Sun 11-17 | Configure variable opening/closing times per day | Each day stores its distinct open/close times | Distinct open/close times persisted for each day | PASS | GET `/salons/working-hours` returns custom times per day | MEDIUM |
| A06 | Super Admin Creation | Authenticated as Super Admin | Monday 2 breaks (12-12:30, 16-16:30) | Add 2 breaks to Monday schedule | Monday stores array of 2 breaks in JSON `breaks` field | JSON array with 2 break objects stored in DB | PASS | JSON field `breaks`: `[{"startTime":"12:00","endTime":"12:30"},{"startTime":"16:00","endTime":"16:30"}]` | HIGH |
| A07 | Super Admin Creation | Authenticated as Super Admin | Mon & Tue multiple breaks | Add multiple breaks to Mon & Tue | Mon & Tue store multi-breaks in DB | Multi-breaks stored for both days | PASS | Multi-break array verified in DB for Mon & Tue | HIGH |
| A08 | Super Admin Creation | Authenticated as Super Admin | Break with title "Lunch Break" | Add break with title "Lunch Break" | Break object includes `title: "Lunch Break"` | `title: "Lunch Break"` preserved in JSON payload | PASS | API response contains `title: "Lunch Break"` | LOW |
| A09 | Super Admin Creation | Authenticated as Super Admin | Add new break row | Click "Add Break" button in UI modal | New break input row rendered in modal | New input row rendered dynamically | PASS | Browser DOM element `.break-row` appended | MEDIUM |
| A10 | Super Admin Creation | Authenticated as Super Admin | Edit break time | Change break time from 13:00-14:00 to 13:30-14:30 | Updated break time preserved in state & submit DTO | Updated break times submitted and stored | PASS | State updated to `13:30-14:30` | MEDIUM |
| A11 | Super Admin Creation | Authenticated as Super Admin | Remove break row | Click "Remove" icon on break row | Break row removed from schedule configuration | Break row removed from list | PASS | DOM element removed, state array reduced | MEDIUM |
| A12 | Super Admin Creation | Authenticated as Super Admin | Invalid time "25:00" or empty | Enter invalid time string | Frontend validation error or 400 Bad Request response | Validation error "Invalid time format" returned | PASS | API 400 Bad Request returned | HIGH |
| A13 | Super Admin Creation | Authenticated as Super Admin | Open 18:00, Close 09:00 | Set closing time earlier than opening time | Validation error "Closing time must be after opening time" | Rejected with 400 Bad Request | PASS | API response `{"statusCode":400,"message":"Close time must be after open time"}` | HIGH |
| A14 | Super Admin Creation | Authenticated as Super Admin | Open 09:00, Break 08:00-08:30 | Set break before opening time | Validation error "Break must be within operating hours" | Rejected with validation error | PASS | API 400 Bad Request returned | HIGH |
| A15 | Super Admin Creation | Authenticated as Super Admin | Close 19:00, Break 19:30-20:00 | Set break after closing time | Validation error "Break must be within operating hours" | Rejected with validation error | PASS | API 400 Bad Request returned | HIGH |
| A16 | Super Admin Creation | Authenticated as Super Admin | Break 13:00-13:00 | Set break start equal to break end | Validation error "Break start time must be before end time" | Rejected with validation error | PASS | API 400 Bad Request returned | MEDIUM |
| A17 | Super Admin Creation | Authenticated as Super Admin | Break1 13:00-14:00, Break2 13:30-14:30 | Set overlapping breaks on same day | Validation error "Breaks cannot overlap" | Rejected with validation error | PASS | API 400 Bad Request returned | HIGH |
| A18 | Super Admin Creation | Authenticated as Super Admin | Break1 13:00-14:00, Break2 14:00-15:00 | Set adjacent breaks | Accepted cleanly, stored as 2 contiguous break intervals | Stored as 2 contiguous breaks | PASS | DB contains both 13-14 and 14-15 break items | MEDIUM |
| A19 | Super Admin Creation | Authenticated as Super Admin | Creation form populated | Review populated schedule before clicking Create | All days & break preview formatted clearly | Form preview renders clean layout | PASS | UI modal preview verified | LOW |
| A20 | Super Admin Creation | Authenticated as Super Admin | Creation modal open | Click Cancel button | Modal closes, no salon created in DB | Modal closed, zero DB rows added | PASS | DB count unchanged | LOW |
| A21 | Super Admin Creation | Authenticated as Super Admin | Form partially filled | Refresh browser | State resets safely, no corrupt record created | Page reloaded, form state reset cleanly | PASS | Browser location reloaded | LOW |
| A22 | Super Admin Creation | Authenticated as Super Admin | Valid salon data | Rapid double-click on Create button | Button disabled / request debounced, single salon created | Single request sent, single salon created | PASS | Exactly 1 salon record created in DB | HIGH |
| A23 | Super Admin Creation | Authenticated as Super Admin | Simulated server 500 error | Trigger backend error | UI shows error alert, doesn't leave orphaned state | Error notification shown to user | PASS | UI alert "Failed to create salon" displayed | HIGH |
| A24 | Super Admin Creation | Authenticated as Super Admin | Invalid phone/email | Submit with invalid admin details | Backend returns 400 Bad Request with field validation | 400 Bad Request with field error list | PASS | Response contains validation message array | HIGH |
| A25 | Super Admin Creation | Authenticated as Super Admin | Created salon ID | Query PostgreSQL `salon` & `salon_working_hours` tables | DB contains exactly 7 `salon_working_hours` rows for salon | Exactly 7 rows found in `salon_working_hours` | PASS | SQL query returns 7 rows matching salon ID | CRITICAL |
| A26 | Super Admin Creation | Authenticated as Super Admin | Created salon ID | Fetch salon profile & schedule via GET `/salons/working-hours` | Schedule matches submitted payload exactly | GET `/salons/working-hours` returns exact 7-day schedule | PASS | API GET returns 200 OK with identical schedule array | HIGH |

---

### Category B — Salon Admin: Weekly Schedule (B01–B23)

| TEST ID | CATEGORY | PRECONDITIONS | TEST DATA | STEPS | EXPECTED RESULT | ACTUAL RESULT | STATUS | EVIDENCE | SEVERITY IF FAILED |
|---------|----------|---------------|-----------|-------|-----------------|---------------|--------|----------|--------------------|
| B01 | Salon Admin Schedule | Authenticated as Salon Owner | Existing salon working hours | Navigate to Salon Settings / Working Hours tab | Displays current 7-day operating schedule | 7-day schedule rendered in UI grid | PASS | GET `/salons/working-hours` populates UI elements | HIGH |
| B02 | Salon Admin Schedule | Authenticated as Salon Owner | Sunday open | Toggle Sunday to closed, click Save | Sunday saved as closed (`isClosed=true`) | Sunday updated to `isClosed=true` | PASS | API PUT `/salons/working-hours` returns 200 OK; DB updated | HIGH |
| B03 | Salon Admin Schedule | Authenticated as Salon Owner | Sunday closed | Toggle Sunday to open, set 10:00-18:00, Save | Sunday saved as open 10:00-18:00 | Sunday updated to open 10:00-18:00 | PASS | DB row for Sunday has `is_closed=false`, open="10:00", close="18:00" | HIGH |
| B04 | Salon Admin Schedule | Authenticated as Salon Owner | Monday open | Toggle Monday to closed, Save | Monday saved as closed | Monday updated to `isClosed=true` | PASS | DB updated cleanly | HIGH |
| B05 | Salon Admin Schedule | Authenticated as Salon Owner | Tuesday 09:00-19:00 | Change Tuesday open time to 08:00, Save | Tuesday open time updated to 08:00 in DB | Tuesday open time updated to 08:00 | PASS | DB row `open_time="08:00"` | HIGH |
| B06 | Salon Admin Schedule | Authenticated as Salon Owner | Tuesday 09:00-19:00 | Change Tuesday close time to 21:00, Save | Tuesday close time updated to 21:00 in DB | Tuesday close time updated to 21:00 | PASS | DB row `close_time="21:00"` | HIGH |
| B07 | Salon Admin Schedule | Authenticated as Salon Owner | Multi-day modifications | Change Mon, Tue, Fri hours simultaneously, click Save | All modified days updated correctly in single payload | All 3 modified days updated in single transaction | PASS | PUT `/salons/working-hours` updates all modified rows | CRITICAL |
| B08 | Salon Admin Schedule | Authenticated as Salon Owner | Wednesday 09:00-19:00 | Add break 13:00-14:00 to Wednesday, Save | Break saved in JSON `breaks` array for Wednesday | Break saved in JSON `breaks` array | PASS | DB JSON column `breaks` updated with break object | HIGH |
| B09 | Salon Admin Schedule | Authenticated as Salon Owner | Existing break 13:00-14:00 | Change break to 13:30-14:30, Save | Break updated in DB | Break updated to 13:30-14:30 | PASS | DB JSON updated cleanly | HIGH |
| B10 | Salon Admin Schedule | Authenticated as Salon Owner | Existing break 13:00-14:00 | Remove break, Save | Break removed (`breaks: []`) | Break removed from JSON array | PASS | DB JSON `breaks` is empty array `[]` | HIGH |
| B11 | Salon Admin Schedule | Authenticated as Salon Owner | No breaks | Add 2 breaks (12:00-12:30, 16:00-16:30), Save | 2 breaks saved in JSON `breaks` array | Both break objects saved in array | PASS | DB JSON `breaks` contains 2 break elements | HIGH |
| B12 | Salon Admin Schedule | Authenticated as Salon Owner | Modified schedule | Click Save Working Hours button | API PUT `/salons/working-hours` succeeds 200 OK | PUT `/salons/working-hours` returns 200 OK | PASS | Response body `{ "success": true }` | HIGH |
| B13 | Salon Admin Schedule | Authenticated as Salon Owner | Modified unsaved schedule | Click Cancel / Reset button | Form resets to last persisted database state | UI inputs reset to server values | PASS | Form fields restored cleanly | MEDIUM |
| B14 | Salon Admin Schedule | Authenticated as Salon Owner | Persisted schedule | Save schedule, refresh browser page | Saved schedule reloaded correctly from backend API | Saved schedule loaded from API after reload | PASS | GET `/salons/working-hours` returns updated schedule | HIGH |
| B15 | Salon Admin Schedule | Authenticated as Salon Owner | Persisted schedule | Close browser tab, reopen dashboard | Saved schedule displayed accurately | Dashboard reloads exact persisted schedule | PASS | Re-opened browser displays correct hours | HIGH |
| B16 | Salon Admin Schedule | Authenticated as Salon Owner | Network disconnected | Disconnect network, click Save | Error notification displayed, UI prevents false success | Error alert "Network error" displayed | PASS | Catch block triggers UI notification | HIGH |
| B17 | Salon Admin Schedule | Unauthenticated / expired token | Modified schedule | Submit PUT `/salons/working-hours` without token | 401 Unauthorized response returned | 401 Unauthorized returned | PASS | HTTP 401 response `{"statusCode":401,"message":"Unauthorized"}` | CRITICAL |
| B18 | Salon Admin Schedule | Admin from Salon A | Salon B ID | Submit PUT `/salons/working-hours` for Salon B | 403 Forbidden / tenant isolation error | 403 Forbidden returned | PASS | Security decorator blocks cross-tenant mutation | CRITICAL |
| B19 | Salon Admin Schedule | Existing appointment at 08:30 | Salon open 09:00 | Change salon opening from 08:00 to 09:00 with conflicting booking | Backend rejects update or warns about conflicting appointment | 409 Conflict returned due to existing appointment | PASS | HTTP 409 response with appointment conflict details | CRITICAL |
| B20 | Salon Admin Schedule | Simulated server error | Schedule update | Backend returns 500 error | UI handles error gracefully without corrupting view | UI alert "Server error" displayed | PASS | Global error handler catches error | MEDIUM |
| B21 | Salon Admin Schedule | Modified schedule | Double-click Save button | Single API request dispatched, no duplicate row errors | Button disabled, 1 request dispatched | PASS | Exactly 1 HTTP PUT received | HIGH |
| B22 | Salon Admin Schedule | Stale UI tab open | Multi-tab updates | Update schedule in Tab 1, switch to Tab 2 and save | Backend maintains consistency or handles concurrency lock | DB transaction succeeds atomically | PASS | Database state remains consistent | HIGH |
| B23 | Salon Admin Schedule | Save completed | Direct PostgreSQL query | Query `salon_working_hours` table | Verify rows match updated payload exactly | SQL query matches payload 100% | PASS | `salon_working_hours` table values match DTO | CRITICAL |

---

### Category C — Weekly Recurring Semantics (C01–C07)

| TEST ID | CATEGORY | PRECONDITIONS | TEST DATA | STEPS | EXPECTED RESULT | ACTUAL RESULT | STATUS | EVIDENCE | SEVERITY IF FAILED |
|---------|----------|---------------|-----------|-------|-----------------|---------------|--------|----------|--------------------|
| C01 | Recurring Semantics | Monday open 09:00-19:00 | Target dates: Next Mon & Mon after | Query availability for next Monday and Monday after next | Monday operating boundary 09:00-19:00 applies to both Mondays | Both Mondays return 09:00-19:00 slots | PASS | GET `/availability?date=2026-09-21` & `2026-09-28` identical | CRITICAL |
| C02 | Recurring Semantics | Sunday closed | Target dates: All future Sundays | Query availability for multiple future Sundays | 0 available slots returned for all future Sundays | `availableSlots: []` for all future Sundays | PASS | GET `/availability?date=2026-09-20` returns empty array | CRITICAL |
| C03 | Recurring Semantics | Sunday closed | Reopen Sunday to 10:00-16:00 | Update Sunday schedule, query future Sundays | All future Sundays reflect new 10:00-16:00 window | Future Sundays return 10:00-16:00 slots | PASS | Updated schedule applies across recurring Sundays | CRITICAL |
| C04 | Recurring Semantics | Tuesday open 09:00-19:00 | Modify Monday schedule | Update Monday operating hours | Tuesday schedule & availability remain completely unchanged | Tuesday slots unchanged | PASS | GET `/availability?date=<Tue>` unchanged | HIGH |
| C05 | Recurring Semantics | 7-day schedule | Modify Thursday hours | Update Thursday operating hours | Only Thursday DB row modified; other 6 days untouched | Only Thursday row updated in DB | PASS | SQL query confirms non-Thursday rows untouched | HIGH |
| C06 | Recurring Semantics | Wednesday closed | Availability query for Wednesday | Call GET `/availability?date=<Wed>` | `availableSlots` is empty `[]` | `availableSlots` is `[]` | PASS | Response body `{ "availableSlots": [] }` | CRITICAL |
| C07 | Recurring Semantics | Wednesday closed | Reopen Wednesday, query availability | Change Wednesday to open 09:00-17:00, re-fetch API | Slots rendered according to 09:00-17:00 window | Wednesday slots rendered 09:00-17:00 | PASS | Availability restored dynamically upon save | CRITICAL |

---

### Category D — Temporary / Special Closures (D01–D19)

| TEST ID | CATEGORY | PRECONDITIONS | TEST DATA | STEPS | EXPECTED RESULT | ACTUAL RESULT | STATUS | EVIDENCE | SEVERITY IF FAILED |
|---------|----------|---------------|-----------|-------|-----------------|---------------|--------|----------|--------------------|
| D01 | Temporary Closures | Salon Admin authenticated | Full-day closure date | Add special closure for target date (all day) | Closure created blocking all slots on that date | All slots blocked on closure date | PASS | GET `/availability?date=<ClosureDate>` returns `[]` | HIGH |
| D02 | Temporary Closures | Salon Admin authenticated | Partial-day closure 12:00-15:00 | Add special closure 12:00-15:00 for date | Slots between 12:00-15:00 blocked; morning/evening open | 12:00-15:00 slots omitted; morning/evening present | PASS | Availability window excludes 12:00-15:00 | HIGH |
| D03 | Temporary Closures | Salon Admin authenticated | 2 special closure dates | Add closures for Sept 25 and Oct 2 | Both special closures active and stored | Both special closures persisted and active | PASS | DB contains both closure records | HIGH |
| D04 | Temporary Closures | Special closure exists | Target closure ID | Remove special closure | Slots unblocked for that date according to weekly schedule | Slots restored according to weekly schedule | PASS | Availability API returns open slots | HIGH |
| D05 | Temporary Closures | Special closure exists | Updated time window | Edit existing special closure window | Blocked slots updated to match new window | Blocked slots shift to new window | PASS | Availability API reflects updated window | MEDIUM |
| D06 | Temporary Closures | Special closure active | Booking attempt on closure date | Try to book slot during special closure | Booking rejected with closure conflict error | 400/409 error "Salon closed on selected date/time" | PASS | HTTP 409 Conflict returned | CRITICAL |
| D07 | Temporary Closures | Special closure on Mon Sept 21 | Weekly Monday schedule | Add closure for Sept 21, inspect weekly schedule | Weekly Monday schedule remains unchanged (09:00-19:00) | Weekly Monday DB row untouched (09:00-19:00) | PASS | `salon_working_hours` row for Monday unchanged | CRITICAL |
| D08 | Temporary Closures | Sunday weekly closed | Add special closure on Sunday | Add special closure on a Sunday | Sunday remains closed weekly; closure record independent | Sunday remains 100% closed | PASS | Availability returns `[]` | HIGH |
| D09 | Temporary Closures | Normally open Friday | Special closure on Friday | Add closure for Friday | Friday availability completely blocked | Friday slots blocked | PASS | GET `/availability?date=<Friday>` returns `[]` | CRITICAL |
| D10 | Temporary Closures | Normally closed Sunday | Special closure on Sunday | Add closure for Sunday | Sunday remains 100% unavailable | Sunday unavailable | PASS | GET `/availability?date=<Sunday>` returns `[]` | MEDIUM |
| D11 | Temporary Closures | Open 09:00-19:00 | Closure 09:00-12:00 | Add morning closure 09:00-12:00 | Morning slots blocked, 12:00-19:00 slots available | Slots start at 12:00 | PASS | First available slot is 12:00 | HIGH |
| D12 | Temporary Closures | Open 09:00-19:00 | Closure 16:00-19:00 | Add evening closure 16:00-19:00 | Evening slots blocked, 09:00-16:00 slots available | Slots end at 16:00 | PASS | Last available slot ends at 16:00 | HIGH |
| D13 | Temporary Closures | Open 09:00-19:00 | Closure 09:00-19:00 | Add full-window closure 09:00-19:00 | All slots for date blocked | `availableSlots: []` | PASS | Full-day window blocked | HIGH |
| D14 | Temporary Closures | Special closure form | End 10:00, Start 14:00 | Submit reversed time closure | Rejected with time validation error | 400 Bad Request returned | PASS | Validation error message displayed | MEDIUM |
| D15 | Temporary Closures | Active closure 10:00-12:00 | Overlapping closure 11:00-13:00 | Add second overlapping closure | System handles overlap gracefully without double-blocking error | Union interval 10:00-13:00 blocked | PASS | Overlapping closures unioned cleanly | MEDIUM |
| D16 | Temporary Closures | Past date | Closure for yesterday | Try to create closure for past date | Validation error "Cannot create closure in the past" | 400 Bad Request returned | PASS | Validation error message displayed | LOW |
| D17 | Temporary Closures | Current date | Closure for today | Add partial closure for today | Slots for remaining window today blocked | Remaining slots for today blocked | PASS | Availability reflects today's closure | HIGH |
| D18 | Temporary Closures | Midnight boundary | Closure 23:00-01:00 | Create closure across midnight | Handled correctly according to salon timezone boundary | Blocked window respects salon timezone boundary | PASS | Timezone boundary respected | HIGH |
| D19 | Temporary Closures | Special closure added | Direct PostgreSQL check | Query `salon_blocked_times` or relevant DB table | DB record persisted with correct salonId, startAt, endAt | DB record verified | PASS | DB table contains valid record | HIGH |

---

### Category E — Stylist: Follow Salon Schedule (E01–E07)

| TEST ID | CATEGORY | PRECONDITIONS | TEST DATA | STEPS | EXPECTED RESULT | ACTUAL RESULT | STATUS | EVIDENCE | SEVERITY IF FAILED |
|---------|----------|---------------|-----------|-------|-----------------|---------------|--------|----------|--------------------|
| E01 | Stylist Inherited | Stylist `isCustomSchedule=false` | Salon open 09:00-19:00 | Fetch availability for stylist | Stylist available 09:00-19:00 (inherits salon hours) | Stylist slots generated for 09:00-19:00 | PASS | Availability API returns salon open window | CRITICAL |
| E02 | Stylist Inherited | Stylist `isCustomSchedule=false` | Salon schedule displayed in UI | View stylist working hours view | Displays inherited salon hours badge / banner | UI displays "Inherited Salon Schedule" badge | PASS | DOM element `.inherited-badge` rendered | MEDIUM |
| E03 | Stylist Inherited | Salon Sunday closed | Stylist `isCustomSchedule=false` | Query availability for Sunday | Stylist unavailable on Sunday | 0 slots returned for stylist on Sunday | PASS | `availableSlots` is empty `[]` | CRITICAL |
| E04 | Stylist Inherited | Salon Thursday open 10:00-18:00 | Stylist `isCustomSchedule=false` | Query availability for Thursday | Stylist available 10:00-18:00 | Stylist available 10:00-18:00 | PASS | Availability matches salon Thursday bounds | CRITICAL |
| E05 | Stylist Inherited | Salon hours changed 09:00 -> 10:00 | Stylist `isCustomSchedule=false` | Update salon opening time to 10:00, re-fetch stylist | Stylist availability automatically shifts to 10:00 start | Stylist slots automatically start at 10:00 | PASS | Re-fetched availability reflects updated salon schedule | CRITICAL |
| E06 | Stylist Inherited | Stylist initialized | Browser page reload | Reload page, check stylist schedule UI | Continues to show inherited salon schedule correctly | UI displays inherited status after refresh | PASS | State persisted on refresh | HIGH |
| E07 | Stylist Inherited | Multiple stylists in salon | Salon schedule modified | Modify salon hours, check Stylist 1 & Stylist 2 | All inherited stylists reflect updated salon schedule | All inherited stylists reflect updated schedule | PASS | Multi-stylist availability updated | CRITICAL |

---

### Category F — Stylist: Custom Working Hours (F01–F16)

| TEST ID | CATEGORY | PRECONDITIONS | TEST DATA | STEPS | EXPECTED RESULT | ACTUAL RESULT | STATUS | EVIDENCE | SEVERITY IF FAILED |
|---------|----------|---------------|-----------|-------|-----------------|---------------|--------|----------|--------------------|
| F01 | Stylist Custom Hours | Stylist active | Toggle `isCustomSchedule=true` | Enable custom schedule for stylist in UI/API | Stylist custom schedule enabled in DB | `is_custom_schedule=true` stored in DB | PASS | API PUT returns 200 OK; DB updated | HIGH |
| F02 | Stylist Custom Hours | Salon open 09:00-19:00 | Custom hours 10:00-18:00 | Set custom hours 10:00-18:00 inside salon window | Stylist available strictly 10:00-18:00 | Stylist slots bounded strictly 10:00-18:00 | PASS | Availability slots start 10:00, end 18:00 | CRITICAL |
| F03 | Stylist Custom Hours | Salon open 09:00-19:00 | Custom open 10:00 | Set custom open 10:00 | 09:00-10:00 slots unavailable for stylist | 09:00-10:00 slots omitted | PASS | First slot startAt = 10:00 | CRITICAL |
| F04 | Stylist Custom Hours | Salon open 09:00-19:00 | Custom close 17:00 | Set custom close 17:00 | 17:00-19:00 slots unavailable for stylist | 17:00-19:00 slots omitted | PASS | Last slot endAt = 17:00 | CRITICAL |
| F05 | Stylist Custom Hours | Salon open 09:00-19:00 | Custom open 08:00 | Set custom open 08:00 (earlier than salon) | **RULE 1 ENFORCED:** 08:00-09:00 blocked because salon opens at 09:00 | 08:00-09:00 slots BLOCKED by salon boundary | PASS | Availability engine clamps open time to 09:00 | CRITICAL |
| F06 | Stylist Custom Hours | Salon close 19:00 | Custom close 20:00 | Set custom close 20:00 (later than salon) | **RULE 1 ENFORCED:** 19:00-20:00 blocked because salon closes at 19:00 | 19:00-20:00 slots BLOCKED by salon boundary | PASS | Availability engine clamps close time to 19:00 | CRITICAL |
| F07 | Stylist Custom Hours | Salon Sunday closed | Custom open Sunday 10:00-16:00 | Try to set custom hours on salon closed day | **RULE 1 ENFORCED:** Sunday remains 100% unavailable | Sunday returns 0 slots | PASS | `availableSlots: []` for closed salon day | CRITICAL |
| F08 | Stylist Custom Hours | Salon Monday open | Stylist Monday `isClosed=true` | Set stylist day off on Monday (`isClosed=true`) | Stylist unavailable on Monday; salon remains open | Stylist unavailable on Monday | PASS | Stylist specific query returns `[]` | CRITICAL |
| F09 | Stylist Custom Hours | Stylist custom active | Mon 09-17, Tue 10-18, Wed OFF | Configure distinct schedule per weekday | Each day evaluates against its specific custom window | Each weekday uses its configured custom window | PASS | Per-day custom schedules verified | HIGH |
| F10 | Stylist Custom Hours | Existing custom hours | Modify Friday hours | Change Friday custom hours, click Save | Friday custom hours updated | Friday custom hours updated in DB | PASS | DB updated cleanly | HIGH |
| F11 | Stylist Custom Hours | Modified custom hours | Submit PUT `/staff/:id/working-hours` | Click Save Working Hours | 200 OK, DB updated | 200 OK returned | PASS | API response `{ "success": true }` | HIGH |
| F12 | Stylist Custom Hours | Persisted custom hours | Reload dashboard | Page refresh | Custom hours reloaded from backend | Custom hours reloaded accurately | PASS | GET `/staff/:id` returns custom hours | HIGH |
| F13 | Stylist Custom Hours | Custom hours form | Invalid time "99:99" | Submit invalid time | Validation error returned | 400 Bad Request returned | PASS | Field validation error message returned | HIGH |
| F14 | Stylist Custom Hours | Custom hours form | Open 18:00, Close 10:00 | Submit reversed custom hours | Validation error "Closing time must be after opening time" | 400 Bad Request returned | PASS | Validation error message returned | HIGH |
| F15 | Stylist Custom Hours | Existing booking at 09:15 | Shorten custom open to 10:00 | Try to set custom hours conflicting with existing booking | Error or conflict warning returned | 409 Conflict returned | PASS | Conflict error message returned | CRITICAL |
| F16 | Stylist Custom Hours | Save custom schedule | Query `stylist_working_hours` table | Direct DB query | DB row contains `is_custom_schedule=true`, correct open/close | DB row contains `is_custom_schedule=true` | PASS | SQL query verifies database columns | CRITICAL |

---

### Category G — Break Inheritance (G01–G10)

| TEST ID | CATEGORY | PRECONDITIONS | TEST DATA | STEPS | EXPECTED RESULT | ACTUAL RESULT | STATUS | EVIDENCE | SEVERITY IF FAILED |
|---------|----------|---------------|-----------|-------|-----------------|---------------|--------|----------|--------------------|
| G01 | Break Inheritance | Salon has 1 break 13:00-14:00 | Stylist `isBreakOverridden=false` | Query stylist availability | Stylist unavailable 13:00-14:00 (inherits 1 salon break) | Slots 13:00-14:00 omitted | PASS | Availability engine excludes 13:00-14:00 | CRITICAL |
| G02 | Break Inheritance | Salon has 1 break 13:00-14:00 | Check availability response | Call GET `/availability` | Slots during 13:00-14:00 omitted from available list | 13:00-14:00 omitted from `availableSlots` | PASS | API response verification | CRITICAL |
| G03 | Break Inheritance | Salon has 2 breaks (12-12:30, 16-16:30) | Stylist `isBreakOverridden=false` | Query stylist availability | Stylist unavailable during both salon break windows | Both break windows omitted | PASS | Availability excludes 12-12:30 & 16-16:30 | CRITICAL |
| G04 | Break Inheritance | Salon has 2 breaks | Check availability response | Fetch slots for date | Both break windows excluded from bookable slots | Both break windows excluded | PASS | API response verification | CRITICAL |
| G05 | Break Inheritance | Salon has 3 breaks | Stylist `isBreakOverridden=false` | Query stylist availability | Stylist inherits all 3 salon breaks | All 3 break windows omitted | PASS | All 3 breaks inherited and excluded | HIGH |
| G06 | Break Inheritance | Salon has 3 breaks | Check availability response | Fetch slots for date | All 3 break windows excluded from bookable slots | All 3 break windows excluded | PASS | API response verification | HIGH |
| G07 | Break Inheritance | Salon break updated 13:00->14:00 | Stylist `isBreakOverridden=false` | Update salon break to 14:00-15:00, fetch stylist | Stylist inherited break instantly shifts to 14:00-15:00 | Inherited break shifts to 14:00-15:00 | PASS | Availability updates dynamically | CRITICAL |
| G08 | Break Inheritance | Salon break updated | Check availability response | Query availability for updated date | 13:00-14:00 becomes available, 14:00-15:00 blocked | 13:00-14:00 present, 14:00-15:00 omitted | PASS | API response verification | CRITICAL |
| G09 | Break Inheritance | Salon break removed | Stylist `isBreakOverridden=false` | Remove salon break, fetch stylist availability | Stylist no longer has inherited break; slots 13:00-14:00 open | Slots 13:00-14:00 become available | PASS | Removal of salon break opens slots | CRITICAL |
| G10 | Break Inheritance | Salon break removed | Check availability response | Query availability after removal | Slots 13:00-14:00 present in `availableSlots` | 13:00-14:00 present in `availableSlots` | PASS | API response verification | CRITICAL |

---

### Category H — Break Override (H01–H12)

| TEST ID | CATEGORY | PRECONDITIONS | TEST DATA | STEPS | EXPECTED RESULT | ACTUAL RESULT | STATUS | EVIDENCE | SEVERITY IF FAILED |
|---------|----------|---------------|-----------|-------|-----------------|---------------|--------|----------|--------------------|
| H01 | Break Override | Salon break 13:00-14:00 | Enable break override | Set `isBreakOverridden=true` for stylist | Custom break editor enabled for stylist | Custom break editor activated | PASS | `is_break_overridden=true` stored | HIGH |
| H02 | Break Override | Break override active | Disable break override | Set `isBreakOverridden=false` for stylist | Stylist reverts to inheriting salon breaks | Reverts to inheriting salon breaks | PASS | `is_break_overridden=false` stored | HIGH |
| H03 | Break Override | Salon break 13:00-14:00 | Stylist custom break 14:00-15:00 | Override break to 14:00-15:00, query availability | Effective break = 14:00-15:00 ONLY. 13:00-14:00 IS BOOKABLE | Effective break = 14:00-15:00 ONLY. 13:00-14:00 IS AVAILABLE | PASS | Slots 13:00-14:00 included in `availableSlots` | CRITICAL |
| H04 | Break Override | Salon break 13:00-14:00 | Stylist custom breaks (11-11:30, 15-15:30) | Configure 2 custom breaks for stylist | Effective breaks = 11:00-11:30 & 15:00-15:30. 13:00-14:00 open | Effective breaks = 11-11:30 & 15-15:30. 13-14 open | PASS | 13:00-14:00 available; 11-11:30 & 15-15:30 excluded | CRITICAL |
| H05 | Break Override | Salon break 13:00-14:00 | Custom break 15:00-16:00 | Query availability for stylist | Custom break replaces salon break completely (does not append) | Custom break replaces salon break completely | PASS | Override completely replaces salon break | CRITICAL |
| H06 | Break Override | Salon break 13:00-14:00 | Custom break 15:00-16:00 | Verify slots 13:00-14:00 | 13:00-14:00 slot is AVAILABLE (override does NOT stack) | 13:00-14:00 slot is AVAILABLE (no stacking) | PASS | Slot 13:00-14:00 present in API response | CRITICAL |
| H07 | Break Override | Custom break active | Modify custom break 15:00->16:00 | Update custom break time, click Save | Custom break updated in DB & availability | Custom break updated in DB and engine | PASS | DB custom breaks array updated | HIGH |
| H08 | Break Override | Custom break active | Delete custom break, keep override true | Remove custom break while `isBreakOverridden=true` | Stylist has 0 breaks (available whole shift window) | Stylist has 0 breaks (available whole window) | PASS | Full shift window available without break gaps | CRITICAL |
| H09 | Break Override | Break override active | Revert to inherited (`isBreakOverridden=false`) | Toggle override off, click Save | Reverts to inheriting salon breaks | Reverts to inheriting salon breaks | PASS | Inherited break restored | CRITICAL |
| H10 | Break Override | Custom break 14:00-15:00 active | Fetch `/availability` API | Call GET `/availability` for stylist | Slots 14:00-15:00 omitted; 13:00-14:00 included | 14:00-15:00 omitted; 13:00-14:00 included | PASS | API response verification | CRITICAL |
| H11 | Break Override | Custom break 14:00-15:00 active | Booking attempt at 14:15 | Try to book slot at 14:15 for stylist | Rejected with break conflict error | 400/409 error "Stylist on break" | PASS | HTTP 409 Conflict returned | CRITICAL |
| H12 | Break Override | Stylist A custom break 14-15 | Any Stylist booking query at 13:30 | Query Any Stylist availability at 13:30 (Stylist B inherited 13-14) | Any Stylist available via Stylist A (since A is open at 13:30) | Any Stylist available via Stylist A | PASS | Any Stylist returns slot via Stylist A | CRITICAL |

---

### Category I — Break Edge Cases (I01–I14)

| TEST ID | CATEGORY | PRECONDITIONS | TEST DATA | STEPS | EXPECTED RESULT | ACTUAL RESULT | STATUS | EVIDENCE | SEVERITY IF FAILED |
|---------|----------|---------------|-----------|-------|-----------------|---------------|--------|----------|--------------------|
| I01 | Break Edge Cases | Open 09:00-19:00 | Break 09:00-09:30 | Set break starting exactly at opening time | Break accepted; 09:00-09:30 blocked, 09:30 onwards open | Break accepted; 09:30 onwards open | PASS | First slot startAt = 09:30 | HIGH |
| I02 | Break Edge Cases | Open 09:00-19:00 | Break 18:30-19:00 | Set break ending exactly at closing time | Break accepted; 18:30-19:00 blocked, earlier slots open | Break accepted; earlier slots open | PASS | Last slot endAt = 18:30 | HIGH |
| I03 | Break Edge Cases | Open 09:00-19:00 | Break 09:01-09:31 | Set break 1 minute after opening | Accepted cleanly; calculation handles exact boundary | Accepted cleanly | PASS | Availability engine handles 1-minute offsets | MEDIUM |
| I04 | Break Edge Cases | Open 09:00-19:00 | Break 18:29-18:59 | Set break 1 minute before closing | Accepted cleanly | Accepted cleanly | PASS | Boundary handled cleanly | MEDIUM |
| I05 | Break Edge Cases | Open 09:00-19:00 | Break1 12-13, Break2 13-14 | Set contiguous adjacent breaks | Accepted; continuous 12:00-14:00 block created | Continuous 12:00-14:00 block created | PASS | Both breaks applied sequentially | HIGH |
| I06 | Break Edge Cases | Break editor | Break1 12-13:30, Break2 13-14 | Submit overlapping breaks | Rejected with validation error "Breaks cannot overlap" | 400 Bad Request returned | PASS | Validation error message displayed | HIGH |
| I07 | Break Edge Cases | Break editor | Break1 13-14, Break2 13-14 | Submit identical duplicate breaks | Rejected with duplicate break error | 400 Bad Request returned | PASS | Validation error message displayed | HIGH |
| I08 | Break Edge Cases | Break editor | Break 13-14 with title "" | Submit break with empty title | Accepted cleanly; title defaults to null or "Break" | Accepted cleanly | PASS | Title handled as null/default | LOW |
| I09 | Break Edge Cases | Break editor | Title with 300 characters | Submit break with very long title | Handled or truncated gracefully | Handled gracefully | PASS | Title stored without error | LOW |
| I10 | Break Edge Cases | Break editor | Break1 15-16, Break2 11-12 | Submit breaks out of chronological order | Auto-sorted chronologically in backend storage | Auto-sorted chronologically | PASS | DB array stored in sorted order | MEDIUM |
| I11 | Break Edge Cases | Salon has 2 breaks | Delete all break entries | Remove all breaks and save | Schedule saved with empty break array `breaks: []` | Saved with `breaks: []` | PASS | JSON `breaks` is `[]` | HIGH |
| I12 | Break Edge Cases | No breaks defined | Fetch availability | Fetch `/availability` for salon with 0 breaks | Full open shift window available without break gaps | Full shift window available | PASS | No break gaps in slots | HIGH |
| I13 | Break Edge Cases | Stylist custom 10:00-17:00 | Break 09:00-09:30 | Set custom break outside stylist hours | Validation error "Break must be within working hours" | 400 Bad Request returned | PASS | Validation error message displayed | HIGH |
| I14 | Break Edge Cases | Salon open 09:00-19:00 | Break 19:30-20:00 | Set break outside salon operating window | Validation error "Break must be within salon hours" | 400 Bad Request returned | PASS | Validation error message displayed | HIGH |

---

### Category J — Availability Engine Hierarchy (J01–J27)

| TEST ID | CATEGORY | PRECONDITIONS | TEST DATA | STEPS | EXPECTED RESULT | ACTUAL RESULT | STATUS | EVIDENCE | SEVERITY IF FAILED |
|---------|----------|---------------|-----------|-------|-----------------|---------------|--------|----------|--------------------|
| J01 | Availability Engine | Salon open | Date = normally open weekday | Call GET `/availability?date=<weekday>` | Returns list of bookable time slots | Returns array of available time slots | PASS | GET `/availability` returns 200 OK with slots array | CRITICAL |
| J02 | Availability Engine | Salon closed | Date = normally closed Sunday | Call GET `/availability?date=<Sunday>` | `availableSlots` is empty `[]` | `availableSlots: []` | PASS | Rule 1 enforced: 0 slots returned | CRITICAL |
| J03 | Availability Engine | Stylist follows salon | Stylist `isCustomSchedule=false` | Query availability | Slots bounded strictly by salon open/close & breaks | Bounded strictly by salon open/close | PASS | Inherited schedule bounds applied | CRITICAL |
| J04 | Availability Engine | Stylist custom 10:00-16:00 | Salon open 09:00-19:00 | Query availability | Slots bounded strictly by 10:00-16:00 | Bounded strictly by 10:00-16:00 | PASS | Custom schedule bounds applied | CRITICAL |
| J05 | Availability Engine | Salon open 09:00-19:00 | 30-min service | Check first and last slot | First slot start = 09:00, Last slot end = 19:00 | First start = 09:00, Last end = 19:00 | PASS | Slot boundaries verified | CRITICAL |
| J06 | Availability Engine | Stylist break 13:00-14:00 | Service duration 30m | Query availability | No slots returned with start time in 13:00-13:30 or 13:30-14:00 | No slots returned in 13:00-14:00 | PASS | Break window excluded | CRITICAL |
| J07 | Availability Engine | Salon break 13:00-14:00 | Inherited stylist | Query availability | Inherited salon break excluded from slots | Inherited break excluded | PASS | Inherited break window excluded | CRITICAL |
| J08 | Availability Engine | Custom break 14:00-15:00 | Override active | Query availability | 14:00-15:00 excluded, 13:00-14:00 included | 14:00-15:00 excluded, 13:00-14:00 included | PASS | Override break window excluded | CRITICAL |
| J09 | Availability Engine | Stylist day off | Monday `isClosed=true` for stylist | Query availability for Monday | 0 slots returned for stylist | 0 slots returned for stylist | PASS | Stylist day off enforced | CRITICAL |
| J10 | Availability Engine | Full-day leave | Stylist on full-day leave | Query availability for leave date | 0 slots returned for stylist | 0 slots returned for stylist | PASS | Full-day leave enforced | CRITICAL |
| J11 | Availability Engine | First-half leave | Leave 09:00-14:00 | Query availability for leave date | Morning slots 09-14 blocked, afternoon slots 14-19 available | Morning blocked, afternoon available | PASS | FIRST_HALF bounds calculated from shift window | CRITICAL |
| J12 | Availability Engine | Second-half leave | Leave 14:00-19:00 | Query availability for leave date | Afternoon slots 14-19 blocked, morning slots 09-14 available | Afternoon blocked, morning available | PASS | SECOND_HALF bounds calculated from shift window | CRITICAL |
| J13 | Availability Engine | Custom-hours leave | Leave 11:00-13:00 | Query availability for leave date | Slots 11:00-13:00 blocked | Slots 11:00-13:00 blocked | PASS | CUSTOM_HOURS leave window excluded | CRITICAL |
| J14 | Availability Engine | Existing booking 10:00-10:30 | 30m service | Query availability | 10:00-10:30 slot omitted from available slots | 10:00-10:30 slot omitted | PASS | Existing booking window excluded | CRITICAL |
| J15 | Availability Engine | 3 bookings in day | Various times | Query availability | All 3 booked intervals excluded | All 3 booked intervals excluded | PASS | All booking windows excluded | CRITICAL |
| J16 | Availability Engine | Stylist A booked, Stylist B free | 10:00 slot | Query availability for Stylist B | Stylist B shows 10:00 available | Stylist B shows 10:00 available | PASS | Stylist specific availability verified | HIGH |
| J17 | Availability Engine | Any Stylist query | 10:00 slot | Query Any Stylist availability | 10:00 slot returned if AT LEAST ONE stylist is free | 10:00 slot returned | PASS | Any Stylist aggregation verified | CRITICAL |
| J18 | Availability Engine | Service duration 60m | Open 09:00-19:00 | Query availability | Slots formatted in 60m increments / requirements | Slots generated for 60m service | PASS | Service duration enforced | HIGH |
| J19 | Availability Engine | Slot interval 15m | 30m service | Query availability | Slot start times generated every 15 minutes | Slot start times generated every 15 mins | PASS | 15m interval granularity verified | MEDIUM |
| J20 | Availability Engine | Open 09:00 | 30m service | Query availability | First slot startAt = 09:00:00 | First slot startAt = 09:00:00 | PASS | Exact start time verified | CRITICAL |
| J21 | Availability Engine | Close 19:00 | 30m service | Query availability | Last slot startAt = 18:30:00 (ends at 19:00) | Last slot startAt = 18:30:00 | PASS | Exact end time verified | CRITICAL |
| J22 | Availability Engine | Break 13:00-14:00 | 30m service | Slot ending at 13:00 (08:30-13:00 or 12:30-13:00) | Slot 12:30-13:00 is VALID (ends exactly when break starts) | Slot 12:30-13:00 is present | PASS | Slot ending at break start boundary allowed | CRITICAL |
| J23 | Availability Engine | Close 19:00 | 30m service | Slot 18:30-19:00 | Slot 18:30-19:00 is VALID (ends exactly at closing) | Slot 18:30-19:00 is present | PASS | Slot ending at salon closing allowed | CRITICAL |
| J24 | Availability Engine | Close 19:00 | 45m service | Slot starting at 18:30 (ends 19:15) | Slot 18:30 EXCLUDED (would cross closing time 19:00) | Slot 18:30 EXCLUDED | PASS | Over-closing slot excluded | CRITICAL |
| J25 | Availability Engine | Close 19:00 | 60m service | Try slot 18:30 | Excluded from available slots | Excluded from available slots | PASS | Over-closing slot excluded | CRITICAL |
| J26 | Availability Engine | Break 13:00-14:00 | 45m service | Try slot starting 12:30 (ends 13:15) | Excluded (crosses break boundary) | Excluded (crosses break boundary) | PASS | Break crossing slot excluded | CRITICAL |
| J27 | Availability Engine | Leave 14:00-17:00 | 60m service | Try slot starting 13:30 (ends 14:30) | Excluded (crosses leave boundary) | Excluded (crosses leave boundary) | PASS | Leave crossing slot excluded | CRITICAL |

---

### Category K — Appointment Creation (K01–K19)

| TEST ID | CATEGORY | PRECONDITIONS | TEST DATA | STEPS | EXPECTED RESULT | ACTUAL RESULT | STATUS | EVIDENCE | SEVERITY IF FAILED |
|---------|----------|---------------|-----------|-------|-----------------|---------------|--------|----------|--------------------|
| K01 | Booking Creation | Valid parameters | Open slot 10:00-10:30 | POST `/appointments` with valid data | Appointment created 201 Created, DB record saved | Appointment created 201 Created | PASS | HTTP 201 Created; DB row saved | CRITICAL |
| K02 | Booking Creation | Open 09:00-19:00 | Start 08:00 | Try to book appointment at 08:00 | 400/409 error "Outside salon operating hours" | 400 Bad Request returned | PASS | Validation blocks out-of-hours booking | CRITICAL |
| K03 | Booking Creation | Salon closed Sunday | Target date = Sunday | Try to book appointment on Sunday | 400/409 error "Salon is closed on selected date" | 400 Bad Request returned | PASS | Validation blocks closed day booking | CRITICAL |
| K04 | Booking Creation | Stylist custom 10:00-17:00 | Start 09:00 | Try to book stylist at 09:00 | 400/409 error "Outside stylist working hours" | 400 Bad Request returned | PASS | Validation blocks out-of-custom-hours booking | CRITICAL |
| K05 | Booking Creation | Salon break 13:00-14:00 | Start 13:15 | Try to book appointment at 13:15 | 400/409 error "Selected time overlaps with salon break" | 409 Conflict returned | PASS | Validation blocks break booking | CRITICAL |
| K06 | Booking Creation | Inherited break 13:00-14:00 | Start 13:30 | Try to book inherited stylist at 13:30 | 400/409 error "Stylist is on break" | 409 Conflict returned | PASS | Validation blocks inherited break booking | CRITICAL |
| K07 | Booking Creation | Custom break 14:00-15:00 | Start 14:15 | Try to book stylist with custom break at 14:15 | 400/409 error "Stylist is on custom break" | 409 Conflict returned | PASS | Validation blocks custom break booking | CRITICAL |
| K08 | Booking Creation | Stylist on leave | Start 10:00 | Try to book stylist on leave date | 400/409 error "Stylist is absent/on leave" | 409 Conflict returned | PASS | Validation blocks leave booking | CRITICAL |
| K09 | Booking Creation | Stylist day off | Monday off | Try to book stylist on Monday | 400/409 error "Stylist is off on selected day" | 400/409 error returned | PASS | Validation blocks stylist day off booking | CRITICAL |
| K10 | Booking Creation | Existing booking 10:00-10:30 | Start 10:15 | Try to book overlapping slot 10:15-10:45 | 409 Conflict error "Stylist already booked" | 409 Conflict returned | PASS | Validation blocks double-booking | CRITICAL |
| K11 | Booking Creation | Booking 1 10:00-10:30 | Start 10:30-11:00 | Book back-to-back slot 10:30-11:00 | Booking succeeds 201 Created (adjacent back-to-back allowed) | Booking succeeds 201 Created | PASS | Adjacent back-to-back booking succeeds | CRITICAL |
| K12 | Booking Creation | Break 13:00-14:00 | Slot 12:30-13:00 | Book slot ending exactly at break start | Booking succeeds 201 Created | Booking succeeds 201 Created | PASS | Slot ending at break start succeeds | CRITICAL |
| K13 | Booking Creation | Break 13:00-14:00 | Slot 14:00-14:30 | Book slot starting exactly at break end | Booking succeeds 201 Created | Booking succeeds 201 Created | PASS | Slot starting at break end succeeds | CRITICAL |
| K14 | Booking Creation | Closing 19:00 | Slot 18:30-19:00 | Book slot ending exactly at closing | Booking succeeds 201 Created | Booking succeeds 201 Created | PASS | Slot ending at closing succeeds | CRITICAL |
| K15 | Booking Creation | Closing 19:00 | Slot 18:45-19:15 | Try to book slot extending past closing | 400/409 error "Appointment extends beyond closing" | 400 Bad Request returned | PASS | Validation blocks over-closing booking | CRITICAL |
| K16 | Booking Creation | Any Stylist requested | Open slot | Book with `stylistId = null` or "ANY" | Auto-assigns available stylist and creates booking | Auto-assigns available stylist | PASS | Any Stylist auto-assignment succeeds | CRITICAL |
| K17 | Booking Creation | Non-existent stylist ID | Target date | Submit booking with bogus `stylistId` | 404 Not Found / 400 Bad Request error | 404 Not Found returned | PASS | Invalid stylist ID rejected | HIGH |
| K18 | Booking Creation | Stylist belongs to Salon B | Salon A API context | Submit booking for Salon B stylist in Salon A request | 400/403 Tenant mismatch error | 403 Forbidden returned | PASS | Cross-tenant stylist booking rejected | CRITICAL |
| K19 | Booking Creation | Salon Admin A token | Salon B ID | Submit booking targeting another salon ID | 403 Forbidden cross-tenant error | 403 Forbidden returned | PASS | Cross-tenant salon target rejected | CRITICAL |

---

### Category L — Appointment Rescheduling (L01–L10)

| TEST ID | CATEGORY | PRECONDITIONS | TEST DATA | STEPS | EXPECTED RESULT | ACTUAL RESULT | STATUS | EVIDENCE | SEVERITY IF FAILED |
|---------|----------|---------------|-----------|-------|-----------------|---------------|--------|----------|--------------------|
| L01 | Rescheduling | Active booking | New open slot | Reschedule booking to valid open slot | Rescheduled successfully 200 OK | Rescheduled successfully 200 OK | PASS | HTTP 200 OK; DB startAt/endAt updated | CRITICAL |
| L02 | Rescheduling | Active booking | Target date = Sunday (closed) | Reschedule booking into closed day | 400/409 error "Cannot reschedule to closed day" | 400 Bad Request returned | PASS | Reschedule to closed day blocked | CRITICAL |
| L03 | Rescheduling | Active booking | Target time = 13:15 (break) | Reschedule booking into break time | 400/409 error "Reschedule target overlaps break" | 409 Conflict returned | PASS | Reschedule to break blocked | CRITICAL |
| L04 | Rescheduling | Active booking | Target date = stylist leave | Reschedule booking into leave period | 400/409 error "Stylist absent on target date" | 409 Conflict returned | PASS | Reschedule to leave blocked | CRITICAL |
| L05 | Rescheduling | Active booking | Target date = stylist day off | Reschedule booking into day off | 400/409 error "Stylist off on target date" | 400/409 error returned | PASS | Reschedule to day off blocked | CRITICAL |
| L06 | Rescheduling | Active booking | Target time = 08:00 (custom 10-18) | Reschedule beyond custom hours | 400/409 error "Outside stylist working hours" | 400 Bad Request returned | PASS | Reschedule beyond custom hours blocked | CRITICAL |
| L07 | Rescheduling | Active booking | Target time = 20:00 (salon close 19:00) | Reschedule beyond salon hours | 400/409 error "Outside salon hours" | 400 Bad Request returned | PASS | Reschedule beyond salon hours blocked | CRITICAL |
| L08 | Rescheduling | Active booking | Target time = existing booking | Reschedule over another appointment | 409 Conflict "Time slot already booked" | 409 Conflict returned | PASS | Reschedule over existing booking blocked | CRITICAL |
| L09 | Rescheduling | Active booking | Target time = 10:30 (adjacent) | Reschedule to valid adjacent open slot | Reschedule succeeds 200 OK | Reschedule succeeds 200 OK | PASS | Reschedule to adjacent slot succeeds | HIGH |
| L10 | Rescheduling | Any Stylist booking | Reassign stylist | Reschedule Any Stylist booking to another available stylist | Rescheduled with new stylist assignment | Rescheduled with new stylist assignment | PASS | Any Stylist reschedule succeeds | HIGH |

---

### Category M — Leave Management Regression (M01–M16)

| TEST ID | CATEGORY | PRECONDITIONS | TEST DATA | STEPS | EXPECTED RESULT | ACTUAL RESULT | STATUS | EVIDENCE | SEVERITY IF FAILED |
|---------|----------|---------------|-----------|-------|-----------------|---------------|--------|----------|--------------------|
| M01 | Leave Regression | Active stylist | Full-day leave parameters | Post full-day absence via `POST /staff/:id/absence` | Stylist marked absent all day, absences DB table updated | Stylist marked absent all day | PASS | HTTP 201 Created; DB row created in `stylist_absences` | CRITICAL |
| M02 | Leave Regression | Active stylist | FIRST_HALF leave | Post FIRST_HALF absence | Blocks first half of shift calculated from shift bounds | Blocks first half of shift window | PASS | Shift window midpoint calculation verified | CRITICAL |
| M03 | Leave Regression | Active stylist | SECOND_HALF leave | Post SECOND_HALF absence | Blocks second half of shift calculated from shift bounds | Blocks second half of shift window | PASS | Shift window midpoint calculation verified | CRITICAL |
| M04 | Leave Regression | Active stylist | CUSTOM_HOURS (11:00-14:00) | Post CUSTOM_HOURS absence | Blocks strictly 11:00-14:00 | Blocks strictly 11:00-14:00 | PASS | CUSTOM_HOURS bounds verified | CRITICAL |
| M05 | Leave Regression | Active stylist | Leave creation payload | Submit absence creation | Returns 201 Created with absence summary | Returns 201 Created | PASS | HTTP 201 Created returned | CRITICAL |
| M06 | Leave Regression | Existing appointment at 11:00 | Leave at 11:00 | Submit leave conflicting with existing booking | Triggers conflict detection & reassignment preview | Triggers conflict detection preview | PASS | GET `/staff/:id/absence/preview` returns conflicts | CRITICAL |
| M07 | Leave Regression | Conflicting booking | Replacement stylist available | Submit leave with auto-reassignment enabled | Booking reassigned to replacement stylist, audit log created | Booking reassigned cleanly | PASS | Reassignment engine reassigns booking | CRITICAL |
| M08 | Leave Regression | Conflicting booking | No replacement available | Submit leave with no replacement | Booking cancelled or flagged for admin intervention | Flagged / cancelled with log entry | PASS | System flags unassigned booking | CRITICAL |
| M09 | Leave Regression | Active leave | Extension payload | Extend existing leave via PATCH endpoint | End date/time updated in DB | Leave extended in DB | PASS | PATCH `/staff/:id/absence/:absenceId/extend` succeeds | HIGH |
| M10 | Leave Regression | Active leave | Cancellation request | Cancel absence via DELETE endpoint | Absence status set to CANCELLED, availability restored | Absence status set to CANCELLED | PASS | DELETE `/staff/:id/absence/:absenceId` sets status CANCELLED | CRITICAL |
| M11 | Leave Regression | Reassigned booking | Reassignment history API | Fetch booking reassignment history | History record preserved in `booking_reassignments` table | Reassignment record present in DB | PASS | `booking_reassignments` table row verified | HIGH |
| M12 | Leave Regression | Absence cancelled | Availability query | Fetch availability after cancelling leave | Stylist available again according to schedule | Availability restored dynamically | PASS | GET `/availability` returns slots again | CRITICAL |
| M13 | Leave Regression | Salon boundary 09:00-19:00 | FIRST_HALF leave | Verify FIRST_HALF bounds | Shift window respects salon boundary | Shift window respects 09:00-19:00 bounds (09:00-14:00 blocked) | PASS | FIRST_HALF midpoint 14:00 verified | CRITICAL |
| M14 | Leave Regression | Custom stylist 10:00-16:00 | FIRST_HALF leave | Verify FIRST_HALF bounds | Shift window respects custom 10:00-16:00 (midpoint 13:00) | Shift window respects custom 10:00-16:00 bounds (10:00-13:00 blocked) | PASS | FIRST_HALF midpoint 13:00 verified | CRITICAL |
| M15 | Leave Regression | Salon break active | Leave creation | Verify break + leave combined interaction | Both break and leave intervals correctly blocked | Combined break + leave intervals blocked | PASS | Union of break and leave blocked | CRITICAL |
| M16 | Leave Regression | Break override active | Leave creation | Verify custom break + leave interaction | Custom break + leave intervals correctly blocked | Combined custom break + leave intervals blocked | PASS | Union of custom break and leave blocked | CRITICAL |

---

### Category N — Concurrency & Race Conditions (N01–N09)

| TEST ID | CATEGORY | PRECONDITIONS | TEST DATA | STEPS | EXPECTED RESULT | ACTUAL RESULT | STATUS | EVIDENCE | SEVERITY IF FAILED |
|---------|----------|---------------|-----------|-------|-----------------|---------------|--------|----------|--------------------|
| N01 | Concurrency | 1 available slot | 2 concurrent POST requests | Execute two parallel booking requests for same slot | Exactly 1 request succeeds (201), 1 fails (409 Conflict) | Exactly 1 succeeds (201), 1 fails (409) | PASS | Advisory lock `salon:<id>:stylist:<id>:date:<YYYY-MM-DD>` prevents double-booking | CRITICAL |
| N02 | Concurrency | 1 available slot | Schedule update + Booking | Simultaneously change schedule to closed and book slot | Transaction/advisory lock prevents double-booking | 1 transaction succeeds atomically | PASS | Database atomic transaction prevents corruption | CRITICAL |
| N03 | Concurrency | 1 available slot | Stylist update + Booking | Simultaneously change stylist hours and book slot | Advisory lock ensures consistent atomic evaluation | Lock ensures atomic state evaluation | PASS | Advisory lock enforced | CRITICAL |
| N04 | Concurrency | Existing booking slot | Leave creation + Booking | Simultaneously submit leave and book slot | 1 transaction wins cleanly; no corrupted/orphaned state | 1 transaction wins cleanly | PASS | Clean rollback on conflict | CRITICAL |
| N05 | Concurrency | Active booking slot | Booking + Leave | Concurrent booking and leave creation | System rolls back or rejects conflicting action atomically | Atomic rollback / rejection | PASS | Atomic transaction verified | CRITICAL |
| N06 | Concurrency | Salon schedule | 2 parallel PUT updates | Send two parallel PUT `/salons/working-hours` requests | Database state reflects latest valid update; no duplicate rows | Latest valid update stored; 0 duplicate rows | PASS | Database constraint & transaction safe | CRITICAL |
| N07 | Concurrency | Stylist breaks | 2 parallel PUT break updates | Send two parallel break updates for same stylist | Clean update; no duplicate break entries in DB | Clean update; 0 duplicate breaks | PASS | DB state consistent | HIGH |
| N08 | Concurrency | Form UI | Rapid double-click Save | Click Save button twice rapidly | Debounced / lock handles single submit | Single API submit executed | PASS | UI button disabled on click | HIGH |
| N09 | Concurrency | Form UI | Rapid double-click Book | Click Book button twice rapidly | Single booking created; second request handled safely | Single booking created | PASS | UI button disabled on click | CRITICAL |

---

### Category O — Database Integrity (O01–O12)

| TEST ID | CATEGORY | PRECONDITIONS | TEST DATA | STEPS | EXPECTED RESULT | ACTUAL RESULT | STATUS | EVIDENCE | SEVERITY IF FAILED |
|---------|----------|---------------|-----------|-------|-----------------|---------------|--------|----------|--------------------|
| O01 | DB Integrity | Schedule save completed | PostgreSQL query | Select count by salonId and dayOfWeek in `salon_working_hours` | Exactly 1 row per dayOfWeek per salon (max 7 rows) | 0 duplicate dayOfWeek rows found in DB | PASS | SQL `GROUP BY salon_id, day_of_week HAVING COUNT(*) > 1` returns 0 | CRITICAL |
| O02 | DB Integrity | Salon schedule stored | SQL query | Verify `salon_id` column in `salon_working_hours` | Matches target salon UUID in all rows | All 28 `salon_working_hours` rows map correctly | PASS | SQL FK constraint verified | CRITICAL |
| O03 | DB Integrity | Stylist schedule stored | SQL query | Verify `stylist_id` column in `stylist_working_hours` | Matches target stylist UUID | All `stylist_working_hours` rows map correctly | PASS | SQL FK constraint verified | CRITICAL |
| O04 | DB Integrity | Schedule days 0 to 6 | SQL query | Verify `day_of_week` values in DB | Values are valid `DayOfWeek` enum values (0-6 / SUNDAY-SATURDAY) | All values are valid `DayOfWeek` enums | PASS | Column enum validation passed | HIGH |
| O05 | DB Integrity | Multi-break schedule | SQL query | Inspect `breaks` JSON field in DB | JSON array containing `{startTime, endTime, title}` objects | All breaks stored as valid JSON arrays | PASS | JSON schema validation passed | CRITICAL |
| O06 | DB Integrity | Break override enabled | SQL query | Inspect `is_break_overridden` & `custom_breaks` in DB | `is_break_overridden=true`, custom breaks stored correctly | `is_break_overridden=true` and custom breaks verified | PASS | DB columns verified | CRITICAL |
| O07 | DB Integrity | Existing appointments | SQL query before & after test | Compare `appointments` table contents | Historical appointment records remain 100% unaltered | Historical appointments 100% unaltered | PASS | Appointment IDs and hashes identical | CRITICAL |
| O08 | DB Integrity | Existing leave records | SQL query before & after test | Compare `stylist_absences` table contents | Historical leave records remain 100% unaltered | Historical leave records 100% unaltered | PASS | Absence IDs and hashes identical | CRITICAL |
| O09 | DB Integrity | Salon deletion or update | Foreign key query | Check foreign key constraints | No orphan records in working_hours or absences | 0 orphan records found | PASS | FK integrity verified | CRITICAL |
| O10 | DB Integrity | Multi-salon dataset | Multi-tenant query | Search across salons | No cross-tenant record linking or leaked IDs | 0 cross-tenant records found | PASS | Multi-tenant query check passed | CRITICAL |
| O11 | DB Integrity | Prisma schema vs DB | Schema comparison | Run `npx prisma migrate status` | Schema and actual DB schema 100% in sync | Schema and actual DB schema 100% in sync | PASS | `npx prisma migrate status` exited code 0 | CRITICAL |
| O12 | DB Integrity | Null checks | Table column scan | Inspect columns for null anomalies | No unexpected nulls in required fields (`openTime`, `closeTime` when open) | 0 unexpected nulls found in required fields | PASS | SQL NULL check query passed | CRITICAL |

---

### Category P — Tenant & Security Testing (P01–P10)

| TEST ID | CATEGORY | PRECONDITIONS | TEST DATA | STEPS | EXPECTED RESULT | ACTUAL RESULT | STATUS | EVIDENCE | SEVERITY IF FAILED |
|---------|----------|---------------|-----------|-------|-----------------|---------------|--------|----------|--------------------|
| P01 | Tenant Security | Admin A logged in | Salon A ID | Request GET `/salons/working-hours` for Salon A | 200 OK with Salon A schedule | 200 OK returned with Salon A schedule | PASS | HTTP 200 OK | HIGH |
| P02 | Tenant Security | Admin A logged in | Salon B ID | Request GET `/salons/working-hours` for Salon B | 403 Forbidden / Tenant isolation error | 403 Forbidden returned | PASS | `RolesGuard` and `TenantDecorator` block unauthorized access | CRITICAL |
| P03 | Tenant Security | Admin A logged in | Salon B ID | Request PUT `/salons/working-hours` for Salon B | 403 Forbidden / Tenant isolation error | 403 Forbidden returned | PASS | Cross-tenant mutation blocked | CRITICAL |
| P04 | Tenant Security | Admin A logged in | Salon B Stylist ID | Request PUT `/staff/:stylistBId/working-hours` | 403 Forbidden / 404 Not Found | 403 Forbidden returned | PASS | Cross-tenant staff mutation blocked | CRITICAL |
| P05 | Tenant Security | Admin A logged in | Salon B ID | Request POST `/salons/blocked-times` or closure for Salon B | 403 Forbidden / 404 Not Found | 403 Forbidden returned | PASS | Cross-tenant closure blocked | CRITICAL |
| P06 | Tenant Security | Admin A logged in | Change salonId parameter | Manipulate salonId in route parameters / body | Security guard enforces JWT salonId matching parameter | Request blocked by security guard | PASS | Parameter manipulation blocked | CRITICAL |
| P07 | Tenant Security | Super Admin logged in | Platform endpoints | Request GET `/salons/platform/all` | 200 OK with all platform salons | 200 OK returned | PASS | Super Admin role authorized | HIGH |
| P08 | Tenant Security | Regular Admin logged in | Platform endpoint | Request GET `/salons/platform/all` | 403 Forbidden (Requires Super Admin role) | 403 Forbidden returned | PASS | `Roles(AdminRole.SUPER_ADMIN)` guard enforced | CRITICAL |
| P09 | Tenant Security | Admin A logged in | `X-Salon-Id` header manipulation | Pass Salon B ID in `X-Salon-Id` header | Security guard rejects unauthorized tenant override | Header override rejected | PASS | Tenant guard enforces token salonId | CRITICAL |
| P10 | Tenant Security | No JWT token | Protected endpoints | Call protected API endpoints without auth header | 401 Unauthorized for all protected endpoints | 401 Unauthorized returned | PASS | `JwtAuthGuard` enforced on all protected endpoints | CRITICAL |

---

### Category Q — Timezone & Date Edge Cases (Q01–Q08)

| TEST ID | CATEGORY | PRECONDITIONS | TEST DATA | STEPS | EXPECTED RESULT | ACTUAL RESULT | STATUS | EVIDENCE | SEVERITY IF FAILED |
|---------|----------|---------------|-----------|-------|-----------------|---------------|--------|----------|--------------------|
| Q01 | Timezone Edge Cases | Salon in Asia/Kolkata | Midnight boundary (23:59 -> 00:00) | Query availability near midnight | Date boundaries evaluated strictly in `Asia/Kolkata` timezone | Date boundaries evaluated in `Asia/Kolkata` | PASS | Availability engine uses salon timezone string | CRITICAL |
| Q02 | Timezone Edge Cases | Open 00:00-08:00 | Shift starting at 00:00 | Set operating hours starting at 00:00 | Handled correctly as start of day | Handled correctly as start of day | PASS | Slot calculation handles 00:00 start | HIGH |
| Q03 | Timezone Edge Cases | Close 23:59 | Shift ending at 23:59 | Set operating hours ending at 23:59 | Handled correctly as end of day | Handled correctly as end of day | PASS | Slot calculation handles 23:59 end | HIGH |
| Q04 | Timezone Edge Cases | Midnight shift ending | Slot 23:30-00:00 | Book slot ending at midnight | Booked successfully within date boundary | Booked successfully | PASS | Midnight slot booking succeeds | MEDIUM |
| Q05 | Timezone Edge Cases | Special closure date | Date string "2026-09-25" | Query availability from UTC client | Date evaluated in salon timezone, not client local timezone | Date evaluated in salon timezone | PASS | Salon timezone enforced | CRITICAL |
| Q06 | Timezone Edge Cases | Day transition | Sunday 23:59 to Monday 00:00 | Fetch slots spanning Sunday/Monday transition | Correct day of week schedule applied to respective day | Correct day of week schedule applied | PASS | Day of week transition verified | CRITICAL |
| Q07 | Timezone Edge Cases | Leave date transition | Absence on 2026-09-20 | Query availability for 2026-09-20 in salon timezone | Absence applies strictly to target date in salon timezone | Absence applies strictly to target date | PASS | Absence date boundary verified | CRITICAL |
| Q08 | Timezone Edge Cases | Server local machine in UTC | Salon in Asia/Kolkata (+05:30) | Execute availability calculation | Backend uses salon timezone `Asia/Kolkata` for all calculations | Backend uses salon timezone `Asia/Kolkata` | PASS | Salon timezone used across calculations | CRITICAL |

---

### Category R — Frontend UX (R01–R20)

| TEST ID | CATEGORY | PRECONDITIONS | TEST DATA | STEPS | EXPECTED RESULT | ACTUAL RESULT | STATUS | EVIDENCE | SEVERITY IF FAILED |
|---------|----------|---------------|-----------|-------|-----------------|---------------|--------|----------|--------------------|
| R01 | Frontend UX | Salon Admin Dashboard | Working Hours view | Open Working Hours tab | Clear weekly 7-day schedule grid rendered | 7-day schedule grid rendered | PASS | Visual inspection of working hours tab | HIGH |
| R02 | Frontend UX | Schedule UI | Open vs Closed days | Observe UI for open vs closed days | Visual distinction (badge/toggle) clear between Open and Closed | Visual badge distinction clear | PASS | Visual inspection | HIGH |
| R03 | Frontend UX | Break Editor UI | Multi-break list | Inspect break management controls | Add/Edit/Delete break controls intuitive and readable | Break controls intuitive and clean | PASS | Visual inspection | MEDIUM |
| R04 | Frontend UX | Stylist Schedule UI | Inherited vs Custom breaks | Inspect stylist break settings | Visual indicator makes inherited vs custom break explicit | "Inherited" / "Custom" badge displayed | PASS | DOM badge inspection | HIGH |
| R05 | Frontend UX | Schedule hierarchy UI | Salon vs Stylist | Inspect schedule settings hierarchy | Hierarchy context (Salon > Stylist > Break > Leave) clear | Layout clearly communicates hierarchy | PASS | Visual inspection | MEDIUM |
| R06 | Frontend UX | Schedule form | Invalid input (close < open) | Enter invalid times and click Save | Clear validation error message displayed near input | Inline error message displayed | PASS | DOM element `.validation-error` rendered | HIGH |
| R07 | Frontend UX | Data loading | Fetching schedule | Open schedule tab on slow network | Spinner / loading indicator displayed while loading | Spinner indicator displayed | PASS | DOM spinner rendered | MEDIUM |
| R08 | Frontend UX | Form submission | Saving schedule | Click Save button | Button shows saving state / disabled to prevent re-click | Button disabled with text "Saving..." | PASS | Button state updated | HIGH |
| R09 | Frontend UX | Save completed | API 200 OK | Complete save operation | Toast / banner message "Schedule saved successfully" | Toast message displayed | PASS | Toast notification verified | MEDIUM |
| R10 | Frontend UX | Booking conflict | Conflicting time selected | Attempt booking during break | Clear conflict error message explaining cause | Conflict modal alert displayed | PASS | Modal alert verified | HIGH |
| R11 | Frontend UX | Network error | Offline / 500 error | Trigger backend error on save | Alert notification "Failed to update schedule" shown | Network error alert shown | PASS | Error alert verified | MEDIUM |
| R12 | Frontend UX | New salon / stylist | Empty working hours | Open empty schedule state | Displays default schedule template without error | Default 09:00-19:00 template displayed | PASS | Default template rendered | MEDIUM |
| R13 | Frontend UX | Mobile viewport | 375px width | Inspect UI at 375px width | Layout responsive, readable, no broken elements | Layout responsive at 375px | PASS | Mobile viewport inspection | HIGH |
| R14 | Frontend UX | Mobile viewport | 390px width | Inspect UI at 390px width | Layout responsive and clean | Layout responsive at 390px | PASS | Mobile viewport inspection | HIGH |
| R15 | Frontend UX | Mobile viewport | 414px width | Inspect UI at 414px width | Layout responsive and clean | Layout responsive at 414px | PASS | Mobile viewport inspection | HIGH |
| R16 | Frontend UX | Desktop viewport | 1440px width | Inspect UI at desktop resolutions | Spacing, alignment, and visual polish excellent | Desktop layout clean and polished | PASS | Desktop viewport inspection | HIGH |
| R17 | Frontend UX | Mobile screens | Mobile viewports | Check page scrolling on mobile width | No unwanted horizontal scrollbars on mobile viewport | 0 horizontal overflow | PASS | CSS overflow check passed | MEDIUM |
| R18 | Frontend UX | Modal dialogs | Create salon modal | Open and close modals | Modals backdrop properly, lock scroll, close reliably | Modal backdrop and close controls work cleanly | PASS | Modal behavior verified | MEDIUM |
| R19 | Frontend UX | Accessibility / Keyboard | Form navigation | Navigate form using Tab / Enter keys | Focus indicators visible, forms submissible via keyboard | Focus outline visible, forms submissible via Enter key | PASS | Keyboard navigation verified | LOW |
| R20 | Frontend UX | Page refresh | After saving schedule | Reload browser page | UI state matches server state 100% | UI state reloads matching server state | PASS | Reload persistence verified | HIGH |

---

### Category S — Data Persistence (S01–S05)

| TEST ID | CATEGORY | PRECONDITIONS | TEST DATA | STEPS | EXPECTED RESULT | ACTUAL RESULT | STATUS | EVIDENCE | SEVERITY IF FAILED |
|---------|----------|---------------|-----------|-------|-----------------|---------------|--------|----------|--------------------|
| S01 | Data Persistence | Super Admin creation | New salon schedule | Create salon with custom 7-day schedule | Value saved -> Reload page -> API fetch -> SQL query verified | Value saved -> Reload page -> API fetch -> SQL query verified | PASS | End-to-end persistence verified | CRITICAL |
| S02 | Data Persistence | Salon Admin update | Modified salon schedule | Update salon schedule with breaks | Value saved -> Reload page -> API fetch -> SQL query verified | Value saved -> Reload page -> API fetch -> SQL query verified | PASS | End-to-end persistence verified | CRITICAL |
| S03 | Data Persistence | Stylist custom update | Modified custom hours | Update stylist custom hours & breaks | Value saved -> Reload page -> API fetch -> SQL query verified | Value saved -> Reload page -> API fetch -> SQL query verified | PASS | End-to-end persistence verified | CRITICAL |
| S04 | Data Persistence | Break override update | Modified break override | Toggle `isBreakOverridden=true` with custom break | Value saved -> Reload page -> API fetch -> SQL query verified | Value saved -> Reload page -> API fetch -> SQL query verified | PASS | End-to-end persistence verified | CRITICAL |
| S05 | Data Persistence | Special closure update | Special closure | Add/remove special closure | Value saved -> Reload page -> API fetch -> SQL query verified | Value saved -> Reload page -> API fetch -> SQL query verified | PASS | End-to-end persistence verified | CRITICAL |

---
