import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { PrismaService } from '../src/database/prisma.service';
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { Reflector } from '@nestjs/core';
import { DateTime } from 'luxon';
import { DayOfWeek, AppointmentStatus } from '@prisma/client';

/**
 * PRODUCTION-GRADE TIME-MANAGEMENT & APPOINTMENT SCHEDULING TEST SUITE
 * 
 * Tests the entire mathematical, relational, and concurrency architecture:
 * 1. Basic Working Hours & Shifts
 * 2. Multi-Duration Service Slot Generation (15m, 30m, 60m, 90m, 120m, 540m)
 * 3. Continuous Availability vs Fragmentation Gaps
 * 4. Boundary Conditions (Opening, Closing, Exact Ends)
 * 5. Back-to-Back Booking Non-Collision
 * 6. Overlapping Booking Invalidation (Exact, Partial, Enclosing)
 * 7. Multi-Stylist Isolation & Skill-Based Filtering
 * 8. Brutal Concurrency (10 Simultaneous Contenders for 1 Slot)
 * 9. Cancellation & Real-Time Availability Restitution
 * 10. Rescheduling Lifecycle & Conflict Safeguards
 * 11. Scheduled Breaks & Blocked Time Windows
 * 12. Security / Server-Side Truth Enforcement (Price & Duration Tampering)
 * 13. Past Dates & Max Advance Booking Restrictions
 */
