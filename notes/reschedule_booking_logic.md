# Reschedule Booking Logic (Simple & Complete Guide)

This document explains the full reschedule flow in simple language: what happens, when it happens, and what happens if a customer accepts, declines, or does not respond.

---

## 1. What is Rescheduling? (The Core Rule)

Whenever any change or conflict happens in the salon:
* An Admin wants to change a customer's time or stylist.
* A Stylist applies for leave.
* The Salon closes for an emergency or holiday.
* A Stylist's shift hours change.

**The system does not silently swap stylists or use separate tables.**  
Instead, the affected booking is passed to the **Reschedule Engine**:
* It can change **time only** (keeps same stylist).
* It can change **stylist only** (keeps same time).
* It can change **both time and stylist**.
* It strictly stays within **3 days** (Today, Tomorrow, Day After Tomorrow).

---

## 2. What Happens When a Reschedule is Triggered?

As soon as a reschedule is proposed:

1. **Old Slot is FREED immediately:**  
   The customer is no longer coming at their old time, so that old slot is freed up for other walk-ins or web clients.

2. **Proposed New Slot is LOCKED:**  
   The new proposed date and time is temporarily reserved/locked for this customer so nobody else can take it.

3. **Status changes to `PENDING_RESCHEDULE`:**  
   The booking is now officially waiting for the customer to respond.

4. **WhatsApp Proposal is Sent to Customer:**  
   The customer receives an interactive WhatsApp message:  
   *"We have proposed a new slot on [Date] at [Time] with [Stylist]. Please tap below:"*  
   * **[Accept]** button  
   * **[Decline]** button  

---

## 3. What Happens in All 3 Customer Response Scenarios

### Scenario 1: Customer Taps [ACCEPT]
* **What happens:**  
  * The booking status immediately updates to `CONFIRMED`.  
  * The proposed date, time, and stylist become the official booking.  
  * The temporary lock is converted into a confirmed appointment.  
* **WhatsApp message:** Customer receives a clean confirmation message with salon address and appointment details.

---

### Scenario 2: Customer Taps [DECLINE]
* **What happens:**  
  * The customer says "No, this proposed time doesn't work for me."  
  * The booking status immediately updates to `CANCELLED` (Reason: `DECLINED_SALON_RESCHEDULE`).  
  * **Zero Penalty:** Customer is NOT penalized or blamed because the salon requested the move.  
  * **Slot Released:** The proposed slot is unlocked immediately so someone else can book it.  
* **WhatsApp message:** Customer is notified that the booking was cancelled with no penalty.

---

### Scenario 3: Customer DOES NOT RESPOND (The Full Auto-Cancel Logic)

What happens if the customer never checks WhatsApp or ignores the message?

#### A. How long does the system wait?
* The system waits and keeps the proposed slot locked until **60 minutes before the proposed slot starts** (`T - 60 minutes`).
* For example:  
  * If the proposed slot is tomorrow at **3:00 PM**,  
  * The cutoff deadline is tomorrow at **2:00 PM** (60 minutes before).

#### B. What happens at the 60-Minute Cutoff?
* A background system worker runs automatically every 60 seconds.
* At exactly 60 minutes before the proposed time, if status is still `PENDING_RESCHEDULE`:
  1. **The booking is automatically CANCELLED by the system.**
  2. **Zero Customer Penalty:** Recorded with 0 penalty strikes (`fault: SALON`).
  3. **The proposed slot is immediately FREED UP:** This ensures the stylist's chair does not sit empty and the salon can give the slot to a walk-in client.
  4. **WhatsApp Notice Sent to Customer:**  
     *"⚠️ Reschedule Offer Expired: Your proposed reschedule has expired because we did not receive a response before the cutoff. To ensure staff availability, the appointment was cancelled. No penalty was applied."*

#### C. What if the customer taps [Accept] AFTER the cutoff?
* If the customer opens WhatsApp later and tries to tap `Accept`:
* The system detects the proposal has already expired and replies:  
  *"⚠️ Offer No Longer Available: This reschedule proposal has expired as the response cutoff passed and the slot was released. Your booking was cancelled with zero penalty."*

---

## 4. Summary Table

| Customer Action | What Status Becomes | Does Customer Get Penalty? | What Happens to Proposed Slot? |
| :--- | :--- | :---: | :--- |
| **Taps [Accept]** | `CONFIRMED` | No | Becomes their permanent booking |
| **Taps [Decline]** | `CANCELLED` | No (0 strikes) | Freed immediately for other clients |
| **Does Not Respond** | Auto-`CANCELLED` at T - 60m | No (0 strikes) | Freed at 60 mins before start time |
| **Taps [Accept] late (after cutoff)** | Stays `CANCELLED` | No (0 strikes) | Slot already given away; bot informs client |
