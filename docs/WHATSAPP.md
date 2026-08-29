# WhatsApp Business Cloud API Integration Architecture

**Document Version:** 1.0.0  
**API Standard:** Meta WhatsApp Business Platform (Cloud API v20.0+)  
**Architecture Rule:** WhatsApp is strictly an input/output communication adapter. It NEVER holds booking logic or calculates availability independently.

---

## 1. Integration Philosophy & Channel Decoupling

```
+-----------------------------------------------------------------------------------+
|                            COMMUNICATION LAYER (WhatsApp)                         |
|                                                                                   |
|  [ Customer WhatsApp ] <---> [ Meta WhatsApp Cloud API ] <---> [ Webhook Receiver]|
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|                        CONVERSATION ADAPTER & STATE MACHINE                       |
|                                                                                   |
|  - Parse Incoming Message (Text, Button Reply, List Selection)                    |
|  - Fetch / Transition State in PostgreSQL (`conversations` table)                 |
|  - Transform User Input into Structured Booking Engine Queries                    |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
+-----------------------------------------------------------------------------------+
|                    CENTRAL BOOKING ENGINE & APPOINTMENT SERVICE                   |
|                                                                                   |
|  - getAvailableSlots(salonId, serviceId, staffId, date)                           |
|  - createAppointment({ salonId, serviceId, staffId, date, time, customerInfo })   |
+-----------------------------------------------------------------------------------+
```

---

## 2. Conversation State Machine Specification

Each ongoing chat session maintains a persistent record in `conversations` indexed by `(salon_id, customer_phone)`:

```
                  +-----------------------------------+
                  |               START               |
                  |     (Customer says "Hi" / "Book") |
                  +-----------------------------------+
                                    |
                                    v
                  +-----------------------------------+
                  |          SELECT_SERVICE           |
                  |  (Presents Interactive List of    |
                  |   Active Salon Services & Prices) |
                  +-----------------------------------+
                                    |
                                    v
                  +-----------------------------------+
                  |           SELECT_STAFF            |
                  |  (Shows Qualified Staff Members   |
                  |   or "Any Available")             |
                  +-----------------------------------+
                                    |
                                    v
                  +-----------------------------------+
                  |            SELECT_DATE            |
                  |  (Presents Quick Reply Buttons:   |
                  |   Today, Tomorrow, Specific Date) |
                  +-----------------------------------+
                                    |
                                    v
                  +-----------------------------------+
                  |            SELECT_TIME            |
                  |  (Queries Central Engine for real |
                  |   available slots, shows list)    |
                  +-----------------------------------+
                                    |
                                    v
                  +-----------------------------------+
                  |           COLLECT_NAME            |
                  |  (Collects customer name if new   |
                  |   or confirms existing profile)   |
                  +-----------------------------------+
                                    |
                                    v
                  +-----------------------------------+
                  |           CONFIRMATION            |
                  |  (Shows summary, executes atomic  |
                  |   booking transaction on Confirm) |
                  +-----------------------------------+
                                    |
                                    v
                  +-----------------------------------+
                  |             COMPLETED             |
                  |  (Sends Confirmation Card & ID)   |
                  +-----------------------------------+
```

---

## 3. Webhook Handling & Meta Graph API Communication

### 3.1 Verification Handshake (`GET /api/v1/whatsapp/webhook`)
Meta sends a GET request during webhook registration:
* `hub.mode`: Must equal `"subscribe"`.
* `hub.verify_token`: Verified against the stored `webhook_verify_token`.
* `hub.challenge`: Echoed back as plain text with `200 OK`.

### 3.2 Incoming Message Dispatch (`POST /api/v1/whatsapp/webhook`)
1. **Signature Verification:** Compute HMAC-SHA256 of the raw body with `APP_SECRET` and compare with `X-Hub-Signature-256`.
2. **Payload Parsing:** Extract sender's phone number, recipient phone number ID (identifying the target `Salon`), message text or interactive ID.
3. **State Machine Execution:** Retrieve conversation state, execute handler, query the core booking engine, and formulate the response message.
4. **Outbound Dispatch:** POST interactive reply JSON to Meta Graph API endpoint:
   `https://graph.facebook.com/v20.0/{phone_number_id}/messages`

---

## 4. Message Formats & Interactive Components

### 4.1 Interactive List Message (Service Selection)
Used for presenting salon services with prices and durations:
```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "+919812345678",
  "type": "interactive",
  "interactive": {
    "type": "list",
    "header": { "type": "text", "text": "Glamour Studio" },
    "body": { "text": "Please choose a service to book:" },
    "footer": { "text": "Select from available catalog" },
    "action": {
      "button": "View Services",
      "sections": [
        {
          "title": "Hair Services",
          "rows": [
            { "id": "svc_01", "title": "Haircut & Styling", "description": "₹500 • 45 mins" },
            { "id": "svc_02", "title": "Hair Spa", "description": "₹1,200 • 60 mins" }
          ]
        }
      ]
    }
  }
}
```

### 4.2 Interactive Button Message (Staff & Date Selection)
Used for quick choice selections (e.g., Today, Tomorrow, Any Available):
```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "+919812345678",
  "type": "interactive",
  "interactive": {
    "type": "button",
    "body": { "text": "Select your preferred date for Haircut:" },
    "action": {
      "buttons": [
        { "type": "reply", "reply": { "id": "date_today", "title": "Today" } },
        { "type": "reply", "reply": { "id": "date_tomorrow", "title": "Tomorrow" } },
        { "type": "reply", "reply": { "id": "date_custom", "title": "Other Date" } }
      ]
    }
  }
}
```

---

## 5. Meta Template Messaging & 24-Hour Window Rules

1. **Within 24-Hour Customer Window:** Any interactive message or freeform session message can be sent in response to customer initiation.
2. **Outside 24-Hour Window (Automated Reminders):** Must use pre-approved Meta WhatsApp Message Templates:
   * **Reminder Template:** `appointment_reminder_v1` ("Hi {{1}}, your appointment for {{2}} at {{3}} is scheduled for tomorrow at {{4}}.")
   * **Cancellation Template:** `appointment_cancelled_v1`
   * **Rebooking Follow-up Template:** `rebook_reminder_v1`
