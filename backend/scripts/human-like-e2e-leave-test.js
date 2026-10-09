const { PrismaClient, AbsenceStatus, AppointmentStatus, LeaveType, LeavePortion } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE_URL = 'http://localhost:3000/api/v1';
const SALON_SLUG = 'trilok-salon';
const SALON_ID = '50ac2818-b36f-4261-abaa-07030d0ab12d';

// Stylists
const STYLIST_VICRAM = {
  id: 'd8f125fd-bedc-4b4f-b4c7-12deb2506686',
  name: 'Vicram',
};
const STYLIST_RAHUL = {
  id: 'fcaa508a-1070-41be-81c5-d68dc66b6f8d',
  name: 'Rahul Sharma',
};

// Customers
const CUSTOMER_AUDIT = {
  id: '0481e84e-e5a2-4e9c-9f88-cbe6b636966c',
  name: 'Audit Client',
  phone: '919988776655',
};
const CUSTOMER_RAHUL = {
  id: 'c9ffe425-04fd-4b4d-aa75-6c3ea6837d16',
  name: 'Test Rahul',
  phone: '919999000099',
};

// Services
const SERVICE_HAIR = {
  id: '3b2618a7-3a7d-4283-9410-34f66a78d5e7',
  name: 'Hair',
  durationMinutes: 30,
  price: 100,
};

let authToken = '';

async function loginAdmin() {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: '7999817743', password: 'Test@1234' }),
  });
  const data = await res.json();
  authToken = data.data?.accessToken || data.accessToken;
  if (!authToken) {
    throw new Error('Admin authentication failed: ' + JSON.stringify(data));
  }
}

async function cleanupDate(dateStr) {
  const dObj = new Date(`${dateStr}T00:00:00.000Z`);
  const absences = await prisma.stylistAbsence.findMany({
    where: {
      salonId: SALON_ID,
      OR: [
        { startDate: dObj },
        { endDate: dObj },
        { absenceDate: dObj },
      ],
    },
  });
  for (const ab of absences) {
    await prisma.bookingReassignment.deleteMany({ where: { absenceId: ab.id } });
    await prisma.stylistAbsence.delete({ where: { id: ab.id } });
  }
  await prisma.appointment.deleteMany({
    where: {
      salonId: SALON_ID,
      appointmentDate: dObj,
      appointmentNumber: { startsWith: 'E2E-HUMAN-' },
    },
  });
}

async function getCustomerAvailability(dateStr, staffId) {
  let url = `${BASE_URL}/booking/${SALON_SLUG}/availability?serviceId=${SERVICE_HAIR.id}&date=${dateStr}`;
  if (staffId) url += `&staffId=${staffId}`;
  const res = await fetch(url);
  const json = await res.json();
  return {
    status: res.status,
    body: json.data || json,
  };
}

