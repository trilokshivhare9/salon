import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AdminRole, DayOfWeek, AppointmentStatus, BookingSource } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { DateTime } from 'luxon';

describe('Suite 4: Pure Continuous Free-Interval Availability Engine (Sections 12-21)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let superAdminToken: string;
  let salonOwnerToken: string;
  let salon: any;
  let stylist: any;
  let customerUser: any;

  // Services
  let s1m: any;
  let s30m: any;
  let s45m: any;
  let s60m: any;
  let s90m: any;
  let s120m: any;

  const testDate = DateTime.now().setZone('Asia/Kolkata').plus({ days: 3 }).toISODate()!;
  const dayOfWeek = [
    DayOfWeek.SUNDAY,
    DayOfWeek.MONDAY,
    DayOfWeek.TUESDAY,
    DayOfWeek.WEDNESDAY,
    DayOfWeek.THURSDAY,
    DayOfWeek.FRIDAY,
    DayOfWeek.SATURDAY,
  ][DateTime.fromISO(testDate).weekday % 7];

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
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
    prisma = app.get<PrismaService>(PrismaService);

    // Setup Super Admin
    const passwordHash = await bcrypt.hash('Password123!', 10);
    await prisma.admin.upsert({
      where: { email: 'suite4-admin@salonsaas.com' },
      update: {},
      create: {
        email: 'suite4-admin@salonsaas.com',
        name: 'Suite 4 Super Admin',
        passwordHash,
        role: AdminRole.SUPER_ADMIN,
      },
    });

    const superRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'suite4-admin@salonsaas.com', password: 'Password123!' })
      .expect(200);
    superAdminToken = superRes.body.accessToken;

    // Create Dedicated Salon with 09:00 - 21:00 operating hours
    const ownerEmail = `suite4-owner-${Date.now()}@test.com`;
    const res = await request(app.getHttpServer())
      .post('/api/v1/salons/platform/create')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        name: 'Continuous Availability Studio',
        city: 'Mumbai',
        phone: '9777777771',
        ownerName: 'Math Engine Owner',
        email: ownerEmail,
        password: 'Password123!',
        openTime: '09:00',
        closeTime: '21:00',
      })
      .expect(201);
    salon = res.body;

    const loginRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmail, password: 'Password123!' })
      .expect(200);
    salonOwnerToken = loginRes.body.accessToken;

    // Create Services of different durations
    const createSvc = async (name: string, durationMinutes: number) => {
      const s = await request(app.getHttpServer())
        .post('/api/v1/services')
        .set('Authorization', `Bearer ${salonOwnerToken}`)
        .send({ name, durationMinutes, price: durationMinutes * 10 })
        .expect(201);
      return s.body;
    };

    s1m = await createSvc('1 Minute Touchup', 1);
    s30m = await createSvc('30 Min Trim', 30);
    s45m = await createSvc('45 Min Fade', 45);
    s60m = await createSvc('60 Min Facial', 60);
    s90m = await createSvc('90 Min Master Cut & Spa', 90);
    s120m = await createSvc('120 Min Keratin', 120);

    // Create Dedicated Stylist assigned to all services
    const stRes = await request(app.getHttpServer())
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${salonOwnerToken}`)
      .send({
        name: 'Continuous Math Stylist',
        phone: '+919777777799',
        followsSalonSchedule: true,
        serviceIds: [s1m.id, s30m.id, s45m.id, s60m.id, s90m.id, s120m.id],
      })
      .expect(201);
    stylist = stRes.body;

    // Customer
    customerUser = await prisma.user.create({
      data: {
        phone: '+919777777788',
        name: 'Continuous Tester',
      },
    });
  });

  afterAll(async () => {
    try {
      if (salon?.id) {
        await prisma.appointment.deleteMany({ where: { salonId: salon.id } });
        await prisma.stylistService.deleteMany({
          where: { stylist: { salonId: salon.id } },
        });
        await prisma.stylist.deleteMany({ where: { salonId: salon.id } });
        await prisma.service.deleteMany({ where: { salonId: salon.id } });
        await prisma.salonWorkingHours.deleteMany({ where: { salonId: salon.id } });
        await prisma.salonUser.deleteMany({ where: { salonId: salon.id } });
        await prisma.admin.deleteMany({ where: { salonId: salon.id } });
        await prisma.salon.deleteMany({ where: { id: salon.id } });
      }
      if (customerUser?.id) {
        await prisma.user.deleteMany({ where: { id: customerUser.id } });
      }
      await prisma.admin.deleteMany({ where: { email: 'suite4-admin@salonsaas.com' } });
    } catch (e) {
      // Best-effort cleanup
    }
    await app.close();
  });

  // Helper to insert appointment directly into DB for interval testing
  const createDirectAppt = async (
    startH: number,
    startM: number,
    endH: number,
    endM: number,
    status: AppointmentStatus = AppointmentStatus.CONFIRMED,
  ) => {
    const tz = 'Asia/Kolkata';
    const startDt = DateTime.fromISO(testDate, { zone: tz }).set({
      hour: startH,
      minute: startM,
      second: 0,
      millisecond: 0,
    });
    const endDt = DateTime.fromISO(testDate, { zone: tz }).set({
      hour: endH,
      minute: endM,
      second: 0,
      millisecond: 0,
    });

    return prisma.appointment.create({
      data: {
        appointmentNumber: `SAL-${Math.floor(100000 + Math.random() * 900000)}`,
        salonId: salon.id,
        stylistId: stylist.id,
        serviceId: s30m.id,
        userId: customerUser.id,
        appointmentDate: new Date(testDate),
        startAt: startDt.toJSDate(),
        endAt: endDt.toJSDate(),
        serviceNameSnapshot: 'Test Snapshot',
        durationMinutes: (endH * 60 + endM) - (startH * 60 + startM),
        price: 300,
        status,
        source: BookingSource.WEB,
      },
    });
  };

  describe('1. Non-Grid Disjoint Intervals (Section 13)', () => {
    it('should NOT combine disjoint free minutes (30m + 60m != 90m) for a 90-min service', async () => {
      // Scenario:
      // 10:00 -> 10:30 FREE (30m)
      // 10:30 -> 11:30 BUSY (60m)
      // 11:30 -> 12:30 FREE (60m)
      // 12:30 -> 21:00 BUSY
      // Free intervals are [09:00-10:30] wait, let's block 09:00-10:00 and 12:30-21:00
      const a1 = await createDirectAppt(9, 0, 10, 0); // 09:00-10:00 busy
      const a2 = await createDirectAppt(10, 30, 11, 30); // 10:30-11:30 busy
      const a3 = await createDirectAppt(12, 30, 21, 0); // 12:30-21:00 busy

      // Now stylist has free intervals:
      // [10:00, 10:30] (30 mins continuous)
      // [11:30, 12:30] (60 mins continuous)
      // Total free minutes = 90 mins, but disjoint!

      const res = await request(app.getHttpServer())
        .get(`/api/v1/booking/${salon.slug}/availability`)
        .query({ serviceId: s90m.id, date: testDate, stylistId: stylist.id })
        .expect(200);

      // Must NOT contain 10:00 or 11:30 because neither interval can fit 90 minutes!
      const slots = res.body.availableSlots.map((s: any) => s.startTime);
      expect(slots).not.toContain('10:00');
      expect(slots).not.toContain('11:30');
      expect(slots.length).toBe(0);

      // Clean up
      await prisma.appointment.deleteMany({ where: { id: { in: [a1.id, a2.id, a3.id] } } });
    });
  });

  describe('2. Exact Fit vs. One-Minute Short (Sections 15 & 16)', () => {
    it('should OFFER exact fit: Free 10:00 -> 11:30 exactly fits 90-min service', async () => {
      // Free interval [10:00, 11:30]
      const a1 = await createDirectAppt(9, 0, 10, 0); // 09:00-10:00 busy
      const a2 = await createDirectAppt(11, 30, 21, 0); // 11:30-21:00 busy

      const res = await request(app.getHttpServer())
        .get(`/api/v1/booking/${salon.slug}/availability`)
        .query({ serviceId: s90m.id, date: testDate, stylistId: stylist.id })
        .expect(200);

      const slots = res.body.availableSlots.map((s: any) => s.startTime);
      expect(slots).toContain('10:00');

      await prisma.appointment.deleteMany({ where: { id: { in: [a1.id, a2.id] } } });
    });

    it('should REJECT one-minute short: Free 10:00 -> 11:29 must NOT offer 90-min service', async () => {
      // Free interval [10:00, 11:29] (89 minutes)
      const a1 = await createDirectAppt(9, 0, 10, 0); // 09:00-10:00 busy
      const a2 = await createDirectAppt(11, 29, 21, 0); // 11:29-21:00 busy

      const res = await request(app.getHttpServer())
        .get(`/api/v1/booking/${salon.slug}/availability`)
        .query({ serviceId: s90m.id, date: testDate, stylistId: stylist.id })
        .expect(200);

      const slots = res.body.availableSlots.map((s: any) => s.startTime);
      expect(slots).not.toContain('10:00');
      expect(slots.length).toBe(0);

      await prisma.appointment.deleteMany({ where: { id: { in: [a1.id, a2.id] } } });
    });
  });

  describe('3. Back-to-Back Bookings & Boundary Testing (Sections 19 & 20)', () => {
    it('should ALLOW back-to-back appointment starting exactly at previous appointment end', async () => {
      // Alice is booked 10:00 -> 11:00
      const a1 = await createDirectAppt(10, 0, 11, 0);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/booking/${salon.slug}/availability`)
        .query({ serviceId: s60m.id, date: testDate, stylistId: stylist.id })
        .expect(200);

      const slots = res.body.availableSlots.map((s: any) => s.startTime);
      expect(slots).toContain('11:00'); // Immediately adjacent back-to-back!
      expect(slots).not.toContain('10:00');
      expect(slots).not.toContain('10:15');
      expect(slots).not.toContain('10:30');
      expect(slots).not.toContain('10:45');

      await prisma.appointment.deleteMany({ where: { id: a1.id } });
    });
  });

  describe('4. Appointment Status Blocking (Section 21)', () => {
    it('should BLOCK availability for active statuses (CONFIRMED, PENDING, IN_SERVICE, CHECKED_IN)', async () => {
      const statusesToBlock = [
        AppointmentStatus.CONFIRMED,
        AppointmentStatus.PENDING,
        AppointmentStatus.IN_SERVICE,
        AppointmentStatus.CHECKED_IN,
      ];

      for (const status of statusesToBlock) {
        const appt = await createDirectAppt(14, 0, 15, 0, status);

        const res = await request(app.getHttpServer())
          .get(`/api/v1/booking/${salon.slug}/availability`)
          .query({ serviceId: s60m.id, date: testDate, stylistId: stylist.id })
          .expect(200);

        const slots = res.body.availableSlots.map((s: any) => s.startTime);
        expect(slots).not.toContain('14:00'); // Blocked!

        await prisma.appointment.delete({ where: { id: appt.id } });
      }
    });

    it('should NOT block availability for inactive statuses (CANCELLED, NO_SHOW, RESCHEDULED, EXPIRED)', async () => {
      const nonBlockingStatuses = [
        AppointmentStatus.CANCELLED,
        AppointmentStatus.NO_SHOW,
        AppointmentStatus.RESCHEDULED,
        AppointmentStatus.EXPIRED,
      ];

      for (const status of nonBlockingStatuses) {
        const appt = await createDirectAppt(14, 0, 15, 0, status);

        const res = await request(app.getHttpServer())
          .get(`/api/v1/booking/${salon.slug}/availability`)
          .query({ serviceId: s60m.id, date: testDate, stylistId: stylist.id })
          .expect(200);

        const slots = res.body.availableSlots.map((s: any) => s.startTime);
        expect(slots).toContain('14:00'); // NOT blocked! Free to book!

        await prisma.appointment.delete({ where: { id: appt.id } });
      }
    });
  });
});
