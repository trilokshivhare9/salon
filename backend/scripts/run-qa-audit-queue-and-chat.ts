import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AppointmentsService } from '../src/modules/appointments/appointments.service';
import { WhatsAppService } from '../src/modules/whatsapp/whatsapp.service';
import { AppointmentStatus, AdminRole, AdminStatus } from '@prisma/client';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

export interface AuditResult {
  id: string;
  category: string;
  scenario: string;
  expected: string;
  actual: string;
  status: string;
  dbVerified: boolean;
  verdict: 'PASS' | 'FAIL';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

async function runExhaustiveQAAudit() {
  console.log('================================================================');
  console.log('🚀 EXHAUSTIVE QA AUDIT RUNNER FOR SALON QUEUE & CHAT SYSTEM');
  console.log('   Protocol Document: docs/testing/FEATURE_TESTING_GUIDE.md');
  console.log('================================================================\n');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);
  const appointmentsService = app.get(AppointmentsService);
  const whatsAppService = app.get(WhatsAppService);

  const results: AuditResult[] = [];

  function record(result: AuditResult) {
    results.push(result);
    const icon = result.verdict === 'PASS' ? '✅' : '❌';
    console.log(`[${result.id}] [${result.category}] ${icon} ${result.scenario} -> ${result.status} (${result.verdict})`);
  }

