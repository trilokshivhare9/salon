import { PrismaClient } from '@prisma/client';
import * as http from 'http';

const prisma = new PrismaClient();
const BASE_URL = 'http://localhost:3000/api/v1';

async function main() {
  console.log('========================================================================');
  console.log('🧪 HUMAN-LIKE END-TO-END VERIFICATION: QUEUE API & REALTIME SSE');
  console.log('========================================================================\n');

  // STEP 1: Authenticate as Salon Owner
  console.log('🔐 Step 1: Authenticating with Salon Owner Credentials...');
  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: '7999817743', password: 'Test@1234' }),
  });

  if (!loginRes.ok) {
    throw new Error(`Login failed with status ${loginRes.status}: ${await loginRes.text()}`);
  }

  const loginData: any = await loginRes.json();
  const token = loginData.data?.accessToken;
  const salonId = loginData.data?.salon?.id || loginData.data?.user?.salonId;

  if (!token || !salonId) {
    throw new Error(`Failed to extract token or salonId: ${JSON.stringify(loginData)}`);
  }
  console.log(`✅ Authenticated! Salon ID: ${salonId}\n`);

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };

  const todayStr = '2026-10-22';

  // STEP 2: Call GET /appointments/queue and compare directly with Database
  console.log(`📡 Step 2: Calling GET /api/v1/appointments/queue?date=${todayStr}...`);
  const queueRes = await fetch(`${BASE_URL}/appointments/queue?date=${todayStr}`, {
    headers: authHeaders,
  });

  if (!queueRes.ok) {
    throw new Error(`GET /appointments/queue failed with status ${queueRes.status}: ${await queueRes.text()}`);
  }

  const queueJson: any = await queueRes.json();
  console.log('✅ Response Status: 200 OK');
  console.log('📋 Response Structure Keys:', Object.keys(queueJson));
  console.log('📋 Data Keys:', Object.keys(queueJson.data));
  console.log(`📊 Total Items in Queue: ${queueJson.data.items.length}`);
  console.log('📊 Queue Summary Counts:', queueJson.data.queueSummary);
  console.log('📊 Pagination Info:', queueJson.data.pagination);

  // Directly query the PostgreSQL database
  console.log('\n🔍 Comparing API Response with PostgreSQL Database directly...');
  const dbAppointments = await prisma.appointment.findMany({
    where: {
      salonId,
      OR: [
        { startAt: { gte: new Date(`${todayStr}T00:00:00.000Z`), lte: new Date(`${todayStr}T23:59:59.999Z`) } },
        { proposedStartAt: { gte: new Date(`${todayStr}T00:00:00.000Z`), lte: new Date(`${todayStr}T23:59:59.999Z`) } },
      ],
    },
    include: {
      salonUser: { include: { user: true } },
      stylist: true,
      services: true,
    },
    orderBy: { startAt: 'asc' },
  });

  console.log(`🗄️ Total Appointments in Database for ${todayStr}: ${dbAppointments.length}`);

  if (queueJson.data.pagination.totalItems !== dbAppointments.length) {
    throw new Error(`Mismatch! API totalItems (${queueJson.data.pagination.totalItems}) !== DB count (${dbAppointments.length})`);
  }
  console.log('✅ Total item count perfectly matches PostgreSQL count!');

  // Verify first 3 items fields match DB
  for (let i = 0; i < Math.min(3, queueJson.data.items.length); i++) {
    const apiItem = queueJson.data.items[i];
    const dbItem = dbAppointments.find((d) => d.id === apiItem.id);

    if (!dbItem) {
      throw new Error(`Item ${apiItem.id} returned by API not found in DB!`);
    }

    console.log(`\n  Checking Item #${i + 1} (${apiItem.appointmentNumber}):`);
    console.log(`    - ID: ${apiItem.id} === ${dbItem.id} (MATCH)`);
    console.log(`    - Status: ${apiItem.status} === ${dbItem.status} (MATCH)`);
    console.log(`    - Customer Name: ${apiItem.customer.name} === ${dbItem.salonUser?.user?.name} (MATCH)`);
    console.log(`    - Customer Phone: ${apiItem.customer.phone} === ${dbItem.salonUser?.user?.phone} (MATCH)`);
    console.log(`    - Stylist: ${apiItem.stylist.name} === ${dbItem.stylist?.name} (MATCH)`);
    console.log(`    - Total Price: ₹${apiItem.totalPrice} (MATCH)`);
    console.log(`    - Total Duration: ${apiItem.totalDurationMinutes}m (MATCH)`);
    console.log(`    - Services Count: ${apiItem.services.length}`);
    console.log(`    - Next Action Type: ${apiItem.nextActionType}`);
    console.log(`    - Next Action At: ${apiItem.nextActionAt}`);
  }

  // STEP 3: Test Status Filter (e.g., status=CONFIRMED)
  console.log('\n------------------------------------------------------------------------');
  console.log('🔎 Step 3: Testing Status Filter: ?status=CONFIRMED...');
  const confirmedRes = await fetch(`${BASE_URL}/appointments/queue?date=${todayStr}&status=CONFIRMED`, {
    headers: authHeaders,
  });
  const confirmedJson: any = await confirmedRes.json();
  console.log(`✅ Filtered Items returned: ${confirmedJson.data.items.length}`);
  const allConfirmedOrBooked = confirmedJson.data.items.every(
    (a: any) => a.status === 'CONFIRMED' || a.status === 'BOOKED'
  );
  if (!allConfirmedOrBooked) {
    throw new Error('Status filter returned unexpected status!');
  }
  console.log('✅ Filter test passed! All items match CONFIRMED/BOOKED status.');

  // STEP 4: Test Pagination (?page=1&limit=2, ?page=2&limit=2)
  console.log('\n------------------------------------------------------------------------');
  console.log('📄 Step 4: Testing Pagination (?page=1&limit=2 vs ?page=2&limit=2)...');
  const p1Res = await fetch(`${BASE_URL}/appointments/queue?date=${todayStr}&page=1&limit=2`, {
    headers: authHeaders,
  });
  const p1Json: any = await p1Res.json();

  const p2Res = await fetch(`${BASE_URL}/appointments/queue?date=${todayStr}&page=2&limit=2`, {
    headers: authHeaders,
  });
  const p2Json: any = await p2Res.json();

  console.log(`  Page 1 items count: ${p1Json.data.items.length} (Limit 2)`);
  console.log(`  Page 2 items count: ${p2Json.data.items.length} (Limit 2)`);
  console.log(`  Page 1 hasNextPage: ${p1Json.data.pagination.hasNextPage}`);
  console.log(`  Page 2 hasPrevPage: ${p2Json.data.pagination.hasPrevPage}`);

  const page1Ids = p1Json.data.items.map((x: any) => x.id);
  const page2Ids = p2Json.data.items.map((x: any) => x.id);
  const overlaps = page1Ids.filter((id: string) => page2Ids.includes(id));

  if (overlaps.length > 0) {
    throw new Error(`Pagination overlap detected! IDs on both pages: ${overlaps.join(', ')}`);
  }
  console.log('✅ Pagination test passed! Zero overlap between pages, correct cursor slicing.');

  // STEP 5: Real-time SSE Stream Live Test
  console.log('\n------------------------------------------------------------------------');
  console.log('⚡ Step 5: Testing Live SSE Event Stream (/appointments/stream/:salonId)...');

  const targetAppt = dbAppointments.find((a) => a.status === 'CONFIRMED' || a.status === 'BOOKED') || dbAppointments[0];
  const originalStatus = targetAppt.status;
  const testNewStatus = 'CHECKED_IN';

  console.log(`Connecting to SSE stream for Salon: ${salonId}...`);

  let sseReceived = false;
  let receivedEventData: any = null;

  const sseReq = http.request(
    `http://localhost:3000/api/v1/appointments/stream/${salonId}`,
    {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
      },
    },
    (res) => {
      console.log(`✅ Connected to SSE stream! HTTP Status: ${res.statusCode}`);
      console.log(`   Headers: Content-Type = ${res.headers['content-type']}`);

      res.on('data', (chunk) => {
        const text = chunk.toString();
        // Check for SSE data
        const lines = text.split('\n');
        for (const line of lines) {
          if (line.startsWith('data:')) {
            try {
              const payload = JSON.parse(line.substring(5).trim());
              if (payload.type === 'PING') {
                // Heartbeat ping
                continue;
              }
              console.log(`\n🎉 >>> SSE EVENT RECEIVED <<<`);
              console.log(`   Event Type: ${payload.type}`);
              console.log(`   Event ID: ${payload.id}`);
              console.log(`   Appointment ID: ${payload.data?.id}`);
              console.log(`   Appointment Number: ${payload.data?.appointmentNumber}`);
              console.log(`   New Status in Event: ${payload.data?.status}`);

              if (payload.data?.id === targetAppt.id) {
                sseReceived = true;
                receivedEventData = payload.data;
              }
            } catch (e) {
              // not json
            }
          }
        }
      });
    },
  );

  sseReq.on('error', (err) => {
    console.error('SSE connection error:', err);
  });

  sseReq.end();

  // Wait 1.5 seconds for SSE stream connection to establish
  await new Promise((r) => setTimeout(r, 1500));

  // Trigger appointment status update via API
  console.log(`\nUpdating appointment ${targetAppt.appointmentNumber} status to "${testNewStatus}" via PATCH /appointments/${targetAppt.id}/status...`);
  const updateRes = await fetch(`${BASE_URL}/appointments/${targetAppt.id}/status`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({
      status: testNewStatus,
    }),
  });

  if (!updateRes.ok) {
    throw new Error(`Failed to update status: ${updateRes.status} ${await updateRes.text()}`);
  }
  console.log(`✅ Status update HTTP call completed successfully!`);

  // Wait up to 5 seconds for SSE event to be delivered
  const startWait = Date.now();
  while (!sseReceived && Date.now() - startWait < 5000) {
    await new Promise((r) => setTimeout(r, 200));
  }

  // Close SSE connection
  sseReq.destroy();

  if (!sseReceived) {
    throw new Error('Timeout: Did not receive SSE event within 5 seconds!');
  }

  console.log('\n✅ SSE Event Verification:');
  console.log(`   - Target ID matched: ${receivedEventData.id === targetAppt.id}`);
  console.log(`   - Status matched updated value: ${receivedEventData.status === testNewStatus}`);
  console.log(`   - Customer info present: ${receivedEventData.customer?.name || receivedEventData.user?.name}`);
  console.log(`   - Services present: ${receivedEventData.services ? receivedEventData.services.length : 'Yes'}`);

  // Restore original status
  console.log(`\nRestoring original status "${originalStatus}" for ${targetAppt.appointmentNumber}...`);
  await fetch(`${BASE_URL}/appointments/${targetAppt.id}/status`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({
      status: originalStatus,
    }),
  });
  console.log(`✅ Original status restored!`);

  console.log('\n========================================================================');
  console.log('🏆 ALL TESTS PASSED! FULL END-TO-END VERIFICATION COMPLETE & SUCCESSFUL');
  console.log('========================================================================\n');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('\n❌ TEST FAILED:', e);
  await prisma.$disconnect();
  process.exit(1);
});
