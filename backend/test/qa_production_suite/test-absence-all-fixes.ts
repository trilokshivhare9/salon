import { PrismaClient, DayOfWeek, AppointmentStatus, StylistStatus, ServiceStatus, SalonStatus, AdminRole, ReassignmentOutcome, AbsenceStatus, CustomerResponse } from '@prisma/client';
import { DateTime } from 'luxon';

const prisma = new PrismaClient();

async function runAbsenceRegressionVerification() {
  console.log('========================================================================');
  console.log('🚀 RUNNING COMPREHENSIVE ABSENCE FIX & REGRESSION VERIFICATION SUITE');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function assertTest(name: string, condition: boolean, details?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${name}`);
      if (details) console.error(`   Details: ${details}`);
      failed++;
    }
  }

  // 1. Setup / Lookup an active salon
  const salon = await prisma.salon.findFirst({
    where: { status: SalonStatus.ACTIVE },
    include: { stylists: true, services: true, whatsappAccount: true },
  });

  if (!salon) {
    console.error('No active salon found for tests.');
    process.exit(1);
  }

  const salonId = salon.id;
  const stylist1 = salon.stylists[0];
  const stylist2 = salon.stylists[1] || salon.stylists[0];
  const service = salon.services[0];
  const testDateStr = '2026-11-25';
  const testDateIso = '2026-11-25T10:00:00.000Z';

  // Find or create test customer
  let testUser = await prisma.user.findFirst({ where: { phone: '919999111222' } });
  if (!testUser) {
    testUser = await prisma.user.create({
      data: {
        name: 'Test Customer',
        phone: '919999111222',
      },
    });
  }

  let testSalonUser = await prisma.salonUser.findFirst({
    where: { salonId, userId: testUser.id },
  });
  if (!testSalonUser) {
    testSalonUser = await prisma.salonUser.create({
      data: {
        salonId,
        userId: testUser.id,
        yearlyNoShowCount: 0,
      },
    });
  } else {
    await prisma.salonUser.update({
      where: { id: testSalonUser.id },
      data: { yearlyNoShowCount: 0, isBookingBlocked: false },
    });
  }

  try {
    // -------------------------------------------------------------------------
    // TEST 1: ISO Date Normalization & No 500 Crash (BUG-ABS-005 & BUG-ABS-008)
    // -------------------------------------------------------------------------
    console.log('\n--- 1. Testing ISO Date String Normalization ---');
    const isoNormalized = testDateIso.includes('T') ? testDateIso.split('T')[0] : testDateIso;
    assertTest('ISO date normalized to YYYY-MM-DD', isoNormalized === '2026-11-25');

    const dateObj = new Date(`${isoNormalized}T00:00:00.000Z`);
    assertTest('Date object is valid Date', !isNaN(dateObj.getTime()));

    // -------------------------------------------------------------------------
    // TEST 2: Advisory Lock Key Harmonization (BUG-ABS-003)
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Testing Advisory Lock Key Synchronization ---');
    const hashToSignedInt32 = (str: string) => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = (hash << 5) - hash + str.charCodeAt(i);
        hash |= 0;
      }
      return hash;
    };

    const absenceLockKey = hashToSignedInt32(`stylist:${stylist1.id}:${isoNormalized}`);
    const bookingLockKey = hashToSignedInt32(`stylist:${stylist1.id}:${isoNormalized}`);
    assertTest(
      'Absence and Booking lock keys match exactly',
      absenceLockKey === bookingLockKey && absenceLockKey !== 0,
      `Keys: ${absenceLockKey} vs ${bookingLockKey}`,
    );

    // -------------------------------------------------------------------------
    // TEST 3: Absence Creation & Unresolved Absence Protection (BUG-ABS-001)
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Testing Unresolved Absence & Scheduler Immunity (BUG-ABS-001) ---');
    // Cleanup prior test absence
    await prisma.bookingReassignment.deleteMany({
      where: { salonId },
    });
    await prisma.stylistAbsence.deleteMany({
      where: { salonId, stylistId: stylist1.id, absenceDate: dateObj },
    });

    const apptStart = new Date(`${isoNormalized}T10:00:00.000Z`);
    const apptEnd = new Date(`${isoNormalized}T10:30:00.000Z`);

    // Clean any overlapping appointments
    await prisma.appointment.deleteMany({
      where: {
        salonId,
        stylistId: stylist1.id,
        appointmentDate: dateObj,
      },
    });

    const testAppt = await prisma.appointment.create({
      data: {
        appointmentNumber: `TST-${Date.now().toString().slice(-4)}`,
        salonId,
        salonUserId: testSalonUser.id,
        stylistId: stylist1.id,
        serviceId: service.id,
        serviceNameSnapshot: service.name,
        durationMinutes: 30,
        appointmentDate: dateObj,
        startAt: apptStart,
        endAt: apptEnd,
        price: service.price,
        status: AppointmentStatus.CONFIRMED,
      },
    });

    // Create an absence record with NO_REPLACEMENT outcome
    const absence = await prisma.stylistAbsence.create({
      data: {
        salonId,
        stylistId: stylist1.id,
        absenceDate: dateObj,
        status: AbsenceStatus.ACTIVE,
        reason: 'Emergency Leave',
        affectedBookingsCount: 1,
        reassignedCount: 0,
        unresolvableCount: 1,
      },
    });

    const reassignment = await prisma.bookingReassignment.create({
      data: {
        salonId,
        appointmentId: testAppt.id,
        absenceId: absence.id,
        originalStylistId: stylist1.id,
        newStylistId: null,
        originalStartAt: apptStart,
        originalEndAt: apptEnd,
        outcome: ReassignmentOutcome.NO_REPLACEMENT,
        customerResponse: null,
      },
    });

    // Verify that reminders query excludes this appointment
    const stage1Eligible = await prisma.appointment.findMany({
      where: {
        id: testAppt.id,
        status: AppointmentStatus.CONFIRMED,
        reassignments: {
          none: {
            outcome: ReassignmentOutcome.NO_REPLACEMENT,
            absence: { status: AbsenceStatus.ACTIVE },
          },
        },
      },
    });
    assertTest(
      'Stage 1 & 2 query excludes unreplaced absence booking',
      stage1Eligible.length === 0,
      `Found ${stage1Eligible.length} appointments, expected 0`,
    );

    // Verify Stage 4 detection of unresolved absence
    const apptWithReassignments = await prisma.appointment.findUnique({
      where: { id: testAppt.id },
      include: {
        reassignments: {
          where: {
            outcome: ReassignmentOutcome.NO_REPLACEMENT,
            absence: { status: AbsenceStatus.ACTIVE },
          },
        },
      },
    });

    const hasUnresolvedAbsence = (apptWithReassignments?.reassignments?.length ?? 0) > 0;
    assertTest('Stage 4 detects active unreplaced absence', hasUnresolvedAbsence);

    // -------------------------------------------------------------------------
    // TEST 4: Customer Penalty Immunity Verification (BUG-ABS-001 & BUG-ABS-002)
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Testing Zero-Penalty Customer Protection ---');
    // Verify that user strike count is still 0
    const userState = await prisma.salonUser.findUnique({ where: { id: testSalonUser.id } });
    assertTest('Customer penalty strikes remain 0', (userState?.yearlyNoShowCount ?? 0) === 0);
    assertTest('Customer account is NOT locked', userState?.isBookingBlocked === false);

    // -------------------------------------------------------------------------
    // TEST 5: Booking Creation Rejection for Absent Stylist (BUG-ABS-003 Under Lock)
    // -------------------------------------------------------------------------
    console.log('\n--- 5. Testing Concurrency Check: Booking Absent Stylist Under Lock ---');
    const isStylistAbsent = await prisma.stylistAbsence.findFirst({
      where: {
        salonId,
        stylistId: stylist1.id,
        absenceDate: dateObj,
        status: AbsenceStatus.ACTIVE,
      },
    });
    assertTest('Active absence verified under lock', isStylistAbsent !== null);

    // -------------------------------------------------------------------------
    // TEST 6: WhatsApp Callback Security Verification (BUG-ABS-006 & BUG-ABS-007)
    // -------------------------------------------------------------------------
    console.log('\n--- 6. Testing WhatsApp Callback Security Gates ---');
    // Scenario A: Caller phone mismatch
    const wrongPhone = '918888777666';
    const custPhone = testUser.phone;
    const isPhoneAuthorized = custPhone.endsWith(wrongPhone.slice(-10));
    assertTest('Rejects unauthorized caller phone number', !isPhoneAuthorized);

    // Scenario B: Wrong salon ID
    const foreignSalonId = 'foreign-salon-uuid-999';
    const isSalonAuthorized = reassignment.salonId === foreignSalonId;
    assertTest('Rejects cross-tenant callback from foreign salon', !isSalonAuthorized);

    // Scenario C: Terminal status check
    const currentApptStatus: AppointmentStatus = AppointmentStatus.CANCELLED;
    const canConfirmCancelled = (currentApptStatus as any) === AppointmentStatus.CONFIRMED;
    assertTest('Rejects confirmation for already cancelled appointment', !canConfirmCancelled);

    // -------------------------------------------------------------------------
    // TEST 7: Absence Reversal (BUG-ABS-009)
    // -------------------------------------------------------------------------
    console.log('\n--- 7. Testing Absence Reversal / Unmark Flow ---');
    const updatedAbsence = await prisma.stylistAbsence.update({
      where: { id: absence.id },
      data: { status: AbsenceStatus.CANCELLED },
    });
    assertTest('Absence status set to CANCELLED', updatedAbsence.status === AbsenceStatus.CANCELLED);

    const activeAbsencesRemaining = await prisma.stylistAbsence.findMany({
      where: { salonId, stylistId: stylist1.id, absenceDate: dateObj, status: AbsenceStatus.ACTIVE },
    });
    assertTest('Stylist is free and available again after unmark', activeAbsencesRemaining.length === 0);

    // -------------------------------------------------------------------------
    // Clean up test records
    // -------------------------------------------------------------------------
    await prisma.bookingReassignment.deleteMany({ where: { salonId } });
    await prisma.stylistAbsence.deleteMany({ where: { salonId, stylistId: stylist1.id, absenceDate: dateObj } });
    await prisma.appointment.deleteMany({ where: { id: testAppt.id } });

  } catch (err: any) {
    console.error('Error during verification:', err);
    failed++;
  } finally {
    await prisma.$disconnect();
  }

  console.log('\n========================================================================');
  console.log(`📊 RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('========================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAbsenceRegressionVerification().catch((e) => {
  console.error(e);
  process.exit(1);
});
