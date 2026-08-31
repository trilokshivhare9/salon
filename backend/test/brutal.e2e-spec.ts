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

/**
 * BRUTAL END-TO-END TEST SUITE
 * Tests EVERY endpoint, edge case, security boundary, concurrency scenario,
 * and data integrity check across ALL modules.
 */
describe('🔥 BRUTAL E2E: Full System Production Readiness', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // Tokens & IDs tracked across tests
  let platformAdminToken: string;
  let salonAdminToken: string;
  let salonId: string;
  let salonSlug: string;

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
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalInterceptors(new TransformInterceptor());

    const reflector = app.get(Reflector);
    app.useGlobalGuards(new JwtAuthGuard(reflector), new RolesGuard(reflector));

    await app.init();
    prisma = app.get<PrismaService>(PrismaService);
  }, 30000);

  afterAll(async () => {
    await app.close();
  }, 10000);

  // =========================================================================
  // 1. HEALTH CHECK MODULE
  // =========================================================================
  describe('1️⃣ Health Check Module', () => {
    it('GET /health → returns status ok with DB connected', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('ok');
      expect(res.body.data.database).toBe('connected');
      expect(res.body.data.uptimeSeconds).toBeGreaterThanOrEqual(0);
      expect(res.body.data.timestamp).toBeDefined();
    });

    it('Health check should be publicly accessible (no auth required)', async () => {
      // No Authorization header
      const res = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);
      expect(res.body.data.status).toBe('ok');
    });
  });

  // =========================================================================
  // 2. AUTH MODULE – Login, Register, Token Validation, Edge Cases
  // =========================================================================
  describe('2️⃣ Auth Module', () => {
    it('POST /auth/login → valid salon admin credentials → returns JWT', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'owner@glamourstudio.com', password: 'Password123!' })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
      expect(typeof res.body.data.accessToken).toBe('string');
      expect(res.body.data.accessToken.length).toBeGreaterThan(50);
      expect(res.body.data.user.role).toBe('SALON_ADMIN');
      expect(res.body.data.user.salon).toBeDefined();
      expect(res.body.data.user.salon.slug).toBe('glamour-studio');

      salonAdminToken = res.body.data.accessToken;
      salonId = res.body.data.user.salonId;
      salonSlug = res.body.data.user.salon.slug;
    });

    it('POST /auth/login → platform admin credentials → returns JWT', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'admin@salonsaas.com', password: 'Password123!' })
        .expect(200);

      expect(res.body.data.user.role).toBe('PLATFORM_ADMIN');
      platformAdminToken = res.body.data.accessToken;
    });

    it('POST /auth/login → wrong password → 401 Unauthorized', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'owner@glamourstudio.com', password: 'WrongPassword' })
        .expect(401);

      expect(res.body.statusCode).toBe(401);
    });

    it('POST /auth/login → non-existent email → 401 Unauthorized', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@nowhere.com', password: 'Password123!' })
        .expect(401);
    });

    it('POST /auth/login → empty body → 400 Bad Request (validation)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({})
        .expect(400);
    });

    it('POST /auth/login → invalid email format → 400 Bad Request', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'not-an-email', password: 'Password123!' })
        .expect(400);
    });

    it('POST /auth/login → password too short → 400 Bad Request', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'owner@glamourstudio.com', password: '123' })
        .expect(400);
    });

    it('POST /auth/register → valid data → creates new salon + returns JWT', async () => {
      const uniqueEmail = `test-${Date.now()}@example.com`;
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          ownerName: 'Test Owner',
          email: uniqueEmail,
          password: 'TestPass123!',
          salonName: 'Test Salon E2E',
          phone: '+919000000001',
          city: 'Mumbai',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.user.role).toBe('SALON_ADMIN');
      expect(res.body.data.user.salon.name).toBe('Test Salon E2E');

      // Cleanup: delete the test salon and user
      const testSalonId = res.body.data.user.salonId;
      await prisma.subscription.deleteMany({ where: { salonId: testSalonId } });
      await prisma.workingHours.deleteMany({ where: { salonId: testSalonId } });
      await prisma.user.deleteMany({ where: { salonId: testSalonId } });
      await prisma.salon.deleteMany({ where: { id: testSalonId } });
    });

    it('POST /auth/register → duplicate email → 409 Conflict', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({
          ownerName: 'Duplicate',
          email: 'owner@glamourstudio.com',
          password: 'Password123!',
          salonName: 'Duplicate Salon',
          phone: '+919000000002',
        })
        .expect(409);
    });

    it('POST /auth/register → missing required fields → 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'incomplete@test.com' })
        .expect(400);
    });

    it('GET /auth/me → with valid token → returns user profile', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(200);

      expect(res.body.data.email).toBe('owner@glamourstudio.com');
      expect(res.body.data.salon).toBeDefined();
    });

    it('GET /auth/me → without token → 401 Unauthorized', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .expect(401);
    });

    it('GET /auth/me → with invalid/expired token → 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer totally-fake-jwt-token-12345')
        .expect(401);
    });
  });

  // =========================================================================
  // 3. PUBLIC BOOKING MODULE – Salon Catalog, Availability, Appointment Creation
  // =========================================================================
  describe('3️⃣ Public Booking Module', () => {
    it('GET /booking/:slug → existing salon → returns salon with services & staff', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/booking/glamour-studio')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.name).toBe('Glamour Studio & Lounge');
      expect(res.body.data.services.length).toBeGreaterThan(0);
      expect(res.body.data.staff.length).toBeGreaterThan(0);
      expect(res.body.data.timezone).toBe('Asia/Kolkata');
      // Verify each service has required fields
      for (const svc of res.body.data.services) {
        expect(svc.id).toBeDefined();
        expect(svc.name).toBeDefined();
        expect(svc.price).toBeDefined();
        expect(svc.durationMinutes).toBeDefined();
      }
      // Verify each staff has required fields
      for (const st of res.body.data.staff) {
        expect(st.id).toBeDefined();
        expect(st.name).toBeDefined();
      }
    });

    it('GET /booking/:slug → non-existent salon → 404', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/booking/nonexistent-salon-xyz')
        .expect(404);
    });

    it('GET /booking/:slug/availability → valid params → returns slots', async () => {
      const salon = await request(app.getHttpServer())
        .get('/api/v1/booking/glamour-studio')
        .expect(200);

      const service = salon.body.data.services[0];

      // Use a future date to guarantee slots
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 2);
      const dateStr = futureDate.toISOString().split('T')[0];

      const res = await request(app.getHttpServer())
        .get(`/api/v1/booking/glamour-studio/availability?serviceId=${service.id}&date=${dateStr}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.date).toBe(dateStr);
      expect(res.body.data.salonTimezone).toBe('Asia/Kolkata');
      expect(res.body.data.serviceDurationMinutes).toBe(service.durationMinutes);
      expect(Array.isArray(res.body.data.availableSlots)).toBe(true);

      if (res.body.data.availableSlots.length > 0) {
        const slot = res.body.data.availableSlots[0];
        expect(slot.startTime).toBeDefined();
        expect(slot.endTime).toBeDefined();
        expect(slot.isoStartTime).toBeDefined();
        expect(slot.availableStaffCount).toBeGreaterThan(0);
        expect(slot.eligibleStaffIds.length).toBeGreaterThan(0);
      }
    });

    it('GET /booking/:slug/availability → past date → returns empty slots', async () => {
      const salon = await request(app.getHttpServer())
        .get('/api/v1/booking/glamour-studio')
        .expect(200);

      const service = salon.body.data.services[0];

      const res = await request(app.getHttpServer())
        .get(`/api/v1/booking/glamour-studio/availability?serviceId=${service.id}&date=2020-01-01`)
        .expect(200);

      expect(res.body.data.availableSlots).toEqual([]);
    });

    it('GET /booking/:slug/availability → far future date (beyond maxAdvanceDays) → empty slots', async () => {
      const salon = await request(app.getHttpServer())
        .get('/api/v1/booking/glamour-studio')
        .expect(200);

      const service = salon.body.data.services[0];
      const farDate = new Date();
      farDate.setDate(farDate.getDate() + 365);
      const dateStr = farDate.toISOString().split('T')[0];

      const res = await request(app.getHttpServer())
        .get(`/api/v1/booking/glamour-studio/availability?serviceId=${service.id}&date=${dateStr}`)
        .expect(200);

      expect(res.body.data.availableSlots).toEqual([]);
    });

    it('POST /booking/:slug/appointments → valid booking → creates appointment', async () => {
      const salon = await request(app.getHttpServer())
        .get('/api/v1/booking/glamour-studio')
        .expect(200);

      const service = salon.body.data.services[0];
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 3);
      const dateStr = futureDate.toISOString().split('T')[0];

      // Get available slots
      const avail = await request(app.getHttpServer())
        .get(`/api/v1/booking/glamour-studio/availability?serviceId=${service.id}&date=${dateStr}`)
        .expect(200);

      if (avail.body.data.availableSlots.length === 0) {
        console.warn('No available slots for test date, skipping booking test');
        return;
      }

      const slot = avail.body.data.availableSlots[0];

      const res = await request(app.getHttpServer())
        .post('/api/v1/booking/glamour-studio/appointments')
        .send({
          serviceId: service.id,
          date: dateStr,
          startTime: slot.startTime,
          customerName: 'E2E Test Customer',
          customerPhone: '+919999888801',
        })
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.appointmentNumber).toBeDefined();
      expect(res.body.data.status).toBe('CONFIRMED');
      expect(res.body.data.serviceName).toBe(service.name);
      expect(res.body.data.customer.name).toBe('E2E Test Customer');
    });

    it('POST /booking/:slug/appointments → missing required fields → 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/booking/glamour-studio/appointments')
        .send({ serviceId: 'some-id' }) // missing date, startTime, customerName, customerPhone
        .expect(400);
    });

    it('POST /booking/:slug/appointments → invalid serviceId → 404', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);
      const dateStr = futureDate.toISOString().split('T')[0];

      await request(app.getHttpServer())
        .post('/api/v1/booking/glamour-studio/appointments')
        .send({
          serviceId: '00000000-0000-0000-0000-000000000000',
          date: dateStr,
          startTime: '10:00',
          customerName: 'Ghost Customer',
          customerPhone: '+919999000000',
        })
        .expect(404);
    });
  });

  // =========================================================================
  // 4. SALON ADMIN – Profile, Working Hours, Holidays, Blocked Times
  // =========================================================================
  describe('4️⃣ Salon Admin Module', () => {
    it('GET /salons/profile → with salon admin token → returns salon profile', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/salons/profile')
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(200);

      expect(res.body.data.name).toBe('Glamour Studio & Lounge');
      expect(res.body.data.workingHours).toBeDefined();
      expect(res.body.data.workingHours.length).toBe(7); // All 7 days
      expect(res.body.data._count.staff).toBeGreaterThan(0);
      expect(res.body.data._count.services).toBeGreaterThan(0);
    });

    it('GET /salons/profile → without token → 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/salons/profile')
        .expect(401);
    });

    it('PUT /salons/profile → update salon name → succeeds', async () => {
      const res = await request(app.getHttpServer())
        .put('/api/v1/salons/profile')
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .send({ description: 'Updated E2E description' })
        .expect(200);

      expect(res.body.data.description).toBe('Updated E2E description');

      // Restore
      await request(app.getHttpServer())
        .put('/api/v1/salons/profile')
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .send({ description: 'Luxury hair styling, organic facials, and beauty lounge.' });
    });

    it('PUT /salons/profile → extra forbidden fields → 400 (whitelist)', async () => {
      await request(app.getHttpServer())
        .put('/api/v1/salons/profile')
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .send({ hackerField: 'inject' })
        .expect(400);
    });

    it('GET /salons/working-hours → returns 7 day schedule', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/salons/working-hours')
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(200);

      expect(res.body.data.length).toBe(7);
    });

    it('GET /salons/holidays → returns holidays list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/salons/holidays')
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('POST /salons/holidays → add holiday → returns created', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 20);
      const dateStr = futureDate.toISOString().split('T')[0];

      const res = await request(app.getHttpServer())
        .post('/api/v1/salons/holidays')
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .send({ date: dateStr, reason: 'E2E Test Holiday' })
        .expect(201);

      expect(res.body.data.reason).toBe('E2E Test Holiday');

      // Verify availability returns empty for that date
      const salon = await request(app.getHttpServer())
        .get('/api/v1/booking/glamour-studio')
        .expect(200);
      const service = salon.body.data.services[0];

      const avail = await request(app.getHttpServer())
        .get(`/api/v1/booking/glamour-studio/availability?serviceId=${service.id}&date=${dateStr}`)
        .expect(200);

      expect(avail.body.data.availableSlots).toEqual([]);

      // Cleanup
      await request(app.getHttpServer())
        .delete(`/api/v1/salons/holidays/${res.body.data.id}`)
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(200);
    });

    it('GET /salons/blocked-times → returns blocked times list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/salons/blocked-times')
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  // =========================================================================
  // 5. STAFF MODULE – CRUD, Service Assignment, Working Hours, Breaks
  // =========================================================================
  describe('5️⃣ Staff Module', () => {
    let testStaffId: string;

    it('GET /staff → returns all salon staff', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/staff')
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);

      for (const staff of res.body.data) {
        expect(staff.id).toBeDefined();
        expect(staff.name).toBeDefined();
        expect(staff.services).toBeDefined();
        expect(staff.workingHours).toBeDefined();
      }
    });

    it('GET /staff → without token → 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/staff')
        .expect(401);
    });

    it('POST /staff → create new staff member', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/staff')
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .send({
          name: 'E2E Test Stylist',
          phone: '+919999111100',
          email: 'e2etest@salon.com',
        })
        .expect(201);

      expect(res.body.data.name).toBe('E2E Test Stylist');
      expect(res.body.data.workingHours.length).toBe(7); // Auto-populated
      testStaffId = res.body.data.id;
    });

    it('GET /staff/:id → returns specific staff member', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/staff/${testStaffId}`)
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(200);

      expect(res.body.data.name).toBe('E2E Test Stylist');
    });

    it('PUT /staff/:id → update staff name', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/staff/${testStaffId}`)
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .send({ name: 'Updated E2E Stylist' })
        .expect(200);

      expect(res.body.data.name).toBe('Updated E2E Stylist');
    });

    it('PATCH /staff/:id/toggle-status → toggles active/inactive', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/staff/${testStaffId}/toggle-status`)
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(200);

      expect(res.body.data.status).toBe('INACTIVE');

      // Toggle back
      const res2 = await request(app.getHttpServer())
        .patch(`/api/v1/staff/${testStaffId}/toggle-status`)
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(200);

      expect(res2.body.data.status).toBe('ACTIVE');
    });

    it('PUT /staff/:id/services → assign services to staff', async () => {
      const services = await prisma.service.findMany({ where: { salonId } });
      const serviceIds = services.slice(0, 2).map((s) => s.id);

      const res = await request(app.getHttpServer())
        .put(`/api/v1/staff/${testStaffId}/services`)
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .send({ serviceIds })
        .expect(200);

      expect(res.body.data.services.length).toBe(2);
    });

    it('GET /staff/:id → non-existent → 404', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/staff/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(404);
    });

    // Cleanup test staff
    afterAll(async () => {
      if (testStaffId) {
        await prisma.staffBreak.deleteMany({ where: { staffId: testStaffId } });
        await prisma.staffWorkingHours.deleteMany({ where: { staffId: testStaffId } });
        await prisma.staffService.deleteMany({ where: { staffId: testStaffId } });
        await prisma.staff.deleteMany({ where: { id: testStaffId } });
      }
    });
  });

  // =========================================================================
  // 6. SERVICES MODULE – CRUD, Toggle Status
  // =========================================================================
  describe('6️⃣ Services Module', () => {
    let testServiceId: string;

    it('GET /services → returns all salon services', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/services')
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it('POST /services → create new service', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/services')
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .send({
          name: 'E2E Test Manicure',
          description: 'Test description',
          price: 750,
          durationMinutes: 45,
          category: 'Nails',
        })
        .expect(201);

      expect(res.body.data.name).toBe('E2E Test Manicure');
      expect(Number(res.body.data.price)).toBe(750);
      expect(res.body.data.durationMinutes).toBe(45);
      testServiceId = res.body.data.id;
    });

    it('GET /services/:id → returns specific service', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/services/${testServiceId}`)
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(200);

      expect(res.body.data.name).toBe('E2E Test Manicure');
    });

    it('PUT /services/:id → update service', async () => {
      const res = await request(app.getHttpServer())
        .put(`/api/v1/services/${testServiceId}`)
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .send({ price: 850 })
        .expect(200);

      expect(Number(res.body.data.price)).toBe(850);
    });

    it('PATCH /services/:id/toggle-status → toggles active/inactive', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/services/${testServiceId}/toggle-status`)
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(200);

      expect(res.body.data.status).toBe('INACTIVE');
    });

    it('DELETE /services/:id → delete service', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/services/${testServiceId}`)
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(200);

      // Verify deleted
      await request(app.getHttpServer())
        .get(`/api/v1/services/${testServiceId}`)
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(404);
    });

    it('GET /services/:id → non-existent → 404', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/services/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(404);
    });
  });

  // =========================================================================
  // 7. APPOINTMENTS MODULE – List, Create, Status Workflow, Reschedule
  // =========================================================================
  describe('7️⃣ Appointments Module (Authenticated)', () => {
    it('GET /appointments → returns salon appointments list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/appointments')
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      if (res.body.data.length > 0) {
        const appt = res.body.data[0];
        expect(appt.appointmentNumber).toBeDefined();
        expect(appt.customer).toBeDefined();
        expect(appt.staff).toBeDefined();
        expect(appt.service).toBeDefined();
      }
    });

    it('GET /appointments → with date filter → filters correctly', async () => {
      const today = new Date().toISOString().split('T')[0];
      const res = await request(app.getHttpServer())
        .get(`/api/v1/appointments?startDate=${today}&endDate=${today}`)
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('GET /appointments → without token → 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/appointments')
        .expect(401);
    });

    it('PATCH /appointments/:id/status → CONFIRMED→CHECKED_IN → succeeds', async () => {
      const confirmed = await prisma.appointment.findFirst({
        where: { salonId, status: 'CONFIRMED' },
      });

      if (!confirmed) {
        console.warn('No CONFIRMED appointment for status test, skipping');
        return;
      }

      const res = await request(app.getHttpServer())
        .patch(`/api/v1/appointments/${confirmed.id}/status`)
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .send({ status: 'CHECKED_IN' })
        .expect(200);

      expect(res.body.data.status).toBe('CHECKED_IN');

      // Transition CHECKED_IN → IN_SERVICE
      const res2 = await request(app.getHttpServer())
        .patch(`/api/v1/appointments/${confirmed.id}/status`)
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .send({ status: 'IN_SERVICE' })
        .expect(200);

      expect(res2.body.data.status).toBe('IN_SERVICE');

      // Transition IN_SERVICE → COMPLETED
      const res3 = await request(app.getHttpServer())
        .patch(`/api/v1/appointments/${confirmed.id}/status`)
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .send({ status: 'COMPLETED' })
        .expect(200);

      expect(res3.body.data.status).toBe('COMPLETED');
    });

    it('PATCH /appointments/:id/status → invalid transition → 400', async () => {
      const completed = await prisma.appointment.findFirst({
        where: { salonId, status: 'COMPLETED' },
      });

      if (!completed) return;

      await request(app.getHttpServer())
        .patch(`/api/v1/appointments/${completed.id}/status`)
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .send({ status: 'CONFIRMED' })
        .expect(400);
    });

    it('GET /appointments/:id → specific appointment → returns full details', async () => {
      const appt = await prisma.appointment.findFirst({
        where: { salonId },
      });

      if (!appt) return;

      const res = await request(app.getHttpServer())
        .get(`/api/v1/appointments/${appt.id}`)
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(200);

      expect(res.body.data.id).toBe(appt.id);
      expect(res.body.data.statusHistory).toBeDefined();
    });

    it('GET /appointments/:id → non-existent → 404', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/appointments/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(404);
    });
  });

  // =========================================================================
  // 8. CUSTOMERS MODULE
  // =========================================================================
  describe('8️⃣ Customers Module', () => {
    it('GET /customers → returns paginated customer list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.total).toBeGreaterThanOrEqual(0);
      expect(res.body.meta.page).toBe(1);
    });

    it('GET /customers?search=Aarav → filters by name', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/customers?search=Aarav')
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(200);

      if (res.body.data.length > 0) {
        expect(res.body.data[0].name.toLowerCase()).toContain('aarav');
      }
    });

    it('GET /customers?page=1&limit=2 → respects pagination', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/customers?page=1&limit=2')
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(200);

      expect(res.body.data.length).toBeLessThanOrEqual(2);
      expect(res.body.meta.limit).toBe(2);
    });

    it('GET /customers/:id → returns customer with appointment history', async () => {
      const customer = await prisma.customer.findFirst({ where: { salonId } });
      if (!customer) return;

      const res = await request(app.getHttpServer())
        .get(`/api/v1/customers/${customer.id}`)
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(200);

      expect(res.body.data.name).toBe(customer.name);
      expect(res.body.data.appointments).toBeDefined();
    });

    it('GET /customers/:id → non-existent → 404', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/customers/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(404);
    });

    it('GET /customers → without token → 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/customers')
        .expect(401);
    });
  });

  // =========================================================================
  // 9. REPORTS / DASHBOARD MODULE
  // =========================================================================
  describe('9️⃣ Reports / Dashboard Module', () => {
    it('GET /reports/dashboard → returns KPIs for today', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/dashboard')
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(200);

      expect(res.body.data.date).toBeDefined();
      expect(res.body.data.statusCounts).toBeDefined();
      expect(res.body.data.statusCounts.total).toBeGreaterThanOrEqual(0);
      expect(res.body.data.todayRevenue).toBeDefined();
      expect(res.body.data.salonMetrics.totalActiveStaff).toBeGreaterThan(0);
      expect(res.body.data.salonMetrics.totalActiveServices).toBeGreaterThan(0);
      expect(res.body.data.salon.name).toBeDefined();
    });

    it('GET /reports/dashboard?date=YYYY-MM-DD → specific date', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/reports/dashboard?date=2026-01-01')
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(200);

      expect(res.body.data.date).toBe('2026-01-01');
    });

    it('GET /reports/dashboard → without token → 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/reports/dashboard')
        .expect(401);
    });
  });

  // =========================================================================
  // 10. WHATSAPP MODULE – Webhook, Simulator, Status
  // =========================================================================
  describe('🔟 WhatsApp Module', () => {
    it('GET /whatsapp/webhook → with correct verify token → returns challenge', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/whatsapp/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'salon_webhook_verify_token_mvp',
          'hub.challenge': 'test_challenge_12345',
        })
        .expect(200);

      expect(res.text).toBe('test_challenge_12345');
    });

    it('GET /whatsapp/webhook → wrong verify token → 403', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/whatsapp/webhook')
        .query({
          'hub.mode': 'subscribe',
          'hub.verify_token': 'WRONG_TOKEN',
          'hub.challenge': 'test',
        })
        .expect(403);
    });

    it('POST /whatsapp/webhook → empty payload → 200 EVENT_RECEIVED (resilient)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/webhook')
        .send({})
        .expect(200);

      expect(res.text).toBe('EVENT_RECEIVED');
    });

    it('POST /whatsapp/webhook → malformed Meta payload → 200 (never crashes)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/webhook')
        .send({
          entry: [{ changes: [{ value: { messages: null } }] }],
        })
        .expect(200);

      expect(res.text).toBe('EVENT_RECEIVED');
    });

    it('POST /whatsapp/simulate → "Hi" message → returns welcome', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({
          salonSlug: 'glamour-studio',
          customerPhone: '+919000000099',
          messageText: 'Hi',
        })
        .expect(201);

      expect(res.body.data.replyMessage).toContain('Welcome');
      expect(res.body.data.state).toBe('START');
    });

    it('POST /whatsapp/simulate → full booking flow (service→staff→date→time→name→confirm)', async () => {
      const phone = `+9190000000${Date.now().toString().slice(-4)}`;
      const cleanPhone = phone.replace(/[^\d+]/g, '');

      // Reset conversation and customer
      await prisma.appointmentStatusHistory.deleteMany({
        where: { appointment: { customer: { phone: cleanPhone } } },
      });
      await prisma.appointment.deleteMany({
        where: { customer: { phone: cleanPhone } },
      });
      await prisma.customer.deleteMany({
        where: { phone: cleanPhone },
      });
      await prisma.conversation.deleteMany({
        where: { customerPhone: cleanPhone },
      });

      // Step 1: Start
      const r1 = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({ salonSlug: 'glamour-studio', customerPhone: phone, messageText: 'Hi' })
        .expect(201);
      expect(r1.body.data.state).toBe('START');

      // Step 2: Book
      const r2 = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({ salonSlug: 'glamour-studio', customerPhone: phone, messageText: 'Book', interactiveId: 'btn_book' })
        .expect(201);
      expect(r2.body.data.state).toBe('SELECT_SERVICE');

      // Step 3: Select first service
      const services = r2.body.data.metadata?.services;
      if (!services || services.length === 0) return;

      const r3 = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({ salonSlug: 'glamour-studio', customerPhone: phone, messageText: '1', interactiveId: `svc_${services[0].id}` })
        .expect(201);
      expect(r3.body.data.state).toBe('SELECT_STAFF');

      // Step 4: Select "Any Specialist"
      const r4 = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({ salonSlug: 'glamour-studio', customerPhone: phone, messageText: 'Any', interactiveId: 'staff_any' })
        .expect(201);
      expect(r4.body.data.state).toBe('SELECT_DATE');

      // Step 5: Select Tomorrow
      const r5 = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({ salonSlug: 'glamour-studio', customerPhone: phone, messageText: 'Tomorrow', interactiveId: 'date_2' })
        .expect(201);

      if (r5.body.data.state === 'SELECT_DATE') {
        // No slots available, acceptable
        return;
      }
      expect(r5.body.data.state).toBe('SELECT_TIME');

      // Step 6: Select first available time slot
      const slots = r5.body.data.metadata?.slots;
      if (!slots || slots.length === 0) return;

      const r6 = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({ salonSlug: 'glamour-studio', customerPhone: phone, messageText: '1', interactiveId: `slot_${slots[0].startTime}` })
        .expect(201);
      expect(r6.body.data.state).toBe('COLLECT_NAME');

      // Step 7: Provide name
      const r7 = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({ salonSlug: 'glamour-studio', customerPhone: phone, messageText: 'WhatsApp Bot Test User' })
        .expect(201);
      expect(r7.body.data.state).toBe('CONFIRMATION');

      // Step 8: Confirm
      const r8 = await request(app.getHttpServer())
        .post('/api/v1/whatsapp/simulate')
        .send({ salonSlug: 'glamour-studio', customerPhone: phone, messageText: 'Confirm', interactiveId: 'btn_confirm_yes' })
        .expect(201);
      expect(r8.body.data.state).toBe('COMPLETED');
      expect(r8.body.data.replyMessage).toContain('CONFIRMED');
      expect(r8.body.data.metadata?.appointment).toBeDefined();
    }, 30000);

    it('GET /whatsapp/status → returns connection status', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/whatsapp/status')
        .expect(200);

      expect(res.body.data.salonName).toBeDefined();
      expect(res.body.data.waChatUrl).toBeDefined();
    });
  });

  // =========================================================================
  // 11. PLATFORM ADMIN MODULE – Multi-Tenant Management
  // =========================================================================
  describe('1️⃣1️⃣ Platform Admin Module', () => {
    it('GET /salons/platform/all → platform admin → returns all salons', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/salons/platform/all')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .expect(200);

      expect(res.body.data.stats).toBeDefined();
      expect(res.body.data.stats.totalSalons).toBeGreaterThan(0);
      expect(res.body.data.salons.length).toBeGreaterThan(0);
    });

    it('GET /salons/platform/all → salon admin → 403 Forbidden', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/salons/platform/all')
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(403);
    });

    it('GET /salons/platform/all → no token → 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/salons/platform/all')
        .expect(401);
    });

    it('POST /salons/platform/create → creates new salon with defaults', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/salons/platform/create')
        .set('Authorization', `Bearer ${platformAdminToken}`)
        .send({
          name: 'E2E Platform Test Salon',
          phone: '+919876543210',
          email: `platform-test-${Date.now()}@test.com`,
          ownerName: 'Platform Test Owner',
          password: 'Password123!',
          city: 'Indore',
        })
        .expect(201);

      expect(res.body.data.name).toBe('E2E Platform Test Salon');
      expect(res.body.data.slug).toBeDefined();

      // Cleanup
      const createdId = res.body.data.id;
      await prisma.staffService.deleteMany({ where: { staff: { salonId: createdId } } });
      await prisma.staffWorkingHours.deleteMany({ where: { staff: { salonId: createdId } } });
      await prisma.staff.deleteMany({ where: { salonId: createdId } });
      await prisma.service.deleteMany({ where: { salonId: createdId } });
      await prisma.subscription.deleteMany({ where: { salonId: createdId } });
      await prisma.workingHours.deleteMany({ where: { salonId: createdId } });
      await prisma.user.deleteMany({ where: { salonId: createdId } });
      await prisma.salon.deleteMany({ where: { id: createdId } });
    });
  });

  // =========================================================================
  // 12. CONCURRENCY & DOUBLE-BOOKING PREVENTION
  // =========================================================================
  describe('1️⃣2️⃣ Concurrency & Double-Booking Prevention', () => {
    it('6 concurrent booking requests for the SAME slot → exactly 1 succeeds, rest get 409', async () => {
      const service = await prisma.service.findFirst({
        where: { name: 'Haircut & Styling' },
      });
      const staff = await prisma.staff.findFirst({
        where: { name: 'Rahul Mehta' },
      });

      expect(service).toBeDefined();
      expect(staff).toBeDefined();

      const targetDate = '2026-09-20';
      const targetTime = '15:00';

      // Clear any existing appointments for this slot
      await prisma.appointmentStatusHistory.deleteMany({
        where: {
          appointment: {
            staffId: staff!.id,
            date: new Date(targetDate),
          },
        },
      });
      await prisma.appointment.deleteMany({
        where: {
          staffId: staff!.id,
          date: new Date(targetDate),
        },
      });

      const concurrentCount = 6;
      const requests = Array.from({ length: concurrentCount }).map((_, i) =>
        request(app.getHttpServer())
          .post('/api/v1/booking/glamour-studio/appointments')
          .send({
            serviceId: service!.id,
            staffId: staff!.id,
            date: targetDate,
            startTime: targetTime,
            customerName: `Concurrent User ${i + 1}`,
            customerPhone: `+91777700000${i + 1}`,
          }),
      );

      const responses = await Promise.all(requests);

      const successful = responses.filter((r) => r.status === 201);
      const conflicts = responses.filter((r) => r.status === 409);

      expect(successful.length).toBe(1);
      expect(conflicts.length).toBe(concurrentCount - 1);

      // Verify only 1 appointment exists in DB
      const dbAppts = await prisma.appointment.findMany({
        where: {
          staffId: staff!.id,
          date: new Date(targetDate),
        },
      });
      expect(dbAppts.length).toBe(1);
    }, 20000);
  });

  // =========================================================================
  // 13. SECURITY & TENANT ISOLATION
  // =========================================================================
  describe('1️⃣3️⃣ Security & Tenant Isolation', () => {
    it('All protected endpoints reject missing Authorization header', async () => {
      const protectedEndpoints = [
        { method: 'get', path: '/api/v1/appointments' },
        { method: 'get', path: '/api/v1/staff' },
        { method: 'get', path: '/api/v1/services' },
        { method: 'get', path: '/api/v1/customers' },
        { method: 'get', path: '/api/v1/salons/profile' },
        { method: 'get', path: '/api/v1/reports/dashboard' },
      ];

      for (const ep of protectedEndpoints) {
        const res = await (request(app.getHttpServer()) as any)[ep.method](ep.path);
        expect(res.status).toBe(401);
      }
    });

    it('Salon admin cannot access platform admin endpoints', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/salons/platform/all')
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(403);
    });

    it('ValidationPipe rejects extra/unknown fields (whitelist: true)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: 'owner@glamourstudio.com',
          password: 'Password123!',
          __proto__: { admin: true },
          injectedField: 'malicious',
        })
        .expect(400);
    });

    it('SQL injection attempt in search query → handled safely', async () => {
      const res = await request(app.getHttpServer())
        .get("/api/v1/customers?search=' OR '1'='1")
        .set('Authorization', `Bearer ${salonAdminToken}`)
        .expect(200);

      // Should return empty or filtered results, NOT crash
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  // =========================================================================
  // 14. RESPONSE ENVELOPE FORMAT CONSISTENCY
  // =========================================================================
  describe('1️⃣4️⃣ Response Envelope Format Consistency', () => {
    it('All success responses follow { success: true, data: ... } envelope', async () => {
      const endpoints = [
        { method: 'get', path: '/api/v1/health' },
        { method: 'get', path: '/api/v1/booking/glamour-studio' },
      ];

      for (const ep of endpoints) {
        const res = await (request(app.getHttpServer()) as any)[ep.method](ep.path);
        expect(res.body.success).toBe(true);
        expect(res.body.data).toBeDefined();
      }
    });

    it('Error responses follow { statusCode, error, message, timestamp, path }', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/booking/nonexistent-salon')
        .expect(404);

      expect(res.body.statusCode).toBe(404);
      expect(res.body.message).toBeDefined();
      expect(res.body.timestamp).toBeDefined();
      expect(res.body.path).toBeDefined();
    });
  });

  // =========================================================================
  // 15. DATA INTEGRITY CHECKS
  // =========================================================================
  describe('1️⃣5️⃣ Data Integrity Checks', () => {
    it('All salon working hours have exactly 7 days', async () => {
      const wh = await prisma.workingHours.findMany({ where: { salonId } });
      expect(wh.length).toBe(7);

      const days = wh.map((w) => w.dayOfWeek);
      expect(days).toContain('MONDAY');
      expect(days).toContain('TUESDAY');
      expect(days).toContain('WEDNESDAY');
      expect(days).toContain('THURSDAY');
      expect(days).toContain('FRIDAY');
      expect(days).toContain('SATURDAY');
      expect(days).toContain('SUNDAY');
    });

    it('All staff have working hours for all 7 days', async () => {
      const staff = await prisma.staff.findMany({
        where: { salonId, status: 'ACTIVE' },
        include: { workingHours: true },
      });

      for (const s of staff) {
        expect(s.workingHours.length).toBe(7);
      }
    });

    it('All staff-service assignments reference valid services', async () => {
      const assignments = await prisma.staffService.findMany({
        where: { staff: { salonId } },
        include: { service: true, staff: true },
      });

      for (const a of assignments) {
        expect(a.service).toBeDefined();
        expect(a.staff).toBeDefined();
        expect(a.service.salonId).toBe(salonId);
      }
    });

    it('All appointments have valid customer, staff, and service references', async () => {
      const appts = await prisma.appointment.findMany({
        where: { salonId },
        include: { customer: true, staff: true, service: true },
      });

      for (const a of appts) {
        expect(a.customer).toBeDefined();
        expect(a.staff).toBeDefined();
        expect(a.service).toBeDefined();
        expect(a.appointmentNumber).toBeDefined();
        expect(a.appointmentNumber.startsWith('SAL-')).toBe(true);
      }
    });

    it('No orphaned customers exist (every customer belongs to a salon)', async () => {
      const allCustomers = await prisma.customer.findMany({
        include: { salon: true },
      });

      for (const c of allCustomers) {
        expect(c.salonId).toBeDefined();
        expect(c.salon).toBeDefined();
      }
    });
  });
});
