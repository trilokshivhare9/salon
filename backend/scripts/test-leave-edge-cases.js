const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const SALON_ID = '50ac2818-b36f-4261-abaa-07030d0ab12d';
const STYLIST_ID = 'd8f125fd-bedc-4b4f-b4c7-12deb2506686'; // Vicram

async function runEdgeCaseTests() {
  console.log('================================================================');
  console.log('🛡️ LIVE ARCHITECTURAL TEST: LEAVE EDGE-CASE DEFENSE ENGINE');
  console.log('================================================================\n');

  // Authenticate
  const loginRes = await fetch('http://localhost:3000/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: '7999817743', password: 'Test@1234' }),
  });
  const loginData = await loginRes.json();
  const token = loginData.data?.accessToken || loginData.accessToken;
  if (!token) throw new Error('Auth failed: ' + JSON.stringify(loginData));
  console.log('✅ Authenticated as Salon Owner\n');

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + token,
  };

  // Cleanup helper
  async function cleanupDate(dateStr) {
    const d = new Date(`${dateStr}T00:00:00.000Z`);
    const absences = await prisma.stylistAbsence.findMany({
      where: { salonId: SALON_ID, OR: [{ startDate: d }, { absenceDate: d }] },
    });
    for (const a of absences) {
      await prisma.bookingReassignment.deleteMany({ where: { absenceId: a.id } });
      await prisma.stylistAbsence.delete({ where: { id: a.id } });
    }
    await prisma.salonClosure.deleteMany({
      where: { salonId: SALON_ID, startDate: d },
    });
  }

  // --- TEST 1: Inverted Dates (endDate < startDate) ---
  console.log('--- TEST 1: Inverted Dates Guard (endDate < startDate) ---');
  const t1Res = await fetch(`http://localhost:3000/api/v1/staff/${STYLIST_ID}/leaves`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      startDate: '2026-11-20',
      endDate: '2026-11-15',
      leaveType: 'CASUAL_LEAVE',
    }),
  });
  const t1Data = await t1Res.json();
  console.log('HTTP Status:', t1Res.status);
  console.log('Response Error:', t1Data.message);
  if (t1Res.status === 400 && t1Data.message.includes('cannot be earlier')) {
    console.log('👉 RESULT: PASSED ✅\n');
  } else {
    throw new Error('TEST 1 Failed');
  }

  // --- TEST 2: Inverted Custom Hours (customStartTime >= customEndTime) ---
  console.log('--- TEST 2: Inverted Custom Hours Guard ---');
  const t2Res = await fetch(`http://localhost:3000/api/v1/staff/${STYLIST_ID}/leaves`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      startDate: '2026-11-25',
      endDate: '2026-11-25',
      leavePortion: 'CUSTOM_HOURS',
      customStartTime: '17:00',
      customEndTime: '14:00',
    }),
  });
  const t2Data = await t2Res.json();
  console.log('HTTP Status:', t2Res.status);
  console.log('Response Error:', t2Data.message);
  if (t2Res.status === 400 && t2Data.message.toLowerCase().includes('custom start time must be strictly before')) {
    console.log('👉 RESULT: PASSED ✅\n');
  } else {
    throw new Error('TEST 2 Failed');
  }

  // --- TEST 3: Salon Closed / Holiday Edge Case ---
  console.log('--- TEST 3: Salon Closed / Holiday Guard ---');
  const closedDate = '2026-11-28';
  await cleanupDate(closedDate);
  await prisma.salonClosure.create({
    data: {
      salonId: SALON_ID,
      closureType: 'HOLIDAY',
      startDate: new Date(`${closedDate}T00:00:00.000Z`),
      endDate: new Date(`${closedDate}T00:00:00.000Z`),
      reason: 'National Holiday Closure Test',
      isPartialDay: false,
    },
  });

  const t3Res = await fetch(`http://localhost:3000/api/v1/staff/${STYLIST_ID}/leaves`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      startDate: closedDate,
      endDate: closedDate,
      leaveType: 'CASUAL_LEAVE',
    }),
  });
  const t3Data = await t3Res.json();
  console.log('HTTP Status:', t3Res.status);
  console.log('Response Error:', t3Data.message);
  if (t3Res.status === 400 && t3Data.message.includes('salon is closed')) {
    console.log('👉 RESULT: PASSED ✅\n');
  } else {
    throw new Error('TEST 3 Failed');
  }
  await cleanupDate(closedDate);

  // --- TEST 4: Duplicate / Overlapping Leave Collision Guard ---
  console.log('--- TEST 4: Duplicate Overlapping Leave Guard ---');
  const overlapDate = '2026-11-29';
  await cleanupDate(overlapDate);

  // 1. Create first valid leave
  const apply1Res = await fetch(`http://localhost:3000/api/v1/staff/${STYLIST_ID}/leaves`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      startDate: overlapDate,
      endDate: overlapDate,
      leaveType: 'SICK_LEAVE',
      reason: 'Doctor Checkup',
    }),
  });
  const apply1Data = await apply1Res.json();
  console.log('First Leave Created. Status:', apply1Res.status);

  // 2. Attempt overlapping leave on same date
  const t4Res = await fetch(`http://localhost:3000/api/v1/staff/${STYLIST_ID}/leaves`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      startDate: overlapDate,
      endDate: overlapDate,
      leaveType: 'CASUAL_LEAVE',
    }),
  });
  const t4Data = await t4Res.json();
  console.log('Overlap Attempt Status:', t4Res.status);
  console.log('Overlap Error Response:', t4Data.message);
  if (t4Res.status === 400 && t4Data.message.includes('already has an active leave')) {
    console.log('👉 RESULT: PASSED ✅\n');
  } else {
    throw new Error('TEST 4 Failed');
  }

  // --- TEST 5: Semantic Routes & Unified Status Contract ---
  console.log('--- TEST 5: Semantic Routes & Unified Status Contracts ---');
  // GET /staff/:id/leaves
  const listRes = await fetch(`http://localhost:3000/api/v1/staff/${STYLIST_ID}/leaves`, { headers });
  const listJson = await listRes.json();
  const listData = listJson.data || listJson;
  console.log('GET /staff/:id/leaves Status:', listRes.status, 'Total Leaves:', listData.length);
  const sample = listData[0];
  console.log('Sample Status Payload:', {
    id: sample.id,
    statusKey: sample.statusKey,
    statusTitle: sample.statusTitle,
    canCancel: sample.canCancel,
    isPast: sample.isPast,
  });

  if (sample.statusTitle === '🟢 On Leave' || sample.statusTitle === '❌ Cancelled') {
    console.log('👉 RESULT: PASSED ✅\n');
  } else {
    throw new Error('TEST 5 Failed');
  }

  // Cleanup test dates
  await cleanupDate(overlapDate);

  console.log('================================================================');
  console.log('🎉 ALL EDGE-CASE DEFENSE TESTS PASSED PERFECTLY!');
  console.log('================================================================');
}

runEdgeCaseTests()
  .catch((err) => {
    console.error('❌ Edge case test failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