async function getAdminStaffRoster(dateStr) {
  const res = await fetch(`${BASE_URL}/staff?date=${dateStr}`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  const json = await res.json();
  return {
    status: res.status,
    data: json.data || json,
  };
}

const testResults = [];

function recordResult(testId, name, passed, details) {
  testResults.push({ testId, name, passed, details });
  const icon = passed ? '✅ PASS' : '❌ FAIL';
  console.log(`[${icon}] ${testId}: ${name}`);
  if (details) {
    console.log(`   Details: ${details}`);
  }
}

async function runTestSuite() {
  console.log('================================================================================');
  console.log('🧪 COMPREHENSIVE HUMAN-LIKE END-TO-END LEAVE SYSTEM VERIFICATION');
  console.log('Testing Admin Operations, Public Customer Availability, Multi-User & Multi-Stylist');
  console.log('================================================================================\n');

  await loginAdmin();
  console.log('🔑 Authenticated as Salon Admin (Trilok Salon)\n');

  // Clean future test dates within 30-day window
  const D_CLEAN = '2026-10-16';
  const D_REASSIGN = '2026-10-17';
  const D_CAPACITY = '2026-10-18';
  const D_PARTIAL = '2026-10-19';
  const D_EXTEND = '2026-10-20';
  const D_EXTEND_END = '2026-10-21';

  // Pre-cleanup all test dates
  for (const d of [D_CLEAN, D_REASSIGN, D_CAPACITY, D_PARTIAL, D_EXTEND, D_EXTEND_END]) {
    await cleanupDate(d);
  }

  // ---------------------------------------------------------------------------
  // SCENARIO 1: BASELINE CHECK - Public Customer Availability & Admin Roster
  // ---------------------------------------------------------------------------
  console.log('▶️ SCENARIO 1: Baseline Check Before Any Leaves Applied');
  const baselineAvail = await getCustomerAvailability(D_CLEAN, STYLIST_VICRAM.id);
  const baselineSlotsCount = baselineAvail.body.availableSlots?.length || 0;
  console.log(`   Customer query for Vicram on ${D_CLEAN}: status=${baselineAvail.body.status}, slots=${baselineSlotsCount}`);

  const baselineRoster = await getAdminStaffRoster(D_CLEAN);
  const vicramBaseline = baselineRoster.data.find(s => s.id === STYLIST_VICRAM.id);
  console.log(`   Admin roster for Vicram on ${D_CLEAN}: operationalStatus=${vicramBaseline?.operationalStatus}, statusLabel=${vicramBaseline?.statusLabel}`);

  const pass1 = baselineSlotsCount > 0 && vicramBaseline?.operationalStatus === 'AVAILABLE';
  recordResult(
    'TC-01',
    'Baseline: Customer sees slots and Admin sees stylist available',
    pass1,
    `Slots visible: ${baselineSlotsCount}, Stylist initial status: ${vicramBaseline?.operationalStatus}`
  );

  // ---------------------------------------------------------------------------
  // SCENARIO 2: LEAVE PREVIEW API (Human checking impact prior to submission)
  // ---------------------------------------------------------------------------
  console.log('\n▶️ SCENARIO 2: Leave Impact Preview API Check');
  const previewRes = await fetch(
    `${BASE_URL}/staff/${STYLIST_VICRAM.id}/leaves/preview?startDate=${D_CLEAN}&endDate=${D_CLEAN}&leavePortion=FULL_DAY`,
    { headers: { Authorization: `Bearer ${authToken}` } }
  );
  const previewData = (await previewRes.json()).data;
  console.log(`   Preview response: totalAffected=${previewData?.totalAffected}, reassignable=${previewData?.reassignable}, unresolvable=${previewData?.unresolvable}`);

  const pass2 = previewRes.status === 200 && previewData?.totalAffected === 0 && previewData?.reassignable === 0;
  recordResult(
    'TC-02',
    'Admin Preview API evaluates clean schedule before applying leave',
    pass2,
    `HTTP ${previewRes.status}, Total Affected: ${previewData?.totalAffected}`
  );

  // ---------------------------------------------------------------------------
  // SCENARIO 3: APPLY CLEAN LEAVE & CHECK BOTH ADMIN & USER SIDES
  // ---------------------------------------------------------------------------
  console.log('\n▶️ SCENARIO 3: Apply Clean Leave (Vicram) -> Check Admin Status & Customer Blocking');
  const applyRes1 = await fetch(`${BASE_URL}/staff/${STYLIST_VICRAM.id}/leaves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({
      startDate: D_CLEAN,
      endDate: D_CLEAN,
      leaveType: 'CASUAL_LEAVE',
      leavePortion: 'FULL_DAY',
      reason: 'Personal Outing',
    }),
  });
  const applyData1 = (await applyRes1.json()).data;
  const leaveId1 = applyData1?.absence?.id;
  console.log(`   Apply Leave HTTP: ${applyRes1.status}`);
  console.log(`   Response statusKey: "${applyData1?.absence?.statusKey}", statusTitle: "${applyData1?.absence?.statusTitle}"`);

  // Check Admin Roster Status
  const rosterAfterLeave = await getAdminStaffRoster(D_CLEAN);
  const vicramOnLeave = rosterAfterLeave.data.find(s => s.id === STYLIST_VICRAM.id);
  const rahulStillAvailable = rosterAfterLeave.data.find(s => s.id === STYLIST_RAHUL.id);
  console.log(`   Admin Roster Vicram: operationalStatus="${vicramOnLeave?.operationalStatus}", label="${vicramOnLeave?.statusLabel}"`);
  console.log(`   Admin Roster Rahul:  operationalStatus="${rahulStillAvailable?.operationalStatus}", label="${rahulStillAvailable?.statusLabel}"`);

  // Check Customer Availability for Vicram
  const customerVicramLeave = await getCustomerAvailability(D_CLEAN, STYLIST_VICRAM.id);
  const vicramSlotsOnLeave = customerVicramLeave.body.availableSlots?.length || 0;
  console.log(`   Customer Availability Vicram: slots=${vicramSlotsOnLeave}, status="${customerVicramLeave.body.status}"`);

  // Check Customer Availability for Rahul Sharma (peer stylist should still be available)
  const customerRahulAvail = await getCustomerAvailability(D_CLEAN, STYLIST_RAHUL.id);
  const rahulSlots = customerRahulAvail.body.availableSlots?.length || 0;
  console.log(`   Customer Availability Rahul:  slots=${rahulSlots}, status="${customerRahulAvail.body.status}"`);

  const pass3 =
    applyRes1.status === 201 &&
    applyData1?.absence?.statusKey === 'ON_LEAVE' &&
    applyData1?.absence?.statusTitle === '🟢 On Leave' &&
    vicramOnLeave?.operationalStatus === 'ON_LEAVE' &&
    vicramSlotsOnLeave === 0 &&
    rahulSlots > 0;
  recordResult(
    'TC-03',
    'Apply Leave: Stylist shows ON_LEAVE in Roster, Customer slots for stylist blocked, Peer slots open',
    pass3,
    `Admin status: ${vicramOnLeave?.operationalStatus}, Customer Vicram slots: ${vicramSlotsOnLeave}, Peer Rahul slots: ${rahulSlots}`
  );

  // ---------------------------------------------------------------------------
  // SCENARIO 4: MULTI-USER, MULTI-STYLIST BOOKINGS AUTO-REASSIGNMENT
  // ---------------------------------------------------------------------------
  console.log('\n▶️ SCENARIO 4: Multi-User Bookings Overlap & Peer Stylist Auto-Reassignment');
  // Create 2 confirmed appointments for Vicram with two different customers
  // 14:00 IST (08:30 UTC) for Audit Client
  const appt1 = await prisma.appointment.create({
    data: {
      appointmentNumber: 'E2E-HUMAN-001',
      salonId: SALON_ID,
      salonUserId: CUSTOMER_AUDIT.id,
      stylistId: STYLIST_VICRAM.id,
      serviceId: SERVICE_HAIR.id,
      serviceNameSnapshot: 'Hair',
      durationMinutes: 30,
      price: 100,
      startAt: new Date(`${D_REASSIGN}T08:30:00.000Z`), // 14:00 IST
      endAt: new Date(`${D_REASSIGN}T09:00:00.000Z`),   // 14:30 IST
      appointmentDate: new Date(`${D_REASSIGN}T00:00:00.000Z`),
      status: AppointmentStatus.CONFIRMED,
      source: 'WHATSAPP',
    },
  });
  console.log(`   Created Appointment #1 (${appt1.appointmentNumber}) for "${CUSTOMER_AUDIT.name}" with Vicram at 14:00 IST`);

  // 15:30 IST (10:00 UTC) for Test Rahul
  const appt2 = await prisma.appointment.create({
    data: {
      appointmentNumber: 'E2E-HUMAN-002',
      salonId: SALON_ID,
      salonUserId: CUSTOMER_RAHUL.id,
      stylistId: STYLIST_VICRAM.id,
      serviceId: SERVICE_HAIR.id,
      serviceNameSnapshot: 'Hair',
      durationMinutes: 30,
      price: 100,
      startAt: new Date(`${D_REASSIGN}T10:00:00.000Z`), // 15:30 IST
      endAt: new Date(`${D_REASSIGN}T10:30:00.000Z`),   // 16:00 IST
      appointmentDate: new Date(`${D_REASSIGN}T00:00:00.000Z`),
      status: AppointmentStatus.CONFIRMED,
      source: 'WHATSAPP',
    },
  });
  console.log(`   Created Appointment #2 (${appt2.appointmentNumber}) for "${CUSTOMER_RAHUL.name}" with Vicram at 15:30 IST`);

  // Human checks preview first
  const previewMulti = await fetch(
    `${BASE_URL}/staff/${STYLIST_VICRAM.id}/leaves/preview?startDate=${D_REASSIGN}&endDate=${D_REASSIGN}&leavePortion=FULL_DAY`,
    { headers: { Authorization: `Bearer ${authToken}` } }
  );
  const previewMultiData = (await previewMulti.json()).data;
  console.log(`   Admin Preview Before Leave: TotalAffected=${previewMultiData?.totalAffected}, Reassignable=${previewMultiData?.reassignable}, Unresolvable=${previewMultiData?.unresolvable}`);

  // Apply Leave for Vicram
  const applyRes2 = await fetch(`${BASE_URL}/staff/${STYLIST_VICRAM.id}/leaves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({
      startDate: D_REASSIGN,
      endDate: D_REASSIGN,
      leaveType: 'SICK_LEAVE',
      leavePortion: 'FULL_DAY',
      reason: 'Sudden Fever',
    }),
  });
  const applyData2 = (await applyRes2.json()).data;
  console.log(`   Apply Leave Response: affectedCount=${applyData2?.absence?.affectedBookingsCount}, reassignedCount=${applyData2?.absence?.reassignedCount}, unresolvableCount=${applyData2?.absence?.unresolvableCount}`);

  // Verify appointments in database
  const refreshedAppt1 = await prisma.appointment.findUnique({ where: { id: appt1.id } });
  const refreshedAppt2 = await prisma.appointment.findUnique({ where: { id: appt2.id } });
  const reassignLogs = await prisma.bookingReassignment.findMany({
    where: { absenceId: applyData2?.absence?.id },
  });

  console.log(`   Appt 1 Moved to Stylist: ${refreshedAppt1?.stylistId} (Rahul ID: ${STYLIST_RAHUL.id})`);
  console.log(`   Appt 2 Moved to Stylist: ${refreshedAppt2?.stylistId} (Rahul ID: ${STYLIST_RAHUL.id})`);
  console.log(`   Reassignment logs stored: count=${reassignLogs.length}, outcomes=[${reassignLogs.map(r => r.outcome).join(', ')}]`);

  const pass4 =
    applyData2?.absence?.affectedBookingsCount === 2 &&
    applyData2?.absence?.reassignedCount === 2 &&
    applyData2?.absence?.unresolvableCount === 0 &&
    refreshedAppt1?.stylistId === STYLIST_RAHUL.id &&
    refreshedAppt2?.stylistId === STYLIST_RAHUL.id &&
    reassignLogs.length === 2 &&
    reassignLogs.every(r => r.outcome === 'AUTO_ASSIGNED' && r.newStylistId === STYLIST_RAHUL.id);
  recordResult(
    'TC-04',
    'Multi-User Appointments: Auto-reassigned both bookings to peer stylist Rahul Sharma',
    pass4,
    `Affected: 2, Reassigned: 2, Logged outcomes: ${reassignLogs.map(r => r.outcome).join(', ')}`
  );

  // ---------------------------------------------------------------------------
  // SCENARIO 5: CONCURRENT LEAVES / ZERO CAPACITY (UNRESOLVABLE CONFLICT)
  // ---------------------------------------------------------------------------
  console.log('\n▶️ SCENARIO 5: Zero Peer Capacity / Concurrent Leave Conflict');
  // First, Rahul Sharma is already on leave on D_CAPACITY
  const applyRahulLeave = await fetch(`${BASE_URL}/staff/${STYLIST_RAHUL.id}/leaves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({
      startDate: D_CAPACITY,
      endDate: D_CAPACITY,
      leaveType: 'CASUAL_LEAVE',
      leavePortion: 'FULL_DAY',
      reason: 'Rahul Scheduled Off',
    }),
  });
  console.log(`   Pre-applied Leave for Rahul Sharma on ${D_CAPACITY}: HTTP ${applyRahulLeave.status}`);

  // Create confirmed appointment for Vicram on D_CAPACITY at 12:00 IST (06:30 UTC)
  const appt3 = await prisma.appointment.create({
    data: {
      appointmentNumber: 'E2E-HUMAN-003',
      salonId: SALON_ID,
      salonUserId: CUSTOMER_AUDIT.id,
      stylistId: STYLIST_VICRAM.id,
      serviceId: SERVICE_HAIR.id,
      serviceNameSnapshot: 'Hair',
      durationMinutes: 30,
      price: 100,
      startAt: new Date(`${D_CAPACITY}T06:30:00.000Z`), // 12:00 IST
      endAt: new Date(`${D_CAPACITY}T07:00:00.000Z`),   // 12:30 IST
      appointmentDate: new Date(`${D_CAPACITY}T00:00:00.000Z`),
      status: AppointmentStatus.CONFIRMED,
      source: 'WHATSAPP',
    },
  });
  console.log(`   Created Appointment #${appt3.appointmentNumber} for Audit Client with Vicram`);

  // Now Vicram applies leave on the same day D_CAPACITY
  const applyVicramConflict = await fetch(`${BASE_URL}/staff/${STYLIST_VICRAM.id}/leaves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({
      startDate: D_CAPACITY,
      endDate: D_CAPACITY,
      leaveType: 'EMERGENCY_LEAVE',
      leavePortion: 'FULL_DAY',
      reason: 'Vicram Family Emergency',
    }),
  });
  const dataVicramConflict = (await applyVicramConflict.json()).data;
  console.log(`   Vicram Conflict Leave Result: Affected=${dataVicramConflict?.absence?.affectedBookingsCount}, Reassigned=${dataVicramConflict?.absence?.reassignedCount}, Unresolved=${dataVicramConflict?.absence?.unresolvableCount}`);

  const reassignConflictLog = await prisma.bookingReassignment.findFirst({
    where: { appointmentId: appt3.id },
  });
  console.log(`   Reassignment outcome recorded: "${reassignConflictLog?.outcome}"`);

  const pass5 =
    dataVicramConflict?.absence?.affectedBookingsCount === 1 &&
    dataVicramConflict?.absence?.reassignedCount === 0 &&
    dataVicramConflict?.absence?.unresolvableCount === 1 &&
    reassignConflictLog?.outcome === 'NO_REPLACEMENT';
  recordResult(
    'TC-05',
    'Zero Peer Capacity: When replacement stylist is also on leave, record NO_REPLACEMENT & unresolvableCount: 1',
    pass5,
    `Affected: 1, Reassigned: 0, Unresolved: 1, Outcome: ${reassignConflictLog?.outcome}`
  );

  // ---------------------------------------------------------------------------
  // SCENARIO 6: PARTIAL DAY INTERVAL (FIRST_HALF VS SECOND_HALF)
  // ---------------------------------------------------------------------------
  console.log('\n▶️ SCENARIO 6: Partial Day Leave Boundaries (Morning Booking vs Afternoon Leave)');
  // Create morning appointment for Vicram at 11:30 AM IST (06:00 UTC)
  const appt4 = await prisma.appointment.create({
    data: {
      appointmentNumber: 'E2E-HUMAN-004',
      salonId: SALON_ID,
      salonUserId: CUSTOMER_AUDIT.id,
      stylistId: STYLIST_VICRAM.id,
      serviceId: SERVICE_HAIR.id,
      serviceNameSnapshot: 'Hair',
      durationMinutes: 30,
      price: 100,
      startAt: new Date(`${D_PARTIAL}T06:00:00.000Z`), // 11:30 AM IST
      endAt: new Date(`${D_PARTIAL}T06:30:00.000Z`),   // 12:00 PM IST
      appointmentDate: new Date(`${D_PARTIAL}T00:00:00.000Z`),
      status: AppointmentStatus.CONFIRMED,
      source: 'WHATSAPP',
    },
  });
  console.log(`   Created morning booking at 11:30 AM IST for Vicram`);

  // Vicram applies SECOND_HALF leave (afternoon: 15:00 - 19:00 IST)
  const applyPartial = await fetch(`${BASE_URL}/staff/${STYLIST_VICRAM.id}/leaves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({
      startDate: D_PARTIAL,
      endDate: D_PARTIAL,
      leaveType: 'CASUAL_LEAVE',
      leavePortion: 'SECOND_HALF',
      reason: 'Doctor Appointment in Afternoon',
    }),
  });
  const dataPartial = (await applyPartial.json()).data;
  console.log(`   Second Half Leave: affectedBookingsCount=${dataPartial?.absence?.affectedBookingsCount}`);

  const pass6 = applyPartial.status === 201 && dataPartial?.absence?.affectedBookingsCount === 0;
  recordResult(
    'TC-06',
    'Partial Day Boundaries: Morning appointment untouched by SECOND_HALF afternoon leave',
    pass6,
    `Affected bookings count: ${dataPartial?.absence?.affectedBookingsCount}`
  );

  // ---------------------------------------------------------------------------
  // SCENARIO 7: EXTEND LEAVE API (PATCH /staff/:id/leaves/:leaveId/extend)
  // ---------------------------------------------------------------------------
  console.log('\n▶️ SCENARIO 7: Extend Leave Flow');
  // First apply 1-day leave on D_EXTEND
  const applyExtendBase = await fetch(`${BASE_URL}/staff/${STYLIST_VICRAM.id}/leaves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({
      startDate: D_EXTEND,
      endDate: D_EXTEND,
      leaveType: 'SICK_LEAVE',
      leavePortion: 'FULL_DAY',
      reason: '1-day Sick Leave',
    }),
  });
  const baseExtendData = (await applyExtendBase.json()).data;
  const leaveToExtendId = baseExtendData?.absence?.id;
  console.log(`   Created initial 1-day leave: ID=${leaveToExtendId} on ${D_EXTEND}`);

  // Now call Extend API with valid ExtendLeaveDto { newEndDate }
  const extendRes = await fetch(`${BASE_URL}/staff/${STYLIST_VICRAM.id}/leaves/${leaveToExtendId}/extend`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({
      newEndDate: D_EXTEND_END,
    }),
  });
  const extendData = (await extendRes.json()).data;
  console.log(`   Extend API status: ${extendRes.status}, newEndDate in response: ${extendData?.absence?.endDate}, statusKey: ${extendData?.absence?.statusKey}`);

  const pass7 =
    extendRes.status === 200 &&
    extendData?.absence?.statusKey === 'ON_LEAVE' &&
    extendData?.absence?.endDate?.startsWith(D_EXTEND_END);
  recordResult(
    'TC-07',
    'Extend Leave: Extends leave date to new future date and audits operation',
    pass7,
    `HTTP ${extendRes.status}, newEndDate: ${extendData?.absence?.endDate}, statusKey: ${extendData?.absence?.statusKey}`
  );

  // ---------------------------------------------------------------------------
  // SCENARIO 8: OVERLAPPING LEAVE VALIDATION (Prevent duplicate leaves)
  // ---------------------------------------------------------------------------
  console.log('\n▶️ SCENARIO 8: Validation Guard - Overlapping Leave Prevention');
  const overlapRes = await fetch(`${BASE_URL}/staff/${STYLIST_VICRAM.id}/leaves`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
    body: JSON.stringify({
      startDate: D_CLEAN,
      endDate: D_CLEAN,
      leaveType: 'CASUAL_LEAVE',
      leavePortion: 'FULL_DAY',
      reason: 'Duplicate Leave Attempt',
    }),
  });
  const overlapErr = await overlapRes.json();
  console.log(`   Overlap attempt: HTTP ${overlapRes.status}, message: "${overlapErr?.message}"`);

  const pass8 = overlapRes.status === 400 && overlapErr?.message?.includes('already has an active leave');
  recordResult(
    'TC-08',
    'Validation Guard: Rejects overlapping leave application with HTTP 400',
    pass8,
    `Status: ${overlapRes.status}, Error: ${overlapErr?.message}`
  );

  // ---------------------------------------------------------------------------
  // SCENARIO 9: DATABASE STATE MANIPULATION - PAST LEAVE CANCEL GUARD
  // ---------------------------------------------------------------------------
  console.log('\n▶️ SCENARIO 9: Manual DB State Modification - Past Date Cancel Guard');
  // Create an active leave and artificially backdate it in the database to past date '2026-10-01'
  const pastLeaveRow = await prisma.stylistAbsence.create({
    data: {
      salonId: SALON_ID,
      stylistId: STYLIST_VICRAM.id,
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      endDate: new Date('2026-10-02T00:00:00.000Z'),
      absenceDate: new Date('2026-10-01T00:00:00.000Z'),
      leaveType: LeaveType.CASUAL_LEAVE,
      leavePortion: LeavePortion.FULL_DAY,
      status: AbsenceStatus.ACTIVE,
      reason: 'Past Leave Test',
    },
  });
  console.log(`   Directly created leave in DB backdated to 2026-10-01 (ID: ${pastLeaveRow.id})`);

  // Now call Cancel Leave API on this past leave
  const cancelPastRes = await fetch(`${BASE_URL}/staff/${STYLIST_VICRAM.id}/leaves/${pastLeaveRow.id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${authToken}` },
  });
  const cancelPastErr = await cancelPastRes.json();
  console.log(`   Cancel past leave attempt: HTTP ${cancelPastRes.status}, message: "${cancelPastErr?.message}"`);

  // Verify the DB record is STILL ACTIVE (cancellation rejected)
  const pastRowCheck = await prisma.stylistAbsence.findUnique({ where: { id: pastLeaveRow.id } });
  console.log(`   Database status remains: "${pastRowCheck?.status}"`);

  // Clean up the backdated test record
  await prisma.stylistAbsence.delete({ where: { id: pastLeaveRow.id } });

  const pass9 =
    cancelPastRes.status === 400 &&
    cancelPastErr?.message?.includes('Cannot cancel a leave that has already passed') &&
    pastRowCheck?.status === AbsenceStatus.ACTIVE;
  recordResult(
    'TC-09',
    'Past-Date Cancel Guard: API rejects cancellation of expired past leaves (HTTP 400)',
    pass9,
    `Status: ${cancelPastRes.status}, Message: "${cancelPastErr?.message}", DB Status: ${pastRowCheck?.status}`
  );

  // ---------------------------------------------------------------------------
  // SCENARIO 10: CANCEL LEAVE SUCCESS & USER-SIDE SLOT RESTORATION
  // ---------------------------------------------------------------------------
  console.log('\n▶️ SCENARIO 10: Cancel Active Leave -> Verify "❌ Cancelled" Status & Public Slots Restored');
  // Recall leaveId1 was created on D_CLEAN for Vicram
  const cancelRes = await fetch(`${BASE_URL}/staff/${STYLIST_VICRAM.id}/leaves/${leaveId1}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${authToken}` },
  });
  const cancelData = (await cancelRes.json()).data;
  console.log(`   Cancel API status: ${cancelRes.status}`);
  console.log(`   Response statusKey: "${cancelData?.statusKey}", statusTitle: "${cancelData?.statusTitle}"`);

  // Verify DB status
  const dbLeave1 = await prisma.stylistAbsence.findUnique({ where: { id: leaveId1 } });
  console.log(`   Prisma DB record status: "${dbLeave1?.status}"`);

  // Verify Admin Roster Status returned to AVAILABLE
  const rosterAfterCancel = await getAdminStaffRoster(D_CLEAN);
  const vicramAfterCancel = rosterAfterCancel.data.find(s => s.id === STYLIST_VICRAM.id);
  console.log(`   Admin Roster Vicram: operationalStatus="${vicramAfterCancel?.operationalStatus}", label="${vicramAfterCancel?.statusLabel}"`);

  // Verify Customer Availability Restored (Slots are unblocked and visible again!)
  const customerAvailRestored = await getCustomerAvailability(D_CLEAN, STYLIST_VICRAM.id);
  const restoredSlotsCount = customerAvailRestored.body.availableSlots?.length || 0;
  console.log(`   Customer Availability Vicram: slots=${restoredSlotsCount}, status="${customerAvailRestored.body.status}"`);

  // Verify Double Cancel Guard: Attempting to cancel an already cancelled leave
  const doubleCancelRes = await fetch(`${BASE_URL}/staff/${STYLIST_VICRAM.id}/leaves/${leaveId1}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${authToken}` },
  });
  const doubleCancelErr = await doubleCancelRes.json();
  console.log(`   Double Cancel attempt: HTTP ${doubleCancelRes.status}, message: "${doubleCancelErr?.message}"`);

  const pass10 =
    cancelRes.status === 200 &&
    cancelData?.statusKey === 'CANCELLED' &&
    cancelData?.statusTitle === '❌ Cancelled' &&
    dbLeave1?.status === AbsenceStatus.CANCELLED &&
    vicramAfterCancel?.operationalStatus === 'AVAILABLE' &&
    restoredSlotsCount > 0 &&
    doubleCancelRes.status === 400 &&
    doubleCancelErr?.message?.includes('already been cancelled');

  recordResult(
    'TC-10',
    'Cancel Leave & Customer Slot Restoration: "❌ Cancelled", DB status updated, Customer slots unblocked, Double-cancel blocked',
    pass10,
    `Cancel status: ${cancelData?.statusTitle}, DB: ${dbLeave1?.status}, Restored Slots: ${restoredSlotsCount}, Double cancel: HTTP ${doubleCancelRes.status}`
  );

  // ---------------------------------------------------------------------------
  // SCENARIO 11: GET LEAVE HISTORY API WITH AUDIT FIELDS
  // ---------------------------------------------------------------------------
  console.log('\n▶️ SCENARIO 11: Get Leave History API');
  const historyRes = await fetch(`${BASE_URL}/staff/${STYLIST_VICRAM.id}/leaves`, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  const historyData = (await historyRes.json()).data;
  console.log(`   History items count: ${historyData?.length}`);
  const sample = historyData?.[0];
  console.log(`   Sample history item: ID=${sample?.id}, statusKey="${sample?.statusKey}", statusTitle="${sample?.statusTitle}", leaveType="${sample?.leaveType}"`);

  const pass11 = historyRes.status === 200 && Array.isArray(historyData) && historyData.length > 0 && sample?.statusKey && sample?.statusTitle;
  recordResult(
    'TC-11',
    'Get Leave History API: Formatted with architecture enum keys and human status titles',
    pass11,
    `Items: ${historyData?.length}, sample: ${sample?.statusTitle}`
  );

  // ---------------------------------------------------------------------------
  // CLEANUP
  // ---------------------------------------------------------------------------
  console.log('\n🧹 Performing post-test cleanup of test data...');
  for (const d of [D_CLEAN, D_REASSIGN, D_CAPACITY, D_PARTIAL, D_EXTEND, D_EXTEND_END]) {
    await cleanupDate(d);
  }
  console.log('   All temporary test appointments and leaves cleaned up.');

  // ---------------------------------------------------------------------------
  // SUMMARY
  // ---------------------------------------------------------------------------
  console.log('\n================================================================================');
  console.log('📊 FINAL TEST EXECUTION MATRIX');
  console.log('================================================================================');
  let allPass = true;
  for (const t of testResults) {
    const mark = t.passed ? '✅ [PASS]' : '❌ [FAIL]';
    if (!t.passed) allPass = false;
    console.log(`${mark} ${t.testId}: ${t.name}`);
  }
  console.log('================================================================================');
  if (allPass) {
    console.log('🎉 ALL 11 ARCHITECTURAL E2E TEST SCENARIOS PASSED WITH 100% ACCURACY!');
  } else {
    console.log('⚠️ SOME TESTS FAILED. CHECK LOGS ABOVE.');
  }
  console.log('================================================================================\n');
}

runTestSuite()
  .catch((e) => {
    console.error('Fatal execution error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
