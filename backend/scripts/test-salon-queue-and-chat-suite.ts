import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AppointmentsService } from '../src/modules/appointments/appointments.service';
import { WhatsAppService } from '../src/modules/whatsapp/whatsapp.service';
import { AppointmentStatus, AdminRole, AdminStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

async function runQueueAndChatTestSuite() {
  console.log('🚀 Starting Salon Queue Live Dashboard, Reschedule Approval & Live Chat Integration Suite...\n');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);
  const appointmentsService = app.get(AppointmentsService);
  const whatsAppService = app.get(WhatsAppService);

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ PASSED: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAILED: ${testName} - ${detail || 'Assertion failed'}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------------------
    // SETUP FIXTURES
    // -------------------------------------------------------------------------
    const passwordHash = await bcrypt.hash('Password123!', 10);
    let superAdmin = await prisma.admin.findFirst({ where: { role: AdminRole.SUPER_ADMIN } });
    if (!superAdmin) {
      superAdmin = await prisma.admin.create({
        data: {
          name: 'Platform Super Admin',
          email: `admin-${Date.now()}@salonsaas.com`,
          passwordHash,
          role: AdminRole.SUPER_ADMIN,
          status: AdminStatus.ACTIVE,
        },
      });
    }

    const salon = await prisma.salon.create({
      data: {
        createdByAdminId: superAdmin.id,
        name: 'Queue & Chat Test Salon',
        slug: `qc-salon-${Date.now()}`,
        email: `qc-${Date.now()}@test.com`,
        phone: `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`,
        status: 'ACTIVE',
        timezone: 'Asia/Kolkata',
      },
    });

    const stylist = await prisma.stylist.create({
      data: {
        salonId: salon.id,
        name: 'Master Stylist Alex',
        phone: `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`,
        status: 'ACTIVE',
      },
    });

    const haircutService = await prisma.service.create({
      data: {
        salonId: salon.id,
        name: 'Signature Haircut',
        durationMinutes: 30,
        price: 500,
        status: 'ACTIVE',
      },
    });

    const customerPhone = `+9198${Math.floor(10000000 + Math.random() * 90000000)}`;
    const user = await prisma.user.create({
      data: {
        phone: customerPhone,
        name: 'Dashboard Tester',
      },
    });

    const salonUser = await prisma.salonUser.create({
      data: {
        salonId: salon.id,
        userId: user.id,
      },
    });

    console.log('🔹 Setup Test Salon, Stylist, Service, and Customer created successfully.');

    // -------------------------------------------------------------------------
    // TEST 1: Live 10-Minute Countdown Timer Field Mapping
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 1: 10-Minute Countdown Timer & Reminder Timestamp ---');
    const now = new Date();
    const startAt = new Date(now.getTime() + 15 * 60000);
    const endAt = new Date(startAt.getTime() + 30 * 60000);
    const reminderSentAt = new Date(now.getTime() - 2 * 60000);

    const appt1 = await prisma.appointment.create({
      data: {
        appointmentNumber: `QC-001-${Date.now()}`,
        salonId: salon.id,
        salonUserId: salonUser.id,
        stylistId: stylist.id,
        serviceId: haircutService.id,
        serviceNameSnapshot: haircutService.name,
        durationMinutes: 30,
        appointmentDate: new Date(startAt.getFullYear(), startAt.getMonth(), startAt.getDate()),
        startAt,
        endAt,
        status: AppointmentStatus.CONFIRMED,
        price: 500,
        source: 'WHATSAPP',
        reminder10mSentAt: reminderSentAt,
      },
    });

    const fetchedAppt1 = await appointmentsService.getAppointmentById(salon.id, appt1.id);
    assert(
      !!fetchedAppt1.reminder10mSentAt,
      'Appointment returns reminder10mSentAt timestamp for frontend timer',
      `Got ${fetchedAppt1.reminder10mSentAt}`,
    );

    // -------------------------------------------------------------------------
    // TEST 2: 1-Click Status Flow (CONFIRMED -> CHECKED_IN -> IN_SERVICE -> COMPLETED)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 2: 1-Click Status Progressive Workflow ---');
    
    // Step 2a: Check In
    const checkedInAppt = await appointmentsService.updateAppointmentStatus(
      salon.id,
      appt1.id,
      { status: AppointmentStatus.CHECKED_IN },
    );
    assert(
      checkedInAppt.status === AppointmentStatus.CHECKED_IN,
      'Status transitions from CONFIRMED -> CHECKED_IN',
    );

    // Step 2b: Seat in Chair
    const inServiceAppt = await appointmentsService.updateAppointmentStatus(
      salon.id,
      appt1.id,
      { status: AppointmentStatus.IN_SERVICE },
    );
    assert(
      inServiceAppt.status === AppointmentStatus.IN_SERVICE,
      'Status transitions from CHECKED_IN -> IN_SERVICE',
    );

    // Step 2c: Mark Complete
    const completedAppt = await appointmentsService.updateAppointmentStatus(
      salon.id,
      appt1.id,
      { status: AppointmentStatus.COMPLETED },
    );
    assert(
      completedAppt.status === AppointmentStatus.COMPLETED,
      'Status transitions from IN_SERVICE -> COMPLETED',
    );

    // -------------------------------------------------------------------------
    // TEST 3: Admin Reschedule Proposal (PENDING_RESCHEDULE)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 3: Admin Reschedule Proposal Workflow ---');
    const appt2Start = new Date(now.getTime() + 120 * 60000);
    const appt2End = new Date(appt2Start.getTime() + 30 * 60000);

    const appt2 = await prisma.appointment.create({
      data: {
        appointmentNumber: `QC-002-${Date.now()}`,
        salonId: salon.id,
        salonUserId: salonUser.id,
        stylistId: stylist.id,
        serviceId: haircutService.id,
        serviceNameSnapshot: haircutService.name,
        durationMinutes: 30,
        appointmentDate: new Date(appt2Start.getFullYear(), appt2Start.getMonth(), appt2Start.getDate()),
        startAt: appt2Start,
        endAt: appt2End,
        status: AppointmentStatus.CONFIRMED,
        price: 500,
        source: 'WEB',
      },
    });

    const newProposedStart = new Date(now.getTime() + 240 * 60000);
    const newProposedEnd = new Date(newProposedStart.getTime() + 30 * 60000);

    const proposedAppt = await appointmentsService.proposeAdminReschedule(
      salon.id,
      appt2.id,
      newProposedStart,
      newProposedEnd,
      superAdmin.id,
    );

    assert(
      proposedAppt.status === 'PENDING_RESCHEDULE',
      'Appointment status set to PENDING_RESCHEDULE upon proposal',
      `Got ${proposedAppt.status}`,
    );
    assert(
      !!proposedAppt.proposedStartAt,
      'Appointment has proposedStartAt populated',
    );

    // -------------------------------------------------------------------------
    // TEST 4: Customer Accept Reschedule via WhatsApp Interactive Reply
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 4: WhatsApp Interactive Accept Reschedule Proposal ---');
    await whatsAppService.handleIncomingMessage(
      salon.id,
      customerPhone,
      'Accept',
      `propose_accept_${appt2.id}`,
    );

    const acceptedAppt = await prisma.appointment.findUnique({ where: { id: appt2.id } });
    assert(
      acceptedAppt?.status === AppointmentStatus.CONFIRMED,
      'Status transitions back to CONFIRMED after customer accepts proposal',
      `Got ${acceptedAppt?.status}`,
    );
    assert(
      new Date(acceptedAppt!.startAt).getTime() === newProposedStart.getTime(),
      'Appointment startAt updated to proposedStartAt time',
    );

    // -------------------------------------------------------------------------
    // TEST 5: Two-Way Staff Live WhatsApp Chat & AI Bot Pause Logic
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 5: Two-Way Staff Live WhatsApp Chat & 15-Minute AI Bot Pause ---');
    
    // Step 5a: Staff sends message
    await whatsAppService.sendStaffChatMessage(
      salon.id,
      customerPhone,
      'Hello from salon staff! Are you running 5 mins late?',
    );

    let chatHistory = await whatsAppService.getChatHistory(salon.id, customerPhone);
    assert(
      chatHistory.isBotPaused === true,
      'Sending staff chat message automatically sets isBotPaused = true',
      `Got isBotPaused = ${chatHistory.isBotPaused}`,
    );
    assert(
      chatHistory.logs.length >= 1,
      'Chat history records staff outbound message',
    );

    // Step 5b: Resume bot manually
    await whatsAppService.resumeBot(salon.id, customerPhone);
    chatHistory = await whatsAppService.getChatHistory(salon.id, customerPhone);
    assert(
      chatHistory.isBotPaused === false,
      'Calling resumeBot resets isBotPaused = false',
      `Got isBotPaused = ${chatHistory.isBotPaused}`,
    );

    // -------------------------------------------------------------------------
    // CLEANUP
    // -------------------------------------------------------------------------
    console.log('\n--- CLEANUP ---');
    await prisma.whatsAppLog.deleteMany({ where: { salonId: salon.id } });
    await prisma.appointment.deleteMany({ where: { salonId: salon.id } });
    await prisma.salonUser.deleteMany({ where: { salonId: salon.id } });
    await prisma.stylist.deleteMany({ where: { salonId: salon.id } });
    await prisma.service.deleteMany({ where: { salonId: salon.id } });
    await prisma.salon.delete({ where: { id: salon.id } });
    console.log('🧹 Test fixtures cleaned up successfully.');

  } catch (err) {
    console.error('❌ Test suite failed with unhandled exception:', err);
    failed++;
  } finally {
    await prisma.$disconnect();
    await app.close();
  }

  console.log(`\n==================================================`);
  console.log(`RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log(`==================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runQueueAndChatTestSuite();
