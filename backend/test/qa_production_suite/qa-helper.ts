import { PrismaClient, DayOfWeek, AppointmentStatus, StylistStatus, ServiceStatus, SalonStatus, AdminRole } from '@prisma/client';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';

export const TEST_DB_URL = 'postgresql://trilokshivhare@localhost:5432/salon_test_qa';
process.env.DATABASE_URL = TEST_DB_URL;

export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: TEST_DB_URL,
    },
  },
});

export interface TestResult {
  rule: string;
  testCase: string;
  expected: string;
  actual: string;
  status: 'PASS' | 'FAIL';
  dbVerified: boolean;
  concurrencyVerified: boolean;
  regressionImpact: string;
  comments: string;
}

export const testResults: TestResult[] = [];

export function recordTest(res: TestResult) {
  testResults.push(res);
  const icon = res.status === 'PASS' ? '✅' : '❌';
  console.log(`${icon} [${res.rule}] ${res.testCase} -> ${res.status}`);
  if (res.status === 'FAIL') {
    console.error(`   Expected: ${res.expected}`);
    console.error(`   Actual:   ${res.actual}`);
  }
}

export async function cleanAllTestData() {
  await prisma.$transaction(async (tx) => {
    await tx.notification.deleteMany({});
    await tx.whatsAppLog.deleteMany({});
    await tx.conversation.deleteMany({});
    await tx.appointmentService.deleteMany({});
    await tx.appointment.deleteMany({});
    await tx.stylistWorkingHours.deleteMany({});
    await tx.stylistService.deleteMany({});
    await tx.stylist.deleteMany({});
    await tx.service.deleteMany({});
    await tx.admin.updateMany({ data: { salonId: null } });
    await tx.salonWorkingHours.deleteMany({});
    await tx.salonUser.deleteMany({});
    await tx.salon.deleteMany({});
    await tx.admin.deleteMany({});
    await tx.user.deleteMany({});
  });
}

export async function seedBasePlatform() {
  const passwordHash = await bcrypt.hash('adminPassword123', 10);

  const superAdmin = await prisma.admin.create({
    data: {
      email: `superadmin-${Date.now()}@platform.com`,
      passwordHash,
      name: 'Super Admin',
      role: AdminRole.SUPER_ADMIN,
    },
  });

  const salonA = await prisma.salon.create({
    data: {
      createdByAdminId: superAdmin.id,
      name: 'Salon Alpha',
      slug: `salon-alpha-${Date.now()}`,
      phone: '+919876543210',
      email: `alpha-${Date.now()}@salon.com`,
      timezone: 'Asia/Kolkata',
      status: SalonStatus.ACTIVE,
      defaultStartTime: '09:00',
      defaultEndTime: '18:00',
    },
  });

  const salonOwnerA = await prisma.admin.create({
    data: {
      email: `owner-alpha-${Date.now()}@platform.com`,
      passwordHash,
      name: 'Salon Alpha Owner',
      role: AdminRole.SALON_OWNER,
      salonId: salonA.id,
    },
  });

  const salonB = await prisma.salon.create({
    data: {
      createdByAdminId: superAdmin.id,
      name: 'Salon Beta',
      slug: `salon-beta-${Date.now()}`,
      phone: '+919876543211',
      email: `beta-${Date.now()}@salon.com`,
      timezone: 'Asia/Kolkata',
      status: SalonStatus.ACTIVE,
      defaultStartTime: '10:00',
      defaultEndTime: '20:00',
    },
  });

  // Seed default 7-day working hours for Salon A
  for (const day of Object.values(DayOfWeek)) {
    await prisma.salonWorkingHours.create({
      data: {
        salonId: salonA.id,
        dayOfWeek: day,
        isClosed: false,
        startTime: '09:00',
        endTime: '18:00',
        breakStartTime: '13:00',
        breakEndTime: '14:00',
      },
    });
    await prisma.salonWorkingHours.create({
      data: {
        salonId: salonB.id,
        dayOfWeek: day,
        isClosed: false,
        startTime: '10:00',
        endTime: '20:00',
      },
    });
  }

  return { superAdmin, salonOwnerA, salonA, salonB };
}