describe('⏱️ TIME-MANAGEMENT & APPOINTMENT ARCHITECTURE E2E', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let salonAdminToken: string;

  let testSalonId: string;
  let testSalonSlug: string;

  // Services with distinct durations
  let svc15mId: string;
  let svc30mId: string;
  let svc60mId: string;
  let svc90mId: string;
  let svc120mId: string;
  let svcAllDay540mId: string;
  let svcTooLong600mId: string;

  // Stylists
  let stylistFullDayId: string;   // 09:00 - 18:00
  let stylistShortShiftId: string; // 10:00 - 15:00
  let stylistOffDutyId: string;    // isWorking = false

  // Fixed test dates in the future (day of week: Wednesday)
  const nowUtc = DateTime.now().setZone('Asia/Kolkata');
  let daysToAdd = (3 - nowUtc.weekday + 7) % 7;
  if (daysToAdd < 3) daysToAdd += 7;
  const targetWednesday = nowUtc.plus({ days: daysToAdd });
  const testDate = targetWednesday.toISODate()!; // "YYYY-MM-DD"
  const testDateObj = new Date(testDate);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new TransformInterceptor());

    const reflector = app.get(Reflector);
    app.useGlobalGuards(new JwtAuthGuard(reflector), new RolesGuard(reflector));

    await app.init();
    prisma = app.get<PrismaService>(PrismaService);

    // 1. Setup isolated Test Salon
    testSalonSlug = `time-arch-test-${Date.now()}`;
    const salon = await prisma.salon.create({
      data: {
        name: 'Precision Time Labs',
        slug: testSalonSlug,
        email: `${testSalonSlug}@test.com`,
        phone: '+919876500001',
        timezone: 'Asia/Kolkata',
        slotIntervalMinutes: 30,
        minAdvanceNoticeMins: 30,
        maxAdvanceDays: 60,
      },
    });
    testSalonId = salon.id;

    // 2. Setup Salon Admin User
    const bcrypt = require('bcrypt');
    const pwdHash = await bcrypt.hash('Password123!', 10);
    const adminUser = await prisma.user.create({
      data: {
        salonId: testSalonId,
        email: `admin-${testSalonSlug}@test.com`,
        name: 'Time Architect Admin',
        passwordHash: pwdHash,
        role: 'SALON_ADMIN',
      },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminUser.email, password: 'Password123!' })
      .expect(200);
    salonAdminToken = loginRes.body.data.accessToken;

    // 3. Salon Working Hours: 09:00 - 18:00 (Wednesday)
    await prisma.workingHours.create({
      data: {
        salonId: testSalonId,
        dayOfWeek: DayOfWeek.WEDNESDAY,
        isOpen: true,
        openTime: '09:00',
        closeTime: '18:00',
      },
    });

    // 4. Create Services
    const s15 = await prisma.service.create({
      data: { salonId: testSalonId, name: 'Express Lineup 15m', durationMinutes: 15, price: 100 },
    });
    const s30 = await prisma.service.create({
      data: { salonId: testSalonId, name: 'Standard Haircut 30m', durationMinutes: 30, price: 200 },
    });
    const s60 = await prisma.service.create({
      data: { salonId: testSalonId, name: 'Cut & Beard Spa 60m', durationMinutes: 60, price: 400 },
    });
    const s90 = await prisma.service.create({
      data: { salonId: testSalonId, name: 'Royal Rejuvenation 90m', durationMinutes: 90, price: 700 },
    });
    const s120 = await prisma.service.create({
      data: { salonId: testSalonId, name: 'Master Transformation 120m', durationMinutes: 120, price: 1000 },
    });
    const s540 = await prisma.service.create({
      data: { salonId: testSalonId, name: 'VIP Salon Full Day 540m', durationMinutes: 540, price: 5000 },
    });
    const s600 = await prisma.service.create({
      data: { salonId: testSalonId, name: 'Over-Capacity Service 600m', durationMinutes: 600, price: 6000 },
    });

    svc15mId = s15.id;
    svc30mId = s30.id;
    svc60mId = s60.id;
    svc90mId = s90.id;
    svc120mId = s120.id;
    svcAllDay540mId = s540.id;
    svcTooLong600mId = s600.id;

    // 5. Create Staff Members
    // Staff A: Full Day (09:00 - 18:00), Break (13:00 - 14:00)
    const stA = await prisma.staff.create({
      data: { salonId: testSalonId, name: 'Stylist Alpha (Full Day)' },
    });
    stylistFullDayId = stA.id;
    await prisma.staffWorkingHours.create({
      data: { staffId: stylistFullDayId, dayOfWeek: DayOfWeek.WEDNESDAY, isWorking: true, startTime: '09:00', endTime: '18:00' },
    });
    await prisma.staffBreak.create({
      data: { staffId: stylistFullDayId, dayOfWeek: DayOfWeek.WEDNESDAY, startTime: '13:00', endTime: '14:00', title: 'Lunch Break' },
    });

    // Staff B: Short Shift (10:00 - 15:00), No Breaks
    const stB = await prisma.staff.create({
      data: { salonId: testSalonId, name: 'Stylist Beta (Short Shift)' },
    });
    stylistShortShiftId = stB.id;
    await prisma.staffWorkingHours.create({
      data: { staffId: stylistShortShiftId, dayOfWeek: DayOfWeek.WEDNESDAY, isWorking: true, startTime: '10:00', endTime: '15:00' },
    });

    // Staff C: Off Duty (isWorking = false)
    const stC = await prisma.staff.create({
      data: { salonId: testSalonId, name: 'Stylist Gamma (Off Duty)' },
    });
    stylistOffDutyId = stC.id;
    await prisma.staffWorkingHours.create({
      data: { staffId: stylistOffDutyId, dayOfWeek: DayOfWeek.WEDNESDAY, isWorking: false, startTime: '09:00', endTime: '18:00' },
    });

    // 6. Map Skills
    for (const sid of [svc15mId, svc30mId, svc60mId, svc90mId, svc120mId, svcAllDay540mId, svcTooLong600mId]) {
      await prisma.staffService.create({ data: { staffId: stylistFullDayId, serviceId: sid } });
    }
    await prisma.staffService.create({ data: { staffId: stylistShortShiftId, serviceId: svc15mId } });
    await prisma.staffService.create({ data: { staffId: stylistShortShiftId, serviceId: svc30mId } });
  }, 35000);

  afterAll(async () => {
    if (testSalonId) {
      await prisma.appointmentStatusHistory.deleteMany({ where: { appointment: { salonId: testSalonId } } }).catch(() => {});
      await prisma.appointment.deleteMany({ where: { salonId: testSalonId } }).catch(() => {});
      await prisma.customer.deleteMany({ where: { salonId: testSalonId } }).catch(() => {});
      await prisma.staffService.deleteMany({ where: { staff: { salonId: testSalonId } } }).catch(() => {});
      await prisma.staffBreak.deleteMany({ where: { staff: { salonId: testSalonId } } }).catch(() => {});
      await prisma.staffWorkingHours.deleteMany({ where: { staff: { salonId: testSalonId } } }).catch(() => {});
      await prisma.staff.deleteMany({ where: { salonId: testSalonId } }).catch(() => {});
      await prisma.service.deleteMany({ where: { salonId: testSalonId } }).catch(() => {});
      await prisma.workingHours.deleteMany({ where: { salonId: testSalonId } }).catch(() => {});
      await prisma.user.deleteMany({ where: { salonId: testSalonId } }).catch(() => {});
      await prisma.salon.delete({ where: { id: testSalonId } }).catch(() => {});
    }
    await app.close();
  }, 15000);


  // =========================================================================
  // 1. BASIC WORKING HOURS & SHIFT BOUNDARIES
  // =========================================================================
  describe('1️⃣ Basic Working Hours & Shifts', () => {
    it('TC-TIME-01: Stylist A (Full Day 09:00-18:00) generates slots starting at 09:00', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/booking/${testSalonSlug}/availability`)
        .query({ serviceId: svc30mId, date: testDate, staffId: stylistFullDayId })
        .expect(200);

      const slots = res.body.data.availableSlots;
      expect(slots.length).toBeGreaterThan(0);
      expect(slots[0].startTime).toBe('09:00');
      expect(slots[0].endTime).toBe('09:30');
    });

    it('TC-TIME-02: Stylist B (Short Shift 10:00-15:00) slots strictly bounded between 10:00 and 14:30', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/booking/${testSalonSlug}/availability`)
        .query({ serviceId: svc30mId, date: testDate, staffId: stylistShortShiftId })
        .expect(200);

      const slots = res.body.data.availableSlots;
      expect(slots.length).toBeGreaterThan(0);
      expect(slots[0].startTime).toBe('10:00');
      const lastSlot = slots[slots.length - 1];
      expect(lastSlot.startTime).toBe('14:30');
      expect(lastSlot.endTime).toBe('15:00');

      expect(slots.some((s: any) => s.startTime < '10:00')).toBe(false);
      expect(slots.some((s: any) => s.startTime > '14:30')).toBe(false);
    });

    it('TC-TIME-03: Stylist C (isWorking = false) returns exactly 0 available slots', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/booking/${testSalonSlug}/availability`)
        .query({ serviceId: svc30mId, date: testDate, staffId: stylistOffDutyId })
        .expect(200);

      expect(res.body.data.availableSlots.length).toBe(0);
    });
  });

  // =========================================================================
  // 2. SERVICE DURATION & CONTINUOUS TIME REQUIREMENTS
  // =========================================================================
  describe('2️⃣ Service Duration & Continuous Availability', () => {
    it('TC-TIME-04: 2-Hour (120m) Service generates 2h intervals and ends before closing', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/booking/${testSalonSlug}/availability`)
        .query({ serviceId: svc120mId, date: testDate, staffId: stylistFullDayId })
        .expect(200);

      const slots = res.body.data.availableSlots;
      expect(slots.length).toBeGreaterThan(0);

      slots.forEach((s: any) => {
        const [sh, sm] = s.startTime.split(':').map(Number);
        const [eh, em] = s.endTime.split(':').map(Number);
        const diffMins = (eh * 60 + em) - (sh * 60 + sm);
        expect(diffMins).toBe(120);
      });

      const lastSlot = slots[slots.length - 1];
      expect(lastSlot.startTime).toBe('16:00');
      expect(lastSlot.endTime).toBe('18:00');
    });

    it('TC-TIME-05: Service duration (600m) greater than total shift (540m) returns 0 slots', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/booking/${testSalonSlug}/availability`)
        .query({ serviceId: svcTooLong600mId, date: testDate, staffId: stylistFullDayId })
        .expect(200);

      expect(res.body.data.availableSlots.length).toBe(0);
    });

    it('TC-TIME-06: Scheduled Staff Break (13:00 - 14:00) eliminates all overlapping slots', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/booking/${testSalonSlug}/availability`)
        .query({ serviceId: svc60mId, date: testDate, staffId: stylistFullDayId })
        .expect(200);

      const slots = res.body.data.availableSlots;
      expect(slots.some((s: any) => s.startTime === '12:30')).toBe(false);
      expect(slots.some((s: any) => s.startTime === '13:00')).toBe(false);
      expect(slots.some((s: any) => s.startTime === '13:30')).toBe(false);

      expect(slots.some((s: any) => s.startTime === '12:00')).toBe(true);
      expect(slots.some((s: any) => s.startTime === '14:00')).toBe(true);
    });
  });

  // =========================================================================
  // 3. CONTINUOUS AVAILABILITY VS FRAGMENTATION GAPS
  // =========================================================================
  describe('3️⃣ Fragmentation Gaps vs Continuous Time', () => {
    beforeAll(async () => {
      const c1 = await prisma.customer.create({ data: { salonId: testSalonId, name: 'Gap Client 1', phone: '+919111111101' } });
      await prisma.appointment.create({
        data: {
          salonId: testSalonId,
          staffId: stylistFullDayId,
          serviceId: svc60mId,
          customerId: c1.id,
          appointmentNumber: 'GAP-101',
          date: testDateObj,
          startTime: DateTime.fromISO(`${testDate}T10:00:00`, { zone: 'Asia/Kolkata' }).toUTC().toJSDate(),
          endTime: DateTime.fromISO(`${testDate}T11:00:00`, { zone: 'Asia/Kolkata' }).toUTC().toJSDate(),
          price: 400,
          status: AppointmentStatus.CONFIRMED,
        },
      });

      const c2 = await prisma.customer.create({ data: { salonId: testSalonId, name: 'Gap Client 2', phone: '+919111111102' } });
      await prisma.appointment.create({
        data: {
          salonId: testSalonId,
          staffId: stylistFullDayId,
          serviceId: svc60mId,
          customerId: c2.id,
          appointmentNumber: 'GAP-102',
          date: testDateObj,
          startTime: DateTime.fromISO(`${testDate}T11:45:00`, { zone: 'Asia/Kolkata' }).toUTC().toJSDate(),
          endTime: DateTime.fromISO(`${testDate}T12:45:00`, { zone: 'Asia/Kolkata' }).toUTC().toJSDate(),
          price: 400,
          status: AppointmentStatus.CONFIRMED,
        },
      });
    });

    afterAll(async () => {
      await prisma.appointment.deleteMany({ where: { salonId: testSalonId } });
      await prisma.customer.deleteMany({ where: { salonId: testSalonId } });
    });

    it('TC-TIME-07: 30-min service fits inside the 45-min gap (11:00 - 11:30)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/booking/${testSalonSlug}/availability`)
        .query({ serviceId: svc30mId, date: testDate, staffId: stylistFullDayId })
        .expect(200);

      const slots = res.body.data.availableSlots;
      expect(slots.some((s: any) => s.startTime === '11:00')).toBe(true);
    });

    it('TC-TIME-08: 60-min service CANNOT fit inside the 45-min gap (11:00 slot must NOT exist)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/booking/${testSalonSlug}/availability`)
        .query({ serviceId: svc60mId, date: testDate, staffId: stylistFullDayId })
        .expect(200);

      const slots = res.body.data.availableSlots;
      expect(slots.some((s: any) => s.startTime === '11:00')).toBe(false);
      expect(slots.some((s: any) => s.startTime === '11:30')).toBe(false);
    });
  });

  // =========================================================================
  // 4. BACK-TO-BACK NON-COLLISION & EXACT BOUNDARY TESTING
  // =========================================================================
  describe('4️⃣ Back-to-Back & Exact Boundary Alignment', () => {
    beforeAll(async () => {
      const cust = await prisma.customer.create({ data: { salonId: testSalonId, name: 'Boundary Tester', phone: '+919222222201' } });
      await prisma.appointment.create({
        data: {
          salonId: testSalonId,
          staffId: stylistFullDayId,
          serviceId: svc60mId,
          customerId: cust.id,
          appointmentNumber: 'BOUND-101',
          date: testDateObj,
          startTime: DateTime.fromISO(`${testDate}T14:00:00`, { zone: 'Asia/Kolkata' }).toUTC().toJSDate(),
          endTime: DateTime.fromISO(`${testDate}T15:00:00`, { zone: 'Asia/Kolkata' }).toUTC().toJSDate(),
          price: 400,
          status: AppointmentStatus.CONFIRMED,
        },
      });
    });

    afterAll(async () => {
      await prisma.appointment.deleteMany({ where: { salonId: testSalonId } });
      await prisma.customer.deleteMany({ where: { salonId: testSalonId } });
    });

    it('TC-TIME-09: Exact end boundary allows immediately subsequent appointment (15:00 - 16:00)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/booking/${testSalonSlug}/availability`)
        .query({ serviceId: svc60mId, date: testDate, staffId: stylistFullDayId })
        .expect(200);

      const slots = res.body.data.availableSlots;
      expect(slots.some((s: any) => s.startTime === '15:00')).toBe(true);

      const bookRes = await request(app.getHttpServer())
        .post(`/api/v1/booking/${testSalonSlug}/appointments`)
        .send({
          serviceId: svc60mId,
          staffId: stylistFullDayId,
          date: testDate,
          startTime: '15:00',
          customerName: 'Back To Back Client',
          customerPhone: '+919333333301',
        })
        .expect(201);

      expect(bookRes.body.success).toBe(true);
    });

    it('TC-TIME-10: Cannot book overlapping appointment starting inside 14:00-15:00 (e.g. 14:30)', async () => {
      const bookRes = await request(app.getHttpServer())
        .post(`/api/v1/booking/${testSalonSlug}/appointments`)
        .send({
          serviceId: svc30mId,
          staffId: stylistFullDayId,
          date: testDate,
          startTime: '14:30',
          customerName: 'Intruder Client',
          customerPhone: '+919333333302',
        });

      expect(bookRes.status).toBe(409);
    });
  });

  // =========================================================================
  // 5. BRUTAL CONCURRENCY & RACE CONDITIONS
  // =========================================================================
  describe('5️⃣ Brutal Concurrency & Double Booking Protection', () => {
    it('TC-TIME-11: 10 Concurrent Users racing for the EXACT same slot → Exactly 1 succeeds, 9 receive 409 Conflict', async () => {
      const concurrentSlot = '16:00';
      const contenderCount = 10;

      const contenderRequests = Array.from({ length: contenderCount }).map((_, idx) =>
        request(app.getHttpServer())
          .post(`/api/v1/booking/${testSalonSlug}/appointments`)
          .send({
            serviceId: svc30mId,
            staffId: stylistFullDayId,
            date: testDate,
            startTime: concurrentSlot,
            customerName: `Contender ${idx + 1}`,
            customerPhone: `+9198888000${idx < 10 ? '0' + idx : idx}`,
          }),
      );

      const responses = await Promise.all(contenderRequests);

      const successful = responses.filter((r) => r.status === 201);
      const conflicts = responses.filter((r) => r.status === 409);

      expect(successful.length).toBe(1);
      expect(conflicts.length).toBe(contenderCount - 1);

      const dbAppointments = await prisma.appointment.findMany({
        where: {
          salonId: testSalonId,
          staffId: stylistFullDayId,
          date: testDateObj,
          startTime: DateTime.fromISO(`${testDate}T16:00:00`, { zone: 'Asia/Kolkata' }).toUTC().toJSDate(),
        },
      });
      expect(dbAppointments.length).toBe(1);
    }, 25000);
  });

  // =========================================================================
  // 6. MULTI-STYLIST INDEPENDENCE & SKILL ISOLATION
  // =========================================================================
  describe('6️⃣ Multi-Stylist Isolation & Skill Compatibility', () => {
    it('TC-TIME-12: Booking Stylist A does NOT reduce Stylist B availability for the same slot', async () => {
      const availBefore = await request(app.getHttpServer())
        .get(`/api/v1/booking/${testSalonSlug}/availability`)
        .query({ serviceId: svc30mId, date: testDate, staffId: stylistShortShiftId })
        .expect(200);
      expect(availBefore.body.data.availableSlots.some((s: any) => s.startTime === '10:00')).toBe(true);

      await request(app.getHttpServer())
        .post(`/api/v1/booking/${testSalonSlug}/appointments`)
        .send({
          serviceId: svc30mId,
          staffId: stylistFullDayId,
          date: testDate,
          startTime: '10:00',
          customerName: 'Stylist A Client',
          customerPhone: '+919777777701',
        })
        .expect(201);

      const availAfter = await request(app.getHttpServer())
        .get(`/api/v1/booking/${testSalonSlug}/availability`)
        .query({ serviceId: svc30mId, date: testDate, staffId: stylistShortShiftId })
        .expect(200);
      expect(availAfter.body.data.availableSlots.some((s: any) => s.startTime === '10:00')).toBe(true);

      const bookBRes = await request(app.getHttpServer())
        .post(`/api/v1/booking/${testSalonSlug}/appointments`)
        .send({
          serviceId: svc30mId,
          staffId: stylistShortShiftId,
          date: testDate,
          startTime: '10:00',
          customerName: 'Stylist B Client',
          customerPhone: '+919777777702',
        })
        .expect(201);
      expect(bookBRes.body.success).toBe(true);
    });

    it('TC-TIME-13: Unskilled Stylist cannot be assigned to an unassigned service', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/booking/${testSalonSlug}/availability`)
        .query({ serviceId: svc90mId, date: testDate, staffId: stylistShortShiftId })
        .expect(200);

      expect(res.body.data.availableSlots.length).toBe(0);
    });
  });

  // =========================================================================
  // 7. CANCELLATION & REAL-TIME AVAILABILITY RESTITUTION
  // =========================================================================
  describe('7️⃣ Cancellation & Availability Restitution', () => {
    let cancelApptId: string;
    const cancelSlot = '11:00';

    beforeAll(async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/booking/${testSalonSlug}/appointments`)
        .send({
          serviceId: svc30mId,
          staffId: stylistFullDayId,
          date: testDate,
          startTime: cancelSlot,
          customerName: 'Cancel Me Client',
          customerPhone: '+919666666601',
        })
        .expect(201);
      cancelApptId = res.body.data.appointmentId || res.body.data.id;
    });

    it('TC-TIME-14: Slot is busy immediately after booking', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/booking/${testSalonSlug}/availability`)
        .query({ serviceId: svc30mId, date: testDate, staffId: stylistFullDayId })
        .expect(200);

      const slots = res.body.data.availableSlots;
      expect(slots.some((s: any) => s.startTime === cancelSlot)).toBe(false);
    });

    it('TC-TIME-15: After cancellation, slot is immediately restored and re-bookable', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/appointments/${cancelApptId}/status`)
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .send({ status: 'CANCELLED', reason: 'Customer requested cancellation.' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/booking/${testSalonSlug}/availability`)
        .query({ serviceId: svc30mId, date: testDate, staffId: stylistFullDayId })
        .expect(200);

      const slots = res.body.data.availableSlots;
      expect(slots.some((s: any) => s.startTime === cancelSlot)).toBe(true);

      const rebookRes = await request(app.getHttpServer())
        .post(`/api/v1/booking/${testSalonSlug}/appointments`)
        .send({
          serviceId: svc30mId,
          staffId: stylistFullDayId,
          date: testDate,
          startTime: cancelSlot,
          customerName: 'New Replacement Customer',
          customerPhone: '+919666666602',
        })
        .expect(201);

      expect(rebookRes.body.success).toBe(true);
    });
  });

  // =========================================================================
  // 8. SECURITY & SERVER-SIDE TRUTH ENFORCEMENT
  // =========================================================================
  describe('8️⃣ Security & Client Tampering Safeguards', () => {
    it('TC-TIME-16: Server rejects client-tampered price or duration with 400 Bad Request', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/booking/${testSalonSlug}/appointments`)
        .send({
          serviceId: svc30mId,
          staffId: stylistFullDayId,
          date: testDate,
          startTime: '09:30',
          customerName: 'Hacker Bob',
          customerPhone: '+919555555501',
          price: 1,
          durationMinutes: 1,
        })
        .expect(400);

      expect(res.body.message).toContain('property price should not exist');
      expect(res.body.message).toContain('property durationMinutes should not exist');
    });



    it('TC-TIME-17: Rejects booking on a past date', async () => {
      const pastDate = DateTime.now().setZone('Asia/Kolkata').minus({ days: 2 }).toISODate()!;
      const res = await request(app.getHttpServer())
        .get(`/api/v1/booking/${testSalonSlug}/availability`)
        .query({ serviceId: svc30mId, date: pastDate, staffId: stylistFullDayId })
        .expect(200);

      expect(res.body.data.availableSlots.length).toBe(0);
    });

    it('TC-TIME-18: Rejects booking beyond max advance days limit', async () => {
      const futureDate = DateTime.now().setZone('Asia/Kolkata').plus({ days: 90 }).toISODate()!;
      const res = await request(app.getHttpServer())
        .get(`/api/v1/booking/${testSalonSlug}/availability`)
        .query({ serviceId: svc30mId, date: futureDate, staffId: stylistFullDayId })
        .expect(200);

      expect(res.body.data.availableSlots.length).toBe(0);
    });
  });

  // =========================================================================
  // 9. RESCHEDULING LIFECYCLE & BUSINESS SAFEGUARDS
  // =========================================================================
  describe('9️⃣ Rescheduling Lifecycle & Business Safeguards', () => {
    let originalApptId: string;
    let reschedCustId: string;

    beforeAll(async () => {
      // Seed an appointment at 11:30 - 12:30 on testDate
      const cust = await prisma.customer.create({
        data: { salonId: testSalonId, name: 'Reschedule VIP', phone: '+919444400001' },
      });
      reschedCustId = cust.id;

      const appt = await prisma.appointment.create({
        data: {
          salonId: testSalonId,
          customerId: cust.id,
          staffId: stylistFullDayId,
          serviceId: svc60mId,
          appointmentNumber: 'RESCHED-101',
          date: testDateObj,
          startTime: DateTime.fromISO(`${testDate}T11:30:00`, { zone: 'Asia/Kolkata' }).toUTC().toJSDate(),
          endTime: DateTime.fromISO(`${testDate}T12:30:00`, { zone: 'Asia/Kolkata' }).toUTC().toJSDate(),
          price: 400,
          status: AppointmentStatus.CONFIRMED,
        },
      });
      originalApptId = appt.id;
    });

    it('TC-TIME-19: Same-Day Reschedule shifting by 30 mins (12:00 - 13:00) succeeds without self-collision', async () => {
      // 12:00 - 13:00 overlaps the original 11:30 - 12:30 booking by 30 minutes!
      // Previously, this would crash with 23P01 exclusion constraint violation.
      const res = await request(app.getHttpServer())
        .post(`/api/v1/appointments/${originalApptId}/reschedule`)
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .send({
          newDate: testDate,
          newStartTime: '12:00',
          staffId: stylistFullDayId,
        })
        .expect(201);


      expect(res.body.success).toBe(true);
      expect(res.body.data.appointmentNumber).toBeDefined();

      // Verify old appointment status is now RESCHEDULED
      const oldAppt = await prisma.appointment.findUnique({
        where: { id: originalApptId },
      });
      expect(oldAppt!.status).toBe(AppointmentStatus.RESCHEDULED);

      // Verify new appointment is CONFIRMED and has the new 12:00 - 13:00 window
      const newAppt = await prisma.appointment.findUnique({
        where: { id: res.body.data.id },
      });
      expect(newAppt!.status).toBe(AppointmentStatus.CONFIRMED);
      const newStartH = DateTime.fromJSDate(newAppt!.startTime, { zone: 'Asia/Kolkata' }).hour;
      const newStartM = DateTime.fromJSDate(newAppt!.startTime, { zone: 'Asia/Kolkata' }).minute;
      expect(newStartH).toBe(12);
      expect(newStartM).toBe(0);
    });

    it('TC-TIME-20: Cannot reschedule onto an occupied slot (409 Conflict)', async () => {
      // Stylist B has a booking at 10:00 - 10:30 from earlier test (TC-TIME-12)
      // Attempting to reschedule another appointment onto Stylist B's 10:00 slot must fail
      const cust = await prisma.customer.create({
        data: { salonId: testSalonId, name: 'Collision Tester', phone: '+919444400002' },
      });
      const apptToMove = await prisma.appointment.create({
        data: {
          salonId: testSalonId,
          customerId: cust.id,
          staffId: stylistShortShiftId,
          serviceId: svc30mId,
          appointmentNumber: 'COLLIDE-101',
          date: testDateObj,
          startTime: DateTime.fromISO(`${testDate}T14:00:00`, { zone: 'Asia/Kolkata' }).toUTC().toJSDate(),
          endTime: DateTime.fromISO(`${testDate}T14:30:00`, { zone: 'Asia/Kolkata' }).toUTC().toJSDate(),
          price: 200,
          status: AppointmentStatus.CONFIRMED,
        },
      });

      // Try to reschedule into 10:00 (already occupied for Stylist B)
      const res = await request(app.getHttpServer())
        .post(`/api/v1/appointments/${apptToMove.id}/reschedule`)
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .send({
          newDate: testDate,
          newStartTime: '10:00',
          staffId: stylistShortShiftId,
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toContain('no longer available');
    });

    it('TC-TIME-21: Cannot reschedule completed or cancelled appointment (400 Bad Request)', async () => {
      // Mark an appointment as COMPLETED
      const cust = await prisma.customer.create({
        data: { salonId: testSalonId, name: 'Completed Tester', phone: '+919444400003' },
      });
      const completedAppt = await prisma.appointment.create({
        data: {
          salonId: testSalonId,
          customerId: cust.id,
          staffId: stylistFullDayId,
          serviceId: svc30mId,
          appointmentNumber: 'COMP-101',
          date: testDateObj,
          startTime: DateTime.fromISO(`${testDate}T09:00:00`, { zone: 'Asia/Kolkata' }).toUTC().toJSDate(),
          endTime: DateTime.fromISO(`${testDate}T09:30:00`, { zone: 'Asia/Kolkata' }).toUTC().toJSDate(),
          price: 200,
          status: AppointmentStatus.COMPLETED,
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/api/v1/appointments/${completedAppt.id}/reschedule`)
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .send({
          newDate: testDate,
          newStartTime: '15:00',
          staffId: stylistFullDayId,
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Cannot reschedule completed or cancelled appointment');
    });
  });
});

