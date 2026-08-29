# RESTful API Architecture & Specification

**Document Version:** 1.0.0  
**API Protocol:** REST over HTTPS  
**Base URL:** `/api/v1`  
**Data Format:** JSON (`Content-Type: application/json`)  
**Authentication Scheme:** Bearer JWT in `Authorization` header  

---

## 1. Global Standards & Conventions

### 1.1 Response Envelopes
All successful responses return either the resource directly or wrapped with pagination metadata:

```json
{
  "success": true,
  "data": { ... },
  "message": "Operation completed successfully"
}
```

Paginated Responses:
```json
{
  "success": true,
  "data": [ ... ],
  "meta": {
    "total": 42,
    "page": 1,
    "limit": 20,
    "totalPages": 3
  }
}
```

### 1.2 Standard Error Envelope
```json
{
  "statusCode": 409,
  "error": "Conflict",
  "message": "This slot was just booked by another customer. Please select another available time.",
  "timestamp": "2026-08-28T15:34:22.102Z",
  "path": "/api/v1/booking/xyz-salon/appointments"
}
```

---

## 2. Authentication & Session Endpoints (`/api/v1/auth`)

### `POST /api/v1/auth/login`
Authenticates a salon owner, staff user, or platform admin.

* **Request Body:**
```json
{
  "email": "owner@glamstudio.com",
  "password": "SecurePassword123!"
}
```
* **Response `(200 OK)`:**
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6...",
    "expiresIn": 86400,
    "user": {
      "id": "01918a5e-1111-7000-8000-000000000001",
      "name": "Pooja Verma",
      "email": "owner@glamstudio.com",
      "role": "SALON_ADMIN",
      "salon": {
        "id": "01918a5e-2222-7000-8000-000000000002",
        "name": "Glamour Studio",
        "slug": "glamour-studio",
        "timezone": "Asia/Kolkata"
      }
    }
  }
}
```

### `GET /api/v1/auth/me`
* **Headers:** `Authorization: Bearer <token>`
* **Response `(200 OK)`:** Current authenticated user profile with active permissions.

---

## 3. Public Web Booking Endpoints (`/api/v1/booking`)

*No authentication required. Protected by client rate limiting and CAPTCHA / bot throttling.*

### `GET /api/v1/booking/:salonSlug`
Retrieves public salon profile, active services, staff roster, and booking rules.

* **Response `(200 OK)`:**
```json
{
  "success": true,
  "data": {
    "id": "01918a5e-2222-7000-8000-000000000002",
    "name": "Glamour Studio",
    "slug": "glamour-studio",
    "logoUrl": "https://cdn.example.com/logos/glamour.png",
    "phone": "+919876543210",
    "address": "123 MG Road, Indiranagar",
    "city": "Bengaluru",
    "timezone": "Asia/Kolkata",
    "description": "Premium hair styling and skincare lounge.",
    "rules": {
      "slotIntervalMinutes": 30,
      "minAdvanceNoticeMins": 30,
      "maxAdvanceDays": 30,
      "cancelWindowHours": 2,
      "allowSpecificStaff": true
    },
    "services": [
      {
        "id": "01918a5e-3333-7000-8000-000000000003",
        "name": "Haircut & Styling",
        "description": "Precision haircut with wash and blow dry",
        "price": "500.00",
        "durationMinutes": 45,
        "category": "Hair"
      }
    ]
  }
}
```

### `GET /api/v1/booking/:salonSlug/availability`
Calculates real-time available booking slots for a requested service and date.

* **Query Parameters:**
  * `serviceId` (UUID string, required)
  * `date` (ISO date string `YYYY-MM-DD`, required)
  * `staffId` (UUID string, optional — if omitted, calculates for "Any Available Staff")
* **Response `(200 OK)`:**
```json
{
  "success": true,
  "data": {
    "date": "2026-08-29",
    "timezone": "Asia/Kolkata",
    "serviceDurationMinutes": 45,
    "availableSlots": [
      {
        "startTime": "10:00",
        "endTime": "10:45",
        "isoStartTime": "2026-08-29T04:30:00.000Z",
        "availableStaffCount": 2,
        "eligibleStaffIds": [
          "01918a5e-4444-7000-8000-000000000004",
          "01918a5e-5555-7000-8000-000000000005"
        ]
      },
      {
        "startTime": "10:30",
        "endTime": "11:15",
        "isoStartTime": "2026-08-29T05:00:00.000Z",
        "availableStaffCount": 1,
        "eligibleStaffIds": [
          "01918a5e-4444-7000-8000-000000000004"
        ]
      }
    ]
  }
}
```

### `POST /api/v1/booking/:salonSlug/appointments`
Atomic creation of public customer appointment.

* **Request Body:**
```json
{
  "serviceId": "01918a5e-3333-7000-8000-000000000003",
  "staffId": "01918a5e-4444-7000-8000-000000000004", // optional
  "date": "2026-08-29",
  "startTime": "10:00", // local salon time (HH:mm)
  "customerName": "Aarav Sharma",
  "customerPhone": "+919812345678",
  "customerEmail": "aarav@example.com",
  "notes": "First time visit"
}
```
* **Response `(201 Created)`:**
```json
{
  "success": true,
  "data": {
    "appointmentId": "01918a5e-6666-7000-8000-000000000006",
    "appointmentNumber": "SAL-1001",
    "status": "CONFIRMED",
    "serviceName": "Haircut & Styling",
    "staffName": "Rahul Mehta",
    "date": "2026-08-29",
    "startTime": "10:00 AM",
    "endTime": "10:45 AM",
    "price": "500.00",
    "salon": {
      "name": "Glamour Studio",
      "address": "123 MG Road, Indiranagar, Bengaluru",
      "phone": "+919876543210"
    }
  }
}
```
* **Conflict Response `(409 Conflict)`:**
```json
{
  "statusCode": 409,
  "error": "Conflict",
  "message": "This slot was just booked by another customer. Please select another time."
}
```

---

## 4. Salon Dashboard & Appointment Management (`/api/v1/appointments`)

*Requires `SALON_ADMIN` or `STAFF` Bearer token.*

### `GET /api/v1/appointments`
Retrieves salon appointments with filtering and calendar projection.

* **Query Parameters:**
  * `startDate` (`YYYY-MM-DD`, required)
  * `endDate` (`YYYY-MM-DD`, required)
  * `staffId` (UUID string, optional)
  * `status` (Enum string, optional)
* **Response `(200 OK)`:**
```json
{
  "success": true,
  "data": [
    {
      "id": "01918a5e-6666-7000-8000-000000000006",
      "appointmentNumber": "SAL-1001",
      "date": "2026-08-29",
      "startTime": "2026-08-29T04:30:00.000Z",
      "endTime": "2026-08-29T05:15:00.000Z",
      "status": "CONFIRMED",
      "source": "WEB",
      "price": "500.00",
      "customer": {
        "id": "01918a5e-7777-7000-8000-000000000007",
        "name": "Aarav Sharma",
        "phone": "+919812345678"
      },
      "staff": {
        "id": "01918a5e-4444-7000-8000-000000000004",
        "name": "Rahul Mehta"
      },
      "service": {
        "id": "01918a5e-3333-7000-8000-000000000003",
        "name": "Haircut & Styling",
        "durationMinutes": 45
      }
    }
  ]
}
```

### `POST /api/v1/appointments` (Manual & Walk-in Creation)
* **Request Body:**
```json
{
  "customerId": "01918a5e-7777-7000-8000-000000000007", // OR provide customerName & customerPhone
  "customerName": "Rohan Gupta",
  "customerPhone": "+919822233344",
  "serviceId": "01918a5e-3333-7000-8000-000000000003",
  "staffId": "01918a5e-4444-7000-8000-000000000004",
  "date": "2026-08-29",
  "startTime": "11:30",
  "source": "WALK_IN", // 'PHONE', 'WALK_IN', 'MANUAL'
  "notes": "Walk-in client arrived at 11:25"
}
```

### `PATCH /api/v1/appointments/:id/status`
* **Request Body:**
```json
{
  "status": "CHECKED_IN", // 'CHECKED_IN', 'IN_SERVICE', 'COMPLETED', 'CANCELLED', 'NO_SHOW'
  "reason": "Customer arrived at reception"
}
```

### `POST /api/v1/appointments/:id/reschedule`
* **Request Body:**
```json
{
  "newDate": "2026-08-30",
  "newStartTime": "14:00",
  "staffId": "01918a5e-4444-7000-8000-000000000004"
}
```

---

## 5. Staff, Services & Configuration Endpoints

### Staff (`/api/v1/staff`)
* `GET /api/v1/staff` — List all salon staff with assigned services.
* `POST /api/v1/staff` — Add new staff member.
* `PUT /api/v1/staff/:id` — Update staff profile and active status.
* `PUT /api/v1/staff/:id/services` — Update staff service capability mappings.
* `PUT /api/v1/staff/:id/working-hours` — Configure staff weekly schedule.
* `POST /api/v1/staff/:id/breaks` — Add scheduled breaks.

### Services (`/api/v1/services`)
* `GET /api/v1/services` — List salon service catalog.
* `POST /api/v1/services` — Create new service.
* `PUT /api/v1/services/:id` — Update service price, duration, category.
* `DELETE /api/v1/services/:id` — Deactivate / archive service.

### Salon Working Hours, Holidays & Blocked Time (`/api/v1/salons`)
* `GET /api/v1/salons/working-hours` — Get weekly salon schedule.
* `PUT /api/v1/salons/working-hours` — Update weekly salon opening hours.
* `POST /api/v1/salons/holidays` — Add closed holiday date.
* `POST /api/v1/salons/blocked-time` — Block specific time slot for staff or salon.

---

## 6. Customers CRM Ledger (`/api/v1/customers`)

### `GET /api/v1/customers`
* **Query Parameters:** `search` (phone or name), `page`, `limit`
* **Response `(200 OK)`:** List of customers with total visits, lifetime spend, and last visit date.

### `GET /api/v1/customers/:id`
* **Response `(200 OK)`:** Full customer profile with historical appointment ledger.

---

## 7. WhatsApp Cloud API Webhook (`/api/v1/whatsapp`)

### `GET /api/v1/whatsapp/webhook`
* Handles Meta webhook verification handshake (`hub.mode`, `hub.verify_token`, `hub.challenge`).

### `POST /api/v1/whatsapp/webhook`
* Receives incoming messages, status updates, button clicks, and executes conversation state machine transitions.