export async function auditAll17Invariants(): Promise<{ passed: boolean; violations: string[] }> {
  const violations: string[] = [];

  // 1. No overlapping blocking stylist appointments
  const stylistOverlaps = await prisma.$queryRawUnsafe<any[]>(`
    SELECT a1.id as id1, a2.id as id2, a1.stylist_id
    FROM appointments a1
    JOIN appointments a2 ON a1.salon_id = a2.salon_id
      AND a1.stylist_id = a2.stylist_id
      AND a1.id <> a2.id
      AND tstzrange(a1.start_at, a1.end_at, '[)') && tstzrange(a2.start_at, a2.end_at, '[)')
    WHERE a1.status IN ('CONFIRMED', 'CHECKED_IN', 'IN_SERVICE')
      AND a2.status IN ('CONFIRMED', 'CHECKED_IN', 'IN_SERVICE');
  `);
  if (stylistOverlaps.length > 0) {
    violations.push(`Invariant 1 Failed: ${stylistOverlaps.length} overlapping blocking stylist appointments found!`);
  }

  // 2. No overlapping blocking customer appointments in same salon
  const custOverlaps = await prisma.$queryRawUnsafe<any[]>(`
    SELECT a1.id as id1, a2.id as id2, a1.salon_user_id
    FROM appointments a1
    JOIN appointments a2 ON a1.salon_id = a2.salon_id
      AND a1.salon_user_id = a2.salon_user_id
      AND a1.id <> a2.id
      AND tstzrange(a1.start_at, a1.end_at, '[)') && tstzrange(a2.start_at, a2.end_at, '[)')
    WHERE a1.status IN ('CONFIRMED', 'CHECKED_IN', 'IN_SERVICE')
      AND a2.status IN ('CONFIRMED', 'CHECKED_IN', 'IN_SERVICE');
  `);
  if (custOverlaps.length > 0) {
    violations.push(`Invariant 2 Failed: ${custOverlaps.length} overlapping blocking customer appointments found!`);
  }

  // 3. Every appointment stylist belongs to same salon
  const crossStylists = await prisma.$queryRawUnsafe<any[]>(`
    SELECT a.id, a.salon_id, s.salon_id as stylist_salon_id
    FROM appointments a
    JOIN stylists s ON a.stylist_id = s.id
    WHERE a.salon_id <> s.salon_id;
  `);
  if (crossStylists.length > 0) {
    violations.push(`Invariant 3 Failed: ${crossStylists.length} appointments have cross-tenant stylist!`);
  }

  // 4. Every appointment salon_user belongs to same salon
  const crossUsers = await prisma.$queryRawUnsafe<any[]>(`
    SELECT a.id, a.salon_id, su.salon_id as user_salon_id
    FROM appointments a
    JOIN salon_users su ON a.salon_user_id = su.id
    WHERE a.salon_id <> su.salon_id;
  `);
  if (crossUsers.length > 0) {
    violations.push(`Invariant 4 Failed: ${crossUsers.length} appointments have cross-tenant salon_user!`);
  }

  // 5. Every AppointmentService belongs to same salon
  const crossApptServices = await prisma.$queryRawUnsafe<any[]>(`
    SELECT asrv.id, asrv.salon_id, a.salon_id as appt_salon_id
    FROM appointment_services asrv
    JOIN appointments a ON asrv.appointment_id = a.id
    WHERE asrv.salon_id <> a.salon_id;
  `);
  if (crossApptServices.length > 0) {
    violations.push(`Invariant 5 Failed: ${crossApptServices.length} appointment_services have cross-tenant salon!`);
  }

  // 6. Every AppointmentService references correct appointment
  const orphanApptServices = await prisma.$queryRawUnsafe<any[]>(`
    SELECT asrv.id
    FROM appointment_services asrv
    LEFT JOIN appointments a ON asrv.appointment_id = a.id
    WHERE a.id IS NULL;
  `);
  if (orphanApptServices.length > 0) {
    violations.push(`Invariant 6 Failed: ${orphanApptServices.length} orphan appointment_services found!`);
  }

  // 7 & 8. Parent duration equals child duration sum & price equals child price sum
  const apptsWithServices = await prisma.appointment.findMany({
    include: { services: true },
  });
  for (const a of apptsWithServices) {
    if (a.services.length > 0) {
      const sumDur = a.services.reduce((s, c) => s + c.durationMinutes, 0);
      if (sumDur !== a.durationMinutes) {
        violations.push(`Invariant 7 Failed: Appointment #${a.appointmentNumber} parent duration (${a.durationMinutes}) != sum (${sumDur})`);
      }
      const sumPrice = a.services.reduce((s, c) => s + Number(c.price), 0);
      if (sumPrice !== Number(a.price)) {
        violations.push(`Invariant 8 Failed: Appointment #${a.appointmentNumber} parent price (${a.price}) != sum (${sumPrice})`);
      }
    }
  }

  // 9. No duplicate appointment numbers
  const dupApptNums = await prisma.$queryRawUnsafe<any[]>(`
    SELECT appointment_number, COUNT(*) as cnt
    FROM appointments
    GROUP BY appointment_number
    HAVING COUNT(*) > 1;
  `);
  if (dupApptNums.length > 0) {
    violations.push(`Invariant 9 Failed: ${dupApptNums.length} duplicate appointment numbers found!`);
  }

  // 10. No duplicate salon_users for same user in same salon
  const dupSalonUsers = await prisma.$queryRawUnsafe<any[]>(`
    SELECT salon_id, user_id, COUNT(*) as cnt
    FROM salon_users
    GROUP BY salon_id, user_id
    HAVING COUNT(*) > 1;
  `);
  if (dupSalonUsers.length > 0) {
    violations.push(`Invariant 10 Failed: ${dupSalonUsers.length} duplicate salon_users found!`);
  }

  // 11. Service IDs cannot be duplicated inside one appointment
  const dupServicesInAppt = await prisma.$queryRawUnsafe<any[]>(`
    SELECT appointment_id, service_id, COUNT(*) as cnt
    FROM appointment_services
    GROUP BY appointment_id, service_id
    HAVING COUNT(*) > 1;
  `);
  if (dupServicesInAppt.length > 0) {
    violations.push(`Invariant 11 Failed: ${dupServicesInAppt.length} appointments have duplicated services!`);
  }

  // 12. AppointmentService order indexes are non-negative
  const invalidOrderIndex = await prisma.$queryRawUnsafe<any[]>(`
    SELECT id, order_index
    FROM appointment_services
    WHERE order_index < 0;
  `);
  if (invalidOrderIndex.length > 0) {
    violations.push(`Invariant 12 Failed: ${invalidOrderIndex.length} appointment services have negative order index!`);
  }

  // 13. Appointment duration must be positive and multiple of 15
  const invalidDurations = await prisma.$queryRawUnsafe<any[]>(`
    SELECT id, duration_minutes
    FROM appointments
    WHERE duration_minutes <= 0 OR duration_minutes % 15 <> 0;
  `);
  if (invalidDurations.length > 0) {
    violations.push(`Invariant 13 Failed: ${invalidDurations.length} appointments have invalid duration (not positive or not divisible by 15)!`);
  }

  // 14. Appointment end_at must be strictly after start_at
  const invalidIntervals = await prisma.$queryRawUnsafe<any[]>(`
    SELECT id, start_at, end_at
    FROM appointments
    WHERE end_at <= start_at;
  `);
  if (invalidIntervals.length > 0) {
    violations.push(`Invariant 14 Failed: ${invalidIntervals.length} appointments have end_at <= start_at!`);
  }

  // 15. Appointment start_at and end_at duration difference matches duration_minutes
  const durationMismatch = await prisma.$queryRawUnsafe<any[]>(`
    SELECT id, duration_minutes, ROUND(EXTRACT(EPOCH FROM (end_at - start_at)) / 60) as calculated_dur
    FROM appointments
    WHERE ROUND(EXTRACT(EPOCH FROM (end_at - start_at)) / 60) <> duration_minutes;
  `);
  if (durationMismatch.length > 0) {
    violations.push(`Invariant 15 Failed: ${durationMismatch.length} appointments have start_at/end_at mismatch with duration_minutes!`);
  }

  // 16. StylistService stylist and service must belong to same salon
  const crossStylistServices = await prisma.$queryRawUnsafe<any[]>(`
    SELECT ss.salon_id, st.salon_id as sty_salon_id, srv.salon_id as srv_salon_id
    FROM stylist_services ss
    JOIN stylists st ON ss.stylist_id = st.id
    JOIN services srv ON ss.service_id = srv.id
    WHERE ss.salon_id <> st.salon_id OR ss.salon_id <> srv.salon_id;
  `);
  if (crossStylistServices.length > 0) {
    violations.push(`Invariant 16 Failed: ${crossStylistServices.length} cross-tenant stylist_services found!`);
  }

  // 17. Operating Hours Compliance (Strict Schedule Hierarchy):
  // - If stylist.followsSalonSchedule = true: appointment must fall within salon working hours & breaks
  // - If stylist.followsSalonSchedule = false: appointment is governed exclusively by custom stylist working hours & breaks
  const allActiveAppts = await prisma.appointment.findMany({
    where: {
      status: { in: ['CONFIRMED', 'CHECKED_IN', 'IN_SERVICE'] },
    },
    include: { salon: true, stylist: true },
  });

  for (const appt of allActiveAppts) {
    const tz = appt.salon.timezone || 'Asia/Kolkata';
    const startDt = appt.startAt;
    const endDt = appt.endAt;
    const dayOfWeek = require('luxon').DateTime.fromJSDate(startDt, { zone: tz }).toFormat('cccc').toUpperCase();
    const apptStartStr = require('luxon').DateTime.fromJSDate(startDt, { zone: tz }).toFormat('HH:mm');
    const apptEndStr = require('luxon').DateTime.fromJSDate(endDt, { zone: tz }).toFormat('HH:mm');

    if (appt.stylist.followsSalonSchedule) {
      const salonHours = await prisma.salonWorkingHours.findUnique({
        where: { salonId_dayOfWeek: { salonId: appt.salonId, dayOfWeek: dayOfWeek as any } },
      });

      if (salonHours) {
        if (salonHours.isClosed) {
          violations.push(`Invariant 17 Failed: Appointment #${appt.appointmentNumber} scheduled on closed salon day ${dayOfWeek}!`);
        } else {
          if (salonHours.startTime && apptStartStr < salonHours.startTime) {
            violations.push(`Invariant 17 Failed: Appointment #${appt.appointmentNumber} starts (${apptStartStr}) before salon open (${salonHours.startTime})!`);
          }
          if (salonHours.endTime && apptEndStr > salonHours.endTime) {
            violations.push(`Invariant 17 Failed: Appointment #${appt.appointmentNumber} ends (${apptEndStr}) after salon close (${salonHours.endTime})!`);
          }
          if (salonHours.breakStartTime && salonHours.breakEndTime) {
            if (apptStartStr < salonHours.breakEndTime && apptEndStr > salonHours.breakStartTime) {
              violations.push(`Invariant 17 Failed: Appointment #${appt.appointmentNumber} conflicts with salon break (${salonHours.breakStartTime}-${salonHours.breakEndTime})!`);
            }
          }
        }
      }
    } else {
      // Custom stylist schedule: governed exclusively by stylist_working_hours
      const stylistHours = await prisma.stylistWorkingHours.findUnique({
        where: { stylistId_dayOfWeek: { stylistId: appt.stylistId, dayOfWeek: dayOfWeek as any } },
      });

      if (stylistHours) {
        if (!stylistHours.isWorking) {
          violations.push(`Invariant 17 Failed: Custom appointment #${appt.appointmentNumber} scheduled on stylist off-day ${dayOfWeek}!`);
        } else {
          if (stylistHours.startTime && apptStartStr < stylistHours.startTime) {
            violations.push(`Invariant 17 Failed: Custom appointment #${appt.appointmentNumber} starts (${apptStartStr}) before custom stylist start (${stylistHours.startTime})!`);
          }
          if (stylistHours.endTime && apptEndStr > stylistHours.endTime) {
            violations.push(`Invariant 17 Failed: Custom appointment #${appt.appointmentNumber} ends (${apptEndStr}) after custom stylist end (${stylistHours.endTime})!`);
          }
          if (stylistHours.breakStartTime && stylistHours.breakEndTime) {
            if (apptStartStr < stylistHours.breakEndTime && apptEndStr > stylistHours.breakStartTime) {
              violations.push(`Invariant 17 Failed: Custom appointment #${appt.appointmentNumber} conflicts with custom stylist break (${stylistHours.breakStartTime}-${stylistHours.breakEndTime})!`);
            }
          }
        }
      }
    }
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}
