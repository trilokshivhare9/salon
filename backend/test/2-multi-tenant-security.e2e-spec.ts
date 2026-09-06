import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { AdminRole, DayOfWeek } from '@prisma/client';
import * as bcrypt from 'bcrypt';

describe('Suite 2: Multi-Tenant Salon Isolation & Security Injection Attacks (Sections 4 & 32)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  let superAdminToken: string;
  let salonAOwnerToken: string;
  let salonBOwnerToken: string;

  let salonA: any;
  let salonB: any;
  let salonC: any;

  let serviceA: any;
  let serviceB: any;
  let stylistA: any;
  let stylistB: any;

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

    // 1. Create Super Admin
    const passwordHash = await bcrypt.hash('Password123!', 10);
    const superAdmin = await prisma.admin.upsert({
      where: { email: 'sec-superadmin@salonsaas.com' },
      update: {},
      create: {
        email: 'sec-superadmin@salonsaas.com',
        name: 'Security Super Admin',
        passwordHash,
        role: AdminRole.SUPER_ADMIN,
      },
    });

    const superRes = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'sec-superadmin@salonsaas.com', password: 'Password123!' })
      .expect(200);
    superAdminToken = superRes.body.accessToken;

    // 2. Provision Salon A, Salon B, and Salon C
    const ownerEmailA = `owner-alpha-${Date.now()}@salons.com`;
    const resA = await request(app.getHttpServer())
      .post('/api/v1/salons/platform/create')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        name: 'Sec Salon Alpha',
        city: 'Mumbai',
        phone: '9111111111',
        ownerName: 'Owner Alpha',
        email: ownerEmailA,
        password: 'Password123!',
      })
      .expect(201);
    salonA = resA.body;

    const ownerEmailB = `owner-beta-${Date.now()}@salons.com`;
    const resB = await request(app.getHttpServer())
      .post('/api/v1/salons/platform/create')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        name: 'Sec Salon Beta',
        city: 'Delhi',
        phone: '9222222222',
        ownerName: 'Owner Beta',
        email: ownerEmailB,
        password: 'Password123!',
      })
      .expect(201);
    salonB = resB.body;

    const ownerEmailC = `owner-gamma-${Date.now()}@salons.com`;
    const resC = await request(app.getHttpServer())
      .post('/api/v1/salons/platform/create')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        name: 'Sec Salon Gamma',
        city: 'Bangalore',
        phone: '9333333333',
        ownerName: 'Owner Gamma',
        email: ownerEmailC,
        password: 'Password123!',
      })
      .expect(201);
    salonC = resC.body;

    // Authenticate Salon A Owner
    const loginA = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmailA, password: 'Password123!' })
      .expect(200);
    salonAOwnerToken = loginA.body.accessToken;

    // Authenticate Salon B Owner
    const loginB = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: ownerEmailB, password: 'Password123!' })
      .expect(200);
    salonBOwnerToken = loginB.body.accessToken;

    // Create Service A in Salon A
    const sResA = await request(app.getHttpServer())
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${salonAOwnerToken}`)
      .send({
        name: 'Alpha Haircut',
        durationMinutes: 30,
        price: 500,
      })
      .expect(201);
    serviceA = sResA.body;

    // Create Service B in Salon B
    const sResB = await request(app.getHttpServer())
      .post('/api/v1/services')
      .set('Authorization', `Bearer ${salonBOwnerToken}`)
      .send({
        name: 'Beta Beard Trim',
        durationMinutes: 45,
        price: 300,
      })
      .expect(201);
    serviceB = sResB.body;

    // Create Stylist A in Salon A
    const stResA = await request(app.getHttpServer())
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${salonAOwnerToken}`)
      .send({
        name: 'Stylist Alpha 1',
        phone: '+919111111199',
        serviceIds: [serviceA.id],
      })
      .expect(201);
    stylistA = stResA.body;

    // Create Stylist B in Salon B
    const stResB = await request(app.getHttpServer())
      .post('/api/v1/staff')
      .set('Authorization', `Bearer ${salonBOwnerToken}`)
      .send({
        name: 'Stylist Beta 1',
        phone: '+919222222299',
        serviceIds: [serviceB.id],
      })
      .expect(201);
    stylistB = stResB.body;
  });

  afterAll(async () => {
    try {
      const salonIds = [salonA?.id, salonB?.id, salonC?.id].filter(Boolean);
      await prisma.appointment.deleteMany({ where: { salonId: { in: salonIds } } });
      await prisma.stylistService.deleteMany({
        where: { stylistId: { in: [stylistA?.id, stylistB?.id].filter(Boolean) } },
      });
      await prisma.stylist.deleteMany({ where: { salonId: { in: salonIds } } });
      await prisma.service.deleteMany({ where: { salonId: { in: salonIds } } });
      await prisma.salonWorkingHours.deleteMany({ where: { salonId: { in: salonIds } } });
      await prisma.salonUser.deleteMany({ where: { salonId: { in: salonIds } } });
      await prisma.admin.deleteMany({ where: { salonId: { in: salonIds } } });
      await prisma.salon.deleteMany({ where: { id: { in: salonIds } } });
      await prisma.admin.deleteMany({ where: { email: 'sec-superadmin@salonsaas.com' } });
    } catch (e) {
      // Best-effort cleanup
    }
    await app.close();
  });

  describe('1. Cross-Tenant Data Tampering Attacks (Strict Isolation)', () => {
    it('should REJECT booking a Salon A appointment using Salon B stylist', async () => {
      // Malicious attempt: Booking on Salon A with stylistB (belongs to Salon B)
      const res = await request(app.getHttpServer())
        .post(`/api/v1/booking/${salonA.slug}/appointments`)
        .send({
          serviceId: serviceA.id,
          stylistId: stylistB.id, // MALICIOUS CROSS-TENANT STYLIST
          date: '2026-09-12',
          startTime: '11:00',
          customerName: 'Attacker',
          customerPhone: '+919999999901',
        })
        .expect(409); // Rejected because stylistB is not eligible/available for Salon A

      expect(res.body.message).toMatch(/longer available|not available|not found/i);
    });

    it('should REJECT booking a Salon A appointment using Salon B service', async () => {
      // Malicious attempt: Booking on Salon A with serviceB (belongs to Salon B)
      const res = await request(app.getHttpServer())
        .post(`/api/v1/booking/${salonA.slug}/appointments`)
        .send({
          serviceId: serviceB.id, // MALICIOUS CROSS-TENANT SERVICE
          stylistId: stylistA.id,
          date: '2026-09-12',
          startTime: '11:00',
          customerName: 'Attacker',
          customerPhone: '+919999999902',
        })
        .expect(404); // Rejected because serviceB does not exist in Salon A

      expect(res.body.message).toMatch(/service.*not found|inactive/i);
    });

    it('should REJECT assigning Salon B service to Salon A stylist', async () => {
      // Salon A owner attempts to attach serviceB to a new stylist
      const res = await request(app.getHttpServer())
        .post('/api/v1/staff')
        .set('Authorization', `Bearer ${salonAOwnerToken}`)
        .send({
          name: 'Trojan Stylist',
          phone: '+919111111188',
          serviceIds: [serviceB.id], // CROSS-TENANT SERVICE ID
        })
        .expect(400);

      expect(res.body.message).toContain('belong to this salon');
    });

    it('should PREVENT Salon A Owner from accessing Salon B appointments', async () => {
      // Salon A owner token calling appointments endpoint with salonId of Salon B
      const res = await request(app.getHttpServer())
        .get(`/api/v1/appointments?salonId=${salonB.id}`)
        .set('Authorization', `Bearer ${salonAOwnerToken}`)
        .expect(200);

      // The controller must scope results to the authenticated user's salon (Salon A), returning 0 Salon B records!
      const records = res.body.data || res.body;
      const leakedFromB = Array.isArray(records)
        ? records.filter((r: any) => r.salonId === salonB.id)
        : [];
      expect(leakedFromB.length).toBe(0);
    });

    it('should PREVENT Salon A Owner from modifying or deleting Salon B service', async () => {
      // Salon A owner attempts to delete serviceB
      await request(app.getHttpServer())
        .delete(`/api/v1/services/${serviceB.id}`)
        .set('Authorization', `Bearer ${salonAOwnerToken}`)
        .expect(404); // Scoped where: { id, salonId } returns 404
    });

    it('should PREVENT Salon A Owner from modifying Salon B stylist', async () => {
      // Salon A owner attempts to update stylistB
      await request(app.getHttpServer())
        .patch(`/api/v1/staff/${stylistB.id}`)
        .set('Authorization', `Bearer ${salonAOwnerToken}`)
        .send({ name: 'Hacked Stylist' })
        .expect(404); // Scoped where: { id, salonId } returns 404
    });
  });

  describe('2. Security & Injection Defense', () => {
    it('should neutralize SQL injection attack in customer name and search fields', async () => {
      const sqlInjectionPayload = "Robert'); DROP TABLE appointments; --";
      const res = await request(app.getHttpServer())
        .post(`/api/v1/booking/${salonA.slug}/appointments`)
        .send({
          serviceId: serviceA.id,
          stylistId: stylistA.id,
          date: '2026-09-12',
          startTime: '10:00',
          customerName: sqlInjectionPayload,
          customerPhone: '+919999999903',
        })
        .expect(201);

      expect(res.body.appointmentNumber).toBeDefined();

      // Verify appointments table is intact and the string was safely parameterized
      const apptCount = await prisma.appointment.count();
      expect(apptCount).toBeGreaterThan(0);

      const user = await prisma.user.findUnique({ where: { phone: '+919999999903' } });
      expect(user!.name).toBe(sqlInjectionPayload);
    });

    it('should safely store XSS payload without raw execution or backend crash', async () => {
      const xssPayload = `<script>alert('XSS Attack!')</script>`;
      const res = await request(app.getHttpServer())
        .post(`/api/v1/booking/${salonA.slug}/appointments`)
        .send({
          serviceId: serviceA.id,
          stylistId: stylistA.id,
          date: '2026-09-12',
          startTime: '10:30',
          customerName: xssPayload,
          customerPhone: '+919999999904',
        })
        .expect(201);

      expect(res.body.appointmentNumber).toBeDefined();
      const user = await prisma.user.findUnique({ where: { phone: '+919999999904' } });
      expect(user!.name).toBe(xssPayload);
    });

    it('should REJECT Salon Owner attempting privilege escalation to Super Admin endpoints', async () => {
      // Salon Owner attempts to provision a new salon (Super Admin only)
      await request(app.getHttpServer())
        .post('/api/v1/salons/platform/create')
        .set('Authorization', `Bearer ${salonAOwnerToken}`)
        .send({
          name: 'Escalation Salon',
          city: 'Mumbai',
          phone: '9999999999',
          email: 'escalation@test.com',
          ownerName: 'Hacker',
          password: 'Password123!',
        })
        .expect(403);
    });

    it('should REJECT unauthorized access without JWT token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/services')
        .expect(401);
    });

    it('should REJECT invalid/expired token with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/services')
        .set('Authorization', 'Bearer invalid.token.value')
        .expect(401);
    });
  });
});
