# Quality Assurance, Testing Strategy & Concurrency Verification

**Document Version:** 1.0.0  
**Test Frameworks:** Jest (Backend Unit/Integration), Supertest (API HTTP), Flutter Test (Widget & BLoC/State), Artillery/Autocannon (Concurrency Load)

---

## 1. Testing Pyramid & QA Philosophy

```
                  / \
                 / E2E \             -> 5% (Critical user booking journeys)
                /-------\
               / Concur- \           -> 10% (Race condition double-booking tests)
              /   rency   \
             /-------------\
            /  Integration  \        -> 25% (API routes, DB migrations, RBAC)
           /-----------------\
          /     Unit Tests    \      -> 60% (Availability math, state transitions)
         +---------------------+
```

---

## 2. Unit Testing Strategy

### 2.1 Availability Engine Test Matrix (`availability.service.spec.ts`)
The availability calculation engine must undergo exhaustive edge-case unit testing:

1. **Standard Working Hours:** Verify that a 9:00 - 17:00 salon schedule with 30-min slot intervals generates exact 30-min start timestamps.
2. **Breaks Subtraction:** Ensure slots overlapping with lunch breaks (e.g., 13:00 - 14:00) are cleanly removed.
3. **Staff Capability Filtering:** Verify that requesting service "Hair Spa" only evaluates staff members mapped to "Hair Spa".
4. **Different Staff Working Hours:** Verify Staff A (10:00 - 16:00) and Staff B (12:00 - 20:00) yield accurate combined slots for "Any Available".
5. **Full Day Holiday:** Verify that dates matching `Holiday` return `[]` empty slots.
6. **Custom Blocked Time:** Verify that blocking 15:00 - 16:00 removes both 15:00 and 15:30 slots for that specific staff member.
7. **Advance Booking Limits:** Verify that slots earlier than `now + 30 mins` are excluded for today's queries.
8. **Service Duration Overlap:** Verify that a 90-minute service starting at 10:00 prevents starting a subsequent appointment until 11:30.

### 2.2 Appointment State Machine Test Matrix (`appointment.service.spec.ts`)
* `PENDING` $\rightarrow$ `CONFIRMED` ✅
* `CONFIRMED` $\rightarrow$ `CHECKED_IN` ✅
* `CHECKED_IN` $\rightarrow$ `IN_SERVICE` $\rightarrow$ `COMPLETED` ✅
* `COMPLETED` $\rightarrow$ `CANCELLED` ❌ (Throws `BadRequestException`)
* `CANCELLED` $\rightarrow$ `IN_SERVICE` ❌ (Throws `BadRequestException`)

---

## 3. Concurrency & Double-Booking Stress Test

### 3.1 Concurrency Test Plan (`test/concurrency/double-booking.e2e-spec.ts`)
A dedicated integration test spawns 10 concurrent asynchronous HTTP requests attempting to book the identical staff member and time slot:

```typescript
describe('Concurrency: Double-Booking Prevention', () => {
  it('should allow exactly ONE booking and reject all concurrent duplicate requests with 409', async () => {
    const slotPayload = {
      serviceId: testService.id,
      staffId: testStaff.id,
      date: '2026-09-01',
      startTime: '14:00',
    };

    // Dispatch 10 parallel booking requests simultaneously
    const requests = Array.from({ length: 10 }).map((_, i) =>
      request(app.getHttpServer())
        .post(`/api/v1/booking/${testSalon.slug}/appointments`)
        .send({
          ...slotPayload,
          customerName: `Concurrent Customer ${i}`,
          customerPhone: `+91980000000${i}`,
        })
    );

    const responses = await Promise.all(requests);

    const successfulBookings = responses.filter((r) => r.status === 201);
    const conflictResponses = responses.filter((r) => r.status === 409);

    // EXACTLY 1 request must succeed
    expect(successfulBookings.length).toBe(1);
    // EXACTLY 9 requests must be cleanly rejected with 409 Conflict
    expect(conflictResponses.length).toBe(9);

    // Verify DB count
    const countInDb = await prisma.appointment.count({
      where: {
        staffId: testStaff.id,
        date: new Date('2026-09-01'),
        startTime: new Date('2026-09-01T14:00:00.000Z'),
      },
    });
    expect(countInDb).toBe(1);
  });
});
```

---

## 4. Multi-Tenant Cross-Contamination Security Tests

### 4.1 Security Test Scenarios (`test/security/tenant-isolation.e2e-spec.ts`)
1. **Direct Object Reference (IDOR) on Appointments:**
   * User A (Salon A admin) attempts `GET /api/v1/appointments/:salonBAppointmentId`.
   * Expect: `404 Not Found` or `403 Forbidden`.
2. **Cross-Tenant Staff Mutation:**
   * User A attempts `PUT /api/v1/staff/:salonBStaffId/working-hours`.
   * Expect: `404 Not Found`.
3. **Cross-Tenant Customer Inspection:**
   * User A attempts `GET /api/v1/customers/:salonBCustomerId`.
   * Expect: `404 Not Found`.
4. **Client Supplied Salon ID Injection:**
   * User A supplies `{ "salonId": "salon_b_id" }` inside body payload.
   * Expect: System ignores body property and scopes exclusively to User A's token salon ID.

---

## 5. Automated CI/CD Pipeline Gates

Every pull request must pass the following automated gates:
1. `npm run lint` & `flutter analyze` — Static code analysis.
2. `npm run test` — Unit test suite (minimum 85% code coverage on `availability` and `appointments`).
3. `npm run test:e2e` — Integration and tenant security test suite against an ephemeral PostgreSQL Docker instance.
4. `npm run test:concurrency` — Concurrency race-condition stress validation.
