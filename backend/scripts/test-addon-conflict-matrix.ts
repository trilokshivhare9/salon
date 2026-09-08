import { PrismaClient, AdminRole, AdminStatus, AppointmentStatus, BookingSource, StylistStatus, ServiceStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { DateTime } from 'luxon';

const prisma = new PrismaClient();
const API_BASE = 'http://localhost:3000/api/v1';

interface AuditResult {
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

async function recordAudit(res: AuditResult) {
  auditResults.push(res);
  const icon = res.verdict === 'PASS' ? '✅' : '❌';
  console.log(`\n${icon} [${res.id}] [${res.severity}] Category ${res.category}`);
  console.log(`   Scenario: ${res.scenario}`);
  console.log(`   Expected: ${res.expectedResult}`);
  console.log(`   Actual  : ${res.actualResult}`);
  console.log(`   Verdict : ${res.verdict} (HTTP ${res.httpStatus} | DB Verified: ${res.dbVerified})`);
  if (res.details) {
    console.log(`   Details : ${res.details}`);
  }
}

async function setupQAEnvironment() {
  console.log('🧹 Preparing isolated QA fixtures for Add-on Service & Reschedule Conflict Audit...');

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
    where: { slug: 'qa-addon-alpha-salon' },
    update: {},
    create: {
      createdByAdminId: superAdmin.id,
      name: 'QA Addon Alpha Salon',
      slug: 'qa-addon-alpha-salon',
      email: 'addon.alpha@test.com',
      phone: '+919800000001',
      timezone: 'Asia/Kolkata',
      cancelWindowHours: 2,
    },
  });

  // Create Salon B (Beta - for cross tenant testing)
  const salonB = await prisma.salon.upsert({
    where: { slug: 'qa-addon-beta-salon' },
    update: {},
    create: {
      createdByAdminId: superAdmin.id,
      name: 'QA Addon Beta Salon',
      slug: 'qa-addon-beta-salon',
      email: 'addon.beta@test.com',
      phone: '+919800000002',
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

  // Create Specialists
  const specialistA1 = await prisma.stylist.create({
    data: {
      salonId: salonA.id,
      name: 'Trilok Shivhare Specialist',
      phone: `+9198100${Math.floor(10000 + Math.random() * 90000)}`,
      status: StylistStatus.ACTIVE,
      followsSalonSchedule: true,
    },
  });

  const specialistB1 = await prisma.stylist.create({
    data: {
      salonId: salonB.id,
      name: 'Beta Salon Specialist',
      phone: `+9198200${Math.floor(10000 + Math.random() * 90000)}`,
      status: StylistStatus.ACTIVE,
      followsSalonSchedule: true,
    },
  });

  // Services in Salon A
  const serviceHaircut = await prisma.service.create({
    data: {
      salonId: salonA.id,
      name: 'Haircut (30m)',
      durationMinutes: 30,
      price: 300,
      status: ServiceStatus.ACTIVE,
    },
  });

  const serviceBeardAddon = await prisma.service.create({
    data: {
      salonId: salonA.id,
      name: 'Beard & Shaving (60m)',
      durationMinutes: 60,
      price: 70,
      status: ServiceStatus.ACTIVE,
    },
  });

  const service2HrFullSpa = await prisma.service.create({
    data: {
      salonId: salonA.id,
      name: 'Full Luxury Hair & Beard Spa (120m)',
      durationMinutes: 120,
      price: 1500,
      status: ServiceStatus.ACTIVE,
    },
  });

  const serviceInactive = await prisma.service.create({
    data: {
      salonId: salonA.id,
      name: 'Discontinued Treatment',
      durationMinutes: 45,
      price: 900,
      status: ServiceStatus.INACTIVE,
    },
  });

  // Service in Salon B
  const serviceBeta = await prisma.service.create({
    data: {
      salonId: salonB.id,
      name: 'Beta Salon Special Service',
      durationMinutes: 60,
      price: 800,
      status: ServiceStatus.ACTIVE,
    },
  });

  // Map services to stylists
  await prisma.stylistService.createMany({
    data: [
      { salonId: salonA.id, stylistId: specialistA1.id, serviceId: serviceHaircut.id },
      { salonId: salonA.id, stylistId: specialistA1.id, serviceId: serviceBeardAddon.id },
      { salonId: salonA.id, stylistId: specialistA1.id, serviceId: service2HrFullSpa.id },
      { salonId: salonB.id, stylistId: specialistB1.id, serviceId: serviceBeta.id },
    ],
  });

  return {
    salonA,
    salonB,
    specialistA1,
    specialistB1,
    serviceHaircut,
    serviceBeardAddon,
    service2HrFullSpa,
    serviceInactive,
    serviceBeta,
  };
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

async function runAddonConflictAuditSuite() {
  const fixtures = await setupQAEnvironment();
  const { salonA, salonB, specialistA1, specialistB1, serviceHaircut, serviceBeardAddon, service2HrFullSpa, serviceInactive, serviceBeta } = fixtures;

  const testDateStr = DateTime.now().plus({ days: 2 }).toFormat('yyyy-MM-dd');

  console.log('\n========================================================================================');
  console.log('🚀 EXECUTING AUDIT: ADD-ON SERVICE SLOT CONFLICT & RESCHEDULE FAILURE SUITE');
  console.log('========================================================================================\n');

  // --------------------------------------------------------------------------------------
  // SCENARIO 1: Add-on Service Slot Conflict & Button Interaction Deadlock (TC-ADDON-001)
  // --------------------------------------------------------------------------------------
  {
    const phoneCustomerA = `+91799${Math.floor(100000 + Math.random() * 900000)}`;
    const phoneCustomerB = `+91899${Math.floor(100000 + Math.random() * 900000)}`;

    const userA = await prisma.user.create({ data: { phone: phoneCustomerA, name: 'Client A' } });
    const salonUserA = await prisma.salonUser.create({ data: { salonId: salonA.id, userId: userA.id } });

    const userB = await prisma.user.create({ data: { phone: phoneCustomerB, name: 'Client B' } });
    const salonUserB = await prisma.salonUser.create({ data: { salonId: salonA.id, userId: userB.id } });

    // Appt 1: Client A at 10:00 to 10:30 (30m)
    const start1 = DateTime.fromISO(testDateStr, { zone: 'Asia/Kolkata' }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 }).toJSDate();
    const end1 = DateTime.fromISO(testDateStr, { zone: 'Asia/Kolkata' }).set({ hour: 10, minute: 30, second: 0, millisecond: 0 }).toJSDate();
    const appt1 = await prisma.appointment.create({
      data: {
        appointmentNumber: `TC-ADDON-1-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: salonA.id,
        salonUserId: salonUserA.id,
        stylistId: specialistA1.id,
        serviceId: serviceHaircut.id,
        serviceNameSnapshot: serviceHaircut.name,
        durationMinutes: 30,
        price: 300,
        appointmentDate: new Date(testDateStr),
        startAt: start1,
        endAt: end1,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    // Appt 2: Client B right after at 10:30 to 11:00 (30m) with SAME Specialist Trilok Shivhare
    const start2 = DateTime.fromISO(testDateStr, { zone: 'Asia/Kolkata' }).set({ hour: 10, minute: 30, second: 0, millisecond: 0 }).toJSDate();
    const end2 = DateTime.fromISO(testDateStr, { zone: 'Asia/Kolkata' }).set({ hour: 11, minute: 0, second: 0, millisecond: 0 }).toJSDate();
    await prisma.appointment.create({
      data: {
        appointmentNumber: `TC-ADDON-2-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: salonA.id,
        salonUserId: salonUserB.id,
        stylistId: specialistA1.id,
        serviceId: serviceHaircut.id,
        serviceNameSnapshot: serviceHaircut.name,
        durationMinutes: 30,
        price: 300,
        appointmentDate: new Date(testDateStr),
        startAt: start2,
        endAt: end2,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    // Set Conversation for Customer A in SELECT_ADDON state
    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: salonA.id, customerPhone: phoneCustomerA } },
      update: { state: 'SELECT_ADDON', activeAppointmentId: appt1.id },
      create: { salonId: salonA.id, customerPhone: phoneCustomerA, state: 'SELECT_ADDON', activeAppointmentId: appt1.id },
    });

    // Step 1: Customer selects 60-min Add-on service
    const step1 = await simulateWhatsAppMessage(salonA.slug, phoneCustomerA, '+ Beard & Shaving (60m)', `addon_${serviceBeardAddon.id}`);
    
    // Step 2: Customer taps "🔄 Reschedule Both" button
    const step2 = await simulateWhatsAppMessage(salonA.slug, phoneCustomerA, 'Reschedule Both', 'btn_reschedule');

    // DB Verification
    const convDb = await prisma.conversation.findUnique({ where: { salonId_customerPhone: { salonId: salonA.id, customerPhone: phoneCustomerA } } });

    const failedDeadlock = step2.replyMessage.includes('Service not recognized');
    const verdict = failedDeadlock ? 'FAIL' : 'PASS';

    await recordAudit({
      id: 'TC-ADDON-001',
      category: 'X: User Flow / State Machine',
      scenario: 'Add-on service conflict prompt -> User clicks "Reschedule Both" button',
      expectedResult: 'Bot transitions cleanly to date selection menu for rescheduling without error.',
      actualResult: step2.replyMessage,
      httpStatus: step2.status,
      dbVerified: convDb?.state !== 'SELECT_ADDON',
      verdict,
      severity: 'CRITICAL',
      details: `Step 1 Prompt: "${step1.replyMessage.split('\n')[0]}". Step 2 Response: "${step2.replyMessage}". DB Conv State: ${convDb?.state}`,
    });
  }

  // --------------------------------------------------------------------------------------
  // SCENARIO 2: Add-on Flow - "Keep As Is" Button Action Verification (TC-ADDON-002)
  // --------------------------------------------------------------------------------------
  {
    const phoneCustomer = `+91799${Math.floor(100000 + Math.random() * 900000)}`;
    const user = await prisma.user.create({ data: { phone: phoneCustomer, name: 'Client Keep' } });
    const salonUser = await prisma.salonUser.create({ data: { salonId: salonA.id, userId: user.id } });

    const start1 = DateTime.fromISO(testDateStr, { zone: 'Asia/Kolkata' }).set({ hour: 11, minute: 0, second: 0, millisecond: 0 }).toJSDate();
    const end1 = DateTime.fromISO(testDateStr, { zone: 'Asia/Kolkata' }).set({ hour: 11, minute: 30, second: 0, millisecond: 0 }).toJSDate();
    const appt = await prisma.appointment.create({
      data: {
        appointmentNumber: `TC-ADDON-KEEP-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: salonA.id,
        salonUserId: salonUser.id,
        stylistId: specialistA1.id,
        serviceId: serviceHaircut.id,
        serviceNameSnapshot: serviceHaircut.name,
        durationMinutes: 30,
        price: 300,
        appointmentDate: new Date(testDateStr),
        startAt: start1,
        endAt: end1,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: salonA.id, customerPhone: phoneCustomer } },
      update: { state: 'SELECT_ADDON', activeAppointmentId: appt.id },
      create: { salonId: salonA.id, customerPhone: phoneCustomer, state: 'SELECT_ADDON', activeAppointmentId: appt.id },
    });

    // Customer taps "Keep As Is"
    const step = await simulateWhatsAppMessage(salonA.slug, phoneCustomer, 'Keep As Is', 'btn_start');

    const apptDb = await prisma.appointment.findUnique({ where: { id: appt.id } });
    const dbIntact = apptDb?.status === AppointmentStatus.CONFIRMED && apptDb?.durationMinutes === 30;

    const failed = step.replyMessage.includes('Service not recognized');
    const verdict = !failed && dbIntact ? 'PASS' : 'FAIL';

    await recordAudit({
      id: 'TC-ADDON-002',
      category: 'A: User Choice',
      scenario: 'Add-on conflict prompt -> User clicks "Keep As Is" button',
      expectedResult: 'Bot confirms existing appointment remains active as is, returns to main menu/hub',
      actualResult: step.replyMessage,
      httpStatus: step.status,
      dbVerified: dbIntact,
      verdict,
      severity: 'HIGH',
      details: `Bot Message: "${step.replyMessage}" | Appt Status in DB: ${apptDb?.status}`,
    });
  }

  // --------------------------------------------------------------------------------------
  // SCENARIO 3: Reschedule Total Combined 2-Hour Duration When Zero Slots Available (TC-ADDON-003)
  // --------------------------------------------------------------------------------------
  {
    const busyDateStr = DateTime.now().plus({ days: 5 }).toFormat('yyyy-MM-dd');

    // Fill Specialist A1's schedule on busyDate with 30-min appointments every hour from 09:00 to 20:00
    const testHours = [9, 10, 11, 12, 14, 15, 16, 17, 18, 19];
    for (const h of testHours) {
      const u = await prisma.user.create({ data: { phone: `+9197${Math.floor(10000000 + Math.random() * 90000000)}`, name: `Busy Client ${h}` } });
      const su = await prisma.salonUser.create({ data: { salonId: salonA.id, userId: u.id } });
      const st = DateTime.fromISO(busyDateStr, { zone: 'Asia/Kolkata' }).set({ hour: h, minute: 0, second: 0, millisecond: 0 }).toJSDate();
      const et = DateTime.fromISO(busyDateStr, { zone: 'Asia/Kolkata' }).set({ hour: h, minute: 30, second: 0, millisecond: 0 }).toJSDate();
      await prisma.appointment.create({
        data: {
          appointmentNumber: `BUSY-${h}-${Math.floor(10000 + Math.random() * 90000)}`,
          salonId: salonA.id,
          salonUserId: su.id,
          stylistId: specialistA1.id,
          serviceId: serviceHaircut.id,
          serviceNameSnapshot: serviceHaircut.name,
          durationMinutes: 30,
          price: 300,
          appointmentDate: new Date(busyDateStr),
          startAt: st,
          endAt: et,
          status: AppointmentStatus.CONFIRMED,
          source: BookingSource.WEB,
        },
      });
    }

    // Query Availability API for 2-hour Service (120 minutes) on heavily booked date
    const availRes = await fetch(`${API_BASE}/booking/${salonA.slug}/availability?serviceId=${service2HrFullSpa.id}&date=${busyDateStr}&staffId=${specialistA1.id}`);
    const availData = await availRes.json();
    const availableSlots = availData?.data?.availableSlots || [];
    const status = availData?.data?.status;

    const zeroSlotsConfirmed = availableSlots.length === 0;

    await recordAudit({
      id: 'TC-ADDON-003',
      category: 'H: Boundary / Calculation',
      scenario: 'Availability API query for 2-Hour combined service on heavily fragmented day',
      expectedResult: 'Returns 0 available slots and status FULLY_BOOKED (or empty array)',
      actualResult: `Found ${availableSlots.length} available 2-hour slots. Availability Status: ${status}`,
      httpStatus: availRes.status,
      dbVerified: zeroSlotsConfirmed,
      verdict: zeroSlotsConfirmed ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
      details: `Returned Slots: ${JSON.stringify(availableSlots)}`,
    });
  }

  // --------------------------------------------------------------------------------------
  // SCENARIO 4: Multi-Service Duration Slot Bound Calculation (TC-ADDON-004)
  // --------------------------------------------------------------------------------------
  {
    const calcDateStr = DateTime.now().plus({ days: 6 }).toFormat('yyyy-MM-dd');

    // Specialist A1 has a 2-hour open window from 14:00 to 16:00, then an appointment from 16:00 to 17:00
    const u = await prisma.user.create({ data: { phone: `+9196${Math.floor(10000000 + Math.random() * 90000000)}`, name: 'Client 16:00' } });
    const su = await prisma.salonUser.create({ data: { salonId: salonA.id, userId: u.id } });
    const st = DateTime.fromISO(calcDateStr, { zone: 'Asia/Kolkata' }).set({ hour: 16, minute: 0, second: 0, millisecond: 0 }).toJSDate();
    const et = DateTime.fromISO(calcDateStr, { zone: 'Asia/Kolkata' }).set({ hour: 17, minute: 0, second: 0, millisecond: 0 }).toJSDate();
    await prisma.appointment.create({
      data: {
        appointmentNumber: `CALC-1600-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: salonA.id,
        salonUserId: su.id,
        stylistId: specialistA1.id,
        serviceId: serviceHaircut.id,
        serviceNameSnapshot: serviceHaircut.name,
        durationMinutes: 60,
        price: 600,
        appointmentDate: new Date(calcDateStr),
        startAt: st,
        endAt: et,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WEB,
      },
    });

    // Query 2-hour service slots between 14:00 and 16:00
    const availRes = await fetch(`${API_BASE}/booking/${salonA.slug}/availability?serviceId=${service2HrFullSpa.id}&date=${calcDateStr}&staffId=${specialistA1.id}`);
    const availData = await availRes.json();
    const slots = (availData?.data?.availableSlots || []).map((s: any) => s.startTime);

    const valid1400Included = slots.includes('14:00');
    const invalid1430Excluded = !slots.includes('14:30');
    const invalid1500Excluded = !slots.includes('15:00');

    const mathCorrect = valid1400Included && invalid1430Excluded && invalid1500Excluded;

    await recordAudit({
      id: 'TC-ADDON-004',
      category: 'H: Algorithmic Correctness',
      scenario: 'Verify 2-Hour service candidate slot generation before a 16:00 appointment',
      expectedResult: 'Slot 14:00 included; slots 14:30 and 15:00 strictly excluded.',
      actualResult: `Generated 2-hour slots: [${slots.join(', ')}]`,
      httpStatus: availRes.status,
      dbVerified: mathCorrect,
      verdict: mathCorrect ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      details: `14:00 present: ${valid1400Included} | 14:30 excluded: ${invalid1430Excluded} | 15:00 excluded: ${invalid1500Excluded}`,
    });
  }

  // --------------------------------------------------------------------------------------
  // SCENARIO 5: 2-Hour Service Boundary against Salon Break (13:00 - 14:00) (TC-ADDON-005)
  // --------------------------------------------------------------------------------------
  {
    const breakDateStr = DateTime.now().plus({ days: 7 }).toFormat('yyyy-MM-dd');

    const availRes = await fetch(`${API_BASE}/booking/${salonA.slug}/availability?serviceId=${service2HrFullSpa.id}&date=${breakDateStr}&staffId=${specialistA1.id}`);
    const availData = await availRes.json();
    const slots = (availData?.data?.availableSlots || []).map((s: any) => s.startTime);

    const slot1130Excluded = !slots.includes('11:30');
    const slot1200Excluded = !slots.includes('12:00');
    const slot1400Included = slots.includes('14:00');

    const breakOk = slot1130Excluded && slot1200Excluded && slot1400Included;

    await recordAudit({
      id: 'TC-ADDON-005',
      category: 'H: Boundary Values',
      scenario: '2-Hour service availability calculation across 13:00-14:00 break time',
      expectedResult: 'Slots 11:30 and 12:00 excluded due to break collision; 14:00 included.',
      actualResult: `Slots generated near break: [${slots.filter((s: string) => s >= '11:00' && s <= '14:30').join(', ')}]`,
      httpStatus: availRes.status,
      dbVerified: breakOk,
      verdict: breakOk ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      details: `11:30 excluded: ${slot1130Excluded} | 12:00 excluded: ${slot1200Excluded} | 14:00 included: ${slot1400Included}`,
    });
  }

  // --------------------------------------------------------------------------------------
  // SCENARIO 6: Inactive Add-on Service Handling (TC-ADDON-006)
  // --------------------------------------------------------------------------------------
  {
    const phoneCustomer = `+91799${Math.floor(100000 + Math.random() * 900000)}`;
    const user = await prisma.user.create({ data: { phone: phoneCustomer, name: 'Client Inactive Addon' } });
    const salonUser = await prisma.salonUser.create({ data: { salonId: salonA.id, userId: user.id } });

    const st = DateTime.fromISO(testDateStr, { zone: 'Asia/Kolkata' }).set({ hour: 17, minute: 0, second: 0, millisecond: 0 }).toJSDate();
    const et = DateTime.fromISO(testDateStr, { zone: 'Asia/Kolkata' }).set({ hour: 17, minute: 30, second: 0, millisecond: 0 }).toJSDate();
    const appt = await prisma.appointment.create({
      data: {
        appointmentNumber: `TC-INACTIVE-ADDON-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: salonA.id,
        salonUserId: salonUser.id,
        stylistId: specialistA1.id,
        serviceId: serviceHaircut.id,
        serviceNameSnapshot: serviceHaircut.name,
        durationMinutes: 30,
        price: 300,
        appointmentDate: new Date(testDateStr),
        startAt: st,
        endAt: et,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: salonA.id, customerPhone: phoneCustomer } },
      update: { state: 'SELECT_ADDON', activeAppointmentId: appt.id },
      create: { salonId: salonA.id, customerPhone: phoneCustomer, state: 'SELECT_ADDON', activeAppointmentId: appt.id },
    });

    // Send inactive service id
    const res = await simulateWhatsAppMessage(salonA.slug, phoneCustomer, 'Discontinued Treatment', `addon_${serviceInactive.id}`);

    const isRejected = res.replyMessage.includes('Service not recognized') || res.replyMessage.includes('Service not found or inactive');

    await recordAudit({
      id: 'TC-ADDON-006',
      category: 'P: Inactive Records',
      scenario: 'Customer selects an INACTIVE add-on service ID',
      expectedResult: 'Bot rejects inactive service gracefully with error message',
      actualResult: res.replyMessage,
      httpStatus: res.status,
      dbVerified: isRejected,
      verdict: isRejected ? 'PASS' : 'FAIL',
      severity: 'HIGH',
      details: res.replyMessage,
    });
  }

  // --------------------------------------------------------------------------------------
  // SCENARIO 7: Cross-Tenant Add-on Service Injection Attempt (TC-ADDON-007)
  // --------------------------------------------------------------------------------------
  {
    const phoneCustomer = `+91799${Math.floor(100000 + Math.random() * 900000)}`;
    const user = await prisma.user.create({ data: { phone: phoneCustomer, name: 'Client Tenant Test' } });
    const salonUser = await prisma.salonUser.create({ data: { salonId: salonA.id, userId: user.id } });

    const st = DateTime.fromISO(testDateStr, { zone: 'Asia/Kolkata' }).set({ hour: 18, minute: 0, second: 0, millisecond: 0 }).toJSDate();
    const et = DateTime.fromISO(testDateStr, { zone: 'Asia/Kolkata' }).set({ hour: 18, minute: 30, second: 0, millisecond: 0 }).toJSDate();
    const appt = await prisma.appointment.create({
      data: {
        appointmentNumber: `TC-TENANT-ADDON-${Math.floor(10000 + Math.random() * 90000)}`,
        salonId: salonA.id,
        salonUserId: salonUser.id,
        stylistId: specialistA1.id,
        serviceId: serviceHaircut.id,
        serviceNameSnapshot: serviceHaircut.name,
        durationMinutes: 30,
        price: 300,
        appointmentDate: new Date(testDateStr),
        startAt: st,
        endAt: et,
        status: AppointmentStatus.CONFIRMED,
        source: BookingSource.WHATSAPP,
      },
    });

    await prisma.conversation.upsert({
      where: { salonId_customerPhone: { salonId: salonA.id, customerPhone: phoneCustomer } },
      update: { state: 'SELECT_ADDON', activeAppointmentId: appt.id },
      create: { salonId: salonA.id, customerPhone: phoneCustomer, state: 'SELECT_ADDON', activeAppointmentId: appt.id },
    });

    // Try injecting Salon B's service ID into Salon A's conversation
    const res = await simulateWhatsAppMessage(salonA.slug, phoneCustomer, 'Beta Special', `addon_${serviceBeta.id}`);

    const apptDb = await prisma.appointment.findUnique({ where: { id: appt.id } });
    const dbUnmutated = apptDb?.durationMinutes === 30 && apptDb?.price.toNumber() === 300;

    const isRejected = res.replyMessage.includes('Service not recognized') || res.replyMessage.includes('Service not found or inactive');

    await recordAudit({
      id: 'TC-ADDON-007',
      category: 'Q/U: Tenant Isolation',
      scenario: 'Attempt to add Salon B service as add-on to Salon A appointment',
      expectedResult: 'Service rejected as not recognized/inactive; DB appointment unmutated',
      actualResult: res.replyMessage,
      httpStatus: res.status,
      dbVerified: dbUnmutated,
      verdict: isRejected && dbUnmutated ? 'PASS' : 'FAIL',
      severity: 'CRITICAL',
      details: `Bot Message: "${res.replyMessage}" | Appt Duration in DB: ${apptDb?.durationMinutes} mins`,
    });
  }

  // Final Summary Output
  const total = auditResults.length;
  const passed = auditResults.filter(r => r.verdict === 'PASS').length;
  const failed = total - passed;

  console.log('\n========================================================================================');
  console.log(`📊 FINAL QA AUDIT REPORT SUMMARY: ${passed}/${total} PASSED (${failed} FAILED)`);
  console.log('========================================================================================\n');
}

runAddonConflictAuditSuite()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
