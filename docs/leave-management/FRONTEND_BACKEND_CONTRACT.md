# FRONTEND-BACKEND DATA CONTRACT
## Employee Leave & Availability Override System

---

## 1. CREATE / MARK LEAVE CONTRACT (`POST /staff/:id/absence`)

| UI Form Field | API Request Payload Field | Backend Data Type | Required? | Transformation / Value Range |
|---|---|---|---|---|
| Stylist | `staffId` (URL Param) | String (UUID) | Yes | Direct URL parameter |
| Start Date | `startDate` | String (YYYY-MM-DD) | Yes | Preserved `YYYY-MM-DD` string |
| End Date | `endDate` | String (YYYY-MM-DD) | Yes | Preserved `YYYY-MM-DD` string |
| Leave Type | `leaveType` | Enum String | Optional | Enum: `SICK_LEAVE`, `CASUAL_LEAVE`, `EMERGENCY_LEAVE`, `UNPAID_LEAVE`, `OTHER` |
| Leave Portion | `leavePortion` | Enum String | Optional | Enum: `FULL_DAY`, `FIRST_HALF`, `SECOND_HALF`, `CUSTOM_HOURS` |
| Start Time | `customStartTime` | String (HH:mm) | Optional (Req for `CUSTOM_HOURS`) | Preserved `HH:mm` 24-hr string |
| End Time | `customEndTime` | String (HH:mm) | Optional (Req for `CUSTOM_HOURS`) | Preserved `HH:mm` 24-hr string |
| Reason | `reason` | String | Optional | Direct text |
| Notes | `notes` | String | Optional | Direct text |

---

## 2. PREVIEW LEAVE IMPACT CONTRACT (`GET /staff/:id/absence/preview`)

| UI Parameter | Query String Parameter | Backend Data Type | Required? | Transformation / Value Range |
|---|---|---|---|---|
| Start Date | `startDate` | String (YYYY-MM-DD) | Yes | URL query parameter |
| End Date | `endDate` | String (YYYY-MM-DD) | Yes | URL query parameter |
| Leave Portion | `leavePortion` | Enum String | Optional | URL query parameter |
| Start Time | `customStartTime` | String (HH:mm) | Optional | URL query parameter |
| End Time | `customEndTime` | String (HH:mm) | Optional | URL query parameter |

### Response Field Mapping (`PreviewAbsenceResponse`)
- `affectedBookingsCount` $\to$ Total number of affected bookings across date range.
- `canAutoReassignCount` $\to$ Number of appointments that can be automatically reassigned.
- `unresolvableCount` $\to$ Number of appointments with no replacement candidate.
- `details` $\to$ Array of `{ appointmentNumber, serviceName, customerName, customerPhone, startAt, endAt, willReassign, potentialReplacement }`.

---

## 3. EXTEND LEAVE CONTRACT (`PATCH /staff/:id/absence/:absenceId/extend`)

| UI Form Field | API Request Payload Field | Backend Data Type | Required? | Transformation |
|---|---|---|---|---|
| New End Date | `newEndDate` | String (YYYY-MM-DD) | Yes | Preserved `YYYY-MM-DD` string |

---

## 4. CANCEL LEAVE CONTRACT (`DELETE /staff/:id/absence/:absenceId`)

- **URL Parameters**: `staffId` (UUID), `absenceId` (UUID)
- **Response**: Updated `StylistAbsence` record with `status = "CANCELLED"`.

---

## 5. LEAVE HISTORY CONTRACT (`GET /staff/:id/absences`)

| UI Filter Field | Query String Parameter | Backend Data Type | Required? | Transformation |
|---|---|---|---|---|
| Filter Start Date | `startDate` | String (YYYY-MM-DD) | Optional | URL query parameter |
| Filter End Date | `endDate` | String (YYYY-MM-DD) | Optional | URL query parameter |

### Response Array Fields (`StylistAbsence[]`)
- `id`, `startDate`, `endDate`, `absenceDate`, `leaveType`, `leavePortion`, `customStartTime`, `customEndTime`, `status`, `processingStatus`, `affectedBookingsCount`, `reassignedCount`, `unresolvableCount`, `reassignments[]`.
