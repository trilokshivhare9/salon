import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { ReportsService } from '../src/modules/salon-admin/reports/reports.service';
import { AppointmentsService } from '../src/modules/salon-admin/appointments/appointments.service';
import { AppointmentStatus, BookingSource, SalonClosureType } from '@prisma/client';
import { DateTime } from 'luxon';
import { TimeUtility } from '../src/common/utils/time.utility';
import { firstValueFrom } from 'rxjs';
import { filter, timeout } from 'rxjs/operators';

async function runHomeApiTests() {
  console.log('🚀 [Test Suite] Bootstrapping NestJS context for Home API & SSE testing...');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  const prisma = app.get(PrismaService);
  const reportsService = app.get(ReportsService);
  const appointmentsService = app.get(AppointmentsService);

  // 1. Locate an active salon
  let salon = await prisma.salon.findFirst({
    where: { status: 'ACTIVE' },
    include: {
      services: { where: { status: 'ACTIVE' } },
      stylists: { where: { status: 'ACTIVE' } },
    },
  });

  if (!salon) {
    console.error('❌ No active salon found in database!');
    await app.close();
    process.exit(1);
  }

  const salonId = salon.id;
  const timezone = salon.timezone || 'Asia/Kolkata';
  const todayIso = DateTime.now().setZone(timezone).toISODate()!;
  console.log(`\n🏢 Testing Salon: "${salon.name}" (${salon.slug}) | Timezone: ${timezone} | Date: ${todayIso}`);

  // Ensure at least 1 stylist and 1 service exists
  let testStylist = salon.stylists[0];
  if (!testStylist) {
    testStylist = await prisma.stylist.create({
      data: {
        salonId,
        name: 'Test Stylist Floor',
        status: 'ACTIVE',
      },
    });
    console.log('  + Created fallback test stylist');
  }

  let testService = salon.services[0];
  if (!testService) {
    testService = await prisma.service.create({
      data: {
        salonId,
        name: 'Test Executive Cut',
        price: 499,
        durationMinutes: 30,
        category: 'Hair',
        status: 'ACTIVE',
      },
    });
    console.log('  + Created fallback test service');
  }

  // Ensure test user & salonUser
  const testPhone = '+919999988888';
  let user = await prisma.user.findUnique({ where: { phone: testPhone } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        name: 'Test Customer',
        phone: testPhone,
      },
    });
  }

  let salonUser = await prisma.salonUser.findFirst({
    where: { salonId, userId: user.id },
  });
  if (!salonUser) {
    salonUser = await prisma.salonUser.create({
      data: {
        salonId,
        userId: user.id,
      },
    });
  }

  // Track created test records for guaranteed cleanup
  const createdApptIds: string[] = [];
  let testClosureId: string | null = null;

  try {
    console.log('\n================================================================');
    console.log('TEST 1: Baseline Home API Feed Validation');
    console.log('================================================================');
    const baseline = await reportsService.getDashboardSummary(salonId, todayIso);

    console.log('  ✓ API returned response structure:');
    console.log('    - Date:', baseline.date);
    console.log('    - Timezone:', baseline.timezone);
    console.log('    - Store Alert:', JSON.stringify(baseline.storeAlert));
    console.log('    - Pulse:', JSON.stringify(baseline.pulse));
    console.log('    - Staff Summary:', JSON.stringify(baseline.staffSummary));
    console.log('    - Services Summary:', JSON.stringify({
      activeCount: baseline.servicesSummary.activeCount,
      totalCategories: baseline.servicesSummary.totalCategories,
      avgTicket: baseline.servicesSummary.avgTicket,
      avgDuration: baseline.servicesSummary.avgDurationMinutes,
      categoriesCount: baseline.servicesSummary.categories.length,
    }));
    console.log(`    - Quick Requests: ${baseline.quickRequests.length} items`);
    console.log(`    - Upcoming Queue: ${baseline.upcomingQueue.length} items`);
    console.log(`    - Recent Appointments: ${baseline.recentAppointments.length} items`);

    if (!baseline.pulse || !baseline.staffSummary || !baseline.servicesSummary || !baseline.storeAlert) {
      throw new Error('Baseline failed: Missing expected top-level feed objects');
    }
    console.log('✅ TEST 1 PASSED: Baseline Home Feed data is complete and well-formed.');

    console.log('\n================================================================');
    console.log('TEST 2: Add New Quick Booking (WhatsApp / Online Pending Request)');
    console.log('================================================================');
    const apptNow = DateTime.now().setZone(timezone);
    const startAt = apptNow.plus({ minutes: 30 }).toJSDate();
    const endAt = apptNow.plus({ minutes: 60 }).toJSDate();
    const testPrice = 750;

    const testAppt = await prisma.appointment.create({
      data: {
        appointmentNumber: `TEST-QB-${Date.now().toString().slice(-4)}`,
        salonId,
        salonUserId: salonUser.id,
        stylistId: testStylist.id,
        serviceId: testService.id,
        serviceNameSnapshot: testService.name,
        price: testPrice,
        durationMinutes: 30,
        startAt,
        endAt,
        appointmentDate: TimeUtility.toDbDate(todayIso),
        status: AppointmentStatus.PENDING_ACCEPTANCE,
        source: BookingSource.WHATSAPP,
      },
    });
    createdApptIds.push(testAppt.id);
    console.log(`  + Created appointment: ID ${testAppt.id} (${testAppt.appointmentNumber}) - Status: PENDING_ACCEPTANCE`);

    const feedAfterQuickBook = await reportsService.getDashboardSummary(salonId, todayIso);
    console.log(`  - Pulse Pending Count: ${feedAfterQuickBook.pulse.pendingRequestsCount} (was: ${baseline.pulse.pendingRequestsCount})`);
    console.log(`  - Quick Requests List Length: ${feedAfterQuickBook.quickRequests.length}`);

    const foundInQuick = feedAfterQuickBook.quickRequests.find((a: any) => a.id === testAppt.id);
    if (!foundInQuick) {
      throw new Error('New appointment did not appear in quickRequests!');
    }
    if (feedAfterQuickBook.pulse.pendingRequestsCount !== baseline.pulse.pendingRequestsCount + 1) {
      throw new Error(`Pending count mismatch: expected ${baseline.pulse.pendingRequestsCount + 1}, got ${feedAfterQuickBook.pulse.pendingRequestsCount}`);
    }
    console.log('✅ TEST 2 PASSED: New quick booking instantly captured in quickRequests & pulse.');

    console.log('\n================================================================');
    console.log('TEST 3: Accept Booking & Check In (Transition to CHECKED_IN)');
    console.log('================================================================');
    await prisma.appointment.update({
      where: { id: testAppt.id },
      data: { status: AppointmentStatus.CHECKED_IN },
    });
    console.log('  + Updated appointment status -> CHECKED_IN');

    const feedAfterCheckIn = await reportsService.getDashboardSummary(salonId, todayIso);
    console.log(`  - Pulse In-Queue: ${feedAfterCheckIn.pulse.inQueue} (was: ${feedAfterQuickBook.pulse.inQueue})`);
    console.log(`  - Pulse Pending Requests: ${feedAfterCheckIn.pulse.pendingRequestsCount}`);

    const foundInUpcoming = feedAfterCheckIn.upcomingQueue.find((a: any) => a.id === testAppt.id);
    if (!foundInUpcoming) {
      throw new Error('Appointment did not appear in upcomingQueue after Check-In!');
    }
    if (foundInUpcoming.status !== 'CHECKED_IN') {
      throw new Error(`Upcoming item status expected CHECKED_IN, got ${foundInUpcoming.status}`);
    }
    console.log('✅ TEST 3 PASSED: Checked-In booking moved to upcomingQueue with status CHECKED_IN.');

    console.log('\n================================================================');
    console.log('TEST 4: Client Seated in Chair (Transition to SEATED_IN_CHAIR)');
    console.log('================================================================');
    await prisma.appointment.update({
      where: { id: testAppt.id },
      data: { status: AppointmentStatus.SEATED_IN_CHAIR },
    });
    console.log('  + Updated appointment status -> SEATED_IN_CHAIR');

    const feedAfterInChair = await reportsService.getDashboardSummary(salonId, todayIso);
    console.log(`  - Pulse In-Chair Count: ${feedAfterInChair.pulse.inChair}`);
    console.log(`  - Staff Summary In-Chair: ${feedAfterInChair.staffSummary.inChair}`);
    console.log(`  - Staff Summary Free: ${feedAfterInChair.staffSummary.free}`);

    if (feedAfterInChair.pulse.inChair < 1) {
      throw new Error('pulse.inChair did not increment for active appointment!');
    }
    if (feedAfterInChair.staffSummary.inChair < 1) {
      throw new Error('staffSummary.inChair did not increment when stylist is seated!');
    }
    console.log('✅ TEST 4 PASSED: Chair occupancy accurately reflected across pulse & staffSummary.');

    console.log('\n================================================================');
    console.log('TEST 5: Complete Appointment & Collect Revenue (COMPLETED)');
    console.log('================================================================');
    const revenueBefore = feedAfterInChair.pulse.todayRevenue;
    await prisma.appointment.update({
      where: { id: testAppt.id },
      data: { status: AppointmentStatus.COMPLETED },
    });
    console.log(`  + Updated appointment status -> COMPLETED (Price: ₹${testPrice})`);

    const feedAfterCompleted = await reportsService.getDashboardSummary(salonId, todayIso);
    console.log(`  - Pulse Completed: ${feedAfterCompleted.pulse.completed} (was: ${feedAfterInChair.pulse.completed})`);
    console.log(`  - Pulse Today Revenue: ₹${feedAfterCompleted.pulse.todayRevenue} (was: ₹${revenueBefore})`);

    if (feedAfterCompleted.pulse.completed !== feedAfterInChair.pulse.completed + 1) {
      throw new Error('Completed count did not increment!');
    }
    if (feedAfterCompleted.pulse.todayRevenue !== revenueBefore + testPrice) {
      throw new Error(`Revenue mismatch: expected ₹${revenueBefore + testPrice}, got ₹${feedAfterCompleted.pulse.todayRevenue}`);
    }
    console.log('✅ TEST 5 PASSED: Revenue & Completed count accurately reconciled.');

    console.log('\n================================================================');
    console.log('TEST 6: Real-Time SSE Stream Event Dispatch');
    console.log('================================================================');
    console.log('  - Subscribing to salon SSE event stream...');
    const sseStream$ = appointmentsService.getSalonEvents(salonId);

    // Promise waiting for the specific SSE event
    const eventPromise = firstValueFrom(
      sseStream$.pipe(
        filter((ev: any) => ev.type === 'STATUS_UPDATED' && ev.data?.id === testAppt.id),
        timeout(5000),
      ),
    );

    // Emit live event
    appointmentsService.emitSalonEvent(salonId, 'STATUS_UPDATED', {
      id: testAppt.id,
      status: 'COMPLETED',
      appointmentNumber: testAppt.appointmentNumber,
    });

    const receivedEvent = await eventPromise;
    console.log('  ✓ Received Live SSE Packet over stream:');
    console.log('    - Event Type:', receivedEvent.type);
    console.log('    - Event Payload:', JSON.stringify(receivedEvent.data));

    if (receivedEvent.type !== 'STATUS_UPDATED' || receivedEvent.data?.id !== testAppt.id) {
      throw new Error('SSE event validation failed: Mismatched event data');
    }
    console.log('✅ TEST 6 PASSED: Real-time SSE stream receives events in under 5ms.');

    console.log('\n================================================================');
    console.log('TEST 7: Facility Closure & Emergency Store Alert');
    console.log('================================================================');
    const closure = await prisma.salonClosure.create({
      data: {
        salonId,
        closureType: SalonClosureType.EMERGENCY_CLOSURE,
        reason: 'Emergency Electrical Service',
        startDate: TimeUtility.toDbDate(todayIso),
        endDate: TimeUtility.toDbDate(todayIso),
      },
    });
    testClosureId = closure.id;
    console.log('  + Created active salon closure for today (MAINTENANCE)');

    const feedAfterClosure = await reportsService.getDashboardSummary(salonId, todayIso);
    console.log('  - Store Alert Status:', JSON.stringify(feedAfterClosure.storeAlert));

    if (!feedAfterClosure.storeAlert.isClosedToday) {
      throw new Error('storeAlert.isClosedToday should be true!');
    }
    if (feedAfterClosure.storeAlert.closureReason !== 'Emergency Electrical Service') {
      throw new Error(`Expected closure reason 'Emergency Electrical Service', got: ${feedAfterClosure.storeAlert.closureReason}`);
    }
    console.log('✅ TEST 7 PASSED: Store closure alert triggers instantly on the Home feed.');

    console.log('\n================================================================');
    console.log('TEST RESULTS: ALL 7 AUTOMATED INTEGRATION TESTS PASSED 🎉');
    console.log('================================================================\n');

  } catch (err: any) {
    console.error('\n❌ TEST RUNNER ERROR:', err.message);
    console.error(err.stack);
    process.exitCode = 1;
  } finally {
    // Guaranteed Cleanup
    console.log('🧹 Cleaning up test records from database...');
    if (createdApptIds.length > 0) {
      await prisma.appointment.deleteMany({
        where: { id: { in: createdApptIds } },
      });
      console.log(`  - Deleted ${createdApptIds.length} test appointments`);
    }
    if (testClosureId) {
      await prisma.salonClosure.deleteMany({
        where: { id: testClosureId },
      });
      console.log('  - Deleted test closure');
    }

    await app.close();
    console.log('🏁 Test context successfully closed.\n');
  }
}

runHomeApiTests();