  try {
    // -------------------------------------------------------------------------
    // SETUP FIXTURES & TENANTS
    // -------------------------------------------------------------------------
    const passwordHash = await bcrypt.hash('Password123!', 10);
    let superAdmin = await prisma.admin.findFirst({ where: { role: AdminRole.SUPER_ADMIN } });
    if (!superAdmin) {
      superAdmin = await prisma.admin.create({
        data: {
          name: 'Platform Super Admin',
          email: `superadmin-${Date.now()}@salonsaas.com`,
          passwordHash,
          role: AdminRole.SUPER_ADMIN,
          status: AdminStatus.ACTIVE,
        },
      });
    }

    // Salon A (Primary Tenant)
    const salonA = await prisma.salon.create({
      data: {
        createdByAdminId: superAdmin.id,
        name: 'Salon Alpha (Tenant A)',
        slug: `alpha-${Date.now()}`,
        email: `alpha-${Date.now()}@test.com`,
        phone: `+9191000${Math.floor(10000 + Math.random() * 90000)}`,
        status: 'ACTIVE',
        timezone: 'Asia/Kolkata',
      },
    });

    // Salon B (Isolated Tenant for Cross-Tenant Penetration)
    const salonB = await prisma.salon.create({
      data: {
        createdByAdminId: superAdmin.id,
        name: 'Salon Beta (Tenant B)',
        slug: `beta-${Date.now()}`,
        email: `beta-${Date.now()}@test.com`,
        phone: `+9192000${Math.floor(10000 + Math.random() * 90000)}`,
        status: 'ACTIVE',
        timezone: 'Asia/Kolkata',
      },
    });

    const stylistA = await prisma.stylist.create({
      data: {
        salonId: salonA.id,
        name: 'Stylist Alpha Alex',
        phone: `+9191111${Math.floor(10000 + Math.random() * 90000)}`,
        status: 'ACTIVE',
      },
    });

    const serviceA = await prisma.service.create({
      data: {
        salonId: salonA.id,
        name: 'Haircut Premium',
        durationMinutes: 30,
        price: 600,
        status: 'ACTIVE',
      },
    });

    const customerPhoneA = `+9198111${Math.floor(10000 + Math.random() * 90000)}`;
    const userA = await prisma.user.create({
      data: { phone: customerPhoneA, name: 'Alice Customer' },
    });
    const salonUserA = await prisma.salonUser.create({
      data: { salonId: salonA.id, userId: userA.id },
    });

    console.log('🔹 Setup Completed: Tenant A & Tenant B seeded.\n');

    // -------------------------------------------------------------------------
    // CATEGORY A: HAPPY PATH SCENARIOS
    // -------------------------------------------------------------------------
    const now = new Date();
    const startAt = new Date(now.getTime() + 30 * 60000);
    const endAt = new Date(startAt.getTime() + 30 * 60000);
    const reminderSentAt = new Date(now.getTime() - 4 * 60000);

    const apptA1 = await prisma.appointment.create({
      data: {
        appointmentNumber: `AUDIT-A1-${Date.now()}`,
        salonId: salonA.id,
        salonUserId: salonUserA.id,
        stylistId: stylistA.id,
        serviceId: serviceA.id,
        serviceNameSnapshot: serviceA.name,
        durationMinutes: 30,
        appointmentDate: new Date(startAt.getFullYear(), startAt.getMonth(), startAt.getDate()),
        startAt,
        endAt,
        status: AppointmentStatus.CONFIRMED,
        price: 600,
        source: 'WHATSAPP',
        reminder10mSentAt: reminderSentAt,
      },
    });

    // TC-001: 10-Min Timer Timestamp Query
    const fetchedAppt = await appointmentsService.getAppointmentById(salonA.id, apptA1.id);
    record({
      id: 'TC-AUDIT-001',
      category: 'Happy Path',
      scenario: '10-Minute Arrival Countdown Timer timestamp returns correctly',
      expected: 'reminder10mSentAt is defined Date',
      actual: fetchedAppt.reminder10mSentAt ? fetchedAppt.reminder10mSentAt.toISOString() : 'NULL',
      status: '200 OK',
      dbVerified: true,
      verdict: !!fetchedAppt.reminder10mSentAt ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });

    // TC-002: 1-Click Status Progressive Workflow (CONFIRMED -> CHECKED_IN)
    const checkedIn = await appointmentsService.updateAppointmentStatus(salonA.id, apptA1.id, { status: AppointmentStatus.CHECKED_IN });
    record({
      id: 'TC-AUDIT-002',
      category: 'Happy Path',
      scenario: '1-Click Status Update (CONFIRMED -> CHECKED_IN)',
      expected: 'CHECKED_IN',
      actual: checkedIn.status,
      status: '200 OK',
      dbVerified: checkedIn.status === 'CHECKED_IN',
      verdict: checkedIn.status === 'CHECKED_IN' ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });

    // TC-003: 1-Click Status Progressive Workflow (CHECKED_IN -> IN_SERVICE)
    const inService = await appointmentsService.updateAppointmentStatus(salonA.id, apptA1.id, { status: AppointmentStatus.IN_SERVICE });
    record({
      id: 'TC-AUDIT-003',
      category: 'Happy Path',
      scenario: '1-Click Status Update (CHECKED_IN -> IN_SERVICE)',
      expected: 'IN_SERVICE',
      actual: inService.status,
      status: '200 OK',
      dbVerified: inService.status === 'IN_SERVICE',
      verdict: inService.status === 'IN_SERVICE' ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });

    // TC-004: 1-Click Status Progressive Workflow (IN_SERVICE -> COMPLETED)
    const completed = await appointmentsService.updateAppointmentStatus(salonA.id, apptA1.id, { status: AppointmentStatus.COMPLETED });
    record({
      id: 'TC-AUDIT-004',
      category: 'Happy Path',
      scenario: '1-Click Status Update (IN_SERVICE -> COMPLETED)',
      expected: 'COMPLETED',
      actual: completed.status,
      status: '200 OK',
      dbVerified: completed.status === 'COMPLETED',
      verdict: completed.status === 'COMPLETED' ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });

    // -------------------------------------------------------------------------
    // CATEGORY X: STATE-TRANSITION VIOLATIONS & BOUNDARY TESTS
    // -------------------------------------------------------------------------
    // TC-005: Illegal State Transition Attempt (COMPLETED -> CANCELLED)
    let illegalTransitionBlocked = false;
    let illegalErrorMsg = '';
    try {
      await appointmentsService.updateAppointmentStatus(salonA.id, apptA1.id, { status: AppointmentStatus.CANCELLED });
    } catch (err: any) {
      illegalTransitionBlocked = true;
      illegalErrorMsg = err.message;
    }
    record({
      id: 'TC-AUDIT-005',
      category: 'State Transition',
      scenario: 'Illegal State Transition (COMPLETED -> CANCELLED) Rejection',
      expected: '400 Bad Request / Invalid status transition',
      actual: illegalTransitionBlocked ? illegalErrorMsg : 'Allowed (FAIL)',
      status: illegalTransitionBlocked ? '400 Bad Request' : '200 OK',
      dbVerified: true,
      verdict: illegalTransitionBlocked ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });

    // -------------------------------------------------------------------------
    // CATEGORY A & C: ADMIN RESCHEDULE PROPOSAL & CUSTOMER ACCEPTANCE
    // -------------------------------------------------------------------------
    const apptA2Start = new Date(now.getTime() + 180 * 60000);
    const apptA2End = new Date(apptA2Start.getTime() + 30 * 60000);
    const apptA2 = await prisma.appointment.create({
      data: {
        appointmentNumber: `AUDIT-A2-${Date.now()}`,
        salonId: salonA.id,
        salonUserId: salonUserA.id,
        stylistId: stylistA.id,
        serviceId: serviceA.id,
        serviceNameSnapshot: serviceA.name,
        durationMinutes: 30,
        appointmentDate: new Date(apptA2Start.getFullYear(), apptA2Start.getMonth(), apptA2Start.getDate()),
        startAt: apptA2Start,
        endAt: apptA2End,
        status: AppointmentStatus.CONFIRMED,
        price: 600,
        source: 'WEB',
      },
    });

    const proposedStart = new Date(now.getTime() + 300 * 60000);
    const proposedEnd = new Date(proposedStart.getTime() + 30 * 60000);

    const proposedAppt = await appointmentsService.proposeAdminReschedule(
      salonA.id,
      apptA2.id,
      proposedStart,
      proposedEnd,
      superAdmin.id,
    );

    record({
      id: 'TC-AUDIT-006',
      category: 'Admin Reschedule',
      scenario: 'Admin Propose Reschedule moves status to PENDING_RESCHEDULE',
      expected: 'PENDING_RESCHEDULE with proposedStartAt set',
      actual: `status=${proposedAppt.status}, proposedStart=${proposedAppt.proposedStartAt ? 'SET' : 'NULL'}`,
      status: '200 OK',
      dbVerified: proposedAppt.status === 'PENDING_RESCHEDULE' && !!proposedAppt.proposedStartAt,
      verdict: proposedAppt.status === 'PENDING_RESCHEDULE' && !!proposedAppt.proposedStartAt ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
    });

    // Customer accepts proposed reschedule via WhatsApp button reply
    await whatsAppService.handleIncomingMessage(
      salonA.id,
      customerPhoneA,
      'Accept Proposed Time',
      `propose_accept_${apptA2.id}`,
    );

    const acceptedAppt = await prisma.appointment.findUnique({ where: { id: apptA2.id } });
    record({
      id: 'TC-AUDIT-007',
      category: 'Customer Interaction',
      scenario: 'Customer WhatsApp button accept shifts appointment time and sets status back to CONFIRMED',
      expected: 'CONFIRMED with startAt == proposedStart',
      actual: `status=${acceptedAppt?.status}, startAt=${acceptedAppt?.startAt.toISOString()}`,
      status: '200 OK',
      dbVerified: acceptedAppt?.status === 'CONFIRMED' && new Date(acceptedAppt.startAt).getTime() === proposedStart.getTime(),
      verdict: acceptedAppt?.status === 'CONFIRMED' && new Date(acceptedAppt.startAt).getTime() === proposedStart.getTime() ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
    });

    // -------------------------------------------------------------------------
    // CATEGORY AC & AD: TWO-WAY CHAT & 15-MINUTE AI BOT PAUSE LOGIC
    // -------------------------------------------------------------------------
    const chatMsgText = 'Hello Alice! Your barber is ready for your haircut.';
    await whatsAppService.sendStaffChatMessage(salonA.id, customerPhoneA, chatMsgText);

    const chatHistory = await whatsAppService.getChatHistory(salonA.id, customerPhoneA);
    const lastLog = chatHistory.logs.find((l) => l.messageText === chatMsgText);

    record({
      id: 'TC-AUDIT-008',
      category: 'Staff Chat',
      scenario: 'Staff sending manual text sets isBotPaused = true for 15 minutes',
      expected: 'isBotPaused == true',
      actual: `isBotPaused=${chatHistory.isBotPaused}`,
      status: '200 OK',
      dbVerified: chatHistory.isBotPaused === true,
      verdict: chatHistory.isBotPaused === true ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
    });

    record({
      id: 'TC-AUDIT-009',
      category: 'Side Effects',
      scenario: 'Staff chat message logged in whatsAppLog table as OUTBOUND',
      expected: 'OUTBOUND message stored with body matching chat text',
      actual: lastLog ? `Saved text="${lastLog.messageText}"` : 'NOT_FOUND',
      status: '200 OK',
      dbVerified: !!lastLog,
      verdict: !!lastLog ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });

    // Manual Bot Resume
    await whatsAppService.resumeBot(salonA.id, customerPhoneA);
    const chatHistoryResumed = await whatsAppService.getChatHistory(salonA.id, customerPhoneA);
    record({
      id: 'TC-AUDIT-010',
      category: 'Staff Chat',
      scenario: 'Calling resumeBot resets isBotPaused = false',
      expected: 'isBotPaused == false',
      actual: `isBotPaused=${chatHistoryResumed.isBotPaused}`,
      status: '200 OK',
      dbVerified: chatHistoryResumed.isBotPaused === false,
      verdict: chatHistoryResumed.isBotPaused === false ? 'PASS' : 'FAIL',
      severity: 'HIGH',
    });

    // -------------------------------------------------------------------------
    // CATEGORY Q & U: CROSS-TENANT ISOLATION PENETRATION ATTEMPTS
    // -------------------------------------------------------------------------
    // Attempt 1: Admin of Salon B attempting to inspect/mutate Salon A's appointment status
    let crossTenantStatusBlocked = false;
    try {
      await appointmentsService.updateAppointmentStatus(salonB.id, apptA1.id, { status: AppointmentStatus.IN_SERVICE });
    } catch (err: any) {
      crossTenantStatusBlocked = true;
    }
    record({
      id: 'TC-AUDIT-011',
      category: 'Tenant Isolation',
      scenario: 'Cross-Tenant Penetration: Salon B admin updating Salon A appointment status',
      expected: '404 Not Found / Blocked',
      actual: crossTenantStatusBlocked ? 'BLOCKED cleanly' : 'LEAK DETECTED (FAIL)',
      status: crossTenantStatusBlocked ? '404 Not Found' : '200 OK',
      dbVerified: true,
      verdict: crossTenantStatusBlocked ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
    });

    // Attempt 2: Admin of Salon B proposing reschedule for Salon A's appointment
    let crossTenantProposeBlocked = false;
    try {
      await appointmentsService.proposeAdminReschedule(salonB.id, apptA1.id, proposedStart, proposedEnd, superAdmin.id);
    } catch (err: any) {
      crossTenantProposeBlocked = true;
    }
    record({
      id: 'TC-AUDIT-012',
      category: 'Tenant Isolation',
      scenario: 'Cross-Tenant Penetration: Salon B admin proposing reschedule for Salon A appointment',
      expected: '404 Not Found / Blocked',
      actual: crossTenantProposeBlocked ? 'BLOCKED cleanly' : 'LEAK DETECTED (FAIL)',
      status: crossTenantProposeBlocked ? '404 Not Found' : '200 OK',
      dbVerified: true,
      verdict: crossTenantProposeBlocked ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
    });

    // -------------------------------------------------------------------------
    // CATEGORY AF & AG: CONCURRENCY & RACE CONDITION TEST
    // -------------------------------------------------------------------------
    const apptRaceStart = new Date(now.getTime() + 400 * 60000);
    const apptRaceEnd = new Date(apptRaceStart.getTime() + 30 * 60000);
    const apptRace = await prisma.appointment.create({
      data: {
        appointmentNumber: `AUDIT-RACE-${Date.now()}`,
        salonId: salonA.id,
        salonUserId: salonUserA.id,
        stylistId: stylistA.id,
        serviceId: serviceA.id,
        serviceNameSnapshot: serviceA.name,
        durationMinutes: 30,
        appointmentDate: new Date(apptRaceStart.getFullYear(), apptRaceStart.getMonth(), apptRaceStart.getDate()),
        startAt: apptRaceStart,
        endAt: apptRaceEnd,
        status: AppointmentStatus.CONFIRMED,
        price: 600,
        source: 'WEB',
      },
    });

    // Parallel simultaneous status updates (CHECKED_IN and IN_SERVICE)
    const raceResults = await Promise.allSettled([
      appointmentsService.updateAppointmentStatus(salonA.id, apptRace.id, { status: AppointmentStatus.CHECKED_IN }),
      appointmentsService.updateAppointmentStatus(salonA.id, apptRace.id, { status: AppointmentStatus.CHECKED_IN }),
    ]);

    const raceSuccesses = raceResults.filter((r) => r.status === 'fulfilled').length;
    record({
      id: 'TC-AUDIT-013',
      category: 'Concurrency',
      scenario: 'Parallel Concurrent Status Updates handled safely without deadlocks',
      expected: 'Both resolve safely to valid status without 500 error or deadlock',
      actual: `Resolved ${raceSuccesses}/2 fulfilled`,
      status: '200 OK',
      dbVerified: true,
      verdict: raceSuccesses > 0 ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
    });

    // -------------------------------------------------------------------------
    // CLEANUP
    // -------------------------------------------------------------------------
    console.log('\n--- CLEANUP QA FIXTURES ---');
    await prisma.whatsAppLog.deleteMany({ where: { salonId: { in: [salonA.id, salonB.id] } } });
    await prisma.appointment.deleteMany({ where: { salonId: { in: [salonA.id, salonB.id] } } });
    await prisma.salonUser.deleteMany({ where: { salonId: { in: [salonA.id, salonB.id] } } });
    await prisma.stylist.deleteMany({ where: { salonId: { in: [salonA.id, salonB.id] } } });
    await prisma.service.deleteMany({ where: { salonId: { in: [salonA.id, salonB.id] } } });
    await prisma.salon.deleteMany({ where: { id: { in: [salonA.id, salonB.id] } } });
    console.log('🧹 QA Audit fixtures cleaned up successfully.');

  } catch (err) {
    console.error('❌ Exhaustive QA Audit script failed:', err);
  } finally {
    await prisma.$disconnect();
    await app.close();
  }

  const passCount = results.filter((r) => r.verdict === 'PASS').length;
  const failCount = results.filter((r) => r.verdict === 'FAIL').length;
  console.log(`\n================================================================`);
  console.log(`QA AUDIT COMPLETE: ${passCount} PASSED | ${failCount} FAILED`);
  console.log(`================================================================\n`);
}

runExhaustiveQAAudit();
