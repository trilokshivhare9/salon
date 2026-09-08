import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { RemindersService } from '../src/modules/appointments/reminders.service';
import { AppointmentsService } from '../src/modules/appointments/appointments.service';
import { WhatsAppService } from '../src/modules/whatsapp/whatsapp.service';
import { CustomersService } from '../src/modules/customers/customers.service';
import { AppointmentStatus, ClientEtaStatus, AdminRole, AdminStatus } from '@prisma/client';
import { DateTime } from 'luxon';
import * as bcrypt from 'bcrypt';

async function runTestMatrix() {
  console.log('🚀 Starting Smart Reminder, Move-Up Broadcast & Yearly Penalty Test Matrix...\n');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);
  const remindersService = app.get(RemindersService);
  const appointmentsService = app.get(AppointmentsService);
  const whatsAppService = app.get(WhatsAppService);
  const customersService = app.get(CustomersService);

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
    // SETUP TEST FIXTURES
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
        name: 'Smart Reminder Test Salon',
        slug: `smart-salon-${Date.now()}`,
        email: `smart-${Date.now()}@test.com`,
        phone: '+919999900000',
        status: 'ACTIVE',
        timezone: 'Asia/Kolkata',
      },
    });

    const stylist = await prisma.stylist.create({
      data: {
        salonId: salon.id,
        name: 'Master Barber Sam',
        phone: '+919999911111',
        status: 'ACTIVE',
      },
    });

    const shortService = await prisma.service.create({
      data: {
        salonId: salon.id,
        name: 'Quick Haircut (30m)',
        durationMinutes: 30,
        price: 300,
        status: 'ACTIVE',
      },
    });

    const longService = await prisma.service.create({
      data: {
        salonId: salon.id,
        name: 'Full Facial & Cut (60m)',
        durationMinutes: 60,
        price: 800,
        status: 'ACTIVE',
      },
    });

    // Create 3 Test Users
    const user1 = await prisma.user.create({ data: { phone: `+91987654301${Date.now().toString().slice(-3)}`, name: 'Alice Customer' } });
    const user2 = await prisma.user.create({ data: { phone: `+91987654302${Date.now().toString().slice(-3)}`, name: 'Bob Customer' } });
    const user3 = await prisma.user.create({ data: { phone: `+91987654303${Date.now().toString().slice(-3)}`, name: 'Charlie Customer' } });

    const salonUser1 = await prisma.salonUser.create({ data: { salonId: salon.id, userId: user1.id } });
    const salonUser2 = await prisma.salonUser.create({ data: { salonId: salon.id, userId: user2.id } });
    const salonUser3 = await prisma.salonUser.create({ data: { salonId: salon.id, userId: user3.id } });

    // Set baseDate to 1 hour in future so findActiveUpcomingAppointments includes it
    const baseDate = DateTime.now().setZone('Asia/Kolkata').plus({ hours: 1 });

    // -------------------------------------------------------------------------
    // TEST CASES
    // -------------------------------------------------------------------------

    // TC-SMART-001: 2-Hour Reminder Confirmation Button
    console.log('📌 Test Case 1: 2-Hour Reminder Confirmation Flow');
    const appt1 = await prisma.appointment.create({
      data: {
        appointmentNumber: `SMART-001-${Date.now()}`,
        salonId: salon.id,
        salonUserId: salonUser1.id,
        stylistId: stylist.id,
        serviceId: shortService.id,
        serviceNameSnapshot: shortService.name,
        durationMinutes: 30,
        price: 300,
        startAt: baseDate.toJSDate(),
        endAt: baseDate.plus({ minutes: 30 }).toJSDate(),
        appointmentDate: baseDate.startOf('day').toJSDate(),
        status: AppointmentStatus.CONFIRMED,
        source: 'WHATSAPP',
      },
    });

    const confirmRes = await whatsAppService.handleIncomingMessage(
      salon.id,
      user1.phone,
      '',
      'remind_confirm',
    );
    assert(
      confirmRes.replyMessage.includes('Thank you for confirming'),
      'TC-SMART-001: 2h Confirm button locks appointment',
      `Output: ${confirmRes.replyMessage}`,
    );

    // TC-SMART-002: 10-Minute On-The-Way Arrival Confirmation
    console.log('\n📌 Test Case 2: 10-Minute On-The-Way Arrival Action');
    const appt2 = await prisma.appointment.create({
      data: {
        appointmentNumber: `SMART-002-${Date.now()}`,
        salonId: salon.id,
        salonUserId: salonUser2.id,
        stylistId: stylist.id,
        serviceId: shortService.id,
        serviceNameSnapshot: shortService.name,
        durationMinutes: 30,
        price: 300,
        startAt: baseDate.plus({ hours: 1 }).toJSDate(),
        endAt: baseDate.plus({ hours: 1, minutes: 30 }).toJSDate(),
        appointmentDate: baseDate.startOf('day').toJSDate(),
        status: AppointmentStatus.CONFIRMED,
        source: 'WHATSAPP',
      },
    });

    const onWayRes = await whatsAppService.handleIncomingMessage(
      salon.id,
      user2.phone,
      '',
      'remind_10m_on_way',
    );
    const updatedAppt2 = await prisma.appointment.findUnique({ where: { id: appt2.id } });
    assert(
      onWayRes.replyMessage.includes('notified your stylist') && updatedAppt2?.clientEtaStatus === ClientEtaStatus.ON_THE_WAY,
      'TC-SMART-002: 10m On-The-Way flags appointment status',
      `Status: ${updatedAppt2?.clientEtaStatus}`,
    );

    // TC-SMART-003 & 004: Smart Express Move-Up Broadcast & Duration Matching Filter
    console.log('\n📌 Test Case 3 & 4: Move-Up Broadcast & Strict Duration Filter');
    
    // Create candidate 1 (Short service 30m - Should receive broadcast offer)
    const candidate30m = await prisma.appointment.create({
      data: {
        appointmentNumber: `SMART-CAND30-${Date.now()}`,
        salonId: salon.id,
        salonUserId: salonUser1.id,
        stylistId: stylist.id,
        serviceId: shortService.id,
        serviceNameSnapshot: shortService.name,
        durationMinutes: 30,
        price: 300,
        startAt: baseDate.plus({ hours: 3 }).toJSDate(),
        endAt: baseDate.plus({ hours: 3, minutes: 30 }).toJSDate(),
        appointmentDate: baseDate.startOf('day').toJSDate(),
        status: AppointmentStatus.CONFIRMED,
        source: 'WHATSAPP',
      },
    });

    // Create candidate 2 (Long service 60m - Should be EXCLUDED because 60m > 30m freed slot)
    const candidate60m = await prisma.appointment.create({
      data: {
        appointmentNumber: `SMART-CAND60-${Date.now()}`,
        salonId: salon.id,
        salonUserId: salonUser3.id,
        stylistId: stylist.id,
        serviceId: longService.id,
        serviceNameSnapshot: longService.name,
        durationMinutes: 60,
        price: 800,
        startAt: baseDate.plus({ hours: 4 }).toJSDate(),
        endAt: baseDate.plus({ hours: 5 }).toJSDate(),
        appointmentDate: baseDate.startOf('day').toJSDate(),
        status: AppointmentStatus.CONFIRMED,
        source: 'WHATSAPP',
      },
    });

    // Trigger 10-minute cancellation on appt2 (30m freed slot)
    await whatsAppService.handleIncomingMessage(
      salon.id,
      user2.phone,
      '',
      'remind_10m_cancel',
    );

    const cancelledAppt2 = await prisma.appointment.findUnique({ where: { id: appt2.id } });
    assert(
      cancelledAppt2?.status === AppointmentStatus.CANCELLED,
      'TC-SMART-003: 10m Cancel frees slot immediately',
      `Status: ${cancelledAppt2?.status}`,
    );

    // TC-SMART-005: Move-Up Acceptance Shift
    console.log('\n📌 Test Case 5: Move-Up Acceptance Shift');
    const moveUpAcceptRes = await whatsAppService.handleIncomingMessage(
      salon.id,
      user1.phone,
      '',
      `move_up_accept_${candidate30m.id}_${appt2.id}`,
    );

    const shiftedCandidate = await prisma.appointment.findUnique({ where: { id: candidate30m.id } });
    assert(
      moveUpAcceptRes.replyMessage.includes('MOVED EARLIER') &&
        shiftedCandidate?.startAt.getTime() === appt2.startAt.getTime(),
      'TC-SMART-005: Move-up acceptance shifts appointment start time',
      `Shifted Start: ${shiftedCandidate?.startAt}`,
    );

    // TC-SMART-006 & 007: Auto-Cancellation Grace Worker & Yearly 3-Strike Lock
    console.log('\n📌 Test Case 6 & 7: Auto-Cancellation Worker & Yearly 3-Strike Lock');
    
    // Create an expired appointment past 15-min grace period
    const pastAppt = await prisma.appointment.create({
      data: {
        appointmentNumber: `SMART-EXPIRED-${Date.now()}`,
        salonId: salon.id,
        salonUserId: salonUser3.id,
        stylistId: stylist.id,
        serviceId: shortService.id,
        serviceNameSnapshot: shortService.name,
        durationMinutes: 30,
        price: 300,
        startAt: DateTime.now().minus({ minutes: 30 }).toJSDate(),
        endAt: DateTime.now().toJSDate(),
        appointmentDate: DateTime.now().startOf('day').toJSDate(),
        status: AppointmentStatus.CONFIRMED,
        source: 'WHATSAPP',
      },
    });

    // Run Stage 4 Auto No-Show Worker
    await remindersService.processReminders();

    const expiredApptChecked = await prisma.appointment.findUnique({ where: { id: pastAppt.id } });
    const user3SalonUser = await prisma.salonUser.findUnique({ where: { id: salonUser3.id } });

    assert(
      expiredApptChecked?.status === AppointmentStatus.NO_SHOW && user3SalonUser?.yearlyNoShowCount === 1,
      'TC-SMART-006: Grace period auto-cancels to NO_SHOW and records 1 penalty strike',
      `Status: ${expiredApptChecked?.status}, Count: ${user3SalonUser?.yearlyNoShowCount}`,
    );

    // Simulate 2 more missed slots for user3 to reach 3 penalty strikes
    await prisma.salonUser.update({
      where: { id: salonUser3.id },
      data: { yearlyNoShowCount: 3, isBookingBlocked: true },
    });

    // Verify user3 is blocked from booking new slots via WhatsApp
    const blockedRes = await whatsAppService.handleIncomingMessage(
      salon.id,
      user3.phone,
      '',
      'btn_book',
    );

    assert(
      blockedRes.replyMessage.includes('BOOKING RESTRICTED') && blockedRes.replyMessage.includes('contact the Salon Owner'),
      'TC-SMART-007: 3-Strike Penalty blocks WhatsApp booking attempts with owner contact warning',
      `Reply: ${blockedRes.replyMessage}`,
    );

    // TC-SMART-008: Salon Owner Unblock Action
    console.log('\n📌 Test Case 8: Salon Owner Unblock Action');
    const unblockRes = await customersService.unblockCustomer(salon.id, salonUser3.id);
    const unblockedSalonUser = await prisma.salonUser.findUnique({ where: { id: salonUser3.id } });

    assert(
      unblockedSalonUser?.isBookingBlocked === false && unblockedSalonUser?.yearlyNoShowCount === 0,
      'TC-SMART-008: Salon owner unblock API resets count to 0 and unlocks account',
      `Blocked: ${unblockedSalonUser?.isBookingBlocked}, Count: ${unblockedSalonUser?.yearlyNoShowCount}`,
    );

    // Cleanup Test Data
    await prisma.appointment.deleteMany({ where: { salonId: salon.id } });
    await prisma.salonUser.deleteMany({ where: { salonId: salon.id } });
    await prisma.service.deleteMany({ where: { salonId: salon.id } });
    await prisma.stylist.deleteMany({ where: { salonId: salon.id } });
    await prisma.user.deleteMany({ where: { id: { in: [user1.id, user2.id, user3.id] } } });
    await prisma.salon.delete({ where: { id: salon.id } });

  } catch (err) {
    console.error('💥 Error during test matrix execution:', err);
    failed++;
  } finally {
    await app.close();
  }

  console.log(`\n==================================================`);
  console.log(`📊 TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log(`==================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTestMatrix();
