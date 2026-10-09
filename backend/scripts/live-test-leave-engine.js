const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SALON_ID = '50ac2818-b36f-4261-abaa-07030d0ab12d';
const STYLIST_VICRAM_ID = 'd8f125fd-bedc-4b4f-b4c7-12deb2506686';
const STYLIST_RAHUL_ID = 'fcaa508a-1070-41be-81c5-d68dc66b6f8d';
const SALON_USER_ID = 'e4a7feb4-d023-42ca-8f96-9d523bc8bb45';
const SERVICE_ID = '3b2618a7-3a7d-4283-9410-34f66a78d5e7';

async function main() {
  console.log('================================================================');
  console.log('🚀 LIVE ARCHITECTURAL TEST: LEAVE CONFLICT & REASSIGNMENT ENGINE');
  console.log('================================================================\n');

  // 1. Authenticate via Live API
  const loginRes = await fetch('http://localhost:3000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: '7999817743', password: 'Test@1234' }),
  });
  const loginData = await loginRes.json();
  const token = loginData.data?.accessToken || loginData.accessToken;
  if (!token) {
    throw new Error('Authentication failed: ' + JSON.stringify(loginData));
  }
  console.log('✅ 1. Authenticated as Salon Owner (Trilok Salon)\n');

  // Helper to cleanup test dates
  async function cleanup(dateStr) {
    const dObj = new Date(`${dateStr}T00:00:00.000Z`);
    const absences = await prisma.stylistAbsence.findMany({
      where: {
        salonId: SALON_ID,
        OR: [{ startDate: dObj }, { absenceDate: dObj }],
      },
    });
    for (const ab of absences) {
      await prisma.bookingReassignment.deleteMany({ where: { absenceId: ab.id } });
      await prisma.stylistAbsence.delete({ where: { id: ab.id } });
    }
    await prisma.appointment.deleteMany({
      where: { salonId: SALON_ID, appointmentDate: dObj },
    });
  }

  // ---------------------------------------------------------------------------
  // TEST SCENARIO 1: Clean Day (Zero Overlap)
  // ---------------------------------------------------------------------------
  console.log('--- TEST 1: Clean Schedule (Zero Existing Appointments) ---');
  const date1 = '2026-10-20';
  await cleanup(date1);

  const res1 = await fetch(`http://localhost:3000/api/v1/staff/${STYLIST_VICRAM_ID}/absence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      startDate: date1,
      endDate: date1,
      leaveType: 'CASUAL_LEAVE',
      leavePortion: 'FULL_DAY',
      reason: 'Clean Day Test',
    }),
  });
  const data1 = (await res1.json()).data;
  console.log(`HTTP Status: ${res1.status}`);
  console.log(`Calculated: Affected=${data1?.absence?.affectedBookingsCount}, Reassigned=${data1?.absence?.reassignedCount}, Unresolved=${data1?.absence?.unresolvableCount}`);
  if (data1?.absence?.affectedBookingsCount === 0 && data1?.absence?.reassignedCount === 0 && data1?.absence?.unresolvableCount === 0) {
    console.log('👉 RESULT: PASSED ✅ (Correctly recorded 0, 0, 0 for clean day)\n');
  } else {
    console.log('👉 RESULT: FAILED ❌\n');
  }

  // ---------------------------------------------------------------------------
  // TEST SCENARIO 2: Confirmed Appointment Overlap with Free Peer Stylist
  // ---------------------------------------------------------------------------
  console.log('--- TEST 2: Confirmed Booking with Free Peer Stylist Available ---');
  const date2 = '2026-10-21';
  await cleanup(date2);

  const appt2 = await prisma.appointment.create({
    data: {
      appointmentNumber: 'LIVE-TEST-002',
      salonId: SALON_ID,
      salonUserId: SALON_USER_ID,
      stylistId: STYLIST_VICRAM_ID,
      serviceId: SERVICE_ID,
      serviceNameSnapshot: 'Hair',
      durationMinutes: 30,
      price: 100,
      startAt: new Date(`${date2}T12:00:00.000Z`),
      endAt: new Date(`${date2}T12:30:00.000Z`),
      appointmentDate: new Date(`${date2}T00:00:00.000Z`),
      status: 'CONFIRMED',
      source: 'WHATSAPP',
    },
  });
  console.log(`Created confirmed booking #${appt2.appointmentNumber} for Vicram at 12:00 PM`);

  const res2 = await fetch(`http://localhost:3000/api/v1/staff/${STYLIST_VICRAM_ID}/absence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      startDate: date2,
      endDate: date2,
      leaveType: 'SICK_LEAVE',
      leavePortion: 'FULL_DAY',
      reason: 'Doctor Visit',
    }),
  });
  const data2 = (await res2.json()).data;
  console.log(`HTTP Status: ${res2.status}`);
  console.log(`Calculated: Affected=${data2?.absence?.affectedBookingsCount}, Reassigned=${data2?.absence?.reassignedCount}, Unresolved=${data2?.absence?.unresolvableCount}`);

  const updatedAppt2 = await prisma.appointment.findUnique({ where: { id: appt2.id } });
  const reassignRow2 = await prisma.bookingReassignment.findFirst({
    where: { appointmentId: appt2.id },
  });

  console.log(`Appointment was moved to stylist: ${updatedAppt2.stylistId} (Rahul: ${STYLIST_RAHUL_ID})`);
  console.log(`Reassignment log outcome: ${reassignRow2?.outcome}`);

  if (
    data2?.absence?.affectedBookingsCount === 1 &&
    data2?.absence?.reassignedCount === 1 &&
    data2?.absence?.unresolvableCount === 0 &&
    updatedAppt2.stylistId === STYLIST_RAHUL_ID &&
    reassignRow2?.outcome === 'AUTO_ASSIGNED'
  ) {
    console.log('👉 RESULT: PASSED ✅ (Auto-reassigned to Rahul Sharma flawlessly!)\n');
  } else {
    console.log('👉 RESULT: FAILED ❌\n');
  }

  // ---------------------------------------------------------------------------
  // TEST SCENARIO 3: Confirmed Appointment when ALL Stylists are Busy
  // ---------------------------------------------------------------------------
  console.log('--- TEST 3: Confirmed Booking when Replacement Stylist is BUSY (No Replacement) ---');
  const date3 = '2026-10-22';
  await cleanup(date3);

  // In Asia/Kolkata (+05:30), 12:00 PM IST is 06:30 UTC (inside 11:00 - 19:00 shift)
  const appt3Vicram = await prisma.appointment.create({
    data: {
      appointmentNumber: 'LIVE-TEST-003A',
      salonId: SALON_ID,
      salonUserId: SALON_USER_ID,
      stylistId: STYLIST_VICRAM_ID,
      serviceId: SERVICE_ID,
      serviceNameSnapshot: 'Hair',
      durationMinutes: 30,
      price: 100,
      startAt: new Date(`${date3}T06:30:00.000Z`), // 12:00 PM IST
      endAt: new Date(`${date3}T07:00:00.000Z`),   // 12:30 PM IST
      appointmentDate: new Date(`${date3}T00:00:00.000Z`),
      status: 'CONFIRMED',
      source: 'WHATSAPP',
    },
  });

  // 2. Booking for Rahul Sharma at SAME time 12:00 PM IST (06:30 UTC) so Rahul is NOT free!
  const appt3Rahul = await prisma.appointment.create({
    data: {
      appointmentNumber: 'LIVE-TEST-003B',
      salonId: SALON_ID,
      salonUserId: SALON_USER_ID,
      stylistId: STYLIST_RAHUL_ID,
      serviceId: SERVICE_ID,
      serviceNameSnapshot: 'Hair',
      durationMinutes: 30,
      price: 100,
      startAt: new Date(`${date3}T06:30:00.000Z`), // 12:00 PM IST
      endAt: new Date(`${date3}T07:00:00.000Z`),   // 12:30 PM IST
      appointmentDate: new Date(`${date3}T00:00:00.000Z`),
      status: 'CONFIRMED',
      source: 'WHATSAPP',
    },
  });
  console.log('Created appointment for Vicram at 12:00 PM IST, and another appointment for Rahul at 12:00 PM IST');

  const res3 = await fetch(`http://localhost:3000/api/v1/staff/${STYLIST_VICRAM_ID}/absence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      startDate: date3,
      endDate: date3,
      leaveType: 'EMERGENCY_LEAVE',
      leavePortion: 'FULL_DAY',
      reason: 'Emergency Leave',
    }),
  });
  const data3 = (await res3.json()).data;
  console.log(`HTTP Status: ${res3.status}`);
  console.log(`Calculated: Affected=${data3?.absence?.affectedBookingsCount}, Reassigned=${data3?.absence?.reassignedCount}, Unresolved=${data3?.absence?.unresolvableCount}`);

  const reassignRow3 = await prisma.bookingReassignment.findFirst({
    where: { appointmentId: appt3Vicram.id },
  });
  console.log(`Reassignment log outcome: ${reassignRow3?.outcome}`);

  if (
    data3?.absence?.affectedBookingsCount === 1 &&
    data3?.absence?.reassignedCount === 0 &&
    data3?.absence?.unresolvableCount === 1 &&
    reassignRow3?.outcome === 'NO_REPLACEMENT'
  ) {
    console.log('👉 RESULT: PASSED ✅ (Accurately identified 1 unresolvable booking with NO_REPLACEMENT!)\n');
  } else {
    console.log('👉 RESULT: FAILED ❌\n');
  }

  // ---------------------------------------------------------------------------
  // TEST SCENARIO 4: Partial Day / Half Day Boundaries
  // ---------------------------------------------------------------------------
  console.log('--- TEST 4: Partial Day (Morning Appointment vs Afternoon SECOND_HALF Leave) ---');
  const date4 = '2026-10-23';
  await cleanup(date4);

  // Vicram appointment at 11:30 AM IST (06:00 UTC) (First half: 11:00 to 15:00 IST)
  const appt4 = await prisma.appointment.create({
    data: {
      appointmentNumber: 'LIVE-TEST-004',
      salonId: SALON_ID,
      salonUserId: SALON_USER_ID,
      stylistId: STYLIST_VICRAM_ID,
      serviceId: SERVICE_ID,
      serviceNameSnapshot: 'Hair',
      durationMinutes: 30,
      price: 100,
      startAt: new Date(`${date4}T06:00:00.000Z`), // 11:30 AM IST
      endAt: new Date(`${date4}T06:30:00.000Z`),   // 12:00 PM IST
      appointmentDate: new Date(`${date4}T00:00:00.000Z`),
      status: 'CONFIRMED',
      source: 'WHATSAPP',
    },
  });
  console.log('Created morning booking (11:30 AM IST). Now applying SECOND_HALF leave (15:00 - 19:00 IST).');

  const res4 = await fetch(`http://localhost:3000/api/v1/staff/${STYLIST_VICRAM_ID}/absence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      startDate: date4,
      endDate: date4,
      leaveType: 'CASUAL_LEAVE',
      leavePortion: 'SECOND_HALF',
      reason: 'Afternoon Leave',
    }),
  });
  const data4 = (await res4.json()).data;
  console.log(`HTTP Status: ${res4.status}`);
  console.log(`Calculated: Affected=${data4?.absence?.affectedBookingsCount}, Reassigned=${data4?.absence?.reassignedCount}, Unresolved=${data4?.absence?.unresolvableCount}`);

  if (data4?.absence?.affectedBookingsCount === 0) {
    console.log('👉 RESULT: PASSED ✅ (Correctly realized morning booking is outside afternoon leave interval!)\n');
  } else {
    console.log('👉 RESULT: FAILED ❌\n');
  }

  // ---------------------------------------------------------------------------
  // TEST SCENARIO 5: ARCHITECTURAL DEFECT CHECK - Appointment with status "BOOKED"
  // ---------------------------------------------------------------------------
  console.log('--- TEST 5: ARCHITECTURAL GAP AUDIT (Booking with status "BOOKED") ---');
  const date5 = '2026-10-24';
  await cleanup(date5);

  const appt5 = await prisma.appointment.create({
    data: {
      appointmentNumber: 'LIVE-TEST-005',
      salonId: SALON_ID,
      salonUserId: SALON_USER_ID,
      stylistId: STYLIST_VICRAM_ID,
      serviceId: SERVICE_ID,
      serviceNameSnapshot: 'Hair',
      durationMinutes: 30,
      price: 100,
      startAt: new Date(`${date5}T12:00:00.000Z`),
      endAt: new Date(`${date5}T12:30:00.000Z`),
      appointmentDate: new Date(`${date5}T00:00:00.000Z`),
      status: 'BOOKED', // Default initial status in database!
      source: 'WEB',
    },
  });
  console.log(`Created booking #${appt5.appointmentNumber} with status: BOOKED at 12:00 PM`);

  const res5 = await fetch(`http://localhost:3000/api/v1/staff/${STYLIST_VICRAM_ID}/absence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      startDate: date5,
      endDate: date5,
      leaveType: 'CASUAL_LEAVE',
      leavePortion: 'FULL_DAY',
      reason: 'Audit Check',
    }),
  });
  const data5 = (await res5.json()).data;
  console.log(`Calculated for BOOKED status: Affected=${data5?.absence?.affectedBookingsCount}`);

  if (data5?.absence?.affectedBookingsCount === 0) {
    console.log('⚠️ CRITICAL ARCHITECTURAL FINDING CONFIRMED:');
    console.log('The engine currently filters: status IN [CONFIRMED, CHECKED_IN].');
    console.log('Because the booking was in BOOKED status, the engine MISSED it and reported Affected: 0!');
  } else {
    console.log('👉 BOOKED status was counted.');
  }

  // Cleanup test dates
  await cleanup(date1);
  await cleanup(date2);
  await cleanup(date3);
  await cleanup(date4);
  await cleanup(date5);
  console.log('\n🧹 Cleaned up all temporary test records.');
  console.log('================================================================');
}

main()
  .catch((e) => {
    console.error('Test execution error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
