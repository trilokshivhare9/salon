# ADVISORY LOCK KEY MATRIX
## Resource Locking Identity Specification

---

## 1. LOCK HIERARCHY & KEY FORMULATION

All scheduling operations use 2-level signed 32-bit integer PostgreSQL advisory transaction locks (`pg_advisory_xact_lock` / `pg_advisory_xact_lock_shared`).

- **Level 1 Key (`key1`)**: `hashToSignedInt32("salon:" + salonId)` — Isolates lock scope per salon.
- **Level 2 Key (`key2`)**: Resource-specific 32-bit hash.

---

## 2. LOCK KEY IDENTITY MATRIX

| Operation | Target Resource | Lock Function | Level 1 Key (`key1`) | Level 2 Key (`key2`) | Date Normalization | Lock Compatibility Status |
|---|---|---|---|---|---|---|
| **Appointment Creation** (Specific Stylist) | Stylist Schedule | `pg_advisory_xact_lock` | `salon:${salonId}` | `stylist:${stylistId}:${dateStr}` | Canonical `YYYY-MM-DD` | **COMPATIBLE** (after BUG-02 fix) |
| **Appointment Creation** (Any Stylist) | Stylist Candidate | `pg_try_advisory_xact_lock` | `salon:${salonId}` | `stylist:${candidateId}:${dateStr}` | Canonical `YYYY-MM-DD` | **COMPATIBLE** (after BUG-02 fix) |
| **Appointment Rescheduling** | Target Stylist | `pg_advisory_xact_lock` | `salon:${salonId}` | `stylist:${targetStylistId}:${dateStr}` | Canonical `YYYY-MM-DD` | **COMPATIBLE** |
| **Leave Creation** | Absent Stylist | `pg_advisory_xact_lock` | `salon:${salonId}` | `stylist:${stylistId}:${dateStr}` | Canonical `YYYY-MM-DD` (`toISODate()`) | **COMPATIBLE** |
| **Leave Extension** | Absent Stylist | `pg_advisory_xact_lock` | `salon:${salonId}` | `stylist:${stylistId}:${dateStr}` | Canonical `YYYY-MM-DD` (`toISODate()`) | **COMPATIBLE** |
| **Reassignment Candidate Evaluation** | Replacement Candidate | `pg_advisory_xact_lock` | `salon:${salonId}` | `stylist:${candidateId}:${dateIso}` | Canonical `YYYY-MM-DD` (`toISODate()`) | **COMPATIBLE** |
| **Staff Working Hours Update** | Salon Day Schedule | `pg_advisory_xact_lock` | `salon:${salonId}` | `schedule:${dayOfWeek}` | N/A (DayOfWeek Enum) | **COMPATIBLE** |
| **Salon Working Hours Update** | Salon Day Schedule | `pg_advisory_xact_lock` | `salon:${salonId}` | `schedule:${dayOfWeek}` | N/A (DayOfWeek Enum) | **COMPATIBLE** |

---

## 3. CANONICAL DATE NORMALIZATION SPECIFICATION
To ensure 100% lock hash collision between appointment booking and leave creation, `dateStr` MUST be formatted as a pure 10-character ISO date string (`YYYY-MM-DD`) in local salon timezone:

```ts
const dateStr = dto.date.includes('T') ? dto.date.split('T')[0] : dto.date;
```
This guarantees that `createAppointment` with `dto.date = "2026-09-25T00:00:00.000Z"` and `processLeaveCreation` with `dateDt.toISODate() = "2026-09-25"` produce identical integer lock hashes.
