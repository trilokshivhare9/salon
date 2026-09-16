# FRONTEND-BACKEND PARITY ANALYSIS
## Employee Leave & Availability Override System

---

## 1. EXECUTIVE SUMMARY

An architectural discovery was conducted across the backend capabilities and the frontend single-page web app (`apps/web/`).

The backend supports multi-day leave ranges, half-day leave portions (`FIRST_HALF`, `SECOND_HALF`), custom hourly leave windows (`CUSTOM_HOURS`), leave extensions, leave cancellations, live impact previews, multi-status processing lifecycles (`PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`), and detailed reassignment tracking.

The current frontend (`apps/web/js/dashboard.js`, `api.js`) contains a single-day "Mark Absent" popup without support for multi-day ranges, half-day options, custom hours, leave extensions, or detailed leave history views.

---

## 2. CAPABILITY COMPARISON MATRIX

| Feature / Domain | Backend Capability | Current Frontend Capability | Missing Frontend Gap |
|---|---|---|---|
| **Date Range** | `startDate` & `endDate` multi-day ranges | Single `date` picker | Multi-day `startDate` + `endDate` pickers |
| **Leave Portion** | `FULL_DAY`, `FIRST_HALF`, `SECOND_HALF`, `CUSTOM_HOURS` | Implicit `FULL_DAY` | Dynamic dropdown for `LeavePortion` |
| **Custom Hours** | `customStartTime` & `customEndTime` (HH:mm) | None | Time pickers conditionally rendered for `CUSTOM_HOURS` |
| **Leave Type** | `SICK_LEAVE`, `CASUAL_LEAVE`, `EMERGENCY_LEAVE`, `UNPAID_LEAVE`, `OTHER` | Custom hardcoded string reasons | Canonical enum dropdown matching backend |
| **Live Impact Preview** | Supports `startDate`, `endDate`, `leavePortion`, `customStartTime`, `customEndTime` | Single date preview | Dynamic multi-param preview query on input changes |
| **Processing Lifecycle** | `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED` | Binary alert | Dedicated processing status badges & failure state alerts |
| **Leave History & List** | `GET /staff/:id/absences` with reassignment details | Inlined date check | Dedicated Leave Management tab / history view per stylist |
| **Extend Leave** | `PATCH /staff/:id/absence/:absenceId/extend` | None | Extend Leave modal with preview of incremental dates |
| **Cancel Leave** | `DELETE /staff/:id/absence/:absenceId` | Confirmation alert | Cancel Leave action with reassignment preservation notice |
| **Staff Floor Badges** | Portion-aware availability overrides | Generic "Absent Today" | Badges showing "On Leave (First Half)", "Leave: Sep 20-25", etc. |

---

## 3. API MAPPING

| Operation | Backend Endpoint | Frontend API Method (Current) | Target Method / Extension |
|---|---|---|---|
| **Mark / Create Leave** | `POST /staff/:id/absence` | `ApiClient.markStaffAbsence` | Supports `startDate`, `endDate`, `leaveType`, `leavePortion`, `customStartTime`, `customEndTime`, `reason`, `notes` |
| **Preview Impact** | `GET /staff/:id/absence/preview` | `ApiClient.previewStaffAbsence` | Updated to accept `queryParams` object (`startDate`, `endDate`, `leavePortion`, `customStartTime`, `customEndTime`) |
| **Get Absences History** | `GET /staff/:id/absences` | `ApiClient.getStaffAbsences` | Consumed in new Leave History view with date filters |
| **Extend Leave** | `PATCH /staff/:id/absence/:absenceId/extend` | *Missing* | Added `ApiClient.extendStaffAbsence(staffId, absenceId, payload)` |
| **Cancel Leave** | `DELETE /staff/:id/absence/:absenceId` | `ApiClient.cancelStaffAbsence` | Consumed with confirmation & state refresh |

---

## 4. UI/UX IMPLEMENTATION PLAN

1. **`apps/web/js/api.js`**:
   - Add `extendStaffAbsence(staffId, absenceId, payload)`.
   - Update `previewStaffAbsence(staffId, queryParams)` to build query string from parameters object.

2. **`apps/web/js/dashboard.js`**:
   - Evolve `showMarkAbsentModal` into a comprehensive **Leave Management Form Modal**:
     - Stylist selector / display name.
     - Start Date & End Date inputs with auto-sync `endDate = startDate`.
     - Leave Type enum selector (`SICK_LEAVE`, `CASUAL_LEAVE`, `EMERGENCY_LEAVE`, `UNPAID_LEAVE`, `OTHER`).
     - Leave Portion selector (`FULL_DAY`, `FIRST_HALF`, `SECOND_HALF`, `CUSTOM_HOURS`).
     - Dynamic Custom Hours inputs (`customStartTime`, `customEndTime`), rendered only when `CUSTOM_HOURS` selected.
     - Dynamic Live Impact Preview box triggered on date/portion/time changes.
     - Confirmation summary step detailing affected bookings, auto-reassignments, and unresolvable counts.
   - Add **Leave History & Management View** (`showLeaveHistoryModal`):
     - Displays table/cards of active, upcoming, past, and cancelled leaves.
     - Displays `processingStatus` (`COMPLETED`, `PROCESSING`, `FAILED`) and outcome counters.
     - Action buttons: *Extend Leave*, *Cancel Leave*, *View Details*.
   - Add **Extend Leave Modal** (`showExtendLeaveModal`):
     - New End Date picker (`newEndDate`).
     - Preview of incremental date impact.
   - Update Staff List & Stylist Cards:
     - Render portion-aware leave badges (e.g. `First Half Leave`, `Custom Leave (11:00-15:00)`).

3. **Responsive & Styling**:
   - Mobile-responsive layout for modals and history cards using vanilla CSS.
