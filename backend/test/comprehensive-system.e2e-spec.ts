import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { AdminRole, AppointmentStatus, DayOfWeek, ServiceStatus, StylistStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { DateTime } from 'luxon';

describe('Comprehensive Multi-Role Salon SaaS E2E Test Suite', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  let superAdminToken: string;
  let superAdminId: string;

  let salonA: any;
  let salonB: any;
  let salonOwnerAToken: string;
  let salonOwnerBToken: string;

  let serviceHaircutA: any;   // 30 mins
  let serviceColorA: any;     // 90 mins
  let serviceShaveA: any;     // 15 mins

  let stylistAlice: any;      // followsSalonSchedule = true
  let stylistBob: any;        // followsSalonSchedule = false (10:00 - 18:00, break 13:00 - 14:00)

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: false,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    jwtService = app.get(JwtService);

    // Clean zero database state
    await prisma.notification.deleteMany();
    await prisma.appointment.deleteMany();
    await prisma.salonUser.deleteMany();
    await prisma.stylistWorkingHours.deleteMany();
    await prisma.stylistService.deleteMany();
    await prisma.stylist.deleteMany();
    await prisma.service.deleteMany();
    await prisma.salonWorkingHours.deleteMany();
    await prisma.user.deleteMany();
    await prisma.salon.deleteMany();
    await prisma.admin.deleteMany();

    // 1. Create Super Admin
    const passwordHash = await bcrypt.hash('Password123!', 10);
    const superAdmin = await prisma.admin.create({
      data: {
        name: 'Platform Super Admin',
        email: 'superadmin@salonsaas.com',
        passwordHash,
        role: AdminRole.SUPER_ADMIN,
      },
    });
    superAdminId = superAdmin.id;

    superAdminToken = jwtService.sign({
      sub: superAdmin.id,
      email: superAdmin.email,
      role: superAdmin.role,
    });
  }, 30000);

  afterAll(async () => {
    await app.close();
  });

  // ===========================================================================
  // 1. SUPER ADMIN WORKFLOW & SALON PROVISIONING
  // ===========================================================================
  describe('1. Super Admin: Salon Creation, Default Hours Seeding & Isolation', () => {
    it('should allow Super Admin to create a new salon and seed 7-day default working hours', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/salons/platform/create')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          name: 'Crown Luxury Salon',
          ownerName: 'Vikram Mehta',
          email: 'vikram@crownsalon.com',
          phone: '9876543210',
          password: 'Password123!',
          city: 'Mumbai',
          openTime: '09:00',
          closeTime: '21:00',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.name).toBe('Crown Luxury Salon');
      salonA = res.body;

      // Verify Salon in Database
      const dbSalon = await prisma.salon.findUnique({
        where: { id: salonA.id },
        include: { workingHours: true, admins: true },
      });

      expect(dbSalon).toBeDefined();
      expect(dbSalon!.createdByAdminId).toBe(superAdminId);
      expect(dbSalon!.defaultStartTime).toBe('09:00');
      expect(dbSalon!.defaultEndTime).toBe('21:00');

      // Verify all 7 days of salon_working_hours seeded
      expect(dbSalon!.workingHours.length).toBe(7);
      for (const wh of dbSalon!.workingHours) {
        expect(wh.startTime).toBe('09:00');
        expect(wh.endTime).toBe('21:00');
        expect(wh.isClosed).toBe(false);
      }

      // Verify Salon Owner account was created
      const ownerAdmin = dbSalon!.admins.find((a) => a.role === AdminRole.SALON_OWNER);
      expect(ownerAdmin).toBeDefined();
      expect(ownerAdmin!.email).toBe('vikram@crownsalon.com');

      // Generate token for Salon Owner A
      salonOwnerAToken = jwtService.sign({
        sub: ownerAdmin!.id,
        email: ownerAdmin!.email,
        role: ownerAdmin!.role,
        salonId: salonA.id,
      });
    });

    it('should allow Super Admin to create a second salon for isolation tests', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/salons/platform/create')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({
          name: 'Elite Barbershop',
          ownerName: 'Rajesh Kumar',
          email: 'rajesh@elitebarber.com',
          phone: '9876543211',
          password: 'Password123!',
          city: 'Delhi',
          openTime: '10:00',
          closeTime: '20:00',
        })
        .expect(201);

      salonB = res.body;
      const ownerAdminB = await prisma.admin.findFirst({
        where: { email: 'rajesh@elitebarber.com' },
      });

      salonOwnerBToken = jwtService.sign({
        sub: ownerAdminB!.id,
        email: ownerAdminB!.email,
        role: ownerAdminB!.role,
        salonId: salonB.id,
      });
    });

    it('should reject non-superadmin from accessing Super Admin endpoints', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/salons/platform/all')
        .set('Authorization', `Bearer ${salonOwnerAToken}`)
        .expect(403);
    });

    it('should allow Super Admin to toggle salon status', async () => {
      const toggleRes = await request(app.getHttpServer())
        .patch(`/api/v1/salons/platform/${salonA.id}/toggle-status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      expect(toggleRes.body.status).toBe('DEACTIVATED');

      // Re-activate
      const activateRes = await request(app.getHttpServer())
        .patch(`/api/v1/salons/platform/${salonA.id}/toggle-status`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      expect(activateRes.body.status).toBe('ACTIVE');
    });
  });

  // ===========================================================================
  // 2. SALON OWNER: SERVICES & STYLIST DEPENDENCY RULES
  // ===========================================================================
  describe('2. Salon Owner: Services, Stylists & Dependency Enforcement', () => {
    it('should REJECT stylist creation when salon has NO services (Prerequisite Rule)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/staff')
        .set('Authorization', `Bearer ${salonOwnerAToken}`)
        .send({
          name: 'Premature Stylist',
          serviceIds: ['00000000-0000-0000-0000-000000000000'],
        })
        .expect(400);

      expect(res.body.message).toContain('must have at least one active service');
    });

    it('should allow Salon Owner to create services', async () => {
      // 1. Haircut (30 min)
      const res1 = await request(app.getHttpServer())
        .post('/api/v1/services')
        .set('Authorization', `Bearer ${salonOwnerAToken}`)
        .send({
          name: 'Classic Haircut',
          price: 500,
          durationMinutes: 30,
          category: 'Hair',
        })
        .expect(201);
      serviceHaircutA = res1.body;

      // 2. Hair Coloring (90 min)
      const res2 = await request(app.getHttpServer())
        .post('/api/v1/services')
        .set('Authorization', `Bearer ${salonOwnerAToken}`)
        .send({
          name: 'Hair Coloring & Highlights',
          price: 2500,
          durationMinutes: 90,
          category: 'Color',
        })
        .expect(201);
      serviceColorA = res2.body;

      // 3. Shave / Beard Trim (15 min)
      const res3 = await request(app.getHttpServer())
        .post('/api/v1/services')
        .set('Authorization', `Bearer ${salonOwnerAToken}`)
        .send({
          name: 'Beard Trim',
          price: 300,
          durationMinutes: 15,
          category: 'Beard',
        })
        .expect(201);
      serviceShaveA = res3.body;

      expect(serviceHaircutA.durationMinutes).toBe(30);
      expect(serviceColorA.durationMinutes).toBe(90);
      expect(serviceShaveA.durationMinutes).toBe(15);
    });

    it('should REJECT stylist creation with empty serviceIds array', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/staff')
        .set('Authorization', `Bearer ${salonOwnerAToken}`)
        .send({
          name: 'No Service Stylist',
          serviceIds: [],
        })
        .expect(400);

      expect(res.body.message).toBeDefined();
    });

    it('should REJECT stylist creation with services belonging to ANOTHER salon (Cross-salon protection)', async () => {
      // Create a service in Salon B
      const srvB = await prisma.service.create({
        data: {
          salonId: salonB.id,
          name: 'Salon B Exclusive',
          price: 1000,
          durationMinutes: 60,
        },
      });

      const res = await request(app.getHttpServer())
        .post('/api/v1/staff')
        .set('Authorization', `Bearer ${salonOwnerAToken}`)
        .send({
          name: 'Intruder Stylist',
          serviceIds: [srvB.id],
        })
        .expect(400);

      expect(res.body.message).toContain('do not belong to this salon');
    });

    it('should allow creating Stylist Alice with followsSalonSchedule = true', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/staff')
        .set('Authorization', `Bearer ${salonOwnerAToken}`)
        .send({
          name: 'Alice Cooper',
          phone: '9876543220',
          serviceIds: [serviceHaircutA.id, serviceColorA.id],
          followsSalonSchedule: true,
        })
        .expect(201);

      stylistAlice = res.body;
      expect(stylistAlice.followsSalonSchedule).toBe(true);
      expect(stylistAlice.services.length).toBe(2);
    });

    it('should allow creating Stylist Bob and configuring custom hours & break', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/staff')
        .set('Authorization', `Bearer ${salonOwnerAToken}`)
        .send({
          name: 'Bob Miller',
          phone: '9876543221',
          serviceIds: [serviceHaircutA.id, serviceColorA.id, serviceShaveA.id],
          followsSalonSchedule: false,
        })
        .expect(201);

      stylistBob = res.body;

      // Configure Bob with 10:00 - 18:00 and Lunch Break 13:00 - 14:00 for Monday
      const days = [
        DayOfWeek.MONDAY,
        DayOfWeek.TUESDAY,
        DayOfWeek.WEDNESDAY,
        DayOfWeek.THURSDAY,
        DayOfWeek.FRIDAY,
        DayOfWeek.SATURDAY,
        DayOfWeek.SUNDAY,
      ];

      await request(app.getHttpServer())
        .put(`/api/v1/staff/${stylistBob.id}/working-hours`)
        .set('Authorization', `Bearer ${salonOwnerAToken}`)
        .send({
          hours: days.map((d) => ({
            dayOfWeek: d,
            isWorking: true,
            startTime: '10:00',
            endTime: '18:00',
            breakStartTime: '13:00',
            breakEndTime: '14:00',
          })),
        })
        .expect(200);

      const dbBob = await prisma.stylist.findUnique({
        where: { id: stylistBob.id },
        include: { workingHours: true },
      });
      expect(dbBob!.followsSalonSchedule).toBe(false);
      expect(dbBob!.workingHours.length).toBe(7);
      expect(dbBob!.workingHours[0].breakStartTime).toBe('13:00');
      expect(dbBob!.workingHours[0].breakEndTime).toBe('14:00');
    });

    it('should configure mandatory Salon Break for Salon A (14:00 - 15:00)', async () => {
      const days = [
        DayOfWeek.MONDAY,
        DayOfWeek.TUESDAY,
        DayOfWeek.WEDNESDAY,
        DayOfWeek.THURSDAY,
        DayOfWeek.FRIDAY,
        DayOfWeek.SATURDAY,
        DayOfWeek.SUNDAY,
      ];

      await request(app.getHttpServer())
        .put('/api/v1/salons/working-hours')
        .set('Authorization', `Bearer ${salonOwnerAToken}`)
        .send({
          hours: days.map((d) => ({
            dayOfWeek: d,
            isClosed: false,
            startTime: '09:00',
            endTime: '21:00',
            breakStartTime: '14:00',
            breakEndTime: '15:00',
          })),
        })
        .expect(200);
    });
  });

  // ===========================================================================
  // 3. AVAILABILITY ENGINE & CONTINUOUS FREE-INTERVAL VALIDATION
  // ===========================================================================
  describe('3. Dynamic Availability Engine: Pure Continuous-Interval Checking', () => {
    const testDate = DateTime.now().setZone('Asia/Kolkata').plus({ days: 3 }).toISODate()!;

    it('should enforce continuous free intervals for 90-min service around Stylist Bob break (13:00 - 14:00)', async () => {
      // Query availability specifically for Bob for 90-min service
      const res = await request(app.getHttpServer())
        .get(`/api/v1/booking/${salonA.slug}/availability`)
        .query({
          serviceId: serviceColorA.id, // 90 min
          date: testDate,
          staffId: stylistBob.id,
        })
        .expect(200);

      const slots: { startTime: string; endTime: string }[] = res.body.availableSlots;
      const startTimes = slots.map((s) => s.startTime);

      // Morning window: Bob works 10:00 to 13:00.
      // 90 min service: latest start is 11:30 (11:30 to 13:00).
      expect(startTimes).toContain('10:00');
      expect(startTimes).toContain('10:15');
      expect(startTimes).toContain('11:30');

      // 11:45 + 90m = 13:15 -> overlaps with Bob's 13:00 break! MUST NOT BE OFFERED!
      expect(startTimes).not.toContain('11:45');
      expect(startTimes).not.toContain('12:00');
      expect(startTimes).not.toContain('12:30');

      // Break window (13:00 - 14:00 Bob break, and 14:00 - 15:00 Salon break)
      expect(startTimes).not.toContain('13:00');
      expect(startTimes).not.toContain('13:30');
      expect(startTimes).not.toContain('14:00');
      expect(startTimes).not.toContain('14:30');

      // Afternoon window: Salon break ends at 15:00. Bob works until 18:00.
      // 90 min service: valid starts are 15:00 to 16:30 (16:30 + 90m = 18:00).
      expect(startTimes).toContain('15:00');
      expect(startTimes).toContain('16:30');
      // 16:45 + 90m = 18:15 -> exceeds Bob's 18:00 close! MUST NOT BE OFFERED!
      expect(startTimes).not.toContain('16:45');
      expect(startTimes).not.toContain('17:00');
    });

    it('should enforce Salon Break (14:00 - 15:00) on Stylist Alice even though she has no individual break', async () => {
      // Alice follows salon hours 09:00 - 21:00 with mandatory salon break 14:00 - 15:00
      const res = await request(app.getHttpServer())
        .get(`/api/v1/booking/${salonA.slug}/availability`)
        .query({
          serviceId: serviceColorA.id, // 90 min
          date: testDate,
          staffId: stylistAlice.id,
        })
        .expect(200);

      const startTimes = res.body.availableSlots.map((s: any) => s.startTime);

      // 12:30 + 90m = 14:00 (exact match before salon break) -> VALID
      expect(startTimes).toContain('12:30');

      // 12:45 + 90m = 14:15 -> overlaps 14:00 salon break! MUST NOT BE OFFERED!
      expect(startTimes).not.toContain('12:45');
      expect(startTimes).not.toContain('13:00');
      expect(startTimes).not.toContain('13:30');
      expect(startTimes).not.toContain('14:00');
      expect(startTimes).not.toContain('14:30');

      // Resumes at 15:00 after salon break
      expect(startTimes).toContain('15:00');
    });

    it('should show ONLY eligible stylists for a service', async () => {
      // Shave service (only Bob is assigned, Alice is NOT assigned)
      const res = await request(app.getHttpServer())
        .get(`/api/v1/booking/${salonA.slug}/availability`)
        .query({
          serviceId: serviceShaveA.id,
          date: testDate,
        })
        .expect(200);

      const slots = res.body.availableSlots;
      expect(slots.length).toBeGreaterThan(0);
      for (const slot of slots) {
        expect(slot.eligibleStaffIds).toContain(stylistBob.id);
        expect(slot.eligibleStaffIds).not.toContain(stylistAlice.id);
      }
    });
  });

  // ===========================================================================
  // 4. APPOINTMENT BOOKING FLOW & ZERO DOUBLE-BOOKING CONCURRENCY DEFENSE
  // ===========================================================================
  describe('4. Booking Flow, Auto-Customer Creation & Concurrency Defense', () => {
    const bookingDate = DateTime.now().setZone('Asia/Kolkata').plus({ days: 4 }).toISODate()!;
    let appt1: any;

    it('should create an appointment and auto-create global User and SalonUser records', async () => {
      const customerPhone = '+919988776655';
      const customerName = 'Pooja Sharma';

      const res = await request(app.getHttpServer())
        .post(`/api/v1/booking/${salonA.slug}/appointments`)
        .send({
          serviceId: serviceHaircutA.id,
          stylistId: stylistAlice.id,
          date: bookingDate,
          startTime: '10:00',
          customerName,
          customerPhone,
        })
        .expect(201);

      appt1 = res.body;
      expect(appt1.appointmentNumber).toMatch(/^SAL-\d+/);
      expect(appt1.status).toBe('CONFIRMED');

      // Verify User was created in DB
      const user = await prisma.user.findUnique({
        where: { phone: customerPhone },
      });
      expect(user).toBeDefined();
      expect(user!.name).toBe(customerName);

      // Verify SalonUser was created
      const salonUser = await prisma.salonUser.findUnique({
        where: { salonId_userId: { salonId: salonA.id, userId: user!.id } },
      });
      expect(salonUser).toBeDefined();

      // Verify Snapshot fields in Appointment
      const dbAppt = await prisma.appointment.findUnique({
        where: { id: appt1.appointmentId },
      });
      expect(dbAppt!.serviceNameSnapshot).toBe('Classic Haircut');
      expect(dbAppt!.durationMinutes).toBe(30);
      expect(Number(dbAppt!.price)).toBe(500);
    });

    it('should support back-to-back appointment booking immediately after previous slot', async () => {
      // Alice has 10:00 - 10:30 booked. Slot 10:30 must be immediately available for a 30m haircut!
      const res = await request(app.getHttpServer())
        .post(`/api/v1/booking/${salonA.slug}/appointments`)
        .send({
          serviceId: serviceHaircutA.id,
          stylistId: stylistAlice.id,
          date: bookingDate,
          startTime: '10:30',
          customerName: 'Anil Kapoor',
          customerPhone: '+919988776656',
        })
        .expect(201);

      expect(res.body.appointmentNumber).toBeDefined();
    });

    it('should PREVENT booking overlapping slot on the same stylist (Mathematical Defense)', async () => {
      // 10:00 - 10:30 is already booked. Attempting to book 10:15 should fail with 409 Conflict!
      const res = await request(app.getHttpServer())
        .post(`/api/v1/booking/${salonA.slug}/appointments`)
        .send({
          serviceId: serviceHaircutA.id,
          stylistId: stylistAlice.id,
          date: bookingDate,
          startTime: '10:00', // Already booked!
          customerName: 'Duplicate Attempter',
          customerPhone: '+919988776657',
        })
        .expect(409);

      expect(res.body.message).toContain('no longer available');
    });

    it('should handle CONCURRENT simultaneous bookings with advisory lock (Zero Double-Booking Guarantee)', async () => {
      const slotTime = '11:00';

      // Launch two concurrent requests for the exact same stylist and time
      const [res1, res2] = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/booking/${salonA.slug}/appointments`)
          .send({
            serviceId: serviceHaircutA.id,
            stylistId: stylistAlice.id,
            date: bookingDate,
            startTime: slotTime,
            customerName: 'Concurrent Client 1',
            customerPhone: '+919988776658',
          }),
        request(app.getHttpServer())
          .post(`/api/v1/booking/${salonA.slug}/appointments`)
          .send({
            serviceId: serviceHaircutA.id,
            stylistId: stylistAlice.id,
            date: bookingDate,
            startTime: slotTime,
            customerName: 'Concurrent Client 2',
            customerPhone: '+919988776659',
          }),
      ]);

      const statuses = [res1.status, res2.status];
      // Exactly one succeeds (201) and one receives Conflict (409)
      expect(statuses).toContain(201);
      expect(statuses).toContain(409);
    });

    it('should allow rescheduling an appointment to a valid future slot', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/appointments/${appt1.appointmentId}/reschedule`)
        .set('Authorization', `Bearer ${salonOwnerAToken}`)
        .send({
          newDate: bookingDate,
          newStartTime: '16:00',
          stylistId: stylistAlice.id,
        })
        .expect(201);

      expect(res.body.id).toBe(appt1.appointmentId);
      expect(res.body.status).toBe('CONFIRMED');
    });

    it('should allow cancelling an appointment and immediately release the slot', async () => {
      // Cancel the rescheduled appointment at 16:00
      await request(app.getHttpServer())
        .patch(`/api/v1/appointments/${appt1.appointmentId}/status`)
        .set('Authorization', `Bearer ${salonOwnerAToken}`)
        .send({
          status: AppointmentStatus.CANCELLED,
          reason: 'Customer requested cancellation',
        })
        .expect(200);

      // Verify that 16:00 is now free again for booking
      const res = await request(app.getHttpServer())
        .post(`/api/v1/booking/${salonA.slug}/appointments`)
        .send({
          serviceId: serviceHaircutA.id,
          stylistId: stylistAlice.id,
          date: bookingDate,
          startTime: '16:00',
          customerName: 'New Slot Beneficiary',
          customerPhone: '+919988776660',
        })
        .expect(201);

      expect(res.body.appointmentNumber).toBeDefined();
    });
  });
});
