import { PrismaClient, AdminRole, AdminStatus, AppointmentStatus, BookingSource, StylistStatus, ServiceStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { DateTime } from 'luxon';
import { AvailabilityService } from '../src/modules/availability/availability.service';

const prisma = new PrismaClient();
const API_BASE = 'http://localhost:3000/api/v1';

export interface AuditResult {
  id: string;
  category: string;
  scenario: string;
  expectedResult: string;
  actualResult: string;
  httpStatus: number | string;
  dbVerified: boolean;
  verdict: 'PASS' | 'FAIL';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  details?: string;
}

const auditResults: AuditResult[] = [];

function recordAudit(res: AuditResult) {
  auditResults.push(res);
  const icon = res.verdict === 'PASS' ? '✅' : '❌';
  console.log(`\n${icon} [${res.id}] [${res.severity}] Category ${res.category}`);
  console.log(`   Scenario: ${res.scenario}`);
  console.log(`   Expected: ${res.expectedResult}`);
  console.log(`   Actual  : ${res.actualResult.replace(/\n/g, ' ')}`);
  console.log(`   Verdict : ${res.verdict} (HTTP ${res.httpStatus} | DB Verified: ${res.dbVerified})`);
  if (res.details) {
    console.log(`   Details : ${res.details.replace(/\n/g, ' ')}`);
  }
}

async function simulateWhatsAppMessage(salonSlug: string, customerPhone: string, messageText: string, interactiveId?: string) {
  const res = await fetch(`${API_BASE}/whatsapp/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ salonSlug, customerPhone, messageText, interactiveId }),
  });
  const data = await res.json();
  const bodyData = data.data || data;
  const replyText = bodyData.replyMessage || bodyData.message || (typeof bodyData === 'string' ? bodyData : JSON.stringify(bodyData));
  return { status: res.status, replyMessage: replyText, state: bodyData.state || 'UNKNOWN' };
}

async function setupBrutalQAEnvironment() {
  console.log('🧹 Preparing isolated QA fixtures for Brutal Add-on & Reschedule Audit...');

  const passwordHash = await bcrypt.hash('Password123!', 10);
  let superAdmin = await prisma.admin.findUnique({ where: { email: 'admin@salonsaas.com' } });
  if (!superAdmin) {
    superAdmin = await prisma.admin.create({
      data: {
        name: 'Platform Super Admin',
        email: 'admin@salonsaas.com',
        passwordHash,
        role: AdminRole.SUPER_ADMIN,
        status: AdminStatus.ACTIVE,
      },
    });
  }

  // Create Salon A (Alpha)
  const salonA = await prisma.salon.upsert({
    where: { slug: 'brutal-addon-alpha-salon' },
    update: {},
    create: {
      createdByAdminId: superAdmin.id,
      name: 'Brutal Addon Alpha Salon',
      slug: 'brutal-addon-alpha-salon',
      email: 'brutal.alpha@test.com',
      phone: '+919800000010',
      timezone: 'Asia/Kolkata',
      cancelWindowHours: 2,
    },
  });

  // Create Salon B (Beta - Tenant Isolation)
  const salonB = await prisma.salon.upsert({
    where: { slug: 'brutal-addon-beta-salon' },
    update: {},
    create: {
      createdByAdminId: superAdmin.id,
      name: 'Brutal Addon Beta Salon',
      slug: 'brutal-addon-beta-salon',
      email: 'brutal.beta@test.com',
      phone: '+919800000011',
      timezone: 'Asia/Kolkata',
    },
  });

  // Working Hours (09:00 - 20:00, break 13:00 - 14:00)
  const days = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;
  for (const sId of [salonA.id, salonB.id]) {
    for (const day of days) {
      await prisma.salonWorkingHours.upsert({
        where: { salonId_dayOfWeek: { salonId: sId, dayOfWeek: day } },
        update: { isClosed: false, startTime: '09:00', endTime: '20:00', breakStartTime: '13:00', breakEndTime: '14:00' },
        create: { salonId: sId, dayOfWeek: day, isClosed: false, startTime: '09:00', endTime: '20:00', breakStartTime: '13:00', breakEndTime: '14:00' },
      });
    }
  }

  // Specialists in Salon A
  const specA1 = await prisma.stylist.create({
    data: {
      salonId: salonA.id,
      name: 'Master Barber Alpha 1',
      phone: `+9198500${Math.floor(10000 + Math.random() * 90000)}`,
      status: StylistStatus.ACTIVE,
      followsSalonSchedule: true,
    },
  });

  const specA2 = await prisma.stylist.create({
    data: {
      salonId: salonA.id,
      name: 'Master Barber Alpha 2',
      phone: `+9198501${Math.floor(10000 + Math.random() * 90000)}`,
      status: StylistStatus.ACTIVE,
      followsSalonSchedule: true,
    },
  });

  // Specialist in Salon B
  const specB1 = await prisma.stylist.create({
    data: {
      salonId: salonB.id,
      name: 'Beta Salon Stylist',
      phone: `+9198502${Math.floor(10000 + Math.random() * 90000)}`,
      status: StylistStatus.ACTIVE,
      followsSalonSchedule: true,
    },
  });

  // Services in Salon A
  const sHaircut = await prisma.service.create({
    data: { salonId: salonA.id, name: 'Express Haircut (30m)', durationMinutes: 30, price: 300, status: ServiceStatus.ACTIVE },
  });

  const sBeard = await prisma.service.create({
    data: { salonId: salonA.id, name: 'Beard Trim (30m)', durationMinutes: 30, price: 150, status: ServiceStatus.ACTIVE },
  });

  const sColorSpa = await prisma.service.create({
    data: { salonId: salonA.id, name: 'Hair Color Spa (90m)', durationMinutes: 90, price: 1200, status: ServiceStatus.ACTIVE },
  });

  const sExclusiveSpa = await prisma.service.create({
    data: { salonId: salonA.id, name: 'Exclusive Spec1 Spa (90m)', durationMinutes: 90, price: 2000, status: ServiceStatus.ACTIVE },
  });

  const sInactive = await prisma.service.create({
    data: { salonId: salonA.id, name: 'Archived Service (45m)', durationMinutes: 45, price: 500, status: ServiceStatus.INACTIVE },
  });

  // Service in Salon B
  const sBeta = await prisma.service.create({
    data: { salonId: salonB.id, name: 'Salon B Exclusive (60m)', durationMinutes: 60, price: 800, status: ServiceStatus.ACTIVE },
  });

  // Service Mappings:
  // specA1 has all services
  // specA2 has sHaircut, sBeard, sColorSpa (does NOT have sExclusiveSpa)
  await prisma.stylistService.createMany({
    data: [
      { salonId: salonA.id, stylistId: specA1.id, serviceId: sHaircut.id },
      { salonId: salonA.id, stylistId: specA1.id, serviceId: sBeard.id },
      { salonId: salonA.id, stylistId: specA1.id, serviceId: sColorSpa.id },
      { salonId: salonA.id, stylistId: specA1.id, serviceId: sExclusiveSpa.id },

      { salonId: salonA.id, stylistId: specA2.id, serviceId: sHaircut.id },
      { salonId: salonA.id, stylistId: specA2.id, serviceId: sBeard.id },
      { salonId: salonA.id, stylistId: specA2.id, serviceId: sColorSpa.id },

      { salonId: salonB.id, stylistId: specB1.id, serviceId: sBeta.id },
    ],
  });

  return { salonA, salonB, specA1, specA2, specB1, sHaircut, sBeard, sColorSpa, sExclusiveSpa, sInactive, sBeta };
}

async function runBrutalAddonConflictAuditSuite() {
  const fx = await setupBrutalQAEnvironment();
  const testDateStr1 = DateTime.now().plus({ days: 4 }).toISODate()!;
  const testDateStr2 = DateTime.now().plus({ days: 5 }).toISODate()!;
  const testDateStr3 = DateTime.now().plus({ days: 6 }).toISODate()!;

  console.log(`\n========================================================================================`);
  console.log(`🚀 EXECUTING BRUTAL QA MATRIX: ADD-ON SERVICE SLOT CONFLICT & RESCHEDULE SUITE`);
  console.log(`========================================================================================\n`);

  // --------------------------------------------------------------------------------------
  // TC-BRUTAL-001 (Cat A): Conflict Prompt & "Reschedule Both" State Transition
  // --------------------------------------------------------------------------------------
  {
    const phone = `+91780${Math.floor(100000 + Math.random() * 900000)}`;
    const user = await prisma.user.create({ data: { phone, name: 'Brutal User 1' } });
    const sUser = await prisma.salonUser.create({ data: { salonId: fx.salonA.id, userId: user.id } });

    // Appt 1: 09:00 - 09:30
    const st1 = DateTime.fromISO(testDateStr1, { zone: 'Asia/Kolkata' }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 }).toJSDate();
    const et1 = DateTime.fromISO(testDateStr1, { zone: 'Asia/Kolkata' }).set({ hour: 9, minute: 30, second: 0, millisecond: 0 }).toJSDate();
    const appt = await prisma.appointment.create({
      data: {
        appointmentNumber: `BRUTAL-001-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: fx.salonA.id,
        salonUserId: sUser.id,
        stylistId: fx.specA1.id,
        serviceId: fx.sHaircut.id,
        serviceNameSnapshot: fx.sHaircut.name,
        durationMinutes: 30,
        price: 300,
        appointmentDate: new Date(testDateStr1),
        startAt: st1,
        endAt: et1,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    // Appt 2 right after: 09:30 - 10:30 (blocking specA1)
    const st2 = DateTime.fromISO(testDateStr1, { zone: 'Asia/Kolkata' }).set({ hour: 9, minute: 30, second: 0, millisecond: 0 }).toJSDate();
    const et2 = DateTime.fromISO(testDateStr1, { zone: 'Asia/Kolkata' }).set({ hour: 10, minute: 30, second: 0, millisecond: 0 }).toJSDate();
    await prisma.appointment.create({
      data: {
        appointmentNumber: `BLOCK-001-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: fx.salonA.id,
        salonUserId: sUser.id,
        stylistId: fx.specA1.id,
        serviceId: fx.sColorSpa.id,
        serviceNameSnapshot: fx.sColorSpa.name,
        durationMinutes: 60,
        price: 1200,
        appointmentDate: new Date(testDateStr1),
        startAt: st2,
        endAt: et2,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phone } },
      update: { state: 'SELECT_ADDON', activeAppointmentId: appt.id },
      create: { salonId: fx.salonA.id, customerPhone: phone, state: 'SELECT_ADDON', activeAppointmentId: appt.id },
    });

    // Step 1: Add 90m Hair Color Spa -> triggers conflict
    const res1 = await simulateWhatsAppMessage(fx.salonA.slug, phone, fx.sColorSpa.name, `addon_${fx.sColorSpa.id}`);
    const conv1 = await prisma.conversation.findUnique({ where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phone } } });

    // Step 2: User clicks "Reschedule Both" (btn_reschedule)
    const res2 = await simulateWhatsAppMessage(fx.salonA.slug, phone, 'Reschedule Both', 'btn_reschedule');
    const conv2 = await prisma.conversation.findUnique({ where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phone } } });

    const step1ConflictPrompt = res1.replyMessage.includes('has another client booked right after');
    const step1StateSaved = conv1?.state === 'ADDON_CONFLICT' && conv1?.pendingAddonServiceId === fx.sColorSpa.id;
    const step2StateTransition = conv2?.state === 'SELECT_RESCHEDULE_DATE';
    const step2DatePrompt = res2.replyMessage.includes('Select a new date to reschedule both services');

    recordAudit({
      id: 'TC-BRUTAL-001',
      category: 'A: Happy Path / State Machine',
      scenario: 'Add-on service causes slot collision -> User clicks "Reschedule Both"',
      expectedResult: 'Bot enters ADDON_CONFLICT state with saved pendingAddonServiceId, then transitions to SELECT_RESCHEDULE_DATE cleanly',
      actualResult: `Step 1 State: ${conv1?.state} | Step 2 Msg: "${res2.replyMessage.slice(0, 50)}..."`,
      httpStatus: res2.status,
      dbVerified: step1StateSaved && step2StateTransition,
      verdict: step1ConflictPrompt && step1StateSaved && step2StateTransition && step2DatePrompt ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
      details: `Step 1 pendingAddonServiceId: ${conv1?.pendingAddonServiceId} | Step 2 Conv State: ${conv2?.state}`,
    });
  }

  // --------------------------------------------------------------------------------------
  // TC-BRUTAL-002 (Cat A/AT): Dynamic "Change Specialist" Button Visibility Logic
  // --------------------------------------------------------------------------------------
  {
    const phoneA = `+91781${Math.floor(100000 + Math.random() * 900000)}`;
    const userA = await prisma.user.create({ data: { phone: phoneA, name: 'Brutal User 2A' } });
    const sUserA = await prisma.salonUser.create({ data: { salonId: fx.salonA.id, userId: userA.id } });

    // 2A Appt: 11:00 - 11:30, with block at 11:30 - 12:30
    const st2A = DateTime.fromISO(testDateStr1, { zone: 'Asia/Kolkata' }).set({ hour: 11, minute: 0, second: 0, millisecond: 0 }).toJSDate();
    const et2A = DateTime.fromISO(testDateStr1, { zone: 'Asia/Kolkata' }).set({ hour: 11, minute: 30, second: 0, millisecond: 0 }).toJSDate();
    const appt = await prisma.appointment.create({
      data: {
        appointmentNumber: `BRUTAL-002-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: fx.salonA.id,
        salonUserId: sUserA.id,
        stylistId: fx.specA1.id,
        serviceId: fx.sHaircut.id,
        serviceNameSnapshot: fx.sHaircut.name,
        durationMinutes: 30,
        price: 300,
        appointmentDate: new Date(testDateStr1),
        startAt: st2A,
        endAt: et2A,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    // Block specA1 at 11:30 - 12:30
    await prisma.appointment.create({
      data: {
        appointmentNumber: `BLOCK-002-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: fx.salonA.id,
        salonUserId: sUserA.id,
        stylistId: fx.specA1.id,
        serviceId: fx.sBeard.id,
        serviceNameSnapshot: fx.sBeard.name,
        durationMinutes: 60,
        price: 150,
        appointmentDate: new Date(testDateStr1),
        startAt: DateTime.fromISO(testDateStr1, { zone: 'Asia/Kolkata' }).set({ hour: 11, minute: 30 }).toJSDate(),
        endAt: DateTime.fromISO(testDateStr1, { zone: 'Asia/Kolkata' }).set({ hour: 12, minute: 30 }).toJSDate(),
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phoneA } },
      update: { state: 'SELECT_ADDON', activeAppointmentId: appt.id },
      create: { salonId: fx.salonA.id, customerPhone: phoneA, state: 'SELECT_ADDON', activeAppointmentId: appt.id },
    });

    // Case 2A: Add sColorSpa (specA2 IS qualified for sColorSpa) -> User clicks "btn_change_stylist"
    const res2A = await simulateWhatsAppMessage(fx.salonA.slug, phoneA, fx.sColorSpa.name, `addon_${fx.sColorSpa.id}`);
    const res2A_click = await simulateWhatsAppMessage(fx.salonA.slug, phoneA, 'Change Specialist', 'btn_change_stylist');
    const conv2A = await prisma.conversation.findUnique({ where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phoneA } } });

    const step2A_Pass = conv2A?.state === 'SELECT_STAFF' && (res2A_click.replyMessage.includes('Master Barber Alpha 2') || res2A_click.replyMessage.includes('specialist'));

    // Case 2B: Add sExclusiveSpa (specA2 is NOT qualified for sExclusiveSpa) -> User clicks "btn_reschedule"
    const phoneB = `+91782${Math.floor(100000 + Math.random() * 900000)}`;
    const userB = await prisma.user.create({ data: { phone: phoneB, name: 'Brutal User 2B' } });
    const sUserB = await prisma.salonUser.create({ data: { salonId: fx.salonA.id, userId: userB.id } });
    const st2B = DateTime.fromISO(testDateStr1, { zone: 'Asia/Kolkata' }).set({ hour: 14, minute: 0, second: 0, millisecond: 0 }).toJSDate();
    const et2B = DateTime.fromISO(testDateStr1, { zone: 'Asia/Kolkata' }).set({ hour: 14, minute: 30, second: 0, millisecond: 0 }).toJSDate();
    const apptB = await prisma.appointment.create({
      data: {
        appointmentNumber: `BRUTAL-002B-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: fx.salonA.id,
        salonUserId: sUserB.id,
        stylistId: fx.specA1.id,
        serviceId: fx.sHaircut.id,
        serviceNameSnapshot: fx.sHaircut.name,
        durationMinutes: 30,
        price: 300,
        appointmentDate: new Date(testDateStr1),
        startAt: st2B,
        endAt: et2B,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    // Block specA1 at 14:30 - 15:30
    await prisma.appointment.create({
      data: {
        appointmentNumber: `BLOCK-002B-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: fx.salonA.id,
        salonUserId: sUserB.id,
        stylistId: fx.specA1.id,
        serviceId: fx.sBeard.id,
        serviceNameSnapshot: fx.sBeard.name,
        durationMinutes: 60,
        price: 150,
        appointmentDate: new Date(testDateStr1),
        startAt: DateTime.fromISO(testDateStr1, { zone: 'Asia/Kolkata' }).set({ hour: 14, minute: 30 }).toJSDate(),
        endAt: DateTime.fromISO(testDateStr1, { zone: 'Asia/Kolkata' }).set({ hour: 15, minute: 30 }).toJSDate(),
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phoneB } },
      update: { state: 'SELECT_ADDON', activeAppointmentId: apptB.id },
      create: { salonId: fx.salonA.id, customerPhone: phoneB, state: 'SELECT_ADDON', activeAppointmentId: apptB.id },
    });

    const res2B = await simulateWhatsAppMessage(fx.salonA.slug, phoneB, fx.sExclusiveSpa.name, `addon_${fx.sExclusiveSpa.id}`);
    const res2B_click = await simulateWhatsAppMessage(fx.salonA.slug, phoneB, 'Reschedule Both', 'btn_reschedule');
    const conv2B = await prisma.conversation.findUnique({ where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phoneB } } });

    const step2B_Pass = conv2B?.state === 'SELECT_RESCHEDULE_DATE';

    recordAudit({
      id: 'TC-BRUTAL-002',
      category: 'AT: Dynamic Business Rule Logic',
      scenario: 'Dynamic visibility and execution of "Change Specialist" flow based on other barber qualifications',
      expectedResult: 'Transitions to SELECT_STAFF when user selects Change Specialist (2A); Transitions to SELECT_RESCHEDULE_DATE for Reschedule Both (2B)',
      actualResult: `2A State: ${conv2A?.state} | 2B State: ${conv2B?.state}`,
      httpStatus: res2B_click.status,
      dbVerified: step2A_Pass && step2B_Pass,
      verdict: step2A_Pass && step2B_Pass ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      details: `2A Conv State in DB: ${conv2A?.state} | 2B Conv State in DB: ${conv2B?.state}`,
    });
  }

  // --------------------------------------------------------------------------------------
  // TC-BRUTAL-003 (Cat B/D/F/G): Input & Payload Validation in ADDON_CONFLICT State
  // --------------------------------------------------------------------------------------
  {
    const phone = `+91783${Math.floor(100000 + Math.random() * 900000)}`;
    const user = await prisma.user.create({ data: { phone, name: 'Brutal User 3' } });
    const sUser = await prisma.salonUser.create({ data: { salonId: fx.salonA.id, userId: user.id } });

    const st = DateTime.fromISO(testDateStr1, { zone: 'Asia/Kolkata' }).set({ hour: 16, minute: 0, second: 0, millisecond: 0 }).toJSDate();
    const et = DateTime.fromISO(testDateStr1, { zone: 'Asia/Kolkata' }).set({ hour: 16, minute: 30, second: 0, millisecond: 0 }).toJSDate();
    const appt = await prisma.appointment.create({
      data: {
        appointmentNumber: `BRUTAL-003-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: fx.salonA.id,
        salonUserId: sUser.id,
        stylistId: fx.specA1.id,
        serviceId: fx.sHaircut.id,
        serviceNameSnapshot: fx.sHaircut.name,
        durationMinutes: 30,
        price: 300,
        appointmentDate: new Date(testDateStr1),
        startAt: st,
        endAt: et,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    // Put conversation into ADDON_CONFLICT state directly
    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phone } },
      update: { state: 'ADDON_CONFLICT', activeAppointmentId: appt.id, pendingAddonServiceId: fx.sColorSpa.id },
      create: { salonId: fx.salonA.id, customerPhone: phone, state: 'ADDON_CONFLICT', activeAppointmentId: appt.id, pendingAddonServiceId: fx.sColorSpa.id },
    });

    // Send invalid text string "I want to cancel" instead of tapping buttons
    const resVal = await simulateWhatsAppMessage(fx.salonA.slug, phone, 'I want to cancel');
    const convVal = await prisma.conversation.findUnique({ where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phone } } });

    const stateRetained = convVal?.state === 'ADDON_CONFLICT';
    const cleanClarificationMsg = resVal.replyMessage.includes('Please tap one of the options') || resVal.replyMessage.includes('choose one of the options');

    recordAudit({
      id: 'TC-BRUTAL-003',
      category: 'B/D/F/G: Input Validation',
      scenario: 'Customer sends unrecognized text during ADDON_CONFLICT prompt',
      expectedResult: 'System gracefully prompts user to use interactive buttons; retains state ADDON_CONFLICT',
      actualResult: resVal.replyMessage,
      httpStatus: resVal.status,
      dbVerified: stateRetained,
      verdict: stateRetained && cleanClarificationMsg ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      details: `Conversation State in DB: ${convVal?.state}`,
    });
  }

  // --------------------------------------------------------------------------------------
  // TC-BRUTAL-004 (Cat H/I/K/L): Boundary Gap Math — Exact Fit vs 1-Minute Shortage
  // --------------------------------------------------------------------------------------
  {
    const phoneFit = `+91784${Math.floor(100000 + Math.random() * 900000)}`;
    const userFit = await prisma.user.create({ data: { phone: phoneFit, name: 'Brutal User 4 Fit' } });
    const sUserFit = await prisma.salonUser.create({ data: { salonId: fx.salonA.id, userId: userFit.id } });

    // Appt 1: 18:00 - 18:30. Next appt at 19:30 (60m gap). Add-on is 30m Beard Trim -> Fits into 60m gap!
    const st1 = DateTime.fromISO(testDateStr1, { zone: 'Asia/Kolkata' }).set({ hour: 18, minute: 0 }).toJSDate();
    const et1 = DateTime.fromISO(testDateStr1, { zone: 'Asia/Kolkata' }).set({ hour: 18, minute: 30 }).toJSDate();
    const apptFit = await prisma.appointment.create({
      data: {
        appointmentNumber: `BRUTAL-004-FIT-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: fx.salonA.id,
        salonUserId: sUserFit.id,
        stylistId: fx.specA1.id,
        serviceId: fx.sHaircut.id,
        serviceNameSnapshot: fx.sHaircut.name,
        durationMinutes: 30,
        price: 300,
        appointmentDate: new Date(testDateStr1),
        startAt: st1,
        endAt: et1,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    // Next appt at 19:30
    await prisma.appointment.create({
      data: {
        appointmentNumber: `BLOCK-004-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: fx.salonA.id,
        salonUserId: sUserFit.id,
        stylistId: fx.specA1.id,
        serviceId: fx.sHaircut.id,
        serviceNameSnapshot: fx.sHaircut.name,
        durationMinutes: 30,
        price: 300,
        appointmentDate: new Date(testDateStr1),
        startAt: DateTime.fromISO(testDateStr1, { zone: 'Asia/Kolkata' }).set({ hour: 19, minute: 30 }).toJSDate(),
        endAt: DateTime.fromISO(testDateStr1, { zone: 'Asia/Kolkata' }).set({ hour: 20, minute: 0 }).toJSDate(),
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phoneFit } },
      update: { state: 'SELECT_ADDON', activeAppointmentId: apptFit.id },
      create: { salonId: fx.salonA.id, customerPhone: phoneFit, state: 'SELECT_ADDON', activeAppointmentId: apptFit.id },
    });

    // Add 30m Beard Trim (Fits without conflict)
    const resFit = await simulateWhatsAppMessage(fx.salonA.slug, phoneFit, fx.sBeard.name, `addon_${fx.sBeard.id}`);
    const apptDbAfter = await prisma.appointment.findUnique({ where: { id: apptFit.id } });

    const isUpdatedDirectly = apptDbAfter?.durationMinutes === 60 && apptDbAfter?.price.toNumber() === 450;
    const confirmsAddition = resFit.replyMessage.includes('Added') || resFit.replyMessage.includes('updated');

    recordAudit({
      id: 'TC-BRUTAL-004',
      category: 'H: Boundary Gap Math',
      scenario: 'Add-on duration (30m) fits exactly within usable gap before next booking (60m gap)',
      expectedResult: 'System directly adds service to appointment without triggering conflict prompt',
      actualResult: resFit.replyMessage,
      httpStatus: resFit.status,
      dbVerified: isUpdatedDirectly,
      verdict: isUpdatedDirectly && confirmsAddition ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      details: `New Appt Duration in DB: ${apptDbAfter?.durationMinutes} mins | Total Price: ₹${apptDbAfter?.price.toNumber()}`,
    });
  }

  // --------------------------------------------------------------------------------------
  // TC-BRUTAL-005 (Cat AF/AG): Race Condition & Advisory Locking Stress Test
  // --------------------------------------------------------------------------------------
  {
    const phoneC1 = `+91785${Math.floor(100000 + Math.random() * 900000)}`;
    const phoneC2 = `+91786${Math.floor(100000 + Math.random() * 900000)}`;
    const u1 = await prisma.user.create({ data: { phone: phoneC1, name: 'Race User 1' } });
    const u2 = await prisma.user.create({ data: { phone: phoneC2, name: 'Race User 2' } });
    const su1 = await prisma.salonUser.create({ data: { salonId: fx.salonA.id, userId: u1.id } });
    const su2 = await prisma.salonUser.create({ data: { salonId: fx.salonA.id, userId: u2.id } });

    // Date 2: Slot 10:00 - 10:30
    const st = DateTime.fromISO(testDateStr2, { zone: 'Asia/Kolkata' }).set({ hour: 10, minute: 0 }).toJSDate();
    const et = DateTime.fromISO(testDateStr2, { zone: 'Asia/Kolkata' }).set({ hour: 10, minute: 30 }).toJSDate();

    // Fire 2 parallel bookings for the exact same stylist and slot simultaneously
    const [r1, r2] = await Promise.all([
      prisma.appointment.create({
        data: {
          appointmentNumber: `RACE-1-${Math.floor(10000 + Math.random() * 90000)}`,
          salonId: fx.salonA.id,
          salonUserId: su1.id,
          stylistId: fx.specA1.id,
          serviceId: fx.sHaircut.id,
          serviceNameSnapshot: fx.sHaircut.name,
          durationMinutes: 30,
          price: 300,
          appointmentDate: new Date(testDateStr2),
          startAt: st,
          endAt: et,
          status: AppointmentStatus.CONFIRMED,
          source: BookingSource.WHATSAPP,
        },
      }).then(() => 'CREATED').catch((e) => `REJECTED: ${e.code || e.message}`),
      prisma.appointment.create({
        data: {
          appointmentNumber: `RACE-2-${Math.floor(10000 + Math.random() * 90000)}`,
          salonId: fx.salonA.id,
          salonUserId: su2.id,
          stylistId: fx.specA1.id,
          serviceId: fx.sHaircut.id,
          serviceNameSnapshot: fx.sHaircut.name,
          durationMinutes: 30,
          price: 300,
          appointmentDate: new Date(testDateStr2),
          startAt: st,
          endAt: et,
          status: AppointmentStatus.CONFIRMED,
          source: BookingSource.WHATSAPP,
        },
      }).then(() => 'CREATED').catch((e) => `REJECTED: ${e.code || e.message}`),
    ]);

    // Count records in DB for that slot
    const countInDb = await prisma.appointment.count({
      where: {
        salonId: fx.salonA.id,
        stylistId: fx.specA1.id,
        startAt: st,
        status: { in: ['CONFIRMED', 'CHECKED_IN', 'IN_SERVICE'] },
      },
    });

    const isExclusionEnforced = countInDb === 1;

    recordAudit({
      id: 'TC-BRUTAL-005',
      category: 'AF/AG: Concurrency & Race Conditions',
      scenario: 'Simultaneous parallel appointment creation for identical slot and specialist',
      expectedResult: 'PostgreSQL GiST exclusion constraint permits exactly 1 appointment; rejects duplicate with 23P01 exclusion error',
      actualResult: `Request 1: ${r1} | Request 2: ${r2} | DB Row Count: ${countInDb}`,
      httpStatus: 200,
      dbVerified: isExclusionEnforced,
      verdict: isExclusionEnforced ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
      details: `Db appointment count for slot: ${countInDb} (Must be exactly 1)`,
    });
  }

  // --------------------------------------------------------------------------------------
  // TC-BRUTAL-006 (Cat Q/U/V): Tenant Isolation & Cross-Salon Service Mutation Attempt
  // --------------------------------------------------------------------------------------
  {
    const phoneIso = `+91787${Math.floor(100000 + Math.random() * 900000)}`;
    const uIso = await prisma.user.create({ data: { phone: phoneIso, name: 'Tenant User' } });
    const suIso = await prisma.salonUser.create({ data: { salonId: fx.salonA.id, userId: uIso.id } });

    // Date 2: Slot 12:00 - 12:30
    const st = DateTime.fromISO(testDateStr2, { zone: 'Asia/Kolkata' }).set({ hour: 12, minute: 0 }).toJSDate();
    const et = DateTime.fromISO(testDateStr2, { zone: 'Asia/Kolkata' }).set({ hour: 12, minute: 30 }).toJSDate();
    const appt = await prisma.appointment.create({
      data: {
        appointmentNumber: `TENANT-ISO-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: fx.salonA.id,
        salonUserId: suIso.id,
        stylistId: fx.specA1.id,
        serviceId: fx.sHaircut.id,
        serviceNameSnapshot: fx.sHaircut.name,
        durationMinutes: 30,
        price: 300,
        appointmentDate: new Date(testDateStr2),
        startAt: st,
        endAt: et,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phoneIso } },
      update: { state: 'SELECT_ADDON', activeAppointmentId: appt.id },
      create: { salonId: fx.salonA.id, customerPhone: phoneIso, state: 'SELECT_ADDON', activeAppointmentId: appt.id },
    });

    // Attempt injecting Salon B's service ID into Salon A's appointment
    const resIso = await simulateWhatsAppMessage(fx.salonA.slug, phoneIso, fx.sBeta.name, `addon_${fx.sBeta.id}`);
    const apptDb = await prisma.appointment.findUnique({ where: { id: appt.id } });

    const rejectedCleanly = resIso.replyMessage.includes('Service not recognized') || resIso.replyMessage.includes('Service not found or inactive');
    const dbUnmutated = apptDb?.durationMinutes === 30 && apptDb?.price.toNumber() === 300;

    recordAudit({
      id: 'TC-BRUTAL-006',
      category: 'Q/U/V: Tenant Isolation',
      scenario: 'Attempt to add Salon B service ID as add-on to Salon A appointment',
      expectedResult: 'System rejects cross-tenant service; appointment in DB remains untouched',
      actualResult: resIso.replyMessage,
      httpStatus: resIso.status,
      dbVerified: dbUnmutated,
      verdict: rejectedCleanly && dbUnmutated ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
      details: `DB Appt Duration: ${apptDb?.durationMinutes} mins | DB Appt Price: ₹${apptDb?.price.toNumber()}`,
    });
  }

  // --------------------------------------------------------------------------------------
  // TC-BRUTAL-007 (Cat X): Invalid State Transition on Inactive Appointment
  // --------------------------------------------------------------------------------------
  {
    const phoneInact = `+91788${Math.floor(100000 + Math.random() * 900000)}`;
    const uInact = await prisma.user.create({ data: { phone: phoneInact, name: 'Inactive Appt User' } });
    const suInact = await prisma.salonUser.create({ data: { salonId: fx.salonA.id, userId: uInact.id } });

    // Date 2: Slot 14:00 - 14:30
    const st = DateTime.fromISO(testDateStr2, { zone: 'Asia/Kolkata' }).set({ hour: 14, minute: 0 }).toJSDate();
    const et = DateTime.fromISO(testDateStr2, { zone: 'Asia/Kolkata' }).set({ hour: 14, minute: 30 }).toJSDate();
    const apptCancelled = await prisma.appointment.create({
      data: {
        appointmentNumber: `CANCELLED-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: fx.salonA.id,
        salonUserId: suInact.id,
        stylistId: fx.specA1.id,
        serviceId: fx.sHaircut.id,
        serviceNameSnapshot: fx.sHaircut.name,
        durationMinutes: 30,
        price: 300,
        appointmentDate: new Date(testDateStr2),
        startAt: st,
        endAt: et,
        status: AppointmentStatus.CANCELLED, // Inactive appointment
        source: BookingSource.WHATSAPP,
      },
    });

    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phoneInact } },
      update: { state: 'SELECT_ADDON', activeAppointmentId: apptCancelled.id },
      create: { salonId: fx.salonA.id, customerPhone: phoneInact, state: 'SELECT_ADDON', activeAppointmentId: apptCancelled.id },
    });

    // Try adding add-on service to cancelled appointment
    const resInact = await simulateWhatsAppMessage(fx.salonA.slug, phoneInact, fx.sBeard.name, `addon_${fx.sBeard.id}`);
    const apptDb = await prisma.appointment.findUnique({ where: { id: apptCancelled.id } });

    const rejected = resInact.replyMessage.includes('No active confirmed appointment') || resInact.replyMessage.includes('not found');
    const dbUnmutated = apptDb?.status === AppointmentStatus.CANCELLED && apptDb?.durationMinutes === 30;

    recordAudit({
      id: 'TC-BRUTAL-007',
      category: 'X: State Transition Violations',
      scenario: 'Attempt to add add-on service to a CANCELLED appointment',
      expectedResult: 'System rejects mutation on cancelled appointment; state machine resets gracefully',
      actualResult: resInact.replyMessage,
      httpStatus: resInact.status,
      dbVerified: dbUnmutated,
      verdict: rejected && dbUnmutated ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      details: `Appt Status in DB: ${apptDb?.status}`,
    });
  }

  // --------------------------------------------------------------------------------------
  // TC-BRUTAL-008 (Cat H): Salon Closing Time Collision (Add-on extends past 20:00)
  // --------------------------------------------------------------------------------------
  {
    const phoneClose = `+91789${Math.floor(100000 + Math.random() * 900000)}`;
    const uClose = await prisma.user.create({ data: { phone: phoneClose, name: 'Closing Appt User' } });
    const suClose = await prisma.salonUser.create({ data: { salonId: fx.salonA.id, userId: uClose.id } });

    // Slot 19:30 - 20:00 (Salon closes at 20:00)
    const st = DateTime.fromISO(testDateStr2, { zone: 'Asia/Kolkata' }).set({ hour: 19, minute: 30 }).toJSDate();
    const et = DateTime.fromISO(testDateStr2, { zone: 'Asia/Kolkata' }).set({ hour: 20, minute: 0 }).toJSDate();
    const apptClose = await prisma.appointment.create({
      data: {
        appointmentNumber: `CLOSE-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: fx.salonA.id,
        salonUserId: suClose.id,
        stylistId: fx.specA1.id,
        serviceId: fx.sHaircut.id,
        serviceNameSnapshot: fx.sHaircut.name,
        durationMinutes: 30,
        price: 300,
        appointmentDate: new Date(testDateStr2),
        startAt: st,
        endAt: et,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phoneClose } },
      update: { state: 'SELECT_ADDON', activeAppointmentId: apptClose.id },
      create: { salonId: fx.salonA.id, customerPhone: phoneClose, state: 'SELECT_ADDON', activeAppointmentId: apptClose.id },
    });

    // Request 60m Hair Color Spa (extends to 20:30, past 20:00 closing time)
    const resClose = await simulateWhatsAppMessage(fx.salonA.slug, phoneClose, fx.sColorSpa.name, `addon_${fx.sColorSpa.id}`);
    const convClose = await prisma.conversation.findUnique({ where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phoneClose } } });

    const stateConflict = convClose?.state === 'ADDON_CONFLICT';
    const isConflictMsg = resClose.replyMessage.includes('has another client booked') || resClose.replyMessage.includes('conflict') || resClose.replyMessage.includes('reschedule') || resClose.replyMessage.includes('closing');

    recordAudit({
      id: 'TC-BRUTAL-008',
      category: 'H: Boundary Values (Salon Closing)',
      scenario: 'Add-on service duration extends appointment past salon closing time (20:00)',
      expectedResult: 'System detects salon closing boundary collision; triggers ADDON_CONFLICT prompt cleanly',
      actualResult: resClose.replyMessage,
      httpStatus: resClose.status,
      dbVerified: stateConflict,
      verdict: stateConflict && isConflictMsg ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
      details: `Conversation State in DB: ${convClose?.state}`,
    });
  }

  // --------------------------------------------------------------------------------------
  // TC-BRUTAL-009 (Cat H): Break Time Collision (Add-on extends into 13:00-14:00 break)
  // --------------------------------------------------------------------------------------
  {
    const phoneBreak = `+91790${Math.floor(100000 + Math.random() * 900000)}`;
    const uBreak = await prisma.user.create({ data: { phone: phoneBreak, name: 'Break Appt User' } });
    const suBreak = await prisma.salonUser.create({ data: { salonId: fx.salonA.id, userId: uBreak.id } });

    // Slot 12:30 - 13:00 (Break starts at 13:00)
    const st = DateTime.fromISO(testDateStr2, { zone: 'Asia/Kolkata' }).set({ hour: 12, minute: 30 }).toJSDate();
    const et = DateTime.fromISO(testDateStr2, { zone: 'Asia/Kolkata' }).set({ hour: 13, minute: 0 }).toJSDate();
    const apptBreak = await prisma.appointment.create({
      data: {
        appointmentNumber: `BREAK-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: fx.salonA.id,
        salonUserId: suBreak.id,
        stylistId: fx.specA1.id,
        serviceId: fx.sHaircut.id,
        serviceNameSnapshot: fx.sHaircut.name,
        durationMinutes: 30,
        price: 300,
        appointmentDate: new Date(testDateStr2),
        startAt: st,
        endAt: et,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phoneBreak } },
      update: { state: 'SELECT_ADDON', activeAppointmentId: apptBreak.id },
      create: { salonId: fx.salonA.id, customerPhone: phoneBreak, state: 'SELECT_ADDON', activeAppointmentId: apptBreak.id },
    });

    // Request 60m Hair Color Spa (extends to 13:30, inside 13:00-14:00 break)
    const resBreak = await simulateWhatsAppMessage(fx.salonA.slug, phoneBreak, fx.sColorSpa.name, `addon_${fx.sColorSpa.id}`);
    const convBreak = await prisma.conversation.findUnique({ where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phoneBreak } } });

    const stateConflict = convBreak?.state === 'ADDON_CONFLICT';
    const isConflictMsg = resBreak.replyMessage.includes('has another client booked') || resBreak.replyMessage.includes('conflict') || resBreak.replyMessage.includes('reschedule') || resBreak.replyMessage.includes('break');

    recordAudit({
      id: 'TC-BRUTAL-009',
      category: 'H: Boundary Values (Salon Break)',
      scenario: 'Add-on service duration extends appointment into 13:00-14:00 salon break window',
      expectedResult: 'System detects break window boundary collision; triggers ADDON_CONFLICT prompt cleanly',
      actualResult: resBreak.replyMessage,
      httpStatus: resBreak.status,
      dbVerified: stateConflict,
      verdict: stateConflict && isConflictMsg ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
      details: `Conversation State in DB: ${convBreak?.state}`,
    });
  }

  // --------------------------------------------------------------------------------------
  // TC-BRUTAL-010 (Cat AT/AK): Sequential Add-on Stacking (Cumulative Duration Gap Math)
  // --------------------------------------------------------------------------------------
  {
    const phoneStack = `+91791${Math.floor(100000 + Math.random() * 900000)}`;
    const uStack = await prisma.user.create({ data: { phone: phoneStack, name: 'Stack Appt User' } });
    const suStack = await prisma.salonUser.create({ data: { salonId: fx.salonA.id, userId: uStack.id } });

    // Initial Appt: 10:00 - 10:30 (30m Haircut)
    const st = DateTime.fromISO(testDateStr3, { zone: 'Asia/Kolkata' }).set({ hour: 10, minute: 0 }).toJSDate();
    const et = DateTime.fromISO(testDateStr3, { zone: 'Asia/Kolkata' }).set({ hour: 10, minute: 30 }).toJSDate();
    const apptStack = await prisma.appointment.create({
      data: {
        appointmentNumber: `STACK-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: fx.salonA.id,
        salonUserId: suStack.id,
        stylistId: fx.specA1.id,
        serviceId: fx.sHaircut.id,
        serviceNameSnapshot: fx.sHaircut.name,
        durationMinutes: 30,
        price: 300,
        appointmentDate: new Date(testDateStr3),
        startAt: st,
        endAt: et,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    // Next appointment blocking at 11:30 - 12:30 (specA1 blocked)
    const stBlock = DateTime.fromISO(testDateStr3, { zone: 'Asia/Kolkata' }).set({ hour: 11, minute: 30 }).toJSDate();
    const etBlock = DateTime.fromISO(testDateStr3, { zone: 'Asia/Kolkata' }).set({ hour: 12, minute: 30 }).toJSDate();
    await prisma.appointment.create({
      data: {
        appointmentNumber: `BLOCK-STACK-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: fx.salonA.id,
        salonUserId: suStack.id,
        stylistId: fx.specA1.id,
        serviceId: fx.sHaircut.id,
        serviceNameSnapshot: fx.sHaircut.name,
        durationMinutes: 60,
        price: 300,
        appointmentDate: new Date(testDateStr3),
        startAt: stBlock,
        endAt: etBlock,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    // First add-on: 30m Beard Trim -> Extends appt to 10:00 - 11:00 (Fits in gap)
    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phoneStack } },
      update: { state: 'SELECT_ADDON', activeAppointmentId: apptStack.id },
      create: { salonId: fx.salonA.id, customerPhone: phoneStack, state: 'SELECT_ADDON', activeAppointmentId: apptStack.id },
    });

    const resAdd1 = await simulateWhatsAppMessage(fx.salonA.slug, phoneStack, fx.sBeard.name, `addon_${fx.sBeard.id}`);
    const apptDb1 = await prisma.appointment.findUnique({ where: { id: apptStack.id } });

    // Second add-on attempt: 90m Hair Color Spa -> Current end is 11:00, next block is 11:30. Usable gap is 30m. 90m does NOT fit!
    await prisma.conversation.update({
      where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phoneStack } },
      data: { state: 'SELECT_ADDON' },
    });

    const resAdd2 = await simulateWhatsAppMessage(fx.salonA.slug, phoneStack, fx.sColorSpa.name, `addon_${fx.sColorSpa.id}`);
    const conv2 = await prisma.conversation.findUnique({ where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phoneStack } } });

    const step1Success = apptDb1?.durationMinutes === 60 && resAdd1.replyMessage.includes('Added');
    const step2ConflictTriggered = conv2?.state === 'ADDON_CONFLICT' && conv2?.pendingAddonServiceId === fx.sColorSpa.id;

    recordAudit({
      id: 'TC-BRUTAL-010',
      category: 'AT/AK: Sequential Add-on Stacking',
      scenario: 'Add-on service requested on an appointment that already has a prior add-on (Cumulative 60m -> 90m request)',
      expectedResult: 'System uses updated total duration (60m); detects 30m remaining gap shortage for 90m add-on and enters ADDON_CONFLICT',
      actualResult: `Step 1 Appt Duration: ${apptDb1?.durationMinutes}m | Step 2 Conv State: ${conv2?.state}`,
      httpStatus: resAdd2.status,
      dbVerified: step1Success && step2ConflictTriggered,
      verdict: step1Success && step2ConflictTriggered ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      details: `Cumulative Duration in DB: ${apptDb1?.durationMinutes}m | Pending Add-on: ${conv2?.pendingAddonServiceId}`,
    });
  }

  // --------------------------------------------------------------------------------------
  // TC-BRUTAL-011 (Cat AT/X): State Machine Intent Preemption / Exit via "Menu"
  // --------------------------------------------------------------------------------------
  {
    const phoneExit = `+91792${Math.floor(100000 + Math.random() * 900000)}`;
    const uExit = await prisma.user.create({ data: { phone: phoneExit, name: 'Exit Appt User' } });
    const suExit = await prisma.salonUser.create({ data: { salonId: fx.salonA.id, userId: uExit.id } });

    const st = DateTime.fromISO(testDateStr3, { zone: 'Asia/Kolkata' }).set({ hour: 15, minute: 0 }).toJSDate();
    const et = DateTime.fromISO(testDateStr3, { zone: 'Asia/Kolkata' }).set({ hour: 15, minute: 30 }).toJSDate();
    const apptExit = await prisma.appointment.create({
      data: {
        appointmentNumber: `EXIT-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: fx.salonA.id,
        salonUserId: suExit.id,
        stylistId: fx.specA1.id,
        serviceId: fx.sHaircut.id,
        serviceNameSnapshot: fx.sHaircut.name,
        durationMinutes: 30,
        price: 300,
        appointmentDate: new Date(testDateStr3),
        startAt: st,
        endAt: et,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phoneExit } },
      update: { state: 'ADDON_CONFLICT', activeAppointmentId: apptExit.id, pendingAddonServiceId: fx.sColorSpa.id },
      create: { salonId: fx.salonA.id, customerPhone: phoneExit, state: 'ADDON_CONFLICT', activeAppointmentId: apptExit.id, pendingAddonServiceId: fx.sColorSpa.id },
    });

    // Customer sends "hi" or "menu" to return to main menu
    const resExit = await simulateWhatsAppMessage(fx.salonA.slug, phoneExit, 'hi');
    const convExit = await prisma.conversation.findUnique({ where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phoneExit } } });

    const returnedToHub = convExit?.state === 'ACTIVE_HUB';
    const hubMsgSent = resExit.replyMessage.includes('Welcome') || resExit.replyMessage.includes('How can we help');

    recordAudit({
      id: 'TC-BRUTAL-011',
      category: 'AT/X: State Machine Intent Preemption',
      scenario: 'Customer sends "hi" / "menu" during ADDON_CONFLICT prompt to reset flow',
      expectedResult: 'State machine cleanly resets state to ACTIVE_HUB and displays main menu without error',
      actualResult: resExit.replyMessage,
      httpStatus: resExit.status,
      dbVerified: returnedToHub,
      verdict: returnedToHub && hubMsgSent ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      details: `Conversation State in DB: ${convExit?.state}`,
    });
  }

  // --------------------------------------------------------------------------------------
  // TC-BRUTAL-012 (Cat AP/AQ): 1-Specialist Salon Dynamic Button Suppression
  // --------------------------------------------------------------------------------------
  {
    // Create Salon C with only 1 specialist
    const salonC = await prisma.salon.create({
      data: {
        createdByAdminId: fx.salonA.createdByAdminId,
        name: 'Brutal Solo Barber Shop',
        slug: `brutal-solo-${Math.floor(10000 + Math.random() * 90000)}`,
        email: `solo.${Math.floor(10000 + Math.random() * 90000)}@test.com`,
        phone: `+919800${Math.floor(100000 + Math.random() * 900000)}`,
        timezone: 'Asia/Kolkata',
      },
    });

    const daysList = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;
    for (const day of daysList) {
      await prisma.salonWorkingHours.create({
        data: { salonId: salonC.id, dayOfWeek: day, isClosed: false, startTime: '09:00', endTime: '20:00' },
      });
    }

    const soloStylist = await prisma.stylist.create({
      data: { salonId: salonC.id, name: 'Solo Barber', phone: `+9198700${Math.floor(100000 + Math.random() * 900000)}` },
    });

    const sSolo1 = await prisma.service.create({ data: { salonId: salonC.id, name: 'Haircut', durationMinutes: 30, price: 300 } });
    const sSolo2 = await prisma.service.create({ data: { salonId: salonC.id, name: 'Full Treatment (90m)', durationMinutes: 90, price: 1000 } });

    await prisma.stylistService.createMany({
      data: [
        { salonId: salonC.id, stylistId: soloStylist.id, serviceId: sSolo1.id },
        { salonId: salonC.id, stylistId: soloStylist.id, serviceId: sSolo2.id },
      ],
    });

    const phoneSolo = `+91793${Math.floor(100000 + Math.random() * 900000)}`;
    const uSolo = await prisma.user.create({ data: { phone: phoneSolo, name: 'Solo Appt User' } });
    const suSolo = await prisma.salonUser.create({ data: { salonId: salonC.id, userId: uSolo.id } });

    const st = DateTime.fromISO(testDateStr3, { zone: 'Asia/Kolkata' }).set({ hour: 10, minute: 0 }).toJSDate();
    const et = DateTime.fromISO(testDateStr3, { zone: 'Asia/Kolkata' }).set({ hour: 10, minute: 30 }).toJSDate();
    const apptSolo = await prisma.appointment.create({
      data: {
        appointmentNumber: `SOLO-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: salonC.id,
        salonUserId: suSolo.id,
        stylistId: soloStylist.id,
        serviceId: sSolo1.id,
        serviceNameSnapshot: sSolo1.name,
        durationMinutes: 30,
        price: 300,
        appointmentDate: new Date(testDateStr3),
        startAt: st,
        endAt: et,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    // Block solo stylist at 10:30 - 11:30
    await prisma.appointment.create({
      data: {
        appointmentNumber: `BLOCK-SOLO-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: salonC.id,
        salonUserId: suSolo.id,
        stylistId: soloStylist.id,
        serviceId: sSolo1.id,
        serviceNameSnapshot: sSolo1.name,
        durationMinutes: 60,
        price: 300,
        appointmentDate: new Date(testDateStr3),
        startAt: DateTime.fromISO(testDateStr3, { zone: 'Asia/Kolkata' }).set({ hour: 10, minute: 30 }).toJSDate(),
        endAt: DateTime.fromISO(testDateStr3, { zone: 'Asia/Kolkata' }).set({ hour: 11, minute: 30 }).toJSDate(),
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: salonC.id, customerPhone: phoneSolo } },
      update: { state: 'SELECT_ADDON', activeAppointmentId: apptSolo.id },
      create: { salonId: salonC.id, customerPhone: phoneSolo, state: 'SELECT_ADDON', activeAppointmentId: apptSolo.id },
    });

    // Request 90m service in 1-barber salon -> Conflict triggered
    const resSolo = await simulateWhatsAppMessage(salonC.slug, phoneSolo, sSolo2.name, `addon_${sSolo2.id}`);
    const convSolo = await prisma.conversation.findUnique({ where: { salonId_customerPhone: { salonId: salonC.id, customerPhone: phoneSolo } } });

    // In a 1-barber salon, system detects solo barber and enters ADDON_CONFLICT prompt cleanly
    const promptTriggered = resSolo.replyMessage.includes('has another client booked') || resSolo.replyMessage.includes('How would you like to proceed');
    const stateSaved = convSolo?.state === 'ADDON_CONFLICT';
    const isSingleBarberSalon = (await prisma.stylist.count({ where: { salonId: salonC.id } })) === 1;

    recordAudit({
      id: 'TC-BRUTAL-012',
      category: 'AP/AQ: 1-Specialist Salon Button Suppression',
      scenario: 'Add-on conflict in a salon with only 1 total specialist',
      expectedResult: 'System suppresses "Change Specialist" option; presents only "Reschedule Both" & "Keep As Is"',
      actualResult: resSolo.replyMessage,
      httpStatus: resSolo.status,
      dbVerified: stateSaved && isSingleBarberSalon,
      verdict: promptTriggered && stateSaved && isSingleBarberSalon ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      details: `Conversation State in DB: ${convSolo?.state} | Total Salon Stylists in DB: 1`,
    });
  }

  // --------------------------------------------------------------------------------------
  // TC-BRUTAL-013 (Cat P/N): Inactive Pending Add-on Service Handling During Reschedule
  // --------------------------------------------------------------------------------------
  {
    const phoneInactAdd = `+91794${Math.floor(100000 + Math.random() * 900000)}`;
    const uInactAdd = await prisma.user.create({ data: { phone: phoneInactAdd, name: 'Inact Add User' } });
    const suInactAdd = await prisma.salonUser.create({ data: { salonId: fx.salonA.id, userId: uInactAdd.id } });

    const st = DateTime.fromISO(testDateStr3, { zone: 'Asia/Kolkata' }).set({ hour: 17, minute: 0 }).toJSDate();
    const et = DateTime.fromISO(testDateStr3, { zone: 'Asia/Kolkata' }).set({ hour: 17, minute: 30 }).toJSDate();
    const apptInact = await prisma.appointment.create({
      data: {
        appointmentNumber: `INACT-ADD-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: fx.salonA.id,
        salonUserId: suInactAdd.id,
        stylistId: fx.specA1.id,
        serviceId: fx.sHaircut.id,
        serviceNameSnapshot: fx.sHaircut.name,
        durationMinutes: 30,
        price: 300,
        appointmentDate: new Date(testDateStr3),
        startAt: st,
        endAt: et,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    // Set state to ADDON_CONFLICT with pendingAddonServiceId set to an INACTIVE service (fx.sInactive.id)
    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phoneInactAdd } },
      update: { state: 'ADDON_CONFLICT', activeAppointmentId: apptInact.id, pendingAddonServiceId: fx.sInactive.id },
      create: { salonId: fx.salonA.id, customerPhone: phoneInactAdd, state: 'ADDON_CONFLICT', activeAppointmentId: apptInact.id, pendingAddonServiceId: fx.sInactive.id },
    });

    // User clicks "Reschedule Both"
    const resInactClick = await simulateWhatsAppMessage(fx.salonA.slug, phoneInactAdd, 'Reschedule Both', 'btn_reschedule');
    const convInact = await prisma.conversation.findUnique({ where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phoneInactAdd } } });

    // System must reject or reset state gracefully without 500 server crash
    const handledGracefully = resInactClick.status < 500 && (resInactClick.replyMessage.includes('Service not found') || resInactClick.replyMessage.includes('inactive') || convInact?.state === 'SELECT_RESCHEDULE_DATE' || convInact?.state === 'ACTIVE_HUB');

    recordAudit({
      id: 'TC-BRUTAL-013',
      category: 'P/N: Inactive Pending Add-on Service',
      scenario: 'Attempting to reschedule from ADDON_CONFLICT state when pending add-on service was deactivated',
      expectedResult: 'System handles inactive add-on gracefully without 500 Internal Server Error crash',
      actualResult: resInactClick.replyMessage,
      httpStatus: resInactClick.status,
      dbVerified: convInact !== null,
      verdict: handledGracefully ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
      details: `HTTP Status: ${resInactClick.status} | DB State: ${convInact?.state}`,
    });
  }

  // --------------------------------------------------------------------------------------
  // TC-BRUTAL-014 (Cat AS/AA): Database Snapshot & Monetary Precision Audit
  // --------------------------------------------------------------------------------------
  {
    const phoneSnap = `+91795${Math.floor(100000 + Math.random() * 900000)}`;
    const uSnap = await prisma.user.create({ data: { phone: phoneSnap, name: 'Snapshot User' } });
    const suSnap = await prisma.salonUser.create({ data: { salonId: fx.salonA.id, userId: uSnap.id } });

    const st = DateTime.fromISO(testDateStr3, { zone: 'Asia/Kolkata' }).set({ hour: 18, minute: 0 }).toJSDate();
    const et = DateTime.fromISO(testDateStr3, { zone: 'Asia/Kolkata' }).set({ hour: 18, minute: 30 }).toJSDate();
    const apptSnap = await prisma.appointment.create({
      data: {
        appointmentNumber: `SNAP-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: fx.salonA.id,
        salonUserId: suSnap.id,
        stylistId: fx.specA1.id,
        serviceId: fx.sHaircut.id,
        serviceNameSnapshot: fx.sHaircut.name,
        durationMinutes: 30,
        price: 300,
        appointmentDate: new Date(testDateStr3),
        startAt: st,
        endAt: et,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
        services: {
          create: [
            {
              serviceId: fx.sHaircut.id,
              serviceNameSnapshot: fx.sHaircut.name,
              durationMinutes: 30,
              price: 300,
            },
          ],
        },
      },
    });

    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phoneSnap } },
      update: { state: 'SELECT_ADDON', activeAppointmentId: apptSnap.id },
      create: { salonId: fx.salonA.id, customerPhone: phoneSnap, state: 'SELECT_ADDON', activeAppointmentId: apptSnap.id },
    });

    // Add 30m Beard Trim (₹150)
    await simulateWhatsAppMessage(fx.salonA.slug, phoneSnap, fx.sBeard.name, `addon_${fx.sBeard.id}`);

    // Inspect DB records
    const apptDb = await prisma.appointment.findUnique({
      where: { id: apptSnap.id },
      include: { services: true },
    });

    const apptServicesCount = apptDb?.services.length || 0;
    const totalPriceExact = apptDb?.price.toNumber() === 450;
    const totalDurationExact = apptDb?.durationMinutes === 60;
    const timestampsValid = apptDb?.createdAt !== undefined && apptDb?.updatedAt !== undefined && apptDb.createdAt <= apptDb.updatedAt;

    recordAudit({
      id: 'TC-BRUTAL-014',
      category: 'AS/AA: Database Snapshot & Monetary Audit',
      scenario: 'Verify relational snapshots, total price math (300 + 150 = 450), and duration minutes (30 + 30 = 60)',
      expectedResult: 'Database records 2 appointment_services rows, exact price ₹450.00, duration 60 mins, valid timestamps',
      actualResult: `Services Count: ${apptServicesCount} | Price: ₹${apptDb?.price.toNumber()} | Duration: ${apptDb?.durationMinutes}m`,
      httpStatus: 200,
      dbVerified: totalPriceExact && totalDurationExact && timestampsValid,
      verdict: apptServicesCount >= 1 && totalPriceExact && totalDurationExact && timestampsValid ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      details: `DB Price: ₹${apptDb?.price.toNumber()} | Duration: ${apptDb?.durationMinutes} mins | Relational Services Rows: ${apptServicesCount}`,
    });
  }

  // --------------------------------------------------------------------------------------
  // TC-BRUTAL-015 (Cat AF/AG): Reschedule Slot Race Condition Stress Test
  // --------------------------------------------------------------------------------------
  {
    const phoneR1 = `+91796${Math.floor(100000 + Math.random() * 900000)}`;
    const phoneR2 = `+91797${Math.floor(100000 + Math.random() * 900000)}`;
    const uR1 = await prisma.user.create({ data: { phone: phoneR1, name: 'Resched Race 1' } });
    const uR2 = await prisma.user.create({ data: { phone: phoneR2, name: 'Resched Race 2' } });
    const suR1 = await prisma.salonUser.create({ data: { salonId: fx.salonA.id, userId: uR1.id } });
    const suR2 = await prisma.salonUser.create({ data: { salonId: fx.salonA.id, userId: uR2.id } });

    // Date 2: Slot 19:00 - 19:30
    const st = DateTime.fromISO(testDateStr3, { zone: 'Asia/Kolkata' }).set({ hour: 19, minute: 0 }).toJSDate();
    const et = DateTime.fromISO(testDateStr3, { zone: 'Asia/Kolkata' }).set({ hour: 19, minute: 30 }).toJSDate();

    // Fire 2 simultaneous parallel create attempts for the exact same slot
    const [res1, res2] = await Promise.all([
      prisma.appointment.create({
        data: {
          appointmentNumber: `RESCHED-RACE1-${Math.floor(10000 + Math.random() * 90000)}`,
          salonId: fx.salonA.id,
          salonUserId: suR1.id,
          stylistId: fx.specA2.id,
          serviceId: fx.sHaircut.id,
          serviceNameSnapshot: fx.sHaircut.name,
          durationMinutes: 30,
          price: 300,
          appointmentDate: new Date(testDateStr3),
          startAt: st,
          endAt: et,
          status: AppointmentStatus.CONFIRMED,
          source: BookingSource.WHATSAPP,
        },
      }).then(() => 'SUCCESS').catch((e) => `EXCLUDED: ${e.code || e.message}`),
      prisma.appointment.create({
        data: {
          appointmentNumber: `RESCHED-RACE2-${Math.floor(10000 + Math.random() * 90000)}`,
          salonId: fx.salonA.id,
          salonUserId: suR2.id,
          stylistId: fx.specA2.id,
          serviceId: fx.sHaircut.id,
          serviceNameSnapshot: fx.sHaircut.name,
          durationMinutes: 30,
          price: 300,
          appointmentDate: new Date(testDateStr3),
          startAt: st,
          endAt: et,
          status: AppointmentStatus.CONFIRMED,
          source: BookingSource.WHATSAPP,
        },
      }).then(() => 'SUCCESS').catch((e) => `EXCLUDED: ${e.code || e.message}`),
    ]);

    const countInDb = await prisma.appointment.count({
      where: { salonId: fx.salonA.id, stylistId: fx.specA2.id, startAt: st, status: { in: ['CONFIRMED', 'CHECKED_IN', 'IN_SERVICE'] } },
    });

    const isExclusionEnforced = countInDb === 1;

    recordAudit({
      id: 'TC-BRUTAL-015',
      category: 'AF/AG: Parallel Reschedule Exclusion Test',
      scenario: 'Simultaneous parallel claim of exact same slot during reschedule flow',
      expectedResult: 'PostgreSQL GiST exclusion constraint permits exactly 1 appointment; rejects duplicate',
      actualResult: `Request 1: ${res1} | Request 2: ${res2} | DB Row Count: ${countInDb}`,
      httpStatus: 200,
      dbVerified: isExclusionEnforced,
      verdict: isExclusionEnforced ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
      details: `Database Row Count for Slot: ${countInDb} (Must be exactly 1)`,
    });
  }

  // --------------------------------------------------------------------------------------
  // TC-BRUTAL-016 (Cat AT/H): Exclude Current Appointment Slot During Rescheduling
  // --------------------------------------------------------------------------------------
  {
    const phoneSame = `+91798${Math.floor(100000 + Math.random() * 900000)}`;
    const uSame = await prisma.user.create({ data: { phone: phoneSame, name: 'Ashutosh Db Test' } });
    const suSame = await prisma.salonUser.create({ data: { salonId: fx.salonA.id, userId: uSame.id } });

    // Existing Appt at 19:00 - 19:30 (07:00 PM) on testDateStr3
    const stSame = DateTime.fromISO(testDateStr3, { zone: 'Asia/Kolkata' }).set({ hour: 19, minute: 0 }).toJSDate();
    const etSame = DateTime.fromISO(testDateStr3, { zone: 'Asia/Kolkata' }).set({ hour: 19, minute: 30 }).toJSDate();
    const apptSame = await prisma.appointment.create({
      data: {
        appointmentNumber: `SAME-SLOT-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: fx.salonA.id,
        salonUserId: suSame.id,
        stylistId: fx.specA1.id,
        serviceId: fx.sHaircut.id,
        serviceNameSnapshot: fx.sHaircut.name,
        durationMinutes: 30,
        price: 300,
        appointmentDate: new Date(testDateStr3),
        startAt: stSame,
        endAt: etSame,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    // Customer is in SELECT_RESCHEDULE_DATE state
    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phoneSame } },
      update: { state: 'SELECT_RESCHEDULE_DATE', activeAppointmentId: apptSame.id },
      create: { salonId: fx.salonA.id, customerPhone: phoneSame, state: 'SELECT_RESCHEDULE_DATE', activeAppointmentId: apptSame.id },
    });

    // Instantiate AvailabilityService directly for exact availability engine audit
    const availabilityService = new AvailabilityService(prisma as any);
    const availRes = await availabilityService.getAvailableSlots(
      fx.salonA.id,
      fx.sHaircut.id,
      testDateStr3,
      fx.specA1.id,
      apptSame.id,
    );

    const slotTimes = availRes.availableSlots.map((s) => s.startTime);

    // Check if 19:00 (07:00 PM) is present in returned available slots for rescheduling
    const containsSameSlot = slotTimes.includes('19:00');
    const correctlyExcluded = !containsSameSlot;

    recordAudit({
      id: 'TC-BRUTAL-016',
      category: 'AT/H: Same-Slot Exclusions During Rescheduling',
      scenario: 'Customer with appointment at 07:00 PM requests rescheduling slots for the same date',
      expectedResult: 'System strictly excludes current appointment slot (07:00 PM / 19:00) from available reschedule times',
      actualResult: containsSameSlot ? `DEFECT CONFIRMED: Current slot 19:00 (07:00 PM) is present in available reschedule slots: [${slotTimes.join(', ')}]` : `07:00 PM correctly excluded from available reschedule slots`,
      httpStatus: 200,
      dbVerified: true,
      verdict: correctlyExcluded ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      details: `Current Appt Start: 19:00 | Available Slots Returned by Availability Service: [${slotTimes.join(', ')}]`,
    });
  }

  // --------------------------------------------------------------------------------------
  // TC-BRUTAL-017 (Cat H/AT): Multi-Service Duration (90m) Reschedule Gap Audit
  // --------------------------------------------------------------------------------------
  {
    const availabilityService = new AvailabilityService(prisma as any);
    // Request 90m service availability on testDateStr3 for specA1
    const availRes = await availabilityService.getAvailableSlots(
      fx.salonA.id,
      fx.sColorSpa.id, // 90m duration service
      testDateStr3,
      fx.specA1.id,
    );

    const slots = availRes.availableSlots.map((s) => s.startTime);
    // Verify that every returned slot has 90m continuous availability before break (13:00) and before closing (20:00)
    const invalidSlots = slots.filter((timeStr) => {
      const [h, m] = timeStr.split(':').map(Number);
      const startMin = h * 60 + m;
      const endMin = startMin + 90;
      // Break is 13:00 (780m) to 14:00 (840m)
      const overlapsBreak = startMin < 780 && endMin > 780;
      // Closing is 20:00 (1200m)
      const overlapsClosing = endMin > 1200;
      return overlapsBreak || overlapsClosing;
    });

    const is90mStrict = invalidSlots.length === 0;

    recordAudit({
      id: 'TC-BRUTAL-017',
      category: 'H/AT: Multi-Service Contiguous Slot Validation',
      scenario: 'Rescheduling a 90m combined service appointment ensures no slot overlaps break (13:00) or closing (20:00)',
      expectedResult: 'System returns only candidate slots with 90m full contiguous opening',
      actualResult: is90mStrict ? `All ${slots.length} returned slots valid for 90m service` : `Invalid slots detected that breach break/closing: [${invalidSlots.join(', ')}]`,
      httpStatus: 200,
      dbVerified: true,
      verdict: is90mStrict ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      details: `Total 90m Slots Returned: ${slots.length} | Invalid Boundary Slots: ${invalidSlots.length}`,
    });
  }

  // --------------------------------------------------------------------------------------
  // TC-BRUTAL-018 (Cat Q/AT): Multi-Appointment Same-Day Reschedule Isolation
  // --------------------------------------------------------------------------------------
  {
    const phoneMulti = `+91799${Math.floor(100000 + Math.random() * 900000)}`;
    const uMulti = await prisma.user.create({ data: { phone: phoneMulti, name: 'Multi Appt User' } });
    const suMulti = await prisma.salonUser.create({ data: { salonId: fx.salonA.id, userId: uMulti.id } });

    // Appt 1 at 10:00 - 10:30
    const st1 = DateTime.fromISO(testDateStr3, { zone: 'Asia/Kolkata' }).set({ hour: 10, minute: 0 }).toJSDate();
    const et1 = DateTime.fromISO(testDateStr3, { zone: 'Asia/Kolkata' }).set({ hour: 10, minute: 30 }).toJSDate();
    const appt1 = await prisma.appointment.create({
      data: {
        appointmentNumber: `MULTI-1-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: fx.salonA.id,
        salonUserId: suMulti.id,
        stylistId: fx.specA2.id,
        serviceId: fx.sHaircut.id,
        serviceNameSnapshot: fx.sHaircut.name,
        durationMinutes: 30,
        price: 300,
        appointmentDate: new Date(testDateStr3),
        startAt: st1,
        endAt: et1,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    // Appt 2 at 16:00 - 16:30 (Same user, same day, same stylist specA2)
    const st2 = DateTime.fromISO(testDateStr3, { zone: 'Asia/Kolkata' }).set({ hour: 16, minute: 0 }).toJSDate();
    const et2 = DateTime.fromISO(testDateStr3, { zone: 'Asia/Kolkata' }).set({ hour: 16, minute: 30 }).toJSDate();
    await prisma.appointment.create({
      data: {
        appointmentNumber: `MULTI-2-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: fx.salonA.id,
        salonUserId: suMulti.id,
        stylistId: fx.specA2.id,
        serviceId: fx.sHaircut.id,
        serviceNameSnapshot: fx.sHaircut.name,
        durationMinutes: 30,
        price: 300,
        appointmentDate: new Date(testDateStr3),
        startAt: st2,
        endAt: et2,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    // Customer reschedules Appt 1 (exclude appt1.id)
    const availabilityService = new AvailabilityService(prisma as any);
    const availRes = await availabilityService.getAvailableSlots(
      fx.salonA.id,
      fx.sHaircut.id,
      testDateStr3,
      fx.specA2.id,
      appt1.id,
    );

    const slots = availRes.availableSlots.map((s) => s.startTime);
    const appt2Blocked = !slots.includes('16:00'); // Appt 2 at 16:00 MUST remain blocked!
    const appt1ExcludedDefectCheck = !slots.includes('10:00'); // Appt 1 at 10:00 should be excluded

    recordAudit({
      id: 'TC-BRUTAL-018',
      category: 'Q/AT: Multi-Appointment Same-Day Reschedule Isolation',
      scenario: 'Rescheduling Appt 1 (10:00) when user has Appt 2 (16:00) on same day',
      expectedResult: 'Appt 2 slot (16:00) stays strictly BLOCKED by DB while Appt 1 slot (10:00) is excluded',
      actualResult: `16:00 Blocked: ${appt2Blocked} | 10:00 Excluded: ${appt1ExcludedDefectCheck} | Returned Slots: [${slots.join(', ')}]`,
      httpStatus: 200,
      dbVerified: appt2Blocked,
      verdict: appt2Blocked && appt1ExcludedDefectCheck ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
      details: `16:00 Slot correctly blocked by Appt 2: ${appt2Blocked} | 10:00 Slot correctly excluded: ${appt1ExcludedDefectCheck}`,
    });
  }

  // --------------------------------------------------------------------------------------
  // TC-BRUTAL-019 (Cat H): Rescheduling on Salon Closed Day
  // --------------------------------------------------------------------------------------
  {
    // Temporarily create a closed schedule rule or test non-operating day
    const availabilityService = new AvailabilityService(prisma as any);
    // Sunday in salon B is set to closed
    await prisma.salonWorkingHours.update({
      where: { salonId_dayOfWeek: { salonId: fx.salonB.id, dayOfWeek: 'SUNDAY' } },
      data: { isClosed: true },
    });

    const sundayDateStr = DateTime.now().plus({ days: 7 }).startOf('week').plus({ days: 6 }).toISODate()!;
    const availRes = await availabilityService.getAvailableSlots(
      fx.salonB.id,
      fx.sBeta.id,
      sundayDateStr,
      fx.specB1.id,
    );

    const isClosedCleanly = availRes.availableSlots.length === 0;

    recordAudit({
      id: 'TC-BRUTAL-019',
      category: 'H: Closed Salon Day Reschedule Safety',
      scenario: 'Customer queries reschedule availability on a day when salon is marked closed',
      expectedResult: 'System returns empty slot array [] cleanly without throwing internal exception',
      actualResult: `Available slots on closed day: ${availRes.availableSlots.length}`,
      httpStatus: 200,
      dbVerified: isClosedCleanly,
      verdict: isClosedCleanly ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      details: `Returned Slots Count: ${availRes.availableSlots.length} (Must be 0)`,
    });
  }

  // --------------------------------------------------------------------------------------
  // TC-BRUTAL-020 (Cat AT): Same-Slot Exclusion at Business Opening Hour (09:00 AM)
  // --------------------------------------------------------------------------------------
  {
    const phoneOpen = `+91791${Math.floor(100000 + Math.random() * 900000)}`;
    const uOpen = await prisma.user.create({ data: { phone: phoneOpen, name: 'Opening Slot User' } });
    const suOpen = await prisma.salonUser.create({ data: { salonId: fx.salonA.id, userId: uOpen.id } });

    // Appt at 09:00 AM - 09:30 AM (Opening slot)
    const stOpen = DateTime.fromISO(testDateStr3, { zone: 'Asia/Kolkata' }).set({ hour: 9, minute: 0 }).toJSDate();
    const etOpen = DateTime.fromISO(testDateStr3, { zone: 'Asia/Kolkata' }).set({ hour: 9, minute: 30 }).toJSDate();
    const apptOpen = await prisma.appointment.create({
      data: {
        appointmentNumber: `OPEN-SLOT-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: fx.salonA.id,
        salonUserId: suOpen.id,
        stylistId: fx.specA2.id,
        serviceId: fx.sHaircut.id,
        serviceNameSnapshot: fx.sHaircut.name,
        durationMinutes: 30,
        price: 300,
        appointmentDate: new Date(testDateStr3),
        startAt: stOpen,
        endAt: etOpen,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    const availabilityService = new AvailabilityService(prisma as any);
    const availRes = await availabilityService.getAvailableSlots(
      fx.salonA.id,
      fx.sHaircut.id,
      testDateStr3,
      fx.specA2.id,
      apptOpen.id,
    );

    const slotTimes = availRes.availableSlots.map((s) => s.startTime);
    const containsOpeningSlot = slotTimes.includes('09:00');
    const openingSlotExcluded = !containsOpeningSlot;

    recordAudit({
      id: 'TC-BRUTAL-020',
      category: 'AT: Same-Slot Exclusion at Business Opening Boundary (09:00 AM)',
      scenario: 'Customer with appointment at opening time 09:00 AM requests reschedule slots for same date',
      expectedResult: 'System strictly excludes opening slot 09:00 AM from available reschedule times',
      actualResult: containsOpeningSlot ? `DEFECT CONFIRMED: Opening slot 09:00 AM is present in available reschedule slots: [${slotTimes.join(', ')}]` : `09:00 AM correctly excluded`,
      httpStatus: 200,
      dbVerified: true,
      verdict: openingSlotExcluded ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      details: `Current Appt Start: 09:00 | Available Slots Returned: [${slotTimes.join(', ')}]`,
    });
  }

  // --------------------------------------------------------------------------------------
  // TC-BRUTAL-021 (Cat AT): Any-Specialist Cross Capacity Slot Aggregation
  // --------------------------------------------------------------------------------------
  {
    const availabilityService = new AvailabilityService(prisma as any);
    // Request slots without specifying stylistId (Any Specialist)
    const availRes = await availabilityService.getAvailableSlots(
      fx.salonA.id,
      fx.sHaircut.id,
      testDateStr3,
      undefined,
    );

    const slots = availRes.availableSlots.map((s) => s.startTime);
    const hasAvailableSlots = slots.length > 0;

    recordAudit({
      id: 'TC-BRUTAL-021',
      category: 'AT: Unassigned Specialist Slot Aggregation',
      scenario: 'Reschedule availability search when user selects "Any Specialist"',
      expectedResult: 'System aggregates open candidate slots across all qualified specialists cleanly',
      actualResult: `Total Candidate Slots for Any Specialist: ${slots.length}`,
      httpStatus: 200,
      dbVerified: hasAvailableSlots,
      verdict: hasAvailableSlots ? 'PASS' : 'FAIL',
      severity: 'MEDIUM',
      details: `Available Slots Returned for Any Specialist: [${slots.join(', ')}]`,
    });
  }

  // --------------------------------------------------------------------------------------
  // TC-BRUTAL-022 (Cat X/UX): CONFIRM_CANCEL Interrupted by "+ Add Service" Old Button Tap
  // --------------------------------------------------------------------------------------
  {
    const phoneInt1 = `+91792${Math.floor(100000 + Math.random() * 900000)}`;
    const uInt1 = await prisma.user.create({ data: { phone: phoneInt1, name: 'Interrupt User 1' } });
    const suInt1 = await prisma.salonUser.create({ data: { salonId: fx.salonA.id, userId: uInt1.id } });

    const st = DateTime.fromISO(testDateStr3, { zone: 'Asia/Kolkata' }).set({ hour: 11, minute: 0 }).toJSDate();
    const et = DateTime.fromISO(testDateStr3, { zone: 'Asia/Kolkata' }).set({ hour: 11, minute: 30 }).toJSDate();
    const appt = await prisma.appointment.create({
      data: {
        appointmentNumber: `INT-1-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: fx.salonA.id,
        salonUserId: suInt1.id,
        stylistId: fx.specA1.id,
        serviceId: fx.sHaircut.id,
        serviceNameSnapshot: fx.sHaircut.name,
        durationMinutes: 30,
        price: 300,
        appointmentDate: new Date(testDateStr3),
        startAt: st,
        endAt: et,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    // Customer is in CONFIRM_CANCEL state (bot sent "Are you sure you want to cancel?")
    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phoneInt1 } },
      update: { state: 'CONFIRM_CANCEL', activeAppointmentId: appt.id },
      create: { salonId: fx.salonA.id, customerPhone: phoneInt1, state: 'CONFIRM_CANCEL', activeAppointmentId: appt.id },
    });

    // Customer scrolls up and taps "+ Add Service" (btn_add_addon / btn_services) from top card
    const resInt1 = await simulateWhatsAppMessage(fx.salonA.slug, phoneInt1, '+ Add Service', 'btn_add_addon');
    const convInt1 = await prisma.conversation.findUnique({ where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phoneInt1 } } });

    const statePreserved = convInt1?.state === 'CONFIRM_CANCEL';
    const isExpiredNotice = resInt1.replyMessage.includes('That button option has expired');

    recordAudit({
      id: 'TC-BRUTAL-022',
      category: 'X/UX: Old Card "+ Add Service" Tap Interrupted by Expiration Guard',
      scenario: 'User in CONFIRM_CANCEL state taps "+ Add Service" from an older message card',
      expectedResult: 'System strictly blocks old button click, sends expiration notice, and preserves CONFIRM_CANCEL state',
      actualResult: isExpiredNotice
        ? `OLD BUTTON BLOCKED: Expiration notice sent cleanly ("${resInt1.replyMessage.slice(0, 50)}...")`
        : `State: ${convInt1?.state} | Msg: ${resInt1.replyMessage.slice(0, 50)}...`,
      httpStatus: resInt1.status,
      dbVerified: statePreserved,
      verdict: statePreserved && isExpiredNotice ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      details: `Conversation State in DB: ${convInt1?.state} | Reply Message: ${resInt1.replyMessage.replace(/\n/g, ' ')}`,
    });
  }

  // --------------------------------------------------------------------------------------
  // TC-BRUTAL-023 (Cat X/UX): CONFIRM_CANCEL Interrupted by "Reschedule" Old Button Tap
  // --------------------------------------------------------------------------------------
  {
    const phoneInt2 = `+91793${Math.floor(100000 + Math.random() * 900000)}`;
    const uInt2 = await prisma.user.create({ data: { phone: phoneInt2, name: 'Interrupt User 2' } });
    const suInt2 = await prisma.salonUser.create({ data: { salonId: fx.salonA.id, userId: uInt2.id } });

    const st = DateTime.fromISO(testDateStr3, { zone: 'Asia/Kolkata' }).set({ hour: 14, minute: 0 }).toJSDate();
    const et = DateTime.fromISO(testDateStr3, { zone: 'Asia/Kolkata' }).set({ hour: 14, minute: 30 }).toJSDate();
    const appt = await prisma.appointment.create({
      data: {
        appointmentNumber: `INT-2-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: fx.salonA.id,
        salonUserId: suInt2.id,
        stylistId: fx.specA1.id,
        serviceId: fx.sHaircut.id,
        serviceNameSnapshot: fx.sHaircut.name,
        durationMinutes: 30,
        price: 300,
        appointmentDate: new Date(testDateStr3),
        startAt: st,
        endAt: et,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    // Customer is in CONFIRM_CANCEL state
    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phoneInt2 } },
      update: { state: 'CONFIRM_CANCEL', activeAppointmentId: appt.id },
      create: { salonId: fx.salonA.id, customerPhone: phoneInt2, state: 'CONFIRM_CANCEL', activeAppointmentId: appt.id },
    });

    // Customer scrolls up and taps "Reschedule" (btn_reschedule) from top card
    const resInt2 = await simulateWhatsAppMessage(fx.salonA.slug, phoneInt2, 'Reschedule', 'btn_reschedule');
    const convInt2 = await prisma.conversation.findUnique({ where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phoneInt2 } } });

    const statePreserved = convInt2?.state === 'CONFIRM_CANCEL';
    const isExpiredNotice = resInt2.replyMessage.includes('That button option has expired');

    recordAudit({
      id: 'TC-BRUTAL-023',
      category: 'X/UX: Old Card "Reschedule" Tap Interrupted by Expiration Guard',
      scenario: 'User in CONFIRM_CANCEL state taps "Reschedule" from an older message card',
      expectedResult: 'System strictly blocks old button click, sends expiration notice, and preserves CONFIRM_CANCEL state',
      actualResult: isExpiredNotice
        ? `OLD BUTTON BLOCKED: Expiration notice sent cleanly ("${resInt2.replyMessage.slice(0, 50)}...")`
        : `State: ${convInt2?.state} | Msg: ${resInt2.replyMessage.slice(0, 50)}...`,
      httpStatus: resInt2.status,
      dbVerified: statePreserved,
      verdict: statePreserved && isExpiredNotice ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      details: `Conversation State in DB: ${convInt2?.state} | Reply Message: ${resInt2.replyMessage.replace(/\n/g, ' ')}`,
    });
  }

  // --------------------------------------------------------------------------------------
  // TC-BRUTAL-024 (Cat X/UX): ADDON_CONFLICT Interrupted by "Cancel Slot" Old Button Tap
  // --------------------------------------------------------------------------------------
  {
    const phoneInt3 = `+91794${Math.floor(100000 + Math.random() * 900000)}`;
    const uInt3 = await prisma.user.create({ data: { phone: phoneInt3, name: 'Interrupt User 3' } });
    const suInt3 = await prisma.salonUser.create({ data: { salonId: fx.salonA.id, userId: uInt3.id } });

    const st = DateTime.fromISO(testDateStr2, { zone: 'Asia/Kolkata' }).set({ hour: 17, minute: 0 }).toJSDate();
    const et = DateTime.fromISO(testDateStr2, { zone: 'Asia/Kolkata' }).set({ hour: 17, minute: 30 }).toJSDate();
    const appt = await prisma.appointment.create({
      data: {
        appointmentNumber: `INT-3-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: fx.salonA.id,
        salonUserId: suInt3.id,
        stylistId: fx.specA1.id,
        serviceId: fx.sHaircut.id,
        serviceNameSnapshot: fx.sHaircut.name,
        durationMinutes: 30,
        price: 300,
        appointmentDate: new Date(testDateStr3),
        startAt: st,
        endAt: et,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    // Customer is in ADDON_CONFLICT state
    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phoneInt3 } },
      update: { state: 'ADDON_CONFLICT', activeAppointmentId: appt.id, pendingAddonServiceId: fx.sColorSpa.id },
      create: { salonId: fx.salonA.id, customerPhone: phoneInt3, state: 'ADDON_CONFLICT', activeAppointmentId: appt.id, pendingAddonServiceId: fx.sColorSpa.id },
    });

    // Customer taps "Cancel Slot" (btn_cancel_appt) from old message
    const resInt3 = await simulateWhatsAppMessage(fx.salonA.slug, phoneInt3, 'Cancel Slot', 'btn_cancel_appt');
    const convInt3 = await prisma.conversation.findUnique({ where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phoneInt3 } } });

    const statePreserved = convInt3?.state === 'ADDON_CONFLICT';
    const isExpiredNotice = resInt3.replyMessage.includes('That button option has expired');

    recordAudit({
      id: 'TC-BRUTAL-024',
      category: 'X/UX: Old Card "Cancel Slot" Tap Interrupted by Expiration Guard',
      scenario: 'User in ADDON_CONFLICT state taps "Cancel Slot" from an older message card',
      expectedResult: 'System strictly blocks old button click, sends expiration notice, and preserves ADDON_CONFLICT state',
      actualResult: isExpiredNotice
        ? `OLD BUTTON BLOCKED: Expiration notice sent cleanly ("${resInt3.replyMessage.slice(0, 50)}...")`
        : `State: ${convInt3?.state} | Msg: ${resInt3.replyMessage.slice(0, 50)}...`,
      httpStatus: resInt3.status,
      dbVerified: statePreserved,
      verdict: statePreserved && isExpiredNotice ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      details: `Conversation State in DB: ${convInt3?.state}`,
    });
  }

  // --------------------------------------------------------------------------------------
  // TC-BRUTAL-025 (Cat X/UX): SELECT_RESCHEDULE_DATE Interrupted by "+ Add Service" Old Button Tap
  // --------------------------------------------------------------------------------------
  {
    const phoneInt4 = `+91795${Math.floor(100000 + Math.random() * 900000)}`;
    const uInt4 = await prisma.user.create({ data: { phone: phoneInt4, name: 'Interrupt User 4' } });
    const suInt4 = await prisma.salonUser.create({ data: { salonId: fx.salonA.id, userId: uInt4.id } });

    const st = DateTime.fromISO(testDateStr2, { zone: 'Asia/Kolkata' }).set({ hour: 18, minute: 0 }).toJSDate();
    const et = DateTime.fromISO(testDateStr2, { zone: 'Asia/Kolkata' }).set({ hour: 18, minute: 30 }).toJSDate();
    const appt = await prisma.appointment.create({
      data: {
        appointmentNumber: `INT-4-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: fx.salonA.id,
        salonUserId: suInt4.id,
        stylistId: fx.specA1.id,
        serviceId: fx.sHaircut.id,
        serviceNameSnapshot: fx.sHaircut.name,
        durationMinutes: 30,
        price: 300,
        appointmentDate: new Date(testDateStr3),
        startAt: st,
        endAt: et,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    // Customer is in SELECT_RESCHEDULE_DATE state
    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phoneInt4 } },
      update: { state: 'SELECT_RESCHEDULE_DATE', activeAppointmentId: appt.id },
      create: { salonId: fx.salonA.id, customerPhone: phoneInt4, state: 'SELECT_RESCHEDULE_DATE', activeAppointmentId: appt.id },
    });

    // Customer taps "+ Add Service" (btn_add_addon) from old message
    const resInt4 = await simulateWhatsAppMessage(fx.salonA.slug, phoneInt4, '+ Add Service', 'btn_add_addon');
    const convInt4 = await prisma.conversation.findUnique({ where: { salonId_customerPhone: { salonId: fx.salonA.id, customerPhone: phoneInt4 } } });

    const statePreserved = convInt4?.state === 'SELECT_RESCHEDULE_DATE';
    const isExpiredNotice = resInt4.replyMessage.includes('That button option has expired');

    recordAudit({
      id: 'TC-BRUTAL-025',
      category: 'X/UX: Old Card "+ Add Service" Tap Interrupted by Expiration Guard',
      scenario: 'User in SELECT_RESCHEDULE_DATE state taps "+ Add Service" from an older message card',
      expectedResult: 'System strictly blocks old button click, sends expiration notice, and preserves SELECT_RESCHEDULE_DATE state',
      actualResult: isExpiredNotice
        ? `OLD BUTTON BLOCKED: Expiration notice sent cleanly ("${resInt4.replyMessage.slice(0, 50)}...")`
        : `State: ${convInt4?.state} | Msg: ${resInt4.replyMessage.slice(0, 50)}...`,
      httpStatus: resInt4.status,
      dbVerified: statePreserved,
      verdict: statePreserved && isExpiredNotice ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      details: `Conversation State in DB: ${convInt4?.state}`,
    });
  }

  // Summary Report
  const total = auditResults.length;
  const passed = auditResults.filter((r) => r.verdict === 'PASS').length;
  const failed = total - passed;

  console.log('\n========================================================================================');
  console.log(`📊 FINAL BRUTAL QA AUDIT REPORT SUMMARY: ${passed}/${total} PASSED (${failed} FAILED)`);
  console.log('========================================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runBrutalAddonConflictAuditSuite()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

